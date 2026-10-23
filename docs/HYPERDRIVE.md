# Kết nối Cloudflare tới Supabase qua Hyperdrive

Dùng Hyperdrive để Cloudflare quản lý kết nối tới PostgreSQL. Dữ liệu, Auth và Storage vẫn ở project Supabase hiện có. Không chuyển dữ liệu hoặc tạo database mới. API ưu tiên binding `HYPERDRIVE`; background worker Node tiếp tục dùng `DATABASE_URL` trên host riêng.

## Tạo resource trên tài khoản Cloudflare

Từ dashboard cấp tài khoản, tìm **Hyperdrive** (thường trong **Storage & databases**) và chọn **Create configuration**. Tên gợi ý `comsflow-wms-db`. Chọn PostgreSQL và nhập các tham số **Direct connection** lấy từ Connect của chính project Supabase. [Cloudflare khuyến nghị dùng Direct connection cho Supabase](https://developers.cloudflare.com/hyperdrive/examples/connect-to-postgres/postgres-database-providers/supabase/) vì Hyperdrive đã thực hiện pooling:

| Trường   | Giá trị hiện tại do chủ dự án cung cấp                                 |
| -------- | ---------------------------------------------------------------------- |
| Host     | `db.lyeyjfvxmqruszgfrjze.supabase.co`                                  |
| Port     | `5432`                                                                 |
| Database | `postgres`                                                             |
| User     | `postgres`                                                             |
| Password | Mật khẩu database, nhập trực tiếp trong trường password của Cloudflare |

Bật TLS cho kết nối origin theo lựa chọn bảo mật mà Hyperdrive cung cấp. Tắt **Query caching** / bật **Disable caching** để đọc mới trạng thái quét/quyền/kho. Giữ pooling hoạt động. Chi phí và quota theo gói hiển thị trong dashboard Cloudflare.

Chạy **Test connection** nếu màn hình cung cấp. Nếu kiểm tra lỗi, giữ thông báo đã che thông tin nhạy cảm để xử lý origin trước khi gắn vào app. Nếu thành công, lưu resource và sao chép **Hyperdrive ID** (không phải mật khẩu). Origin password lưu ở resource Cloudflare, không đưa vào Git/chat.

## Gắn resource vào Worker

Sau khi có ID thật, thêm vào `wrangler.jsonc` rồi deploy:

```json
"hyperdrive": [{"binding":"HYPERDRIVE","id":"ID_THAT_DO_CLOUDFLARE_CAP"}]
```

Ví dụ trên là cấu trúc minh họa, không deploy placeholder. `keep_vars` giữ dashboard Variables nhưng không thay thế khai báo binding này. Không chỉ thêm binding trên dashboard rồi để Git deploy xóa mất.

Ứng dụng chọn `HYPERDRIVE.connectionString` nếu binding tồn tại; binding lỗi/trống sẽ báo lỗi rõ ràng và không tự trỏ sang URI khác. Worker kết nối tới endpoint nội bộ của Hyperdrive, Hyperdrive quản lý TLS tới origin. Không gửi `statement_timeout`/tùy chọn ORM làm startup parameter. Không thay đổi fetch_types khi chưa kiểm chứng các kiểu mảng.

## Nghiệm thu

- Bản health `.7` trở lên có `configuration.connectionMode: "hyperdrive"` khi lỗi. Thành công vẫn trả `{ "ok": true, "database": "connected" }`.
- Kiểm tra kết nối, đăng nhập, đọc quyền/kho, quét một mã và đọc lại trạng thái ngay; xác minh Query caching thực sự tắt.
- Kiểm tra transaction/idempotency và đóng request; không coi local simulation là xác nhận hosted Hyperdrive đã hoạt động.
- Giữ các Secret Auth/Storage hiện tại. Không chạy SQL bootstrap/seed hoặc xóa dữ liệu để sửa lỗi kết nối.

## Đính chính đường kết nối origin

Hướng dẫn ban đầu đã dùng Session pooler; tài liệu Cloudflare chính thức yêu cầu Direct connection cho Hyperdrive. Đổi host/user theo bảng ở trên, giữ cổng5432 và mật khẩu database gốc. Không mặc định lỗi Invalid credentials chứng minh mật khẩu sai: cần Testconnection trên đườngdirect hoặc log provider để xác định. Sharedpooler Supabase có cơ chế cachecredential/circuitbreaker sau passwordrotation; việc đó chưa được xác nhận là nguyên nhân của project này.

## Phép thử bằng tài khoản LOGIN/CONNECT mới

Nếu Hyperdrive vẫn báo Invalid database credentials sau khi xác nhận đúng Direct host/user, dùng `scripts/sql/create-connection-check.sql` trong SQL Editor của đúng project. Script kiểm tra marker ComsFlow, tạo role `comsflow_connection_check` với mật khẩu ngẫu nhiên dạng hex và chỉ cấp CONNECT; không đổi password postgres, không sửa dữ liệu, không tự reset role nếu đã tồn tại. Kết quả chứa secret: chỉ sao chép riêng vào Hyperdrive, không gửi qua chat/Git.

Thử Direct host `db.lyeyjfvxmqruszgfrjze.supabase.co`, port5432, databasepostgres, username `comsflow_connection_check`, password từ kết quả SQL. Giữ query caching tắt. Role này chỉ dùng xác minh đường đăng nhập, chưa dùng cho API đọc/ghi. Nếu Testconnection thành công cần cấp quyền ứng dụng được rà soát trước khi bind; nếu vẫn lỗi, kiểm tra log/network của provider thay vì tiếp tục đổi mật khẩu.

## Resource đã tạo cho project này

Chủ dự án đã kiểm tra đăng nhập thành công và lưu resource `comsflow-wms-db`, ID `8c06ca81531944b784e94ae3f3c404b4`. Ảnh dashboard xác nhận Direct host, port5432, user `comsflow_connection_check`, query caching disabled. ID không phải secret và đã khai báo trong `wrangler.jsonc`; mật khẩu vẫn chỉ ở Hyperdrive. Đây là xác nhận resource, chưa phải nghiệm thu API hosted.

Trước khi API dùng role này, chạy **`scripts/sql/grant-hyperdrive-runtime.sql`** trong SQL Editor đúng project `lyeyjfvxmqruszgfrjze`. Script giữ nguyên password, grant USAGE schema public, SELECT migration markers và SELECT/INSERT/UPDATE/DELETE trên allowlist 48 bảng ứng dụng. Policy RLS riêng chỉ áp dụng cho role backend, không cấp quyền anon/authenticated, không tắt RLS, không cấp postgres/BYPASSRLS/CREATE, không đổi owner hay dữ liệu. Các trigger bảo vệ lịch sử vẫn chạy. Auth/Storage tiếp tục qua service-role API key; không grant trực tiếp bảng auth/storage. Schema migration mới phải rà soát bổ sung allowlist; không tự grant bảng tương lai. Chạy lại script không reset password.

Kết quả mong đợi: `ComsFlow Hyperdrive application permissions ready`. Script không trả secret. Sau khi build tự động hoàn tất, mở `/api/health` và yêu cầu `{ "ok": true, "database": "connected" }`, rồi kiểm tra đăng nhập/quyền/kho. Nếu role thiếu quyền, sửa đúng grants/policy; không gán quyền admin toàn database hoặc chạy lại bootstrap/seed.
