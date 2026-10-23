import { createHash } from "node:crypto";
import { Readable } from "node:stream";
import { Parse } from "unzipper";
import { SaxesParser } from "saxes";
import { parse } from "csv-parse/sync";
import { AppError } from "./domain";
import { checkXlsxSize } from "./xlsx-safety";
import { returnFields } from "./return-domain";

type Raw = Record<string, string>;
export type ReturnRow = {
  row: number;
  raw: Raw;
  request: string;
  order: string;
  sku: string;
  sellerSku: string;
  name: string;
  variant: string;
  quantity: number;
  tracking: string;
  requested: string;
  status: string;
  substatus: string;
  type: string;
  unitAmount: number | null;
  orderAmount: number | null;
  itemKey: string;
  warnings: string[];
  sourceCarrier?: string;
  meta?: Record<string, string | number | null>;
};
export type ReturnFile = {
  hash: string;
  channel: string;
  rows: ReturnRow[];
  errors: { row: number; message: string; raw: Raw }[];
  summary: {
    rows: number;
    requests: number;
    orders: number;
    tracking: number;
    quantity: number;
    missingTracking: number;
    missingSellerSku: number;
    warnings: number;
  };
};
const hash = (v: string | Buffer) =>
  createHash("sha256").update(v).digest("hex");
export function returnMoney(s: string): number | null {
  if (!s.trim()) return null;
  const v = s.trim().replace(/₫|VND/gi, "").trim();
  if (!/^(?:\d+|\d{1,3}(?:\.\d{3})+)$/.test(v))
    throw new Error("Tiền phải là VND nguyên, dấu chấm phân cách nghìn");
  const n = Number(v.replaceAll(".", ""));
  if (!Number.isSafeInteger(n) || n > 999999999999)
    throw new Error("Số tiền vượt giới hạn");
  return n;
}
export function returnDate(s: string): string {
  const m = /^(\d{2})\/(\d{2})\/(\d{4}) (\d{2}):(\d{2}):(\d{2})$/.exec(
    s.trim(),
  );
  if (!m) throw new Error("Ngày phải theo dd/MM/yyyy HH:mm:ss");
  const [, d, mo, y, h, mi, se] = m;
  const value = `${y}-${mo}-${d}T${h}:${mi}:${se}+07:00`;
  const dt = new Date(value);
  if (
    !Number.isFinite(dt.getTime()) ||
    +h > 23 ||
    +mi > 59 ||
    +se > 59 ||
    new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Ho_Chi_Minh" }).format(
      dt,
    ) !== `${y}-${mo}-${d}`
  )
    throw new Error("Ngày giờ không hợp lệ");
  return dt.toISOString();
}
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
  const headers = (matrix[0] ?? []).map((x) => String(x ?? "").trim());
  if (
    headers.length > 80 ||
    headers.some((h) => !h) ||
    new Set(headers).size !== headers.length
  )
    throw new AppError(400, "Tiêu đề phải đầy đủ và không trùng");
  const recognized = [
    "Return Order ID",
    "Return Logistics Tracking ID",
    "Return Sub Status",
  ].every((h) => headers.includes(h));
  if (channel && recognized && channel !== "TikTok Shop")
    throw new AppError(
      400,
      "File nhận dạng TikTok Shop; sàn chọn thủ công không khớp",
    );
  channel = recognized ? "TikTok Shop" : channel;
  if (!["TikTok Shop", "Shopee"].includes(channel))
    throw new AppError(
      400,
      "Chưa nhận dạng sàn. Chọn sàn và ánh xạ cột; chưa có mẫu Shopee để tự nhận chắc chắn.",
    );
  const fields = { ...returnFields, ...mapping };
  const required = [
    "request",
    "order",
    "sku",
    "name",
    "quantity",
    "requested",
    "status",
    "type",
  ];
  for (const key of required)
    if (!headers.includes(fields[key]))
      throw new AppError(
        400,
        `Thiếu cột ${fields[key]}. Cần ánh xạ trước khi nhập.`,
      );
  if (matrix.length < 2 || matrix.length > 10001)
    throw new AppError(400, "File phải có 1–10.000 dòng dữ liệu");
  const rows: ReturnRow[] = [],
    errors: ReturnFile["errors"] = [];
  for (let i = 1; i < matrix.length; i++) {
    const raw = Object.fromEntries(
      headers.map((h, c) => [h, String(matrix[i]?.[c] ?? "").trim()]),
    );
    if (Object.values(raw).every((v) => !v)) continue;
    try {
      const get = (k: string) => raw[fields[k]] ?? "";
      const request = get("request"),
        order = get("order"),
        sku = get("sku"),
        quantity = Number(get("quantity")),
        tracking = get("tracking").toUpperCase();
      if (
        !request ||
        !order ||
        !sku ||
        [request, order, sku].some(
          (x) => x.length > 100 || !/^[A-Za-z0-9._-]+$/.test(x),
        )
      )
        throw new Error("Thiếu hoặc sai mã yêu cầu/đơn/SKU. Giữ mã dạng text");
      if (
        channel === "TikTok Shop" &&
        (!/^\d{19}$/.test(request) ||
          !/^\d{18}$/.test(order) ||
          !/^\d{19}$/.test(sku))
      )
        throw new Error(
          "Mã TikTok phải giữ đúng 19/18/19 chữ số; không dùng mã đã bị làm tròn hoặc số khoa học",
        );
      if (
        !/^\d+$/.test(get("quantity")) ||
        !Number.isInteger(quantity) ||
        quantity < 1 ||
        quantity > 100000
      )
        throw new Error("Số lượng phải là số nguyên dương");
      if (
        !get("name") ||
        get("name").length > 1000 ||
        !get("status") ||
        !get("type")
      )
        throw new Error("Thiếu tên sản phẩm/trạng thái/loại yêu cầu");
      if (tracking && !/^[A-Z0-9._-]{4,80}$/.test(tracking))
        throw new Error("Mã vận đơn hoàn không hợp lệ");
      const unitAmount = returnMoney(get("unitAmount")),
        orderAmount = returnMoney(get("orderAmount")),
        warnings: string[] = [];
      if (!tracking) warnings.push("Chưa có vận đơn hoàn; vẫn lưu yêu cầu");
      if (!get("sellerSku"))
        warnings.push("Chưa có Seller SKU; dùng SKU ID từ sàn");
      if (
        unitAmount !== null &&
        orderAmount !== null &&
        unitAmount * quantity > orderAmount
      )
        warnings.push(
          "Cần xác minh đơn giá × số lượng vượt giá trị đơn; chưa dùng làm tiền thực hoàn",
        );
      if (get("refundTime")) returnDate(get("refundTime"));
      const meta: Record<string, string | number | null> = {};
      for (const k of [
        "refundAmount",
        "platformCompensation",
        "returnValue",
        "sellerReturnFee",
        "otherReturnFee",
      ])
        meta[k] = returnMoney(get(k));
      for (const k of [
        "orderedAt",
        "platformUpdated",
        "approvedAt",
        "shippedAt",
        "expectedAt",
        "refundTime",
      ])
        meta[k] = get(k) ? returnDate(get(k)) : "";
      for (const k of [
        "platformCompensationStatus",
        "disputeStatus",
        "appealStatus",
        "reason",
        "note",
        "originalTracking",
        "buyerDescription",
        "buyerEvidence",
        "color",
        "size",
      ])
        meta[k] = get(k);
      rows.push({
        sourceCarrier: get("carrier"),
        meta,
        row: i + 1,
        raw,
        request,
        order,
        sku,
        sellerSku: get("sellerSku"),
        name: get("name"),
        variant: get("variant"),
        quantity,
        tracking,
        requested: returnDate(get("requested")),
        status: get("status"),
        substatus: get("substatus"),
        type: get("type"),
        unitAmount,
        orderAmount,
        itemKey: hash(
          JSON.stringify(
            channel === "TikTok Shop" ? [sku] : [sku, get("variant")],
          ),
        ),
        warnings,
      });
    } catch (e) {
      errors.push({ row: i + 1, message: (e as Error).message, raw });
    }
  }
  // No silent merging of duplicate SKU rows or contradictory identities.
  const groups = new Map<string, ReturnRow[]>();
  for (const row of rows)
    (
      groups.get(row.request) ??
      (groups.set(row.request, []), groups.get(row.request)!)
    ).push(row);
  const bad = new Set<string>();
  for (const [key, group] of groups) {
    if (
      new Set(group.map((r) => r.order)).size > 1 ||
      ["status", "substatus", "type"].some(
        (k) =>
          new Set(group.map((r) => (r as any)[k]).filter(Boolean)).size > 1,
      ) ||
      new Set(group.map((r) => r.itemKey)).size !== group.length
    ) {
      bad.add(key);
      for (const r of group)
        errors.push({
          row: r.row,
          message:
            "Yêu cầu hoàn có mã đơn mâu thuẫn hoặc lặp dòng SKU chưa rõ cách phân biệt; không tự gộp/bỏ dòng",
          raw: r.raw,
        });
    }
  }
  const valid = rows.filter((r) => !bad.has(r.request));
  return {
    hash: hash(buffer),
    channel,
    rows: valid,
    errors,
    summary: {
      rows: valid.length + errors.length,
      requests: new Set(valid.map((r) => r.request)).size,
      orders: new Set(valid.map((r) => r.order)).size,
      tracking: new Set(valid.map((r) => r.tracking).filter(Boolean)).size,
      quantity: valid.reduce((n, r) => n + r.quantity, 0),
      missingTracking: valid.filter((r) => !r.tracking).length,
      missingSellerSku: valid.filter((r) => !r.sellerSku).length,
      warnings: valid.filter((r) => r.warnings.length).length,
    },
  };
}
