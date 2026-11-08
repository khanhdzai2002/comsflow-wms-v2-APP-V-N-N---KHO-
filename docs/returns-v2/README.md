# Quản lý & Đối soát hàng hoàn V2

Bản ứng dụng `2026-11-09.returns-v2-1`, nâng cấp từ `0fc6fb5` / 19 migration. Thay phân hệ hoàn khi migration 020 và quyền runtime sẵn sàng. Trước đó ứng dụng tiếp tục dùng giao diện hoàn cũ. Không thay cơ chế đăng nhập hoặc nghiệp vụ xuất kho.

- [Khảo sát kiến trúc và ánh xạ dữ liệu trước sửa](ARCHITECTURE-AND-MIGRATION.md)
- [Triển khai, sao lưu, nghiệm thu và rollback](DEPLOYMENT.md)
- [Hướng dẫn nhân viên kho / quản lý](OPERATOR-GUIDE.md)
- [Ma trận nghiệm thu và giới hạn kiểm chứng](ACCEPTANCE.md)
- [Số đo tải cục bộ](BENCHMARK.json)
- [Danh sách đầy đủ tệp thay đổi](CHANGED-FILES.md)

## Chức năng và cách đếm

Hai nguồn nghiệp vụ độc lập: **Đơn giao thất bại** và **Trả hàng – Hoàn tiền**. Một đơn mua có nhiều yêu cầu; mỗi yêu cầu có nhiều SKU/kiện. Yêu cầu khách trả hàng giữ mã yêu cầu gốc, giao thất bại có khóa nội bộ riêng `DF:<mã đơn>` trong phạm vi shop. Không dùng mã đơn làm khóa cho toàn bộ hệ thống.

Sổ nhận độc lập lưu cả mã chưa có nguồn, người/giờ/ca đầu tiên, người giao, ghi chú, phiên bàn giao và các lần thử nhận. File sau chỉ ghép mã + kho + phạm vi shop chắc chắn. Mã đơn không có vận đơn chỉ tự ghép khi một hồ sơ/kiện duy nhất và SKU xác định được; còn lại quản lý xác minh có lý do. Không ghép dựa trên tên khách, ngày hay giá trị.

Các KPI đếm hồ sơ/yêu cầu duy nhất trong **nguồn đang hiệu lực và bộ lọc hiện tại**. Sổ nhận vẫn giữ bằng chứng chưa có nguồn hoặc nguồn đã loại bỏ. Các KPI có thể giao nhau; biểu đồ trạng thái chính loại trừ nhau và có tổng bằng tổng hồ sơ:

1. Đã xử lý xong theo quyết định nội bộ.
2. Đã xác nhận mất bằng thao tác quản lý.
3. Không cần nhận hàng, khi chưa có nhận thực tế.
4. Dữ liệu cần xác minh: nguồn/tiền/hãng/mã trùng/nghĩa vụ mâu thuẫn.
5. Đã nhận ít nhất một kiện/bằng chứng ghép chắc chắn.
6. Đang trung chuyển.
7. Khách chưa gửi hàng.
8. Nghi thất lạc: nguồn vận chuyển báo hoặc quản lý đánh dấu.
9. Chưa nhận – cần kiểm tra khi có nghĩa vụ hoàn; còn lại cần xác minh.

**Không suy từ hủy đơn thành có bàn giao.** `RTS Time` (sẵn sàng giao) không phải bằng chứng đã giao hàng. Hủy trước bàn giao rõ ràng không phải hàng thiếu; hủy không đủ bằng chứng cần xác minh. Hoàn tiền không yêu cầu hàng vật lý được tách riêng. Quá ngày dự kiến chỉ là cảnh báo, không tự xác nhận mất.

Đã nhận kiện khác đã nhận đủ số lượng, khác đã kiểm chất lượng. Đủ số lượng đòi hỏi tất cả SKU có lượng thực tế bằng nguồn, các kiện đã nhận và kết quả không bị cũ. File SaleWork có thể là bằng chứng lượng nhưng không tự hoàn tất kiểm chất lượng. Kiểm hàng lưu riêng từng kiện hoặc toàn yêu cầu, SKU, màu/size, vị trí, người/giờ và lịch sử. Lần kiểm lại cùng kiện thay thế số hiện tại qua sự kiện mới, không cộng lặp; còn kiện chưa kiểm thì không gắn đã kiểm đủ. Lượng từ file kho cộng theo kiện, giữ riêng với kiểm chất lượng.

Giá trị hàng lấy từ giá trị hoàn hoặc đơn giá × lượng sản phẩm cần hoàn, không nhân giá trị cả đơn theo số SKU. Tiền hoàn khách chỉ tổng hợp như đã hoàn khi nguồn có ngày hoàn tiền. Bồi thường thực nhận bắt buộc có số tiền và ngày thực nhận. Giá trị chưa biết được cảnh báo, không tự điền 0. Tỷ lệ hoàn trên đơn bán tiếp tục dùng phân tích nguồn bán thật, không dùng số đã xuất kho làm mẫu số; thiếu nguồn hiển thị chưa đủ dữ liệu.

## Các nhóm mã nguồn

| Nhóm                            | Tệp chính                                                                                                                                  |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Schema, quyền, bảo toàn         | `migrations/020_return_operations.sql`, `supabase/upgrade-020.sql`, `scripts/sql/grant-hyperdrive-runtime.sql`                             |
| Quy tắc nguồn                   | `src/lib/return-facts.ts`, `return-identifiers.ts`, `return-intake-fields.ts`, `return-intake-normalize.ts`, `return-operation-sources.ts` |
| Nhập / checkpoint / file gốc    | `src/lib/return-intake-jobs.ts`, `jobs.ts`, `src/components/return-intake-client.ts`, `src/server/worker.ts`                               |
| Nhận, ca, phiên, ghép hai chiều | `src/lib/return-receipts.ts`, `returns.ts`, `src/components/return-handover.tsx`                                                           |
| Kiểm, khiếu nại, phân công      | `src/lib/returns.ts`, `return-operation-actions.ts`, `src/components/returns.tsx`                                                          |
| Loại bỏ / khôi phục nguồn       | `src/lib/return-source-archive.ts`                                                                                                         |
| Tổng hợp / phân trang / quyền   | `src/lib/return-operation-query.ts`, `return-operations-access.ts`, `src/server/return-operation-api.ts`                                   |
| Bằng chứng private              | `src/lib/return-media.ts`, `stored-file-verification.ts`, `src/components/return-media-client.ts`                                          |
| Báo cáo                         | `src/lib/return-reports.ts`, `src/components/return-report-client.ts`, `src/worker/return-report-workbook.ts`                              |
| CSV/XLSX browser workers        | `src/worker/browser-return-intake.ts`, `browser-return-report.ts`, `xlsx-raw-table.ts`; bộ đọc XML dùng chung với Node cũ                  |
| Giao diện / trợ giúp            | `src/components/return-operations.tsx`, `return-schema-notice.tsx`, `workspace.tsx`, `user-guide.tsx`, `catalog-readiness.tsx`             |
| Giữ lịch sử                     | `src/lib/maintenance.ts` chặn xóa hoàn vĩnh viễn khi 020 có mặt; `src/worker/main.ts` giữ file gốc intake                                  |
| Build / cài đặt                 | `scripts/build-supabase-sql.mjs`, `setup-storage.ts`, `vite.config.ts`, `src/lib/app-version.ts`, `AGENTS.md`                              |

Không thêm dependency. PDF/Excel parser không đi vào Cloudflare handler. Luồng mới cho CSV/XLSX hàng hoàn và Excel gửi hãng chạy trong worker trình duyệt; SQL, phân quyền, đối soát và xác nhận ghi đều ở máy chủ. Các tác vụ nền cũ, gồm nhập nguồn bán nâng cao, vẫn dùng Node processor như trước.
