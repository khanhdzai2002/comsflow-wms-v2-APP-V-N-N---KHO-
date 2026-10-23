"use client";
import { Copy, RefreshCw } from "lucide-react";
import { toast, type Row } from "./shared";
import { formatTime } from "@/lib/domain";
import { returnProcessing, returnInspection } from "@/lib/return-domain";
import { ReturnStatus, warehouseState } from "./return-status";
export const returnMoneyLabel = (v: unknown) =>
  v === null || v === undefined || v === ""
    ? "Chưa có dữ liệu"
    : new Intl.NumberFormat("vi-VN", {
        style: "currency",
        currency: "VND",
      }).format(Number(v));
export async function copyReturnText(text: string) {
  try {
    if (!text) throw new Error("Chưa có dữ liệu để sao chép");
    if (navigator.clipboard?.writeText)
      await navigator.clipboard.writeText(text);
    else {
      const input = document.createElement("textarea");
      input.value = text;
      input.style.position = "fixed";
      input.style.opacity = "0";
      document.body.append(input);
      input.select();
      const ok = document.execCommand("copy");
      input.remove();
      if (!ok) throw new Error("Trình duyệt không cho sao chép");
    }
    toast("Đã sao chép");
  } catch (e) {
    toast((e as Error).message, true);
  }
}
export function QuickCopy({
  value,
  label = "Sao chép mã vận đơn hoàn",
}: {
  value: string;
  label?: string;
}) {
  return (
    <button
      type="button"
      className="icon-button return-copy"
      aria-label={label}
      title={label}
      disabled={!value}
      onClick={() => void copyReturnText(value)}
    >
      <Copy size={15} />
    </button>
  );
}
export function sourceValue(record: Row, key: string) {
  const values = [
    ...new Set(
      (record.source_data ?? [])
        .map((s: Row) => s.meta?.[key])
        .filter((v: unknown) => v !== null && v !== undefined && v !== ""),
    ),
  ];
  return values.length === 1 ? values[0] : null;
}
export function returnCopyContent(data: Row, claim = false) {
  const r = data.record,
    parcels = data.parcels.filter((p: Row) => p.active),
    tracking = parcels.map((p: Row) => p.tracking_code).join(", "),
    carrier = [
      ...new Set(
        parcels.map(
          (p: Row) => p.identification?.carrier ?? p.carrier ?? "Chưa xác định",
        ),
      ),
    ].join(", ");
  return [
    "Mã đơn: " + r.order_code,
    "Mã yêu cầu hoàn: " + r.external_id,
    "Sàn: " + r.channel,
    "Shop: " + r.shop,
    "Mã vận đơn hoàn: " + (tracking || "Chưa có dữ liệu"),
    "Hãng trả hàng: " + (carrier || "Chưa xác định"),
    "Sản phẩm: " +
      data.items
        .filter((i: Row) => i.active)
        .map(
          (i: Row) =>
            (i.seller_sku || i.sku_id) +
            " – " +
            i.variant +
            " – SL " +
            i.expected_qty,
        )
        .join("; "),
    "Giá trị sản phẩm yêu cầu trả: " +
      returnMoneyLabel(
        data.items
          .filter((i: Row) => i.active)
          .every((i: Row) => i.unit_amount !== null)
          ? data.items
              .filter((i: Row) => i.active)
              .reduce(
                (n: number, i: Row) =>
                  n + Number(i.unit_amount) * i.expected_qty,
                0,
              )
          : null,
      ),
    "Trạng thái kho: " +
      (r.no_physical_return
        ? "Không yêu cầu trả hàng"
        : parcels.some((p: Row) => p.received_at)
          ? returnInspection[r.inspection_status]
          : "Chưa nhận kiện"),
    "Trạng thái xử lý: " + returnProcessing[r.processing_status],
    "Ngày yêu cầu: " + formatTime(r.requested_at),
    "Trạng thái sàn: " + r.platform_status + " / " + r.platform_substatus,
    "Vận đơn giao ban đầu: " +
      (sourceValue(r, "originalTracking") || "Chưa có dữ liệu"),
    "Lý do nguồn: " +
      (r.reason_original || sourceValue(r, "reason") || "Chưa có dữ liệu"),
    "Phí vận chuyển trả nhà bán chịu: " +
      returnMoneyLabel(sourceValue(r, "sellerReturnFee")),
    "Phí hoàn khác: " + returnMoneyLabel(sourceValue(r, "otherReturnFee")),
    "Số tiền khách được hoàn: " +
      returnMoneyLabel(sourceValue(r, "refundAmount")),
    "Bồi thường sàn báo: " +
      returnMoneyLabel(sourceValue(r, "platformCompensation")),

    ...(claim
      ? [
          "Lý do sàn: " +
            (r.reason_original ||
              sourceValue(r, "reason") ||
              "Chưa có dữ liệu"),
          "Kiểm hàng: " + returnInspection[r.inspection_status],
          ...data.claims.map(
            (c: Row) =>
              "Khiếu nại: " +
              c.reason +
              " | Yêu cầu " +
              returnMoneyLabel(c.requested_amount) +
              " | Thực nhận " +
              returnMoneyLabel(c.received_amount),
          ),
          ...data.events
            .filter((e: Row) => e.action === "update" || e.action === "inspect")
            .slice(0, 5)
            .map(
              (e: Row) =>
                formatTime(e.created_at) + " – " + e.employee + ": " + e.reason,
            ),
        ]
      : []),
  ].join("\n");
}
export function ReturnDetailInfo({
  data,
  onRefresh,
}: {
  data: Row;
  onRefresh: () => void;
}) {
  const r = data.record,
    parcels = data.parcels.filter((p: Row) => p.active),
    tracking = parcels.map((p: Row) => p.tracking_code).join(", ");
  const carrier = [
    ...new Set(
      parcels.map(
        (p: Row) => p.identification?.carrier ?? p.carrier ?? "Chưa xác định",
      ),
    ),
  ].join(", ");
  const warehouse = {
    ...r,
    received: parcels.filter((p: Row) => p.received_at).length,
  };
  const date = (k: string) =>
    sourceValue(r, k) ? formatTime(String(sourceValue(r, k))) : null;
  const totalItems = data.items.filter((i: Row) => i.active);
  const itemValue =
    totalItems.length && totalItems.every((i: Row) => i.unit_amount !== null)
      ? totalItems.reduce(
          (n: number, i: Row) => n + Number(i.unit_amount) * i.expected_qty,
          0,
        )
      : null;
  const orderAmounts = [
    ...new Set(
      r.source_data
        .map((s: Row) => s.orderAmount)
        .filter((v: any) => v !== null && v !== undefined),
    ),
  ];
  const pairs = [
    ["Mã đơn hàng", r.order_code],
    ["Mã yêu cầu hoàn", r.external_id],
    ["Vận đơn hoàn", tracking],
    ["Vận đơn giao ban đầu", sourceValue(r, "originalTracking")],
    ["Sàn / Shop", r.channel + " / " + r.shop],
    ["Ngày đặt hàng", date("orderedAt")],
    ["Yêu cầu hoàn", formatTime(r.requested_at)],
    ["Cập nhật từ sàn", date("platformUpdated")],
    ["Dự kiến hàng về", date("expectedAt") || r.expected_at],
    ["Đơn vị trả hàng", carrier],
    ["Trạng thái từ sàn", r.platform_status + " / " + r.platform_substatus],
    ["Lý do gốc", r.reason_original || sourceValue(r, "reason")],
  ];
  const finance = [
    ["Giá trị đơn ban đầu", orderAmounts.length === 1 ? orderAmounts[0] : null],
    ["Giá trị sản phẩm trả", sourceValue(r, "returnValue") ?? itemValue],
    ["Khách được hoàn", sourceValue(r, "refundAmount")],
    [
      "Bồi thường sàn báo (không phải tiền thực nhận)",
      sourceValue(r, "platformCompensation"),
    ],
    ["Phí vận chuyển trả nhà bán chịu", sourceValue(r, "sellerReturnFee")],
    ["Phí hoàn khác", sourceValue(r, "otherReturnFee")],
    [
      "Yêu cầu bồi thường",
      data.claims.some((c: Row) => c.requested_amount !== null)
        ? data.claims.reduce(
            (n: number, c: Row) => n + Number(c.requested_amount ?? 0),
            0,
          )
        : null,
    ],
    [
      "Bồi thường được duyệt",
      data.claims.some((c: Row) => c.approved_amount !== null)
        ? data.claims.reduce(
            (n: number, c: Row) => n + Number(c.approved_amount ?? 0),
            0,
          )
        : null,
    ],
    [
      "Bồi thường thực nhận",
      data.claims.some((c: Row) => c.received_amount !== null)
        ? data.claims.reduce(
            (n: number, c: Row) => n + Number(c.received_amount ?? 0),
            0,
          )
        : null,
    ],
  ];
  const timeline: any[] = [
    { at: r.requested_at, label: "Tạo yêu cầu từ sàn" },
    ...["approvedAt", "shippedAt", "refundTime"].flatMap((key, i) =>
      sourceValue(r, key)
        ? [
            {
              at: sourceValue(r, key),
              label: [
                "Sàn chấp thuận",
                "Bắt đầu vận chuyển hoàn",
                "Thời điểm hoàn tiền từ sàn",
              ][i],
            },
          ]
        : [],
    ),
    ...data.events
      .filter((e: Row) =>
        ["received", "inspect", "claim", "update"].includes(e.action),
      )
      .map((e: Row) => ({
        at: e.created_at,
        label: (
          {
            received: "Nhận kiện",
            inspect: "Kiểm hàng",
            claim: "Khiếu nại",
            update:
              e.data?.change?.status === "completed"
                ? "Hoàn tất"
                : "Cập nhật xử lý",
          } as Row
        )[e.action],
        employee: e.employee,
      })),
  ].sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());
  return (
    <>
      <header className="return-detail-header">
        <div>
          <span className="import-type-badge">HỒ SƠ ĐƠN HOÀN</span>
          <h2>{tracking || "Chưa có vận đơn hoàn"}</h2>
          <p>
            {r.order_code} · {r.channel} · {r.shop}
          </p>
          <p>{carrier || "Chưa xác định"}</p>
          <div className="inline">
            <ReturnStatus kind="warehouse" value={warehouseState(warehouse)} />
            <ReturnStatus value={r.processing_status} />
          </div>
        </div>
        <div className="inline">
          <details className="return-copy-menu">
            <summary>
              <Copy size={15} /> Sao chép thông tin
            </summary>
            <div>
              {[
                ["Mã đơn hàng", r.order_code],
                ["Mã vận đơn hoàn", tracking],
                ["Mã yêu cầu hoàn", r.external_id],
                ["Toàn bộ thông tin", returnCopyContent(data)],
                ["Thông tin khiếu nại", returnCopyContent(data, true)],
              ].map(([label, value]) => (
                <button
                  key={label}
                  className="secondary small"
                  disabled={!value}
                  onClick={(e) => {
                    void copyReturnText(value);
                    e.currentTarget.closest("details")?.removeAttribute("open");
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
          </details>
          <button className="secondary small" onClick={onRefresh}>
            <RefreshCw size={15} /> Cập nhật
          </button>
        </div>
      </header>
      {parcels.some((p: Row) => p.identification?.conflict) && (
        <div className="notice danger">
          Hãng trong nguồn mâu thuẫn quy tắc mã. Kiểm tra hãng tại phần xử lý;
          không thay đổi lịch sử nhận kiện.
        </div>
      )}
      <section className="return-read-group">
        <h3>Thông tin đơn hàng</h3>
        <dl className="return-info-grid">
          {pairs.map(([label, value]) => (
            <div key={String(label)}>
              <dt>{label}</dt>
              <dd>{String(value || "Chưa có dữ liệu")}</dd>
            </div>
          ))}
        </dl>
      </section>
      <section className="return-read-group">
        <h3>Sản phẩm yêu cầu hoàn</h3>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                {[
                  "SKU / Mã SP",
                  "Sản phẩm",
                  "Màu / Size",
                  "SL yêu cầu",
                  "Đơn giá",
                  "Thành tiền",
                ].map((h) => (
                  <th key={h}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {totalItems.map((i: Row) => {
                const source = r.source_data.find(
                  (s: Row) => s.itemKey === i.item_key,
                );
                return (
                  <tr key={i.id}>
                    <td>
                      {i.seller_sku || i.sku_id}
                      <small className="block">{i.sku_id}</small>
                    </td>
                    <td>{i.name}</td>
                    <td>
                      {source?.meta?.color || "Chưa có dữ liệu"} /{" "}
                      {source?.meta?.size || "Chưa có dữ liệu"}
                      <small className="block">{i.variant}</small>
                    </td>
                    <td>{i.expected_qty}</td>
                    <td>{returnMoneyLabel(i.unit_amount)}</td>
                    <td>
                      {returnMoneyLabel(
                        i.unit_amount === null
                          ? null
                          : Number(i.unit_amount) * i.expected_qty,
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
      <div className="return-read-columns">
        <section className="return-read-group">
          <h3>Tài chính</h3>
          <dl className="return-info-grid">
            {finance.map(([label, value]) => (
              <div key={String(label)}>
                <dt>{label}</dt>
                <dd>{returnMoneyLabel(value)}</dd>
              </div>
            ))}
          </dl>
          <small>
            Đơn giá sản phẩm × SL là giá trị yêu cầu trả, không chứng minh tiền
            đã hoàn hay bồi thường đã nhận.
          </small>
        </section>
        <section className="return-read-group">
          <h3>Khách hàng và lý do hoàn</h3>
          <dl className="return-info-grid">
            {[
              ["Lý do gốc", r.reason_original || sourceValue(r, "reason")],
              ["Ghi chú khách", sourceValue(r, "note")],
              ["Mô tả lỗi từ khách", sourceValue(r, "buyerDescription")],
              ["Bằng chứng từ khách", sourceValue(r, "buyerEvidence")],
              ["Ngày yêu cầu", formatTime(r.requested_at)],
              ["Phê duyệt từ sàn", r.platform_status],
            ].map(([label, value]) => (
              <div key={String(label)}>
                <dt>{label}</dt>
                <dd>{String(value || "Chưa có dữ liệu")}</dd>
              </div>
            ))}
          </dl>
        </section>
      </div>
      <details className="return-read-group" open>
        <summary>Lịch sử trạng thái có dữ liệu ({timeline.length})</summary>
        <ol className="return-timeline">
          {timeline.map((e, i) => (
            <li key={i}>
              <strong>{e.label}</strong>
              <span>
                {formatTime(e.at)} {e.employee && " · " + e.employee}
              </span>
            </li>
          ))}
        </ol>
      </details>
    </>
  );
}
