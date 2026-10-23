# Đưa ComsFlow v2 lên Cloudflare bằng giao diện

Supabase đã được chủ dự án xác nhận có 17 migration. Mã nguồn mới dùng repository `khanhdzai2002/comsflow-wms-v2-APP-V-N-N---KHO-`, branch `main`. Không thay Worker KOC HUB hoặc service Railway.

## 1. Kết nối repository

1. Đăng nhập https://dash.cloudflare.com, chọn tài khoản đang sử dụng.
2. Vào **Workers & Pages → Create application**. Chọn tạo **Worker** và kết nối/import repository GitHub (tên nút có thể là **Import a repository / Connect Git**).
3. Chọn repository `comsflow-wms-v2-APP-V-N-N---KHO-`, branch `main`. Nếu không thấy repo private, mở cấu hình GitHub App của Cloudflare và cấp quyền cho đúng repo mới này, rồi tải lại danh sách.
4. Đặt tên Worker **`comsflow-wms-v2`**, phù hợp `wrangler.jsonc`.

## 2. Build và deploy

| Trường | Giá trị |
|---|---|
| Build command | `npm run build` |
| Deploy command | `npx wrangler deploy` |
| Root directory | Gốc repository; để mặc định nếu không dùng thư mục con |
| Production branch | `main` |
| Node.js | 24, hoặc phiên bản phù hợp engines trong package.json |

Deploy này chỉ tạo web/API. URL Worker do Cloudflare cấp sau khi triển khai; đây mới là URL mở ComsFlow, không phải Project URL Supabase. Chưa đăng nhập/vận hành được nếu chưa cấu hình đủ runtime secrets và tài khoản.

## 3. Runtime secrets

Sau khi Worker được tạo, mở **Worker → Settings → Variables and Secrets**. Khai báo trực tiếp các giá trị sau bằng kiểu **Secret**, lưu/apply/deploy theo giao diện:

- `DATABASE_URL`: lấy từ **Supabase → Connect**, chọn pooler phù hợp và SSL. Chọn đúng project `lyeyjfvxmqruszgfrjze`; mật khẩu chứa ký tự đặc biệt cần URL-encode.
- `SUPABASE_SERVICE_ROLE_KEY`: lấy legacy `service_role` key của cùng project, chỉ dùng trên server. Không gửi vào chat, Git, frontend hoặc biến `VITE_*`.
- `APP_ORIGIN`: origin HTTPS chính xác của Worker mới, ví dụ domain Cloudflare vừa cấp, không thêm `/` cuối hoặc đường dẫn.

`SUPABASE_URL`, Publishable key (`SUPABASE_ANON_KEY`), `STORAGE_BUCKET` đã có trong `wrangler.jsonc`; không tạo thêm secret trùng tên các vars này. Secrets của **build environment** và **runtime Worker** có thể nằm ở hai màn hình khác nhau; các biến trên phải tồn tại ở runtime.

Mở `/health` để kiểm tra runtime và `/api/health` để kiểm tra database. Hai bước này chưa chứng minh đã có tài khoản, đã chuyển dữ liệu hoặc worker đọc file hoạt động.

## 4. Trước khi vận hành

- Nếu giữ dữ liệu Railway: làm theo `MIGRATION.md`, đối soát và liên kết Supabase Auth trước khi tạo Admin mới. Không chạy seed, xóa bảng hoặc reset database thật.
- Deploy worker nền riêng theo `DEPLOYMENT.md`/`Dockerfile.worker`; cần secret server trên host worker. Chưa có worker thì PDF/Excel/báo cáo sẽ chờ trong hàng đợi. Render blueprint là tài nguyên có phí, cần xem giá trước khi tạo.
- Chỉ thông báo hệ thống sẵn sàng khi đã đăng nhập, thử quét, có heartbeat worker, đọc/lưu PDF, tải báo cáo và kiểm tra backup. Tính đến lúc viết tài liệu này chưa có xác nhận deployment production.
