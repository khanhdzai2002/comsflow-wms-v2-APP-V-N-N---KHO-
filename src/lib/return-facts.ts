import type { ReturnRow } from "./return-table";
export type ReturnWorkflow = "customer_return" | "delivery_failed";
export type ReturnObligation = "required" | "not_required" | "verify";
export type ShippingState =
  | "unknown"
  | "awaiting_customer"
  | "returning"
  | "delivered"
  | "failed"
  | "reported_lost"
  | "cancelled_before_handover";
export const plainReturnText = (text: unknown) =>
  String(text ?? "")
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .toLowerCase()
    .trim();
export const returnWorkflowLabels = {
  customer_return: "Trả hàng – Hoàn tiền",
  delivery_failed: "Đơn giao thất bại",
};
export const shippingStateLabels = {
  unknown: "Cần xác minh",
  awaiting_customer: "Khách chưa gửi hàng",
  returning: "Đang trung chuyển",
  delivered: "Sàn báo đã giao hoàn",
  failed: "Giao hàng thất bại",
  reported_lost: "Vận chuyển báo thất lạc",
  cancelled_before_handover: "Hủy trước bàn giao",
};
export function deriveReturnFacts(
  rows: ReturnRow[],
  workflow: ReturnWorkflow = "customer_return",
) {
  const text = plainReturnText(
    rows
      .map((r) =>
        [
          r.status,
          r.substatus,
          workflow === "customer_return" ? r.type : "",
          r.meta?.shippingStatus,
          r.meta?.cancellationReason,
          workflow === "delivery_failed" ? r.meta?.reason : "",
        ].join(" "),
      )
      .join(" "),
  );
  const dates = (field: string) =>
    rows
      .map((r) => String(r.meta?.[field] ?? ""))
      .filter(Boolean)
      .sort();
  const latest = (field: string) => dates(field).at(-1) ?? null;
  const earliest = (field: string) => dates(field)[0] ?? null;
  const refundOnly =
    workflow === "customer_return" &&
    /refund\s*only|chi\s*hoan\s*tien|hoan\s*tien\s*khong\s*(?:tra|can)/.test(
      text,
    );
  const cancelled = /cancel(?:led|ed)?|da huy|huy don/.test(text);
  const explicitPre =
    /cancel(?:led|ed)?\s*before\s*(?:ship|handover)|huy truoc (?:giao|ban giao|xuat kho)/.test(
      text,
    );
  const returned =
    /return(?:ed|ing)\s*(?:to\s*(?:sender|seller)|in\s*transit)|dang (?:hoan|quay dau|trung chuyen)|hang dang quay/.test(
      text,
    );
  const failed =
    /delivery\s*fail|failed\s*(?:delivery|attempt)|giao\s*(?:hang\s*)?that bai|khach\s*(?:tu choi|khong nhan)|khong lien he|bom hang/.test(
      text,
    );
  const reportedLost =
    /lost\s*(?:in\s*transit|parcel|package|shipment)?|that lac|van chuyen bao mat/.test(
      text,
    );
  const delivered =
    /return(?:ed)?\s*(?:delivered|completed|received)|delivered\s*to\s*(?:seller|sender)|da giao hoan|da (?:tra|hoan) ve kho/.test(
      text,
    );
  const handover = rows.some(
    (r) =>
      !!r.meta?.handedAt ||
      !!r.meta?.shippedAt ||
      r.meta?.handedOver === "true",
  );
  const rejected =
    workflow === "customer_return" &&
    /reject|declin|refus|tu choi yeu cau|yeu cau bi huy/.test(text);
  const awaiting =
    workflow === "customer_return" &&
    /awaiting\s*(?:buyer|customer|shipment)|waiting\s*(?:for\s*)?(?:buyer|customer)|khach chua gui|cho khach gui/.test(
      text,
    );
  let obligation: ReturnObligation = "verify";
  let shipping: ShippingState = "unknown";
  if (explicitPre && !handover && !failed && !returned && !reportedLost) {
    obligation = "not_required";
    shipping = "cancelled_before_handover";
  } else if (refundOnly) obligation = "not_required";
  else if (workflow === "delivery_failed") {
    if (reportedLost) {
      obligation = "required";
      shipping = "reported_lost";
    } else if (returned) {
      obligation = "required";
      shipping = "returning";
    } else if (delivered) {
      obligation = "required";
      shipping = "delivered";
    } else if (failed || (cancelled && handover)) {
      obligation = "required";
      shipping = "failed";
    }
    // A cancellation word, a tracking code or a platform order alone is not proof
    // that a parcel was handed over or must physically return.
  } else if (rejected || (cancelled && !returned && !delivered))
    obligation = "not_required";
  else if (/return|tra hang|hoan hang/.test(plainReturnText(rows[0]?.type))) {
    obligation = "required";
    shipping = reportedLost
      ? "reported_lost"
      : returned
        ? "returning"
        : delivered
          ? "delivered"
          : awaiting
            ? "awaiting_customer"
            : "unknown";
  }
  const amounts = (key: string) => [
    ...new Set(
      rows
        .map((r) => r.meta?.[key])
        .filter(
          (v): v is number =>
            typeof v === "number" && Number.isSafeInteger(v) && v >= 0,
        ),
    ),
  ];
  const orderAmounts = [
    ...new Set(
      rows.map((r) => r.orderAmount).filter((v): v is number => v !== null),
    ),
  ];
  const refunds = amounts("refundAmount");
  const values = amounts("returnValue");
  const lineValues = rows.every((r) => r.unitAmount !== null)
    ? rows.reduce((n, r) => n + r.quantity * r.unitAmount!, 0)
    : null;
  return {
    workflow,
    obligation,
    shipping,
    refundOnly,
    cancelled,
    handover,
    orderedAt: earliest("orderedAt"),
    cancelledAt: latest("cancelledAt"),
    platformUpdated: latest("platformUpdated"),
    approvedAt: earliest("approvedAt"),
    orderAmount: orderAmounts.length === 1 ? orderAmounts[0] : null,
    refundPaid: !!latest("refundTime"),
    refundAmount: refunds.length === 1 ? refunds[0] : null,
    goodsValue:
      values.length === 1
        ? values[0]
        : lineValues !== null && Number.isSafeInteger(lineValues)
          ? lineValues
          : null,
    financialConflict:
      orderAmounts.length > 1 ||
      refunds.length > 1 ||
      values.length > 1 ||
      (lineValues !== null && !Number.isSafeInteger(lineValues)),
    currency: "VND",
  };
}
