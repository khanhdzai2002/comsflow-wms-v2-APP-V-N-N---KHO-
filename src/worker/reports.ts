import { createHash } from "node:crypto";
import { rm, stat } from "node:fs/promises";
import { createReadStream, createWriteStream } from "node:fs";
import { once } from "node:events";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { storage } from "../lib/supabase";
import { db } from "../lib/db";
import { AppError, normalizeCode } from "../lib/domain";
import { AppResponse } from "../server/http";
export function clean(value: unknown) {
  const s =
    value instanceof Date
      ? value.toISOString()
      : typeof value === "object" && value !== null
        ? JSON.stringify(value)
        : String(value ?? "");
  return /^[=+@\-\t\r]/.test(s) ? "'" + s : s;
}
export const csv = (row: unknown[]) =>
  row.map((v) => '"' + clean(v).replaceAll('"', '""') + '"').join(",") + "\r\n";
export async function storeArtifact(
  file: string,
  filename: string,
  rows: number,
  jobId: string,
) {
  const info = await stat(file);
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  const path = `results/${jobId}/${filename}`;
  const upload = await storage().upload(path, createReadStream(file) as any, {
    contentType: filename.endsWith(".csv")
      ? "text/csv; charset=utf-8"
      : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    upsert: true,
  });
  if (upload.error)
    throw new AppError(
      503,
      "Chưa lưu được báo cáo lên Storage. Tác vụ sẽ thử lại.",
    );
  return {
    artifact: path,
    filename,
    rows,
    bytes: info.size,
    sha256: hash.digest("hex"),
  };
}
// Used only in the isolated Node process, never in the Cloudflare request process.
export async function exportData(
  rows: Record<string, any>[],
  format: string,
  filename: string,
) {
  const { requestContext } = await import("../server/context");
  const sink = requestContext.getStore()?.exportSink;
  if (!sink) throw new Error("Missing export sink");
  return sink(rows, format, filename);
}
export function reportSink(jobId: string) {
  return async (
    rows: Record<string, any>[],
    format: string,
    filename: string,
  ) => {
    const name =
      filename.replace(/[^a-zA-Z0-9_-]/g, "_") +
      (format === "csv" ? ".csv" : ".xlsx");
    const file = join(tmpdir(), `${jobId}-${name}`),
      keys = Object.keys(rows[0] ?? { message: "" });
    try {
      if (format === "csv") {
        const out = createWriteStream(file);
        out.write("\uFEFF" + csv(keys));
        for (const row of rows)
          if (!out.write(csv(keys.map((k) => row[k]))))
            await once(out, "drain");
        const finished = once(out, "finish");
        out.end();
        await finished;
      } else {
        const { default: ExcelJS } = await import("exceljs");
        const book = new ExcelJS.stream.xlsx.WorkbookWriter({
          filename: file,
          useStyles: false,
          useSharedStrings: false,
        });
        const sheet = book.addWorksheet("Báo cáo");
        sheet.columns = keys.map((k) => ({ header: k, key: k, width: 24 }));
        for (const row of rows)
          sheet
            .addRow(
              keys.map((k) =>
                typeof row[k] === "number" ? row[k] : clean(row[k]),
              ),
            )
            .commit();
        sheet.commit();
        await book.commit();
      }
      return AppResponse.json(
        await storeArtifact(file, name, rows.length, jobId),
      );
    } finally {
      await rm(file, { force: true });
    }
  };
}
export async function scanExport(date: string, jobId: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date))
    throw new AppError(400, "Ngày không hợp lệ");
  const file = join(tmpdir(), `${jobId}-scans.csv`),
    name = `ComsFlow_scan_${date}.csv`;
  const sql = db();
  const out = createWriteStream(file);
  let count = 0;
  try {
    const [{ n }] =
      await sql`SELECT count(*)::int n FROM scan_events WHERE created_at>=(${date}::date::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh') AND created_at< ((${date}::date+1)::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh')`;
    out.write(
      "\uFEFF" +
        csv([
          "id",
          "request_id",
          "tracking_code",
          "raw_code",
          "outcome",
          "time_vietnam",
          "time_utc",
          "employee",
          "warehouse",
          "shift_id",
          "method",
          "response_json",
          "request_payload_json",
        ]),
    );
    for await (const rows of sql`SELECT e.*,u.name employee,w.name warehouse,to_char(e.created_at AT TIME ZONE 'Asia/Ho_Chi_Minh','YYYY-MM-DD HH24:MI:SS.US') time_vietnam,to_char(e.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') time_utc FROM scan_events e JOIN users u ON u.id=e.user_id JOIN warehouses w ON w.id=e.warehouse_id WHERE e.created_at>=(${date}::date::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh') AND e.created_at<((${date}::date+1)::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh') ORDER BY e.created_at,e.id`.cursor(
      500,
    )) {
      for (const e of rows) {
        if (
          !out.write(
            csv([
              e.id,
              e.request_id,
              normalizeCode(e.raw_code),
              e.raw_code,
              e.outcome,
              e.time_vietnam,
              e.time_utc,
              e.employee,
              e.warehouse,
              e.shift_id,
              e.method,
              e.response,
              e.request_payload,
            ]),
          )
        )
          await once(out, "drain");
        count++;
      }
    }
    const finished = once(out, "finish");
    out.end();
    await finished;
    if (count !== n)
      throw new AppError(
        503,
        "Số dòng xuất chưa khớp database. Chưa xác nhận báo cáo.",
      );
    return await storeArtifact(file, name, count, jobId);
  } finally {
    out.destroy();
    await rm(file, { force: true });
  }
}
