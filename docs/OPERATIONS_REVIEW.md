# Rà soát vận hành và tổng quan hoàn kho — 2026-10-23

Bản ứng dụng: `2026-10-23.operations-1`. Đây là kết quả rà soát mã nguồn, PostgreSQL thử nghiệm và trình duyệt với API giả lập. Chưa xác nhận rollout Cloudflare, dữ liệu danh mục hoặc dịch vụ xử lý file trên production. Không thay đổi dữ liệu Railway/Supabase thật từ môi trường Codex.

## Các nguyên nhân và thay đổi

| Luồng                         | Phát hiện                                                                                                 | Xử lý                                                                                                                                                                                                                      |
| ----------------------------- | --------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Cài mới                       | SQL installer thiếu kho, sàn, J&T và một số alias mà CLI tạo sau migrations                               | Đồng nhất danh mục cơ bản; giữ 17 migration/checksum, không thêm đơn hoặc tài khoản demo                                                                                                                                   |
| Mở ca / nhập nguồn / bàn giao | Kho trống bị gửi như UUID; state select chỉ lấy giá trị ở lần render đầu, không theo kịp danh mục mới tải | Chọn giá trị hiện có từ catalog mỗi render, chặn nút khi thiếu kho, thông báo chọn kho bằng tiếng Việt, xác minh kho tồn tại phía server                                                                                   |
| Khôi phục danh mục hiện tại   | Người dùng đã tạo tài khoản nên không nên chạy lại bootstrap/seed                                         | Admin bấm **Thiết lập danh mục cơ bản** trong cảnh báo hoặc **Cấu hình hệ thống → Bổ sung danh mục cơ bản**. Giao dịch, advisory lock, chống trùng, có audit; giữ ID/tên/alias/cutoff đang dùng                            |
| Quyền nhân viên               | Backend hỗ trợ đổi quyền nhưng giao diện chỉ có khóa/mở khóa                                              | Thêm **Đổi quyền** với lý do, chỉ Admin được dùng, không đổi quyền của chính mình. Cập nhật role/trạng thái độc lập dưới row lock, tránh ghi đè thay đổi đồng thời                                                         |
| Bộ lọc hoàn                   | Đi từ Khiếu nại về Dashboard vẫn giữ bộ lọc cũ; unknown carrier bỏ sót hồ sơ chưa có vận đơn              | Reset trạng thái khi vào Dashboard; tách nhóm unknown (có mã chưa nhận diện hãng) và no_tracking (chưa có mã); tab Khiếu nại bao gồm nghi mất/mất cả khi chưa có claim                                                     |
| PDF/Excel/báo cáo             | Client có thể chờ 9 phút khi không có dịch vụ xử lý file hoặc treo khi mất phản hồi mạng                  | Hiển thị heartbeat trong references/jobs; trả thông báo ngay khi file đã xếp hàng nhưng processor offline, giới hạn mỗi yêu cầu điều khiển tác vụ ở 30 giây. Giữ job/upload/idempotency để xử lý tiếp khi worker hoạt động |
| Điện thoại                    | Thanh tab có thể làm rộng toàn trang, gây khó bấm vào cột cuối                                            | Giới hạn grid vào viewport; tab cuộn trong vùng riêng; bảng hãng hiển thị các số tổng/đã về/còn thiếu theo từng hãng                                                                                                       |

Tab nhập file/phân tích không còn poll toàn bộ danh sách hoàn mỗi 5 giây; trạm quét chỉ tải 20 sự kiện của chính nhân viên. Không nới kiểm tra UUID hoặc bỏ kiểm tra ca/kho/role. Parser PDF/Excel và báo cáo vẫn chỉ chạy trong child worker, không chuyển vào Cloudflare request.

## Tổng quan hoàn kho

Dùng các thẻ KPI như xuất kho, menu gọn, bộ lọc chính và bộ lọc mở rộng. Bấm thẻ hoặc tên/số đơn của hãng mở **Danh sách & xử lý**, giữ phạm vi ngày/kho/sàn; mở được từng hồ sơ và lưu xử lý ngay.

| Chỉ số               | Đơn vị và cách tính                                                                                                                                                                                                                                             |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Tổng đơn hoàn        | Số yêu cầu hoàn duy nhất (`return_cases`), không nhân theo SKU, số kiện hoặc số claim; số đơn gốc là một chỉ số khác                                                                                                                                            |
| Đã về kho            | Có ít nhất một kiện active đã được tít nhận. Có mục riêng cho nhận một phần; nhận kiện không đồng nghĩa kiểm đủ hàng                                                                                                                                            |
| Còn thiếu            | Chưa có kiện được nhận, loại yêu cầu hủy và không cần trả vật lý                                                                                                                                                                                                |
| Đơn bị mất           | Trạng thái nội bộ hiện tại đã xác nhận mất; không suy ra từ quá hạn hay trạng thái sàn                                                                                                                                                                          |
| Khiếu nại thành công | Đếm một lần mỗi yêu cầu có claim won/paid hoặc trạng thái nội bộ claim_won/compensated; tiền thực nhận là chỉ số riêng                                                                                                                                          |
| Chờ kiểm hàng        | Đã nhận và chưa kiểm hoặc kiểm nhận bị đánh dấu cần làm lại                                                                                                                                                                                                     |
| Tỷ trọng hãng        | Mỗi yêu cầu thuộc đúng một nhóm hãng. Nhiều hãng/known+unknown cùng hồ sơ vào nhóm cần đối chiếu; không có vận đơn vào nhóm chưa có mã hoàn; mã chưa khớp hãng vào nhóm chưa nhận diện hãng. Tổng nhóm khớp tổng yêu cầu; mở nhóm dùng `carrierScope=exclusive` |

Bổ sung tiến độ nhận hoàn, nhận một phần, hồ sơ hủy/không trả vật lý, quá mốc chưa về, đang khiếu nại, thiếu mã, nguồn đổi cần kiểm lại, tiền yêu cầu/được duyệt/thực nhận và xu hướng theo ngày yêu cầu. Các chỉ số lost/claim/receipt có thể giao nhau; không cộng chúng thành tổng. Tổng, danh sách và phân bổ dùng cùng bộ lọc và snapshot repeatable-read. Tra cứu hãng/reason/approval được giới hạn sớm theo ngày/kho/sàn/shop; không tải payload scan vào Dashboard.

## Kiểm tra trên hệ thống thật

1. Cloudflare deploy từ main; mở `/health?check=operations-1`, kiểm tra `appRevision` đúng `2026-10-23.operations-1`. API có header `X-ComsFlow-App-Revision`; sidebar cũng hiển thị bản ứng dụng. Database health giữ nguyên hợp đồng JSON thành công.
2. Admin đăng nhập, bấm thiết lập danh mục nếu cảnh báo thiếu kho/sàn, hoặc bổ sung tại Cấu hình hệ thống. Không chạy seed demo/SQL bootstrap để sửa database đang dùng.
3. Mở ca xuất và ca nhận hoàn tại đúng kho, phân công staff; thử một mã đã nhập và kiểm tra log sau F5, retry khi mất phản hồi.
4. Xem `/api/jobs` trong browser đã đăng nhập: `workerLastSeen` cần gần đây. Chưa có heartbeat thì cần triển khai/kết nối Node processor theo DEPLOYMENT.md. Render blueprint là tài nguyên có phí; chưa có dịch vụ nào được Codex mua hoặc tạo. Web deploy không tự tạo processor.
5. Thử PDF/Excel nhỏ, xác nhận nguồn, kiểm tra dữ liệu; sau đó mới nghiệm thu file thật lớn, CSV/Excel export và camera/HID thật. Job queued không được coi là đã nhập thành công.
6. Chuyển Railway data chỉ sau kế hoạch/backup/target xác nhận và đối soát count/hash; bản cập nhật này không chuyển hay xóa lịch sử.
