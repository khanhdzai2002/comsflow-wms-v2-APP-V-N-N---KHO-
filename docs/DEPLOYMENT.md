# Triển khai dự án mới

Web/API được triển khai trên Cloudflare Worker riêng; chủ dự án đã báo `/api/health` trả `{"ok":true,"database":"connected"}` sau khi gắn Hyperdrive ngày 2026-10-23. Chưa xác nhận đăng nhập, dịch vụ Node xử lý file hoặc di chuyển dữ liệu Railway. Không đổi cấu hình/database/domain Railway cũ. Không gửi mật khẩu, service key hoặc DATABASE_URL vào chat/Git.

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

**PDF xuất kho trực tiếp:** bản `2026-10-24.browser-pdf-1` đọc J&T/BEST/TikTok và SPX/GHN/Shopee trong module worker trên trình duyệt. Giới hạn giữ ở 20 file mỗi lần, 50 MB / 3.000 trang mỗi file; đọc tuần tự, giải phóng từng trang và có nút dừng. API nhận text tối đa 20 trang/288 KB mỗi yêu cầu, tự xác định mã/sàn/hãng, bảo vệ thứ tự và chống gửi lặp, không chạy PDF.js trong Cloudflare. Các job `sources/browser/*` không vào hàng đợi Node. Không cần tạo Render, thêm secret, binding hay migration.

PDF gốc được tải trực tiếp vào private Storage; API kiểm tra kích thước, chữ ký `%PDF-` và SHA-256 bằng native streaming digest trên Cloudflare trước khi đối chiếu/lưu. Text trang và số trang do browser trích xuất là đầu vào chưa tin cậy, được phân tích lại theo quy tắc tem; kiểm tra hash bản gốc không phải chứng thực mật mã rằng text browser khớp từng glyph của PDF. Server không nhận danh sách vận đơn hoặc số tổng do client tự khai để ghi thẳng vào nghiệp vụ. Các kiểm tra quyền, kho/sàn/shop/hãng, danh tính vận đơn, dữ liệu hiện tại, nguồn đã loại bỏ và giao dịch/audit vẫn có hiệu lực.

Sau rollout: vào **Nhập dữ liệu → PDF tem vận đơn**, chọn kho/shop/ngày xuất, để tự nhận dạng sàn/hãng, chọn PDF và bấm **Đọc và đếm PDF**, kiểm tra rồi xác nhận lưu. Giữ tab mở trong lúc đọc. F5/mất phản hồi: chọn lại đúng file và cùng thông tin để tiếp tục từ số trang đã gửi; commit đã thành công trả lại cùng kết quả. PDF ảnh/mật khẩu hoặc tem không đủ bằng chứng vẫn bị chặn để tránh nhập thiếu/mã đoán. Việc quét thực tế là bước riêng sau nhập nguồn.

**Ngoại lệ CSV TikTok:** bản `2026-10-24.tiktok-csv-1` nhập mẫu CSV đơn hoàn trực tiếp qua Cloudflare/Supabase, không cần Render hoặc Node processor. Giới hạn riêng **1 MB / 2.000 dòng**, phù hợp mẫu 777 yêu cầu do chủ dự án cung cấp. Không cần migration, binding hay secret mới. Sau rollout, dùng **Quản lý đơn hoàn → Nhập dữ liệu đơn hoàn**, chọn CSV gốc, đọc/đối chiếu và xác nhận lưu. CSV sàn khác, XLSX, luồng PDF legacy và các báo cáo cũ vẫn dùng processor bên dưới.

CSV gốc được tải trực tiếp lên private Storage. API tải lại, xác minh kích thước/SHA-256 và kiểm tra các trường; không tin các dòng đã chuẩn hóa hoặc fingerprint do browser gửi. Preview và commit là hai thao tác riêng. Toàn bộ hồ sơ, SKU, kiện, snapshot, audit và kết quả job lưu trong cùng giao dịch; retry commit nhận kết quả đã lưu. Nếu F5 sau upload, chọn lại file để tiếp tục hoặc bấm **Đọc CSV trực tiếp** trong Tác vụ dữ liệu. Job CSV được loại khỏi hàng đợi Node. Không coi trạng thái preview hoàn tất là dữ liệu đã được nhập.

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

## Đường kết nối Hyperdrive

Binding HYPERDRIVE của resource `comsflow-wms-db` đã được lưu trong cấu hình Git, xem [HYPERDRIVE.md](HYPERDRIVE.md). Query caching phải tắt. Origin vẫn là Supabase; việc gắn resource không chuyển dữ liệu Railway.

## Không thấy nút Tạo Admin đầu tiên

Mở `/api/auth/setup-status`. Phản hồi giữ `available` và thêm `code`, `message` để phân biệt các trường hợp; không trả mã thiết lập, email, mật khẩu hoặc danh sách tài khoản. Phản hồi không được cache.

- `SETUP_TOKEN_MISSING`: thêm runtime **Secret** `SETUP_TOKEN` trên đúng Worker/môi trường Production rồi Deploy.
- `SETUP_TOKEN_INVALID`: sửa giá trị thành mã riêng dài 32–256 ký tự, lưu riêng và Deploy; không gửi qua chat.
- `USERS_EXIST`: đã có ít nhất một tài khoản, kể cả tài khoản bị khóa. Không xóa users hoặc bỏ kiểm tra để tạo admin lại. Kiểm tra tài khoản hiện có và làm quy trình khôi phục có xác thực chủ sở hữu.
- `SETUP_READY`: nút Tạo Admin đầu tiên được bật. Nhập mã đã lưu riêng cùng email/name/password của quản trị viên. Sau khi tạo thành công, bỏ Secret `SETUP_TOKEN` và Deploy lại.

Nếu endpoint chỉ trả `available` thì bản mới chưa phục vụ request này. Kiểm tra build theo tên commit, chờ rollout rồi tải lại. Màn hình đăng nhập hiển thị lý do chưa mở thiết lập và có nút kiểm tra lại; lỗi API được hiển thị thay vì làm nút biến mất im lặng. Người đã có tài khoản vẫn đăng nhập bình thường.

### Tạo Admin bằng dashboard khi chưa cập nhật được bản web

Chủ project có thể dùng Supabase Dashboard để tạo Admin đầu tiên, không phụ thuộc SETUP_TOKEN hoặc bản web mới. Trong **Authentication → Users → Add user → Create new user**, đặt email/password riêng và bật **Auto Confirm User**. Trigger migration15 tạo hồ sơ chưa active và role staff; đây là trạng thái chờ cấp quyền, không phải lỗi password. Không gửi password qua chat hoặc đưa vào SQL.

Mở `scripts/sql/provision-first-admin.sql`, thay đúng một placeholder `THAY_EMAIL_VUA_TAO` bằng email đã tạo, chạy trong SQL Editor project `lyeyjfvxmqruszgfrjze`. Script chỉ cấp admin/active cho hồ sơ đã liên kết với đúng Auth user và email đã xác nhận; giữ nguyên ID, Auth credential và dữ liệu nghiệp vụ. Role/active trong database vẫn là nguồn quyền có hiệu lực. Không chỉnh trực tiếp bảng auth, không cấp quyền qua metadata do browser kiểm soát, không tạo endpoint tự nâng quyền.

Script dùng cùng advisory lock với bootstrap, ghi audit trước/sau khi thay quyền, chạy lại không ghi trùng audit. Nếu đã có một Admin active khác, email chưa xác nhận hoặc hồ sơ chưa liên kết thì dừng và rollback. Không xóa tài khoản để vượt kiểm tra. Sau thông báo `Admin ready`, đăng nhập bằng email/password đã đặt trong Authentication; nút tạo Admin đầu tiên lúc này đóng là bình thường.

## Rà soát vận hành và khởi tạo danh mục

Xem [OPERATIONS_REVIEW.md](OPERATIONS_REVIEW.md). Bản `2026-10-23.operations-1` có thiết lập danh mục được ghi audit trong app, lựa chọn kho theo catalog mới tải, đổi quyền nhân viên và tổng quan hoàn với các nhóm hãng mở được danh sách. Với database đã có tài khoản, dùng nút **Thiết lập danh mục cơ bản** hoặc **Cấu hình hệ thống → Bổ sung danh mục cơ bản**, không chạy seed demo/installer để sửa lỗi mở ca. Không cần migration mới hay đổi Hyperdrive/secret cho bản này.

`/health` trả thêm appRevision, API trả header X-ComsFlow-App-Revision và references trả trạng thái processor. Không coi build Ready hoặc database connected là xác nhận processor hoạt động. Excel, báo cáo và luồng legacy vẫn cần Node worker riêng theo mục3; PDF xuất kho trực tiếp và CSV hoàn TikTok không phụ thuộc heartbeat. Bản web không tự mua hay tạo background service.

## Nhận diện hãng vận đơn hoàn

Bản `2026-10-24.return-carriers-1` dùng chung service nhận diện với gợi ý xuất kho. Ưu tiên hãng đã xác minh → tên hãng/alias hợp lệ trong file → tiền tố đang bật do Admin cấu hình (dài nhất trước) → mẫu mã đầy đủ. Mặc định: J&T 85/86 và đủ 12 số; SPXVN + 11 số + 1 chữ; BEST TTVN + 8–16 số; GHN VNGH + 11 số hoặc G + 7 chữ/số; Viettel Post VTPVN + 10 số. Không áp các mẫu chưa có bằng chứng cho GHTK/Ninja hoặc suy ra hãng chỉ vì sàn. Quy tắc tắt không bị fallback mẫu bật lại. Có thể xem mẫu tại Cấu hình hệ thống; tiền tố tùy chỉnh vẫn được giữ.

Không cần SQL/migration hoặc nhập lại file: dashboard, bộ lọc, danh sách và chi tiết tự phân giải hãng cho dữ liệu cũ chưa có hãng, trong giao dịch đọc. Nhập file mới lưu nguồn nhận diện; hãng đã xác minh thủ công và lịch sử nhận/kiểm/khiếu nại được giữ. Nếu danh mục thiếu hãng, Admin bổ sung hãng/tên gọi tại Cấu hình hệ thống. Không tự tạo ID hãng khi chỉ đọc dữ liệu.

Hai nhóm có ý nghĩa riêng: `unknown` = có mã nhưng chưa nhận diện hãng; `no_tracking` = không có kiện/mã hoàn active. Mở nhóm ở dashboard dùng carrierScope=exclusive để số đếm khớp danh sách. Nhóm nhiều hãng/known+unknown vẫn riêng. Mã chỉ có vài ký tự được giữ để đối chiếu, không đoán hãng từ tiền tố mặc định.

## Đối soát xuất kho hai chiều (2026-10-25)

Bản `2026-10-25.bidirectional-scans-1` cần migration **018**. Sau khi xác nhận đúng project Supabase `lyeyjfvxmqruszgfrjze` và có bản sao lưu database có thể khôi phục, chạy `supabase/upgrade-018.sql` trong SQL Editor. Có thể sao chép toàn bộ SQL từ thông báo nâng cấp trong app (tài khoản Admin); không cần tải file. Script kiểm tra đủ 17 migration cũ, khóa triển khai và checksum, chỉ thêm bảng/index/view; chạy lại an toàn. Fresh install dùng `supabase/bootstrap.sql` gồm 18 migration. Không dùng upgrade này để nhập dữ liệu Railway. Chưa thực thi thay đổi trên production từ workspace.

Trước khi nâng cấp, đăng nhập và nhật ký cũ vẫn đọc được; mã chưa có nguồn vẫn được ghi vào `scan_events`. Nhập nguồn xuất kho sẽ báo thiếu nâng cấp, không thông báo khớp thành công giả. Sau khi chạy SQL, bấm **Kiểm tra lại sau khi chạy SQL** hoặc tải lại trang. Cần triển khai lại Node processor nếu đang sử dụng nhập CSV/XLSX truyền thống hoặc xuất lịch sử quét.

Luồng hai chiều:

- Nhập file trước → quét mã: xác minh nguồn như trước.
- Quét trước → file chưa có: server lưu mã chuẩn hóa, mã thô, người/giờ/ca/kho và hãng người dùng chọn; hiển thị **ĐÃ LƯU — CHỜ FILE ĐỐI SOÁT**. Đây là lượt quét đã lưu, chưa phải vận đơn đã tít hợp lệ.
- Xác nhận nhập PDF hoặc CSV/XLSX: trong cùng transaction lưu nguồn, tự khớp mã vận đơn chính xác, đúng kho và hãng đã chọn (nếu có). Hãng suy đoán từ định dạng chỉ là gợi ý, không ghi đè hãng của nguồn. Không dùng mã đơn sàn để đoán mã vận đơn.
- Chỉ nguồn chờ xử lý/chờ quét được chuyển thành đã tít. Hủy/chặn/review, sai kho hoặc hãng không tự khớp; giữ lượt chờ để kiểm tra. Không tự xác nhận bàn giao.
- Giữ giờ/người/ca của lượt hợp lệ đầu tiên, kể cả ca đã kết thúc; lượt lặp thành quét trùng và không tăng tổng vận đơn. Ngày dự kiến xuất theo nguồn; biểu đồ hoạt động theo giờ quét gốc, không phải giờ nhập file.
- Lịch sử gốc `scan_events` không sửa/xóa. `scan_reconciliations` lưu liên kết và audit; `effective_scan_events` dùng cho dashboard, nhật ký cá nhân/quản lý, chi tiết vận đơn, CSV lịch sử. CSV có thêm `original_outcome` và `reconciled_at`; response JSON gốc còn nguyên. Retry cùng request ID không tạo lượt mới; nếu mã đã khớp file, phản hồi kèm kết quả đã khớp và cùng ID/giờ gốc. Nhật ký đang tự cập nhật cũng hiển thị trạng thái đối soát hiện tại.
- Khóa mã được lấy theo cùng thứ tự giữa quét và cả hai đường nhập; không bỏ lỡ lượt quét trong khoảng nguồn chưa được tạo. Gửi lại/import lại không nhân bản kết quả.
- Tác vụ dọn nhật ký giữ mọi lượt `unknown` gốc, bao gồm lượt chờ và lượt đã tự khớp, để không xóa bằng chứng đối soát. Chưa có công cụ dọn riêng cho các bằng chứng này.

Acceptance sau triển khai và migration: mở ca → quét một mã fixture chưa có nguồn → F5 còn **Chờ file đối soát** → xác nhận nhập file chứa mã đó → nhật ký và Tổng quan hiện đã tít đúng một lần, đúng giờ/người quét cũ → quét lại báo trùng. Thử thêm mã lệch kho/hãng và nguồn hủy để kiểm tra chúng không thành công. Chỉ thử fixture trên staging; production dùng dữ liệu nghiệp vụ do chủ kho chủ động chọn, không tự thêm dữ liệu thử.

## Sửa quyền Hyperdrive sau đối soát hai chiều (019)

Nếu schema 018 đã có nhưng Tổng quan/nhật ký báo lỗi, tài khoản server `comsflow_connection_check` được cấp quyền theo danh sách cũ có thể thiếu SELECT trên view `effective_scan_events` và SELECT/INSERT + RLS policy trên bảng `scan_reconciliations`. Kết nối database vẫn thành công; PostgreSQL trả `42501` khi đọc view mới. Các kiểm thử dùng chủ database trước đây không phát hiện thiếu sót này.

Bản `2026-10-25.prescan-permissions-1` phát hiện quyền thiếu, giữ thông báo nâng cấp riêng cho trường hợp chưa có schema, và hiện SQL **sửa quyền 019** cho Admin ngay trên app. Sau khi chọn đúng project `lyeyjfvxmqruszgfrjze` và có bản sao lưu, chạy `supabase/upgrade-019.sql` trong SQL Editor bằng tài khoản chủ project. Đây là cấp quyền cho server; không thay mật khẩu, không sửa/xóa dữ liệu vận đơn, không cấp quyền cho `anon`/`authenticated`, không bật BYPASSRLS. SQL thêm policy cho server và chỉ SELECT/INSERT trên nhật ký đối soát; UPDATE/DELETE vẫn bị chặn. Migration 018 giữ nguyên checksum. SQL sửa quyền có thể chạy lại ngay cả khi ledger đã ghi 019.

`supabase/upgrade-018.sql` mới chứa cả 018 + 019 để nâng từ bản 17 trong một lần. Fresh bootstrap có 19 migration. Script `scripts/sql/grant-hyperdrive-runtime.sql` cũng cấp đúng quyền đối soát nếu resource được tạo trước tài khoản Hyperdrive. Nếu tài khoản runtime là role tùy chỉnh khác, Admin cần rà soát/cấp quyền cho đúng role; script không tự cấp quyền cho role bất kỳ.

Chưa thực hiện SQL sửa quyền trên production từ workspace. Sau khi chủ project chạy SQL, F5: thông báo thiếu quyền biến mất; Tổng quan tải được, lượt quét cũ giữ nguyên. Nếu chưa lên bản giao diện mới, có thể chạy SQL sửa quyền ngay từ SQL Editor; bản app cũ cũng đọc lại view được sau khi cấp quyền.
