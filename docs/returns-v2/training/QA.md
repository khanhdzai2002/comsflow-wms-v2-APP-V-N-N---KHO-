# Kiểm tra bộ hướng dẫn — 09/11/2026

- Nội dung đối chiếu với `return-domain`, `return-operations`, `returns`, `return-handover`, workbook hãng và OPERATOR-GUIDE của bản module `9222fe4`.
- 14 slide tiếng Việt; ảnh giao diện local với tài khoản/mã/số lượng tổng hợp, chú thích minh họa. Không ghi production và không dùng hồ sơ khách.
- Đã kiểm và xem ảnh tất cả slide qua contact sheet, xem riêng các trang kiểm SKU, báo cáo và poster; sửa ảnh báo cáo bị modal che trước xuất cuối.
- Export kiểm đủ ảnh/font, 14 khung không tràn nội dung, không lỗi JavaScript, mũi tên/chọn trang và chế độ đọc liên tục hoạt động. Màn hình 390px không tràn ngang.
- PDF 14 trang có text chọn/tìm được, không ký tự thay thế; poster PDF đúng 1 trang A4; PowerPoint đọc lại đúng 14 slide, có ghi chú chữ.
- Tất cả tài liệu/ZIP/ảnh/HTML trả HTTP 200 từ production preview; liên kết mới trong trang Hướng dẫn sử dụng mở đúng đường dẫn.
- Typecheck, lint, 377 bài nghiệp vụ/hồi quy trong 28 tệp, client build, worker build, Wrangler dry-run đạt. Playwright hồi quy 42/42 trên production preview đạt, gồm desktop và kích thước điện thoại.
- Chưa kiểm slide bằng Microsoft PowerPoint thực tế, chưa xác nhận bản hướng dẫn đã được Cloudflare phát hành từ workspace. Chờ build mới Ready khi mở link hosted. QR trỏ về trang hướng dẫn của app; chưa thử quét bằng camera thiết bị thật.

Nguồn chỉnh sửa: scripts/training và slide-content.json. PowerPoint dùng ảnh slide chất lượng cao, chữ trong notes; PDF và HTML giữ chữ thực. Không quảng cáo tệp PowerPoint là bộ text box chỉnh sửa.
