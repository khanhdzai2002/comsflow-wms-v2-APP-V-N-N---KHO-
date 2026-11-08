export const RETURN_INTAKE_VERSION = "2026-11-09.1";
export const returnIntakeKinds = {
  customer_return: "Trả hàng – Hoàn tiền",
  delivery_failed: "Đơn giao thất bại",
  warehouse_receipt: "Danh sách kho / SaleWork",
} as const;
export type ReturnIntakeKind = keyof typeof returnIntakeKinds;
export const intakeFields: Record<
  string,
  { label: string; aliases: string[] }
> = {
  request: {
    label: "Mã yêu cầu trả hàng",
    aliases: [
      "Return Order ID",
      "Return Request ID",
      "Mã yêu cầu trả hàng",
      "Mã yêu cầu hoàn",
      "Return ID",
    ],
  },
  order: {
    label: "Mã đơn hàng",
    aliases: [
      "Order ID",
      "Mã đơn hàng",
      "Mã đơn",
      "Order Code",
      "Mã đơn hàng gốc",
    ],
  },
  tracking: {
    label: "Mã vận đơn",
    aliases: [
      "Return Logistics Tracking ID",
      "Return Tracking Number",
      "Mã vận đơn hoàn trả",
      "Mã vận đơn hoàn",
      "Tracking ID",
      "Tracking Number",
      "Mã vận đơn",
      "Mã vận chuyển",
    ],
  },
  carrier: {
    label: "Đơn vị vận chuyển",
    aliases: [
      "Return Logistics Provider",
      "Shipping Provider Name",
      "Shipping Provider",
      "Logistics Provider",
      "Carrier",
      "Đơn vị vận chuyển",
      "Hãng vận chuyển",
    ],
  },
  requested: {
    label: "Ngày phát sinh hoàn",
    aliases: [
      "Time Requested",
      "Return Requested Time",
      "Return Time",
      "Ngày yêu cầu",
      "Ngày phát sinh hoàn",
      "Ngày hoàn",
    ],
  },
  orderedAt: {
    label: "Ngày tạo đơn",
    aliases: [
      "Created Time",
      "Order Created Time",
      "Ngày tạo đơn",
      "Ngày đặt hàng",
    ],
  },
  cancelledAt: {
    label: "Ngày hủy",
    aliases: [
      "Cancelled Time",
      "Canceled Time",
      "Cancel Time",
      "Ngày hủy",
      "Thời gian hủy",
    ],
  },
  platformUpdated: {
    label: "Thời gian cập nhật trạng thái",
    aliases: [
      "Return Updated Time",
      "Updated Time",
      "Update Time",
      "Thời gian cập nhật trạng thái",
      "Ngày cập nhật",
    ],
  },
  status: {
    label: "Trạng thái trên sàn",
    aliases: [
      "Return Status",
      "Order Status",
      "Trạng thái đơn hàng",
      "Trạng thái đơn",
      "Trạng thái trả hàng",
      "Trạng thái",
    ],
  },
  substatus: {
    label: "Trạng thái chi tiết",
    aliases: [
      "Return Sub Status",
      "Order Substatus",
      "Order Sub Status",
      "Trạng thái chi tiết",
    ],
  },
  shippingStatus: {
    label: "Trạng thái vận chuyển",
    aliases: [
      "Shipping Status",
      "Logistics Status",
      "Delivery Status",
      "Trạng thái vận chuyển",
      "Trạng thái giao hàng",
    ],
  },
  type: {
    label: "Loại yêu cầu",
    aliases: [
      "Return Type",
      "Refund Type",
      "Loại yêu cầu",
      "Loại hoàn",
      "Loại trả hàng",
    ],
  },
  reason: {
    label: "Lý do hoàn",
    aliases: [
      "Return Reason",
      "Cancel Reason",
      "Cancellation Reason",
      "Lý do hủy",
      "Lý do hoàn",
      "Lý do trả hàng",
    ],
  },
  sku: {
    label: "Mã sản phẩm / SKU",
    aliases: ["SKU ID", "Product ID", "Mã sản phẩm", "Mã SKU", "SKU"],
  },
  sellerSku: {
    label: "SKU của shop",
    aliases: ["Seller SKU", "Seller SKU ID", "SKU phân loại", "SKU người bán"],
  },
  name: {
    label: "Tên sản phẩm",
    aliases: ["Product Name", "Tên sản phẩm", "Tên hàng"],
  },
  variant: {
    label: "Phân loại",
    aliases: ["SKU Name", "Variation", "Phân loại", "Tên phân loại"],
  },
  lineId: {
    label: "Mã dòng sản phẩm",
    aliases: ["Order Line ID", "Return Line ID", "Mã dòng sản phẩm"],
  },
  color: { label: "Màu", aliases: ["Color", "Colour", "Màu", "Màu sắc"] },
  size: { label: "Size", aliases: ["Size", "Kích cỡ", "Kích thước"] },
  quantity: {
    label: "Số lượng",
    aliases: [
      "Return Quantity",
      "Quantity",
      "Số lượng yêu cầu trả",
      "Số lượng",
      "SL",
    ],
  },
  unitAmount: {
    label: "Đơn giá sản phẩm",
    aliases: [
      "Return unit price",
      "Unit Price",
      "SKU Unit Original Price",
      "Đơn giá",
      "Giá sản phẩm",
    ],
  },
  orderAmount: {
    label: "Giá trị đơn hàng",
    aliases: [
      "Order Amount",
      "Order Value",
      "Tổng tiền đơn hàng",
      "Giá trị đơn hàng",
      "Giá trị đơn",
    ],
  },
  refundAmount: {
    label: "Tiền đã hoàn cho khách",
    aliases: [
      "Refund Amount",
      "Actual Refund Amount",
      "Số tiền thực tế hoàn",
      "Số tiền đã hoàn",
      "Tiền đã hoàn",
    ],
  },
  returnValue: {
    label: "Giá trị hàng hoàn",
    aliases: ["Return Product Amount", "Return Value", "Giá trị hàng hoàn"],
  },
  approvedAt: {
    label: "Ngày phê duyệt",
    aliases: ["Return Approved Time", "Approved Time", "Ngày phê duyệt"],
  },
  refundTime: {
    label: "Ngày hoàn tiền",
    aliases: ["Refund Time", "Ngày hoàn tiền"],
  },
  shippedAt: {
    label: "Ngày vận chuyển",
    aliases: [
      "Shipped Time",
      "Return Shipped Time",
      "Ngày gửi hàng hoàn",
      "Ngày vận chuyển",
    ],
  },
  handedAt: {
    label: "Ngày bàn giao vận chuyển",
    aliases: [
      "Handover Time",
      "Collected Time",
      "Pickup Time",
      "Handed Over Time",
      "Ngày bàn giao vận chuyển",
      "Ngày lấy hàng",
    ],
  },
  receivedAt: {
    label: "Ngày nhận kho thực tế",
    aliases: [
      "Received Time",
      "Ngày nhận",
      "Ngày nhận hàng",
      "Ngày về kho",
      "Thời gian nhận",
      "Thời gian nhập kho",
    ],
  },
  employee: {
    label: "Nhân viên trong file",
    aliases: [
      "Received By",
      "Nhân viên ghi nhận",
      "Nhân viên nhận",
      "Nhân viên",
      "Người nhận",
      "Người tạo",
    ],
  },
  courier: {
    label: "Nhân viên giao hoàn của ĐVVC",
    aliases: [
      "Courier Name",
      "Nhân viên giao hoàn",
      "Người giao hàng",
      "Nhân viên giao hàng",
    ],
  },
  note: {
    label: "Ghi chú",
    aliases: ["Note", "Buyer Note", "Ghi chú", "Ghi chú kho"],
  },
};
export const foldIntakeHeader = (s: string) =>
  s
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
export function resolveIntakeMapping(
  headers: string[],
  manual: Record<string, string> = {},
  kind?: ReturnIntakeKind,
) {
  const mapping: Record<string, string> = {},
    ambiguous: Record<string, string[]> = {};
  for (const [key, field] of Object.entries(intakeFields)) {
    if (manual[key]) {
      if (headers.includes(manual[key])) mapping[key] = manual[key];
      continue;
    }
    const preferred =
      kind === "customer_return" && key === "status"
        ? "Return Status"
        : kind === "delivery_failed" && key === "status"
          ? "Order Status"
          : kind === "customer_return" && key === "substatus"
            ? "Return Sub Status"
            : null;
    if (preferred) {
      const exact = headers.find(
        (h) => foldIntakeHeader(h) === foldIntakeHeader(preferred),
      );
      if (exact) {
        mapping[key] = exact;
        continue;
      }
    }
    const aliases = new Set(field.aliases.map(foldIntakeHeader));
    const candidates = headers.filter((h) => aliases.has(foldIntakeHeader(h)));
    if (candidates.length === 1) mapping[key] = candidates[0];
    else if (candidates.length > 1) ambiguous[key] = candidates;
  }
  return { mapping, ambiguous };
}
