# Chuyển dữ liệu Railway → Supabase mới

Không cần app Railway hoạt động; cần kết nối PostgreSQL nguồn và một project Supabase mới hoàn toàn. Chưa chạy trên dữ liệu thật trong lượt triển khai này.

1. Tạo backup đầy đủ database nguồn bằng công cụ PostgreSQL/Supabase phù hợp; giữ bản sao riêng và kiểm tra restore. Nếu nghiệp vụ còn ghi vào nguồn, chọn thời điểm ngừng ghi để chuyển lần cuối. Snapshot read-only chỉ bao gồm dữ liệu tồn tại tại thời điểm bắt đầu chuyển.
2. Điền SOURCE_DATABASE_URL (ưu tiên tài khoản chỉ đọc) và DATABASE_URL trỏ đích mới qua secret manager. Không đưa vào chat.
3. Trên đích mới chạy `MIGRATION_SKIP_DEFAULTS=1 npm run db:migrate`. Không seed, không tạo Admin hoặc cho nhân viên nhập dữ liệu trước khi chuyển.
4. `npm run db:migrate-data` chỉ lập kế hoạch đếm bảng, không thay đổi dữ liệu.
5. Sau khi đã xem đúng đích, đặt MIGRATION_TARGET_CONFIRM bằng **hostname/database** chính xác của URL đích, rồi `npm run db:migrate-data -- --apply`.
6. Công cụ từ chối đích có user/đơn/scan/đơn hoàn/job; chỉ thay các dòng cấu hình mặc định của schema đích chưa sử dụng. Nguồn chạy trong transaction read-only. Không tắt khóa ngoại. Các bảng được copy theo thứ tự phụ thuộc, batch 250.
7. UUID, mã, số liệu JSON, bytes và timestamp giữ nguyên. JSON được chuyển dạng text, không parse số lớn qua JavaScript. Mỗi bảng kiểm count và SHA-256 trên các cột nguồn theo primary key, cùng timezone UTC. Bất kỳ sai khác đều rollback toàn bộ giao dịch đích. Manifest chỉ có tên bảng/count/hash ở `backups/migration-manifest.json` (gitignore, mode 0600).
8. Không chuyển sessions/login_attempts/job queue. Bảng/cột nghiệp vụ nguồn chưa có ở đích sẽ làm dừng quá trình; không âm thầm bỏ qua.
9. `npm run db:migrate-auth` lập kế hoạch; `npm run db:migrate-auth -- --apply` nhập bcrypt hash bằng API quản trị Supabase Auth. Giữ UUID và role/active. Có checkpoint auth_user_id, chạy lại an toàn nếu gián đoạn. Không log mật khẩu/hash. Chỉ dùng tài khoản nguồn có hash bcrypt hợp lệ; các trường hợp khác cần đặt mật khẩu riêng.
10. `npm run storage:setup`, cấu hình API/worker, rồi đăng nhập và tải lịch sử quét để đối chiếu mẫu. Kiểm tra trạng thái scan/bàn giao, đơn hoàn, ảnh bằng chứng cũ và lịch sử thao tác.

Migration dữ liệu là một lần cho đích rỗng, không phải công cụ đồng bộ liên tục. Nếu cần chuyển lần cuối sau khi rehearsal, dùng project đích rỗng khác hoặc kế hoạch reset đích staging đã được xác nhận; công cụ không tự xóa dữ liệu đang vận hành. Không chạy test/seed để “làm sạch” đích thật.

Ảnh bằng chứng cũ đang lưu bytea được giữ để bảo toàn UI; chức năng bằng chứng hiện vẫn lưu tối đa 5 MB/file trong PostgreSQL. Storage mới dùng cho input/report. Có thể chuyển ảnh lịch sử sang object storage sau bằng một migration riêng có kiểm checksum; bản này chưa tự thay đổi vị trí ảnh cũ.
