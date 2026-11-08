# Quản lý & Đối soát hàng hoàn V2 — rà soát trước thay đổi

Ngày rà soát: 09/11/2026. Repository hiện tại: comsflow-wms-supabase; không sửa onlineportfolio/Railway. Phiên bản nền 0fc6fb5, 19 migration. Tài liệu này được lập trước thay đổi schema và code nghiệp vụ.

## Bản đồ ảnh hưởng

| Phần            | Hiện trạng                                                                                                                                  | Phương án nâng cấp                                                                                                                               |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Web/API         | React 19 + Vite; Cloudflare Worker portable API                                                                                             | Giữ nền tảng, thay màn hình hàng hoàn bằng điều hướng nghiệp vụ mới sau khi schema sẵn sàng                                                      |
| Xác thực        | Supabase Auth, cookie phiên; users admin/manager/staff                                                                                      | Giữ ba vai trò; quản trị/đối soát ánh xạ admin/manager, nhân viên chỉ hồ sơ được phân công hoặc đã tham gia nhận trong kho/ca hợp lệ             |
| Dữ liệu         | Supabase PostgreSQL; return_cases/items/parcels/imports/snapshots/events/claims/evidence                                                    | Thêm dữ liệu có quan hệ; không thay UUID hay xóa/ghi lại lịch sử cũ                                                                              |
| Nhận hoàn       | receiveReturn xác minh ca/kho; unknown chỉ có event, không trở thành bằng chứng nhận có thể ghép sau                                        | Sổ nhận thực tế độc lập, lưu nguồn/giờ/người, chống trùng, ghép chính xác sau nhập nguồn và giữ ca cũ                                            |
| Kiểm/khiếu nại  | Đếm theo item_key, khóa version; claims có tiền yêu cầu/chấp nhận/thực nhận                                                                 | Giữ guard, bổ sung tình trạng kiểm, trách nhiệm, người phụ trách, deadline, kết quả tra soát và bằng chứng                                       |
| Import          | CSV nhỏ đọc tại API, XLSX + CSV cũ qua Node worker; XLSX đọc raw XML tránh Number cho mã                                                    | Luồng có staging, xem trước, checkpoint, nhập từng nhóm hồ sơ; file gốc private, CSV/XLSX không đưa parser nặng vào Cloudflare                   |
| Tra cứu/báo cáo | returnList có bước tải danh tính cả phạm vi vào JS; giới hạn kết quả                                                                        | Truy vấn, phân trang, tổng hợp SQL; tránh tải toàn bộ lịch sử vào trình duyệt; XLSX mã là string và sheet theo hãng                              |
| Xuất kho        | scan/source-manifests, PDF browser worker; bằng chứng quét trước nhập đã có                                                                 | Giữ nguyên hành vi, chạy hồi quy                                                                                                                 |
| Triển khai      | GitHub main → Cloudflare; Hyperdrive role comsflow_connection_check; Supabase private Storage; Node processor riêng chưa xác nhận hoạt động | Cấp rõ quyền + RLS cho mọi bảng/view mới trong cùng migration; có SQL sao chép trong app; không nhận là đã triển khai hosted nếu chưa kiểm chứng |

## Ánh xạ và bảo toàn dữ liệu

| Dữ liệu cũ                                 | Dữ liệu nâng cấp                         | Quy tắc                                                                                          |
| ------------------------------------------ | ---------------------------------------- | ------------------------------------------------------------------------------------------------ |
| return_cases.id, shop_id, external_id      | Giữ nguyên hồ sơ khách trả hàng          | Không lấy order_code làm khóa yêu cầu; thêm nhánh giao thất bại có danh tính riêng               |
| order_code và return_parcels.tracking_code | Chuỗi nguyên bản                         | Không Number/parseFloat, không suy đoán chữ số đã mất                                            |
| source_data + last_import_id               | Nguồn hiện tại và phiên bản nguồn        | Giữ snapshot gốc; lưu phiên bản mới để loại bỏ/khôi phục đợt nhập mà không xóa nhận hàng         |
| return_items                               | Giữ từng SKU, expected_qty, received_qty | Không cộng tiền cấp đơn theo số dòng SKU; nhận kiện khác kiểm đủ sản phẩm                        |
| return_parcels.received_at/by              | Bằng chứng nhận cũ vẫn nguyên            | Bổ sung sổ nhận độc lập liên kết về kiện; không sửa thời gian/người đã nhận                      |
| return_events                              | Nhật ký gốc append-only                  | Không sửa unknown cũ thành received; bổ sung liên kết và sự kiện đối soát mới                    |
| return_claims                              | Giữ hồ sơ và ba loại số tiền             | Bổ sung trường trách nhiệm/phụ trách/đóng/tra soát; không coi tiền hoàn khách là giá trị tồn kho |
| return_evidence                            | Giữ ảnh/PDF bytea cũ                     | Bằng chứng mới ưu tiên private Storage; không xóa tệp cũ khi nâng cấp                            |
| return_imports/snapshots/results           | Giữ lịch sử và checksum                  | Có đợt nhập tổng/staging, liên kết các lô; loại bỏ mềm có audit và khôi phục                     |
| no_physical_return                         | Quyết định nội bộ cũ được giữ            | Quy tắc nguồn chỉ hoàn tiền/hủy trước bàn giao được tính riêng, không ghi đè quyết định thủ công |

## Quy tắc đối soát

- Chính xác mã vận đơn + kho + phạm vi shop/sàn; không theo tên khách, ngày hay giá trị. Nếu có nhiều ứng viên thì chờ xác minh.
- Khi không có vận đơn: chỉ ghép mã đơn chính xác trong phạm vi đơn nhất, đủ bằng chứng số lượng/SKU và không xung đột; không tự tạo mã vận đơn giả.
- Giao thất bại cần bằng chứng đã bàn giao/trạng thái vận chuyển thể hiện hàng đang hoàn. Hủy đơn đơn thuần không chứng minh có nghĩa vụ hoàn.
- Trung chuyển không mặc định là thiếu hay mất. Quá hạn chỉ tạo nghi vấn; xác nhận mất là quyết định có audit.
- Chỉ hoàn tiền không tính vào hàng cần nhận. Đã nhận kiện không tự chuyển đã kiểm; hoàn một phần đánh giá từng SKU thực nhận.
- Kết quả theo hồ sơ/yêu cầu duy nhất; công bố rõ tập chỉ tiêu có thể giao nhau. Biểu đồ nhóm độc quyền dùng thứ tự phân loại được mô tả.

## Kế hoạch thực hiện và kiểm chứng

1. Thêm schema/projection + cấp quyền runtime; kiểm tra nâng cấp từ 19 và dữ liệu cũ.
2. Nhập nguồn giao thất bại, trả hàng/hoàn tiền, SaleWork; aliases/ánh xạ, staging/checkpoint/chống trùng và kiểm tra mã chuỗi.
3. Sổ nhận, phiên bàn giao, đối soát hai chiều, SKU/kiện, kiểm/khiếu nại và quyền truy cập.
4. SQL tổng hợp/phân trang, màn hình tiếng Việt và xuất báo cáo theo hãng; Excel round-trip.
5. Kiểm thử nghiệp vụ + hồi quy xuất kho + tải nhiều dòng; bàn giao SQL, hướng dẫn, danh sách tệp và rollback.

## Triển khai và rollback

Không chạy migration lên production từ workspace. Trước khi chạy: chủ dự án xác nhận project lyeyjfvxmqruszgfrjze, sao lưu có thể phục hồi, thử staging và kiểm tra counts/IDs/receipts/claims. SQL chỉ thêm cấu trúc và quyền, không drop/truncate dữ liệu nghiệp vụ. Tách code UI mới bằng cờ schema sẵn sàng, để bản cũ còn hoạt động trong quá trình nâng cấp.

Rollback ứng dụng về Git SHA nền; giữ các bảng/column mới và mọi bằng chứng đã phát sinh. Không rollback bằng DROP TABLE. Đợt nhập sai dùng loại bỏ mềm + tính lại nguồn còn hiệu lực, giữ nhận thực tế/kiểm hàng/khiếu nại/audit. Nếu thay đổi nguồn làm kết quả kiểm hàng không còn khớp, đánh dấu cần kiểm lại thay vì xóa kết quả.

Các giới hạn hạ tầng, số người đồng thời, dung lượng dữ liệu và trạng thái Node processor phải được ghi đúng trong nghiệm thu; load test cục bộ không thay nghiệm thu Supabase/Cloudflare thực tế.
