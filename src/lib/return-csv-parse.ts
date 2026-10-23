import { createHash } from "node:crypto";
import { parse } from "csv-parse/sync";
import { AppError } from "./domain";
import { parseReturnTable } from "./return-table";
import { RETURN_CSV_MAX_BYTES, RETURN_CSV_MAX_ROWS } from "./return-csv-format";

export function parseTikTokReturnCsv(
  bytes: Buffer,
  channel = "",
  mapping: Record<string, string> = {},
) {
  if (!bytes.length || bytes.length > RETURN_CSV_MAX_BYTES)
    throw new AppError(
      413,
      "Nhập CSV trực tiếp tối đa 1 MB / 2.000 dòng. Chia nhỏ file lớn trước khi nhập; không bỏ dòng.",
    );
  let matrix: string[][];
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    matrix = parse(text.replace(/^\uFEFF/, ""), {
      skip_empty_lines: true,
      max_record_size: 32768,
    });
  } catch {
    throw new AppError(
      400,
      "CSV phải đúng định dạng UTF-8, dấu phẩy và dấu ngoặc kép. Hãy dùng file CSV gốc từ TikTok.",
    );
  }
  if (matrix.length > RETURN_CSV_MAX_ROWS + 1)
    throw new AppError(
      413,
      "Nhập CSV trực tiếp tối đa 2.000 dòng. Chia nhỏ file lớn trước khi nhập; không bỏ dòng.",
    );
  const parsed = parseReturnTable(
    matrix,
    createHash("sha256").update(bytes).digest("hex"),
    channel,
    mapping,
  );
  if (parsed.channel !== "TikTok Shop")
    throw new AppError(
      400,
      "Nhập CSV trực tiếp hỗ trợ mẫu TikTok Shop. File khác cần dùng luồng nhập có dịch vụ xử lý.",
    );
  return parsed;
}
