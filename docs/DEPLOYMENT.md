# Triển khai dự án mới

Chưa có deployment production từ repository này. Cần một project Supabase mới, một Cloudflare Worker mới và một dịch vụ Node worker riêng. Không đổi cấu hình/database/domain Railway cũ. Không gửi mật khẩu, service key hoặc DATABASE_URL vào chat/Git.

## 1. Tạo Supabase

1. Vào **supabase.com/dashboard → New project**.
2. Đặt tên `comsflow-wms-v2`; chọn khu vực gần kho/worker, ví dụ Singapore nếu có. Lưu mật khẩu database trong trình quản lý mật khẩu.
3. Đợi project sẵn sàng. **Connect → Connection string → Session pooler / Transaction pooler**: lấy chuỗi kết nối phù hợp IPv4, SSL. Dùng `DATABASE_URL`; mật khẩu chứa ký tự đặc biệt phải URL-encode. Dùng cùng project cho mọi biến ở bước dưới.
4. **Project Settings → API / API Keys**: lấy Project URL, publishable/anon key, service-role key (server only). Tên màn hình có thể thay đổi theo dashboard.
5. **Authentication → Providers / Sign In**: tắt tự đăng ký công khai nếu dùng nội bộ; tài khoản tạo qua quản trị. Cấu hình Site URL/redirect URL trùng domain app mới. App dùng login password trực tiếp, không dùng khóa DB làm mật khẩu người dùng.

Copy `.env.example` thành `.env.local` trên máy triển khai, điền các biến qua nơi quản lý secret an toàn. Chạy `npm ci`.

**Nếu chuyển dữ liệu cũ:** đọc MIGRATION.md trước; chạy schema với `MIGRATION_SKIP_DEFAULTS=1`, rồi chuyển dữ liệu và Auth. Không tạo Admin/seed trước khi chuyển.

**Nếu bắt đầu database mới hoàn toàn:**

```sh
npm run db:migrate
npm run storage:setup
# Điền ADMIN_EMAIL / ADMIN_NAME / ADMIN_PASSWORD vào môi trường an toàn.
npm run db:admin
```

Không chạy seed demo trên Supabase. Không bật `SETUP_TOKEN` sau khi đã có user.

## 2. Deploy web/API lên Cloudflare

1. Đăng nhập Cloudflare bằng tài khoản của bạn; `npx wrangler login` trên máy có trình duyệt, hoặc cấu hình API token trong secret của CI.
2. Giữ tên Worker mới `comsflow-wms-v2` trong `wrangler.jsonc`; không tái sử dụng Worker KOC HUB.
3. Thêm secrets qua `npx wrangler secret put TEN_BIEN`, nhập riêng từng giá trị: DATABASE_URL, SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY, APP_ORIGIN. APP_ORIGIN là origin HTTPS chính xác của app mới, không có path/trailing slash. Không đưa key bí mật vào biến VITE_*.
4. `npm run deploy`. Cloudflare tạo URL Worker; cập nhật APP_ORIGIN và Supabase Site URL đúng URL đó nếu ban đầu dùng placeholder. Không báo hoàn tất khi chưa mở được `/health` và `/api/health`.
5. Kiểm tra đăng nhập tài khoản thử, role admin/staff, khóa user và origin. Dùng gói Workers đủ CPU cho API production; kiểm tra giới hạn và chi phí hiện hành trong dashboard.

`/health` chỉ kiểm tra runtime web; `/api/health` kiểm tra kết nối/schema database. Secret trống phải được cấu hình, không có cơ chế tự nối Railway.

Local Wrangler dùng `.dev.vars` với cùng tên biến, được gitignore. APP_ORIGIN local là `http://localhost:5173`; chạy Vite và Wrangler ở hai terminal. Production luôn HTTPS.

## 3. Deploy worker đọc file

Có `Dockerfile.worker` và `render.yaml`. Worker không cần public HTTP port. Có thể dùng VM/Docker hoặc dịch vụ background worker khác; không đặt vòng lặp này trong một Cloudflare request hoặc Supabase Edge Function.

- Build: `docker build -f Dockerfile.worker -t comsflow-worker .`
- Chạy container với các biến DATABASE_URL, SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY, STORAGE_BUCKET từ secret manager.
- Dành RAM thực tế khoảng 1–2 GB lúc khởi đầu; đo bằng các file thật 1.800–3.000 trang. Render blueprint đề xuất plan standard, **là tài nguyên có phí**, cần xem giá trước khi tạo. Không tự mua/nâng gói từ mã nguồn.
- Start command: `node .worker/main.mjs`; mỗi replica xử lý tuần tự, child heap 384 MB và timeout 8 phút. Bật auto restart trên host.
- Mục **Tác vụ dữ liệu** phải có heartbeat gần đây; thử đọc một PDF nhỏ, xem trước, xác nhận lưu, rồi thử file lớn.
- File tạm 7 ngày và metadata cũ 30 ngày được dọn bởi worker. Nếu worker tắt, việc dọn này tạm dừng; dữ liệu vận hành vẫn không bị tự xóa.

## 4. Điều kiện trước khi thay app cũ

- Đối soát đủ counts/hash dữ liệu di chuyển, đặc biệt scan_events và shipments; tải được CSV lịch sử ngày cần cứu.
- Đăng nhập/khóa user/quyền kho/role đúng; staff không tải báo cáo quản trị.
- Đã thử PDF J&T/BEST/SPX/GHN, trang nối, file trùng, file hỏng, F5, mất phản hồi sau commit, restart worker và tải báo cáo lớn.
- Backup PostgreSQL và file Storage có lịch/retention phù hợp; đã thử restore sang project thử riêng.
- Có theo dõi lỗi và dung lượng. Không xem test local là kiểm thử tải production hoặc chứng nhận camera/súng quét thật.

Giữ database Railway ở chế độ bảo toàn cho đến khi nghiệm thu xong. Không xóa service, volume hoặc chạy cleanup để “sửa lỗi”.
