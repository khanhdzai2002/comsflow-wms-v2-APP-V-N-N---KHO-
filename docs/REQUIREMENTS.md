> Tài liệu nghiệp vụ kế thừa. Cấu hình chạy và triển khai v2 dùng [Cloudflare + Supabase](DEPLOYMENT.md); các hướng dẫn hosting Railway/Next.js trong lịch sử không áp dụng cho dự án mới.

# MASTER PROMPT — BUILD COMS-FLOW WMS: OUTBOUND MANAGEMENT

## 1. Vai trò của bạn

Bạn là Senior Full-stack Engineer, Software Architect, Product Designer và chuyên gia thiết kế hệ thống Warehouse Management System (WMS) dành cho doanh nghiệp thương mại điện tử.

Nhiệm vụ của bạn là xây dựng một ứng dụng web hoàn chỉnh, có thể triển khai và sử dụng thực tế cho Công ty Cổ phần Coms-Flow, trước mắt phục vụ thương hiệu thời trang ComsMiu.

**Tên ứng dụng:** COMS-FLOW WMS

**Tên phân hệ:** Outbound Management – Quản lý đơn hàng xuất kho.

Đây là phần mềm vận hành nội bộ, không phải website bán hàng.

Tôi muốn bạn trực tiếp xây dựng source code, cơ sở dữ liệu, giao diện, chức năng xử lý, kiểm thử và hướng dẫn triển khai. Không được chỉ tạo bản mockup hoặc mô tả ý tưởng.

Nếu có repository hoặc source code hiện hữu, hãy kiểm tra trước và tận dụng những thành phần phù hợp.

---

## 2. Bối cảnh kinh doanh và mục tiêu

ComsMiu là thương hiệu thời trang kinh doanh chủ yếu qua:

- TikTok Shop
- Shopee
- Các kênh thương mại điện tử khác trong tương lai

Mỗi ngày kho phải xử lý nhiều đơn hàng và bàn giao cho các đơn vị vận chuyển như:

- SPX Express
- J&T Express
- GHN
- Viettel Post
- Các hãng khác có thể cấu hình thêm

Tôi cần hệ thống giúp theo dõi chính xác số lượng đơn hàng đã được nhân viên kho quét mã (gọi nội bộ là "tít đơn"), thời điểm quét, người thực hiện, đơn thuộc sàn nào, đơn vị vận chuyển nào, các đơn còn thiếu và tiến độ bàn giao.

**Mục tiêu trọng tâm:**

1. Quét đơn thật nhanh, chính xác và không đếm trùng.
2. Biết ngay đơn nào thuộc TikTok, Shopee và hãng vận chuyển nào.
3. Ghi nhận lịch sử quét chính xác theo từng nhân viên.
4. Quản lý số lượng đơn xuất kho theo thời gian thực.
5. Đối soát số đơn cần xuất và số đơn đã tít.
6. Phát hiện sai lệch, đơn lạ, đơn quét trùng.
7. Quản lý bàn giao cho từng đơn vị vận chuyển.
8. Có dashboard dành riêng cho quản lý kho và ban lãnh đạo.

Hệ thống phải được thiết kế để mở rộng về sau, không giới hạn ở quy mô vận hành hiện tại.

---

# PHẦN I — QUÉT MÃ VẬN ĐƠN

## 3. Hỗ trợ nhiều thiết bị quét

Xây dựng tính năng quét mã bằng ba phương thức.

### A. Quét bằng camera điện thoại

- Truy cập ứng dụng qua trình duyệt điện thoại.
- Bật camera sau để quét mã QR hoặc barcode trên tem vận đơn.
- Hỗ trợ định dạng QR Code, Code 128 và các định dạng vận đơn phổ biến phù hợp.
- Có khung định vị mã khi quét.
- Có thể bật đèn flash nếu thiết bị hỗ trợ.
- Tự động nhận diện và xử lý mã.
- Không cần chụp ảnh rồi tải lên.
- Tối ưu tốc độ đọc mã trong điều kiện kho.
- Hỗ trợ Android và iPhone trên các trình duyệt tương thích.
- Có cơ chế dự phòng nếu trình duyệt không hỗ trợ API quét mã mặc định.

### B. Quét bằng súng quét mã chuyên dụng

Hỗ trợ súng quét barcode/QR kết nối USB hoặc Bluetooth hoạt động ở chế độ bàn phím (HID Keyboard Wedge).

Yêu cầu:

- Cắm súng quét vào máy tính và có thể sử dụng ngay.
- Hỗ trợ thiết bị tự gửi Enter hoặc Tab sau khi quét.
- Sau mỗi lần quét, tự động sẵn sàng cho lần kế tiếp.
- Có ô nhập luôn sẵn sàng nhận dữ liệu.
- Không bắt nhân viên dùng chuột để xác nhận liên tục.
- Cho phép quét hàng trăm đơn liên tiếp.
- Xử lý dữ liệu quét nhanh và ổn định.
- Có khả năng xử lý luồng ký tự gửi rất nhanh từ súng.

### C. Nhập mã thủ công

Cho phép nhân viên nhập hoặc dán mã vận đơn khi tem khó quét.

Mọi phương thức phải sử dụng chung một hệ thống xác minh và ghi nhận đơn hàng.

## 4. Quy trình sau khi quét

Sau khi quét thành công một vận đơn, hệ thống phải truy xuất dữ liệu, xác minh và hiển thị:

- Mã vận đơn.
- Mã đơn hàng trên sàn.
- Sàn bán hàng: Shopee, TikTok...
- Gian hàng/shop nếu có nhiều tài khoản bán.
- Đơn vị vận chuyển.
- Tên sản phẩm, SKU, màu, size, số lượng (nếu có trong dữ liệu nguồn).
- Trạng thái đơn hàng hiện tại.
- Nhân viên thực hiện thao tác quét.
- Kho xử lý.
- Ngày quét.
- Giờ, phút, giây quét.
- Ca làm việc.
- Thiết bị hoặc phương thức quét.

Ghi nhận thời gian từ máy chủ, lưu chuẩn UTC và hiển thị theo múi giờ Asia/Ho_Chi_Minh (UTC+7).

Mỗi sự kiện quét phải có mã định danh riêng.

Ví dụ giao diện kết quả:

QUÉT ĐƠN THÀNH CÔNG

Mã vận đơn: SPXVN123456789

Sàn: SHOPEE

Đơn vị vận chuyển: SPX EXPRESS

Nhân viên: Nguyễn Văn A

Thời gian: 18/10/2026 – 14:32:08

Trạng thái: ĐÃ TÍT ĐƠN

Đồng thời cập nhật dashboard ngay sau khi máy chủ xác nhận lưu thành công.

## 5. Chống quét trùng

Đây là tính năng bắt buộc, ưu tiên rất cao.

Ví dụ một mã vận đơn đã được quét lúc 14:32:08.

Khi nhân viên khác quét lại cùng mã:

- Không được tăng tổng đơn thành công.
- Hiển thị cảnh báo: "ĐƠN NÀY ĐÃ ĐƯỢC QUÉT".
- Hiện rõ giờ quét lần đầu.
- Hiện tên nhân viên đã quét lần đầu.
- Ghi nhận lượt quét trùng vào nhật ký kiểm soát.
- Phát âm thanh cảnh báo khác với âm thanh quét thành công.

Hệ thống phải chống trùng ngay cả khi hai nhân viên sử dụng hai thiết bị khác nhau quét gần như đồng thời.

Áp dụng kiểm soát ở tầng cơ sở dữ liệu và xử lý giao dịch, không chỉ kiểm tra bằng giao diện.

Phân biệt số lần quét với số vận đơn duy nhất đã quét thành công.

## 6. Xử lý tình huống bất thường

Phải có những tình huống sau:

**Trường hợp 1: Quét đơn chưa tồn tại trong dữ liệu**

- Hiển thị cảnh báo màu đỏ/cam.
- Lưu mã thô đã quét vào danh sách cần đối soát.
- Không tự xác nhận đơn xuất kho thành công.
- Cho phép quản lý kiểm tra, đối chiếu và xử lý.

**Trường hợp 2: Quét mã không hợp lệ**

- Hiện thông báo lỗi rõ ràng.
- Cho phép quét tiếp ngay.

**Trường hợp 3: Đơn đã hủy hoặc không đủ điều kiện xuất kho**

- Hiển thị tình trạng.
- Chặn ghi nhận xuất kho thành công.
- Chuyển vào danh sách ngoại lệ.

**Trường hợp 4: Thông tin hãng vận chuyển không khớp**

- Hiển thị cảnh báo.
- Không âm thầm thay đổi dữ liệu.
- Có thể chuyển quản lý xác nhận.

**Trường hợp 5: Mất kết nối mạng**

- Thông báo trạng thái kết nối.
- Không hiển thị thành công khi máy chủ chưa xác nhận.
- Có thể lưu tạm sự kiện chờ đồng bộ với trạng thái rõ ràng nếu triển khai chế độ offline.
- Khi có mạng trở lại, đồng bộ theo cơ chế chống trùng.

## 7. Phản hồi trực quan khi quét

Giao diện quét cần có:

- Màu xanh lá khi thành công.
- Màu đỏ khi lỗi hoặc quét trùng.
- Màu vàng/cam khi đơn cần kiểm tra.
- Âm thanh phân biệt thành công và thất bại.
- Rung điện thoại nếu thiết bị hỗ trợ.
- Hiển thị mã vừa quét thật lớn.
- Hiển thị bộ đếm số đơn đã quét trong ca.
- Lịch sử 10 lần quét gần nhất.

Cho phép bật/tắt âm thanh và rung trong phần cấu hình.

Ưu tiên giao diện cực kỳ đơn giản để nhân viên kho thao tác nhanh.

---

# PHẦN II — NHẬN DIỆN ĐƠN HÀNG VÀ DỮ LIỆU SÀN

## 8. Nhận diện TikTok, Shopee và đơn vị vận chuyển

Hệ thống cần một bộ máy nhận diện mã vận đơn có thể cấu hình.

Ưu tiên theo thứ tự:

1. Khớp chính xác mã vận đơn với dữ liệu đã nhập từ sàn.
2. Lấy thông tin sàn, shop và đơn vị vận chuyển từ bản ghi đã được đối soát.
3. Phân tích cấu trúc mã QR/barcode nếu mã chứa thông tin phù hợp.
4. Áp dụng quy tắc tiền tố mã đã được cấu hình để đưa ra gợi ý khi chưa có dữ liệu đầy đủ.
5. Nếu không đủ căn cứ, hiển thị "Chưa xác định" và chuyển đối soát.

Ví dụ quy tắc nội bộ ban đầu để quản trị viên kiểm tra và cấu hình:

- Mã bắt đầu bằng SPXVN: gợi ý Shopee / SPX.
- Mã bắt đầu bằng 86: gợi ý TikTok / J&T.

Các quy tắc này chỉ là cấu hình tham khảo, không phải quy luật tuyệt đối.

**Quan trọng:** Không được giả định chỉ cần quét QR là luôn lấy được toàn bộ thông tin đơn hàng từ TikTok hoặc Shopee.

Nếu barcode chỉ chứa mã vận đơn, phải sử dụng mã đó để tra cứu thông tin trong dữ liệu đã nhập.

Không được tự bịa thông tin người mua, hãng vận chuyển hoặc tên sản phẩm.

## 9. Nhập dữ liệu đơn hàng từ Excel/CSV

Xây dựng module "Nhập dữ liệu đơn hàng".

Hỗ trợ:

- Upload Excel (.xlsx).
- Upload CSV.
- Nhập danh sách TikTok Shop.
- Nhập danh sách Shopee.
- Nhập nhiều file trong cùng một ngày.
- Kéo thả file.
- Xem trước dữ liệu.
- Cấu hình ánh xạ tên cột.
- Lưu template nhập liệu cho từng sàn.
- Hiển thị số dòng hợp lệ, thiếu dữ liệu, trùng và lỗi.
- Cho phép tải danh sách lỗi.

Dữ liệu nên hỗ trợ:

- Mã đơn hàng.
- Mã vận đơn.
- Sàn.
- Shop/gian hàng.
- Đơn vị vận chuyển.
- Ngày tạo đơn.
- Ngày cần xuất.
- Trạng thái đơn.
- SKU.
- Tên sản phẩm.
- Phân loại màu và size.
- Số lượng sản phẩm.
- Kho xử lý.

Xử lý đúng trường hợp một đơn có nhiều dòng sản phẩm hoặc nhiều kiện hàng.

Không được nhầm số dòng Excel, số đơn hàng và số kiện/vận đơn.

Nếu nhập lại dữ liệu của một đơn đã tồn tại:

- Không tạo bản ghi trùng.
- Cập nhật các trường được phép.
- Giữ nguyên lịch sử quét và bàn giao.
- Ghi nhận nhật ký nhập dữ liệu.

Tạo dữ liệu demo để kiểm thử khi chưa có file thật.

Trong phiên bản đầu tiên, phải vận hành được bằng Excel/CSV mà không phụ thuộc API chính thức của sàn.

Thiết kế lớp tích hợp để có thể bổ sung API hoặc cơ chế đồng bộ hợp lệ sau này nếu được cấp quyền.

---

# PHẦN III — QUẢN LÝ TRẠNG THÁI XUẤT KHO

## 10. Các trạng thái vận đơn

Thiết kế vòng đời vận đơn gồm:

1. CHỜ XỬ LÝ
2. CHỜ QUÉT
3. ĐÃ TÍT ĐƠN
4. CHỜ BÀN GIAO
5. ĐÃ BÀN GIAO ĐVVC

Ngoài ra có trạng thái ngoại lệ:

- Đơn hủy.
- Đơn cần kiểm tra.
- Đơn quét không xác định.
- Đơn bị chặn xuất kho.

Cần phân biệt rõ:

**Đã tít đơn** là đã được hệ thống ghi nhận quét tại kho.

**Đã bàn giao ĐVVC** là đã được xác nhận bàn giao thực tế cho đơn vị vận chuyển.

Hai trạng thái này không đồng nghĩa.

Không được tự động chuyển một đơn sang "Đã bàn giao" chỉ vì nhân viên đã quét mã.

## 11. Quản lý bàn giao vận chuyển

Xây dựng module bàn giao theo từng hãng.

Ví dụ:

Ngày 18/10/2026

- SPX: 520 đơn
- J&T: 410 đơn
- GHN: 225 đơn
- Viettel Post: 113 đơn

Cho phép:

- Lọc những đơn đã tít nhưng chưa bàn giao.
- Chọn hãng vận chuyển.
- Tạo phiếu bàn giao.
- Thêm các vận đơn vào phiếu.
- Ghi nhận nhân viên bàn giao.
- Thời gian bàn giao.
- Số lượng kiện.
- Trạng thái phiếu.
- Ghi chú sai lệch.
- Xuất Excel/CSV danh sách bàn giao.

Có thể bổ sung mã phiếu bàn giao để đối chiếu.

Chỉ xác nhận các đơn đã bàn giao khi có thao tác xác nhận hợp lệ từ người được phân quyền.

Nếu chưa có dữ liệu xác nhận từ phía hãng vận chuyển, hãy hiển thị rõ đây là ghi nhận bàn giao nội bộ, không phải xác nhận giao nhận chính thức của hãng.

---

# PHẦN IV — DASHBOARD QUẢN TRỊ XUẤT KHO

## 12. Dashboard tổng quan

Thiết kế một dashboard chuyên nghiệp, hiện đại, có thể xem trên máy tính, máy tính bảng và điện thoại.

Phong cách như phần mềm ERP/WMS doanh nghiệp.

Màu sắc nhận diện:

- Cam: màu điểm nhấn Coms-Flow.
- Đen/xám đậm: nội dung chính.
- Trắng/xám nhạt: nền.
- Xanh lá: thành công.
- Đỏ: cảnh báo.
- Vàng/cam nhạt: cần kiểm tra.

### Nhóm KPI 1: Tổng quan xuất kho

Hiển thị các thẻ KPI:

1. Tổng số vận đơn dự kiến xuất kho.
2. Tổng số vận đơn đã tít thành công.
3. Số vận đơn chưa tít.
4. Số vận đơn đang chờ bàn giao.
5. Số vận đơn đã bàn giao.
6. Tỷ lệ hoàn thành quét.
7. Tỷ lệ hoàn thành bàn giao.
8. Số vận đơn ngoại lệ.

Tỷ lệ hoàn thành quét = Số vận đơn duy nhất tít thành công / Số vận đơn hợp lệ dự kiến phải quét.

Nếu chưa có đủ dữ liệu đơn dự kiến thì hiển thị "Chưa đủ dữ liệu", không tự tính tỷ lệ giả.

### Nhóm KPI 2: Theo sàn thương mại điện tử

Hiển thị:

- Số đơn Shopee.
- Số đơn TikTok Shop.
- Tổng đơn theo từng sàn.
- Số đã quét.
- Số chưa quét.
- Số đã bàn giao.
- Tỷ trọng từng sàn.
- Tỷ lệ hoàn thành từng sàn.

Có biểu đồ so sánh dạng cột hoặc thanh ngang.

### Nhóm KPI 3: Theo đơn vị vận chuyển

Theo dõi:

- SPX Express.
- J&T Express.
- GHN.
- Viettel Post.
- Các hãng khác.

Với từng hãng, hiển thị:

- Tổng số vận đơn dự kiến.
- Số đã tít.
- Số chưa tít.
- Số đã bàn giao.
- Số chờ bàn giao.
- Số đơn ngoại lệ.

Hỗ trợ biểu đồ cơ cấu và bảng so sánh.

### Nhóm KPI 4: Năng suất nhân viên kho

Thống kê theo từng nhân viên:

- Tổng số vận đơn quét thành công.
- Số lần quét trùng.
- Số trường hợp quét lỗi.
- Số đơn theo từng ca.
- Số đơn theo từng giờ.
- Đơn vị vận chuyển đã xử lý.
- Thời điểm bắt đầu và kết thúc ca.
- Năng suất quét theo giờ làm việc thực tế khi có đủ dữ liệu.

Có bảng xếp hạng năng suất, nhưng phải loại trừ lượt quét trùng và các bản ghi chưa được xác nhận.

### Nhóm KPI 5: Biểu đồ theo thời gian

Xây dựng biểu đồ số lượng đơn đã tít theo:

- Từng giờ trong ngày.
- Từng ngày.
- Từng tuần.
- Từng tháng.

Cho phép so sánh số đơn dự kiến và số đơn thực tế đã tít.

Hiển thị khung giờ cao điểm và tốc độ quét đơn.

### Nhóm KPI 6: Cảnh báo vận hành

Tạo khu vực cảnh báo riêng gồm:

- Đơn chưa tít.
- Đơn quét trùng.
- Đơn không tìm thấy trong dữ liệu nguồn.
- Đơn bị hủy nhưng vẫn được mang đi quét.
- Đơn sai thông tin vận chuyển.
- Đơn đã tít nhưng chưa bàn giao.
- Những lô đơn còn tồn chưa xử lý sau mốc thời gian cấu hình.

Có thể nhấn vào từng chỉ số để mở danh sách chi tiết và xử lý.

## 13. Bộ lọc Dashboard

Cho phép lọc theo:

- Hôm nay.
- Hôm qua.
- 7 ngày.
- 30 ngày.
- Khoảng ngày tùy chỉnh.
- Sàn bán hàng.
- Gian hàng.
- Đơn vị vận chuyển.
- Nhân viên.
- Ca làm việc.
- Trạng thái vận đơn.
- Kho.

Bộ lọc cần áp dụng thống nhất cho các KPI và biểu đồ liên quan.

Hỗ trợ refresh tự động hoặc cập nhật realtime khi phát sinh lượt quét mới.

Có nút xuất báo cáo Excel.

---

# PHẦN V — DANH SÁCH ĐƠN VÀ ĐỐI SOÁT

## 14. Màn hình quản lý vận đơn

Thiết kế bảng dữ liệu với những cột:

- STT
- Mã vận đơn
- Mã đơn hàng
- Sàn bán
- Gian hàng
- Đơn vị vận chuyển
- Trạng thái
- Thời gian tít
- Nhân viên tít
- Thời gian bàn giao
- Nhân viên bàn giao
- Ca làm việc
- Ghi chú

Chức năng:

- Tìm kiếm nhanh theo mã đơn hoặc vận đơn.
- Lọc theo trạng thái.
- Sắp xếp các cột.
- Chọn khoảng thời gian.
- Xem chi tiết đơn.
- Phân trang hoặc cuộn dữ liệu hiệu quả.
- Xuất Excel/CSV.

Nhấn vào vận đơn sẽ mở trang chi tiết với toàn bộ lịch sử liên quan.

## 15. Module đối soát

Thiết kế ba danh sách quan trọng:

**A. Đơn có trong danh sách dự kiến nhưng chưa được tít**

Giúp quản lý biết những đơn nào còn nằm ở kho hoặc chưa được nhân viên xử lý.

**B. Đơn đã tít nhưng chưa được bàn giao**

Giúp kiểm tra tồn đọng giữa khâu quét và bàn giao vận chuyển.

**C. Đơn được quét nhưng chưa có trong nguồn dữ liệu**

Giúp kiểm tra lỗi dữ liệu hoặc các kiện không xác định.

Cho phép tải từng danh sách ra Excel.

Không được âm thầm bỏ qua các đơn không khớp.

---

# PHẦN VI — TÀI KHOẢN VÀ PHÂN QUYỀN

## 16. Quản lý người dùng

Thiết kế các vai trò:

### Admin

- Quản lý toàn hệ thống.
- Quản lý tài khoản.
- Cấu hình hãng vận chuyển.
- Cấu hình sàn bán hàng.
- Cấu hình mapping mã vận đơn.
- Xem toàn bộ dashboard.
- Quản lý nhập dữ liệu.
- Điều chỉnh trạng thái khi có lý do hợp lệ.
- Xem lịch sử thao tác.

### Warehouse Manager

- Xem dashboard.
- Quản lý ca.
- Đối soát đơn.
- Tạo và xác nhận bàn giao.
- Xem năng suất nhân viên.
- Xử lý ngoại lệ theo phân quyền.

### Warehouse Staff

- Đăng nhập.
- Chọn ca làm việc.
- Quét đơn.
- Xem kết quả vừa quét.
- Xem số lượng quét của bản thân.
- Không thể xóa lịch sử quét hoặc chỉnh dữ liệu đã được xác nhận.

Mọi thay đổi quan trọng phải được ghi nhật ký với người thực hiện, thời gian, giá trị trước/sau và lý do.

---

# PHẦN VII — GIAO DIỆN ỨNG DỤNG

## 17. Thiết kế UI/UX

Thiết kế ứng dụng dạng ERP dashboard.

Sidebar gồm:

1. Dashboard
2. Quét vận đơn
3. Danh sách vận đơn
4. Đối soát xuất kho
5. Bàn giao vận chuyển
6. Báo cáo & Thống kê
7. Nhập dữ liệu
8. Nhân viên & Ca làm việc
9. Cấu hình hệ thống

Giao diện tiếng Việt, thuật ngữ dễ hiểu với nhân viên kho.

### Màn hình quét trên máy tính

Ưu tiên:

- Ô quét mã lớn.
- Kết quả quét cực kỳ rõ ràng.
- Bộ đếm số đơn đã tít.
- Thông tin sàn và đơn vị vận chuyển.
- Danh sách đơn quét gần nhất.
- Không yêu cầu nhiều thao tác phụ.

### Màn hình quét trên điện thoại

- Mobile first.
- Nút mở camera lớn.
- Camera chiếm diện tích đủ để quét thuận tiện.
- Hiển thị trạng thái quét bằng màu sắc dễ nhận biết.
- Hiển thị thông tin đơn ngay sau quét.
- Có nút xem dashboard đơn giản.
- Không cần zoom hoặc cuộn ngang.

Tạo trải nghiệm dạng PWA để có thể thêm ứng dụng vào màn hình chính của điện thoại.

Ưu tiên chức năng thực tế, tốc độ và sự ổn định hơn các hiệu ứng trang trí phức tạp.

---

# PHẦN VIII — CƠ SỞ DỮ LIỆU VÀ CÔNG NGHỆ

## 18. Công nghệ đề xuất

Nếu bắt đầu dự án mới, ưu tiên:

- Frontend: Next.js + React + TypeScript.
- UI: Tailwind CSS + shadcn/ui.
- Backend: API server-side phù hợp với Next.js.
- Database: PostgreSQL thông qua Supabase.
- Authentication: Supabase Auth hoặc giải pháp tương đương.
- Realtime: Supabase Realtime hoặc giải pháp phù hợp.
- Charts: Recharts.
- Import Excel: thư viện xử lý XLSX/CSV có kiểm tra dữ liệu.
- Camera scanning: thư viện quét QR/barcode đa trình duyệt có cơ chế fallback.
- Hosting: Vercel hoặc giải pháp tương đương hỗ trợ HTTPS.
- PWA: hỗ trợ trải nghiệm cài trên điện thoại.

Không phụ thuộc vào domain comsmiu.vn.

Nếu repository đã sử dụng stack khác hợp lý, có thể kế thừa thay vì viết lại toàn bộ.

## 19. Thiết kế database

Tạo cấu trúc dữ liệu chuẩn hóa với các thực thể tối thiểu:

- users
- warehouses
- sales_channels
- shops
- shipping_carriers
- orders
- order_items
- shipments
- scan_events
- work_shifts
- import_batches
- import_errors
- handover_batches
- handover_items
- carrier_matching_rules
- exception_cases
- audit_logs
- system_settings

Thiết kế quan hệ rõ ràng giữa đơn hàng, sản phẩm, kiện hàng và vận đơn.

Hỗ trợ một đơn có nhiều kiện.

Một đơn hoặc một kiện không được tăng số lượng thành công nhiều lần do quét trùng.

Thực hiện:

- Migration database.
- Foreign keys.
- Unique constraints.
- Index các trường truy vấn quan trọng.
- Transaction xử lý sự kiện quét.
- Phân quyền truy cập dữ liệu.
- Chống race condition khi nhiều nhân viên cùng quét.
- Cơ chế phục hồi lỗi.
- Ghi nhật ký thao tác.

Không xóa cứng lịch sử quét khi quản lý điều chỉnh trạng thái. Sử dụng bản ghi điều chỉnh có kiểm soát.

## 20. Bảo mật và dữ liệu

- Chỉ người có tài khoản được phân quyền mới sử dụng được.
- Không để API key bí mật ở frontend.
- Không lưu mật khẩu dưới dạng văn bản thường.
- Kiểm tra file upload.
- Không tin tưởng dữ liệu gửi trực tiếp từ client.
- Có Row Level Security hoặc kiểm soát phân quyền tương đương.
- Hạn chế hiển thị dữ liệu cá nhân người mua nếu không cần thiết.
- Có cơ chế sao lưu và khôi phục dữ liệu.
- Lưu timestamp chuẩn trên server.

---

# PHẦN IX — YÊU CẦU KIỂM THỬ

## 21. Các kịch bản bắt buộc

Kiểm thử tối thiểu:

1. Import file Shopee thành công.
2. Import file TikTok thành công.
3. Import lại file không tạo đơn trùng.
4. Quét mã Shopee hiển thị đúng dữ liệu.
5. Quét mã TikTok hiển thị đúng dữ liệu.
6. Quét lại cùng một mã không tăng tổng đơn.
7. Hai thiết bị quét đồng thời không đếm trùng.
8. Quét mã không tồn tại chuyển vào danh sách ngoại lệ.
9. Đơn đã hủy không được đánh dấu quét hợp lệ.
10. Tít đơn xong không tự động được đánh dấu bàn giao.
11. Bàn giao đúng hãng cập nhật trạng thái.
12. Dashboard cập nhật đúng sau khi quét.
13. Bộ lọc theo hãng và sàn hoạt động chính xác.
14. Báo cáo Excel xuất đúng số liệu.
15. Tài khoản nhân viên không truy cập được chức năng Admin.
16. Quét camera trên điện thoại tương thích.
17. Quét bằng thiết bị HID có Enter hoạt động.
18. Thời gian hiển thị đúng giờ Việt Nam.
19. Mất mạng không phát sinh ghi nhận thành công giả.
20. Lịch sử thao tác vẫn được bảo toàn sau chỉnh sửa.

Viết kiểm thử tự động cho các logic quan trọng, đặc biệt là chống trùng, đối soát, nhập dữ liệu, phân quyền và số liệu dashboard.

---

# PHẦN X — THỨ TỰ XÂY DỰNG

## 22. Giai đoạn 1: MVP phải sử dụng được

Ưu tiên xây dựng các chức năng:

1. Đăng nhập và phân quyền cơ bản.
2. Cơ sở dữ liệu đơn hàng.
3. Nhập đơn hàng từ Excel/CSV.
4. Quét bằng súng quét USB/Bluetooth.
5. Quét bằng camera điện thoại.
6. Nhận diện và hiển thị đơn.
7. Ghi nhận thời gian, nhân viên tít.
8. Chống quét trùng.
9. Dashboard realtime.
10. Danh sách đã tít và chưa tít.
11. Danh sách lỗi cần đối soát.
12. Export báo cáo Excel/CSV.

MVP phải có backend/database thực và dữ liệu được lưu bền vững.

## 23. Giai đoạn 2: Vận hành nâng cao

Sau khi hoàn thiện MVP:

- Phiếu bàn giao vận chuyển.
- Đối soát số đã tít và số bàn giao.
- Năng suất chi tiết từng nhân viên.
- Cấu hình ca làm việc.
- Dashboard nâng cao.
- Cảnh báo tiến độ.
- Hỗ trợ mất mạng và đồng bộ an toàn.
- Cấu hình nhiều shop, nhiều kho.
- Tối ưu hiệu năng khi nhiều thiết bị quét đồng thời.
- Chuẩn bị khả năng kết nối API hoặc LarkSuite về sau.

Thiết kế kiến trúc ngay từ đầu để hỗ trợ các chức năng này mà không phải xây lại hệ thống.

---

# PHẦN XI — YÊU CẦU BÀN GIAO TỪ CODEX

Tôi muốn bạn thực hiện công việc như một kỹ sư phát triển phần mềm thực tế.

Hãy:

1. Kiểm tra codebase hiện có hoặc khởi tạo dự án mới.
2. Đề xuất kiến trúc ngắn gọn.
3. Thiết kế database và migrations.
4. Xây dựng backend và frontend.
5. Kết nối API và database thật.
6. Xây dựng giao diện responsive.
7. Tạo dữ liệu demo thực tế cho TikTok, Shopee và nhiều hãng vận chuyển.
8. Cung cấp file Excel/CSV mẫu.
9. Viết các bài test cần thiết.
10. Chạy build, lint, test và sửa lỗi được phát hiện.
11. Tạo README hướng dẫn cài đặt và sử dụng.
12. Tạo `.env.example` mô tả các biến môi trường cần cung cấp.
13. Hướng dẫn triển khai lên hosting HTTPS độc lập.
14. Nêu rõ phần nào đã hoạt động và phần nào cần cấu hình thêm để dùng dữ liệu thật.

**Yêu cầu cuối cùng:**

- Không dừng ở mockup.
- Không sử dụng dữ liệu giả làm dữ liệu sản xuất thật.
- Không tạo dashboard có số liệu hardcode.
- Không yêu cầu kết nối API TikTok/Shopee để MVP hoạt động.
- Không tự động ghi nhận bàn giao nếu chỉ mới quét.
- Không được bỏ qua tính năng chống trùng.
- Không được bỏ qua timestamp chính xác.
- Không thay thế phần mềm vận hành thật bằng prototype frontend đơn thuần.

Nếu thiếu thông tin cấu hình thực tế, hãy dùng cấu hình có thể thay đổi và dữ liệu demo rõ ràng, tiếp tục xây dựng những phần không bị phụ thuộc.

Hãy bắt đầu từ kiến trúc, dữ liệu và luồng quét; sau đó triển khai MVP hoàn chỉnh có thể chạy thử ngay.
