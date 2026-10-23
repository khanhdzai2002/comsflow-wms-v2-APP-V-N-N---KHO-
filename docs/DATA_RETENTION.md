> Tài liệu nghiệp vụ kế thừa. Cấu hình chạy và triển khai v2 dùng [Cloudflare + Supabase](DEPLOYMENT.md); các hướng dẫn hosting Railway/Next.js trong lịch sử không áp dụng cho dự án mới.

# Dọn dữ liệu cũ

Vào **Cấu hình hệ thống → Dọn dữ liệu cũ** bằng tài khoản Quản trị viên. Quản lý/Nhân viên không có nút dọn và các API tương ứng trả 403. Tính năng chỉ thực hiện khi người dùng xem trước và xác nhận; việc triển khai mã không tự xoá dữ liệu đang lưu.

## Thao tác

1. Chọn **Nhật ký quét xuất kho** hoặc **Hồ sơ đơn hoàn đã kết thúc**, kho và mốc **Xoá dữ liệu trước ngày**. Mặc định là 180 ngày trước, có thể đổi. Ngày được chọn không nằm trong phạm vi: mốc là 00:00 UTC+7, chỉ nhận hôm nay hoặc ngày đã qua.
2. Bấm **Xem trước dữ liệu sẽ xoá**. Xem số được chọn, số được bảo vệ, lượng nội dung ước tính và số/dung lượng ảnh/PDF. Mỗi đợt tối đa 500 bản ghi gốc; hiển thị 50 dòng đầu, tệp xuất có đủ cả đợt. Mỗi lần xem trước thuộc một tài khoản và hết hạn sau 30 phút.
3. Có thể **Xuất Excel/CSV** danh sách dự kiến xoá. Tệp này không bao gồm ảnh/PDF, toàn bộ nguồn thô hoặc đầy đủ quan hệ dữ liệu nên không phải bản sao lưu để phục hồi. Nếu cần khôi phục đầy đủ, tạo và kiểm chứng bản backup PostgreSQL/Railway trước khi xoá.
4. Mở xác nhận, nhập lý do ít nhất 8 ký tự, câu **XOA DU LIEU CU** và đánh dấu đã hiểu việc xoá vĩnh viễn. Có thể huỷ khi chưa gửi xác nhận. Server kiểm tra lại trạng thái và dấu vân tay đúng tập bản ghi; có thay đổi thì trả 409, không xoá và yêu cầu xem trước lại.
5. Đợi xác nhận của server. Nếu mất phản hồi hoặc server trả lỗi tạm thời, giao diện ghi **Chưa nhận kết quả xoá**, giữ nguyên phạm vi và thông tin xác nhận. Bấm **Thử lại cùng lần xoá**: lần đã hoàn tất trả kết quả cũ, không chọn thêm dữ liệu hay xoá/audit lần nữa. Đóng hộp thoại sau khi đã gửi không huỷ/hoàn tác yêu cầu trên server. Sau thành công có thể xem trước đợt tiếp theo.
6. **Tối ưu vùng trống** chạy VACUUM ANALYZE thông thường để PostgreSQL tái sử dụng không gian. Có nhật ký và khoá chống hai lần tối ưu đồng thời. Không chạy VACUUM FULL hoặc tự thu nhỏ volume Railway.

## Dữ liệu được giữ và được xoá

### Nhật ký xuất kho

Lấy ngày tạo thực tế của scan_events. Chỉ dọn bản ghi không gắn vận đơn, hoặc gắn vận đơn đã bàn giao/đã huỷ có cập nhật trước mốc; không có ngoại lệ chưa giải quyết hoặc ngoại lệ có hoạt động mới trong phạm vi liên quan. Các liên kết ngoại lệ/vận đơn không khớp được giữ để kiểm tra.

Xoá scan_events được chọn và exception_cases đã giải quyết gắn đúng các lượt quét đó. Giữ nguyên shipments, scanned_at/scanned_by, handed_at/handed_by, trạng thái, đơn hàng, sản phẩm, ca, phiếu bàn giao và nguồn PDF/membership. Vì vậy đối soát số vận đơn và trạng thái xuất kho không bị reset và quét lại vẫn trả trùng. Báo cáo lượt quét/nhân viên và lịch sử chi tiết trước đây không còn các dòng đã xoá; màn báo cáo lịch sử có thông báo dữ liệu đã dọn.

### Hồ sơ hoàn

Lấy ngày yêu cầu, đồng thời yêu cầu nguồn nhập gần nhất, updated_at và mọi hoạt động nhận/kiểm/ghi chú/khiếu nại/bằng chứng đều cũ hơn mốc. Chỉ nhận processing_status completed, compensated hoặc closed_unsuccessful; không nhận inspection_stale, khiếu nại open/submitted/won hoặc liên kết sự kiện/kiện chéo hồ sơ. Các hồ sơ đang xử lý, xác nhận mất nhưng chưa kết thúc, nguồn mới nhập lại hoặc vừa có hoạt động đều được giữ.

Xoá trọn case được chọn cùng items/parcels/events/snapshots/claims/evidence và diff cập nhật từng trường V2; summary/header lần nhập vẫn giữ. Hồ sơ khác trong cùng một file và snapshot của chúng vẫn giữ nguyên. Giữ header/hash file nguồn và bộ đếm dòng đã dọn, mã yêu cầu theo shop, cùng mã thao tác tối thiểu để chống nhập/quét lại. Nếu file cũ hoặc một bản xuất mới chứa mã yêu cầu đã dọn, preview/commit sẽ chặn và chỉ rõ cần lọc các yêu cầu đó khỏi nguồn. Không âm thầm bỏ dòng hay tạo lại hồ sơ đã xoá.

Số liệu đơn hoàn lịch sử giảm theo hồ sơ đã xoá, có thông báo trên module. Không có thùng rác/khôi phục từ UI. Audit cũ, nhật ký lần dọn và các dấu chống trùng tối thiểu được giữ, không nằm trong ước tính nội dung được xoá.

## Dung lượng PostgreSQL

- **CSDL trên đĩa** lấy pg_database_size; **Ảnh/PDF** lấy tổng octet_length của bytes, các bộ đếm lấy dữ liệu thật.
- Ước tính nội dung dự kiến xoá lấy kích thước bản ghi và nội dung tệp; không phải số byte chắc chắn giảm trên volume, không bao gồm mọi overhead/index/TOAST và phần metadata tối thiểu được giữ.
- DELETE/VACUUM cho phép dùng lại các trang trống; file database và phí Railway không nhất thiết giảm ngay. Nên dọn trước khi ổ đầy hoàn toàn vì PostgreSQL vẫn cần chỗ ghi WAL và làm việc. Nếu đã hết hoàn toàn dung lượng, cần tạo khoảng trống hoặc mở rộng volume tại Railway trước.

## Giao dịch, phân quyền và triển khai

Migrations **011_data_retention.sql** và **012_retired_return_cases.sql** bổ sung metadata được bật RLS và thu hồi quyền anon/authenticated. Giữ nguyên checksum migrations cũ. Railway tiếp tục dùng **Pre-deploy Command `npm run db:migrate`**, Build `npm run build`, Start `npm start`.

Không tắt trigger, không dùng session_replication_role và không bỏ ràng buộc FK. Guard lịch sử chỉ cho DELETE trên đúng IDs trong job đang chạy ở đúng transaction, có chủ sở hữu admin còn hoạt động. UPDATE vẫn cấm, audit/source manifests và header import vẫn append-only. Job/actor và parent/child cần thiết được khoá; import hoàn và dọn hoàn cùng khoá 742920. Dọn các loại dùng khoá giao dịch 742921. Khung xử lý có lock_timeout 3 giây/statement_timeout 60 giây; lỗi hoặc thay đổi dữ liệu rollback toàn bộ child/tệp/metadata/audit. Job hoàn tất bỏ danh sách IDs lớn, giữ thống kê và dấu vân tay; các preview hết hạn được dọn khi tạo preview mới.

Mã request đã dọn trả 410 khi retry thay vì tạo một lượt quét/nhận mới. Lần xoá được audit với người, thời gian, kho, mốc, loại, lý do và số lượng. Không xoá sản xuất qua script thử nghiệm: SQL integration chỉ chạy database *_test; fixture E2E xoá chỉ chạy local, database đánh dấu demo và kho riêng được tạo cho bài thử.
