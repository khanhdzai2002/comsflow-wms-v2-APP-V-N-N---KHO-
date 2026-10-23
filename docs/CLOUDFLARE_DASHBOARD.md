# Đưa ComsFlow v2 lên Cloudflare bằng giao diện

Supabase đã được chủ dự án xác nhận có 17 migration. Mã nguồn mới dùng repository `khanhdzai2002/comsflow-wms-v2-APP-V-N-N---KHO-`, branch `main`. Không thay Worker KOC HUB hoặc service Railway.

## 1. Kết nối repository

1. Đăng nhập https://dash.cloudflare.com, chọn tài khoản đang sử dụng.
2. Vào **Workers & Pages → Create application**. Chọn tạo **Worker** và kết nối/import repository GitHub (tên nút có thể là **Import a repository / Connect Git**).
3. Chọn repository `comsflow-wms-v2-APP-V-N-N---KHO-`, branch `main`. Nếu không thấy repo private, mở cấu hình GitHub App của Cloudflare và cấp quyền cho đúng repo mới này, rồi tải lại danh sách.
4. Worker đã được chủ dự án tạo với tên **`comsflow-wms-v2-app-v-n-n---kho`**; `wrangler.jsonc` đã được cập nhật khớp tên này. Không tạo thêm Worker khác để thay thế.

## 2. Build và deploy

| Trường            | Giá trị                                                |
| ----------------- | ------------------------------------------------------ |
| Build command     | `npm run build`                                        |
| Deploy command    | `npx wrangler deploy`                                  |
| Root directory    | Gốc repository; để mặc định nếu không dùng thư mục con |
| Production branch | `main`                                                 |
| Node.js           | 24, hoặc phiên bản phù hợp engines trong package.json  |

Deploy này chỉ tạo web/API. URL Worker do Cloudflare cấp sau khi triển khai; đây mới là URL mở ComsFlow, không phải Project URL Supabase. Chưa đăng nhập/vận hành được nếu chưa cấu hình đủ runtime secrets và tài khoản.

## 3. Runtime secrets

Sau khi Worker được tạo, mở **Worker → Settings → Variables and Secrets**. Khai báo trực tiếp các giá trị sau bằng kiểu **Secret**, lưu/apply/deploy theo giao diện:

- `DATABASE_URL`: lấy từ **Supabase → Connect**, chọn pooler phù hợp và SSL. Chọn đúng project `lyeyjfvxmqruszgfrjze`; mật khẩu chứa ký tự đặc biệt cần URL-encode.
- `SUPABASE_SERVICE_ROLE_KEY`: lấy legacy `service_role` key của cùng project, chỉ dùng trên server. Không gửi vào chat, Git, frontend hoặc biến `VITE_*`.

`APP_ORIGIN`, `SUPABASE_URL`, Publishable key (`SUPABASE_ANON_KEY`), `STORAGE_BUCKET` đã có trong `wrangler.jsonc`; không tạo thêm secret trùng tên các vars này. Domain đã cấu hình là `https://comsflow-wms-v2-app-v-n-n---kho.comsflow-apps.workers.dev`. Nếu trước đó đã tự khai báo `APP_ORIGIN` là secret, cần bỏ binding secret trùng tên để Wrangler quản lý bằng vars. Secrets của **build environment** và **runtime Worker** có thể nằm ở hai màn hình khác nhau; DATABASE_URL và SUPABASE_SERVICE_ROLE_KEY phải tồn tại ở runtime.

Mở `/health` để kiểm tra runtime và `/api/health` để kiểm tra database. Hai bước này chưa chứng minh đã có tài khoản, đã chuyển dữ liệu hoặc worker đọc file hoạt động.

## 4. Trước khi vận hành

- Nếu giữ dữ liệu Railway: làm theo `MIGRATION.md`, đối soát và liên kết Supabase Auth trước khi tạo Admin mới. Không chạy seed, xóa bảng hoặc reset database thật.
- Deploy worker nền riêng theo `DEPLOYMENT.md`/`Dockerfile.worker`; cần secret server trên host worker. Chưa có worker thì PDF/Excel/báo cáo sẽ chờ trong hàng đợi. Render blueprint là tài nguyên có phí, cần xem giá trước khi tạo.
- Chỉ thông báo hệ thống sẵn sàng khi đã đăng nhập, thử quét, có heartbeat worker, đọc/lưu PDF, tải báo cáo và kiểm tra backup. Tính đến lúc viết tài liệu này chưa có xác nhận deployment production.

## Chẩn đoán kết nối Pooler

Runtime tự bật TLS cho hostname Supabase nếu URI chưa chỉ định TLS; không gửi `statement_timeout` hay tùy chọn ORM làm startup parameter tới Supabase Pooler. `DATABASE_URL` phải dùng URI PostgreSQL đầy đủ, username `postgres.PROJECT_REF` của đúng project, mật khẩu database đã percent-encode khi cần. Hai khóa `DATABASE_URL` và `SUPABASE_SERVICE_ROLE_KEY` phải là runtime **Secret**, không đưa vào bundle hoặc gửi qua chat.

`/api/health` trả 503 kèm `code`, `hint` và mã yêu cầu khi kết nối thất bại; không trả thông báo thô của provider hay URI. `DB_URL_MISSING` nghĩa là thiếu binding runtime; `DB_AUTH_FAILED` yêu cầu kiểm tra username/mật khẩu; `DB_POOLER_USER_INVALID` yêu cầu kiểm tra project trong username; `DB_CONNECT_TIMEOUT` yêu cầu kiểm tra trạng thái project/địa chỉ/cổng; `DB_SCHEMA_INCOMPLETE` yêu cầu kiểm tra đang trỏ đúng project đã cài schema. Không xóa bảng hoặc seed để chữa lỗi kết nối. Trạng thái thành công vẫn là `{"ok":true,"database":"connected"}`.
