# Bộ hướng dẫn hàng hoàn cho nhân viên kho

Bộ 14 slide tiếng Việt, bắt đầu từ hai nguồn **Đơn giao thất bại** và **Trả hàng – Hoàn tiền**, sau đó nhập/xem trước/xác nhận, nhận theo ca và phiên, đối soát hai chiều, kiểm từng kiện/SKU, tra soát theo hãng, khiếu nại, cập nhật nguồn và chốt cuối ca. Tách rõ nghĩa vụ trả hàng, bằng chứng nhận, kiểm lượng/chất lượng và tiền bồi thường. Không hứa phần mềm tự khiến hãng giao hàng hoặc tự cộng tồn bán.

- [Xem slide trực tuyến](https://comsflow-wms-v2-app-v-n-n---kho.comsflow-apps.workers.dev/huong-dan-hang-hoan/)
- [Quy trình ngắn để in tại kho](https://comsflow-wms-v2-app-v-n-n---kho.comsflow-apps.workers.dev/huong-dan-hang-hoan/quy-trinh-nhan-hoan.html)
- Trong app: **Hướng dẫn sử dụng → Mở 14 slide hướng dẫn**.

## Tệp bàn giao

Trong `public/huong-dan-hang-hoan/`:

- `index.html`: trình chiếu bằng phím mũi tên, chọn trang, chế độ đọc liên tục; trên điện thoại mặc định chế độ đọc, không cần tải file.
- `Huong-dan-hang-hoan-V2.pdf`: 14 trang, chữ tìm kiếm/chọn được.
- `Huong-dan-hang-hoan-V2.pptx`: 14 slide ảnh độ phân giải cao để trình chiếu. Chữ không là text box chỉnh sửa; nội dung có trong speaker notes. Chỉnh nguồn HTML/Python rồi xuất lại nếu muốn sửa.
- `Quy-trinh-nhan-hoan-A4.png`, `.pdf`: một trang quy trình, có QR mở hướng dẫn, phù hợp in A4.
- `slides/01.png` đến `14.png`: ảnh riêng từng slide.
- `Bo-huong-dan-hang-hoan-V2.zip`: gói xem offline gồm tài liệu, ảnh, font và giấy phép.

Các số liệu, mã và tài khoản trong ảnh là **minh họa**. Ảnh được chụp từ giao diện ứng dụng local với API giả lập, không đăng nhập/ghi vào Supabase thật. Không chứa mật khẩu, token thật hoặc dữ liệu khách hàng. Không thay nghiệp vụ xuất/hoàn, schema hoặc secret.

## Tái tạo tài liệu

Dùng Node + Playwright/Chromium sẵn có; Python có `python-pptx`, `Pillow`, `PyMuPDF`, `reportlab` cho công cụ xuất tài liệu, không thêm dependency cho ứng dụng. Font Noto Sans đi kèm có giấy phép trong assets.

1. Build app và chạy Vite preview tại `127.0.0.1:5181`.
2. `node scripts/training/capture-return-ui.mjs`: chụp ảnh UI bằng dữ liệu tổng hợp; script chỉ chấp nhận host local.
3. `python scripts/training/build-return-guide.py` và `python scripts/training/build-return-poster.py`: tạo HTML. Chỉnh nội dung tại hai file Python này; `slide-content.json` là bản xuất để rà soát.
4. Phục vụ `public/huong-dan-hang-hoan` bằng HTTP local cổng 5190.
5. `node scripts/training/export-return-guide.mjs`: kiểm chữ/ảnh tải đủ, không tràn khung, điều hướng và chế độ đọc mobile; xuất PNG/PDF.
6. `python scripts/training/package-return-guide.py`: kiểm 14 trang PDF có text, 1 trang poster, 14 slide PPTX; đóng gói ZIP.

Vite tự chép thư mục public vào bản Cloudflare. Không cần migration hoặc dịch vụ xử lý file để xem tài liệu.
