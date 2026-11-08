# Kiểm thử và nghiệm thu

Các kiểm thử tự động dùng fixture tổng hợp và PostgreSQL local `_test`, không đọc/ghi dữ liệu production. Trình duyệt dùng Chromium desktop + kích thước điện thoại; API/Storage ở bài trình duyệt được giả lập, nhưng worker CSV/XLSX/PDF và workbook xuất là mã thực. Kiểm thử nghiệp vụ gọi trực tiếp hàm server và thực hiện giao dịch, phân quyền RLS, migrations trên PostgreSQL thực.

## Kết quả bàn giao

Chạy ngày 09/11/2026 theo giờ Việt Nam trên source bàn giao:

- `npm run typecheck`, `npm run lint`: đạt.
- `npm test`: **377/377 bài đạt, 28 tệp**, 174,14 giây; gồm migration từ 19, role runtime thật, nghiệp vụ mới và hồi quy cũ.
- `npm run build`, `npm run build:worker`, `npx wrangler deploy --dry-run`: đạt. Dry-run đóng gói API khoảng 2.067 KiB (gzip 396 KiB); không deploy production. Vite còn cảnh báo kích thước chunk lớn và annotation từ dependency; không lỗi build. Không thêm thư viện.
- `npm run test:e2e` trên Vite production preview: **36/36 bài đạt**, 1,2 phút, Chromium máy tính và kích thước điện thoại. Kiểm parser CSV 50.000 dòng, XLSX text, workbook tải thật, 9 màn hình, KPI drill-down, mất phản hồi staging/commit và hồi quy quét/PDF xuất kho. API/Storage trong các bài browser là giả lập; kiểm SQL/nghiệp vụ nằm ở Vitest database thật.
- 20.000 dòng: staging + preview 16,658 giây; 200 lần commit tổng 47,538 giây, lô chậm nhất 763 ms; tổng 65,215 giây; overview 460 ms, trang cuối 537 ms. Các công việc kiểm chứng khác chạy cùng máy. Xem [BENCHMARK.json](BENCHMARK.json); đây không phải SLA hosted.

Bộ kiểm thử nguồn và Excel gồm bốn bài kiểm workbook, đối chiếu kiểu ô String và raw XML cho mã 12/16/18/20 chữ số, số 0 đầu và mã chữ/gạch. Workbook 1904 bị chặn để tránh sai ngày. Ma trận dưới đây chỉ rõ phần đã tự động kiểm và phần vẫn cần nghiệm thu trên môi trường thật.

## Đối chiếu 40 tình huống của yêu cầu

| #     | Tình huống                 | Bằng chứng tự động / nghiệm thu                                                                                                                                        |
| ----- | -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1     | TikTok đúng mẫu            | `return-operation-facts`, `return-operations`, `platform.spec`: CSV/XLSX thật trong browser worker → staging → preview → xác nhận                                      |
| 2     | Thiếu cột                  | Normalize/aliases/ánh xạ và lỗi trước ghi; file lỗi có lịch sử, có workbook lỗi                                                                                        |
| 3     | Dòng trùng                 | `return-operations`: bản sao chính xác bỏ qua, SKU/trạng thái mâu thuẫn chặn                                                                                           |
| 4     | Nhập lại cùng file         | Identity hash/version/context/mapping, reuse batch, không thêm case/item/receipt                                                                                       |
| 5     | Cập nhật trạng thái        | Nguồn mới giữ kho/claim, history cũ→mới; thời gian cũ hoặc thay đổi sau preview bị chặn                                                                                |
| 6     | SaleWork                   | Nhập mã/ngày/SKU/lượng, nhân viên trong file và người nhập riêng; nhập kho trước nguồn vẫn giữ và khớp sau                                                             |
| 7     | Tít thủ công               | `return-operations`, `returns`, browser scan/shift flows; camera vật lý và HID thiết bị thật còn cần nghiệm thu hosted                                                 |
| 8     | Nhiều ngày/đợt             | Source versions, import lịch sử, archive/replay có checkpoint, giữ nguồn độc lập                                                                                       |
| 9     | Hủy chưa bàn giao          | Hủy trước giao rõ ràng: không cần nhận; hủy thiếu chứng cứ: xác minh; RTS không là bàn giao                                                                            |
| 10    | Giao thất bại đã nhận      | Cả source trước/scan sau và scan trước/source sau; người/giờ/ca đầu tiên không đổi                                                                                     |
| 11    | Giao thất bại chưa nhận    | needs_check đúng nghĩa vụ; tổng và list mở từ KPI khớp                                                                                                                 |
| 12    | Trung chuyển               | Tách `in_transit`, không tự coi thiếu/mất hoặc tự đưa vào report tra soát                                                                                              |
| 13    | Hãng báo thất lạc          | `suspected_lost` khác xác nhận mất của quản lý, khác quá hạn                                                                                                           |
| 14    | Chỉ hoàn tiền              | Không cộng hàng phải nhận, không tự sinh receipt                                                                                                                       |
| 15    | Trả hàng kèm hoàn tiền     | Tách nghĩa vụ vật lý, tiền nguồn có ngày hoàn, nhận/kiểm và tiền bồi thường                                                                                            |
| 16    | Trả một phần               | Expected theo yêu cầu/SKU, actual theo bằng chứng; đủ kiện/lượng khác kiểm chất lượng; kiểm từng kiện không gắn cả case đủ                                             |
| 17    | Nhiều SKU                  | Không nhân yêu cầu/giá trị đơn; kiểm số thực tế và lỗi tại SKU, không tự quy lỗi cho mọi SKU trong case                                                                |
| 18    | Nhiều vận đơn              | Nhiều parcel/receipt, lượng cộng đúng theo kiện, lần kiểm mới nhất/kiện; kho chưa đủ chứng cứ không xác nhận đủ                                                        |
| 19    | Quét nhiều lần             | Cùng request replay, khác request duplicate physical, hai thao tác đồng thời chỉ một receipt; undo có audit                                                            |
| 20    | Kho không có TikTok        | Unknown ledger độc lập; mã đơn-only cần phạm vi/SKU đủ hoặc xác minh thủ công                                                                                          |
| 21–22 | Mã đơn 18 / vận đơn 12     | Workbook value type String + format @; đọc lại khớp tuyệt đối                                                                                                          |
| 23–24 | Chữ/gạch/số 0 đầu          | 12/16/18/20 chữ số, leading zero, mixed-case/hyphen; không Number cho ID; cả QR code string được giữ                                                                   |
| 25–26 | Excel không E+, round-trip | `return-report-workbook` và production workbook worker được đọc lại bằng ExcelJS; 18 cột, sheet hãng, freeze/filter/màu vàng                                           |
| 27    | Không đoán mã hỏng         | Scientific notation/formula/numeric ID dài không chắc chắn bị chặn; raw XML ưu tiên trước chuyển kiểu; không làm tròn hoặc sinh lại chữ số                             |
| 28    | Transit không là mất       | Pure facts + integration + filter needs_check + snapshot export loại transit                                                                                           |
| 29    | Refund-only không là thiếu | Điều kiện nghĩa vụ, no-return, KPI và export guard                                                                                                                     |
| 30    | Phân loại hãng             | File/tên/alias/manual/rule/full-format; giữ Chưa xác định khi thiếu; mâu thuẫn cần kiểm chứng                                                                          |
| 31–32 | Riêng/tổng hãng            | Bộ lọc hãng ở snapshot, workbook J&T/BEST/... riêng sheet; không sheet rỗng                                                                                            |
| 33    | Tổng nhóm đúng             | Fixture 745/634/483/151/111 chỉ trong test, tổng nhóm độc quyền khớp; không hardcode vào sản phẩm                                                                      |
| 34    | Tiền không nhân SKU        | Refund cấp yêu cầu một lần, report order amount cấp shop+order một lần; tiền thực nhận có ngày                                                                         |
| 35    | Lịch sử thay đổi           | Events/source versions append-only; receipts/inspection/claim/version được giữ, restore không bật lại parcel bị loại thủ công                                          |
| 36    | Xuất kho hồi quy           | `workflow`, `source-batch`, `pdf-source`, `prescan-*`, carrier formats và Playwright PDF J&T/SPX/BEST/HID/shift cũ                                                     |
| 37    | Dữ liệu cũ                 | Upgrade từ 19 có case/SKU/parcel/unknown/claim fixture; so UUID/source/events/time/items trước–sau, marker chạy lại được                                               |
| 38    | Phân quyền                 | Staff chỉ own/assigned, manager import/export/verify, admin archive; RLS/EXECUTE và append-only với role runtime thật trong giao dịch rollback                         |
| 39    | Ổn định sau deploy         | Local build + dry-run + production-browser + load test; **hosted còn chờ** health/auth/private Storage/HID/camera/đồng thời thực tế theo DEPLOYMENT.md                 |
| 40    | Rollback                   | Migration cộng thêm, schema gate, giữ ledger/history, cấm hard-delete hoàn; kế hoạch rollback code/backup/worker trong DEPLOYMENT.md, chưa diễn tập restore production |

## Tải và gián đoạn

- 20.000 dòng: toàn bộ đường private-original giả lập → normalize/staging SQL → preview → 200 lần commit, mỗi lần 100 hồ sơ, checkpoints/resume/reuse; tổng 20.000 case, 15.000 cần kiểm, 5.000 transit; list trang 400 đủ 50 dòng. Số đo cuối nằm trong BENCHMARK.json.
- 50.000 dòng CSV: production browser worker đọc đúng tổng và 200 dòng cuối, mã dài còn nguyên. Đây là kiểm parser, không giả vờ đã chạy full server 50.000 dòng.
- Browser cắt phản hồi sau staging và sau commit: chọn lại file/nhấn lại lưu, một upload, hai dòng, không thêm bản sao; cả desktop/mobile.
- Manual reconcile dùng cursor từng 1.000 bản ghi. Test mô phỏng lô 1 để chứng minh mã mơ hồ đầu danh sách không làm các mã chắc chắn sau đó bị bỏ quên.
- Nguồn kho sai rút riêng lượng theo SKU, giữ scan độc lập và file kho khác; manual QC đã có không bị file ghi đè.

## Giới hạn phép thử

ExcelJS round-trip và Chromium không thay việc mở Excel desktop/camera/HID thật hoặc kiểm Supabase/Cloudflare có credentials. Không tuyên bố đã migrate/deploy production hay chịu được số người đồng thời chưa đo. Không nhận những lần thử có lỗi là kết quả nghiệm thu: sau sửa phải chạy lại nhóm liên quan và kiểm tra tổng hợp cuối.
