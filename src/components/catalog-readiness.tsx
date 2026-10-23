import { useState } from "react";
import type { User } from "@/lib/db";
import { post, refresh, toast, type Row } from "./shared";

export function CatalogReadiness({ refs, user }: { refs: Row; user: User }) {
  const [busy, setBusy] = useState(false);
  const missing = [
    !refs.warehouses.length && "kho",
    !refs.channels.length && "sàn bán hàng",
    !refs.carriers.length && "hãng vận chuyển",
  ].filter(Boolean);
  return (
    <>
      {refs.workerAvailable === false && user.role !== "staff" && (
        <div className="notice warning" role="status">
          <p>
            Dịch vụ xử lý file chưa kết nối gần đây. Nhập PDF/Excel và xuất báo
            cáo cần dịch vụ này; xem trạng thái tại{" "}
            <a href="#jobs">Tác vụ dữ liệu</a>. CSV mẫu TikTok Shop có thể nhập
            trực tiếp tại Quản lý đơn hoàn.
          </p>
        </div>
      )}
      {!!missing.length && (
        <section className="notice warning catalog-readiness" role="status">
          <div>
            <strong>Chưa thiết lập {missing.join(", ")}.</strong>
            <p>
              Cần danh mục trước khi mở ca, nhập file hoặc quét mã. Thiết lập cơ
              bản sẽ tạo Kho ComsMiu nếu chưa có kho, bổ sung Shopee, TikTok
              Shop và các hãng vận chuyển phổ biến.
            </p>
          </div>
          {user.role === "admin" ? (
            <button
              className="primary small"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  await post("config/setup", {});
                  refresh();
                  toast("Đã thiết lập danh mục cơ bản");
                } catch (e) {
                  toast((e as Error).message, true);
                } finally {
                  setBusy(false);
                }
              }}
            >
              {busy ? "Đang thiết lập…" : "Thiết lập danh mục cơ bản"}
            </button>
          ) : (
            <p>Nhờ Admin thiết lập danh mục trong Cấu hình hệ thống.</p>
          )}
        </section>
      )}
    </>
  );
}
