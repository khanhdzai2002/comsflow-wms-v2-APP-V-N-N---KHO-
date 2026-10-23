# Project Supabase của ComsFlow v2

Thông tin công khai do chủ dự án cung cấp ngày 23/10/2026:

- Project ref: `lyeyjfvxmqruszgfrjze`.
- Project URL: `https://lyeyjfvxmqruszgfrjze.supabase.co`.
- Dashboard: https://supabase.com/dashboard/project/lyeyjfvxmqruszgfrjze

Đã nhận Publishable key và cập nhật cấu hình công khai trong `.env.example`, `wrangler.jsonc` và `render.yaml`. Chưa thay `.env.local` hoặc `.dev.vars` đang dùng để kiểm thử local, để tránh ghép nhầm database local với Auth/Storage production.

Chủ dự án đã chạy SQL trong Supabase SQL Editor và cung cấp ảnh kết quả `ComsFlow schema ready; Railway data has NOT been imported`, `migrations = 17`. Đây là xác nhận khởi tạo schema từ giao diện của chủ dự án; chưa có kiểm tra trực tiếp qua API/database từ môi trường Codex. Chưa triển khai web/worker hoặc chuyển dữ liệu Railway.

## Repository riêng

Chủ dự án đã tạo repository mới: https://github.com/khanhdzai2002/comsflow-wms-v2-APP-V-N-N---KHO-. Dùng repository này và branch `main` để triển khai. GitHub API vẫn trả `Forbidden` trong môi trường Codex; có thể sử dụng Git transport để đưa mã nguồn lên repo đã được tạo. Không dùng repository/Worker KOC HUB hoặc Railway cũ thay cho dự án mới này.

Sau khi chủ dự án cấp quyền cho repo mới, `git push -u origin main` đã thành công. Đã xác nhận SHA của `refs/heads/main` trên GitHub khớp bản local. GitHub Actions API vẫn trả `Forbidden`, nên chưa xác minh kết quả CI trên GitHub. Không có Cloudflare deployment credentials trong môi trường hiện tại; chưa triển khai web/worker hoặc chuyển dữ liệu Railway. Không cần gửi token hoặc mật khẩu vào chat.

Chủ dự án đã kết nối repository với Cloudflare và cung cấp domain `comsflow-wms-v2-app-v-n-n---kho.comsflow-apps.workers.dev`. Đã cập nhật tên Worker và APP_ORIGIN tương ứng trong cấu hình. Dấu `-` đứng trước URL trong tin nhắn được hiểu là dấu đầu dòng, không phải một phần hostname; tên Worker khớp ảnh dashboard đã cung cấp. Chưa xác minh health endpoint vì proxy môi trường Codex chặn request CONNECT với 403; không coi lỗi proxy này là lỗi từ ứng dụng. Còn cần runtime secrets, tài khoản/dữ liệu và worker nền trước khi vận hành.

Tiếp tục bằng [Cloudflare Dashboard](CLOUDFLARE_DASHBOARD.md); không cần tải ZIP hay cài terminal trên máy người dùng.

## Khởi tạo bằng SQL Editor, không cần terminal

1. Mở dashboard project `lyeyjfvxmqruszgfrjze`, chọn **SQL Editor → New query**.
2. Mở file `supabase/bootstrap.sql` trong mã nguồn (bản tải riêng: `ComsFlow-Supabase-Setup.sql`), sao chép toàn bộ vào ô query.
3. Kiểm tra đúng project mới rồi bấm **Run**. Script tạo schema và bucket riêng tư; không xóa dữ liệu hay tạo tài khoản quản trị. Nếu có bảng của dự án khác thì script dừng.
4. Kết quả cuối phải có `ComsFlow schema ready; Railway data has NOT been imported` và `migrations = 17`. Đây chỉ là hoàn tất schema, chưa phải app đã online hoặc dữ liệu cũ đã chuyển.

Script được tạo bằng `npm run db:sql`, kiểm checksum như CLI migration. Chạy lại không tạo bảng trùng; lỗi ở bất kỳ migration nào sẽ rollback cả lượt. Không cần chạy cả SQL Editor và CLI; sau khi chạy SQL Editor, CLI nhận ra các migration đã áp dụng.

Nếu không tải được file, dùng khối SQL được gửi trực tiếp trong chat. Bản chụp của khối đó là `supabase/chat-bootstrap.sql`, chứa đủ 17 migration cùng checksum của phiên bản này. Đã kiểm tra cài mới và chạy lại trên database local riêng. Không dán thêm hoặc chạy lẻ phần giữa khối; sao chép toàn bộ từ `BEGIN` đến câu `SELECT` cuối.

Không tạo Admin/nhập dữ liệu vận hành trước khi chuyển dữ liệu cũ theo MIGRATION.md.

## Thông tin còn cần

1. **Publishable key**: đã nhận, không cần gửi lại.
2. **Service-role key** và **DATABASE_URL** đúng project: chỉ nhập vào secret manager/môi trường server của Cloudflare và worker; không gửi vào chat hoặc Git. DATABASE_URL phải sao chép từ Connect vì hostname, port và kiểu pooler phụ thuộc project. Username trong template là gợi ý transaction/session pooler, không phải kết nối đã kiểm chứng.
3. Tài khoản/quyền triển khai Cloudflare và nơi chạy background worker. Project URL Supabase không phải URL đăng nhập vào ứng dụng ComsFlow.

Chưa có quyền tạo bảng, bucket hoặc chuyển dữ liệu production chỉ bằng Project URL. Lượt kiểm tra HTTP từ môi trường Codex bị proxy chặn với lỗi CONNECT 403; đây không phải phản hồi đã xác thực từ Supabase và không chứng minh project có lỗi.

Sau khi cấu hình secrets, làm theo [DEPLOYMENT.md](DEPLOYMENT.md). Nếu chuyển dữ liệu Railway, thực hiện [MIGRATION.md](MIGRATION.md) trước khi tạo tài khoản mới/nhập dữ liệu vận hành. Dữ liệu Railway chưa bị thay đổi.
