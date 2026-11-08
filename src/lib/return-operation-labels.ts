export const operationStates: Record<string, string> = {
  received: "Đã nhận hoàn kho",
  needs_check: "Chưa nhận – Cần kiểm tra",
  in_transit: "Đang trung chuyển",
  suspected_lost: "Đơn nghi thất lạc",
  lost: "Đã xác nhận mất",
  not_required: "Không cần hoàn kho",
  awaiting_customer: "Khách chưa gửi hàng",
  verify: "Cần xác minh dữ liệu",
  closed: "Đã xử lý xong",
};
export const operationKpis = [
  [
    "total",
    "Tổng hồ sơ phát sinh hoàn",
    "",
    "Số hồ sơ/yêu cầu duy nhất. Một đơn mua hàng có thể có nhiều yêu cầu; không nhân theo SKU hoặc số kiện.",
  ],
  [
    "received",
    "Đã nhận thực tế",
    "received",
    "Đã có bằng chứng nhận ít nhất một kiện hoặc bản ghi kho được ghép chắc chắn. Chưa có nghĩa là đủ SKU hay đã kiểm hàng.",
  ],
  [
    "needs_check",
    "Chưa nhận – Cần kiểm tra",
    "needs_check",
    "Hồ sơ có nghĩa vụ hoàn, chưa có nhận thực tế và thuộc tập cần tra soát; không mặc định gồm tất cả đơn trung chuyển hoặc chỉ hoàn tiền.",
  ],
  [
    "in_transit",
    "Đang trung chuyển",
    "in_transit",
    "Nguồn vận chuyển cho biết hàng đang trên đường hoàn. Không tự xem là đơn mất.",
  ],
  [
    "suspected_lost",
    "Nghi thất lạc",
    "suspected_lost",
    "Có thông báo thất lạc từ vận chuyển hoặc được quản lý đánh dấu nghi mất; còn cần xác minh.",
  ],
  [
    "refund_only",
    "Chỉ hoàn tiền",
    "refund_only",
    "Không yêu cầu hàng vật lý quay lại kho; không cộng vào hàng còn thiếu.",
  ],
  [
    "claims",
    "Đang khiếu nại",
    "claims",
    "Số hồ sơ có ít nhất một khiếu nại chưa kết thúc; mỗi hồ sơ chỉ đếm một lần.",
  ],
  [
    "check_value",
    "Giá trị hàng cần kiểm tra",
    "needs_check",
    "Giá trị sản phẩm hoàn đã biết của tập cần tra soát. Không phải tiền hoàn khách và không nhân giá trị cả đơn theo SKU.",
  ],
  [
    "problem_value",
    "Giá trị hàng có vấn đề",
    "goods_problem",
    "Giá trị hàng thuộc hồ sơ đã ghi nhận thiếu/sai/hỏng; chưa đồng nghĩa tiền bồi thường được chấp nhận.",
  ],
  [
    "compensation",
    "Bồi thường đã thực nhận",
    "compensation",
    "Chỉ số tiền có ngày thực nhận trong hồ sơ khiếu nại, khác tiền sàn báo hoặc số tiền đang yêu cầu.",
  ],
] as const;
