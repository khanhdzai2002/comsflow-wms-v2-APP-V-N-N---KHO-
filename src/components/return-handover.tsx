import { useEffect, useState } from "react";
import {
  useData,
  post,
  refresh,
  OptionList,
  ErrorBox,
  type Row,
} from "./shared";
import { uploadReturnMedia } from "./return-media-client";
import { formatTime } from "../lib/domain";
export function ReturnHandoverPanel({
  refs,
  userId,
  warehouse,
  sessionId,
  onSession,
  carrier,
  onCarrier,
  courier,
  onCourier,
  note,
  onNote,
}: {
  refs: Row;
  userId: string;
  warehouse: string;
  sessionId: string;
  onSession: (id: string) => void;
  carrier: string;
  onCarrier: (id: string) => void;
  courier: string;
  onCourier: (name: string) => void;
  note: string;
  onNote: (note: string) => void;
}) {
  const [page, setPage] = useState(1),
    [historyPage, setHistoryPage] = useState(1),
    [viewSession, setViewSession] = useState("");
  const viewId = viewSession || sessionId;
  useEffect(() => setPage(1), [viewId]);
  const sessions = useData<Row[]>("returns/operations/handovers?open=1", 15000);
  const history = useData<Row[]>(
    "returns/operations/handovers?page=" + historyPage,
    15000,
  );
  const details = useData<Row>(
    viewId ? "returns/operations/handovers/" + viewId + "?page=" + page : null,
    15000,
  );
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function run(work: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await work();
      refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <details className="card padded" open>
      <summary>Phiên bàn giao · hãng / người giao / bằng chứng</summary>
      <div className="form-grid">
        <label className="field">
          Hãng vận chuyển đã xác minh
          <select value={carrier} onChange={(e) => onCarrier(e.target.value)}>
            <option value="">Tự nhận diện theo mã</option>
            <OptionList rows={refs.carriers} />
          </select>
        </label>
        <label className="field">
          Người giao hàng
          <input
            value={courier}
            maxLength={200}
            onChange={(e) => onCourier(e.target.value)}
          />
        </label>
        <label className="field">
          Ghi chú nhận hàng
          <input
            value={note}
            maxLength={2000}
            onChange={(e) => onNote(e.target.value)}
          />
        </label>
        <label className="field">
          Phiên đang nhận
          <select
            value={sessionId}
            onChange={(e) => {
              onSession(e.target.value);
              setViewSession("");
              const s = sessions.data?.find((s) => s.id === e.target.value);
              if (s) {
                onCarrier(s.carrier_id ?? "");
                onCourier(s.courier_name);
              }
            }}
          >
            <option value="">Nhận riêng từng kiện</option>
            {sessions.data
              ?.filter(
                (s) =>
                  s.warehouse_id === warehouse &&
                  s.created_by === userId &&
                  !s.closed_at,
              )
              .map((s) => (
                <option value={s.id} key={s.id}>
                  {formatTime(s.started_at)} ·{" "}
                  {s.courier_name || s.carrier || "Phiên nhận"} · {s.parcels}{" "}
                  kiện
                </option>
              ))}
          </select>
        </label>
      </div>
      <button
        type="button"
        className="secondary small"
        disabled={busy || !warehouse}
        onClick={() =>
          void run(async () => {
            const s = await post("returns/operations/handovers", {
              warehouseId: warehouse,
              carrierId: carrier || null,
              courier,
              note,
            });
            onSession(s.id);
          })
        }
      >
        Mở phiên bàn giao
      </button>{" "}
      <details>
        <summary>Lịch sử phiên bàn giao</summary>
        <label className="field">
          Xem phiên cũ (không đổi phiên quét)
          <select
            value={viewSession}
            onChange={(e) => setViewSession(e.target.value)}
          >
            <option value="">Phiên đang nhận</option>
            {history.data
              ?.filter((s) => s.warehouse_id === warehouse)
              .map((s) => (
                <option key={s.id} value={s.id}>
                  {formatTime(s.started_at)} · {s.employee} ·{" "}
                  {s.courier_name || s.carrier || "Chưa ghi hãng"} · {s.parcels}{" "}
                  kiện · {s.closed_at ? "Đã đóng" : "Đang mở"}
                </option>
              ))}
          </select>
        </label>
        <button
          type="button"
          className="secondary small"
          disabled={historyPage <= 1}
          onClick={() => setHistoryPage((p) => p - 1)}
        >
          100 phiên trước
        </button>{" "}
        <button
          type="button"
          className="secondary small"
          disabled={(history.data?.length ?? 0) < 100}
          onClick={() => setHistoryPage((p) => p + 1)}
        >
          Phiên cũ hơn
        </button>
      </details>
      {viewId && (
        <>
          {!viewSession && (
            <button
              type="button"
              className="secondary small"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  await post("returns/operations/handovers", {
                    warehouseId: warehouse,
                    id: sessionId,
                    close: true,
                  });
                  onSession("");
                })
              }
            >
              Đóng phiên
            </button>
          )}
          <label className="field">
            Ảnh / biên bản / video bàn giao
            <input
              type="file"
              disabled={busy}
              accept="image/jpeg,image/png,image/webp,application/pdf,video/mp4,video/webm"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file)
                  void run(async () => {
                    await uploadReturnMedia(file, { sessionId: viewId });
                  });
                e.target.value = "";
              }}
            />
          </label>
          <p>{details.data?.total ?? 0} kiện đã ghi nhận trong phiên</p>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Mã vận đơn / mã đơn</th>
                  <th>Giờ nhận</th>
                  <th>Người nhận</th>
                </tr>
              </thead>
              <tbody>
                {details.data?.receipts?.map((r: Row) => (
                  <tr key={r.id}>
                    <td className="mono">{r.tracking_code || r.order_code}</td>
                    <td>{formatTime(r.received_at)}</td>
                    <td>{r.employee}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="pagination">
            <button
              type="button"
              className="secondary small"
              disabled={page <= 1}
              onClick={() => setPage((p) => p - 1)}
            >
              Trước
            </button>
            <span>
              Trang {page} · {details.data?.total ?? 0} kiện
            </span>
            <button
              type="button"
              className="secondary small"
              disabled={page * 50 >= (details.data?.total ?? 0)}
              onClick={() => setPage((p) => p + 1)}
            >
              Sau
            </button>
          </div>
          {details.data?.media?.map((m: Row) => (
            <p key={m.id}>
              <a href={"/api/returns/operations/media/" + m.id}>{m.filename}</a>
            </p>
          ))}
        </>
      )}
      <ErrorBox
        message={error || sessions.error || details.error || history.error}
      />
    </details>
  );
}
