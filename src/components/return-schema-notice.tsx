import { useState } from "react";
import sqlUpgrade from "../../supabase/upgrade-020.sql?raw";
import sqlPermissions from "../../scripts/sql/grant-hyperdrive-runtime.sql?raw";
import { refresh, type Row } from "./shared";
import type { User } from "../lib/db";
export function ReturnSchemaNotice({ refs, user }: { refs: Row; user: User }) {
  const [copied, setCopied] = useState(false);
  if (refs.returnOperationsReady !== false) return null;
  const sql = refs.returnOperationsInstalled ? sqlPermissions : sqlUpgrade;
  return (
    <section className="notice warning">
      <strong>
        Cần nâng cấp database · Quản lý &amp; Đối soát hàng hoàn v2
      </strong>
      <p>
        Dữ liệu và chức năng cũ được giữ cho đến khi cấu trúc mới sẵn sàng.{" "}
        {refs.returnOperationsInstalled
          ? "Tài khoản máy chủ đang thiếu quyền trên cấu trúc mới."
          : "Bản mới bổ sung sổ nhận thực tế, nguồn nhập và đối soát theo SKU."}
      </p>
      {user.role === "admin" ? (
        <>
          <p>
            Sao lưu database, kiểm tra hướng dẫn triển khai trong repository.
            Chọn đúng project Supabase <b>lyeyjfvxmqruszgfrjze</b> → SQL Editor
            → New query; có thể sao chép trực tiếp bên dưới mà không tải tệp.
            Chạy thử trên bản sao trước khi áp dụng dữ liệu thật.
          </p>
          <details>
            <summary>
              Xem SQL{" "}
              {refs.returnOperationsInstalled ? "cấp quyền" : "nâng cấp 020"}
            </summary>
            <textarea
              aria-label="SQL nâng cấp hàng hoàn v2"
              readOnly
              rows={12}
              value={sql}
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
          <button className="secondary small" onClick={refresh}>
            Kiểm tra sau khi chạy SQL
          </button>
        </>
      ) : (
        <p>Nhờ Admin kiểm tra sao lưu và thực hiện nâng cấp.</p>
      )}
    </section>
  );
}
