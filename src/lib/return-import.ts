import { createHash } from "node:crypto";
import { Readable } from "node:stream";
import { Parse } from "unzipper";
import { SaxesParser } from "saxes";
import { parse } from "csv-parse/sync";
import { AppError } from "./domain";
import { checkXlsxSize } from "./xlsx-safety";
import { parseReturnTable, type ReturnFile } from "./return-table";
export { returnMoney, returnDate } from "./return-table";
export type { ReturnFile, ReturnRow } from "./return-table";

function xml(
  source: string,
  handlers: {
    open?: (name: string, attrs: Record<string, string>) => void;
    text?: (s: string) => void;
    close?: (name: string) => void;
  },
) {
  const p = new SaxesParser({ xmlns: false });
  p.on("doctype", () => {
    throw new AppError(400, "Không hỗ trợ DTD trong XLSX");
  });
  p.on("opentag", (n) =>
    handlers.open?.(n.name, n.attributes as Record<string, string>),
  );
  p.on("text", (s) => handlers.text?.(s));
  p.on("cdata", (s) => handlers.text?.(s));
  p.on("closetag", (n) => handlers.close?.(n.name));
  p.write(source).close();
}
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
  const strings: string[] = [];
  let text = "",
    inSi = false,
    inT = false;
  if (files.has("xl/sharedStrings.xml"))
    xml(files.get("xl/sharedStrings.xml")!, {
      open: (n) => {
        if (n === "si") {
          inSi = true;
          text = "";
        }
        if (n === "t") inT = true;
      },
      text: (s) => {
        if (inSi && inT) text += s;
      },
      close: (n) => {
        if (n === "t") inT = false;
        if (n === "si") {
          strings.push(text);
          inSi = false;
        }
      },
    });
  let sheetRel = "";
  xml(files.get("xl/workbook.xml") ?? "", {
    open: (n, a) => {
      if (n === "sheet" && !sheetRel) sheetRel = a["r:id"];
    },
  });
  let target = "";
  xml(files.get("xl/_rels/workbook.xml.rels") ?? "", {
    open: (n, a) => {
      if (
        n === "Relationship" &&
        a.Id === sheetRel &&
        a.TargetMode !== "External"
      )
        target = a.Target;
    },
  });
  const sheetPath = target.startsWith("/")
    ? target.slice(1)
    : "xl/" + target.replace(/^\.\//, "");
  const sheet = files.get(sheetPath);
  if (!sheet) throw new AppError(400, "Không tìm thấy sheet đầu tiên hợp lệ");
  const cells = new Map<string, string>();
  let addr = "",
    kind = "",
    value = "",
    formula = false,
    readValue = false;
  xml(sheet, {
    open: (n, a) => {
      if (n === "c") {
        addr = a.r ?? "";
        kind = a.t ?? "";
        value = "";
        formula = false;
      }
      if (n === "f") formula = true;
      if (n === "v" || n === "t") readValue = true;
    },
    text: (s) => {
      if (readValue) value += s;
    },
    close: (n) => {
      if (n === "v" || n === "t") readValue = false;
      if (n !== "c") return;
      if (formula)
        throw new AppError(
          400,
          "Chuyển công thức thành giá trị trước khi nhập",
        );
      if (!/^[A-Z]{1,2}\d+$/.test(addr))
        throw new AppError(400, "Tọa độ ô Excel không hợp lệ");
      if (
        (kind === "" || kind === "n") &&
        (/^\d{16,}$/.test(value) || /^\d+(?:\.\d+)?[Ee]\+?\d{2,}$/.test(value))
      )
        throw new AppError(
          400,
          "Mã dài phải lưu bằng ô text trước khi xuất Excel; không nhận số có thể đã làm tròn",
        );
      const decoded = kind === "s" ? strings[Number(value)] : value;
      if (decoded === undefined)
        throw new AppError(400, "Shared string không hợp lệ");
      if (cells.has(addr) && cells.get(addr) !== decoded)
        throw new AppError(400, `Ô ${addr} có nhiều giá trị mâu thuẫn`);
      cells.set(addr, decoded);
      if (cells.size > 800000 || decoded.length > 32768)
        throw new AppError(400, "Dữ liệu ô vượt giới hạn");
    },
  });
  const matrix: string[][] = [];
  for (const [a, v] of cells) {
    const [, col, row] = /^([A-Z]+)(\d+)$/.exec(a)!;
    let c = 0;
    for (const x of col) c = c * 26 + x.charCodeAt(0) - 64;
    const r = Number(row);
    if (c > 80 || r < 1 || r > 10001)
      throw new AppError(400, "Tối đa 10.000 dòng / 80 cột");
    (matrix[r - 1] ??= [])[c - 1] = v;
  }
  return matrix;
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
