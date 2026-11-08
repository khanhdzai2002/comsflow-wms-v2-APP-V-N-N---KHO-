import { parse } from "csv-parse/browser/esm/sync";
import { decodeXlsxTable } from "./xlsx-raw-table";
let table: string[][] = [];
const decoder = new TextDecoder("utf-8", { fatal: true });
async function readZip(bytes: Uint8Array) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength),
    files = new Map<string, string>();
  let end = -1;
  for (
    let at = bytes.length - 22;
    at >= Math.max(0, bytes.length - 65557);
    at--
  )
    if (view.getUint32(at, true) === 0x06054b50) {
      end = at;
      break;
    }
  if (end < 0) throw new Error("Không đọc được cấu trúc XLSX");
  const count = view.getUint16(end + 10, true),
    start = view.getUint32(end + 16, true);
  if (count > 300 || count === 65535)
    throw new Error("File Excel quá phức tạp; chỉ nhận XLSX tiêu chuẩn");
  let at = start,
    total = 0;
  for (let i = 0; i < count; i++) {
    if (at + 46 > bytes.length || view.getUint32(at, true) !== 0x02014b50)
      throw new Error("Mục ZIP không hợp lệ");
    const flags = view.getUint16(at + 8, true),
      method = view.getUint16(at + 10, true),
      compressed = view.getUint32(at + 20, true),
      inflated = view.getUint32(at + 24, true),
      nameLen = view.getUint16(at + 28, true),
      extra = view.getUint16(at + 30, true),
      comment = view.getUint16(at + 32, true),
      offset = view.getUint32(at + 42, true);
    const name = decoder.decode(bytes.subarray(at + 46, at + 46 + nameLen));
    at += 46 + nameLen + extra + comment;
    if (flags & 1) throw new Error("Không nhận Excel có mật khẩu");
    if (
      ![
        "xl/workbook.xml",
        "xl/_rels/workbook.xml.rels",
        "xl/sharedStrings.xml",
      ].includes(name) &&
      !/^xl\/worksheets\/sheet\d+\.xml$/.test(name)
    )
      continue;
    if (
      files.has(name) ||
      inflated > 64 * 1024 * 1024 ||
      offset + 30 > bytes.length ||
      view.getUint32(offset, true) !== 0x04034b50
    )
      throw new Error("Nội dung XLSX trùng hoặc quá lớn");
    const from =
      offset +
      30 +
      view.getUint16(offset + 26, true) +
      view.getUint16(offset + 28, true);
    if (from + compressed > bytes.length) throw new Error("Dữ liệu ZIP bị cắt");
    const part = bytes.slice(from, from + compressed);
    let decoded: Uint8Array;
    if (method === 0) decoded = part;
    else if (method === 8) {
      const reader = new Blob([part])
        .stream()
        .pipeThrough(new DecompressionStream("deflate-raw"))
        .getReader();
      const chunks: Uint8Array[] = [];
      let size = 0;
      for (;;) {
        const next = await reader.read();
        if (next.done) break;
        size += next.value.length;
        if (size > inflated || size + total > 64 * 1024 * 1024) {
          await reader.cancel();
          throw new Error("Dữ liệu giải nén vượt giới hạn");
        }
        chunks.push(next.value);
      }
      decoded = new Uint8Array(size);
      let p = 0;
      for (const chunk of chunks) {
        decoded.set(chunk, p);
        p += chunk.length;
      }
    } else throw new Error("Kiểu nén XLSX chưa được hỗ trợ");
    total += decoded.length;
    if (total > 64 * 1024 * 1024 || decoded.length !== inflated)
      throw new Error("Kích thước Excel không khớp");
    files.set(name, decoder.decode(decoded));
  }
  return files;
}
globalThis.onmessage = async (event: MessageEvent) => {
  try {
    if (event.data.type === "open") {
      const file = event.data.file as File;
      if (!file.size || file.size > 10 * 1024 * 1024)
        throw new Error("Tệp nhập tối đa 10 MB");
      const bytes = new Uint8Array(await file.arrayBuffer());
      if (/\.csv$/i.test(file.name))
        table = parse(decoder.decode(bytes).replace(/^\uFEFF/, ""), {
          skip_empty_lines: true,
          max_record_size: 32768,
        });
      else if (/\.xlsx$/i.test(file.name))
        table = decodeXlsxTable(await readZip(bytes));
      else throw new Error("Chọn CSV UTF-8 hoặc XLSX");
      if (table.length < 2 || table.length > 50001)
        throw new Error("Mỗi tệp cần 1–50.000 dòng dữ liệu");
      globalThis.postMessage({
        type: "ready",
        headers: table[0].map((h) => String(h ?? "").trim()),
        rows: table.length - 1,
      });
    } else if (event.data.type === "rows") {
      const offset = event.data.offset as number;
      if (!Number.isInteger(offset) || offset < 0 || offset >= table.length - 1)
        throw new Error("Vị trí dòng không hợp lệ");
      const rows: string[][] = [];
      let size = 0;
      for (let i = offset + 1; i < Math.min(table.length, offset + 201); i++) {
        const row = table[i].map((v) => String(v ?? ""));
        size += new TextEncoder().encode(JSON.stringify(row)).length;
        if (size > 400000 && rows.length) break;
        if (size > 450000) throw new Error("Một dòng dữ liệu quá lớn");
        rows.push(row);
      }
      globalThis.postMessage({ type: "rows", offset, rows });
    }
  } catch (error) {
    globalThis.postMessage({
      type: "error",
      error: String((error as any)?.code ?? "").startsWith("CSV_")
        ? "CSV có dấu ngoặc kép hoặc số cột không nhất quán. Xuất lại CSV UTF-8 từ sàn/kho."
        : error instanceof TypeError
          ? "Trình duyệt không đọc được tệp. Dùng Chrome/Edge mới nhất và CSV UTF-8/XLSX gốc."
          : error instanceof Error
            ? error.message
            : "Không đọc được tệp",
    });
  }
};
