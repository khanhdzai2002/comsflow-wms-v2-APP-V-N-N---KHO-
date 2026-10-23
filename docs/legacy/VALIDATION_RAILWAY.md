# Kiểm chứng MVP

Kiểm tra trong cloud development bằng Node 24, Next.js 16, PostgreSQL 17 Docker và Chromium cài trên máy. Dữ liệu demo/E2E được đánh dấu; database integration test riêng `comsflow_test` bị xóa dữ liệu mỗi test.

## Các lệnh xác thực

- `npm run lint`: ESLint.
- `npm run typecheck`: sinh route types rồi kiểm tra TypeScript.
- `npm run build`: tạo bản production.
- `TEST_DATABASE_URL=... npm test`: 150 bài kiểm thử backend/SQL, parser PDF và kiểm tra Origin, không dùng mock database cho nghiệp vụ.
- `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium npm run test:e2e`: 33 kịch bản × 2 cấu hình desktop/mobile Chromium = 66 bài mặc định; thêm 2 bài mẫu PDF Shopee khi có SHOPEE_SAMPLE_PDF và 2 bài mẫu hoàn TikTok khi có RETURN_SAMPLE_XLSX.
- `npm audit --omit=dev`: không có advisory trên dependencies production sau override uuid dùng bởi ExcelJS; đường đọc/ghi XLSX được kiểm tra lại.
- `pg_dump -Fc` và `pg_restore` vào database mới: phục hồi thành công các bảng vận đơn, sự kiện quét và audit. Bản kiểm tra phục hồi có 62 vận đơn, 44 sự kiện và 168 audit; số liệu này là snapshot kiểm tra, không phải KPI cố định của ứng dụng.

## Nguồn PDF và tính đủ xuất kho

Đã chạy thêm kiểm thử với file người dùng cung cấp qua `SOURCE_SAMPLE_PDF=/path/to/jt.pdf SHOPEE_SAMPLE_PDF=/path/to/spx.pdf RETURN_SAMPLE_XLSX=/path/to/returns.xlsx TEST_DATABASE_URL=... npm test`: tổng **113 tests**, gồm ca J&T thực tế 50 trang / 50 đơn / 50 vận đơn và Shopee 15 trang / 15 đơn / 15 vận đơn, quét đủ 50 chưa được coi là bàn giao đủ, sau xác nhận bàn giao 50 mới đủ. File chứa dữ liệu khách hàng không đưa vào repository; mặc định suite dùng PDF giả lập chỉ chứa mã thử.

Parser kiểm tra giữ mã đơn dài dạng text, nhiều kiện cùng đơn, in lặp trên một trang, tem trùng nhiều trang, trang trống/ảnh, nhiều mã mâu thuẫn, file hỏng/giả/quá lớn/quá 3.000 trang. SQL kiểm tra retry đồng thời không tạo nguồn trùng, 8 yêu cầu mở ca đồng thời dùng giờ máy chủ sau khi lấy khóa nên chỉ tạo một ca, xung đột không nhập một phần, giữ lịch sử khi bổ sung Excel, đơn hủy không làm giảm nguồn, nguồn không lệ thuộc ngày lọc, nguồn bất biến và quyền staff bị từ chối. E2E desktop/mobile kiểm tra upload → đếm → lưu → lọc mã thiếu → quét/bàn giao → tự cập nhật đủ → xuất CSV/XLSX → nhập lại không tạo trùng, cùng chặn trang lỗi và CSRF.

Giới hạn: mẫu PDF text J&T và Shopee/SPX đã kiểm chứng bằng file gốc; BEST đã triển khai theo ảnh và kiểm tra bằng PDF text giả lập, chưa có PDF gốc BEST để đối chiếu; PDF scan ảnh/OCR, mẫu tem hãng khác và trích xuất chi tiết SKU/sản phẩm từ PDF chưa hỗ trợ. Không đếm số lượng sản phẩm thành số kiện, không cộng tổng các file có mã trùng. Lưu metadata + hash + mã/trang, không lưu PDF gốc hay thông tin người nhận trong nguồn.

## Ma trận 20 yêu cầu

| #   | Kịch bản                   | Bằng chứng / giới hạn                                                                                       |
| --- | -------------------------- | ----------------------------------------------------------------------------------------------------------- |
| 1   | Import Shopee              | CSV và PDF Shopee/SPX gốc vào PostgreSQL, kiểm tra vận đơn                                                  |
| 2   | Import TikTok              | XLSX vào PostgreSQL, kiểm tra hãng/sàn                                                                      |
| 3   | Import lại                 | Không tăng số đơn/kiện/sản phẩm; giữ lịch sử                                                                |
| 4   | Quét Shopee                | API trả đúng sàn, sản phẩm và timestamp                                                                     |
| 5   | Quét TikTok                | Lookup đúng dữ liệu nguồn                                                                                   |
| 6   | Quét trùng                 | Một success, lượt sau duplicate và người/giờ đầu                                                            |
| 7   | Hai thiết bị cùng quét     | 12 request đồng thời từ hai user chỉ một success                                                            |
| 8   | Mã lạ                      | Lưu sự kiện/ngoại lệ, không tăng success; retry không nhân đôi                                              |
| 9   | Đơn hủy                    | Bị chặn; không có success                                                                                   |
| 10  | Quét không tự bàn giao     | `handed_at` rỗng sau quét                                                                                   |
| 11  | Bàn giao đúng hãng         | Nháp và xác nhận riêng, sai hãng bị từ chối                                                                 |
| 12  | Dashboard đúng sau quét    | Kiểm tra số liệu SQL/API và UI tải dữ liệu thật                                                             |
| 13  | Lọc hãng/sàn               | Dashboard/list chỉ chứa tập vận đơn phù hợp                                                                 |
| 14  | Excel báo cáo              | Đọc file XLSX xuất từ API, so mã và số dòng; chặn công thức                                                 |
| 15  | Staff không có quyền Admin | API trả 403 cho dashboard quản lý và tạo user                                                               |
| 16  | Camera điện thoại          | Đã triển khai camera và test thông báo lỗi/fallback nhập mã; **chưa kiểm thử camera vật lý Android/iPhone** |
| 17  | HID có Enter/Tab           | Kiểm thử bàn phím giả lập và focus tiếp tục; **chưa cắm súng quét vật lý**                                  |
| 18  | Giờ Việt Nam               | UTC 07:32:08 hiển thị 14:32:08 UTC+7                                                                        |
| 19  | Mất mạng                   | Chặn phản hồi sau khi server lưu; UI không báo thành công giả; gửi lại cùng ID chỉ một sự kiện              |
| 20  | Giữ lịch sử sau chỉnh sửa  | API đổi sang review và khôi phục có lý do, audit trước/sau và scan success vẫn nguyên                       |

Các kiểm thử bổ sung: ca chưa phân công, sai kho/hãng, mã sai, QR JSON, file hỏng/công thức, dòng sản phẩm lỗi không gây cập nhật một phần đơn, session tài khoản bị khóa, giới hạn login sai, RLS bật, trigger chống sửa/xóa lịch sử, mẫu số dashboard bằng 0 và xuất dữ liệu không gây Excel formula injection.

## Chưa được xác thực

Thiết lập Admin lần đầu trên web đã được kiểm tra thêm trên database PostgreSQL riêng rỗng và trình duyệt Chromium: nhập mã và thông tin trên form, tạo Admin, tự đăng nhập, mở dashboard, đóng thiết lập và chặn lần tạo thứ hai. Bốn integration tests kiểm tra mã thiếu/sai, giới hạn số lần thử, hash/session/audit và hai yêu cầu đồng thời chỉ tạo một tài khoản. Lint, typecheck và build đều vượt qua sau thay đổi này.

Bản production đã được build và khởi động bằng `npm start`; health check trả database connected, kiểm thử đăng nhập/dashboard trên Chromium vượt qua. Script `bash scripts/cloud-setup.sh` đã chạy lại thành công với `npm ci`, migrations, demo seed không reset lịch sử, snapshot database và typecheck.

Chưa xác minh trực tiếp bản Railway production từ môi trường này, Supabase thật, kiểm thử Safari thực, đọc mã qua camera thật, điều kiện ánh sáng kho, kết nối USB/Bluetooth thật, tải lớn hoặc khôi phục trên một cloud task mới. Mobile Chromium emulation kiểm tra bố cục và thao tác, không chứng minh mọi thiết bị iPhone/Android tương thích.

MVP dùng polling 5 giây. Không có đồng bộ offline; khi chưa nhận phản hồi server, kết quả luôn là chưa xác nhận. Các tính năng giai đoạn sau được liệt kê trong README và ARCHITECTURE.

## Rà soát liên kết danh mục và nhập tay

Đã thêm kiểm tra SQL cho ca nhanh idempotent, phân quyền/phân công ca, bảo toàn scan khi đổi phân công, KPI mở danh sách cùng số đếm, phân trang không mất tổng, nhập lại phải đủ mọi kiện và hủy/xác nhận bàn giao đồng thời. Migration 003 được áp dụng thành công trên database demo hiện hữu và trong schema test mới.

Trình duyệt kiểm tra thêm tình huống thiếu ca giữ nguyên mã, quản lý mở ca rồi nhập tay đúng phương thức, nhân viên không tự mở ca, chỉnh phân công trong UI, hủy nháp giữ lịch sử, xem trước nhiều file và mục Hướng dẫn sử dụng có sơ đồ trên desktop/mobile. Camera và HID vật lý vẫn cần kiểm tra tại kho.

## Loại bỏ và khôi phục nguồn PDF

Migration 006 thêm trạng thái lưu riêng, không sửa trigger bất biến của nguồn. Backend kiểm tra: loại bỏ nguồn đã bàn giao vẫn giữ shipments/scan/handover và nguồn dùng chung; khôi phục lấy lại số liệu cũ; upload hash đã loại bỏ trả 409; 6 yêu cầu loại bỏ/khôi phục đồng thời chỉ tạo một nhật ký mỗi hành động; staff 403, bắt buộc lý do, nguồn không tồn tại 404, RLS bật. E2E PDF desktop/mobile kiểm tra hủy hộp thoại không thay đổi, chặn lý do trống, gỡ đúng lựa chọn, chuyển chế độ xem, giữ 2 kiện đã bàn giao và khôi phục lại đầy đủ.

## BEST Express và hàng đợi nhiều PDF

Kiểm tra parser với PDF giả lập 151 trang BEST/TTVN: đếm đủ 151 mã/đơn, nhận đúng BEST; không khẳng định đây là nội dung file BEST gốc của người dùng. J&T gốc 50 trang vẫn chạy regression qua SOURCE_SAMPLE_PDF. Unit kiểm tra thiếu dấu hãng, mâu thuẫn hãng trong một PDF và union/cross-conflict/dedup của nhiều file. SQL xác nhận sàn TikTok/hãng BEST, chặn chọn J&T cho tem BEST, scan sai hãng bị từ chối, filename BEST không làm đổi hãng một tem J&T.

E2E mục PDF có 4 kịch bản × desktop/mobile = 8 bài: hai luồng nguồn cũ (gồm loại bỏ/khôi phục), hàng đợi 5 PDF với J&T/BEST/overlap/bản sao/file hỏng và tình huống trả 503 sau server commit rồi retry không nhân đôi; chọn sai hãng, thay context xóa preview, thêm/bỏ file và chặn quá 20 file. Build/lint/typecheck thực hiện sau thay đổi. PDF ảnh/OCR và mẫu hãng khác vẫn cần bổ sung mẫu gốc để kiểm chứng.

## Nguồn PDF lớn 1.800 đơn

PDF giả lập 1.800 trang có stream đệm không dùng để đạt dung lượng trên 17,30 MB: parser đọc đủ 1.800 mã/đơn; integration test lưu hàng loạt đủ shipments/orders/memberships, nhập lại không trùng, giữ trang 1.800 và quét một mã làm còn 1.799 chưa quét. Kiểm tra riêng bulk có nhiều kiện cùng đơn và trộn mã cũ/mới giữ baseline. Fixture là dữ liệu giả lập, chưa phải PDF gộp thực tế trong ảnh người dùng.

E2E upload PDF trên 17 MB qua multipart thật → xem trước 1.800 mã → lưu → đối soát 1.800 → phân trang 100 dòng, sang trang 2 → tìm mã trang cuối → quét đúng → xuất CSV đủ 1.801 dòng gồm header. Chạy desktop/mobile. Các kịch bản nguồn cũ vẫn được chạy cùng, tổng 10 bài PDF. Unit fake timer xác nhận nguồn PDF không bị hủy ở 30 giây, hết 180 giây vẫn không báo thành công giả, và timer bao phủ cả response body. Giới hạn vượt 50 MB/3.000 trang vẫn bị từ chối.

## Tem dài qua nhiều trang

Bổ sung kiểm thử theo tình huống trong ảnh trang 19/1795: tem có barcode và bảng sản phẩm nhưng Qty Total sang trang sau; trang tiếp theo chỉ có bảng/tổng và Order ID. Parser ghép đúng trang liền kề, giữ toàn bộ số trang, không tăng số kiện hay số tem trùng. Kiểm thử thêm nhiều trang tiếp theo, BEST, một đơn nhiều kiện, tem in lại, trang mồ côi/sai hoặc nhiều Order ID, trang lỗi ở giữa và tem hãng chưa hỗ trợ. File giả lập 1.832 trang (1.800 tem + 32 trang tiếp theo) cho đúng 1.800 kiện. SQL kiểm tra lưu/retry/quét/đối soát và không lưu một phần khi ghép lỗi. Lint/typecheck/build đều vượt qua. E2E production `--grep PDF` gồm 6 kịch bản × desktop/mobile = 12 bài, bao gồm tải lên tem hai trang → lưu một kiện → mở lại nguồn vẫn giữ trang [1, 2] và số trang tiếp theo. Chưa có PDF gốc 1.832 trang của người dùng để đối chiếu text extraction thực tế; mẫu J&T gốc 50 trang vẫn được kiểm tra hồi quy.

## Shopee/SPX và nhận diện từng sàn

Đã dùng file gốc SPX-2010-8H19-DA IN.pdf để kiểm chứng: 15 trang, 15 mã đơn và 15 vận đơn SPX, không có lỗi, không trùng hay trang tiếp theo. PDF vẽ chữ tiếng Việt rời và OrderSN sau giá trị trong stream; parser ghép theo tọa độ để khôi phục nhãn và đối chiếu hai mã đơn độc lập. Unit kiểm tra mã SPX chỉ in một lần, tem in lại, một đơn nhiều kiện, bảng/OrderSN ở trang tiếp theo, trang mồ côi/sai mã, thiếu bằng chứng, xung đột/mixed sàn và glyph rời. Batch tính đơn theo [channel, orderId]. SQL kiểm tra tách shop cùng tên hai sàn, context thủ công sai, scan đúng/sai hãng/trùng, bổ sung CSV giữ timestamp, bộ lọc sàn, phiếu SPX và quy tắc SPXVN không ghi đè cấu hình cũ. Ca PDF gốc quét đủ 15 vẫn chưa bàn giao đủ; xác nhận phiếu mới đủ.

Mẫu mới được nhận theo nội dung, kể cả tên file cố ý mang tên hãng khác. Giao diện tự nhận sàn/hãng riêng từng file; export nguồn có channel/shop/source_file. Mẫu đã kiểm chứng chỉ là Shopee/SPX theo file gửi; chưa khẳng định mọi hãng hoặc mọi mẫu nhãn Shopee đều được hỗ trợ. PDF khách hàng không đưa vào Git, kiểm thử bổ sung dùng đường dẫn biến môi trường và fixture giả lập không có thông tin người nhận.

Kiểm tra production local: lint, typecheck, build và health check đều qua. Nhóm PDF với `SHOPEE_SAMPLE_PDF=... npm run test:e2e -- --grep PDF` có 18 ca desktop/mobile: 16 qua lượt nhóm; 2 ca nhập chung hai sàn qua lượt chạy lại sau sửa selector thông báo của kiểm thử. Bao gồm upload PDF gốc nhận 15/15/15, chọn sai sàn bị chặn, tên file không quyết định hãng/sàn, lưu đồng thời hai nguồn, quét trùng, xác nhận phiếu SPX và xuất CSV đúng sàn. Không chạy lại toàn bộ 42 ca ngoài nhóm PDF trong lần cập nhật này.

## Quản lý đơn hoàn

16 bài backend chuyên biệt (gồm file XLSX TikTok thật) xác minh đọc đúng 106/101/89/109, ghép XML mỗi ô một row và dimension A1, ID text 18/19 chữ số, giữ dòng thiếu vận đơn/Seller SKU, ngày/VND, chặn công thức/mã làm tròn, chống import/scan đồng thời và retry, mã khớp nhiều hồ sơ, ca/phân quyền, kiểm đủ/thiếu/rỗng, optimistic version, giữ SKU khi file sau chỉ có một phần, SKU ID TikTok ổn định khi tên phân loại đổi, Seller SKU rỗng không xóa mã đã biết, giữ ghi chú/khiếu nại/nhận hàng khi cập nhật, hoàn tác bảo toàn lịch sử, tiền thực nhận có ngày, không hoàn tất hồ sơ khi khiếu nại còn mở và nguồn/sự kiện bất biến. Dashboard/list/export đọc cùng snapshot repeatable read, cùng bộ lọc; dữ liệu xuất không mất số dài.

E2E module gồm ba kịch bản × desktop/mobile = 6 bài khi có RETURN_SAMPLE_XLSX: nhập → nhận kiện → chống trùng → kiểm SKU → hồ sơ khiếu nại chưa nhận tiền → bằng chứng PDF/tải xuống → F5 → xuất CSV; mã lạ/đa hồ sơ/503 sau server commit rồi retry/phân quyền staff; preview file gốc đủ 106 yêu cầu, 101 đơn, 89 mã, 109 SP, 17 thiếu mã và 66 thiếu Seller SKU. Camera vật lý và súng quét thật vẫn cần kiểm tra tại kho. Nguồn Shopee return chưa có file gốc; chỉ hỗ trợ ánh xạ thủ công, không khẳng định nhận mọi định dạng.

Kết quả phiên cập nhật đơn hoàn: **113/113 backend**, lint/typecheck/production build và health check đều qua. Lượt full E2E 50 ca có 49 qua; một ca mobile chọn file bằng chứng trước khi lưu khiếu nại kết thúc. Đã sửa kiểm thử chờ thông báo hồ sơ đã lưu và input được bật; cả **6/6 ca đơn hoàn desktop/mobile** chạy lại qua trên bản production cuối. Các luồng outbound cũ (nhập tay/HID, CSRF, phân công ca, hủy nháp, CSV/XLSX, PDF J&T/BEST/Shopee và file 1.800 đơn) đều qua lượt hồi quy. Không coi mô phỏng Chromium là kiểm thử thiết bị quét/camera vật lý.

## Mở biểu mẫu nhập đơn hoàn

Bổ sung nút vào biểu mẫu ở trang Nhập dữ liệu và đầu trang Quản lý đơn hoàn; tab có trạng thái chọn rõ ràng. Link `/#returns/import` mở đúng biểu mẫu sau đăng nhập; F5, Quay lại/Tiến giữ mục/tab. Kiểm thử cả admin và manager qua hai nút và link trực tiếp; staff mở link nhập chỉ thấy màn quét, không có biểu mẫu và API nhập vẫn trả 403.

Lượt hồi quy production local qua **56/56 E2E desktop/mobile**, gồm 6 bài điều hướng/phân quyền mới, mẫu đơn hoàn TikTok gốc, PDF Shopee gốc và nguồn 1.800 đơn trên 17 MB. Các thay đổi này không sửa schema hay quyền API.

Sau khi hoàn thiện kiểu nút đọc/lưu và hướng dẫn trong app, production build/lint/typecheck/health check đều qua; nhóm đơn hoàn chạy lại **12/12 E2E** trên bundle cuối.

## Giao diện điều hướng và nhập file

Tái cấu trúc sáu mục đơn hoàn thành thẻ có biểu tượng, mô tả và trạng thái chọn rõ ràng; breadcrumb/dòng Bạn đang ở cùng ARIA current/selected xác định mục hiện tại. Điều hướng tab hỗ trợ phím mũi tên/Home/End và giữ focus sau khi mở trạm quét. Hai loại nhập outbound PDF/Excel có panel riêng, lưu loại nhập trong hash URL, giữ file khi đổi tab trong phiên. FilePicker dùng chung cho PDF/Excel/đơn hoàn, hỗ trợ kéo thả, hiển thị số file/tên/dung lượng và bỏ chọn; bỏ/chọn file hoặc đổi ngữ cảnh vẫn xóa preview cũ. Ba bước chọn/kiểm tra/lưu và trạng thái chữ/màu phân biệt đã chọn, đang đọc, đã đọc chưa lưu, trùng nội dung, lỗi và server đã xác nhận.

Lint, typecheck, production build và health check đều qua. Lượt production local cuối **58/58 E2E desktop/mobile** qua, gồm ca giao diện mới (đổi loại file, giữ lựa chọn, bỏ file xóa preview, điều hướng bàn phím/F5), nhập CSV nhiều file, PDF Shopee gốc, hoàn TikTok gốc 106/101/89/109, PDF 1.800 đơn trên 17 MB, quét/kiểm hàng/khiếu nại/bằng chứng, staff/manager/admin và các luồng outbound. Kiểm tra trực quan screenshot trên desktop/mobile. Không thay đổi schema, dependency hoặc quyền API trong đợt chỉnh giao diện này.

## Dọn dữ liệu cũ theo ngày và kho

Migrations 011/012 và nghiệp vụ dọn được kiểm tra trên PostgreSQL riêng `*_test`: ranh giới UTC+7 (ngay trước/đúng nửa đêm), lọc kho, quyền admin và chủ sở hữu preview, admin bị khoá/hạ quyền sau preview, câu xác nhận/lý do, hết hạn 30 phút, thay đổi dữ liệu con sau preview, dữ liệu đang xử lý/ngoại lệ/khiếu nại/nhập nguồn mới/kiểm lại, liên kết kiện chéo hồ sơ, giới hạn 500 và đợt tiếp theo. Kiểm tra toàn bộ bản ghi vận đơn giữ nguyên sau dọn nhật ký; xoá trọn hồ sơ hoàn và nội dung PDF thử 256 KB, giữ hồ sơ khác trong cùng file. Mã request cũ trả 410; file cũ và bản xuất mới chứa mã yêu cầu đã dọn bị chặn.

Kiểm thử đồng thời cùng job chỉ có một lần xoá/audit; hai preview chồng nhau không xoá thêm; thêm dòng cũ sau preview không mở rộng phạm vi. Lỗi trigger được chèn tại bước xoá case cuối giao dịch chứng minh rollback cả child/BLOB/metadata/audit. Guard vẫn chặn UPDATE và DELETE tuỳ tiện, kể cả GUC giả, job khác hoặc ID không nằm trong phạm vi; audit/header nguồn vẫn bất biến và metadata bật RLS. VACUUM ANALYZE thực tế chạy ngoài transaction, giữ nguyên dữ liệu.

Toàn bộ backend với ba file mẫu J&T/Shopee/hoàn TikTok gốc qua **129/129**; nhóm dọn dữ liệu **16/16** chạy lại trên mã cuối. Lint/typecheck/production build đều qua. Lượt E2E hồi quy có **58/58** ca hiện có qua, bao gồm PDF trên 17 MB/1.800 đơn và hai file Shopee/hoàn gốc. Nhóm mới **6/6 E2E desktop/mobile** qua trên bundle cuối: xem trước → xuất Excel đọc lại đúng mã → huỷ trước xác nhận giữ dữ liệu → xác nhận xoá → giả lập mất phản hồi sau khi server đã commit → khoá phạm vi/thử lại cùng job → không xoá thêm dòng mới được chèn sau preview, chỉ một audit; chặn CSRF và manager/staff không thấy nút hoặc gọi API.

Fixture xoá E2E chỉ chạy khi app/database đều local và database đánh dấu demo; tạo kho riêng và dòng quét giả lập năm 2020, không xoá dữ liệu vận hành thật. Kiểm tra trực quan ảnh desktop/mobile. Không dùng kết quả local để khẳng định deployment Railway đã áp dụng, đã dọn dữ liệu production hoặc disk/billing giảm: DELETE/VACUUM thường tạo vùng trống để dùng lại, không cam kết giảm `pg_database_size` ngay.

## Đơn hoàn V2

Nghiệp vụ V2 được kiểm tra bằng PostgreSQL thật trên database riêng `_test`: hãng chung/alias/ưu tiên nguồn/mâu thuẫn/unknown, quy tắc mới không sửa mã, bộ lọc/tìm mã/sắp xếp hãng và dữ liệu legacy, import lại, ô trống và giá trị 0, giữ nhận kiện/ghi chú/phân công/kiểm hàng/khiếu nại, file chỉ có một phần SKU, phiên bản preview và chặn nguồn có thời điểm sàn cũ hơn. Đọc lại diff từng trường, hai loại phí độc lập và Compensation Amount tách tiền thực nhận. Kiểm tra sao chép bằng nội dung thật của đúng hồ sơ.

Phân tích kiểm tra lý do gốc, không suy đoán từ Buyer Note, bảy nhãn lý do thực tế trong XLSX gốc, mẫu số từ file bán thật, nhóm đơn bán khác kỳ yêu cầu hoàn, shop/sàn/đơn/SKU không khớp, thiếu mẫu số/liên kết và giá trị tiền không biến thành 0, cập nhật huỷ bán, không cộng trùng file, combo chưa cấu hình/định lượng 2+3/trọng số tiền không nhân tổng, loại yêu cầu/sàn chấp thuận/nhận thực tế, ngưỡng màu và lọc min sales/màu/size. XLSX bán có dòng trống đọc được, mã dài ở ô số có thể làm tròn bị chặn; lỗi không nhập một phần. Dọn case giữ summary, xoá diff theo case bằng guard/giao dịch; dữ liệu mới và phân quyền được bảo vệ.

Các nguồn mẫu chứa khách hàng được đọc từ biến môi trường, không đưa vào Git. File bán giả lập phục vụ kiểm tra logic, không dùng làm dữ liệu kinh doanh. Shopee hoàn và file bán gốc chưa có mẫu để kiểm chứng ánh xạ cụ thể; chức năng có ánh xạ và xem trước. Không coi Chromium giả lập điện thoại là kiểm tra camera/súng quét vật lý, hoặc kết quả local là xác nhận Railway đã deploy.

Kết quả V2: toàn bộ **153/153 backend** với ba file mẫu gốc qua; **24/24** bài chuyên biệt V2. Production build/lint/typecheck/health check qua. Lượt hồi quy đủ **70/70 E2E desktop/mobile** qua, gồm cả quét/nhập cũ, PDF 17 MB/1.800 đơn, CSV/XLSX, bàn giao, file gốc Shopee/TikTok, dọn dữ liệu, update/copy/lịch sử và nguồn bán thật. Biểu đồ donut được bấm vào phần vành để mở đúng danh sách lý do; clipboard được đọc lại bằng quyền Chromium để so đúng mã. Không xác nhận thiết bị kho vật lý hoặc deployment Railway bằng kiểm tra local.

## PDF Shopee / Giao Hàng Nhanh

File gốc `GHN-8H18-2110.pdf` có 14 trang, 14 mã vận đơn và 14 mã đơn riêng. Trước sửa parser trả 14 lỗi vì chỉ hỗ trợ SPX cho Shopee. Sau sửa nhận **Shopee / GHN**, không có trang lỗi/tem trùng/trang sản phẩm tiếp theo; toàn bộ mã, mã đơn và trang được đối chiếu độc lập với `pdftotext`, khớp 14/14. PDF khách hàng giữ ngoài repository; dùng biến `GHN_SAMPLE_PDF` khi kiểm thử.

Chỉ hỗ trợ mẫu GHN text đã kiểm chứng với mã **G + 7 chữ/số** ở trường Mã vận đơn, Mã đơn hàng khớp OrderSN và khối sản phẩm. SKU/tên sản phẩm bắt đầu G không tạo vận đơn; không tạo rule tiền tố G dùng chung. Có ca chặn mã thiếu/dài/sai định dạng, trường vận đơn trùng, thiếu/sai OrderSN, thiếu sản phẩm, trang tiếp theo sai đơn/mồ côi, mã xung đột và một PDF trộn GHN/SPX. Nhiều PDF tách theo hãng vẫn nhập chung và đếm mã/đơn duy nhất đúng.

**182/182 backend** đạt trên database local riêng `*_test`, kèm bốn mẫu gốc GHN, SPX, J&T và đơn hoàn TikTok. Ca GHN gốc lưu đủ 14 kiện, kiểm tra quét đúng sàn/hãng, chỉ đủ xuất sau khi bàn giao đủ và nhập lại không tạo trùng; ca chồng nguồn giữ timestamp và baseline. Build production, lint và typecheck đạt. Không có migration mới; không áp dụng dữ liệu mẫu lên Railway.

Nhóm PDF có 22 ca E2E desktop/mobile trên build production local: 20 ca qua lượt nhóm, gồm upload GHN gốc 14/14, SPX gốc 15/15, BEST/J&T, nhiều file, trang sản phẩm tiếp theo và PDF 17 MB/1.800 đơn. Hai ca GHN mới đi hết nhận nguồn/quét nhưng kỳ vọng sai câu trạng thái sau quét; sửa kỳ vọng thành “Đã quét đủ, chưa bàn giao đủ”, không đổi logic app. Chạy lại 4 ca GHN (gồm 2 ca upload gốc) đều qua. Kiểm tra thêm xuất CSV giữ đúng mã, mã đơn, Shopee và GHN. Ảnh xem trước desktop/mobile đã kiểm tra, không đưa ảnh/PDF khách hàng vào Git.

Nhóm V2 và xem trước file TikTok gốc được chạy lại **8/8 E2E desktop/mobile** trên bản production cuối, gồm nhãn trường tiếng Việt trong lịch sử, menu copy trên điện thoại và bấm donut.

## Giảm bộ nhớ khi nhập PDF trên Railway

Tải PDF chuyển sang multipart streaming có giới hạn, khóa một job trước khi đọc body và phân tích từng trang mà không giữ toàn bộ text. Giữ nguyên nhận diện mã/tem trùng/trang tiếp theo và giao dịch nguồn. Kiểm tra 19 ca upload gồm dữ liệu thật qua multipart, tên file tiếng Việt, file đúng 50 MB, vượt 50 MB, request thiếu Content-Length, file/field thừa, context lỗi/quá lớn, multipart hỏng, ngắt kết nối và giải phóng khóa sau lỗi. Hai upload khoảng 18 MB đồng thời qua HTTP thật cho một kết quả đủ 1.800 mã và một phản hồi 503 với Retry-After; file sai không làm chết server, upload hợp lệ tiếp theo vẫn đọc được.

Đo RSS trên máy local với cùng PDF giả lập 1.800 tem, khoảng 18 MB, ba lần đọc liên tiếp trong process mới: bản cũ đạt đỉnh **519,3 MiB**, bản sửa chạy bằng entrypoint Railway với heap V8 256 MB đạt **363,9 MiB**. Lượt riêng 20 lần đọc liên tiếp đạt đỉnh **383,8 MiB**, cả 20 lần đủ mã và health check cuối vẫn thành công. Đây là phép đo PDF giả lập, không phải giới hạn RAM cho mọi file 50 MB hay xác nhận nguyên nhân từ Metrics production. Toàn bộ lượt E2E gồm cả Excel đạt RSS đỉnh khoảng 454,4 MiB; heap V8 không phải tổng RSS.

**201/201 backend** qua trên database local riêng `*_test`, kèm bốn mẫu gốc GHN/SPX/J&T/hoàn TikTok. Production build, lint và **76/76 E2E desktop/mobile** qua khi server chạy entrypoint Railway mới với heap 256 MB: nhập/xuất CSV/XLSX, PDF lớn, nhận diện mẫu gốc, phân quyền, quét/bàn giao, đơn hoàn V2 và dọn dữ liệu. Sau bổ sung charset UTF-8 cho tên file, chạy lại 19 ca upload và 4 ca GHN desktop/mobile để kiểm tra tên tiếng Việt được giữ khi lưu/xuất CSV. Không có migration mới hoặc thay đổi dữ liệu Railway; cần deploy commit mới trước khi kiểm tra trạng thái service thực tế.
