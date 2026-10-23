# Project Supabase của ComsFlow v2

Thông tin công khai do chủ dự án cung cấp ngày 23/10/2026:

- Project ref: `lyeyjfvxmqruszgfrjze`.
- Project URL: `https://lyeyjfvxmqruszgfrjze.supabase.co`.
- Dashboard: https://supabase.com/dashboard/project/lyeyjfvxmqruszgfrjze

Đã cập nhật `.env.example` theo project này. Chưa thay `.env.local` hoặc `.dev.vars` đang dùng để kiểm thử local, để tránh ghép nhầm database local với Auth/Storage production.

## Thông tin còn cần

1. **Publishable key** (`sb_publishable_...`) hoặc **anon public key**: lấy tại Settings → API Keys, có thể gửi công khai để cấu hình `SUPABASE_ANON_KEY`.
2. **Service-role key** và **DATABASE_URL** đúng project: chỉ nhập vào secret manager/môi trường server của Cloudflare và worker; không gửi vào chat hoặc Git. DATABASE_URL phải sao chép từ Connect vì hostname, port và kiểu pooler phụ thuộc project. Username trong template là gợi ý transaction/session pooler, không phải kết nối đã kiểm chứng.
3. Tài khoản/quyền triển khai Cloudflare và nơi chạy background worker. Project URL Supabase không phải URL đăng nhập vào ứng dụng ComsFlow.

Chưa có quyền tạo bảng, bucket hoặc chuyển dữ liệu production chỉ bằng Project URL. Lượt kiểm tra HTTP từ môi trường Codex bị proxy chặn với lỗi CONNECT 403; đây không phải phản hồi đã xác thực từ Supabase và không chứng minh project có lỗi.

Sau khi cấu hình secrets, làm theo [DEPLOYMENT.md](DEPLOYMENT.md). Nếu chuyển dữ liệu Railway, thực hiện [MIGRATION.md](MIGRATION.md) trước khi tạo tài khoản mới/nhập dữ liệu vận hành. Dữ liệu Railway chưa bị thay đổi.
