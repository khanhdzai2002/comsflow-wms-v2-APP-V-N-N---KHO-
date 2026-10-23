import {
  AppRequest as NextRequest,
  AppResponse as NextResponse,
} from "../server/http";
import { db, type User } from "../lib/db";
import { z } from "zod";
import { AppError, requireRole, managerRoles } from "../lib/domain";
import {
  parseSalesFile,
  commitSales,
  salesContextSchema,
} from "../lib/sales-import";
import { parseReturnFile } from "../lib/return-import";
import { previewReturns, commitReturns } from "../lib/returns";
import { recordReturnUpload } from "../lib/return-settings";
import { parseFile, validateRows, importRows } from "../lib/imports";
import { readSourceUpload, withSourceUpload } from "../lib/source-upload";
import { parseSourcePdf } from "../lib/pdf-source";
import { previewSource, commitSource } from "../lib/source-manifests";
import { exportData } from "./reports";
const json = (value: unknown) => NextResponse.json(value);
async function limitedBody(
  req: Request,
  limit: number,
  message: string = "Yêu cầu quá lớn",
) {
  const bytes = Buffer.from(await req.arrayBuffer());
  if (bytes.length > limit) throw new AppError(413, message);
  return bytes;
}
export async function fileRequest(req: NextRequest, user: User) {
  const path = req.nextUrl.pathname.replace(/^\/api\//, "");
  const sql = db();
  requireRole(user, managerRoles);

  if (
    ["returns/sales/preview", "returns/sales/commit"].includes(path) &&
    req.method === "POST"
  ) {
    requireRole(user, managerRoles);
    const bytes = await limitedBody(
      req,
      6 * 1024 * 1024,
      "File bán tối đa 5 MB",
    );
    const form = await new Request(req.url, {
      method: "POST",
      headers: { "Content-Type": req.headers.get("content-type") ?? "" },
      body: bytes,
    }).formData();
    const file = form.get("file");
    if (!(file instanceof File)) throw new AppError(400, "Chọn file bán hàng");
    const context = salesContextSchema.parse(
        JSON.parse(String(form.get("context") ?? "{}")),
      ),
      mapping = JSON.parse(String(form.get("mapping") ?? "{}"));
    const parsed = await parseSalesFile(
      Buffer.from(await file.arrayBuffer()),
      file.name,
      mapping,
      context.completedStatuses,
    );
    return json(
      path.endsWith("preview")
        ? parsed
        : await commitSales(user, parsed, file.name, context),
    );
  }

  if (
    [
      "returns/import/preview",
      "returns/import/commit",
      "returns/import/errors",
    ].includes(path) &&
    req.method === "POST"
  ) {
    requireRole(user, managerRoles);
    const bytes = await limitedBody(
      req,
      6 * 1024 * 1024,
      "File đơn hoàn tối đa 5 MB",
    );
    const form = await new Request(req.url, {
      method: "POST",
      headers: { "Content-Type": req.headers.get("content-type") ?? "" },
      body: bytes,
    }).formData();
    const file = form.get("file");
    if (!(file instanceof File)) throw new AppError(400, "Chọn file đơn hoàn");
    const context = JSON.parse(String(form.get("context") ?? "{}"));
    const mapping = JSON.parse(String(form.get("mapping") ?? "{}"));
    let parsed;
    try {
      parsed = await parseReturnFile(
        Buffer.from(await file.arrayBuffer()),
        file.name,
        String(context.channel ?? ""),
        mapping,
      );
    } catch (e) {
      if (path.endsWith("preview"))
        await recordReturnUpload(user, file.name, context, { errors: 1 }, [
          (e as Error).message,
        ]);
      throw e;
    }
    if (path.endsWith("errors"))
      return exportData(
        parsed.errors.map((e) => ({
          row: e.row,
          error: e.message,
          ...e.raw,
        })),
        "csv",
        "return-import-errors",
      );
    return json(
      path.endsWith("preview")
        ? await (async () => {
            const preview = await previewReturns(user, parsed, context);
            await recordReturnUpload(
              user,
              file.name,
              { ...context, channel: parsed.channel },
              preview.updateSummary,
              [
                ...parsed.errors.map((e) => e.message),
                ...preview.conflicts.map((e) => e.message),
              ],
            );
            return preview;
          })()
        : await commitReturns(user, parsed, file.name, context),
    );
  }

  if (
    (path === "sources/preview" || path === "sources/commit") &&
    req.method === "POST"
  ) {
    // Acquire before consuming the request: parallel uploads must not buffer
    // several 50 MB bodies and PDF.js documents in the same small container.
    return withSourceUpload(async () => {
      const upload = await readSourceUpload(req);
      const parsed = await parseSourcePdf(upload.buffer);
      return json(
        path === "sources/preview"
          ? await previewSource(user, parsed, upload.context)
          : await commitSource(user, upload.filename, parsed, upload.context),
      );
    });
  }

  if (
    (path === "imports/preview" || path === "imports/commit") &&
    req.method === "POST"
  ) {
    if (Number(req.headers.get("content-length")) > 6 * 1024 * 1024)
      throw new AppError(413, "File tối đa 5 MB");
    const form = await new Request(req.url, {
        method: "POST",
        headers: req.headers,
        body: await limitedBody(req, 6 * 1024 * 1024),
      }).formData(),
      file = form.get("file");
    if (!(file instanceof File) || file.size > 5 * 1024 * 1024)
      throw new AppError(400, "Chọn file CSV hoặc XLSX tối đa 5 MB");
    let parsed;
    try {
      parsed = await parseFile(
        Buffer.from(await file.arrayBuffer()),
        file.name,
      );
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError(
        400,
        "File không đọc được. Kiểm tra CSV đúng cấu trúc hoặc XLSX không bị hỏng.",
      );
    }
    const mapping = z
      .record(z.string().max(80), z.string().max(200))
      .parse(JSON.parse(String(form.get("mapping") ?? "{}")));
    if (path === "imports/preview") {
      const result = validateRows(parsed.rows, mapping);
      const codes = [...new Set(result.valid.map((r) => r.data.tracking_code))];
      const existing = codes.length
        ? await sql`SELECT tracking_code FROM shipments WHERE tracking_code IN ${sql(codes)}`
        : [];
      return json({
        headers: parsed.headers,
        preview: parsed.rows.slice(0, 8),
        total: parsed.rows.length,
        valid: result.valid.length,
        errorCount: result.errors.length,
        errors: result.errors.slice(0, 100),
        uniqueShipments: codes.length,
        existingShipments: existing.length,
      });
    }
    return json(await importRows(user, file.name, parsed.rows, mapping));
  }
  throw new AppError(404, "Tác vụ không hỗ trợ");
}
