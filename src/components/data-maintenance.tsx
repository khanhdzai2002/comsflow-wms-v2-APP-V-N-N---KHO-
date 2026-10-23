"use client";
import { useState } from "react";
import {
  HardDrive,
  Trash2,
  ShieldCheck,
  FileDown,
  RefreshCw,
  CheckCircle2,
  AlertTriangle,
  LoaderCircle,
} from "lucide-react";
import { todayVN, formatTime, statuses, outcomes } from "@/lib/domain";
import { returnProcessing } from "@/lib/return-domain";
import {
  CLEANUP_CONFIRMATION,
  CLEANUP_BATCH_LIMIT,
  cleanupKinds,
  formatBytes,
  type CleanupKind,
} from "@/lib/maintenance-domain";
import {
  api,
  ApiError,
  useData,
  refresh,
  ErrorBox,
  Modal,
  OptionList,
  type Row,
} from "./shared";

function initialBefore() {
  const day = new Date(todayVN() + "T00:00:00Z");
  day.setUTCDate(day.getUTCDate() - 180);
  return day.toISOString().slice(0, 10);
}
export function DataMaintenance({ refs }: { refs: Row }) {
  const {
    data: storage,
    error: storageError,
    reload,
  } = useData<Row>("maintenance/storage", 30000);
  const [kind, setKind] = useState<CleanupKind>("scans"),
    [before, setBefore] = useState(initialBefore),
    [warehouse, setWarehouse] = useState("");
  const [plan, setPlan] = useState<Row | null>(null),
    [result, setResult] = useState<Row | null>(null),
    [error, setError] = useState("");
  const [phase, setPhase] = useState(""),
    [showConfirm, setShowConfirm] = useState(false),
    [confirmation, setConfirmation] = useState(""),
    [acknowledge, setAcknowledge] = useState(false),
    [reason, setReason] = useState("");
  const [optimized, setOptimized] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  function invalidate() {
    setPlan(null);
    setResult(null);
    setError("");
    setShowConfirm(false);
    setConfirmation("");
    setAcknowledge(false);
    setReason("");
    setUncertain(false);
  }
  async function preview() {
    invalidate();
    setPhase("preview");
    try {
      setPlan(
        await api(
          "maintenance/preview",
          { method: "POST", body: JSON.stringify({ kind, before, warehouse }) },
          180000,
        ),
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setPhase("");
    }
  }
  async function execute() {
    if (!plan || phase) return;
    setPhase("execute");
    setError("");
    try {
      const done = await api(
        "maintenance/execute",
        {
          method: "POST",
          body: JSON.stringify({
            jobId: plan.id,
            confirmation: confirmation.trim(),
            acknowledge,
            reason: reason.trim(),
          }),
        },
        180000,
      );
      setResult(done);
      setPlan(null);
      setShowConfirm(false);
      setOptimized(false);
      setUncertain(false);
      refresh();
    } catch (e) {
      setError((e as Error).message);
      if (e instanceof ApiError && [409, 410].includes(e.status)) {
        setShowConfirm(false);
        setPlan(null);
        setUncertain(false);
      } else if (
        !(e instanceof ApiError) ||
        e.status === 0 ||
        e.status >= 500
      ) {
        setUncertain(true);
      }
    } finally {
      setPhase("");
    }
  }
  async function optimize() {
    setPhase("optimize");
    setError("");
    setOptimized(false);
    try {
      await api("maintenance/optimize", { method: "POST" }, 180000);
      setOptimized(true);
      refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setPhase("");
    }
  }
  const busy = !!phase;
  const scopeLocked = busy || uncertain;
  return (
    <section className="card padded data-maintenance" id="data-maintenance">
      <div className="maintenance-heading">
        <span className="maintenance-symbol">
          <HardDrive size={26} />
        </span>
        <div>
          <span className="import-type-badge">DUNG LƯỢNG & DỮ LIỆU CŨ</span>
          <h2>Dọn dữ liệu cũ</h2>
          <p>
            Xem trước phạm vi, xuất danh sách và xác nhận trước khi xoá vĩnh
            viễn.
          </p>
        </div>
        <span className="maintenance-admin">
          <ShieldCheck size={16} /> Chỉ Quản trị viên
        </span>
      </div>
      <ErrorBox message={storageError} />
      <div className="maintenance-metrics">
        <div>
          <span>CSDL trên đĩa</span>
          <strong>{storage ? formatBytes(storage.database_bytes) : "—"}</strong>
          <small>Dung lượng PostgreSQL đang cấp phát</small>
        </div>
        <div>
          <span>Ảnh / PDF đơn hoàn</span>
          <strong>{storage ? formatBytes(storage.evidence_bytes) : "—"}</strong>
          <small>Dung lượng nội dung tệp đính kèm</small>
        </div>
        <div>
          <span>Nhật ký quét xuất kho</span>
          <strong>
            {storage ? Number(storage.scans).toLocaleString("vi-VN") : "—"}
          </strong>
          <small>Lượt quét đang lưu</small>
        </div>
        <div>
          <span>Hồ sơ đơn hoàn</span>
          <strong>
            {storage ? Number(storage.returns).toLocaleString("vi-VN") : "—"}
          </strong>
          <small>Yêu cầu hoàn đang lưu</small>
        </div>
      </div>
      <div className="maintenance-scope">
        <h3>1. Chọn dữ liệu cần dọn</h3>
        <div className="form-grid maintenance-filters">
          <label className="field">
            Loại dữ liệu cần dọn
            <select
              value={kind}
              disabled={scopeLocked}
              onChange={(e) => {
                setKind(e.target.value as CleanupKind);
                invalidate();
              }}
            >
              {Object.entries(cleanupKinds).map(([k, label]) => (
                <option key={k} value={k}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            Xoá dữ liệu trước ngày
            <input
              type="date"
              value={before}
              max={todayVN()}
              required
              disabled={scopeLocked}
              onChange={(e) => {
                setBefore(e.target.value);
                invalidate();
              }}
            />
          </label>
          <label className="field">
            Kho cần dọn
            <select
              value={warehouse}
              disabled={scopeLocked}
              onChange={(e) => {
                setWarehouse(e.target.value);
                invalidate();
              }}
            >
              <option value="">Tất cả kho</option>
              <OptionList rows={refs.warehouses} />
            </select>
          </label>
        </div>
        <p className="small-note">
          Mốc tính từ 00:00 theo giờ Việt Nam (UTC+7), không bao gồm ngày được
          chọn. Mỗi đợt tối đa {CLEANUP_BATCH_LIMIT} bản ghi gốc; có thể xem
          trước lại để dọn tiếp.
        </p>
        <div className="notice maintenance-policy">
          <ShieldCheck size={20} />
          <p>
            {kind === "scans"
              ? "Chỉ dọn lượt quét cũ của vận đơn đã bàn giao/đã huỷ và không còn ngoại lệ mở, cùng các lượt nhập mã không gắn vận đơn đủ điều kiện. Giữ nguyên vận đơn, ngày quét và bàn giao để tiếp tục đối soát."
              : "Chỉ dọn hồ sơ đã Hoàn thành / Đã được bồi hoàn / Đóng không thành công, không cần kiểm lại và không có khiếu nại đang mở. Hồ sơ có nguồn, nhận hàng hoặc hoạt động mới sau mốc được giữ lại."}
          </p>
        </div>
        <button
          className="primary import-read-button"
          disabled={scopeLocked || !before || before > todayVN()}
          onClick={() => void preview()}
        >
          {phase === "preview" ? (
            <LoaderCircle size={17} className="spin" />
          ) : (
            <RefreshCw size={17} />
          )}{" "}
          Xem trước dữ liệu sẽ xoá
        </button>
      </div>
      {!showConfirm && <ErrorBox message={error} />}
      {plan && (
        <div className="maintenance-preview">
          {uncertain && (
            <div className="notice warning">
              Yêu cầu xoá đã gửi nhưng chưa nhận được kết quả. Thử lại cùng lần
              xoá để nhận kết quả hoặc hoàn tất đúng phạm vi đã xác nhận; đóng
              hộp thoại không hoàn tác yêu cầu đã gửi.
            </div>
          )}
          <div className="maintenance-preview-heading">
            <div>
              <h3>2. Kiểm tra phạm vi xoá</h3>
              <p>
                {cleanupKinds[plan.kind as CleanupKind]} · Trước {plan.before} ·{" "}
                {plan.warehouse
                  ? refs.warehouses.find((w: Row) => w.id === plan.warehouse)
                      ?.name
                  : "Tất cả kho"}
              </p>
            </div>
            <span className="import-state ready">
              {uncertain ? "Chưa nhận kết quả xoá" : "Chưa xoá dữ liệu"}
            </span>
          </div>
          <div className="maintenance-metrics">
            <div>
              <span>Được chọn trong đợt này</span>
              <strong>{plan.summary.selected}</strong>
              <small>Bản ghi gốc sẽ xoá</small>
            </div>
            <div>
              <span>Được giữ để xử lý</span>
              <strong>{plan.summary.protected}</strong>
              <small>Dữ liệu cũ chưa đủ điều kiện dọn</small>
            </div>
            <div>
              <span>Nội dung ước tính</span>
              <strong>{formatBytes(plan.summary.estimatedBytes)}</strong>
              <small>Không phải mức giảm ngay trên đĩa</small>
            </div>
            <div>
              <span>Tệp đính kèm sẽ xoá</span>
              <strong>{plan.summary.counts.evidence ?? 0}</strong>
              <small>
                {formatBytes(plan.summary.evidenceBytes)} nội dung ảnh / PDF
              </small>
            </div>
          </div>
          {plan.kind === "scans" ? (
            <p className="small-note">
              Kèm {plan.summary.counts.exceptions ?? 0} ngoại lệ đã giải quyết
              thuộc các lượt quét được chọn. Các báo cáo lượt quét chi tiết cũ
              sẽ không còn các dòng đã xoá.
            </p>
          ) : (
            <p className="small-note">
              Xoá cả sản phẩm, mã kiện, lần quét hoàn, bản ghi nguồn, khiếu nại
              đã kết thúc và ảnh/PDF thuộc hồ sơ được chọn. Số liệu đơn hoàn
              lịch sử sẽ giảm theo dữ liệu đã xoá. Giữ dấu vết file và mã yêu
              cầu để dữ liệu đã dọn không tự nhập lại từ file cũ hoặc file xuất
              mới.
            </p>
          )}
          {plan.summary.hasMore && (
            <div className="notice warning">
              Có {plan.summary.eligible} bản ghi đủ điều kiện, đợt này chọn{" "}
              {plan.summary.selected}. Xác nhận xong hãy xem trước lại để dọn
              phần còn lại.
            </div>
          )}
          <div className="maintenance-exports">
            <span>Lưu danh sách trước khi xoá:</span>
            {["xlsx", "csv"].map((format) => (
              <a
                key={format}
                className="button secondary small"
                href={`/api/maintenance/export/${plan.id}?format=${format}`}
                onClick={(e) => {
                  if (scopeLocked) e.preventDefault();
                }}
              >
                <FileDown size={15} />
                {format === "xlsx" ? "Xuất Excel" : "Xuất CSV"}
              </a>
            ))}
          </div>
          <p className="small-note">
            Tệp xuất chỉ chứa danh sách dự kiến xoá, không chứa ảnh/PDF hoặc
            toàn bộ dữ liệu gốc để khôi phục. Muốn khôi phục đầy đủ cần bản sao
            lưu PostgreSQL của Railway. Lần xem trước hết hạn lúc{" "}
            {formatTime(plan.expires_at)}.
          </p>
          {plan.rows.length > 0 ? (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>MÃ VẬN ĐƠN / YÊU CẦU</th>
                    <th>KHO</th>
                    <th>THỜI ĐIỂM</th>
                    <th>TRẠNG THÁI</th>
                  </tr>
                </thead>
                <tbody>
                  {plan.rows.map((r: Row) => (
                    <tr key={r.id}>
                      <td>
                        {r.code}
                        {r.order_code && (
                          <small className="block">
                            Đơn gốc: {r.order_code}
                          </small>
                        )}
                      </td>
                      <td>{r.warehouse}</td>
                      <td>{formatTime(r.created_at)}</td>
                      <td>
                        {plan.kind === "returns"
                          ? returnProcessing[r.status]
                          : (statuses[r.status] ?? outcomes[r.outcome])}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="notice">
              <CheckCircle2 size={18} /> Không có dữ liệu đủ điều kiện xoá theo
              mốc và kho đã chọn.
            </div>
          )}
          {plan.summary.selected > 50 && (
            <p className="small-note">
              Hiển thị 50 bản ghi đầu. Tệp xuất và lần xác nhận gồm đủ{" "}
              {plan.summary.selected} bản ghi của đợt này.
            </p>
          )}
          <div className="maintenance-delete-row">
            <p>
              <AlertTriangle size={17} /> Xoá vĩnh viễn; không có nút khôi phục
              trong ứng dụng.
            </p>
            <button
              className="button maintenance-delete"
              disabled={busy || !plan.summary.selected}
              onClick={() => {
                setShowConfirm(true);
                if (!uncertain) {
                  setConfirmation("");
                  setAcknowledge(false);
                  setReason("");
                }
                setError("");
              }}
            >
              <Trash2 size={17} />{" "}
              {uncertain
                ? "Thử lại lần xoá đã gửi"
                : `Xoá ${plan.summary.selected} bản ghi đã xem trước`}
            </button>
          </div>
        </div>
      )}
      {result && (
        <div className="import-success maintenance-result" role="status">
          <div>
            <strong>
              <CheckCircle2 size={20} />{" "}
              {result.reused
                ? "Lần dọn này đã được xử lý"
                : "Đã xoá dữ liệu cũ"}
            </strong>
            <p>
              {result.deleted} bản ghi gốc · {result.counts.evidence ?? 0} tệp
              đính kèm. Nhật ký kiểm soát và dấu chống trùng được giữ lại.
            </p>
          </div>
          <button
            className="secondary"
            disabled={busy}
            onClick={() => void preview()}
          >
            Xem trước đợt tiếp theo
          </button>
        </div>
      )}
      <div className="maintenance-optimize">
        <div>
          <h3>Tối ưu vùng trống</h3>
          <p>
            Xoá bản ghi tạo vùng trống để PostgreSQL tái sử dụng. Tối ưu vùng
            trống không đảm bảo dung lượng trên đĩa hay phí Railway giảm ngay.
          </p>
          <small>
            Nên dọn trước khi ổ lưu trữ đầy hoàn toàn; cơ sở dữ liệu vẫn cần
            vùng trống để thực hiện xoá và tối ưu.
          </small>
        </div>
        <button
          className="secondary"
          disabled={scopeLocked}
          onClick={() => void optimize()}
        >
          {phase === "optimize" ? (
            <LoaderCircle size={17} className="spin" />
          ) : (
            <HardDrive size={17} />
          )}{" "}
          Tối ưu vùng trống
        </button>
      </div>
      {optimized && (
        <p className="notice import-result-success" role="status">
          <CheckCircle2 size={18} /> Đã tối ưu vùng trống để cơ sở dữ liệu tái
          sử dụng khi lưu dữ liệu mới.
        </p>
      )}
      <details className="maintenance-history">
        <summary>
          Lịch sử dọn dữ liệu ({storage?.history?.length ?? 0} lần gần nhất)
        </summary>
        <button
          className="text-button"
          disabled={busy}
          onClick={() => void reload()}
        >
          Làm mới
        </button>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>THỜI GIAN</th>
                <th>NGƯỜI THỰC HIỆN</th>
                <th>PHẠM VI</th>
                <th>ĐÃ XOÁ</th>
                <th>LÝ DO</th>
              </tr>
            </thead>
            <tbody>
              {storage?.history.map((h: Row) => (
                <tr key={h.id}>
                  <td>{formatTime(h.completed_at)}</td>
                  <td>{h.employee}</td>
                  <td>
                    {cleanupKinds[h.kind as CleanupKind]}
                    <small className="block">
                      Trước {h.before} · {h.warehouse ?? "Tất cả kho"}
                    </small>
                  </td>
                  <td>{h.result.deleted}</td>
                  <td>{h.reason}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
      {showConfirm && plan && (
        <Modal
          title="Xác nhận xoá vĩnh viễn dữ liệu cũ"
          onClose={() => {
            if (!busy) setShowConfirm(false);
          }}
        >
          <div className="modal-body maintenance-confirm">
            <div className="notice danger">
              <AlertTriangle size={22} />
              <p>
                {uncertain ? "Yêu cầu đã gửi cho" : "Bạn sắp xoá"}{" "}
                {plan.summary.selected} bản ghi{" "}
                {cleanupKinds[plan.kind as CleanupKind].toLowerCase()}, trước
                ngày {plan.before}, tại{" "}
                {plan.warehouse
                  ? refs.warehouses.find((w: Row) => w.id === plan.warehouse)
                      ?.name
                  : "tất cả kho"}
                . {plan.summary.counts.evidence ?? 0} tệp đính kèm cũng bị xoá.
                Thao tác không thể hoàn tác trong app.
              </p>
            </div>
            <ErrorBox message={error} />
            <label className="field">
              Lý do dọn dữ liệu
              <textarea
                value={reason}
                minLength={8}
                maxLength={1000}
                disabled={scopeLocked}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Ví dụ: Đã chốt đối soát, lưu bản sao bên ngoài"
              />
            </label>
            <label className="field">
              Nhập {CLEANUP_CONFIRMATION} để xác nhận
              <input
                value={confirmation}
                autoComplete="off"
                spellCheck={false}
                disabled={scopeLocked}
                onChange={(e) => setConfirmation(e.target.value)}
                placeholder={CLEANUP_CONFIRMATION}
              />
            </label>
            <label className="maintenance-ack">
              <input
                type="checkbox"
                checked={acknowledge}
                disabled={scopeLocked}
                onChange={(e) => setAcknowledge(e.target.checked)}
              />
              <span>
                Tôi hiểu dữ liệu được xoá vĩnh viễn và tệp xuất danh sách không
                thay thế bản sao lưu đầy đủ.
              </span>
            </label>
            <div className="maintenance-confirm-actions">
              <button
                className="secondary"
                disabled={busy}
                onClick={() => setShowConfirm(false)}
              >
                {uncertain ? "Đóng hộp thoại" : "Huỷ"}
              </button>
              <button
                className="button maintenance-delete"
                disabled={
                  busy ||
                  confirmation.trim() !== CLEANUP_CONFIRMATION ||
                  !acknowledge ||
                  reason.trim().length < 8
                }
                onClick={() => void execute()}
              >
                {phase === "execute" ? (
                  <LoaderCircle size={17} className="spin" />
                ) : (
                  <Trash2 size={17} />
                )}{" "}
                {uncertain
                  ? "Thử lại cùng lần xoá"
                  : `Xoá vĩnh viễn ${plan.summary.selected} bản ghi`}
              </button>
            </div>
            {phase === "execute" && (
              <p className="small-note" aria-live="polite">
                Đang xử lý, chờ máy chủ xác nhận. Nếu mất phản hồi, thử lại cùng
                lần xem trước để tránh xoá trùng.
              </p>
            )}
          </div>
        </Modal>
      )}
    </section>
  );
}
