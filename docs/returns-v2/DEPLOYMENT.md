# Triển khai và rollback

## Trạng thái kiểm chứng

Code và SQL đã được xây dựng, kiểm thử trên database local có tên kết thúc `_test`. Chưa chạy SQL trên project thật, chưa xác minh build/đăng nhập/Storage/Hyperdrive của bản mới trên Cloudflare. Không dùng fixture hoặc lệnh reset test cho dữ liệu thật.

## Nâng cấp từ 19 migration

1. Chọn đúng project Supabase **lyeyjfvxmqruszgfrjze**. Ghi lại SHA/Cloudflare Version ID hiện tại và counts của `return_cases/items/parcels/events/claims/evidence`, `scan_events`, `shipments`; lấy mẫu mã dài, người/giờ nhận và hồ sơ khiếu nại.
2. Xuất backup PostgreSQL đầy đủ và sao lưu bucket private; xác minh có thể phục hồi trên database khác. Gói Free không mặc định có PITR/backup đủ cho yêu cầu lưu trữ này; phải tổ chức backup độc lập. Chưa có backup đã kiểm chứng thì chưa chạy production migration.
3. Thử migration và bản web này trên bản sao dữ liệu, giữ Node worker cũ dừng trong thời gian nâng cấp. Không dùng `bootstrap.sql` để ghi đè một database lạ. Không tạo fixture/demo trên project thật.
4. Supabase → SQL Editor → New query → dán **toàn bộ `supabase/upgrade-020.sql`** và Run. Đây là gói giao dịch, kiểm tra đủ marker 001–019 và checksum, khóa migration, thêm schema/projection/quyền; lỗi sẽ rollback. Chạy lại được khi checksum đúng. Không drop/truncate bảng nghiệp vụ.
5. Nâng cấp giữ UUID/mã/source_data/sự kiện/giờ nhận cũ. Sổ nhận cũ được bổ sung từ kiện đã nhận và các mã unknown độc lập có thể khôi phục; không đổi unknown gốc thành received. Dữ liệu không đủ bằng chứng vẫn là cần xác minh. Phiên bản nguồn cũ chỉ có ảnh chụp tổng hợp đang lưu, không bịa lại mọi phiên bản nhập lịch sử đã thiếu.
6. Giữ role **comsflow_connection_check** giới hạn. Migration cấp quyền và RLS cho bảng/view/function mới, không cấp anon/authenticated. Nếu giao diện báo thiếu quyền, dùng `scripts/sql/grant-hyperdrive-runtime.sql` trong đúng project; không đổi mật khẩu hoặc cấp service role cho trình duyệt.
7. Với bucket `comsflow-private`, migration thêm MIME ảnh/video và giới hạn 50 MB, giữ private. Nếu dùng `STORAGE_BUCKET` khác, quản trị chạy `npm run storage:setup` bằng credentials quản trị đã cấu hình an toàn hoặc cập nhật bucket tương ứng. Không dán service-role/database password vào chat, mã nguồn hay biến frontend.
8. Build Cloudflare từ commit mới: `npm run build`, deploy bằng liên kết GitHub hiện có (`npx wrangler deploy`). Giữ `DATABASE_URL`/Hyperdrive/secret Supabase tại runtime. Cấu hình binding và tên Worker không đổi. UI hiện bản **2026-11-09.returns-v2-1**; `GET /api/health` phải connected. Sau đăng nhập, `/api/returns/operations/status` phải `ready:true, permissions:true`.
9. Nếu còn chạy Node processor cho chức năng cũ, build/deploy **worker mới** trước khi dùng intake v2: housekeeping mới giữ file intake và metadata. Không tiếp tục chạy worker housekeeping cũ với file intake mới. Core CSV/XLSX hàng hoàn và báo cáo hãng không đòi hỏi triển khai Node processor.
10. Admin cũng có thể sao chép SQL 020 trực tiếp trong thông báo nâng cấp của app, không cần tải tệp. Khi schema/quyền thiếu, phần hoàn cũ vẫn được dùng; không tự chạy DDL từ request người dùng.

Cài mới dùng `supabase/bootstrap.sql` (20 migration), đã bổ sung MIME private. Gói 018/019 sinh lại bao gồm các nâng cấp sau để người đang ở bản cũ không bỏ sót 020. Không sửa file migration đã có marker/checksum trên môi trường đang chạy.

## Nghiệm thu hosted trước sử dụng rộng

- Đối chiếu counts/mẫu UUID/source/receipt/claim/outbound trước–sau. Tổng nhận không tăng do file trùng hoặc các phép backfill mới ngoài phạm vi đã kiểm chứng.
- Dùng hồ sơ thử được đánh dấu rõ trong shop/kho kiểm thử: quét trước → nhập file → giữ giờ/người; nhập trước → quét → số lượng chưa kiểm; file kho có lượng; chỉ hoàn tiền; trung chuyển; hủy chưa bàn giao; mã khớp nhiều yêu cầu.
- Kiểm kho/ca/role staff và tài khoản không được phân công; thử quản lý phân công, kiểm, claim, private evidence; tài khoản ngoài không tải được ảnh.
- Xuất và mở Excel thực tế trên máy nhân viên: mã dài nguyên dạng, đúng sheet/18 cột/màu vàng, thiếu dữ liệu không tự điền.
- Test mất mạng rồi tiếp tục, loại bỏ–khôi phục một file sai, xác minh lịch sử và các nguồn độc lập còn nguyên.
- Tít xuất kho, PDF J&T/SPX/BEST, giao ca và đăng nhập vẫn hoạt động. Không lấy API health connected làm bằng chứng toàn bộ nghiệp vụ đã đạt.

## Dung lượng và mở rộng

Mặc định file 10 MB / 50.000 dòng, staging tối đa 200 dòng/request, lưu 100 nhóm/2.000 dòng/request, list 50 hồ sơ/trang, archive 20 hồ sơ hoặc 100 bằng chứng/request; report tối đa 50.000 dòng sản phẩm và snapshot có hạn 24 giờ. File gốc/bằng chứng/audit giữ private; snapshot báo cáo hết hạn là dữ liệu tạm, không phải bằng chứng nghiệp vụ.

Vài nghìn thao tác/ngày không đòi đổi nền tảng. Cần theo dõi dung lượng Postgres + indexes + JSON snapshots, bucket gốc/video, CPU/connection Hyperdrive, lỗi/latency Worker và số người cùng lúc. Không coi gói Supabase/Cloudflare Free là dung lượng vô hạn. Mở rộng compute/storage/gói Worker theo số đo hosted; không tự nâng gói có phí. Dùng ngày/kho/shop trong truy vấn lớn; hàng triệu hồ sơ có thể cần projection tổng hợp cập nhật theo sự kiện hoặc phân vùng sau đo thực tế.

Quét/import/link dùng khóa giao dịch chung để tránh đếm trùng; không dự kiến cho hàng trăm luồng ghi đồng thời. Các yêu cầu không giữ kết nối giữa request; `DB_MAX_CONNECTIONS=1` như cấu hình hiện tại. Thử tải nhiều thiết bị trên staging trước tăng số người. Số đo cục bộ trong BENCHMARK.json không là SLA production.

Node worker mới không tự xóa nguồn intake, kể cả file lỗi/archived. Cần có chính sách lưu trữ/backup/dọn file pending theo thời hạn do chủ dữ liệu phê duyệt; không tự xóa lịch sử để giảm dung lượng. Mỗi lần đổi ánh xạ có thể có bản nguồn private riêng.

## Rollback

1. Tạm ngừng nhập/kiểm/claim mới, ghi lại checkpoint và backup phát sinh. Không xóa bảng/column 020 hoặc sửa marker.
2. Chọn Cloudflare deployment cũ **0fc6fb5** / Version ID đã ghi trước nâng cấp. Dữ liệu và bằng chứng v2 vẫn trong Postgres/Storage; code cũ dùng các cột cũ.
3. **Dừng Node processor cũ**, hoặc giữ build worker mới bảo vệ nguồn intake. Worker housekeeping cũ có thể dọn file jobs hết hạn; không được dùng trong rollback khi còn nguồn intake v2 cần giữ.
4. Không dùng dọn/xóa vĩnh viễn hàng hoàn trong code cũ; quan hệ/bảo vệ lịch sử mới sẽ chặn, không cố gỡ constraint/trigger.
5. Nếu code cũ tiếp tục ghi nhận unknown trong thời gian rollback, lưu toàn bộ events; khi triển khai lại v2, đối chiếu và phục hồi ledger từ events/parcel theo cùng quy tắc migration trước khi nghiệm thu. Marker 020 khiến backfill chỉ chạy một lần, không tự giả vờ đã bắt được mọi event mới từ code cũ.
6. Nếu chỉ một file sai, ưu tiên Loại bỏ/Khôi phục trong v2 có audit và checkpoint. Với file kho đã có kiểm/claim dựa vào bằng chứng duy nhất, quản lý xác minh trước; không tự xóa dây chuyền.
7. Chỉ phục hồi database từ backup sau khi chủ dữ liệu chấp thuận cách giữ các thao tác phát sinh sau backup. Không tự restore đè production.

## Giới hạn đã biết

- Chưa nghiệm thu hosted/thiết bị camera hoặc Excel desktop thật trong phiên này; thiếu credentials quản trị và mạng tới các dịch vụ hosted.
- Dữ liệu nguồn thiếu/đã làm tròn không thể phục hồi bằng suy đoán. Mã không có hãng chắc chắn giữ Chưa xác định; cùng mã ở nhiều yêu cầu cần xác minh.
- Trích xuất CSV/XLSX ở browser giảm tải Worker. Server kiểm quyền, chuẩn hóa lại raw rows, checksum file gốc, xung đột và giao dịch; **không tái phân tích binary để chứng thực từng ô**. Đây là ranh giới tin cậy của tài khoản quản lý được phép nhập. Muốn nhập từ đối tác không tin cậy cần thêm parser server cô lập.
- XLSX dùng hệ lịch 1904 bị chặn để tránh dịch sai ngày; xuất lại CSV UTF-8 có ngày rõ ràng hoặc XLSX lịch 1900. File nhiều sheet đọc sheet đầu tiên.
- Nguồn cũ có thể không còn tệp binary đã hết hạn từ phiên bản trước. Nâng cấp giữ dữ liệu/snapshot còn tồn tại, không khôi phục các byte đã bị xóa trước đó.
- Tỷ lệ trên đơn bán cần nguồn bán thành công đủ, cùng nhóm đơn; vẫn giữ phân tích nâng cao/nguồn bán cũ, đường nhập nguồn bán cũ cần Node processor. Không gán mẫu số ảo.
