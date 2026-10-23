"use client";
import { useState } from "react";
import { FileText, Trash2, RotateCcw } from "lucide-react";
import { summarizePdfBatch, type PdfBatchPreview } from "@/lib/source-batch";
import {
  MAX_SOURCE_PDF_BYTES,
  MAX_SOURCE_PDF_MB,
  MAX_SOURCE_PDF_PAGES,
  SOURCE_REQUEST_TIMEOUT_MS,
} from "@/lib/source-limits";
import { canonicalSourceCarrier } from "@/lib/source-carriers";
import { FilePicker, ImportSteps } from "./import-ui";
import { todayVN, formatTime } from "@/lib/domain";
import {
  api,
  post,
  Modal,
  useData,
  refresh,
  toast,
  ErrorBox,
  Loading,
  Empty,
  Badge,
  OptionList,
  type Row,
} from "./shared";

type PdfSelection = {
  file: File;
  key: string;
  preview?: Row & PdfBatchPreview;
  error?: string;
  result?: Row;
  saveError?: string;
};
const MAX_PDF_FILES = 20;
export function PdfSourceImport({ refs }: { refs: Row }) {
  const [records, setRecords] = useState<PdfSelection[]>([]);
  const [warehouseId, setWarehouse] = useState("");
  const [channel, setChannel] = useState("");
  const [carrierId, setCarrier] = useState("");
  const [shop, setShop] = useState("ComsMiu");
  const [dueDate, setDueDate] = useState(todayVN());
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [progress, setProgress] = useState("");
  const [saved, setSaved] = useState("");
  const warehouse = warehouseId || refs.warehouses?.[0]?.id || "";
  const summary = summarizePdfBatch(records);
  const pending = summary.readyIndexes.filter((i) => !records[i].result);
  const savedCount = records.filter((r) => r.result).length;
  const complete =
    records.length > 0 &&
    records.every((r, i) => r.result || summary.duplicateIndexes.includes(i));
  function invalidate() {
    setRecords((list) => list.map((r) => ({ file: r.file, key: r.key })));
    setSaved("");
    setError("");
    setProgress("");
  }
  function addFiles(incoming: File[]) {
    const next = [...records];
    for (const file of incoming) {
      next.push({ file, key: crypto.randomUUID() });
    }
    if (next.length > MAX_PDF_FILES) {
      setError(
        `Mỗi lần chọn tối đa ${MAX_PDF_FILES} PDF. Các file đang chọn vẫn được giữ.`,
      );
      return;
    }
    setRecords(next.map((r) => ({ file: r.file, key: r.key })));
    setSaved("");
    setError("");
    setProgress("");
  }
  function formFor(file: File) {
    const form = new FormData();
    form.set("file", file);
    form.set(
      "context",
      JSON.stringify({
        warehouseId: warehouse,
        carrierId,
        channel,
        shop,
        dueDate,
      }),
    );
    return form;
  }
  async function inspect() {
    if (busy || !records.length) return;
    setBusy(true);
    setError("");
    setSaved("");
    const next = records.map((r) => ({
      file: r.file,
      key: r.key,
    })) as PdfSelection[];
    setRecords(next);
    try {
      for (let i = 0; i < next.length; i++) {
        setProgress(
          `Đang đọc file ${i + 1}/${next.length}: ${next[i].file.name}`,
        );
        try {
          if (next[i].file.size > MAX_SOURCE_PDF_BYTES)
            throw new Error(
              `File PDF tối đa ${MAX_SOURCE_PDF_MB} MB; hãy tách file lớn hơn.`,
            );
          next[i] = {
            ...next[i],
            preview: await api(
              "sources/preview",
              {
                method: "POST",
                body: formFor(next[i].file),
              },
              SOURCE_REQUEST_TIMEOUT_MS,
            ),
          };
        } catch (e) {
          next[i] = { ...next[i], error: (e as Error).message };
        }
        setRecords([...next]);
      }
    } finally {
      setBusy(false);
      setProgress("");
    }
  }
  async function commit() {
    if (busy || !pending.length) return;
    setBusy(true);
    setError("");
    const next = [...records];
    try {
      for (let n = 0; n < pending.length; n++) {
        const i = pending[n];
        setProgress(
          `Đang lưu file ${n + 1}/${pending.length}: ${next[i].file.name}`,
        );
        try {
          const result = await api(
            "sources/commit",
            {
              method: "POST",
              body: formFor(next[i].file),
            },
            SOURCE_REQUEST_TIMEOUT_MS,
          );
          next[i] = { ...next[i], result, saveError: undefined };
          setSaved(result.id);
        } catch (e) {
          next[i] = { ...next[i], saveError: (e as Error).message };
        }
        setRecords([...next]);
      }
      const count = next.filter((r) => r.result).length;
      toast(
        `Đã có xác nhận lưu ${count}/${next.length} file. Kiểm tra kết quả từng file.`,
        next.some((r) => r.saveError),
      );
    } finally {
      refresh();
      setBusy(false);
      setProgress("");
    }
  }
  return (
    <>
      <section className="card padded pdf-source-import">
        <div className="card-heading">
          <div>
            <span className="import-type-badge">ĐƠN HÀNG XUẤT KHO · PDF</span>
            <h2>
              <FileText size={21} /> Nhập PDF tem vận đơn làm nguồn
            </h2>
            <p>
              Shopee · SPX Express / GHN / TikTok Shop · J&T Express / BEST
              Express · Tối đa 20 file mỗi lần, mỗi file {MAX_SOURCE_PDF_MB} MB
              / {MAX_SOURCE_PDF_PAGES.toLocaleString("vi-VN")} trang
            </p>
          </div>
        </div>
        <ImportSteps
          current={pending.length || savedCount ? 3 : records.length ? 2 : 1}
          complete={complete}
        />
        <p>
          Chọn nhiều PDF cùng kho, shop và ngày dự kiến xuất. Sàn và hãng được
          nhận dạng riêng từng file; có thể chọn cả Shopee/SPX/GHN lẫn
          TikTok/J&T/BEST. Kiểm tra từng file rồi lưu các file hợp lệ.
        </p>
        <div className="form-grid">
          <label className="field">
            Kho của file PDF
            <select
              disabled={busy}
              value={warehouse}
              onChange={(e) => {
                setWarehouse(e.target.value);
                invalidate();
              }}
            >
              <OptionList rows={refs.warehouses} />
            </select>
          </label>
          <label className="field">
            Sàn của file PDF
            <select
              disabled={busy}
              value={channel}
              onChange={(e) => {
                setChannel(e.target.value);
                invalidate();
              }}
            >
              <option value="">Tự nhận dạng từng file</option>
              <option value="Shopee">Shopee</option>
              <option value="TikTok Shop">TikTok Shop</option>
            </select>
          </label>
          <label className="field">
            Hãng của file PDF
            <select
              disabled={busy}
              value={carrierId}
              onChange={(e) => {
                setCarrier(e.target.value);
                invalidate();
              }}
            >
              <option value="">Tự nhận dạng từng file</option>
              <OptionList
                rows={
                  refs.carriers?.filter((c: Row) =>
                    canonicalSourceCarrier(c.name),
                  ) ?? []
                }
              />
            </select>
          </label>
          <label className="field">
            Shop của file PDF
            <input
              disabled={busy}
              required
              maxLength={100}
              value={shop}
              onChange={(e) => {
                setShop(e.target.value);
                invalidate();
              }}
            />
          </label>
          <label className="field">
            Ngày dự kiến xuất của PDF
            <input
              disabled={busy}
              type="date"
              required
              value={dueDate}
              onChange={(e) => {
                setDueDate(e.target.value);
                invalidate();
              }}
            />
          </label>
        </div>
        <FilePicker
          label="File PDF nguồn"
          accept=".pdf,application/pdf"
          multiple
          pdf
          showFiles={false}
          files={records.map((r) => r.file)}
          onFiles={addFiles}
          disabled={busy}
          help={`Chọn hoặc thêm nhiều PDF · Tối đa ${MAX_PDF_FILES} file · ${MAX_SOURCE_PDF_MB} MB / ${MAX_SOURCE_PDF_PAGES.toLocaleString("vi-VN")} trang mỗi file`}
        />
        <div className="notice">
          Shopee và TikTok Shop là hai sàn riêng. Tự nhận dạng Shopee/SPX hoặc
          GHN bằng Mã vận đơn SPXVN hoặc GHN (G + 7 chữ/số) và Mã đơn hàng khớp
          OrderSN; TikTok/J&T bằng mã 86, TikTok/BEST bằng mã TTVN và dấu hãng
          BEST. Nhận dạng dựa trên nội dung tem, không dựa tên file. PDF ảnh/mẫu
          khác bị chặn. PDF chỉ nhập mã đơn/kiện; bổ sung sản phẩm bằng
          Excel/CSV.
        </div>
        <ErrorBox message={error} />
        {!!records.length && (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>
                    FILE ĐANG CHỌN ({records.length}/{MAX_PDF_FILES})
                  </th>
                  <th>KÍCH THƯỚC</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {records.map((r) => (
                  <tr key={r.key}>
                    <td>{r.file.name}</td>
                    <td>{(r.file.size / 1024 / 1024).toFixed(2)} MB</td>
                    <td>
                      <button
                        className="text-button"
                        disabled={busy}
                        aria-label={`Bỏ file ${r.file.name}`}
                        onClick={() => {
                          setRecords((list) =>
                            list
                              .filter((x) => x.key !== r.key)
                              .map((x) => ({ file: x.file, key: x.key })),
                          );
                          setSaved("");
                          setError("");
                          setProgress("");
                        }}
                      >
                        Bỏ khỏi lần nhập
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="inline wrap">
          <button
            className="primary import-read-button"
            disabled={
              busy || !records.length || !warehouse || !shop.trim() || !dueDate
            }
            onClick={() => void inspect()}
          >
            {busy ? "Đang xử lý…" : "Đọc và đếm PDF"}
          </button>
        </div>
        {progress && <p role="status">{progress}</p>}
        {records.some((r) => r.preview || r.error) && (
          <>
            {records.length > 1 && (
              <div className="notice pdf-batch-summary" role="status">
                {summary.readyIndexes.length} file hợp lệ ·{" "}
                {summary.uniqueShipments} vận đơn duy nhất · {summary.orders}{" "}
                đơn hàng · {summary.overlapShipments} mã lặp giữa các file.{" "}
                {summary.duplicateIndexes.length} file trùng nội dung được bỏ
                qua. Tổng chỉ tính file hợp lệ; mỗi file vẫn lưu danh sách
                riêng.
              </div>
            )}
            {records.map((r, index) => {
              const p = r.preview;
              const issues = [...(p?.errors ?? []), ...(p?.conflicts ?? [])];
              const state = r.result
                ? "saved"
                : summary.duplicateIndexes.includes(index)
                  ? "duplicate"
                  : summary.readyIndexes.includes(index)
                    ? "ready"
                    : r.error || p
                      ? "blocked"
                      : "pending";
              return (
                <div className="source-preview" data-state={state} key={r.key}>
                  <span className={`import-state ${state}`}>
                    {
                      {
                        saved: "Đã có xác nhận lưu",
                        ready: "Đã kiểm tra · Chưa lưu",
                        blocked: "Cần kiểm tra lại file",
                        duplicate: "File trùng · Bỏ qua khi lưu",
                        pending: "Chờ đọc file",
                      }[state]
                    }
                  </span>
                  <h3>
                    Kết quả đọc PDF
                    {records.length > 1 ? ` · ${r.file.name}` : ""}
                  </h3>
                  <p>
                    <strong>{r.file.name}</strong>
                    {p && (
                      <>
                        {" "}
                        · Sàn:{" "}
                        <strong>{p.channelName ?? "Chưa nhận dạng"}</strong> ·
                        Hãng:{" "}
                        <strong>{p.carrierName ?? "Chưa nhận dạng"}</strong>
                      </>
                    )}
                  </p>
                  <ErrorBox message={r.error ?? ""} />
                  {p && (
                    <>
                      <div className="import-stats">
                        <span>
                          <b>{p.pageCount}</b> trang
                        </span>
                        <span>
                          <b>{p.orderCount}</b> đơn hàng duy nhất
                        </span>
                        <span>
                          <b>{p.uniqueShipments}</b> vận đơn duy nhất
                        </span>
                        <span>
                          <b>{p.duplicatePages}</b> trang tem trùng
                        </span>
                      </div>
                      <p className="notice">
                        {p.continuationPages} trang sản phẩm tiếp theo đã ghép
                        bằng Order ID với tem liền trước, không tính thêm vận
                        đơn. Số trang PDF có thể lớn hơn số kiện; không bắt buộc
                        dòng Qty Total nằm cùng trang với mã vận đơn.
                      </p>
                      {p.carrierUnresolved ? (
                        <p>
                          Chưa kiểm tra vận đơn đã có vì chưa nhận dạng được một
                          sàn/hãng duy nhất trong file.
                        </p>
                      ) : (
                        <p>
                          {p.existingShipments} vận đơn đã có trong hệ thống,
                          trong đó {p.alreadyScanned} đã quét và{" "}
                          {p.alreadyHanded} đã bàn giao. Lịch sử và ngày xuất
                          hiện có được giữ nguyên.
                        </p>
                      )}
                      {p.differentDueDates > 0 && (
                        <div className="notice">
                          {p.differentDueDates} mã đã có ngày dự kiến xuất khác
                          ngày chọn. Đối soát theo file vẫn lấy đủ mã.
                        </div>
                      )}
                      {p.existingManifestId && (
                        <div className="notice">
                          {p.existingManifestArchived
                            ? "File đã bị loại bỏ. Vào Đối soát xuất kho → Theo file nguồn PDF → Nguồn đã loại bỏ để khôi phục."
                            : "File đã có: xác nhận sẽ mở nguồn cũ, không tạo trùng."}
                        </div>
                      )}
                      <ErrorBox
                        message={
                          issues.length
                            ? `${p.errors.length} trang lỗi · ${p.conflicts.length} mã xung đột. Chưa thể lưu nguồn; cần xử lý hết lỗi.`
                            : p.carrierUnresolved
                              ? "Chưa nhận dạng được một sàn/hãng duy nhất; chưa thể lưu."
                              : ""
                        }
                      />
                      {issues.slice(0, 10).map((issue: Row, i: number) => (
                        <p key={i} className="red-text">
                          {issue.page
                            ? `Trang ${issue.page}`
                            : (issue.trackingCode ?? "Toàn file")}
                          : {issue.message}
                        </p>
                      ))}
                      {issues.length > 10 && (
                        <details>
                          <summary>Xem thêm {issues.length - 10} lỗi</summary>
                          {issues.slice(10).map((issue: Row, i: number) => (
                            <p key={i} className="red-text">
                              {issue.page
                                ? `Trang ${issue.page}`
                                : (issue.trackingCode ?? "Toàn file")}
                              : {issue.message}
                            </p>
                          ))}
                        </details>
                      )}
                      <details>
                        <summary>
                          Xem toàn bộ mã đọc được và trang gốc (
                          {p.labels.length})
                        </summary>
                        <div className="table-wrap">
                          <table>
                            <thead>
                              <tr>
                                <th>VẬN ĐƠN</th>
                                <th>MÃ ĐƠN</th>
                                <th>HÃNG</th>
                                <th>TRANG PDF</th>
                              </tr>
                            </thead>
                            <tbody>
                              {p.labels.map((l: Row) => (
                                <tr key={l.trackingCode}>
                                  <td>{l.trackingCode}</td>
                                  <td>{l.orderId}</td>
                                  <td>{l.carrier}</td>
                                  <td>{l.pages.join(", ")}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </details>
                    </>
                  )}
                  {summary.crossErrors[index]?.length > 0 && (
                    <ErrorBox
                      message={`Mã mâu thuẫn giữa các file: ${summary.crossErrors[index].join(", ")}. Không lưu các file chứa mã này.`}
                    />
                  )}
                  {summary.duplicateIndexes.includes(index) && (
                    <p className="notice">
                      Trùng nội dung với file đã chọn khác; bỏ qua file này khi
                      lưu.
                    </p>
                  )}
                  {r.result && (
                    <div className="notice import-result-success" role="status">
                      {r.result.reused ? "Đã mở nguồn cũ" : "Đã lưu nguồn"}:{" "}
                      {r.result.total} vận đơn · {r.result.newShipments} vận đơn
                      tạo mới.
                    </div>
                  )}
                  {r.saveError && (
                    <ErrorBox
                      message={`Chưa xác nhận lưu ${r.file.name}: ${r.saveError}. Có thể thử lại; file đã lưu sẽ không lưu lại.`}
                    />
                  )}
                </div>
              );
            })}
            <button
              className="primary import-save-button"
              disabled={busy || !pending.length}
              onClick={() => void commit()}
            >
              {records.length === 1
                ? `Xác nhận lưu ${records[0].preview?.uniqueShipments ?? 0} vận đơn nguồn`
                : pending.length
                  ? `Lưu ${pending.length} file hợp lệ${records.some((r) => r.saveError) ? " / thử lại file chưa lưu" : ""}`
                  : records.some((r) => r.result)
                    ? "Đã xử lý các file hợp lệ"
                    : "Chưa có file hợp lệ để lưu"}
            </button>
          </>
        )}
      </section>
      {saved && <SourceReconciliation key={saved} initialId={saved} />}
    </>
  );
}

export function SourceReconciliation({
  initialId = "",
}: {
  initialId?: string;
}) {
  const [pageNumber, setPageNumber] = useState(1);
  const [scope, setScope] = useState("active");
  const [pending, setPending] = useState<Row | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState("");
  const [selected, setSelected] = useState(initialId),
    [filter, setFilter] = useState("all"),
    [search, setSearch] = useState("");
  const {
    data: sources,
    error: listError,
    loading: listLoading,
    reload: reloadSources,
  } = useData<Row[]>("sources?scope=" + scope, 5000);
  const id = sources?.some((s) => s.id === selected)
    ? selected
    : sources?.[0]?.id || "";
  const { data, error, loading } = useData<Row>(
    id ? "sources/" + id : null,
    5000,
  );
  const totals = data?.totals;
  const shown = data?.rows.filter(
    (r: Row) =>
      (!search ||
        r.tracking_code.includes(search.trim()) ||
        r.external_id.includes(search.trim())) &&
      (filter === "all" ||
        (filter === "unscanned" && !r.scanned_at) ||
        (filter === "notHanded" &&
          (!r.handed_at || r.status !== "handed_over" || r.contextChanged)) ||
        (filter === "exceptions" &&
          (["cancelled", "blocked", "review"].includes(r.status) ||
            r.contextChanged))),
  );
  const pageCount = Math.max(1, Math.ceil((shown?.length ?? 0) / 100));
  const page = Math.min(pageNumber, pageCount);
  const offset = (page - 1) * 100;
  return (
    <section className="card padded source-reconciliation">
      <h2>Đối soát theo file nguồn PDF</h2>
      <p>
        So từng mã trong file với trạng thái hiện tại. Không cộng tổng các file
        vì chúng có thể chứa cùng một mã. Nguồn đã lưu được giữ nguyên, kể cả
        đơn hủy/chặn.
      </p>
      <div className="inline wrap source-lifecycle-toolbar">
        <label className="field">
          Hiển thị nguồn
          <select
            value={scope}
            disabled={busy}
            onChange={(e) => {
              setScope(e.target.value);
              setSelected("");
              setPageNumber(1);
              setFilter("all");
              setSearch("");
            }}
          >
            <option value="active">Nguồn đang dùng</option>
            <option value="archived">Nguồn đã loại bỏ</option>
          </select>
        </label>
      </div>
      <ErrorBox message={listError || error} />
      {listLoading ? (
        <Loading />
      ) : !sources?.length ? (
        <Empty
          text={
            scope === "archived"
              ? "Chưa có nguồn đã loại bỏ."
              : "Chưa có nguồn đang dùng. Chọn Nguồn đã loại bỏ để khôi phục hoặc vào Nhập dữ liệu để lưu file mới."
          }
        />
      ) : (
        <>
          <label className="field">
            Danh sách nguồn
            <select
              value={id}
              onChange={(e) => {
                setSelected(e.target.value);
                setPageNumber(1);
                setFilter("all");
                setSearch("");
              }}
            >
              {sources.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.filename} · {s.expected} kiện / {s.orders} đơn ·{" "}
                  {s.channel} · {s.carrier} · {s.shop} ·{" "}
                  {formatTime(s.created_at)}
                </option>
              ))}
            </select>
          </label>
          {loading && !data ? (
            <Loading />
          ) : (
            data &&
            data.manifest.id === id && (
              <>
                <div className="inline wrap source-lifecycle-actions">
                  <button
                    className="secondary"
                    disabled={busy}
                    onClick={() => {
                      setPending({
                        id: data.manifest.id,
                        filename: data.manifest.filename,
                        archived: !!data.manifest.archived_at,
                      });
                      setReason("");
                      setActionError("");
                    }}
                  >
                    {data.manifest.archived_at ? (
                      <>
                        <RotateCcw size={16} /> Khôi phục nguồn
                      </>
                    ) : (
                      <>
                        <Trash2 size={16} /> Loại bỏ nguồn
                      </>
                    )}
                  </button>
                </div>
                {data.manifest.archived_at && (
                  <div className="notice warning source-lifecycle-notice">
                    <strong>Nguồn đã loại bỏ.</strong>{" "}
                    {formatTime(data.manifest.archived_at)} ·{" "}
                    {data.manifest.archived_by_name} · Lý do:{" "}
                    {data.manifest.archive_reason}. Chỉ xem lịch sử; nguồn không
                    nằm trong danh sách đang dùng.
                  </div>
                )}
                <p>
                  {data.manifest.warehouse} · {data.manifest.channel} ·{" "}
                  {data.manifest.carrier} · {data.manifest.shop} · Ngày dự kiến:{" "}
                  {data.manifest.due_date} · {data.manifest.page_count} trang,{" "}
                  {data.manifest.duplicate_pages} trang tem trùng,{" "}
                  {data.manifest.continuation_pages} trang sản phẩm tiếp theo.
                </p>
                <div
                  className="source-counts"
                  aria-label="Số liệu đối soát nguồn"
                >
                  {[
                    ["Nguồn phải xuất", totals.expected],
                    ["Đơn hàng", totals.orders],
                    ["Đã quét", totals.scanned],
                    ["Chưa quét", totals.unscanned],
                    ["Đã bàn giao", totals.handed],
                    ["Chưa bàn giao", totals.notHanded],
                    ["Ngoại lệ / sai kho, hãng", totals.exceptions],
                  ].map(([label, n]) => (
                    <div key={label}>
                      <strong>{n}</strong>
                      <span>{label}</span>
                    </div>
                  ))}
                </div>
                <div
                  className={"notice " + (totals.complete ? "" : "warning")}
                  role="status"
                >
                  <strong>
                    {data.manifest.archived_at
                      ? "Nguồn đã loại bỏ — không xác nhận xuất đủ từ nguồn này."
                      : totals.complete
                        ? "Đã bàn giao đủ theo nguồn."
                        : totals.scanComplete
                          ? "Đã quét đủ, chưa bàn giao đủ."
                          : "Chưa đủ điều kiện xác nhận xuất đủ."}
                  </strong>{" "}
                  Còn {totals.unscanned} mã chưa quét, {totals.notHanded} mã
                  chưa bàn giao và {totals.exceptions} mã cần kiểm tra. Ngoại lệ
                  có thể nằm trong các nhóm chưa quét/chưa bàn giao.
                </div>
                {(totals.scannedBeforeImport > 0 ||
                  totals.handedBeforeImport > 0) && (
                  <div className="notice">
                    Trước khi nhập file đã có {totals.scannedBeforeImport} mã
                    được quét, {totals.handedBeforeImport} mã bàn giao. Các số
                    này được tính vào trạng thái hiện tại, không phải lượt xuất
                    mới.
                  </div>
                )}
                <div className="inline wrap source-report-filters">
                  <label className="field">
                    Lọc đối soát nguồn
                    <select
                      value={filter}
                      onChange={(e) => {
                        setPageNumber(1);
                        setFilter(e.target.value);
                      }}
                    >
                      <option value="all">Tất cả mã nguồn</option>
                      <option value="unscanned">Còn thiếu quét</option>
                      <option value="notHanded">Chưa bàn giao đủ</option>
                      <option value="exceptions">
                        Ngoại lệ / sai kho, hãng
                      </option>
                    </select>
                  </label>
                  <label className="field">
                    Tìm mã trong nguồn
                    <input
                      value={search}
                      onChange={(e) => {
                        setPageNumber(1);
                        setSearch(e.target.value);
                      }}
                      placeholder="Mã vận đơn / mã đơn"
                    />
                  </label>
                  <a
                    className="secondary"
                    href={`/api/sources/${id}?format=xlsx`}
                  >
                    Xuất đối soát Excel
                  </a>
                  <a
                    className="secondary"
                    href={`/api/sources/${id}?format=csv`}
                  >
                    Xuất đối soát CSV
                  </a>
                </div>
                <p>
                  Hiển thị {shown.length ? offset + 1 : 0}–
                  {Math.min(offset + 100, shown.length)} / {shown.length} mã phù
                  hợp (tổng nguồn {totals.expected}). File xuất chứa toàn bộ
                  danh sách nguồn và trạng thái, không áp dụng lọc tìm kiếm trên
                  màn hình.
                </p>
                {pageCount > 1 && (
                  <div className="inline wrap source-pagination">
                    <button
                      className="secondary"
                      disabled={page <= 1}
                      onClick={() => setPageNumber(page - 1)}
                    >
                      Trang trước
                    </button>
                    <span>
                      Trang {page}/{pageCount}
                    </span>
                    <button
                      className="secondary"
                      disabled={page >= pageCount}
                      onClick={() => setPageNumber(page + 1)}
                    >
                      Trang sau
                    </button>
                  </div>
                )}
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>VẬN ĐƠN / MÃ ĐƠN</th>
                        <th>TRANG PDF</th>
                        <th>TRẠNG THÁI</th>
                        <th>QUÉT / BÀN GIAO</th>
                        <th>KHO / HÃNG HIỆN TẠI</th>
                      </tr>
                    </thead>
                    <tbody>
                      {shown.slice(offset, offset + 100).map((r: Row) => (
                        <tr key={r.shipment_id}>
                          <td>
                            <strong>{r.tracking_code}</strong>
                            <small>{r.external_id}</small>
                          </td>
                          <td>{r.pages.join(", ")}</td>
                          <td>
                            <Badge status={r.status} />
                            {r.contextChanged && (
                              <small className="red-text">
                                Khác kho/hãng nguồn
                              </small>
                            )}
                          </td>
                          <td>
                            <small>Quét: {formatTime(r.scanned_at)}</small>
                            <small>Bàn giao: {formatTime(r.handed_at)}</small>
                          </td>
                          <td>
                            {r.warehouse}
                            <small>{r.carrier}</small>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )
          )}
        </>
      )}
      {pending && (
        <Modal
          title={pending.archived ? "Khôi phục nguồn PDF" : "Loại bỏ nguồn PDF"}
          onClose={() => {
            if (!busy) setPending(null);
          }}
        >
          <p>
            File: <strong>{pending.filename}</strong>
          </p>
          <p>
            {pending.archived
              ? "Khôi phục file vào danh sách nguồn đang dùng với các mã và lịch sử hiện có."
              : "Gỡ file khỏi danh sách nguồn đang dùng. Có thể khôi phục tại Nguồn đã loại bỏ. Thao tác này không xóa vận đơn, lượt quét hay phiếu bàn giao; số liệu Tổng quan/Danh sách vận đơn vẫn giữ nguyên."}
          </p>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              if (busy) return;
              setBusy(true);
              setActionError("");
              try {
                await post(
                  pending.archived ? "sources/restore" : "sources/archive",
                  { id: pending.id, reason },
                );
                await reloadSources();
                setSelected("");
                setPageNumber(1);
                setFilter("all");
                setSearch("");
                setPending(null);
                refresh();
                toast(
                  pending.archived
                    ? "Đã khôi phục nguồn"
                    : "Đã loại bỏ nguồn khỏi danh sách đang dùng",
                );
              } catch (e) {
                setActionError((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            <label className="field">
              Lý do {pending.archived ? "khôi phục" : "loại bỏ"}
              <textarea
                required
                minLength={8}
                maxLength={1000}
                disabled={busy}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
            </label>
            <ErrorBox message={actionError} />
            <div className="inline wrap">
              <button
                type="button"
                className="secondary"
                disabled={busy}
                onClick={() => setPending(null)}
              >
                Hủy
              </button>
              <button
                className="primary"
                disabled={busy || reason.trim().length < 8}
              >
                {busy
                  ? "Đang xử lý…"
                  : pending.archived
                    ? "Xác nhận khôi phục"
                    : "Xác nhận loại bỏ"}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </section>
  );
}
