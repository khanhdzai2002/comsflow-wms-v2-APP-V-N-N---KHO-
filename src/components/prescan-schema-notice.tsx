import { useState } from "react";
import permissionsSql from "../../supabase/upgrade-019.sql?raw";
import upgradeSql from "../../supabase/upgrade-018.sql?raw";
import type { User } from "@/lib/db";
import { refresh, type Row } from "./shared";

export function PrescanSchemaNotice({ refs, user }: { refs: Row; user: User }) {
  const [copied, setCopied] = useState(false);
  const schemaMissing = refs.prescanReady === false;
  const permissionsMissing =
    !schemaMissing && refs.prescanPermissionsReady === false;
  if (!schemaMissing && !permissionsMissing) return null;
  const sql = schemaMissing ? upgradeSql : permissionsSql;
  const version = schemaMissing ? "018" : "019";
  return (
    <section className="notice warning" role="status">
      <strong>
        {schemaMissing
          ? "Chưa bật đối soát hai chiều · cần nâng cấp database 018"
          : "Database đã kết nối · cần cấp quyền đối soát 019"}
      </strong>
      <p>
        {schemaMissing
          ? "Mã quét chưa có nguồn vẫn được lưu. Nhập file xuất kho cần nâng cấp này để tự khớp và giữ lịch sử gốc."
          : "Tài khoản Hyperdrive chưa có quyền sử dụng bảng đối soát mới, nên Tổng quan và nhật ký chưa tải được. Cần cấp quyền cho tài khoản server; không cần đổi mật khẩu."}
      </p>
      {user.role === "admin" ? (
        <>
          <p>
            Sao lưu database trước. Mở Supabase project{" "}
            <b>lyeyjfvxmqruszgfrjze</b> → SQL Editor → New query; dán SQL bên
            dưới và Run.{" "}
            {schemaMissing
              ? "SQL thêm cấu trúc và quyền đối soát."
              : "SQL chỉ sửa quyền của tài khoản server."}{" "}
            Không xóa hoặc sửa dữ liệu đơn hàng; không cấp quyền cho tài khoản
            trình duyệt. Không cần tải tệp.
          </p>
          <details>
            <summary>
              Xem và sao chép SQL {schemaMissing ? "nâng cấp" : "sửa quyền"}{" "}
              {version}
            </summary>
            <textarea
              aria-label="SQL nâng cấp đối soát hai chiều"
              readOnly
              value={sql}
              rows={12}
              onFocus={(e) => e.currentTarget.select()}
            />
            <button
              className="secondary small"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(sql);
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
