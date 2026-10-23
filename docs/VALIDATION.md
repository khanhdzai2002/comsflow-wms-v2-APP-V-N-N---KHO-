# Kiểm chứng v2 — 23/10/2026

Đây là kết quả của dự án **comsflow-wms-supabase mới**, trên Node 24, PostgreSQL 17 local và Chromium. Không phải xác nhận deployment production, tải thực tế trên cloud hoặc dữ liệu Railway đã được chuyển.

| Kiểm tra                  | Kết quả                                                                                                                       |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| TypeScript                | `npm run typecheck` đạt                                                                                                       |
| ESLint                    | `npm run lint` đạt, không warning                                                                                             |
| Backend và parser         | **265/265**, 19 test files, đạt                                                                                               |
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

Bổ sung nhận dạng Supavisor `XX000` lỗi xác thực và lỗi vòng đời I/O Cloudflare; metadata lỗi chỉ dùng exception name trong allowlist và SQLSTATE, có kiểm thử chặn thông tin tùy ý. 231/231 test, typecheck, lint, frontend/worker build và Wrangler dry-run đạt. Chưa có kết quả health hosted xác nhận kết nối.

## Giữ biến runtime và log riêng đã che credential

Xác nhận từ schema/mã nguồn Wrangler rằng keep_vars mặc định false sẽ thay/xóa dashboard Variables; bật true để giữ binding qua deploy. Secret vẫn cần lưu dưới kiểu Secret, không thể khôi phục từ mã nguồn nếu đã mất. Thêm nhận dạng thông báo network gốc của cloudflare:sockets và log riêng giới hạn độ dài, che URI/key/mật khẩu thô và percent-encode, bearer/JWT, giá trị có dấu nháy; không log stack/query hoặc đưa runtimeDetails vào health response. 244/244 test (16 files), typecheck, lint, frontend/worker build và Wrangler dry-run đạt. Chưa có xác nhận hosted SQL kết nối thành công; cần chủ dự án thêm lại service-role Secret và lấy log health thực nếu lỗi còn tiếp diễn.

## Tạm tăng lưu log và dấu phiên bản health

Tạm bật logs/persist/invocation_logs rõ ràng và sampling 1 cho chẩn đoán; điều này hỗ trợ log đã lưu, không chứng minh Live Tail sẽ hoạt động. Health có diagnosticVersion/header và phase để kiểm chứng đúng phiên bản và giai đoạn lỗi, không trả runtimeDetails ra public. Toàn bộ 244 test, typecheck, lint, Vite build, worker build và Wrangler dry-run đạt. Chưa có nguyên nhân SQL hosted được xác nhận.

## Sửa vòng lặp socket/TLS gây vượt subrequest

Log hosted do chủ dự án cung cấp xác nhận lỗi `Too many subrequests by single Worker invocation`. Tái hiện với driver upstream và socket đóng lúc startup: 55 lần tạo transport trong 127 ms, do nhánh initial reconnect bỏ qua backoff và reset connect timeout. Tái hiện riêng TLS handoff: socket plaintext bị đóng trước khi writer TLS ready làm polyfill phát close sớm. Các bài tái hiện dùng fixture, không dùng credential hosted.

Adapter mới dùng hook socket chính thức của driver và cloudflare:sockets trực tiếp, hoàn tất TLS trước khi trao stream, chỉ theo dõi socket hiện tại, tối đa 2 transport/request và deadline connect/TLS 10 giây. Supabase vẫn dùng TLS có xác thực chứng chỉ; không tăng quota hay tắt xác thực. Node request có budget riêng; background Node không đổi driver.

Kiểm chứng sau thay đổi: 257/257 test (18 files), typecheck, lint, Vite build, worker build và Wrangler dry-run đạt. /api/health của Worker đầy đủ trong Wrangler local trả 200 connected, header diagnostic version .5. Actual Miniflare/workerd qua PostgreSQL local và STARTTLS proxy: SELECT1 và transaction có tham số (mã giữ số 0 đầu, số lượng 42) đều trả 200, mỗi request TLS chỉ 1 TCP connection. Trusted local CA hoạt động; bỏ CA bị chặn UnknownIssuer với 1 TCP, xác thực không bị vô hiệu hóa. Các kết quả local không thay thế kiểm tra health/login trên Supabase hosted sau deployment.

## Giữ phản hồi PostgreSQL khi socket đóng bình thường

Tái hiện bằng driver postgres/cf thực và RuntimeSocket fixture: raw.closed resolve trước khi ErrorResponse đã buffer được đọc làm lỗi28P01 bị thay bằng CONNECTION_CLOSED. Adapter nay đợi readable EOF khi socket đóng bình thường; raw.closed reject vẫn ngắt nhanh. Hai test28P01/XX000 giữ nguyên SQLSTATE, thêm test byte cuối và metadata chỉ có stage/counters. Không coi race này là bằng chứng mật khẩu production sai.

261/261 test (18 files), typecheck, lint, frontend/worker build và Wrangler dry-run đạt. FullWorker health local trả connected/header .6. Actualworkerd qua TLSproxytrustedCA vẫn đọc transaction có tham số, giữ mã000123456789 và quantity42, một TCP mỗi request. HostedSupabase vẫn cần chủ dự án gọihealthbản .6 để xác minh.

## Chuẩn bị Hyperdrive managed connection

Cả Session và Transaction pooler hosted do chủ dự án kiểm tra đều đóng sau startup113byte, không nhận bytePostgreSQL; chưa có nguyên nhân provider được xác nhận. Thêm cấu hình Hyperdrive ưu tiên binding, không tự fallback khi binding tồn tại nhưng lỗi/trống, TLS origin doHyperdrive quản lý và bỏ startup statement_timeout/ORMparams. Chưa thêm ID giả hoặc tạo resourceCloudflare. Querycaching phải tắt tạiresource để bảo đảm đọc mới nghiệp vụ.

265/265 test (19 files), typecheck, lint, Vite build, worker build và Wrangler dry-run đạt. SimulatedHyperdrivebinding tới local *_test được ưu tiên trước URI fallback cố ý sai; transaction tham số giữ mã000123456789 vàquantity42. Đây là mô phỏng lựa chọnbinding/transaction, chưa xác nhận hostedHyperdrive. Cần chủ tài khoản tạoresource, Testconnection và cung cấp ID khôngbí mật để khai báo binding trongGit.

## Đính chính cấu hình Hyperdrive origin theo tài liệu chính thức

Đã đọc source chính thức Cloudflare và Supabase qua readonlygitcheckouts. CloudflareSupabaseHyperdriveguide yêu cầu Direct connection, không qua pooledconnection. docs/HYPERDRIVE.md sửa originthành db.lyeyjfvxmqruszgfrjze.supabase.co:5432, userpostgres. Đây là sửa hướng dẫn, không deploy/đổi resource/mật khẩu/data hosted. Chưa có IDHyperdrive hoặc Testconnection thànhcông từchủproject.

## Kiểm tra script tài khoản chẩn đoán

`scripts/sql/create-connection-check.sql` được chạy trên container PostgreSQL17 riêng, không chạm cluster dev hay hosted. Xác nhận: thiếu marker bị chặn và không tạo role; sau marker đúng, password32ký tựhex được sinh trên server; tài khoản mới đăng nhập được, CONNECT=true, không SELECT được bảng app; chạy lại bị chặn và verifierpassword không đổi. Kết quả password không in vào tooloutput/Git. Container kiểm thử được dừng/xóa. Đây không phải xác nhận credential/đường mạng Supabase thật; SQL cần chủproject chạy riêng. Không thay đổi runtime hoặc các migration gốc.

### Hyperdrive resource and runtime-role permissions (2026-10-23)

The owner supplied the saved Hyperdrive ID in a dashboard screenshot; the Direct origin uses the freshly generated limited LOGIN role and query caching is disabled. The actual resource binding is now tracked in Wrangler config. Hosted health/login have not yet been confirmed.

The permission script was checked in a separate disposable PostgreSQL17 container on database `comsflow_permissions_test` using all 17 migrations. Only the database-name guard was substituted locally. Verified missing-schema guard, repeatable grants, reads of all 48 application tables and migration markers under the NOINHERIT role, transactional insert/update/read/delete through RLS, append-only audit trigger rejection, browser-role denial, and absence of CREATE/admin/migration-write privileges. No production data or credentials were accessed.

For the binding change: typecheck, lint, all 265 backend tests (19 files), frontend build, worker build, and Wrangler deployment dry-run passed. The dry-run lists `env.HYPERDRIVE` with the owner-provided ID. This does not execute the permission script in Supabase or confirm Cloudflare production rollout.

### First-admin setup availability (2026-10-23)

The owner reported hosted database health connected and setup-status `available:false`; the old boolean response cannot determine missing/invalid SETUP_TOKEN versus existing users. Added safe status codes/messages while preserving the available field and all first-account/token/concurrency guards. The login screen shows the reason, reports status request errors, supports rechecking after configuration changes, and refers to Cloudflare rather than Railway. No account, token, password, role, or data was changed.

Validation passed: typecheck, lint, 266 backend tests across 19 files, frontend build, background worker build, and 8 browser scenarios across desktop/mobile. Real local PostgreSQL tests distinguish missing/invalid token and existing users, verify ready on an empty test DB, preserve single-account concurrency protection, and keep secret/email out of status responses. Browser fixtures verify disabled-button explanation, error recovery/recheck, and first-admin form opening only when ready. Hosted rollout and the actual setup blocker still require the owner's new status response.

### Owner-controlled first-admin provisioning without waiting for web rollout

The owner still received the old boolean-only setup response after the diagnostic commit. Hosted rollout cannot be confirmed from this execution environment (outbound HTTPS proxy rejects the connection), and no Cloudflare administrative connector or production database credential is available. Added `scripts/sql/provision-first-admin.sql` as an owner-executed Supabase SQL Editor path, after creating a confirmed user in the Auth dashboard. It never handles passwords, edits auth tables, or exposes a public privilege-escalation endpoint. It grants only the explicitly selected linked profile, keeps IDs, refuses another active admin, and records audit.

Disposable PostgreSQL17 database `comsflow_admin_provision_test` installed all 17 migrations with a minimal auth.users fixture present so the real profile trigger ran. Verified initial inactive staff profile, placeholder/unknown/unconfirmed rejection, case-insensitive selected-email grant, the same active-profile lookup used by login, repeatable execution without duplicate audit, and another-admin rejection with rollback. Migration markers and all other users remain unchanged. No production query or account changes were executed by Codex. Hosted sign-in remains to be verified by the owner.

For this SQL/documentation change, typecheck, lint, all 266 backend tests, frontend build, background-worker build, and Wrangler deployment dry-run passed again. The guarded SQL was validated separately as described above.

### Operations review and return overview — 2026-10-23.operations-1

See OPERATIONS_REVIEW.md for findings, metric definitions, rollout steps, and production dependencies. Fixed fresh-install catalogs/aliases and stale warehouse selection, added audited idempotent catalog setup and account-role editing, replaced the return dashboard, aligned KPI/carrier drilldown filters, and exposed processor readiness and bounded job-control requests. Return import/analytics tabs no longer poll the full list; scan history is restricted to the current actor's last20 events. No production data was changed by Codex, no migrations were modified, and no new paid resources were created.

Final checks passed: typecheck; lint; 275 backend tests in20 files; client build; background-worker build; Wrangler deployment dry-run listing the existing Hyperdrive binding; and16 Playwright scenarios across desktop/mobile. New PostgreSQL tests cover empty catalogs and retries, preserved custom IDs/names/aliases/settings, usable shifts, role-only/lock-only updates and access guards, worker heartbeat freshness, actor-only event history, distinct request/claim counts, partial receipts, manual lost status, refund/cancel exclusions, carrier shares/drilldown consistency including mixed/unknown/no-tracking cases, and requested/received/imported date scopes. Browser tests cover late-arriving catalogs, both self-start shift stations, account promotion, carrier-to-list-to-detail processing, retained claim filters, configured overdue values, and no page overflow on mobile. Browser API data and Auth are fixtures; these are not production acceptance checks.

A separate disposable PostgreSQL17 container on `comsflow_install_audit_test` executed the regenerated bootstrap SQL: all17 checksum markers, a default warehouse, two channels, seven carriers, JT aliases, a private bucket, zero demo users/scans/shipments, and repeat installation preserving catalogs/settings after a user exists. The container was removed.

Hosted rollout and real processor heartbeat remain unconfirmed: the owner answered that they do not know whether the processor was deployed; a request for the nonsecret `workerLastSeen` value is pending. A successful database health response or Cloudflare build is not evidence that PDF/Excel/report jobs can complete. Hardware camera/HID, real large-file/load testing, Railway data migration/count/hash verification, and backup/restore acceptance remain separate production checks.

### Unambiguous shift times — 2026-10-24.shift-time-1

The reported screenshot used 08:15 SA as the start and 12:00 SA as the end on the same day. The latter is midnight (00:00), so the existing server rejection was correct. Replaced the locale-controlled datetime input with a date picker and explicit 00–23 hour/minute selectors. Kept Vietnam UTC+07 conversion, added client validation before submitting, and explained noon/midnight and explicit next-day dates for overnight shifts. Server ordering, transaction, warehouse, assignment, and audit checks are unchanged. No migration or production data update is required.

Passed typecheck, lint, all 279 tests in 21 files, client/Node worker builds, Wrangler deployment dry-run with the existing Hyperdrive binding, and all 18 desktop/mobile Playwright scenarios. Regression scenarios run with en-US locale and America/Los_Angeles timezone: 08:15–00:00 is rejected without a request; 08:15–12:00 submits 01:15Z–05:00Z; 22:00–00:00 on the following day submits 15:00Z–17:00Z. Unit cases additionally reject equal times and malformed/nonexistent dates. Reviewed mobile screenshot and checked viewport overflow. Browser requests use fixtures, not production accounts. Wrangler's default log path was unavailable in this sandbox; the dry-run passed with XDG_CONFIG_HOME pointing to a task directory in /tmp. Cloudflare production rollout remains unverified.

### Direct TikTok return CSV — 2026-10-24.tiktok-csv-1

Added a bounded (1 MB / 2,000 rows) CSV-only import through the existing web/API and private Storage, without the separate processor. The raw CSV is re-read and validated by the server with its SHA-256, preserving IDs as strings; shared row validation is isolated from XLSX/PDF parsers. Business import now uses bulk JSON recordsets rather than per-item SQL calls, retaining the same advisory lock, current-row locks, preview fingerprint, role/warehouse/retired/purged guards, immutable history, manual carrier decisions, inspection/claim/receipt state, and source merge semantics. Job result and operational writes share one transaction; duplicate/lost-response commits reuse the durable result. CSV preview jobs cannot be claimed by Node. Error reports for direct CSV download in the browser from server-validated rows, with spreadsheet formula prefixes escaped.

Passed typecheck, lint, 285 backend tests in 21 files, client/background worker builds, Wrangler dry-run with the existing Hyperdrive binding, and 20 desktop/mobile browser scenarios. Added tests for processor-free previews/commits, original object/hash verification, string IDs/BOM/quoted multiline CSV, limits and mismatched platform, blocked invalid rows, stale preview, expired/cancelled uploads, concurrent commit replay, 777-request bulk import, and injected snapshot failure rolling back cases/import/audit/job result together. Browser tests run with no processor heartbeat and confirm no queue polling, no false success after a dropped commit response, and successful retry.

The owner's uploaded CSV was also exercised through the real processReturnCsv functions against a separate, temporary local *_test PostgreSQL database and an HTTP Storage fixture: 777 requests, 734 original orders, 622 distinct tracking codes, quantity 781, 155 rows without tracking, 412 without Seller SKU, zero parser errors; 777 cases/items/snapshots and exactly one import persisted. Commit retry reused that import. No child worker ran. The temporary database was dropped in finally; no customer rows or original file were added to Git, no Railway or production Supabase data was modified, and no paid service was created. This local audit is not a hosted CPU/load or Cloudflare acceptance result; production rollout remains unverified.
