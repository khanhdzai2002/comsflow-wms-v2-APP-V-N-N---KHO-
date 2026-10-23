import { AppError } from "./domain";
import { Readable } from "node:stream";
import { Parse } from "unzipper";
// XLSX is a ZIP. Reject oversized inflated archives before ExcelJS caches strings.
// ZIP64 and encrypted archives are deliberately unsupported for small order files.
export function checkXlsxSize(buffer: Buffer) {
  let eocd = -1;
  for (
    let i = buffer.length - 22;
    i >= Math.max(0, buffer.length - 65557);
    i--
  ) {
    if (buffer.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new AppError(400, "XLSX thiếu chỉ mục ZIP hợp lệ");
  const count = buffer.readUInt16LE(eocd + 10),
    offset = buffer.readUInt32LE(eocd + 16);
  if (count === 65535 || count > 1000 || offset >= eocd)
    throw new AppError(400, "Cấu trúc XLSX không được hỗ trợ");
  let cursor = offset,
    total = 0;
  for (let i = 0; i < count; i++) {
    if (cursor + 46 > eocd || buffer.readUInt32LE(cursor) !== 0x02014b50)
      throw new AppError(400, "Chỉ mục XLSX bị hỏng");
    if (buffer.readUInt16LE(cursor + 8) & 1)
      throw new AppError(400, "Không hỗ trợ XLSX có mật khẩu");
    total += buffer.readUInt32LE(cursor + 24);
    if (total > 30 * 1024 * 1024)
      throw new AppError(400, "XLSX giải nén vượt quá 30 MB");
    cursor +=
      46 +
      buffer.readUInt16LE(cursor + 28) +
      buffer.readUInt16LE(cursor + 30) +
      buffer.readUInt16LE(cursor + 32);
  }
}
export async function checkXlsxInflation(buffer: Buffer) {
  let total = 0,
    entries = 0;
  const parser = Readable.from(buffer).pipe(Parse({ forceStream: true }));
  try {
    for await (const entry of parser) {
      if (++entries > 1000)
        throw new AppError(400, "XLSX có quá nhiều thành phần");
      for await (const chunk of entry) {
        total += chunk.length;
        if (total > 30 * 1024 * 1024)
          throw new AppError(400, "XLSX giải nén thực tế vượt quá 30 MB");
      }
    }
  } catch (error) {
    parser.destroy();
    if (error instanceof AppError) throw error;
    throw new AppError(400, "Nội dung XLSX bị hỏng hoặc không đọc được");
  }
}
