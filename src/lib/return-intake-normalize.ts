import { createHash } from "node:crypto";
import { AppError } from "./domain";
import {
  intakeFields,
  resolveIntakeMapping,
  type ReturnIntakeKind,
} from "./return-intake-fields";
import { returnMoney, type ReturnRow } from "./return-table";
import { deriveReturnFacts } from "./return-facts";
import { exactReturnIdentifier } from "./return-identifiers";
export { exactReturnIdentifier };
const vnCalendar = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Ho_Chi_Minh",
});
export function intakeDate(value: string, required = false): string | null {
  const s = value.trim();
  if (!s) {
    if (required) throw new Error("Thiếu ngày trong nguồn");
    return null;
  }
  let result: string;
  const local =
    /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/.exec(
      s,
    );
  const iso =
    /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?)?$/.exec(
      s,
    );
  if (local || iso) {
    const [y, m, d, h, mi, se] = local
      ? [
          local[3],
          local[2],
          local[1],
          local[4] ?? "00",
          local[5] ?? "00",
          local[6] ?? "00",
        ]
      : [
          iso![1],
          iso![2],
          iso![3],
          iso![4] ?? "00",
          iso![5] ?? "00",
          iso![6] ?? "00",
        ];
    result = `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}T${h.padStart(2, "0")}:${mi}:${se}+07:00`;
    const date = new Date(result);
    if (
      !Number.isFinite(date.getTime()) ||
      +h > 23 ||
      +mi > 59 ||
      +se > 59 ||
      vnCalendar.format(date) !==
        `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`
    )
      throw new Error("Ngày giờ không hợp lệ");
    return date.toISOString();
  }
  if (
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(
      s,
    ) &&
    Number.isFinite(Date.parse(s))
  )
    return new Date(s).toISOString();
  // Excel date serial is interpreted ONLY for explicitly mapped date fields.
  if (/^\d{5}(?:\.\d+)?$/.test(s)) {
    const serial = Number(s);
    if (serial < 20000 || serial > 90000)
      throw new Error("Ngày Excel ngoài phạm vi hỗ trợ");
    return new Date(
      Date.UTC(1899, 11, 30) + Math.round(serial * 86400000) - 7 * 3600000,
    ).toISOString();
  }
  throw new Error("Ngày phải theo dd/MM/yyyy HH:mm:ss hoặc ISO, giờ Việt Nam");
}
export type WarehouseReceiptRow = {
  tracking: string;
  order: string;
  receivedAt: string;
  employee: string;
  courier: string;
  sourceCarrier: string;
  note: string;
  sku: string;
  quantity: number | null;
  raw: Record<string, string>;
};
export function normalizeReturnIntake(
  raw: Record<string, string>,
  headers: string[],
  kind: ReturnIntakeKind,
  manual: Record<string, string>,
  rowNumber: number,
) {
  const { mapping, ambiguous } = resolveIntakeMapping(headers, manual, kind);
  const get = (key: string) => raw[mapping[key]]?.trim() ?? "";
  const warnings: string[] = [];
  const required =
    kind === "customer_return"
      ? ["request", "order", "quantity", "requested", "status", "type"]
      : kind === "delivery_failed"
        ? ["order", "quantity", "status"]
        : ["receivedAt"];
  for (const key of required)
    if (!mapping[key])
      throw new Error(
        `${ambiguous[key] ? "Có nhiều cột cùng nghĩa" : "Thiếu cột"} ${intakeFields[key].label}; chọn ánh xạ cột`,
      );
  const order = exactReturnIdentifier(
    get("order"),
    kind !== "warehouse_receipt",
  );
  const tracking = exactReturnIdentifier(get("tracking"));
  if (tracking && !/^[A-Za-z0-9][A-Za-z0-9._-]{3,79}$/.test(tracking))
    throw new Error("Mã vận đơn phải có 4–80 ký tự hợp lệ");
  const sku = exactReturnIdentifier(get("sku") || get("sellerSku"));
  if (kind === "warehouse_receipt") {
    if (!tracking && !order)
      throw new Error("Cần mã vận đơn hoặc mã đơn hàng chính xác");
    const quantity = get("quantity") ? Number(get("quantity")) : null;
    if (
      quantity !== null &&
      (!/^\d+$/.test(get("quantity")) ||
        !Number.isSafeInteger(quantity) ||
        quantity < 0 ||
        quantity > 100000)
    )
      throw new Error("Số lượng nhận không hợp lệ");
    if (!tracking)
      warnings.push(
        "Chưa có vận đơn; chỉ ghép theo mã đơn khi một hồ sơ duy nhất và có SKU/số lượng đủ xác minh",
      );
    return {
      receipt: {
        tracking,
        order,
        sku,
        quantity,
        receivedAt: intakeDate(get("receivedAt"), true)!,
        employee: get("employee"),
        courier: get("courier"),
        sourceCarrier: get("carrier"),
        note: get("note"),
        raw,
      } satisfies WarehouseReceiptRow,
      warnings,
    };
  }
  const quantity = Number(get("quantity"));
  if (
    !/^\d+$/.test(get("quantity")) ||
    !Number.isInteger(quantity) ||
    quantity < 1 ||
    quantity > 100000
  )
    throw new Error("Số lượng yêu cầu phải là số nguyên dương");
  const request =
    kind === "customer_return"
      ? exactReturnIdentifier(get("request"), true)
      : `DF:${order}`;
  if (!sku) warnings.push("Thiếu SKU; chưa thể đối soát đủ sản phẩm theo mã");
  if (!tracking)
    warnings.push("Thiếu mã vận đơn; cần xác minh trước khi ghép nhận tự động");
  const requested = intakeDate(
    get("requested") ||
      get("cancelledAt") ||
      get("platformUpdated") ||
      get("orderedAt"),
    true,
  )!;
  const meta: Record<string, string | number | null> = {};
  for (const field of [
    "orderedAt",
    "cancelledAt",
    "platformUpdated",
    "approvedAt",
    "refundTime",
    "shippedAt",
    "handedAt",
  ])
    meta[field] = intakeDate(get(field));
  for (const field of ["refundAmount", "returnValue"])
    meta[field] = returnMoney(get(field));
  for (const field of ["shippingStatus", "reason", "note", "color", "size"])
    meta[field] = get(field);
  const lineId = exactReturnIdentifier(get("lineId"));
  const row: ReturnRow = {
    row: rowNumber,
    raw,
    request,
    order,
    sku,
    sellerSku: get("sellerSku"),
    name: get("name") || "Chưa có tên sản phẩm",
    variant: get("variant"),
    quantity,
    tracking,
    requested,
    status: get("status"),
    substatus: get("substatus"),
    type: kind === "customer_return" ? get("type") : "Giao hàng thất bại",
    unitAmount: returnMoney(get("unitAmount")),
    orderAmount: returnMoney(get("orderAmount")),
    sourceCarrier: get("carrier"),
    meta,
    warnings,
    itemKey: createHash("sha256")
      .update(JSON.stringify([sku, get("variant"), lineId]))
      .digest("hex"),
  };
  if (
    kind === "delivery_failed" &&
    deriveReturnFacts([row], kind).obligation === "verify"
  )
    warnings.push(
      "Chưa có bằng chứng phải hoàn kho; giữ ở Cần xác minh, không kết luận từ trạng thái hủy",
    );
  return { row, warnings };
}
export function validateIntakeHeaders(headers: string[]) {
  if (
    !headers.length ||
    headers.length > 100 ||
    headers.some((h) => !h.trim() || h.length > 200) ||
    new Set(headers).size !== headers.length
  )
    throw new AppError(
      400,
      "Tiêu đề phải duy nhất, không trống, tối đa 100 cột",
    );
}
