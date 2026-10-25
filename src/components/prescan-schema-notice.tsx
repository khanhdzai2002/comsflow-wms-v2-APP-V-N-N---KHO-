import { useState } from "react";
import upgradeSql from "../../supabase/upgrade-018.sql?raw";
import type { User } from "@/lib/db";
import { refresh, type Row } from "./shared";

export function PrescanSchemaNotice({ refs, user }: { refs: Row; user: User }) {
  const [copied, setCopied] = useState(false);
  if (refs.prescanReady !== false) return null;
  return (
    <section className="notice warning" role="status">
      <strong>Chưa bật đối soát hai chiều · cần nâng cấp database 018</strong>
      <p>
        Mã quét chưa có nguồn vẫn được lưu. Nhập file xuất kho cần nâng cấp này
        để tự khớp và giữ lịch sử gốc.
      </p>
      {user.role === "admin" ? (
        <>
          <p>
            Sao lưu database trước. Mở Supabase project{" "}
            <b>lyeyjfvxmqruszgfrjze</b> → SQL Editor → New query; dán SQL bên
            dưới và Run. SQL chỉ thêm cấu trúc đối soát, không xóa hay sửa dữ
            liệu cũ. Không cần tải tệp.
          </p>
          <details>
            <summary>Xem và sao chép SQL nâng cấp 018</summary>
            <textarea
              aria-label="SQL nâng cấp đối soát hai chiều"
              readOnly
              value={upgradeSql}
              rows={12}
              onFocus={(e) => e.currentTarget.select()}
            />
            <button
              className="secondary small"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(upgradeSql);
                  setCopied(true);
                } catch {
                  setCopied(false);
                }
              }}
            >
              {copied ? "Đã sao chép SQL" : "Sao chép SQL"}
            </button>
          </details>
          <button className="secondary small" onClick={() => refresh()}>
            Kiểm tra lại sau khi chạy SQL
          </button>
        </>
      ) : (
        <p>
          Nhờ Admin sao lưu và chạy SQL nâng cấp trong thông báo của tài khoản
          Admin.
        </p>
      )}
    </section>
  );
}
