# Kiểm chứng v2 — 23/10/2026

Đây là kết quả của dự án **comsflow-wms-supabase mới**, trên Node 24, PostgreSQL 17 local và Chromium. Không phải xác nhận deployment production, tải thực tế trên cloud hoặc dữ liệu Railway đã được chuyển.

| Kiểm tra                  | Kết quả                                                                                                                       |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| TypeScript                | `npm run typecheck` đạt                                                                                                       |
| ESLint                    | `npm run lint` đạt, không warning                                                                                             |
| Backend và parser         | **229/229**, 15 test files, đạt                                                                                               |
| Giao diện desktop/mobile  | **6/6** đạt                                                                                                                   |
| Vite production build     | đạt                                                                                                                           |
| Node worker bundle        | đạt                                                                                                                           |
| Cloudflare bundle/dry run | đạt, khoảng 1,75 MB trước gzip                                                                                                |
| Cloudflare runtime local  | `/health`, `/api/health`, `/api/auth/setup-status` trả 200; PostgreSQL thực qua adapter Cloudflare                            |
| Worker/child thực         | PDF giả lập **19.700.586 bytes, 1.800 vận đơn** đọc đúng 1.800 mã; chạy polling loop, HTTP Storage fixture, child heap 384 MB |
| Chuyển database thử       | **43 bảng** count/hash khớp, gồm **1.942 scan_events** giả lập; nguồn read-only                                               |

## Đã kiểm tra

- Kế thừa kiểm thử nghiệp vụ: quét/idempotency/quét trùng, ca/kho/hãng, bàn giao, đối soát nguồn, trang nối PDF, Shopee GHN/SPX và TikTok J&T/BEST, nhập đơn hoàn, phân tích và dọn dữ liệu.
- Worker claim đồng thời, lease hết hạn và token cũ không ghi đè; upload intent retry chỉ tạo một job; quyền owner/staff; file hash bị thay đổi; tài khoản bị khóa trước khi chạy.
- Preview/commit PDF thực qua API file riêng. Chạy lại job commit đã thành công không ghi trùng. Cố ý làm lỗi lúc lưu durable result: toàn bộ dữ liệu nhập và trạng thái thành công đều rollback.
- Xuất đủ **1.940 dòng trong ngày**, không hụt do pagination; hai dòng ngoài ranh giới ngày Việt Nam bị loại; mã có số 0 đầu và checksum giữ đúng. Đây là dữ liệu tổng hợp kiểm thử, không phải danh sách scan thật của shop.
- Supabase SDK thực dùng HTTP provider fixture: phân tách admin/public key, role/active đọc từ DB, invalid credentials khác provider outage, refresh cookie HttpOnly. Trigger PostgreSQL thực chặn self-signup nâng quyền và liên kết user cũ giữ UUID/role.
- Dashboard thống kê bằng SQL, cùng KPI/bộ lọc so với danh sách; không tải raw scan responses để lặp tính trong API.
- Browser fixtures xác minh logo/UI nguồn, tab import đang chọn, tab đơn hoàn và job tải báo cáo còn truy cập sau F5. API browser được giả lập; các kiểm thử này không thay thế nghiệm thu Auth/Storage cloud thật.

## Còn phải nghiệm thu trước khi vận hành

Chủ dự án đã cung cấp Project URL Supabase, xác nhận SQL Editor cài đủ 17 migration và tạo Worker Cloudflare. Môi trường phát triển chưa có credentials quản trị Cloudflare/Supabase hoặc kết nối read-only nguồn Railway để nghiệm thu trực tiếp. Chưa kiểm tra Supabase hosted Auth/Storage/pooler thực, backup/PITR restore thực, container đã triển khai trên host, load/concurrency trên quy mô shop, camera/súng quét vật lý hoặc toàn bộ file khách hàng trên runtime mới.

GitHub API từ môi trường này trả 403; CI cấu hình sẵn nhưng chưa chạy trên GitHub. Không coi file YAML/dry run là deployment đã thành công.

## Bổ sung khởi tạo qua SQL Editor

Đã cấu hình Project URL và Publishable key do chủ dự án cung cấp trong cấu hình triển khai công khai; không thay secrets/môi trường local và không chạy SQL trên project hosted. Bộ sinh `npm run db:sql` tạo `supabase/bootstrap.sql` từ đủ 17 migration, giữ checksum tương thích CLI. Đã kiểm tra cài mới và chạy lại trên database local riêng; mô phỏng schema `auth.users`/`storage.buckets` xác nhận trigger và bucket private; kiểm tra nhầm project có bảng khác bị chặn và không thay bảng đó. CLI migration tiếp nối installer nhận đủ checksum. Typecheck, lint và Cloudflare dry run đạt sau cấu hình. Các kiểm tra này không thay thế việc chạy trên Supabase hosted thật.

Kết quả gốc Railway được lưu riêng trong `docs/legacy/VALIDATION_RAILWAY.md` để tham khảo lịch sử; không sử dụng làm chứng nhận cho dự án v2.

## Bổ sung chẩn đoán kết nối database

21 kiểm thử mới xác minh cấu hình runtime, TLS Supabase mặc định, startup parameters tương thích Pooler, username đúng project, mật khẩu mẫu/mã hóa sai, phân loại lỗi và không lộ URI/mật khẩu trong phản hồi hoặc log health. Health kiểm tra ba migration v2 trước khi báo connected. Toàn bộ 229 kiểm thử đạt; typecheck, lint, frontend build, worker build và Wrangler dry-run đạt. Dry-run dùng thư mục cấu hình/log trong /tmp để phù hợp sandbox. Chưa xác nhận nguyên nhân lỗi production hay kết nối tới Pooler hosted thực; cần chủ dự án mở lại /api/health sau deployment.
