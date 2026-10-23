> Tài liệu nghiệp vụ kế thừa. Cấu hình chạy và triển khai v2 dùng [Cloudflare + Supabase](DEPLOYMENT.md); các hướng dẫn hosting Railway/Next.js trong lịch sử không áp dụng cho dự án mới.

# Quản lý đơn hoàn

Module dùng PostgreSQL và đăng nhập hiện có, nằm trong menu **Quản lý đơn hoàn**. Dữ liệu nhận hoàn tách khỏi orders/shipments/scan xuất kho. Không có thao tác tự cộng tồn bán được.

## Nhận biết màn hình và nhập file

- Mục chính có vạch cam ở menu; mục con đang mở có nền cam, dấu chọn và dòng **Bạn đang ở**. Từng mục con có biểu tượng và mô tả; dùng phím mũi tên, Home/End để chuyển tab.
- **Nhập dữ liệu** tách hai tab **PDF tem vận đơn** và **Excel / CSV đơn hàng**. File hoàn có nút mở module riêng. Loại file được giữ trong URL khi F5; đổi tab PDF/Excel giữ file đã chọn trong phiên đang mở.
- Biểu mẫu đơn hoàn chia thành thông tin shop/kho/sàn, khu chọn file, kiểm tra và xác nhận lưu. File được chọn hiện tên, dung lượng và nút **Bỏ file**; có kéo thả. Bỏ/chọn lại file xóa kết quả xem trước cũ.
- Cam = mục đang mở; xanh dương = kiểm tra/chưa lưu; xanh lá = máy chủ đã xác nhận lưu; vàng = cảnh báo; đỏ = lỗi cần xử lý. File mới chọn chưa được coi là đã kiểm tra hay đã lưu. Dấu trạng thái và chữ đi kèm giúp nhận biết mà không chỉ dựa vào màu.

## Quy trình vận hành

Admin/Quản lý có thể mở biểu mẫu từ **Nhập dữ liệu → Nhập dữ liệu đơn hoàn**,
hoặc **Quản lý đơn hoàn → Nhập dữ liệu đơn hoàn** (tab hoặc nút đầu trang).
Liên kết **`/#returns/import`** mở thẳng biểu mẫu sau đăng nhập. URL giữ mục/tab
khi F5 và khi dùng nút Quay lại/Tiến trong trình duyệt. Tài khoản Nhân viên mở
liên kết nhập sẽ chỉ vào màn nhận kiện; API nhập vẫn cần quyền Admin/Quản lý.

1. Admin/Quản lý mở **Nhập dữ liệu đơn hoàn**, chọn đúng shop và kho, tải XLSX/CSV, bấm **Đọc và đối chiếu**. Xem số dòng/yêu cầu/đơn/mã vận đơn/sản phẩm, cảnh báo, lỗi và thay đổi cũ → mới. Thiếu vận đơn hoặc Seller SKU là cảnh báo; mâu thuẫn danh tính là lỗi. File có lỗi chưa được lưu một phần; tải CSV lỗi để xử lý.
2. Xác nhận lưu. Nguồn giữ toàn bộ cột gốc và vị trí dòng, hash và người nhập. Cùng file/cùng shop mở kết quả cũ; chọn kho khác bị chặn. File mới cập nhật nguồn sàn, giữ nhận kiện/kiểm hàng/ghi chú/khiếu nại. SKU không xuất hiện trong file sau không tự bị xóa. Thông tin sản phẩm/số lượng hoặc mã kiện đổi sau kiểm làm hồ sơ cần kiểm lại; đổi trạng thái sàn đơn thuần không xóa kết quả kiểm.
3. Nhân viên chọn **Quét mã hoàn kho**, đúng kho và ca đang được phân công. Có nhập tay, HID Enter/Tab và camera HTTPS. Quét chỉ xác nhận nhận kiện. Mã trùng hiện người/giờ trước; không tăng nhận. Mã lạ/mã khớp nhiều hồ sơ được ghi nhật ký; nhiều kết quả phải chọn đúng shop/yêu cầu/kiện. Chưa có xác nhận server thì không hiển thị thành công; gửi lại cùng thao tác dùng lại request ID.
4. Mở hồ sơ, nhập thực nhận từng SKU và tình trạng. Không điền sẵn bằng số nguồn. Nhận đủ cần đúng số lượng mọi SKU và tất cả kiện đang khai báo đã nhận. Nhận thiếu/sai/hư hỏng/rỗng là kết quả riêng. Lưu vị trí và lý do. Nguồn sàn có Refund Time/Completed/Delivered không thay thế bước này.
5. Quản lý phân công, nhập ngày dự kiến, xác minh hãng hoặc bổ sung/loại bỏ/khôi phục mã sai có lý do. Không loại bỏ kiện đã nhận. Hoàn tác nhận chỉ trước thao tác xử lý tiếp theo; staff chỉ lượt của mình trong 10 phút. Sự kiện cũ vẫn được giữ.
6. Tạo/cập nhật nhiều hồ sơ khiếu nại trên một yêu cầu, số tiền yêu cầu/được duyệt/thực nhận và ngày nhận. Thực nhận phải có ngày; trạng thái thành công chưa được coi là đã nhận tiền. Có đính kèm PNG/JPEG/PDF tối đa 5 MB/file, 20 file/yêu cầu, lưu bền vững trong PostgreSQL, tải qua API yêu cầu đăng nhập.
7. Hoàn thành chỉ khi kiểm đủ mới nhất hoặc quản lý xác minh không cần trả vật lý, và không còn hồ sơ open/submitted/won chưa kết thúc. Xác nhận mất cần Quản lý/Admin và lý do. Quá mốc theo dõi chỉ cảnh báo, không tự kết luận mất.
8. Dùng Dashboard/Danh sách/Khiếu nại/Lịch sử & đối soát, lọc loại ngày/sàn/shop/kho/trạng thái/đa mã. Phân trang 50 yêu cầu; KPI, tìm kiếm và xuất Excel/CSV lấy cùng tập lọc, tối đa 10.000 yêu cầu mỗi lần xuất. Các thẻ đếm phân biệt đơn gốc, yêu cầu, liên kết kiện/yêu cầu, mã vận đơn khác nhau và sản phẩm.

## Nhận diện file và giới hạn dữ liệu

File TikTok thực tế được kiểm tra có 25 cột, 106 yêu cầu, 101 đơn gốc, 89 mã hoàn và 109 sản phẩm yêu cầu; 17 dòng chưa có vận đơn và 66 dòng thiếu Seller SKU vẫn hợp lệ. Các row XML lặp từng ô được ghép theo địa chỉ A2/B2…, không tin dimension A1. ID 18/19 chữ số giữ text. Ngày text dd/MM/yyyy HH:mm:ss được áp dụng UTC+7; không suy ngày yêu cầu từ tên file. Tiền 185.540₫ được đọc 185540 VND; không tự lấy đơn giá × số lượng làm tiền thực hoàn.

Chưa có file đơn hoàn Shopee gốc để xác minh tự nhận diện. Có chọn sàn và ánh xạ tên cột bằng form; phải đủ trường nhận diện và cùng kiểu dữ liệu đã công bố. Không tuyên bố mọi file xuất Shopee đã tự đọc đúng. Không đoán hãng từ mã 85416/VTPVN; hãng chờ người có dữ liệu xác minh.

Tối đa 5 MB/file, 10.000 dòng và 80 cột; XLSX giải nén tối đa 30 MB, cấm DTD và công thức, phát hiện ô cùng địa chỉ có giá trị mâu thuẫn. Chỉ đọc sheet đầu. Các dòng trùng SKU mơ hồ trong cùng yêu cầu bị báo lỗi, không tự cộng hoặc xóa. Một yêu cầu có nhiều SKU/kiện được lưu bằng bảng con; cùng mã vận đơn ở nhiều hồ sơ không bị gộp tùy tiện.

Mốc theo dõi mặc định 5 ngày, chỉnh 1–90 ngày. Nếu có ngày dự kiến do quản lý nhập thì ưu tiên; nếu thiếu dùng ngày yêu cầu + số ngày tham khảo. Biểu đồ theo nhóm ngày yêu cầu và trạng thái hiện tại, không phải dòng tiền hay lượt nhận phát sinh trong ngày. Không cộng lẫn tiền đơn gốc giữa nhiều yêu cầu hoàn. Các cột tranh chấp/bồi thường rỗng được giữ nguyên, không suy là đã/chưa bồi thường. Tài chính Dashboard là tổng hồ sơ bồi thường nội bộ đã nhập, không phải khoản tiền thực hoàn suy từ file.

Đợt này chưa có đồng bộ trực tiếp API sàn, hàng đợi offline, tự phân rã combo khi chưa có mapping, hoặc video evidence. Lịch sử hiển thị 20 thao tác gần nhất của người đang đăng nhập; chi tiết mỗi yêu cầu có 200 sự kiện gần nhất, dữ liệu cũ vẫn giữ trong DB. Những tính năng này không được trình bày như đã hoạt động.

## Lưu trữ, phân quyền và triển khai

Migration **010_return_management.sql** thêm các bảng imports/cases/items/parcels/snapshots/events/claims/evidence, bật RLS và chặn vai trò trình duyệt truy cập bảng. Imports/snapshots/events/evidence append-only bằng trigger. Import có advisory lock; receive/inspect/undo/update khóa parent case; request ID chống retry; inspect/update có kiểm tra phiên bản để chặn dùng dữ liệu cũ. Claim có lock và lịch sử trước/sau. File được đọc lại trên server lúc commit.

Staff được xem/nhận/kiểm/ghi chú/thêm bằng chứng. Nhận kiện đòi ca đúng kho và phân công còn hiệu lực. Import/xuất báo cáo/đổi trạng thái quan trọng/kết luận mất/khiếu nại/đổi mã và hãng/chỉnh cảnh báo cần Admin/Quản lý. Tiếp tục dùng Origin/session guards của API.

Railway giữ **Pre-deploy Command `npm run db:migrate`**, Build `npm run build`, Start `npm start`. Dependency trực tiếp saxes được ghi vào package.json và lockfile, cài bằng npm ci. Không seed demo trên production.

Trước nâng cấp dữ liệu thật, dùng cơ chế backup PostgreSQL/Railway hiện có và kiểm tra bản backup. Migration chỉ thêm bảng, không sửa hay xóa nghiệp vụ outbound. Rollback ứng dụng: đưa code về commit trước module, giữ nguyên các bảng return để không mất dữ liệu đã nhập; không dùng DROP/CASCADE trên database vận hành. Khi nâng cấp lại, migrate có checksum và chạy lại an toàn. Nếu cần sửa schema, thêm migration mới, không chỉnh file 010 đã áp dụng.

## Bổ sung V2

Nhận diện hãng, update file, lịch sử trước/sau, chi tiết/copy/cột mới và phân tích lý do/tỷ lệ sản phẩm đã triển khai. Xem [hướng dẫn V2 và giới hạn nguồn](RETURN_V2.md); hướng dẫn cũ về quét/kiểm/khiếu nại vẫn áp dụng. Nguồn bán riêng cung cấp mẫu số bán thành công; không dùng số xuất kho thay mẫu số.
