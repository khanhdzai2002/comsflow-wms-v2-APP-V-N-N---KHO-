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
2. Giữ tên Worker `comsflow-wms-v2-app-v-n-n---kho` đã được chủ dự án tạo và đã cấu hình trong `wrangler.jsonc`; không tái sử dụng Worker KOC HUB.
3. APP_ORIGIN, SUPABASE_URL và SUPABASE_ANON_KEY công khai của project đã được cấu hình trong `wrangler.jsonc`. Thêm secrets qua `npx wrangler secret put TEN_BIEN`, nhập riêng từng giá trị: DATABASE_URL, SUPABASE_SERVICE_ROLE_KEY. Không khai báo cùng tên đồng thời là secret và vars. APP_ORIGIN hiện là `https://comsflow-wms-v2-app-v-n-n---kho.comsflow-apps.workers.dev`; nếu đã tự đặt secret APP_ORIGIN thì bỏ binding secret trùng tên trước khi deploy cấu hình này. Không đưa key bí mật vào biến VITE_*.
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

## Chẩn đoán kết nối Pooler

Runtime tự bật TLS cho hostname Supabase nếu URI chưa chỉ định TLS; không gửi `statement_timeout` hay tùy chọn ORM làm startup parameter tới Supabase Pooler. `DATABASE_URL` phải dùng URI PostgreSQL đầy đủ, username `postgres.PROJECT_REF` của đúng project, mật khẩu database đã percent-encode khi cần. Hai khóa `DATABASE_URL` và `SUPABASE_SERVICE_ROLE_KEY` phải là runtime **Secret**, không đưa vào bundle hoặc gửi qua chat.

`/api/health` trả 503 kèm `code`, `hint` và mã yêu cầu khi kết nối thất bại; không trả thông báo thô của provider hay URI. `DB_URL_MISSING` nghĩa là thiếu binding runtime; `DB_AUTH_FAILED` yêu cầu kiểm tra username/mật khẩu; `DB_POOLER_USER_INVALID` yêu cầu kiểm tra project trong username; `DB_CONNECT_TIMEOUT` yêu cầu kiểm tra trạng thái project/địa chỉ/cổng; `DB_SCHEMA_INCOMPLETE` yêu cầu kiểm tra đang trỏ đúng project đã cài schema. Không xóa bảng hoặc seed để chữa lỗi kết nối. Trạng thái thành công vẫn là `{"ok":true,"database":"connected"}`.

Health cũng nhận dạng lỗi xác thực Supavisor dùng SQLSTATE `XX000`. Khi chưa phân loại được, phản hồi chỉ thêm `diagnostics.errorType` (tên exception trong danh sách cho phép) và `diagnostics.sqlState` (mã PostgreSQL 5 ký tự), tuyệt đối không trả message/stack thô. `DB_RUNTIME_IO_FAILED` chỉ ra vấn đề vòng đời I/O của adapter Cloudflare, không phải bằng chứng mật khẩu sai.

## Giữ cấu hình runtime qua deployment

`wrangler.jsonc` bật `keep_vars: true` để các Variable do chủ dự án thêm trên dashboard không bị xóa khi Git-triggered deployment chạy. Các public var khai báo trong repository vẫn được cập nhật từ cấu hình. Hai thông tin nhạy cảm `DATABASE_URL` và `SUPABASE_SERVICE_ROLE_KEY` phải dùng kiểu **Secret**, không đổi sang Variable chỉ để giữ cấu hình. Bản sửa không thể tự khôi phục giá trị đã mất; chủ dự án cần thêm lại key bị thiếu bằng dashboard.

Nếu health vẫn báo lỗi chưa nhận dạng, mở Worker → Observability → Logs, theo dõi trực tiếp rồi gọi lại `/api/health`. Tra theo `requestId`; xem trường `runtimeDetails` của log **Database health failed**. Log chỉ lấy error message đã giới hạn độ dài/che credential, không log stack hoặc truy vấn. Không đăng công khai log chưa kiểm tra; không gửi DATABASE_URL/key/mật khẩu.

## Chặn vòng lặp kết nối làm vượt subrequest

Bản chẩn đoán `.5` thay đường socket của API Cloudflare bằng adapter dùng `cloudflare:sockets` qua hook socket của postgres.js. Adapter hoàn tất PostgreSQL STARTTLS trước khi trao stream cho driver; đóng socket plaintext cũ khi nâng TLS không bị hiểu nhầm thành đóng kết nối TLS hiện tại. `ssl:false` ở phía driver chỉ ngăn nâng TLS lần thứ hai: Supabase vẫn bắt buộc TLS, hostname được xác thực bởi runtime Cloudflare, không bỏ kiểm tra certificate.

Mỗi request dùng một connection pool max = 1, tối đa 2 lần tạo transport và deadline 10 giây cho connect/TLS. Đóng lỗi trong startup được trả về ngay thay vì vòng reconnect không giới hạn. Lỗi `Too many subrequests` được phân loại `DB_SUBREQUEST_LIMIT`; không tăng quota để che vòng lặp. Worker Node đọc file giữ driver Node riêng. Không cần thay mật khẩu chỉ vì lỗi quota này.

Bản `.6` đợi đọc hết stream tới EOF trước khi báo socket đóng bình thường, giữ nguyên ErrorResponse/SQLSTATE mà máy chủ đã gửi trong buffer. Lỗi transport còn có `diagnostics.transportStage` trong danh sách cố định và bộ đếm `sentBytes`/`receivedBytes` (không chứa payload), giúp phân biệt lỗi TCP/TLS với đóng trước/sau phản hồi PostgreSQL. Đây không phải bằng chứng mật khẩu sai nếu chưa có SQLSTATE/response thực.
