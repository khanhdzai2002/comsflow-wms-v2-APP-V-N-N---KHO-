import { createHash } from "node:crypto";
import { Readable } from "node:stream";
import { Parse } from "unzipper";
import { decodeXlsxTable } from "../worker/xlsx-raw-table";
import { parse } from "csv-parse/sync";
import { AppError } from "./domain";
import { checkXlsxSize } from "./xlsx-safety";
import { parseReturnTable, type ReturnFile } from "./return-table";
export { returnMoney, returnDate } from "./return-table";
export type { ReturnFile, ReturnRow } from "./return-table";

export async function readXlsxTable(buffer: Buffer): Promise<string[][]> {
  checkXlsxSize(buffer);
  const files = new Map<string, string>();
  let inflated = 0,
    entries = 0;
  const archive = Readable.from(buffer).pipe(Parse({ forceStream: true }));
  try {
    for await (const entry of archive) {
      if (++entries > 1000)
        throw new AppError(400, "XLSX quá nhiều thành phần");
      const chunks: Buffer[] = [];
      for await (const chunk of entry) {
        inflated += chunk.length;
        if (inflated > 30 * 1024 * 1024)
          throw new AppError(400, "XLSX giải nén vượt 30 MB");
        chunks.push(chunk);
      }
      if (
        /^xl\/(?:sharedStrings\.xml|workbook\.xml|_rels\/workbook\.xml.rels|worksheets\/[^/]+\.xml)$/.test(
          entry.path,
        )
      ) {
        if (files.has(entry.path))
          throw new AppError(400, "XLSX trùng thành phần");
        files.set(entry.path, Buffer.concat(chunks).toString("utf8"));
      }
    }
  } catch (e) {
    archive.destroy();
    throw e;
  }
  return decodeXlsxTable(files, 10000);
}

export async function parseReturnFile(
  buffer: Buffer,
  filename: string,
  channel = "",
  mapping: Record<string, string> = {},
): Promise<ReturnFile> {
  if (!buffer.length || buffer.length > 5 * 1024 * 1024)
    throw new AppError(400, "File đơn hoàn tối đa 5 MB");
  let matrix: string[][];
  try {
    if (filename.toLowerCase().endsWith(".xlsx"))
      matrix = await readXlsxTable(buffer);
    else if (filename.toLowerCase().endsWith(".csv"))
      matrix = parse(buffer.toString("utf8").replace(/^\uFEFF/, ""), {
        skip_empty_lines: true,
        max_record_size: 32768,
      });
    else throw new AppError(400, "Chọn XLSX hoặc CSV");
  } catch (e) {
    if (e instanceof AppError) throw e;
    throw new AppError(
      400,
      "Không đọc được file Excel/CSV; kiểm tra định dạng và nội dung",
    );
  }
  return parseReturnTable(
    matrix,
    createHash("sha256").update(buffer).digest("hex"),
    channel,
    mapping,
  );
}
