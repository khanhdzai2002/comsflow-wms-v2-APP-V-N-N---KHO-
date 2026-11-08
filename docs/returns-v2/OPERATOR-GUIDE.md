# Hướng dẫn vận hành

## Nhập nguồn

1. Mở **Quản lý & Đối soát hàng hoàn** → chọn **Đơn giao thất bại** hoặc **Trả hàng – Hoàn tiền** → **Nhập dữ liệu**.
2. Chọn đúng loại nguồn, kho, shop, sàn và CSV UTF-8/XLSX gốc. Để nguyên mã định danh dạng text; không mở CSV rồi lưu lại bằng Excel nếu chưa bảo vệ mã dài.
3. Bấm **Đọc và đối chiếu tệp**. Đây chưa phải xác nhận lưu nghiệp vụ.
4. Xem số dòng, yêu cầu duy nhất, mới/đã có, mã vận đơn, bản sao, lỗi và cũ → mới. Bấm chữ **i** để xem định nghĩa. Dòng trùng hoàn toàn bị bỏ qua; mâu thuẫn phải xử lý. Có thể tải toàn bộ dòng lỗi thành XLSX.
5. Nếu sàn đổi tên cột: mở **Ánh xạ cột**, chọn đúng cột rồi đọc lại. File không có cột thời gian cập nhật không chứng minh nó mới hơn file trước; kiểm tra thay đổi trước xác nhận. File có thời gian cũ hơn bị chặn.
6. Chỉ bấm **Xác nhận nhập vào hệ thống** sau kiểm tra. Chờ thông báo đã có xác nhận trên máy chủ.

Nguồn **Danh sách kho / SaleWork** nhập tại **Đối soát hàng hoàn → Nhập dữ liệu**. Cần mã vận đơn hoặc mã đơn, ngày nhận thực tế; số lượng/SKU nếu có. Nhân viên trong file được giữ riêng với người nhập. Nếu chỉ có mã đơn hoặc SKU trùng nhiều dòng, hệ thống không tự đoán kiện/yêu cầu.

Mỗi file tối đa 10 MB / 50.000 dòng. Một lô lưu tối đa 100 nhóm / 2.000 dòng; một yêu cầu vượt 2.000 dòng cần xác minh cấu trúc. Cả file phải hết lỗi trước bắt đầu; khi xác nhận, các lô được ghi lần lượt và có checkpoint, không phải một giao dịch khổng lồ cho cả file.

Mất mạng: chọn lại **cùng file, kho, shop, sàn và ánh xạ**, đọc để tiếp tục ở phần đã ghi. Mất phản hồi lưu không đồng nghĩa thất bại: kiểm tra lịch sử hoặc thử xác nhận lại; không tạo trùng vì cùng thao tác. Bấm dừng chỉ dừng sau lô đang xử lý. Không xóa cache/localStorage trong lúc cần tiếp tục. File đã hoàn tất có thể nhập lại mà không tạo thêm hồ sơ.

## Nhận hoàn trước hoặc sau file

1. **Tít nhận hàng hoàn** → chọn kho và ca được phân công đang hoạt động. Quản lý có thể bấm mở ca cho mình.
2. Nếu hãng bàn giao theo đợt: chọn hãng đã xác minh, người giao, ghi chú → **Mở phiên bàn giao**. Có thể nhận riêng từng kiện nếu không dùng phiên.
3. Dùng HID + Enter/Tab, nhập tay hoặc camera. Chỉ coi thao tác có xác nhận máy chủ là đã lưu; lỗi mạng chưa có xác nhận thì thử lại cùng thao tác.
4. Mã chưa có nguồn vẫn vào sổ nhận. Sau xác nhận file, mã khớp chắc chắn được liên kết tự động, giữ giờ/người/ca ban đầu. Không cần tít lại.
5. Mã khớp nhiều yêu cầu cần quản lý xác minh hồ sơ, ghi chú tối thiểu 8 ký tự. Không chọn ngẫu nhiên. Có thể dùng **Đối soát hàng hoàn → Sổ nhận → Ghép dữ liệu**.
6. Đóng phiên sau kiểm đếm bàn giao. Xem lại phiên cũ, từng trang mã và bằng chứng trong lịch sử phiên. Xem phiên cũ không đổi phiên đang quét.

Ảnh JPEG/PNG/WebP, PDF, MP4/WebM tối đa 50 MB/tệp được lưu private. Có thể bổ sung biên bản/ảnh/video tại phiên hoặc hồ sơ. Camera quét cần trình duyệt cấp quyền camera/HTTPS; có thể dùng HID nếu camera không sẵn sàng.

## Kiểm hàng và xử lý

- Mở hồ sơ → chọn **Kiểm riêng kiện** đã nhận hoặc **Kiểm toàn bộ yêu cầu** → nhập lượng thực tế từng SKU, màu/size và tình trạng. SKU không có trong kiện ghi 0. Không mặc định lượng nguồn là lượng đã nhận. Chờ xác nhận lưu trước quét mã tiếp theo.
- Chọn nguyên vẹn/đủ/thiếu/sai/tráo/mất tag/đã dùng/bẩn/rách hoặc hỏng/thiếu phụ kiện/khác; thêm vị trí, ghi chú và bằng chứng.
- Có thể kiểm riêng kiện đã về dù còn kiện chưa nhận. Mỗi kiện lấy lần kiểm mới nhất của cùng bộ SKU/số lượng nguồn, không cộng lặp khi kiểm lại. Còn kiện chưa kiểm thì số đã đếm là một phần, chưa xác nhận đủ cả yêu cầu; chỉ hoàn tất khi đủ các kiện và mọi SKU khớp. Kiểm toàn yêu cầu vẫn cần nhận đủ kiện. Chỉ có mã đơn được ghép chắc chắn có thể kiểm khi có bằng chứng nhận dù chưa có vận đơn.
- Quản lý phân công từng hồ sơ hoặc chọn tối đa 50 trên trang để phân công hàng loạt. Dữ liệu đổi trong lúc mở phải tải lại; không ghi đè phiên bản mới.
- Nguồn thay đổi số lượng/SKU sau kiểm sẽ yêu cầu kiểm lại. Giữ nguyên lượng kiểm cũ và audit.
- Nếu trạng thái hủy/nguồn không xác định nghĩa vụ, quản lý xác minh **Nghĩa vụ nhận hàng** với lý do, hoặc chọn lại **Theo dữ liệu nguồn**. Nhập mới giữ quyết định thủ công; nguồn trái quyết định tạo cảnh báo.
- Tạo khiếu nại theo hồ sơ/kiện: loại, bên chịu trách nhiệm, hãng, người phụ trách, hạn, số tiền yêu cầu/chấp thuận/thực nhận và ngày thực nhận. Chấp thuận chưa đồng nghĩa đã nhận tiền. Ngày đóng hiển thị theo giờ Việt Nam.
- Hoàn tác nhận giữ lịch sử, bị chặn nếu đã có xử lý tiếp hoặc bằng chứng độc lập. Nhân viên chỉ được hoàn tác lượt của mình trong 10 phút.

## Dashboard và gửi hãng

Các KPI tính trên yêu cầu duy nhất và phạm vi lọc, không phải số lần quét. Có thể chọn riêng hai nghiệp vụ, ngày, kho, hãng, người nhận, khiếu nại, dán nguyên mã và mở hồ sơ xử lý ngay. Bấm số/nhóm để xem đúng tập dữ liệu. Nhóm biểu đồ chính loại trừ nhau; các KPI như đã nhận/có khiếu nại có thể giao nhau.

**Báo cáo & Xuất Excel → XUẤT DANH SÁCH CHƯA NHẬN – CẦN KIỂM TRA**: chọn hãng hoặc tất cả. Chỉ lấy tập cần tra soát, không tự đưa toàn bộ trung chuyển hoặc chỉ hoàn tiền vào file thiếu. Mỗi hãng có sheet, không tạo sheet rỗng; mã đơn/vận đơn/SKU là ô text thật, cột 14–18 tô vàng cho phản hồi. Giá trị cả đơn chỉ ghi một lần dù nhiều SKU. File không gồm địa chỉ/điện thoại/email khách.

Nguồn mã đã bị làm tròn/khoa học không được đoán phục hồi: lấy bản xuất gốc hoặc yêu cầu bên cung cấp dữ liệu text. Dùng máy tính/Chrome hoặc Edge mới cho báo cáo lớn.

## File sai

**Lịch sử nhập dữ liệu** giữ tên/loại/người/thời gian/số dòng/trạng thái và tệp gốc. Nhật ký nguồn chi tiết gồm dữ liệu trước nâng cấp.

Admin chọn đợt đã hoàn tất → **Loại bỏ** → ghi lý do và xác nhận. Đây là loại bỏ mềm, giữ nhận thực tế, kiểm, khiếu nại và lịch sử; có thể **Khôi phục**. Tác vụ chạy từng lô; nếu ngắt, dùng nút tiếp tục đúng thao tác.

Loại bỏ file kho chỉ rút bằng chứng/khẳng định lượng của file đó. Lượt quét và nguồn kho độc lập còn hiệu lực được giữ. Nếu file là bằng chứng nhận duy nhất nhưng đã có kiểm/khiếu nại, hệ thống chặn gỡ tự động để quản lý xác minh. Không dùng thao tác dọn dữ liệu cũ để xóa hồ sơ vĩnh viễn.
