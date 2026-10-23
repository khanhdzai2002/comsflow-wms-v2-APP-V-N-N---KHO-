# Kết nối Cloudflare tới Supabase qua Hyperdrive

Dùng Hyperdrive để Cloudflare quản lý kết nối tới PostgreSQL. Dữ liệu, Auth và Storage vẫn ở project Supabase hiện có. Không chuyển dữ liệu hoặc tạo database mới. API ưu tiên binding `HYPERDRIVE`; background worker Node tiếp tục dùng `DATABASE_URL` trên host riêng.

## Tạo resource trên tài khoản Cloudflare

Từ dashboard cấp tài khoản, tìm **Hyperdrive** (thường trong **Storage & databases**) và chọn **Create configuration**. Tên gợi ý `comsflow-wms-db`. Chọn PostgreSQL và nhập các tham số Session pooler lấy từ Connect của chính project Supabase:

| Trường   | Giá trị hiện tại do chủ dự án cung cấp                                 |
| -------- | ---------------------------------------------------------------------- |
| Host     | `aws-0-ap-northeast-2.pooler.supabase.com`                             |
| Port     | `5432`                                                                 |
| Database | `postgres`                                                             |
| User     | `postgres.lyeyjfvxmqruszgfrjze`                                        |
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
