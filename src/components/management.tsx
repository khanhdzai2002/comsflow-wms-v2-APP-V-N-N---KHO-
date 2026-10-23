"use client";
import { useRef, useState } from "react";
import {
  FileSpreadsheet,
  ArrowRight,
  Plus,
  ShieldCheck,
  Users,
  Settings,
  FileText,
  CheckCircle2,
} from "lucide-react";
import type { User } from "@/lib/db";
import { formatTime } from "@/lib/domain";
import { fields, fieldLabels } from "@/lib/import-fields";
import {
  api,
  post,
  useData,
  refresh,
  toast,
  Loading,
  ErrorBox,
  Empty,
  ExportButtons,
  OptionList,
  useCatalogSelection,
  Modal,
  type Row,
} from "./shared";
import { PdfSourceImport } from "./source-manifests";
import { FilePicker, ImportSteps } from "./import-ui";
import { DataMaintenance } from "./data-maintenance";
export function Imports({
  refs,
  onImportReturns,
  mode,
  onModeChange,
}: {
  refs: Row;
  onImportReturns: () => void;
  mode: "pdf" | "excel";
  onModeChange: (mode: "pdf" | "excel") => void;
}) {
  const inspection = useRef(0);
  const [filePreviews, setFilePreviews] = useState<Row[]>([]);
  const [files, setFiles] = useState<File[]>([]),
    [mapping, setMapping] = useState<Record<string, string>>({}),
    [preview, setPreview] = useState<Row | null>(null),
    [result, setResult] = useState<Row[]>([]),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [template, setTemplate] = useState("");
  const { data: history } = useData<Row[]>("imports");
  const inspect = async (list: File[], map = mapping) => {
    const version = ++inspection.current;
    setFiles(list);
    setPreview(null);
    setFilePreviews([]);
    setResult([]);
    setError("");
    if (!list[0]) return;
    setBusy(true);
    try {
      const checked: Row[] = [];
      for (const file of list) {
        const form = new FormData();
        form.set("file", file);
        form.set("mapping", JSON.stringify(map));
        const details = await api("imports/preview", {
          method: "POST",
          body: form,
        });
        if (version !== inspection.current) return;
        checked.push({ ...details, filename: file.name });
      }
      setFilePreviews(checked);
      setPreview(checked[0]);
    } catch (e) {
      if (version === inspection.current) setError((e as Error).message);
    } finally {
      if (version === inspection.current) setBusy(false);
    }
  };
  const commit = async () => {
    setBusy(true);
    setError("");
    setResult([]);
    const results: Row[] = [];
    try {
      for (const file of files) {
        const form = new FormData();
        form.set("file", file);
        form.set("mapping", JSON.stringify(mapping));
        const r = await api("imports/commit", { method: "POST", body: form });
        results.push({ ...r, filename: file.name });
        setResult([...results]);
      }
      toast(
        "Đã xử lý " + files.length + " file. Kiểm tra số dòng lỗi bên dưới.",
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      refresh();
      setBusy(false);
    }
  };
  return (
    <>
      <section className="card padded return-import-entry">
        <div>
          <h2>Đơn trả hàng / hoàn tiền</h2>
          <p>
            Nhập file Excel hoặc CSV đơn hoàn từ sàn để theo dõi nhận kiện, kiểm
            hàng và khiếu nại.
          </p>
        </div>
        <button className="primary" onClick={onImportReturns}>
          <FileSpreadsheet size={18} /> Nhập dữ liệu đơn hoàn
        </button>
      </section>
      <div
        className="import-mode-tabs"
        role="tablist"
        aria-label="Loại dữ liệu nhập"
      >
        {(["pdf", "excel"] as const).map((key) => {
          const Icon = key === "pdf" ? FileText : FileSpreadsheet;
          return (
            <button
              key={key}
              id={`import-mode-${key}`}
              role="tab"
              aria-controls={`import-panel-${key}`}
              aria-label={
                key === "pdf" ? "PDF tem vận đơn" : "Excel / CSV đơn hàng"
              }
              aria-selected={mode === key}
              tabIndex={mode === key ? 0 : -1}
              className={mode === key ? "active" : ""}
              onClick={() => onModeChange(key)}
              onKeyDown={(event) => {
                if (
                  !["ArrowLeft", "ArrowRight", "Home", "End"].includes(
                    event.key,
                  )
                )
                  return;
                event.preventDefault();
                const next =
                  event.key === "Home"
                    ? "pdf"
                    : event.key === "End"
                      ? "excel"
                      : mode === "pdf"
                        ? "excel"
                        : "pdf";
                onModeChange(next);
                document.getElementById(`import-mode-${next}`)?.focus();
              }}
            >
              <span className="import-mode-icon">
                <Icon size={23} />
              </span>
              <span>
                <strong>
                  {key === "pdf" ? "PDF tem vận đơn" : "Excel / CSV đơn hàng"}
                </strong>
                <small>
                  {key === "pdf"
                    ? "Đếm mã và lập danh sách nguồn xuất kho"
                    : "Nhập đơn hàng cùng chi tiết sản phẩm"}
                </small>
              </span>
              {mode === key && (
                <span className="mode-selected">
                  <CheckCircle2 size={15} /> Đang chọn
                </span>
              )}
            </button>
          );
        })}
      </div>
      <div
        id="import-panel-pdf"
        role="tabpanel"
        aria-labelledby="import-mode-pdf"
        hidden={mode !== "pdf"}
      >
        <PdfSourceImport refs={refs} />
      </div>
      <div
        id="import-panel-excel"
        role="tabpanel"
        aria-labelledby="import-mode-excel"
        hidden={mode !== "excel"}
      >
        <section className="card import-card">
          <div className="card-heading">
            <div>
              <span className="import-type-badge">
                ĐƠN HÀNG XUẤT KHO · EXCEL / CSV
              </span>
              <h2>Nhập đơn từ Excel / CSV</h2>
              <p>Mỗi file tối đa 5 MB · 10.000 dòng · Không yêu cầu API sàn</p>
            </div>
            <FileSpreadsheet size={24} color="#f36b2b" />
          </div>
          <div className="import-card-body">
            <ImportSteps
              current={preview && !preview.stale ? 3 : files.length ? 2 : 1}
              complete={
                result.length > 0 &&
                result.length === files.length &&
                result.every((r) => !r.errors.length)
              }
            />
            <FilePicker
              label="File Excel hoặc CSV"
              accept=".csv,.xlsx"
              multiple
              files={files}
              disabled={busy}
              help="Hỗ trợ nhiều file .xlsx / .csv · Tối đa 5 MB và 10.000 dòng mỗi file"
              onFiles={(list) => void inspect(list)}
              onRemove={(index) =>
                void inspect(files.filter((_, i) => i !== index))
              }
            />
            <div className="sample-links">
              <span>File mẫu DEMO:</span>
              <a href="/samples/shopee-demo.xlsx" download>
                Shopee Excel ↓
              </a>
              <a href="/samples/tiktok-demo.xlsx" download>
                TikTok Excel ↓
              </a>
              <a href="/samples/shopee-demo.csv" download>
                Shopee CSV ↓
              </a>
              <a href="/samples/tiktok-demo.csv" download>
                TikTok CSV ↓
              </a>
            </div>
            <ErrorBox message={error} />
            {files.length > 0 && (
              <>
                <div className="notice">
                  <FileSpreadsheet size={18} />{" "}
                  {files.map((f) => f.name).join(" · ")}. Xem trước file đầu
                  tiên; kiểm tra từng file khi lưu.
                </div>
                <div className="inline wrap">
                  <select
                    aria-label="Chọn template nhập liệu"
                    defaultValue=""
                    disabled={busy}
                    onChange={(e) => {
                      const chosen = refs.templates.find(
                        (t: Row) => t.id === e.target.value,
                      );
                      if (chosen) {
                        setMapping(chosen.mapping);
                        void inspect(files, chosen.mapping);
                      } else {
                        setMapping({});
                        void inspect(files, {});
                      }
                    }}
                  >
                    <option value="">Ánh xạ mặc định / chọn template</option>
                    <OptionList rows={refs.templates} />
                  </select>
                  <input
                    placeholder="Tên template (Shopee, TikTok…)"
                    value={template}
                    onChange={(e) => setTemplate(e.target.value)}
                  />
                  <button
                    className="secondary"
                    disabled={!template.trim() || busy}
                    onClick={async () => {
                      try {
                        await post("imports/template", {
                          name: template,
                          mapping: Object.fromEntries(
                            fields.map((f) => [f, mapping[f] ?? f]),
                          ),
                        });
                        refresh();
                        toast("Đã lưu template ánh xạ");
                      } catch (e) {
                        toast((e as Error).message, true);
                      }
                    }}
                  >
                    Lưu template
                  </button>
                </div>
                <div className="mapping-grid">
                  {fields.map((f) => (
                    <label className="field" key={f}>
                      {fieldLabels[f]}
                      <select
                        value={mapping[f] ?? f}
                        disabled={busy}
                        onChange={(e) => {
                          setMapping({ ...mapping, [f]: e.target.value });
                          setPreview((prev) =>
                            prev ? { ...prev, stale: true } : null,
                          );
                        }}
                      >
                        <option value={f}>{f} (mặc định)</option>
                        {preview?.headers
                          .filter((h: string) => h !== f)
                          .map((h: string) => (
                            <option value={h} key={h}>
                              {h}
                            </option>
                          ))}
                      </select>
                    </label>
                  ))}
                </div>
                <button
                  className="secondary"
                  disabled={busy}
                  onClick={() => void inspect(files)}
                >
                  Kiểm tra lại ánh xạ
                </button>
              </>
            )}
            {busy && <Loading />}
            {preview && (
              <>
                {preview.stale && (
                  <div className="notice warning">
                    Ánh xạ cột đã thay đổi. Bấm “Kiểm tra lại ánh xạ” trước khi
                    nhập dữ liệu.
                  </div>
                )}
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>FILE ĐÃ KIỂM TRA</th>
                        <th>DÒNG</th>
                        <th>HỢP LỆ</th>
                        <th>LỖI</th>
                        <th>VẬN ĐƠN</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filePreviews.map((file, index) => (
                        <tr key={index}>
                          <td>{file.filename}</td>
                          <td>{file.total}</td>
                          <td>{file.valid}</td>
                          <td>{file.errorCount}</td>
                          <td>{file.uniqueShipments}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="import-stats">
                  <span>
                    <b>{preview.total}</b>Dòng dữ liệu
                  </span>
                  <span>
                    <b className="green-text">{preview.valid}</b>Dòng hợp lệ
                  </span>
                  <span>
                    <b>{preview.uniqueShipments}</b>Vận đơn duy nhất
                  </span>
                  <span>
                    <b className="red-text">{preview.errorCount}</b>Dòng lỗi
                  </span>
                </div>
                <div className="notice">
                  {preview.existingShipments} vận đơn đã tồn tại sẽ được cập
                  nhật; không tạo kiện trùng.
                </div>
                <div className="notice warning">
                  Một đơn có thể gồm nhiều dòng sản phẩm và nhiều kiện. Sản phẩm
                  trong file là ảnh chụp đầy đủ của từng đơn được nhập; không
                  dùng file chỉ chứa một phần sản phẩm để cập nhật đơn.
                </div>
                <div className="table-wrap preview-table">
                  <table>
                    <thead>
                      <tr>
                        {preview.headers.map((h: string) => (
                          <th key={h}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {preview.preview.map((r: Row, i: number) => (
                        <tr key={i}>
                          {preview.headers.map((h: string) => (
                            <td key={h}>{r[h]}</td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {preview.errors.length > 0 && (
                  <details className="error-details">
                    <summary>Xem dòng lỗi</summary>
                    {preview.errors.map((r: Row) => (
                      <p key={r.row}>
                        Dòng {r.row}: {r.message}
                      </p>
                    ))}
                  </details>
                )}
                <div className="import-confirm">
                  <span className="muted">
                    Tối đa 8 dòng xem trước · Dữ liệu được xác minh lại tại máy
                    chủ
                  </span>
                  <button
                    className="primary"
                    disabled={
                      busy ||
                      preview.stale ||
                      filePreviews.every((file) => file.valid === 0)
                    }
                    onClick={commit}
                  >
                    Nhập {files.length} file vào hệ thống{" "}
                    <ArrowRight size={17} />
                  </button>
                </div>
              </>
            )}
            {result.map((r) => (
              <div className="import-result" key={r.batchId}>
                <strong>{r.filename}</strong>
                <p>
                  {r.imported}/{r.total} dòng nhập thành công · {r.orders} đơn ·{" "}
                  {r.newShipments} vận đơn mới · {r.updatedShipments} cập nhật ·{" "}
                  {r.errors.length} lỗi
                </p>
                {r.errors.length > 0 && (
                  <ExportButtons query={"type=errors&batch=" + r.batchId} />
                )}
              </div>
            ))}
          </div>
        </section>
        <section className="card">
          <div className="card-heading">
            <div>
              <h2>Lịch sử nhập dữ liệu</h2>
              <p>100 lần nhập gần nhất</p>
            </div>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>TÊN FILE</th>
                  <th>NGƯỜI NHẬP</th>
                  <th>THỜI GIAN</th>
                  <th>DÒNG THÀNH CÔNG</th>
                  <th>LỖI</th>
                  <th>TẢI LỖI</th>
                </tr>
              </thead>
              <tbody>
                {history?.map((b) => (
                  <tr key={b.id}>
                    <td>
                      <strong>{b.filename}</strong>
                    </td>
                    <td>{b.employee}</td>
                    <td>{formatTime(b.created_at)}</td>
                    <td>
                      {b.imported}/{b.total_rows}
                    </td>
                    <td>{b.errors}</td>
                    <td>
                      {b.errors > 0 && (
                        <ExportButtons query={"type=errors&batch=" + b.id} />
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!history?.length && <Empty />}
          </div>
        </section>
      </div>
    </>
  );
}
export function People({ refs, user }: { refs: Row; user: User }) {
  const [assignment, setAssignment] = useState<Row | null>(null);
  const [roleTarget, setRoleTarget] = useState<Row | null>(null);
  const [newRole, setNewRole] = useState("staff");
  const [roleReason, setRoleReason] = useState("");
  const [assignedMembers, setAssignedMembers] = useState<string[]>([]);
  const localDateTime = (offset = 0) =>
    new Date(new Date(refs.serverTime).getTime() + offset + 7 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 16);
  const [tab, setTab] = useState("shifts"),
    [busy, setBusy] = useState(false);
  const [warehouse, setWarehouse] = useCatalogSelection(refs.warehouses);
  const [name, setName] = useState(""),
    [starts, setStarts] = useState(() => localDateTime()),
    [ends, setEnds] = useState(() => localDateTime(8 * 60 * 60 * 1000)),
    [members, setMembers] = useState<string[]>([user.id]);
  return (
    <>
      {roleTarget && (
        <Modal
          title={"Đổi quyền · " + roleTarget.name}
          onClose={() => !busy && setRoleTarget(null)}
        >
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              try {
                await post("users/update", {
                  id: roleTarget.id,
                  role: newRole,
                  reason: roleReason,
                });
                setRoleTarget(null);
                refresh();
                toast(
                  "Đã cập nhật quyền. Tài khoản cần đăng nhập lại để cập nhật giao diện.",
                );
              } catch (e) {
                toast((e as Error).message, true);
              } finally {
                setBusy(false);
              }
            }}
          >
            <p>{roleTarget.email}</p>
            <label className="field">
              Vai trò mới
              <select
                value={newRole}
                onChange={(e) => setNewRole(e.target.value)}
              >
                <option value="staff">Nhân viên kho</option>
                <option value="manager">Quản lý kho</option>
                <option value="admin">Admin</option>
              </select>
            </label>
            <label className="field">
              Lý do đổi quyền
              <textarea
                required
                minLength={8}
                maxLength={1000}
                value={roleReason}
                onChange={(e) => setRoleReason(e.target.value)}
              />
            </label>
            <button
              className="primary"
              disabled={
                busy ||
                roleReason.trim().length < 8 ||
                newRole === roleTarget.role
              }
            >
              {busy ? "Đang lưu…" : "Lưu quyền"}
            </button>
          </form>
        </Modal>
      )}
      <div className="tabbar">
        <button
          className={tab === "shifts" ? "selected" : ""}
          onClick={() => setTab("shifts")}
        >
          Ca làm việc
        </button>
        <button
          className={tab === "users" ? "selected" : ""}
          onClick={() => setTab("users")}
        >
          Tài khoản nhân viên
        </button>
      </div>
      {assignment && (
        <Modal
          title={"Phân công · " + assignment.name}
          onClose={() => setAssignment(null)}
        >
          <p>
            Thay đổi quyền quét trong ca này; các lượt quét đã ghi trước đó vẫn
            giữ nguyên nhân viên và ca.
          </p>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              try {
                await post("shifts/assign", {
                  shiftId: assignment.id,
                  members: assignedMembers,
                });
                setAssignment(null);
                refresh();
                toast("Đã cập nhật phân công ca");
              } catch (e) {
                toast((e as Error).message, true);
              } finally {
                setBusy(false);
              }
            }}
          >
            <div className="member-picker">
              {refs.users
                .filter((u: Row) => u.active)
                .map((u: Row) => (
                  <label key={u.id}>
                    <input
                      type="checkbox"
                      checked={assignedMembers.includes(u.id)}
                      onChange={(e) =>
                        setAssignedMembers(
                          e.target.checked
                            ? [...assignedMembers, u.id]
                            : assignedMembers.filter((v) => v !== u.id),
                        )
                      }
                    />
                    {u.name}
                  </label>
                ))}
            </div>
            <button
              className="primary"
              disabled={busy || !assignedMembers.length}
            >
              Lưu phân công
            </button>
          </form>
        </Modal>
      )}
      {tab === "shifts" ? (
        <>
          <section className="card padded">
            <h2>
              <Users size={20} /> Tạo ca và phân công
            </h2>
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                setBusy(true);
                try {
                  await post("shifts", {
                    name,
                    warehouseId: warehouse,
                    startsAt: new Date(starts + ":00+07:00").toISOString(),
                    endsAt: new Date(ends + ":00+07:00").toISOString(),
                    members,
                  });
                  refresh();
                  setName("");
                  toast("Đã tạo ca làm việc");
                } catch (e) {
                  toast((e as Error).message, true);
                } finally {
                  setBusy(false);
                }
              }}
            >
              <div className="form-grid">
                <label className="field">
                  Tên ca
                  <input
                    required
                    minLength={2}
                    maxLength={100}
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Ca sáng · Đóng gói"
                  />
                </label>
                <label className="field">
                  Kho
                  <select
                    value={warehouse}
                    onChange={(e) => setWarehouse(e.target.value)}
                  >
                    <OptionList rows={refs.warehouses} />
                  </select>
                </label>
                <label className="field">
                  Bắt đầu (giờ Việt Nam)
                  <input
                    type="datetime-local"
                    required
                    value={starts}
                    onChange={(e) => setStarts(e.target.value)}
                  />
                </label>
                <label className="field">
                  Kết thúc (giờ Việt Nam)
                  <input
                    type="datetime-local"
                    required
                    value={ends}
                    onChange={(e) => setEnds(e.target.value)}
                  />
                </label>
              </div>
              <h3>Nhân viên được phân công</h3>
              <div className="member-picker">
                {refs.users
                  .filter((u: Row) => u.active)
                  .map((u: Row) => (
                    <label key={u.id}>
                      <input
                        type="checkbox"
                        checked={members.includes(u.id)}
                        onChange={(e) =>
                          setMembers(
                            e.target.checked
                              ? [...members, u.id]
                              : members.filter((v) => v !== u.id),
                          )
                        }
                      />
                      {u.name}
                      <small>{u.role}</small>
                    </label>
                  ))}
              </div>
              <button
                className="primary"
                disabled={busy || !members.length || !warehouse}
              >
                <Plus size={17} /> Tạo ca làm việc
              </button>
            </form>
          </section>
          <section className="card">
            <div className="card-heading">
              <h2>Ca hiện tại và sắp tới</h2>
            </div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>TÊN CA</th>
                    <th>KHO</th>
                    <th>BẮT ĐẦU</th>
                    <th>KẾT THÚC</th>
                    <th>BẠN THAM GIA</th>
                    <th>PHÂN CÔNG</th>
                  </tr>
                </thead>
                <tbody>
                  {refs.shifts.map((s: Row) => (
                    <tr key={s.id}>
                      <td>
                        <strong>{s.name}</strong>
                      </td>
                      <td>{s.warehouse}</td>
                      <td>{formatTime(s.starts_at)}</td>
                      <td>{formatTime(s.ends_at)}</td>
                      <td>{s.assigned ? "Có" : "Không"}</td>
                      <td>
                        <small>
                          {(s.member_ids ?? [])
                            .map(
                              (id: string) =>
                                refs.users.find((u: Row) => u.id === id)
                                  ?.name ?? "Tài khoản cũ",
                            )
                            .join(", ")}
                        </small>
                        <button
                          className="secondary small"
                          disabled={
                            new Date(s.ends_at) <= new Date(refs.serverTime)
                          }
                          onClick={() => {
                            setAssignment(s);
                            setAssignedMembers(
                              (s.member_ids ?? []).filter((id: string) =>
                                refs.users.some(
                                  (u: Row) => u.id === id && u.active,
                                ),
                              ),
                            );
                          }}
                        >
                          Phân công
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      ) : (
        <>
          <section className="card">
            <div className="card-heading">
              <div>
                <h2>Tài khoản & phân quyền</h2>
                <p>Admin · Quản lý kho · Nhân viên kho</p>
              </div>
              <ShieldCheck size={22} />
            </div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>HỌ TÊN</th>
                    <th>EMAIL</th>
                    <th>VAI TRÒ</th>
                    <th>TRẠNG THÁI</th>
                    <th>THAO TÁC</th>
                  </tr>
                </thead>
                <tbody>
                  {refs.users.map((u: Row) => (
                    <tr key={u.id}>
                      <td>
                        <strong>{u.name}</strong>
                      </td>
                      <td>{u.email}</td>
                      <td>{u.role}</td>
                      <td>{u.active ? "Đang hoạt động" : "Đã khóa"}</td>
                      <td>
                        {user.role === "admin" && u.id !== user.id && (
                          <div className="inline wrap">
                            <button
                              className="secondary small"
                              onClick={() => {
                                setRoleTarget(u);
                                setNewRole(u.role);
                                setRoleReason("");
                              }}
                            >
                              Đổi quyền
                            </button>
                          </div>
                        )}
                        {user.role === "admin" && u.id !== user.id && (
                          <button
                            className="secondary small"
                            onClick={async () => {
                              const reason = prompt(
                                "Lý do thay đổi trạng thái tài khoản (ít nhất 8 ký tự):",
                              );
                              if (!reason) return;
                              try {
                                await post("users/update", {
                                  id: u.id,
                                  active: !u.active,
                                  reason,
                                });
                                refresh();
                                toast("Đã cập nhật trạng thái tài khoản");
                              } catch (e) {
                                toast((e as Error).message, true);
                              }
                            }}
                          >
                            {u.active ? "Khóa tài khoản" : "Mở khóa"}
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
          {user.role === "admin" && <CreateUser />}
        </>
      )}
    </>
  );
}
function CreateUser() {
  const [busy, setBusy] = useState(false);
  return (
    <section className="card padded">
      <h2>Tạo tài khoản</h2>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          const form = e.currentTarget,
            d = Object.fromEntries(new FormData(form));
          setBusy(true);
          try {
            await post("users", d);
            form.reset();
            refresh();
            toast("Đã tạo tài khoản");
          } catch (e) {
            toast((e as Error).message, true);
          } finally {
            setBusy(false);
          }
        }}
      >
        <div className="form-grid">
          <label className="field">
            Họ và tên
            <input name="name" minLength={2} maxLength={100} required />
          </label>
          <label className="field">
            Email
            <input name="email" type="email" required />
          </label>
          <label className="field">
            Mật khẩu (ít nhất 12 ký tự)
            <input
              name="password"
              type="password"
              autoComplete="new-password"
              minLength={12}
              maxLength={100}
              required
            />
          </label>
          <label className="field">
            Vai trò
            <select name="role">
              <option value="staff">Nhân viên kho</option>
              <option value="manager">Quản lý kho</option>
              <option value="admin">Admin</option>
            </select>
          </label>
        </div>
        <button className="primary" disabled={busy}>
          Tạo tài khoản
        </button>
      </form>
    </section>
  );
}
export function Configuration({ refs, user }: { refs: Row; user: User }) {
  const [editingRule, setEditingRule] = useState<Row | null>(null);
  const { data: logs } = useData<Row[]>("audit");
  const [busy, setBusy] = useState(false),
    [kind, setKind] = useState("carrier");
  return (
    <>
      {user.role === "admin" ? (
        <>
          <section className="card padded">
            <h2>Danh mục cơ bản</h2>
            <p className="muted">
              Tạo Kho ComsMiu nếu chưa có kho; bổ sung sàn, hãng và tên gọi phổ
              biến còn thiếu.
            </p>
            <button
              className="secondary"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  const result = await post("config/setup", {});
                  refresh();
                  toast(
                    result.created.length
                      ? "Đã bổ sung danh mục cơ bản"
                      : "Danh mục cơ bản đã đầy đủ",
                  );
                } catch (e) {
                  toast((e as Error).message, true);
                } finally {
                  setBusy(false);
                }
              }}
            >
              Bổ sung danh mục cơ bản
            </button>
          </section>
          <DataMaintenance refs={refs} />
          <div className="two-columns">
            <section className="card padded">
              <h2>
                <Settings size={19} /> Danh mục vận hành
              </h2>
              <p className="muted">
                Thêm hãng vận chuyển, kho hoặc sàn bán hàng.
              </p>
              <form
                onSubmit={async (e) => {
                  e.preventDefault();
                  const form = e.currentTarget;
                  setBusy(true);
                  try {
                    await post("config", {
                      kind,
                      name: new FormData(form).get("name"),
                    });
                    form.reset();
                    refresh();
                    toast("Đã lưu danh mục");
                  } catch (e) {
                    toast((e as Error).message, true);
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                <label className="field">
                  Loại danh mục
                  <select
                    value={kind}
                    onChange={(e) => setKind(e.target.value)}
                  >
                    <option value="carrier">Hãng vận chuyển</option>
                    <option value="warehouse">Kho</option>
                    <option value="channel">Sàn bán hàng</option>
                  </select>
                </label>
                <label className="field">
                  Tên
                  <input name="name" required minLength={2} maxLength={100} />
                </label>
                <button className="primary" disabled={busy}>
                  Thêm danh mục
                </button>
              </form>
              <details>
                <summary>Đổi tên chuẩn hãng vận chuyển</summary>
                <form
                  className="form-grid"
                  onSubmit={async (e) => {
                    e.preventDefault();
                    setBusy(true);
                    try {
                      await post("config", {
                        kind: "carrier-rename",
                        ...Object.fromEntries(new FormData(e.currentTarget)),
                      });
                      refresh();
                      toast("Đã đổi tên hãng");
                    } catch (e) {
                      toast((e as Error).message, true);
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  <label className="field">
                    Hãng cần đổi tên
                    <select name="id">
                      <OptionList rows={refs.carriers} />
                    </select>
                  </label>
                  <label className="field">
                    Tên chuẩn mới
                    <input name="name" required minLength={2} />
                  </label>
                  <button className="primary" disabled={busy}>
                    Lưu tên chuẩn
                  </button>
                </form>
              </details>
              <div className="tag-list">
                {(
                  {
                    carrier: refs.carriers,
                    warehouse: refs.warehouses,
                    channel: refs.channels,
                  } as Row
                )[kind].map((v: Row) => (
                  <span key={v.id}>{v.name}</span>
                ))}
              </div>
            </section>
            <section className="card padded">
              <h2>Quy tắc gợi ý tiền tố</h2>
              <p className="muted">
                Chỉ dùng gợi ý đối soát. Không xác nhận dữ liệu sàn từ tiền tố.
              </p>
              <form
                key={editingRule?.id ?? "new-rule"}
                onSubmit={async (e) => {
                  e.preventDefault();
                  const form = e.currentTarget;
                  setBusy(true);
                  try {
                    const fields = Object.fromEntries(new FormData(form));
                    await post("config", {
                      kind: "rule",
                      ...fields,
                      active: fields.active === "on",
                    });
                    refresh();
                    toast("Đã lưu quy tắc");
                  } catch (e) {
                    toast((e as Error).message, true);
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                <label className="field">
                  Tiền tố
                  <input
                    name="prefix"
                    defaultValue={editingRule?.prefix ?? ""}
                    required
                    pattern="[A-Z0-9]{1,30}"
                    placeholder="SPXVN"
                  />
                </label>
                <label className="field">
                  Hãng vận chuyển
                  <select
                    name="carrierId"
                    defaultValue={editingRule?.carrier_id}
                  >
                    <OptionList rows={refs.carriers} />
                  </select>
                </label>
                <label className="field">
                  Sàn gợi ý
                  <select
                    name="channelId"
                    defaultValue={editingRule?.channel_id ?? ""}
                  >
                    <option value="">Chưa xác định</option>
                    <OptionList rows={refs.channels} />
                  </select>
                </label>
                <button className="primary" disabled={busy}>
                  Lưu quy tắc
                </button>
                <label className="inline">
                  <input
                    type="checkbox"
                    name="active"
                    defaultChecked={editingRule?.active ?? true}
                  />{" "}
                  Đang áp dụng
                </label>
                <button
                  type="button"
                  className="secondary small"
                  onClick={() => setEditingRule(null)}
                >
                  Quy tắc mới
                </button>
              </form>
              <div className="tag-list">
                {refs.rules.map((r: Row) => (
                  <span key={r.id}>
                    <button
                      className="text-button"
                      onClick={() => setEditingRule(r)}
                    >
                      {r.prefix} → {r.carrier} / {r.channel ?? "Chưa xác định"}{" "}
                      · {r.active ? "Đang bật" : "Đã tắt"} · sửa
                    </button>
                  </span>
                ))}
              </div>
            </section>
          </div>
        </>
      ) : (
        <div className="notice">
          Chỉ Admin được thay đổi cấu hình. Bạn có thể xem nhật ký bên dưới.
        </div>
      )}
      <section className="card">
        <div className="card-heading">
          <div>
            <h2>Nhật ký kiểm soát</h2>
            <p>
              200 thao tác gần nhất · Người thực hiện, thời gian, lý do và giá
              trị trước/sau
            </p>
          </div>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>THỜI GIAN</th>
                <th>NGƯỜI THỰC HIỆN</th>
                <th>THAO TÁC</th>
                <th>LÝ DO</th>
                <th>CHI TIẾT</th>
              </tr>
            </thead>
            <tbody>
              {logs?.map((l) => (
                <tr key={l.id}>
                  <td className="nowrap">{formatTime(l.created_at)}</td>
                  <td>{l.employee}</td>
                  <td>{l.action}</td>
                  <td>{l.reason}</td>
                  <td>
                    <details>
                      <summary>Trước / sau</summary>
                      <pre>
                        {JSON.stringify(
                          { before: l.before_value, after: l.after_value },
                          null,
                          2,
                        )}
                      </pre>
                    </details>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
