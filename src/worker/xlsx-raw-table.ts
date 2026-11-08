import { SaxesParser } from "saxes";
import { AppError } from "../lib/domain";
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

export function decodeXlsxTable(
  files: Map<string, string>,
  maxRows = 50000,
): string[][] {
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
      if (n === "workbookPr" && ["1", "true"].includes(a.date1904))
        throw new AppError(
          400,
          "Excel dùng lịch 1904. Xuất lại CSV UTF-8 với ngày rõ ràng hoặc XLSX lịch 1900 trước khi nhập",
        );
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
      if (cells.size > 2000000 || decoded.length > 32768)
        throw new AppError(400, "Dữ liệu ô vượt giới hạn");
    },
  });
  const matrix: string[][] = [];
  for (const [a, v] of cells) {
    const [, col, row] = /^([A-Z]+)(\d+)$/.exec(a)!;
    let c = 0;
    for (const x of col) c = c * 26 + x.charCodeAt(0) - 64;
    const r = Number(row);
    if (c > 100 || r < 1 || r > maxRows + 1)
      throw new AppError(
        400,
        `Tối đa ${maxRows.toLocaleString("vi-VN")} dòng / 100 cột`,
      );
    (matrix[r - 1] ??= [])[c - 1] = v;
  }
  return matrix;
}
