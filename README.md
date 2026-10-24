# ComsFlow WMS v2 — Cloudflare + Supabase

Dự án mới, tách khỏi `onlineportfolio` trên Railway. Giữ giao diện và các nghiệp vụ xuất kho/đơn hoàn của ComsFlow; thay lớp chạy web, đăng nhập, lưu file và xử lý tác vụ nặng.

**Trạng thái:** chủ dự án đã xác nhận web trên Cloudflare, database và đăng nhập hoạt động, cùng 17 migration trên Supabase. Rollout từng bản sửa vẫn cần kiểm tra trên app thật; chưa xác nhận Node processor hoặc chuyển dữ liệu Railway. Repository mới: https://github.com/khanhdzai2002/comsflow-wms-v2-APP-V-N-N---KHO-.

Triển khai không dùng terminal: [hướng dẫn Cloudflare Dashboard](docs/CLOUDFLARE_DASHBOARD.md).

## Thiết kế

- **Cloudflare Workers:** React/Vite, API cùng domain, quét đơn và các giao dịch ngắn.
- **Supabase:** PostgreSQL là nguồn dữ liệu chính; Supabase Auth đăng nhập; Storage riêng tư lưu file đầu vào/báo cáo.
- **PDF xuất kho trực tiếp:** module worker trên trình duyệt đọc từng trang; API kiểm tra từng nhóm tối đa 20 trang, đối chiếu bản gốc trong private Storage và lưu giao dịch. Không cần Render, không đưa PDF.js vào API Cloudflare. CSV hoàn TikTok có luồng nhập trực tiếp riêng.
- **Worker Node riêng:** xử lý Excel, báo cáo và luồng PDF legacy trong tiến trình con, một file mỗi worker. Có thể chạy trên VM, Fly hoặc Render; không bắt buộc cho PDF xuất kho và CSV hoàn TikTok.
- **Tác vụ dữ liệu:** theo dõi nhập file sau F5, xác nhận lưu từ kết quả xem trước, tải đầy đủ lịch sử quét theo ngày Việt Nam.

Logo, menu, màn hình quét, đối soát, bàn giao, nhập file, đơn hoàn, nhân viên và hướng dẫn được giữ lại. Mẫu nguồn hỗ trợ TikTok/J&T/BEST và Shopee/SPX/GHN; đếm vận đơn duy nhất, ghép trang sản phẩm tiếp theo, không lấy số trang làm số kiện.

## Bắt đầu

```sh
npm ci
cp .env.example .env.local
# Điền kết nối project Supabase MỚI qua môi trường an toàn.
npm run db:migrate
npm run storage:setup
npm run db:admin
npm run build
npm run build:worker
```

Các bước triển khai chính xác, chỗ nhập biến môi trường và cấu hình worker: [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).

Chạy local: `npm run dev` và `npm run dev:api`; thêm `npm run worker:dev` khi cần Excel/báo cáo. Wrangler đọc secrets local từ `.dev.vars` (không commit). Vite dùng port 5173, API 8787. Không chạy demo trên Supabase; `db:seed` chỉ chấp nhận database local và không cung cấp tài khoản Auth production.

Kiểm thử cần PostgreSQL local riêng `*_test` qua `TEST_DATABASE_URL`, tuyệt đối không trỏ dữ liệu thực:

```sh
npm run typecheck
npm run lint
npm test
npm run build
npm run build:worker
npx wrangler deploy --dry-run
```

## Chuyển dữ liệu cũ

Không cần mở lại app Railway để chuyển dữ liệu nếu Postgres nguồn còn truy cập được. Công cụ chuyển chạy **read-only ở nguồn**, giữ UUID, timestamp và toàn bộ dữ liệu nghiệp vụ; đối soát số dòng và SHA-256 từng bảng trước khi commit đích. Session cũ không chuyển. Mật khẩu bcrypt cũ có thể nhập bằng API quản trị Supabase Auth, không cần biết mật khẩu rõ.

Xem [docs/MIGRATION.md](docs/MIGRATION.md); không chạy `--apply` khi chưa có backup và xác nhận đúng database đích. Không chạy seed/reset ở database thật.

## Vận hành

File đầu vào và báo cáo tạm giữ 7 ngày; metadata tác vụ hết hạn được dọn sau 30 ngày. Dữ liệu đơn/scan không tự bị xóa theo hạn này. Phần dọn dữ liệu vận hành cũ vẫn có xem trước, xuất danh sách và xác nhận của quản trị viên.

Không có hệ thống nào bảo đảm tuyệt đối không lỗi. Cần backup PostgreSQL và Storage riêng, kiểm thử khôi phục, theo dõi worker/queue, cảnh báo tài nguyên và kiểm thử tải theo quy mô shop. [Kiến trúc](docs/ARCHITECTURE.md) · [Kiểm chứng](docs/VALIDATION.md) · [Đơn hoàn](docs/RETURN_MANAGEMENT.md).

Rà soát mở ca, danh mục và tổng quan đơn hoàn: [docs/OPERATIONS_REVIEW.md](docs/OPERATIONS_REVIEW.md).
