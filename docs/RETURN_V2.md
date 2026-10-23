> Tài liệu nghiệp vụ kế thừa. Cấu hình chạy và triển khai v2 dùng [Cloudflare + Supabase](DEPLOYMENT.md); các hướng dẫn hosting Railway/Next.js trong lịch sử không áp dụng cho dự án mới.

# Quản lý đơn hoàn V2

V2 tiếp tục trên module hiện tại; không tạo app hoặc database mới. Không tự xoá dữ liệu, tự nhận hàng, tự nhận tiền hay tự cộng tồn kho. Migrations 013/014 là bổ sung; giữ checksum 001–012.

## Nhập và cập nhật file

Vào **Quản lý đơn hoàn → Nhập dữ liệu đơn hoàn → Cập nhật file**. Chọn đúng **Kho nhận hoàn**, shop, sàn và Excel/CSV. Đọc/đối chiếu để xem tổng yêu cầu, mới/đã có, đổi trạng thái, không đổi, đổi tài chính, lỗi; mở từng yêu cầu để xem trường và giá trị cũ → mới. Xác nhận cập nhật khi đúng nguồn.

- Danh tính là shop/sàn + Return Order ID; Order ID không được đổi. Mã vận đơn trả gắn kiện bên trong yêu cầu, không dùng thay mã yêu cầu: một mã có thể khớp nhiều yêu cầu.
- Trạng thái sàn, nguồn sản phẩm và thông tin tài chính cập nhật riêng với nhận kiện/kiểm hàng/ghi chú/phân công/khiếu nại. Không lấy Refund Time hay trạng thái hoàn tiền làm bằng chứng nhận kho hoặc nhận bồi thường.
- Ô trống không xoá thông tin đã biết. Số tiền **0** là giá trị thật, vẫn được cập nhật. Thiếu một SKU trong bản xuất mới không loại SKU đã có. Nếu số lượng/mã kiện thay đổi sau kiểm hàng, giữ kết quả cũ và đánh dấu cần kiểm lại.
- Nếu file có thời điểm cập nhật từ sàn cũ hơn nguồn hiện tại, chặn ghi lùi. File TikTok mẫu không có trường này: người dùng cần xác nhận đúng bản xuất mới; app không tự chứng minh thứ tự thời gian bằng tên file.
- Preview có dấu phiên bản; hồ sơ đổi sau khi xem trước thì phải đọc lại. Nhập lại cùng file/shop không tạo trùng. Khác shop/sàn không bị gộp.
- File có lỗi không lưu một phần. **Lịch sử cập nhật file** có lần đọc thử/lỗi, các lần đã lưu, người/thời gian/sàn/shop, số mới/cập nhật/không đổi/đổi trạng thái/đổi tiền và trường cũ → mới. Nguồn trước V2 giữ nguyên lịch sử cũ, không dựng lại diff giả.

## Hãng vận chuyển

`src/lib/carriers.ts` là service chung: vận đơn đã xác minh/dữ liệu nguồn đáng tin cậy → tên hãng hợp lệ trong file → tiền tố cấu hình dài nhất. Quy tắc tiền tố là gợi ý hãng, không chứng minh sàn hoặc đơn tồn tại. Không mặc định TikTok = J&T hoặc Shopee = SPX. Không khớp thì **Chưa xác định**.

Danh mục/quy tắc cũ được giữ. Admin thêm/đổi tên chuẩn hãng và thêm/sửa/tắt quy tắc tại **Cấu hình hệ thống**. Tên cũ khi đổi được giữ như alias để file cũ còn nhận ra. Alias, combo, lý do và ngưỡng chỉnh tại **Phân tích hoàn trả → Cấu hình hãng, combo, lý do và ngưỡng**. Hãng phổ biến có danh mục, không tự tạo quy tắc mã chưa được kiểm chứng. Tên hãng trong nguồn mâu thuẫn tiền tố được gắn cảnh báo, vẫn ưu tiên tên hợp lệ trong file; hãng quản lý xác minh thủ công không bị file sau ghi đè. Dữ liệu legacy chưa có carrier_id vẫn được hiển thị/lọc bằng cùng service, không phải một thuật toán khác.

Danh sách có **Đơn vị trả hàng**, **Mã vận chuyển trả hàng**, tìm kiếm mã, lọc hãng, sắp xếp hãng, ẩn/hiện cột và copy nhanh mã hoàn. Dùng nút **Xem / xử lý** để mở thông tin trên, thao tác dưới. Copy chi tiết có mã đơn/mã hoàn/mã yêu cầu/toàn bộ thông tin/thông tin khiếu nại. Trình duyệt báo “Đã sao chép” sau khi sao chép thành công.

## Trường nguồn và tài chính

Giữ `source_data` và snapshot nguyên file. Các cột mở rộng đều có ánh xạ: hãng trả, vận đơn giao ban đầu, ngày đặt/cập nhật sàn/chấp thuận/vận chuyển/dự kiến, lý do, note, mô tả, bằng chứng khách, màu/size, giá trị sản phẩm trả, tiền hoàn khách, phí vận chuyển trả nhà bán chịu, phí hoàn khác, bồi thường sàn báo và trạng thái tranh chấp/kháng nghị/bồi thường sàn.

File TikTok gốc có 25 cột. Có Order Amount, Return unit price, Return Quantity, Time Requested, Refund Time, Return Reason, Buyer Note, Dispute/Appeal/Compensation Status và Compensation Amount. **Không có** tên hãng trả, vận đơn giao ban đầu, ngày đặt/cập nhật/chấp thuận/dự kiến trả, số tiền khách thực được hoàn, các loại phí hoàn tách riêng, màu/size độc lập, URL bằng chứng hay mô tả lỗi riêng. Những trường thiếu hiện **Chưa có dữ liệu**; SKU Name vẫn hiển thị nguyên văn, không tự tách màu/size thiếu quy tắc.

- Order Amount lặp theo SKU/yêu cầu: hiển thị một giá trị duy nhất, không cộng lặp thành tổng.
- Giá trị sản phẩm trả = Return Product Amount nếu có; nếu thiếu, chỉ tính đơn giá × SL khi đủ đơn giá các SKU. Đây không phải tiền đã hoàn.
- Seller Return Shipping Fee và Other Return Fee là hai trường riêng; không lấy phí này thay phí kia.
- Compensation Amount là **số tiền sàn báo**, tách với yêu cầu/duyệt/thực nhận trong hồ sơ khiếu nại nội bộ. Tiền thực nhận cần người dùng xác nhận số tiền và ngày nhận như trước.
- Timeline chỉ dùng ngày nguồn/sự kiện thật. Các lần import không tạo ngày chấp thuận/vận chuyển/hoàn tất giả.

Shopee đơn hoàn vẫn cần ánh xạ theo file thật; chưa có file hoàn Shopee gốc để khẳng định nhận tự động mọi định dạng. PDF xuất kho Shopee/SPX và Shopee/GHN đã có mẫu gốc kiểm chứng riêng, không đồng nghĩa có mẫu hoàn Shopee.

## Phân tích lý do và tỷ lệ sản phẩm

Vào **Phân tích hoàn trả**. Lý do gốc giữ riêng; quy tắc cụm từ rõ nghĩa phân loại, không đọc note khách để suy đoán. Không khớp hoặc khớp nhiều nhóm khác nhau → Khác/chưa phân loại. Donut/bảng/tỷ trọng/giá trị/sàn/biến động ngày dùng cùng phạm vi ngày yêu cầu. Click lý do để mở đúng danh sách, giữ sàn/shop/ngày/loại hoàn và bỏ bộ lọc tìm kiếm cũ.

Tỷ lệ theo sản phẩm dùng **nhóm đơn bán có ngày tạo đơn bán trong kỳ**, rồi liên kết yêu cầu hoàn về shop/sàn + đơn gốc + SKU ID của nhóm đó; ngày yêu cầu hoàn có thể nằm sau kỳ bán. Không lấy trạng thái xuất kho làm bán thành công.

1. Mở **Nhập / cập nhật nguồn bán thành công để tính mẫu số**. Dùng file bán thật CSV/XLSX, tải mẫu khi cần. Ánh xạ Order ID, SKU ID, Quantity, Created Time, Order Status; nên bổ sung Seller SKU, màu, size và mã dòng riêng.
2. Khai báo chính xác các trạng thái bán thành công trong file (phân cách `;`); các trạng thái khác không được tính. Ví dụ file có trạng thái giao hàng trong Order Substatus, phải ánh xạ cột đó. Preview cho xem từng dòng được tính/không tính trước lưu.
3. Cùng shop/đơn/mã dòng được cập nhật, không cộng chồng file. Thiếu mã dòng dùng SKU+màu+size; nếu lặp không rõ danh tính thì chặn và yêu cầu mã dòng riêng. Ngày bán/SKU của một mã dòng không được tự đổi. Nguồn bán có dòng huỷ cập nhật loại dòng đó khỏi mẫu số.
4. Tỷ lệ = SL yêu cầu hoàn liên kết / SL bán thành công cùng nhóm × 100. Không có mẫu số, SKU/combo chưa rõ hoặc có yêu cầu chưa liên kết cho sản phẩm → **Chưa đủ dữ liệu**. Dòng chưa liên kết không được gán vào một kỳ bán bằng ngày hoàn.
5. Loại **Tất cả / Sàn chấp thuận** dùng SL yêu cầu; loại **Đã nhận thực tế** chỉ dùng SL đã kiểm, bỏ dòng chưa kiểm hoặc cần kiểm lại. Nhận một kiện không mặc định nhận đủ SKU.
6. Lọc sàn/shop/ngày/mã SP/màu/size/lý do, sắp xếp tỷ lệ/SL hoàn/giá trị/SL bán, đặt SL bán tối thiểu. Nhấn mã để xem màu/size/lý do/sàn. Ngưỡng thấp/cao do Admin cấu hình; xám = thiếu dữ liệu.

SKU đơn như MIU37/MIU66/MAN00 nhận mã đơn; mã dài ghép như MAN8688/MIU2322 cần cấu hình từng thành phần, **SL thành phần trên 1 SKU**, **trọng số phân bổ giá trị**, màu/size nếu xác định. Không mặc định một chiếc/mã. Tổng tiền phân bổ giữ bằng tiền nguồn (sai số làm tròn vào thành phần cuối), không nhân giá trị hoàn theo số thành phần. Combo hoàn một phần phải có SKU/dòng thể hiện phần thực trả và cấu hình tương ứng; nếu file chỉ nói tên combo mà thiếu định lượng phần trả, cần sửa/ánh xạ nguồn rõ ràng, không tự đoán.

Cảnh báo độ đầy đủ luôn có: dữ liệu bán nhập có thể chưa đủ, đơn bán vẫn có thể phát sinh hoàn, không chứng minh đã hết thời hạn hoàn. Nhiều yêu cầu khác nhau cùng SKU/đơn có thể làm tổng SL yêu cầu vượt bán: app cảnh báo để kiểm tra, không tự bỏ yêu cầu hoặc chặn tỷ lệ tại 100%. Giá trị phân tích sản phẩm là giá trị sản phẩm yêu cầu trả, không phải tiền bồi thường/khách thực nhận.

## Dữ liệu cũ, dọn và triển khai

Migration **013_return_v2.sql** chỉ thêm bảng/cột và quyền/guard; **014_tiktok_return_reasons.sql** bổ sung các cụm lý do đã kiểm chứng từ file TikTok gốc, giữ quy tắc quản trị đã có. Carrier_id cũ được xem là xác minh thủ công. Cột lý do cho nguồn trước V2 được suy ra lúc đọc từ lý do gốc; không xoá/viết lại lịch sử. Dọn hồ sơ hoàn giữ summary lần nhập nhưng xoá diff theo hồ sơ cùng ảnh/PDF/snapshots như đã xác nhận; guard vẫn cấm sửa/xoá lịch sử ngoài job hợp lệ. File bán độc lập không bị xoá khi dọn hồ sơ hoàn; báo cáo sau dọn phản ánh tử số đã mất và cảnh báo dữ liệu lịch sử đã dọn như module.

V2 chạy schema qua `npm run db:migrate`, deploy web/API Cloudflare và worker riêng theo DEPLOYMENT.md. Không chạy seed/demo hoặc script test trên production. Các file nguồn khách hàng không đưa vào Git.

## Mã nguồn và kiểm chứng

- `src/lib/carriers.ts`: danh mục, alias, nguồn ưu tiên, tiền tố dài nhất và mâu thuẫn dùng chung.
- `src/lib/return-import.ts`, `return-source.ts`, `returns.ts`: đọc bảng an toàn, trường nguồn mở rộng, merge không xoá ô trống, diff/phiên bản, hãng và bộ lọc.
- `src/lib/sales-import.ts`, `return-analytics.ts`, `return-settings.ts`: nguồn bán thật, nhóm đơn bán, phân rã/phân bổ combo, lý do/ngưỡng/cấu hình/lịch sử file.
- `src/components/returns.tsx`, `return-detail-info.tsx`, `return-analysis.tsx`, `return-status.tsx`: giao diện cập nhật/lịch sử/chi tiết/copy, biểu đồ và badge. `management.tsx` quản lý hãng và quy tắc; `user-guide.tsx` hướng dẫn trong app; CSS trong `src/app/globals.css`.
- `src/app/api/[...path]/route.ts`: các API mới vẫn dùng session/Origin và phân quyền hiện tại. `scan.ts` gọi service hãng chung; `maintenance.ts` bao gồm diff hồ sơ khi dọn.
- `migrations/013_return_v2.sql`, `014_tiktok_return_reasons.sql`: bảng/cột/chỉ mục/RLS/guard và nhãn lý do thật. Không có dependency mới.
- `tests/returns-v2.test.ts`, `tests/e2e/app.spec.ts`: kiểm tra dữ liệu, hồi quy và luồng trên trình duyệt; kết quả cụ thể trong [VALIDATION](VALIDATION.md).

File XLSX TikTok gốc vẫn đọc đúng 106 yêu cầu, 101 đơn, 89 mã, 109 sản phẩm; bảy nhãn lý do thực tế đều được kiểm tra phân nhóm. Mẫu bán hàng dùng dữ liệu giả lập có nhãn để kiểm tra logic, không giả danh dữ liệu kinh doanh của shop. Chưa có file bán gốc hoặc đơn hoàn Shopee gốc để kiểm chứng ánh xạ cụ thể; UI cho xem trước từng dòng trước khi lưu. Camera/súng quét vật lý và việc Railway đã deploy cần kiểm tra ở môi trường thực tế.
