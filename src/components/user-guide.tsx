"use client";
import {
  ArrowDown,
  ArrowRight,
  BookOpen,
  CheckCircle2,
  ShieldCheck,
  TriangleAlert,
} from "lucide-react";
import type { User } from "@/lib/db";

const sections = [
  {
    page: "dashboard",
    name: "Tổng quan",
    roles: "Admin, Quản lý",
    meaning:
      "Theo dõi số vận đơn hợp lệ, đã tít, chưa tít, chờ bàn giao và ngoại lệ. Bấm KPI để mở đúng danh sách tương ứng.",
    action:
      "Chọn ngày cần xuất, kho, sàn và hãng. Số liệu tự cập nhật mỗi 5 giây.",
  },
  {
    page: "scan",
    name: "Quét vận đơn",
    roles: "Tất cả tài khoản",
    meaning:
      "Ghi nhận kiện tại kho bằng nhập tay, súng HID hoặc camera; lưu nhân viên, ca và thời gian máy chủ.",
    action:
      "Chọn đúng kho và ca được phân công. Chọn Nhập tay để gõ/dán mã rồi Enter/Xác nhận; chọn HID nếu súng gửi Enter/Tab.",
  },
  {
    page: "shipments",
    name: "Danh sách vận đơn",
    roles: "Admin, Quản lý",
    meaning:
      "Tra cứu vận đơn, đơn sàn, sản phẩm, trạng thái và lịch sử quét/điều chỉnh.",
    action:
      "Tìm mã, kiểm tra ngày cần xuất và bấm mã vận đơn để xem chi tiết. Xuất Excel/CSV dùng cùng bộ lọc.",
  },
  {
    page: "reconcile",
    name: "Đối soát xuất kho",
    roles: "Admin, Quản lý",
    meaning:
      "Tách đơn dự kiến chưa tít, đã tít chưa bàn giao và ngoại lệ cần kiểm tra. Nhật ký lượt quét cho biết cả lượt trùng và lỗi.",
    action:
      "Tải nhầm file: chọn nguồn → Loại bỏ nguồn → nhập lý do và xác nhận. Vào Hiển thị nguồn → Nguồn đã loại bỏ để xem/khôi phục. Chỉ gỡ nguồn, không xóa vận đơn hay lịch sử, số liệu Tổng quan vẫn giữ nguyên. Mở tab Theo file nguồn PDF để xem tổng phải xuất, còn thiếu quét, chưa bàn giao và ngoại lệ theo đúng từng mã. Đã quét đủ chưa đồng nghĩa bàn giao đủ. Không cộng số kiện giữa các file có mã trùng. Đối chiếu dữ liệu nguồn, nhập bổ sung nếu thiếu, rồi quét lại. Đóng ngoại lệ chỉ ghi nhận kết quả kiểm tra, không tự xác nhận xuất kho.",
  },
  {
    page: "handover",
    name: "Bàn giao vận chuyển",
    roles: "Admin, Quản lý",
    meaning:
      "Lập phiếu theo cùng hãng và kho. Phiếu nháp chưa phải xác nhận bàn giao.",
    action:
      "Chọn kiện đã tít, tạo nháp, kiểm đếm thực tế rồi xác nhận. Nháp sai có thể hủy với lý do; kiện được trả về Đã tít để lập lại phiếu.",
  },
  {
    page: "reports",
    name: "Báo cáo & Thống kê",
    roles: "Admin, Quản lý",
    meaning:
      "So sánh sàn, hãng, năng suất nhân viên và số lượt xử lý theo thời gian.",
    action:
      "Lọc trước khi đọc/xuất số liệu. Số vận đơn duy nhất khác số lượt thử quét; lượt trùng không tăng năng suất thành công.",
  },
  {
    page: "imports",
    name: "Nhập dữ liệu",
    roles: "Admin, Quản lý",
    meaning:
      "Nhập PDF tem Shopee/SPX Express/GHN hoặc TikTok/J&T/BEST Express để đếm mã vận đơn duy nhất và lưu danh sách nguồn; hoặc nhập CSV/XLSX với chi tiết sản phẩm, ánh xạ cột và lưu template.",
    action:
      "Chọn tab PDF tem vận đơn hoặc Excel / CSV đơn hàng ở đầu trang; tab đang chọn có viền cam. Với PDF: chọn cùng kho/shop/ngày, thêm tối đa 20 file (mỗi PDF tối đa 50 MB / 3.000 trang) và để cả Sàn và Hãng ở Tự nhận dạng từng file khi nhập chung Shopee/SPX/GHN và TikTok/J&T/BEST. Kiểm tra sàn/hãng hiển thị của từng file trước khi lưu; chọn thủ công sai sẽ bị chặn. Shopee dùng Mã đơn hàng khớp OrderSN và mã SPXVN (SPX) hoặc G + 7 chữ/số tại trường Mã vận đơn (GHN), TikTok dùng Order ID cùng tem J&T/BEST. Hai shop cùng tên ở hai sàn được lưu riêng. File lớn có thể mất thời gian xử lý; chờ xác nhận máy chủ, không đóng trang khi đang lưu. Đọc và đếm, kiểm tra từng file cùng tổng mã duy nhất rồi Lưu N file hợp lệ. File lỗi không ngăn file khác; thử lại file chưa có xác nhận sau mất mạng, không nhập lại file đã lưu. Một tem nhiều trang: giữ nguyên thứ tự PDF; trang sản phẩm tiếp theo được ghép bằng Order ID (TikTok) hoặc OrderSN (Shopee) với tem liền trước, không tăng số kiện. Dòng Qty Total có thể nằm ở trang sau. Trang tiếp theo và tem in trùng được thống kê riêng. Tem trùng chỉ đếm một kiện; file có trang lỗi không được lưu một phần. Với Excel: xem trước, kiểm tra số dòng/đơn/kiện và lỗi, rồi lưu. Một đơn nhiều sản phẩm/kiện phải có đầy đủ các dòng trong file; nhập lại giữ lịch sử quét và bàn giao.",
  },
  {
    page: "returns",
    name: "Quản lý đơn hoàn",
    roles:
      "Nhân viên: nhận/kiểm/ghi chú; Admin và Quản lý: nhập nguồn, xử lý, khiếu nại và báo cáo",
    meaning:
      "Tách dữ liệu sàn, nhận kiện, kiểm sản phẩm và tiền bồi thường. Không sử dụng quét xuất kho để nhận hàng hoàn.",
    action:
      "Thẻ màu cam và dòng Bạn đang ở cho biết mục con hiện tại. Mở Nhập dữ liệu → bấm Nhập dữ liệu đơn hoàn, hoặc mở Quản lý đơn hoàn → tab/nút Nhập dữ liệu đơn hoàn. Chọn shop/kho, đọc và đối chiếu → kiểm tra cảnh báo và thay đổi cũ/mới → xác nhận lưu. Quét mã hoàn kho → chọn ca được phân công → nhận kiện (mã khớp nhiều hồ sơ phải chọn rõ). Mở hồ sơ → nhập số lượng thực nhận từng SKU và tình trạng → lưu kiểm nhận. Quản lý theo dõi khiếu nại, tiền và ngày thực nhận; chỉ hoàn thành sau kiểm đủ hoặc xác minh không trả vật lý, và hồ sơ khiếu nại đã kết thúc. Đổi dữ liệu sản phẩm sau kiểm sẽ yêu cầu kiểm lại. Thiếu vận đơn/Seller SKU vẫn giữ yêu cầu; bổ sung mã có lý do. Tiền tố mã không tự xác minh hãng. Mốc quá hạn là tham khảo, không tự kết luận mất. Dùng Lịch sử & đối soát và xuất Excel/CSV để đối chiếu cùng bộ lọc. Hoàn tác nhận chỉ được phép trước thao tác xử lý tiếp theo và luôn lưu lịch sử. V2: Cập nhật file tại Nhập dữ liệu đơn hoàn, xem số mới/đổi trạng thái/đổi tiền và từng trường cũ → mới rồi xác nhận. Lịch sử cập nhật file lưu kết quả/lỗi. Chi tiết có thông tin hệ thống trên, thao tác nhân viên dưới và menu sao chép. Danh sách cho lọc hãng, ẩn/hiện cột, copy mã hoàn. Phân tích hoàn trả có lý do gốc/nhóm, biểu đồ và tỷ lệ theo nhóm đơn bán cùng kỳ. Nhập file bán thật để có mẫu số; xuất kho không chứng minh bán thành công. Thiếu mẫu số hoặc chưa liên kết → Chưa đủ dữ liệu. Combo cần cấu hình SL/trọng số thành phần, không tự tách hoặc tăng tiền. Màu trạng thái luôn kèm chữ; Admin chỉnh ngưỡng tỷ lệ và quy tắc tại Phân tích hoàn trả.",
  },
  {
    page: "people",
    name: "Nhân viên & Ca làm việc",
    roles: "Admin, Quản lý; tạo/khóa tài khoản chỉ Admin",
    meaning:
      "Quản lý tài khoản, tạo ca theo giờ Việt Nam và phân công người được phép quét tại kho.",
    action:
      "Tạo ca bao phủ giờ làm và chọn cả tài khoản của bạn nếu bạn cũng quét. Có thể cập nhật phân công ca còn hiệu lực. Admin/Quản lý được mở ca nhanh cho bản thân tại trạm quét.",
  },
  {
    page: "settings",
    name: "Cấu hình hệ thống",
    roles: "Chỉnh sửa chỉ Admin; Quản lý xem nhật ký",
    meaning:
      "Quản lý danh mục kho/sàn/hãng, quy tắc gợi ý tiền tố, nhật ký thao tác và dọn dữ liệu cũ.",
    action:
      "Tiền tố chỉ là gợi ý. Ví dụ mã bắt đầu 86 không chứng minh chắc chắn TikTok/J&T; hệ thống ưu tiên bản ghi nguồn đã nhập. Dọn dữ liệu cũ: Admin chọn nhật ký quét hoặc hồ sơ hoàn, mốc trước ngày và kho → xem trước → xuất danh sách nếu cần → xác nhận xoá vĩnh viễn bằng câu xác nhận và lý do. Chỉ dọn hồ sơ đã kết thúc, giữ hoạt động mới/đang xử lý và khiếu nại mở. Xoá hồ sơ hoàn kèm ảnh/PDF, dữ liệu nguồn và lịch sử; báo cáo cũ giảm theo phần đã xoá. Nhật ký xuất kho chỉ xoá lượt quét, giữ nguyên vận đơn và ngày quét/bàn giao. Tệp xuất danh sách không phải bản sao lưu đầy đủ. Tối ưu vùng trống giúp PostgreSQL tái sử dụng dung lượng, không bảo đảm dung lượng đĩa hoặc phí lưu trữ giảm ngay.",
  },
];

export function UserGuide({
  user,
  onNavigate,
}: {
  user: User;
  onNavigate: (page: string) => void;
}) {
  return (
    <div className="user-guide">
      <section className="card padded guide-intro">
        <div>
          <span className="eyebrow">BẮT ĐẦU TẠI ĐÂY</span>
          <h2>
            <BookOpen size={22} /> Từ dữ liệu nguồn đến bàn giao thực tế
          </h2>
          <p>
            COMS-FLOW WMS quản lý quá trình xuất kho. Mỗi mã vận đơn tương ứng
            một kiện; một đơn hàng có thể có nhiều kiện và nhiều dòng sản phẩm.
          </p>
        </div>
        <button className="primary" onClick={() => onNavigate("scan")}>
          Đến trạm quét <ArrowRight size={16} />
        </button>
      </section>
      <section className="card padded">
        <h2>Sơ đồ quy trình làm việc</h2>
        <div
          className="workflow"
          role="img"
          aria-label="Nhập dữ liệu và phân công ca, quét vận đơn, tách thành công, trùng hoặc ngoại lệ, lập phiếu rồi xác nhận bàn giao thực tế."
        >
          <div className="workflow-prep">
            <div className="workflow-node">
              <b>1 · Chuẩn bị dữ liệu</b>
              <span>
                Nhập PDF tem / Excel / CSV → đếm mã duy nhất → xem trước → sửa
                lỗi → lưu nguồn dự kiến
              </span>
            </div>
            <div className="workflow-node">
              <b>2 · Chuẩn bị nhân sự</b>
              <span>
                Tạo ca → chọn kho → phân công nhân viên → chọn ca đang hoạt động
              </span>
            </div>
          </div>
          <ArrowDown className="workflow-arrow" />
          <div className="workflow-node workflow-scan">
            <b>3 · Quét / nhập mã vận đơn</b>
            <span>
              Nhập tay + Enter/Xác nhận · HID + Enter/Tab · Camera HTTPS
            </span>
          </div>
          <ArrowDown className="workflow-arrow" />
          <div className="workflow-branches">
            <div className="workflow-node branch-duplicate">
              <b>Quét trùng</b>
              <span>
                Xem người/giờ lần đầu. Lưu nhật ký, không tăng số kiện thành
                công. Dừng lượt quét này, không tạo bàn giao mới.
              </span>
            </div>
            <div className="workflow-node branch-success">
              <b>4 · Hợp lệ → Đã tít đơn</b>
              <span>
                Máy chủ lưu thành công. Kiện chưa được coi là đã bàn giao.
              </span>
            </div>
            <div className="workflow-node branch-exception">
              <b>Mã lạ / đơn hủy / sai kho, hãng</b>
              <span>
                Chuyển đối soát → sửa dữ liệu hoặc xử lý có lý do → quét lại khi
                hợp lệ (quay lại bước 3).
              </span>
            </div>
          </div>
          <ArrowDown className="workflow-arrow" />
          <div className="workflow-node">
            <b>5 · Tạo phiếu bàn giao nháp</b>
            <span>
              Chọn những kiện đã tít, cùng kho và cùng hãng. Nếu chọn sai: hủy
              nháp và lập lại.
            </span>
          </div>
          <ArrowDown className="workflow-arrow" />
          <div className="workflow-node branch-success">
            <b>6 · Kiểm đếm & xác nhận bàn giao</b>
            <span>
              Quản lý xác nhận sau bàn giao thực tế → ghi người/giờ → Đã bàn
              giao → xuất báo cáo.
            </span>
          </div>
        </div>
        <p className="small-note">
          Bàn giao là ghi nhận nội bộ; chưa phải xác nhận chính thức từ hãng vận
          chuyển. Dashboard lấy dữ liệu từ các bước trên, không cần nhập số liệu
          lại.
        </p>
      </section>
      <section className="card padded">
        <h2>Kiểm tra trước khi bắt đầu ca</h2>
        <ol className="guide-checklist">
          <li>
            <strong>Dữ liệu đã nhập:</strong> tìm thấy mã vận đơn trong Danh
            sách vận đơn, kiểm tra sàn, hãng, kho và ngày cần xuất.
          </li>
          <li>
            <strong>Ca đang hiệu lực:</strong> đúng kho, đúng thời gian UTC+7 và
            có tên bạn trong phân công. Tài khoản quản lý cũng cần ca khi trực
            tiếp quét.
          </li>
          <li>
            <strong>Kết nối hoạt động:</strong> chỉ tin màu xanh sau phản hồi
            máy chủ. Camera điện thoại cần HTTPS và quyền truy cập camera.
          </li>
          <li>
            <strong>Chọn phương thức:</strong> nhập tay cho bàn phím/dán mã; HID
            cho súng quét tự gửi hậu tố Enter hoặc Tab.
          </li>
        </ol>
      </section>
      <div className="guide-catalog">
        {sections.map((section) => (
          <section className="card padded" key={section.page}>
            <span className="subtle-label">{section.roles}</span>
            <h2>{section.name}</h2>
            <p>{section.meaning}</p>
            <p>
              <strong>Cách dùng:</strong> {section.action}
            </p>
            {(user.role !== "staff" ||
              ["scan", "returns"].includes(section.page)) && (
              <button
                className="text-button"
                onClick={() => onNavigate(section.page)}
              >
                Mở {section.name.toLowerCase()} <ArrowRight size={14} />
              </button>
            )}
          </section>
        ))}
      </div>
      <section className="card padded">
        <h2>
          <TriangleAlert size={19} /> Xử lý tình huống thường gặp
        </h2>
        <div className="guide-faq">
          <details open>
            <summary>Đã gõ mã nhưng không bấm Xác nhận được?</summary>
            <p>
              Xem cảnh báo ca phía trên ô nhập. Chọn kho có ca đang hoạt động đã
              phân công cho bạn. Admin/Quản lý bấm “Mở ca cho tôi”, hoặc vào
              Nhân viên & Ca làm việc để tạo/sửa phân công. Nhân viên nhờ quản
              lý phân công rồi bấm “Tải lại phân công”. Mã đang gõ được giữ
              nguyên.
            </p>
          </details>
          <details>
            <summary>Quét mã 86… hoặc SPXVN… nhưng báo chưa tìm thấy?</summary>
            <p>
              Barcode có thể chỉ chứa mã vận đơn. Cần nhập file nguồn có mã đó
              trước. Tiền tố chỉ gợi ý sàn/hãng; hệ thống không tự tạo đơn hay
              bịa sản phẩm. Sau khi nhập nguồn, quét lại và ghi kết quả xử lý
              ngoại lệ.
            </p>
          </details>
          <details>
            <summary>Đã nhập file nhưng dashboard hôm nay vẫn trống?</summary>
            <p>
              Dashboard và danh sách lọc theo ngày cần xuất trong file, không
              phải thời điểm upload. Chọn đúng ngày hoặc khoảng ngày. Bộ lọc
              theo nhân viên/ca chỉ có dữ liệu sau khi quét, vì hệ thống chưa
              phân bổ kiện cho từng người trước đó.
            </p>
          </details>
          <details>
            <summary>Mất kết nối hoặc chưa rõ máy chủ đã lưu chưa?</summary>
            <p>
              Chưa có xác nhận thì không coi là thành công. Giữ trang mở, kết
              nối lại rồi bấm “Gửi lại yêu cầu … an toàn”. Hệ thống dùng cùng mã
              yêu cầu để tránh tăng lượt quét khi phản hồi trước đó bị mất.
            </p>
          </details>
          <details>
            <summary>Phiếu nháp sai hoặc cần thay đổi trạng thái kiện?</summary>
            <p>
              Hủy phiếu nháp với lý do trước, rồi chỉnh kiện hoặc lập lại phiếu.
              Không xóa lịch sử quét. Phiếu đã xác nhận không được hủy bằng thao
              tác này; cần đối soát và quy trình điều chỉnh riêng.
            </p>
          </details>
        </div>
      </section>
      <section className="card padded guide-definitions">
        <h2>
          <ShieldCheck size={19} /> Đọc đúng số liệu và trạng thái
        </h2>
        <p>
          <strong>Đã tít:</strong> kiện được ghi nhận quét tại kho.{" "}
          <strong>Chờ bàn giao:</strong> đã tít, đủ điều kiện, chưa xác nhận bàn
          giao. <strong>Đã bàn giao:</strong> có quản lý xác nhận riêng.{" "}
          <strong>Ngoại lệ:</strong> đang hủy/chặn/cần kiểm tra.
        </p>
        <p>
          <strong>Vận đơn hợp lệ:</strong> loại các đơn hủy/chặn/cần kiểm tra
          khỏi mẫu số tiến độ. <strong>Đã tít thành công:</strong> bảo toàn lịch
          sử lần quét đầu, kể cả sau đó kiện cần kiểm tra. Vì vậy hãy xem cả chỉ
          số ngoại lệ khi đối chiếu.
        </p>
        <p>
          <CheckCircle2 size={15} /> Thời gian được máy chủ ghi UTC và hiển thị
          theo giờ Việt Nam. Điều chỉnh, phân công, nhập lại và bàn giao đều có
          nhật ký; lượt trùng không tăng tổng thành công.
        </p>
      </section>
    </div>
  );
}
