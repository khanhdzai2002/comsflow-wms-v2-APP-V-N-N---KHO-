import { createHash } from "node:crypto";
import { AppError } from "./domain";
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
const vietnamDateFormat = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Ho_Chi_Minh",
});
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
    vietnamDateFormat.format(dt) !== `${y}-${mo}-${d}`
  )
    throw new Error("Ngày giờ không hợp lệ");
  return dt.toISOString();
}
export function parseReturnTable(
  matrix: string[][],
  fileHash: string,
  channel = "",
  mapping: Record<string, string> = {},
): ReturnFile {
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
    hash: fileHash,
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
