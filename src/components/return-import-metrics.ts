export const returnUpdateMetrics = [
  [
    "new",
    "Yêu cầu mới",
    "Yêu cầu hoàn trong file chưa có ở shop và sàn đang chọn. Chỉ được lưu khi bạn xác nhận.",
  ],
  [
    "existing",
    "Đã tồn tại",
    "Yêu cầu trong file đã có ở shop và sàn đang chọn; gồm cả yêu cầu thay đổi và không thay đổi.",
  ],
  [
    "status",
    "Đổi trạng thái sàn",
    "Yêu cầu đã có mà trạng thái hoặc trạng thái con từ sàn thay đổi. Không thay thế xác nhận nhận hàng tại kho.",
  ],
  [
    "unchanged",
    "Không thay đổi",
    "Yêu cầu đã có và không có thông tin nguồn nào thay đổi sau đối chiếu.",
  ],
  [
    "finance",
    "Đổi tài chính",
    "Yêu cầu đã có mà số tiền từ sàn thay đổi; có thể đồng thời đổi trạng thái. Không phải tiền bồi thường kho đã nhận.",
  ],
  [
    "errors",
    "Lỗi / mâu thuẫn",
    "Số dòng lỗi và mâu thuẫn với dữ liệu đã có. Cần xử lý hết trước khi xác nhận lưu.",
  ],
] as const;

export const returnSourceMetrics = [
  [
    "rows",
    "Dòng dữ liệu",
    "Số dòng dữ liệu đã đọc trong file, gồm dòng hợp lệ và dòng lỗi. Một yêu cầu có thể có nhiều dòng sản phẩm.",
  ],
  [
    "requests",
    "Yêu cầu hoàn",
    "Số mã yêu cầu hoàn khác nhau trong các dòng hợp lệ. Một đơn gốc có thể có nhiều yêu cầu hoàn.",
  ],
  [
    "orders",
    "Đơn gốc",
    "Số mã đơn mua hàng khác nhau trong các dòng hợp lệ; không phải số yêu cầu hoàn hoặc số kiện.",
  ],
  [
    "tracking",
    "Mã vận đơn hoàn",
    "Số mã Return Logistics Tracking ID khác nhau trong các dòng hợp lệ: mã gửi hàng hoàn về kho, không phải mã vận đơn xuất đi.",
  ],
  [
    "quantity",
    "Sản phẩm yêu cầu hoàn",
    "Tổng số lượng sản phẩm yêu cầu hoàn trên các dòng hợp lệ, không phải số đơn hoặc số hàng kho đã nhận.",
  ],
  [
    "missingTracking",
    "Chưa có mã vận đơn hoàn",
    "Số dòng hợp lệ trống Return Logistics Tracking ID trong file. Có thể đang chờ khách gửi, đã hủy hoặc chỉ hoàn tiền; chưa thể kết luận thiếu hàng.",
  ],
  [
    "missingSellerSku",
    "Thiếu SKU của shop",
    "Số dòng hợp lệ trống Seller SKU (mã sản phẩm do shop đặt). Vẫn dùng SKU ID từ sàn để lưu; không có nghĩa thiếu sản phẩm.",
  ],
] as const;
