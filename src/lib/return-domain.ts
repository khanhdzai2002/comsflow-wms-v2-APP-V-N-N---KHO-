export const returnTabs = [
  {
    key: "dashboard",
    label: "Dashboard đơn hoàn",
    description: "Theo dõi số liệu và việc cần xử lý",
    managerOnly: true,
  },
  {
    key: "import",
    label: "Nhập dữ liệu đơn hoàn",
    description: "Tải file Excel / CSV từ sàn",
    managerOnly: true,
  },
  {
    key: "scan",
    label: "Quét mã hoàn kho",
    description: "Xác nhận kiện thực tế về kho",
    managerOnly: false,
  },
  {
    key: "list",
    label: "Danh sách & xử lý",
    description: "Kiểm hàng và xử lý từng yêu cầu",
    managerOnly: false,
  },
  {
    key: "claims",
    label: "Khiếu nại & đơn mất",
    description: "Theo dõi hồ sơ và tiền bồi thường",
    managerOnly: true,
  },
  {
    key: "history",
    label: "Lịch sử & đối soát",
    description: "Tra cứu thao tác và xuất đối soát",
    managerOnly: false,
  },
  {
    key: "analytics",
    label: "Phân tích hoàn trả",
    description: "Lý do, SKU và tỷ lệ theo dữ liệu bán",
    managerOnly: true,
  },
  {
    key: "updates",
    label: "Lịch sử cập nhật file",
    description: "Kết quả nhập và giá trị trước → sau",
    managerOnly: true,
  },
] as const;
export type ReturnTab = (typeof returnTabs)[number]["key"];
export const visibleReturnTabs = (role: string) =>
  returnTabs.filter((tab) => role !== "staff" || !tab.managerOnly);

export const returnProcessing: Record<string, string> = {
  pending: "Chờ xử lý",
  checking: "Đang kiểm tra",
  claim_open: "Đang khiếu nại",
  claim_submitted: "Đã gửi khiếu nại",
  claim_won: "Khiếu nại thành công",
  claim_lost: "Khiếu nại thất bại",
  suspected_lost: "Nghi mất",
  lost: "Xác nhận mất",
  compensated: "Đã được bồi hoàn",
  completed: "Hoàn thành",
  closed_unsuccessful: "Đóng không thành công",
};
export const returnInspection: Record<string, string> = {
  pending: "Đã nhận kiện · chờ kiểm",
  full: "Nhận đủ · nguyên vẹn",
  short: "Nhận thiếu",
  damaged: "Hư hỏng",
  wrong: "Sai sản phẩm",
  empty: "Kiện rỗng",
};
export const returnFields: Record<string, string> = {
  request: "Return Order ID",
  order: "Order ID",
  sku: "SKU ID",
  sellerSku: "Seller SKU",
  name: "Product Name",
  variant: "SKU Name",
  quantity: "Return Quantity",
  tracking: "Return Logistics Tracking ID",
  requested: "Time Requested",
  status: "Return Status",
  substatus: "Return Sub Status",
  type: "Return Type",
  unitAmount: "Return unit price",
  orderAmount: "Order Amount",
  refundTime: "Refund Time",
  reason: "Return Reason",
  note: "Buyer Note",
  carrier: "Return Logistics Provider",
  originalTracking: "Original Logistics Tracking ID",
  orderedAt: "Order Created Time",
  platformUpdated: "Return Updated Time",
  approvedAt: "Return Approved Time",
  shippedAt: "Return Shipped Time",
  expectedAt: "Expected Return Time",
  refundAmount: "Refund Amount",
  platformCompensation: "Compensation Amount",
  platformCompensationStatus: "Compensation Status",
  disputeStatus: "Dispute Status",
  appealStatus: "Appeal Status",
  returnValue: "Return Product Amount",
  sellerReturnFee: "Seller Return Shipping Fee",
  otherReturnFee: "Other Return Fee",
  buyerDescription: "Buyer Description",
  buyerEvidence: "Buyer Evidence",
  color: "Color",
  size: "Size",
};

export const reasonGroups: Record<string, string> = {
  size: "Không vừa size",
  description: "Không đúng mô tả",
  color: "Không đúng màu",
  wrong: "Giao nhầm sản phẩm",
  quality: "Hàng lỗi / chất lượng",
  damaged: "Hàng hư hỏng",
  mind: "Khách đổi ý",
  delivery: "Giao hàng thất bại",
  other: "Khác / chưa phân loại",
};

export function platformApproved(record: any, statuses: string[]) {
  return (
    !!record.source_data?.some((x: any) => x.meta?.approvedAt) ||
    statuses.some(
      (s) =>
        s.toLowerCase() === record.platform_status?.toLowerCase() ||
        s.toLowerCase() === record.platform_substatus?.toLowerCase(),
    )
  );
}

export function returnChangeLabel(field: string) {
  const index = field.indexOf(":"),
    sku = index < 0 ? "" : field.slice(0, index),
    key = index < 0 ? field : field.slice(index + 1);
  const labels: Record<string, string> = {
    status: "Trạng thái từ sàn",
    substatus: "Trạng thái con từ sàn",
    type: "Loại yêu cầu",
    tracking: "Mã vận đơn hoàn",
    sourceCarrier: "Hãng trong file",
    sellerSku: "SKU của shop",
    quantity: "Số lượng yêu cầu hoàn",
    unitAmount: "Đơn giá hoàn (VND)",
    orderAmount: "Giá trị đơn gốc (VND)",
    name: "Tên sản phẩm",
    variant: "Phân loại",
    refundAmount: "Tiền khách được hoàn (VND)",
    platformCompensation: "Bồi thường sàn báo (VND)",
    returnValue: "Giá trị sản phẩm trả (VND)",
    sellerReturnFee: "Phí vận chuyển trả nhà bán chịu (VND)",
    otherReturnFee: "Phí hoàn khác (VND)",
    orderedAt: "Ngày đặt hàng",
    platformUpdated: "Ngày cập nhật từ sàn",
    approvedAt: "Ngày chấp thuận",
    shippedAt: "Ngày vận chuyển hoàn",
    expectedAt: "Ngày dự kiến trả",
    refundTime: "Thời điểm hoàn tiền từ sàn",
    reason: "Lý do gốc",
    note: "Ghi chú khách",
    originalTracking: "Vận đơn giao ban đầu",
    buyerDescription: "Mô tả lỗi từ khách",
    buyerEvidence: "Bằng chứng khách",
    color: "Màu",
    size: "Size",
  };
  return (
    (sku ? "SKU " + sku + " · " : "") +
    (labels[key] ??
      (key.startsWith("raw.") ? "Cột nguồn: " + key.slice(4) : key))
  );
}
