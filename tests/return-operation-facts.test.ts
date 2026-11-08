import { it, expect } from "vitest";
import { deriveReturnFacts } from "../src/lib/return-facts";
import {
  exactReturnIdentifier,
  intakeDate,
  normalizeReturnIntake,
} from "../src/lib/return-intake-normalize";
import { resolveIntakeMapping } from "../src/lib/return-intake-fields";
import type { ReturnRow } from "../src/lib/return-table";
const row = (o: Partial<ReturnRow> = {}): ReturnRow => ({
  row: 2,
  raw: {},
  request: "00000000000000000001",
  order: "586890280579270204",
  sku: "SKU-A",
  sellerSku: "A",
  name: "Áo",
  variant: "S",
  quantity: 2,
  tracking: "862678510680",
  requested: "2026-11-01T00:00:00Z",
  status: "Approved",
  substatus: "",
  type: "Return and refund",
  unitAmount: 10000,
  orderAmount: 50000,
  itemKey: "A",
  warnings: [],
  ...o,
});
it.each([
  "123456789012",
  "1234567890123456",
  "586890280579270204",
  "12345678901234567890",
  "00012345678901234567890",
  "TTVN1120898402",
  "G-TEST_01",
])("giữ nguyên mã text %s", (code) => {
  expect(exactReturnIdentifier(code, true)).toBe(code);
});
it.each(["5.86687E+17", "8.62579E+11", "5.8689e17", "1.2e-2"])(
  "từ chối mã đã thành số khoa học %s",
  (code) => {
    expect(() => exactReturnIdentifier(code, true)).toThrow();
  },
);
it("không chấp nhận Number làm định danh", () => {
  expect(() => exactReturnIdentifier(123456789012, true)).toThrow();
});
it("không coi hủy trước bàn giao hay hủy đơn thuần là nghĩa vụ hoàn", () => {
  expect(
    deriveReturnFacts(
      [
        row({
          type: "Giao hàng thất bại",
          status: "Cancelled",
          substatus: "Cancelled before handover",
        }),
      ],
      "delivery_failed",
    ),
  ).toMatchObject({
    obligation: "not_required",
    shipping: "cancelled_before_handover",
  });
  expect(
    deriveReturnFacts(
      [row({ type: "Giao hàng thất bại", status: "Cancelled" })],
      "delivery_failed",
    ).obligation,
  ).toBe("verify");
  expect(
    deriveReturnFacts(
      [
        row({
          type: "Giao hàng thất bại",
          status: "Cancelled",
          meta: { handedAt: "2026-10-30T00:00:00Z" },
        }),
      ],
      "delivery_failed",
    ).obligation,
  ).toBe("required");
});
it("giao thất bại, trung chuyển và báo thất lạc là ba trạng thái riêng", () => {
  expect(
    deriveReturnFacts([row({ status: "Delivery failed" })], "delivery_failed"),
  ).toMatchObject({ obligation: "required", shipping: "failed" });
  expect(
    deriveReturnFacts(
      [row({ status: "Returning to sender" })],
      "delivery_failed",
    ),
  ).toMatchObject({ obligation: "required", shipping: "returning" });
  expect(
    deriveReturnFacts([row({ status: "Lost in transit" })], "delivery_failed"),
  ).toMatchObject({ obligation: "required", shipping: "reported_lost" });
});
it("chỉ hoàn tiền không tạo hàng thiếu; số tiền không nhân theo SKU", () => {
  const facts = deriveReturnFacts([
    row({ type: "Refund only", meta: { refundAmount: 50000 } }),
    row({
      type: "Refund only",
      sku: "SKU-B",
      itemKey: "B",
      meta: { refundAmount: 50000 },
    }),
  ]);
  expect(facts).toMatchObject({
    obligation: "not_required",
    refundOnly: true,
    refundAmount: 50000,
    orderAmount: 50000,
    goodsValue: 40000,
  });
});
it("giá trị đơn mâu thuẫn hoặc thiếu không được suy đoán", () => {
  expect(deriveReturnFacts([row(), row({ orderAmount: 80000 })])).toMatchObject(
    { orderAmount: null, financialConflict: true },
  );
  expect(deriveReturnFacts([row({ unitAmount: null })]).goodsValue).toBeNull();
});
it("ngày Việt Nam chính xác, từ chối ngày không tồn tại", () => {
  expect(intakeDate("09/11/2026 08:15:00")).toBe("2026-11-09T01:15:00.000Z");
  expect(() => intakeDate("31/02/2026 08:15:00")).toThrow();
});
it("tự nhận diện đúng trạng thái đơn hay trả hàng và không coi RTS là bàn giao", () => {
  expect(
    resolveIntakeMapping(
      ["Order Status", "Return Status"],
      {},
      "customer_return",
    ).mapping.status,
  ).toBe("Return Status");
  expect(
    resolveIntakeMapping(
      ["Order Status", "Return Status"],
      {},
      "delivery_failed",
    ).mapping.status,
  ).toBe("Order Status");
  expect(
    resolveIntakeMapping(["RTS Time"], {}, "delivery_failed").mapping.handedAt,
  ).toBeUndefined();
});
it("giao thất bại có mapping tiếng Việt, giữ số 0 đầu và cảnh báo thiếu bằng chứng", () => {
  const raw = {
    "Mã đơn hàng": "000586890280579270204",
    "Mã vận đơn": "862678510680",
    "Số lượng": "1",
    "Ngày tạo đơn": "01/11/2026",
    "Trạng thái": "Đã hủy",
    "Mã SKU": "SKU-01",
  };
  const result = normalizeReturnIntake(
    raw,
    Object.keys(raw),
    "delivery_failed",
    {},
    2,
  );
  expect(result.row).toMatchObject({
    order: "000586890280579270204",
    request: "DF:000586890280579270204",
  });
  expect(result.warnings).toContain(
    "Chưa có bằng chứng phải hoàn kho; giữ ở Cần xác minh, không kết luận từ trạng thái hủy",
  );
});
