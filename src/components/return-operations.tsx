import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  PieChart,
  Pie,
  Cell,
} from "recharts";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Copy, RefreshCw, Upload, Download } from "lucide-react";
import type { User } from "../lib/db";
import {
  visibleReturnTabs,
  type ReturnTab,
  returnInspection,
  reasonGroups,
} from "../lib/return-domain";
import {
  returnIntakeKinds,
  intakeFields,
  type ReturnIntakeKind,
} from "../lib/return-intake-fields";
import { operationStates, operationKpis } from "../lib/return-operation-labels";
import { formatTime } from "../lib/domain";
import { MetricHelp } from "./metric-help";
import { ReturnAnalysis, ReturnImportUpdates } from "./return-analysis";
import { ReturnScanner, ReturnCase } from "./returns";
import {
  useData,
  post,
  refresh,
  toast,
  ErrorBox,
  Loading,
  Empty,
  OptionList,
  Modal,
  type Row,
} from "./shared";
import {
  readReturnIntake,
  saveReturnIntake,
  downloadReturnIntakeErrors,
} from "./return-intake-client";
import { FilePicker } from "./import-ui";
const n = (v: unknown) => Number(v ?? 0).toLocaleString("vi-VN");
const vnd = (v: unknown) =>
  v === null || v === undefined
    ? "Chưa đủ dữ liệu"
    : new Intl.NumberFormat("vi-VN").format(BigInt(String(v).split(".")[0])) +
      " ₫";
const stateLabel = (key: string) => operationStates[key] ?? "Cần xác minh";
function CopyId({ value }: { value: string }) {
  return (
    <span className="inline">
      <span className="mono">{value || "—"}</span>
      {value && (
        <button
          className="icon-button"
          title="Sao chép mã"
          aria-label={"Sao chép " + value}
          onClick={() =>
            void navigator.clipboard
              .writeText(value)
              .then(() => toast("Đã sao chép mã"))
              .catch(() =>
                toast("Chưa sao chép được; hãy chọn mã và sao chép", true),
              )
          }
        >
          <Copy size={14} />
        </button>
      )}
    </span>
  );
}
export function ReturnOperationsModule({
  refs,
  user,
  tab,
  onTabChange,
}: {
  refs: Row;
  user: User;
  tab: ReturnTab;
  onTabChange: (tab: ReturnTab) => void;
}) {
  const aliases: Record<string, string> = {
    list: "reconciliation",
    history: "reconciliation",
    import: "refunds",
    claims: "inspection",
    analytics: "reports",
  };
  const active = aliases[tab] ?? tab;
  const manager = user.role !== "staff";
  const [filters, setFilters] = useState<Row>({
    from: "",
    to: "",
    dateType: "requested",
    workflow: "",
    q: "",
    warehouse: "",
    carrier: "",
    state: "",
    employee: "",
    claim: "",
    page: 1,
    sort: "date",
  });
  const [selected, setSelected] = useState(""),
    [showImporter, setShowImporter] = useState(false),
    [showReceipts, setShowReceipts] = useState(active === "reconciliation"),
    [receipt, setReceipt] = useState<Row | null>(null),
    [receiptState, setReceiptState] = useState(""),
    [analysisOpen, setAnalysisOpen] = useState(false);
  const [reconciling, setReconciling] = useState(false),
    [reconcileProgress, setReconcileProgress] = useState("");
  const effective = {
    ...filters,
    ...(active === "delivery"
      ? { workflow: "delivery_failed" }
      : active === "refunds"
        ? { workflow: "customer_return" }
        : {}),
    ...(["unreceived", "reports"].includes(active)
      ? { state: "needs_check" }
      : {}),
  };
  const query = new URLSearchParams(
    Object.fromEntries(
      Object.entries(effective)
        .filter(([, v]) => v !== "" && v !== undefined)
        .map(([k, v]) => [k, String(v)]),
    ),
  ).toString();
  const listActive = [
    "delivery",
    "refunds",
    "reconciliation",
    "unreceived",
    "inspection",
    "reports",
  ].includes(active);
  const list = useData<Row>(
    listActive ? "returns/operations/cases?" + query : null,
    15000,
  );
  const overview = useData<Row>(
    active === "dashboard" ? "returns/operations/overview?" + query : null,
    15000,
  );
  const receiptMode = active === "reconciliation" && showReceipts;
  const receiptList = useData<Row>(
    receiptMode
      ? "returns/operations/receipts?" +
          new URLSearchParams(
            Object.fromEntries(
              Object.entries({
                ...filters,
                state: receiptState,
                dateType: "received",
              })
                .filter(([, v]) => v !== "" && v !== undefined)
                .map(([k, v]) => [k, String(v)]),
            ),
          ).toString()
      : null,
    15000,
  );
  const events = useData<Row>(
    active === "scan" ? "returns/events/mine" : null,
    5000,
  );
  const history = useData<Row>(
    active === "updates"
      ? "returns/operations/imports?page=" + filters.page
      : null,
    10000,
  );
  const change = (key: string, value: unknown) =>
    setFilters((f) => ({
      ...f,
      [key]: value,
      ...(key !== "page" ? { page: 1 } : {}),
    }));
  useEffect(() => {
    setFilters((f) => ({ ...f, page: 1 }));
    setShowImporter(false);
  }, [active]);
  const tabs = visibleReturnTabs(user.role, true);
  return (
    <div className="return-module return-operations">
      <div
        className="tabs return-tabs"
        role="tablist"
        aria-label="Quản lý và Đối soát hàng hoàn"
      >
        {tabs.map((t) => (
          <button
            key={t.key}
            role="tab"
            className={active === t.key ? "active" : ""}
            aria-selected={active === t.key}
            onClick={() => {
              change("state", "");
              onTabChange(t.key);
            }}
          >
            <strong>{t.label}</strong>
            <small>{t.description}</small>
          </button>
        ))}
      </div>
      <div className="card padded">
        <div className="inline wrap">
          <h2>
            {tabs.find((t) => t.key === active)?.label ??
              "Quản lý & Đối soát hàng hoàn"}
          </h2>
          {manager &&
            ["delivery", "refunds", "reconciliation"].includes(active) && (
              <button
                className="primary"
                onClick={() => setShowImporter((v) => !v)}
              >
                <Upload size={16} />
                {showImporter ? "Đóng nhập dữ liệu" : "Nhập dữ liệu"}
              </button>
            )}
          <button className="secondary small" onClick={() => refresh()}>
            <RefreshCw size={15} />
            Làm mới
          </button>
        </div>
        <p className="muted">
          Đơn về quan trọng hơn đơn đi – Đơn hoàn là tài sản của chúng ta.
        </p>
        {filters.reason && (
          <p className="notice">
            Đang lọc lý do: {reasonGroups[filters.reason] ?? filters.reason}{" "}
            <button
              className="secondary small"
              onClick={() => change("reason", "")}
            >
              Bỏ lọc lý do
            </button>
          </p>
        )}
        {active !== "scan" && active !== "updates" && (
          <div className="form-grid">
            <label className="field">
              Tìm mã đơn / mã vận đơn
              <input
                value={filters.q}
                onChange={(e) => change("q", e.target.value)}
                placeholder="Dán nguyên mã, giữ cả số 0 đầu"
              />
            </label>
            <label className="field">
              Nghiệp vụ
              <select
                value={effective.workflow}
                disabled={active === "delivery" || active === "refunds"}
                onChange={(e) => change("workflow", e.target.value)}
              >
                <option value="">Cả hai nghiệp vụ</option>
                <option value="delivery_failed">Đơn giao thất bại</option>
                <option value="customer_return">Trả hàng – Hoàn tiền</option>
              </select>
            </label>
            <label className="field">
              Đơn vị vận chuyển
              <select
                value={filters.carrier}
                onChange={(e) => change("carrier", e.target.value)}
              >
                <option value="">Tất cả đơn vị</option>
                <OptionList rows={refs.carriers} />
                <option value="unknown">Chưa xác định</option>
                <option value="no_tracking">Chưa có mã vận đơn</option>
                <option value="mixed">Nhiều hãng / cần xác minh</option>
              </select>
            </label>
            <label className="field">
              Kho
              <select
                value={filters.warehouse}
                onChange={(e) => change("warehouse", e.target.value)}
              >
                <option value="">Tất cả kho</option>
                <OptionList rows={refs.warehouses} />
              </select>
            </label>
            <label className="field">
              Loại ngày
              <select
                value={receiptMode ? "received" : filters.dateType}
                disabled={receiptMode}
                onChange={(e) => change("dateType", e.target.value)}
              >
                <option value="requested">Ngày phát sinh hoàn</option>
                <option value="ordered">Ngày tạo đơn</option>
                <option value="cancelled">Ngày hủy</option>
                <option value="received">Ngày nhận thực tế</option>
                <option value="imported">Ngày nhập dữ liệu</option>
              </select>
            </label>
            <label className="field">
              Từ ngày
              <input
                type="date"
                value={filters.from}
                onChange={(e) => change("from", e.target.value)}
              />
            </label>
            <label className="field">
              Đến ngày
              <input
                type="date"
                value={filters.to}
                onChange={(e) => change("to", e.target.value)}
              />
            </label>
            {!receiptMode && (
              <label className="field">
                Trạng thái nhận / tra soát
                <select
                  value={effective.state}
                  disabled={["unreceived", "reports"].includes(active)}
                  onChange={(e) => change("state", e.target.value)}
                >
                  <option value="">Tất cả trạng thái</option>
                  {Object.entries(operationStates).map(([key, label]) => (
                    <option key={key} value={key}>
                      {label}
                    </option>
                  ))}
                  <option value="received_full">Đã nhận đủ số lượng</option>
                  <option value="received_short">Nhận thiếu số lượng</option>
                  <option value="goods_problem">Có vấn đề hàng hóa</option>
                  <option value="refund_only">Chỉ hoàn tiền</option>
                  <option value="refund_missing">
                    Đã hoàn tiền, hàng chưa về
                  </option>
                  <option value="overdue">Quá hạn cần kiểm tra</option>
                  <option value="required">Cần nhận hàng</option>
                  <option value="cancelled">Đơn sàn đã hủy</option>
                  <option value="claims">Đang khiếu nại</option>
                  <option value="compensation">
                    Có tiền bồi thường thực nhận
                  </option>
                  {String(effective.state).startsWith("primary:") && (
                    <option value={effective.state}>
                      {stateLabel(String(effective.state).slice(8))} · nhóm
                      riêng
                    </option>
                  )}
                </select>
              </label>
            )}
            {receiptMode && (
              <label className="field">
                Trạng thái sổ nhận
                <select
                  value={receiptState}
                  onChange={(e) => {
                    setReceiptState(e.target.value);
                    change("page", 1);
                  }}
                >
                  <option value="">Tất cả bản ghi</option>
                  <option value="matched">Đã ghép</option>
                  <option value="unmatched">Chưa có nguồn</option>
                  <option value="ambiguous">Cần xác minh</option>
                  <option value="conflict">Đã rút bằng chứng / xung đột</option>
                </select>
              </label>
            )}
            <label className="field">
              Nhân viên nhận
              <select
                value={filters.employee}
                onChange={(e) => change("employee", e.target.value)}
              >
                <option value="">Tất cả nhân viên</option>
                <OptionList rows={refs.users ?? []} />
              </select>
            </label>
            <label className="field">
              Khiếu nại
              <select
                value={filters.claim}
                onChange={(e) => change("claim", e.target.value)}
              >
                <option value="">Tất cả hồ sơ</option>
                <option value="open">Còn cần xử lý</option>
                <option value="resolved">Đã xử lý</option>
              </select>
            </label>
          </div>
        )}
      </div>
      {showImporter && (
        <ReturnOperationImporter
          refs={refs}
          defaultKind={
            active === "delivery"
              ? "delivery_failed"
              : active === "refunds"
                ? "customer_return"
                : "warehouse_receipt"
          }
        />
      )}
      {active === "scan" && (
        <ReturnScanner
          refs={refs}
          user={user}
          events={events.data?.events ?? []}
          onOpen={setSelected}
        />
      )}
      {active === "dashboard" && (
        <>
          <ErrorBox message={overview.error} />
          {!overview.data ? (
            <Loading />
          ) : (
            <OperationOverview
              data={overview.data}
              onFilter={(state, carrier) => {
                setFilters((f) => ({
                  ...f,
                  state,
                  carrier: carrier ?? "",
                  page: 1,
                }));
                onTabChange("reconciliation");
              }}
            />
          )}
        </>
      )}
      {active === "reconciliation" && (
        <section className="card padded">
          <div className="inline wrap">
            <button
              className={!showReceipts ? "primary small" : "secondary small"}
              onClick={() => setShowReceipts(false)}
            >
              Hồ sơ từ sàn
            </button>
            <button
              className={showReceipts ? "primary small" : "secondary small"}
              onClick={() => setShowReceipts(true)}
            >
              Sổ nhận thực tế / Chưa ghép
            </button>
            {manager && (
              <button
                className="secondary small"
                disabled={reconciling}
                onClick={async () => {
                  setReconciling(true);
                  let cursor: string | undefined,
                    matched = 0,
                    checked = 0;
                  try {
                    for (;;) {
                      const step = await post("returns/operations/reconcile", {
                        cursor,
                      });
                      matched += step.matched;
                      checked += step.checked;
                      setReconcileProgress(
                        `Đã đối chiếu ${n(checked)} bản ghi · ghép ${n(matched)} bản ghi chắc chắn`,
                      );
                      if (!step.more) break;
                      cursor = step.cursor;
                    }
                    refresh();
                  } catch (e) {
                    toast((e as Error).message, true);
                  } finally {
                    setReconciling(false);
                  }
                }}
              >
                {reconciling ? "Đang đối soát…" : "Đối soát lại mã chính xác"}
              </button>
            )}
          </div>
          <p>
            {reconcileProgress && (
              <span className="block" role="status">
                {reconcileProgress}
              </span>
            )}
            Mã đã tít trước nguồn được giữ ở sổ nhận. Nhiều hồ sơ hoặc dữ liệu
            lệch phải xác minh, không tự gộp.
          </p>
        </section>
      )}
      {listActive && !(active === "reconciliation" && showReceipts) && (
        <>
          <ErrorBox message={list.error} />
          {!list.data ? (
            <Loading />
          ) : (
            <OperationCaseTable
              rows={list.data.rows}
              users={refs.users ?? []}
              manager={manager}
              total={list.data.total}
              page={filters.page}
              onPage={(p) => change("page", p)}
              onOpen={setSelected}
              onSort={(sort) => change("sort", sort)}
            />
          )}
        </>
      )}
      {active === "reconciliation" && showReceipts && (
        <>
          <ErrorBox message={receiptList.error} />
          {!receiptList.data ? (
            <Loading />
          ) : (
            <section className="card">
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>MÃ VẬN ĐƠN / ĐƠN HÀNG</th>
                      <th>NGÀY NHẬN</th>
                      <th>NGƯỜI NHẬN / NGƯỜI GIAO</th>
                      <th>NGUỒN</th>
                      <th>ĐỐI SOÁT</th>
                    </tr>
                  </thead>
                  <tbody>
                    {receiptList.data.rows.map((r: Row) => (
                      <tr key={r.id}>
                        <td>
                          <CopyId value={r.tracking_code || r.order_code} />
                        </td>
                        <td>{formatTime(r.received_at)}</td>
                        <td>
                          {r.employee_source || r.employee}
                          <small>{r.courier_name}</small>
                        </td>
                        <td>
                          {r.source === "scan"
                            ? "Tít nhận"
                            : r.source === "warehouse_file"
                              ? "Tệp kho / SaleWork"
                              : "Lịch sử cũ"}
                        </td>
                        <td>
                          {r.match_state === "matched" ? (
                            <button
                              className="text-button"
                              onClick={() => setSelected(r.case_id)}
                            >
                              {r.source_archived
                                ? "Nguồn đã loại bỏ · Xem bằng chứng"
                                : "Đã ghép – Xem hồ sơ"}
                            </button>
                          ) : (
                            <>
                              <span>
                                {!r.source_active
                                  ? "Bằng chứng từ file đã loại bỏ"
                                  : r.match_state === "unmatched"
                                    ? "Chưa xác định đơn hàng"
                                    : "Cần xác minh dữ liệu"}
                              </span>
                              {r.case_id && (
                                <button
                                  className="text-button"
                                  onClick={() => setSelected(r.case_id)}
                                >
                                  Xem lịch sử hồ sơ
                                </button>
                              )}
                              {manager && r.source_active && (
                                <button
                                  className="secondary small"
                                  onClick={() => setReceipt(r)}
                                >
                                  Ghép dữ liệu
                                </button>
                              )}
                            </>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <PageControls
                total={receiptList.data.total}
                page={filters.page}
                onPage={(p) => change("page", p)}
              />
            </section>
          )}
        </>
      )}
      {active === "updates" && (
        <>
          <details className="card padded">
            <summary>Nhật ký nguồn chi tiết / dữ liệu trước nâng cấp</summary>
            <ReturnImportUpdates />
          </details>
          <ErrorBox message={history.error} />
          {!history.data ? (
            <Loading />
          ) : (
            <OperationImportHistory
              data={history.data}
              admin={user.role === "admin"}
              onPage={(p) => change("page", p)}
            />
          )}
        </>
      )}
      {active === "reports" && (
        <>
          <OperationReportPanel filters={effective} />
          <section className="card padded">
            <h3>Tỷ lệ hoàn theo sản phẩm / SKU và nguồn bán thành công</h3>
            <p>
              Tỷ lệ cần mẫu số bán thực, liên kết đúng đơn bán và SKU. Nếu thiếu
              nguồn, hệ thống hiển thị chưa đủ dữ liệu. Phân tích này giữ dữ
              liệu bán và cấu hình phân bổ cũ; nhập nguồn bán bổ sung vẫn dùng
              tác vụ nền như trước.
            </p>
            <button
              className="secondary small"
              onClick={() => setAnalysisOpen((v) => !v)}
            >
              {analysisOpen
                ? "Đóng phân tích SKU"
                : "Mở phân tích SKU và nguồn bán"}
            </button>
          </section>
          {analysisOpen && (
            <ReturnAnalysis
              refs={refs}
              user={user}
              onReason={(reason, scope) => {
                setFilters((f) => ({
                  ...f,
                  from: scope.from ?? "",
                  to: scope.to ?? "",
                  channel: scope.channel ?? "",
                  shop: scope.shop ?? "",
                  reason,
                  state: "",
                  page: 1,
                }));
                setShowReceipts(false);
                onTabChange("reconciliation");
              }}
            />
          )}
        </>
      )}
      {selected && (
        <ReturnCase
          id={selected}
          refs={refs}
          user={user}
          onClose={() => setSelected("")}
        />
      )}
      {receipt && (
        <ReceiptLinkModal receipt={receipt} onClose={() => setReceipt(null)} />
      )}
    </div>
  );
}
function PageControls({
  total,
  page,
  onPage,
}: {
  total: number;
  page: number;
  onPage: (p: number) => void;
}) {
  return (
    <div className="pagination">
      <span>
        {n(total)} hồ sơ · Trang {page}/{Math.max(1, Math.ceil(total / 50))}
      </span>
      <button
        className="secondary small"
        disabled={page <= 1}
        onClick={() => onPage(page - 1)}
      >
        Trước
      </button>
      <button
        className="secondary small"
        disabled={page * 50 >= total}
        onClick={() => onPage(page + 1)}
      >
        Sau
      </button>
    </div>
  );
}
function OperationCaseTable({
  rows,
  users,
  manager,
  total,
  page,
  onPage,
  onOpen,
  onSort,
}: {
  rows: Row[];
  users: Row[];
  manager: boolean;
  total: number;
  page: number;
  onPage: (p: number) => void;
  onOpen: (id: string) => void;
  onSort: (sort: string) => void;
}) {
  const [hidden, setHidden] = useState<string[]>([]),
    [selected, setSelected] = useState<string[]>([]);
  const [assignee, setAssignee] = useState(""),
    [reason, setReason] = useState(""),
    [assigning, setAssigning] = useState(false),
    [assignError, setAssignError] = useState("");
  useEffect(() => setSelected([]), [page]);
  return (
    <section className="card">
      <div className="card-heading">
        <strong>{n(total)} hồ sơ trong bộ lọc</strong>
        <label className="field">
          Sắp xếp
          <select onChange={(e) => onSort(e.target.value)}>
            <option value="date">Ngày phát sinh</option>
            <option value="carrier">Đơn vị vận chuyển</option>
            <option value="value">Giá trị hàng</option>
            <option value="overdue">Hạn hoàn</option>
          </select>
        </label>
        <details>
          <summary>Ẩn / hiện cột</summary>
          {["sku", "value", "inspection"].map((k) => (
            <label key={k}>
              <input
                type="checkbox"
                checked={!hidden.includes(k)}
                onChange={() =>
                  setHidden((v) =>
                    v.includes(k) ? v.filter((x) => x !== k) : [...v, k],
                  )
                }
              />
              {
                { sku: "Số lượng", value: "Giá trị", inspection: "Kiểm hàng" }[
                  k
                ]
              }
            </label>
          ))}
        </details>
      </div>
      {selected.length > 0 && (
        <div className="notice">
          <button
            className="secondary small"
            onClick={() =>
              void navigator.clipboard
                .writeText(
                  rows
                    .filter((r) => selected.includes(r.id))
                    .map((r) => r.tracking_codes || r.order_code)
                    .join("\n"),
                )
                .then(() => toast("Đã sao chép các mã được chọn"))
            }
          >
            Sao chép {selected.length} mã đã chọn
          </button>
        </div>
      )}
      {manager && selected.length > 0 && (
        <div className="notice">
          <div className="form-grid">
            <label className="field">
              Phân công các hồ sơ đã chọn
              <select
                value={assignee}
                onChange={(e) => setAssignee(e.target.value)}
              >
                <option value="">Bỏ phân công</option>
                <OptionList rows={users} />
              </select>
            </label>
            <label className="field">
              Lý do phân công
              <input
                value={reason}
                maxLength={2000}
                onChange={(e) => setReason(e.target.value)}
              />
            </label>
          </div>
          <button
            className="secondary small"
            disabled={assigning || reason.trim().length < 8}
            onClick={async () => {
              setAssigning(true);
              setAssignError("");
              try {
                const items = rows
                  .filter((r) => selected.includes(r.id))
                  .map((r) => ({ id: r.id, version: r.version }));
                await post("returns/operations/assign", {
                  items,
                  assignedTo: assignee || null,
                  reason,
                });
                setSelected([]);
                refresh();
                toast("Đã phân công các hồ sơ được chọn");
              } catch (e) {
                setAssignError((e as Error).message);
              } finally {
                setAssigning(false);
              }
            }}
          >
            Lưu phân công {selected.length} hồ sơ
          </button>
          <ErrorBox message={assignError} />
        </div>
      )}
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>
                <input
                  type="checkbox"
                  aria-label="Chọn tất cả hồ sơ trên trang"
                  checked={
                    rows.length > 0 &&
                    rows.every((r) => selected.includes(r.id))
                  }
                  onChange={(e) =>
                    setSelected(e.target.checked ? rows.map((r) => r.id) : [])
                  }
                />
              </th>
              <th>MÃ ĐƠN / YÊU CẦU</th>
              <th>MÃ VẬN ĐƠN</th>
              <th>ĐƠN VỊ VẬN CHUYỂN</th>
              <th>NHẬN KHO / VẬN CHUYỂN</th>
              {!hidden.includes("sku") && <th>SỐ LƯỢNG</th>}
              {!hidden.includes("inspection") && <th>KIỂM HÀNG</th>}
              {!hidden.includes("value") && <th>GIÁ TRỊ HÀNG</th>}
              <th>XỬ LÝ</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td>
                  <input
                    type="checkbox"
                    aria-label={"Chọn " + r.order_code}
                    checked={selected.includes(r.id)}
                    onChange={(e) =>
                      setSelected((v) =>
                        e.target.checked
                          ? [...v, r.id]
                          : v.filter((x) => x !== r.id),
                      )
                    }
                  />
                </td>
                <td>
                  <CopyId value={r.order_code} />
                  {r.workflow === "customer_return" && (
                    <small>
                      <CopyId value={r.external_id} />
                    </small>
                  )}
                </td>
                <td>
                  <CopyId value={r.tracking_codes} />
                </td>
                <td>{r.carrier}</td>
                <td>
                  <span
                    className={"badge " + (r.has_receipt ? "green" : "orange")}
                  >
                    {stateLabel(r.primary_state)}
                  </span>
                  {r.has_receipt && (
                    <small>
                      Đã ghi nhận thực tế · {r.received_parcels}/{r.parcels}{" "}
                      kiện có mã
                    </small>
                  )}
                </td>
                {!hidden.includes("sku") && (
                  <td>
                    {r.quantity_known ? r.received_quantity : "Chưa kiểm đếm"}/
                    {r.expected_quantity}
                    <small>thực nhận / cần nhận</small>
                  </td>
                )}
                {!hidden.includes("inspection") && (
                  <td>
                    {r.inspection_partial
                      ? "Đã kiểm một phần"
                      : r.inspection_stale
                        ? "Cần kiểm lại"
                        : returnInspection[r.inspection_status]}
                  </td>
                )}
                {!hidden.includes("value") && <td>{vnd(r.goods_value)}</td>}
                <td>
                  <button
                    className="secondary small"
                    onClick={() => onOpen(r.id)}
                  >
                    Xem / Xử lý
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!rows.length && <Empty />}
      <PageControls total={total} page={page} onPage={onPage} />
    </section>
  );
}
function OperationOverview({
  data,
  onFilter,
}: {
  data: Row;
  onFilter: (state: string, carrier?: string) => void;
}) {
  const t = data.totals;
  return (
    <>
      <div className="kpi-grid">
        {operationKpis.map(([key, label, state, help]) => (
          <section className="kpi-card kpi" key={key} data-kpi={key}>
            <div className="inline">
              <span>{label}</span>
              <MetricHelp label={label}>{help}</MetricHelp>
            </div>
            <button
              className="text-button big-number"
              onClick={() => onFilter(state)}
            >
              {["check_value", "problem_value", "compensation"].includes(key)
                ? vnd(t[key])
                : n(t[key])}
            </button>
            {(key === "check_value" || key === "problem_value") &&
              (key === "check_value"
                ? t.unknown_check_value
                : t.unknown_problem_value) > 0 && (
                <small>
                  Còn{" "}
                  {n(
                    key === "check_value"
                      ? t.unknown_check_value
                      : t.unknown_problem_value,
                  )}{" "}
                  hồ sơ chưa đủ giá trị nguồn
                </small>
              )}
          </section>
        ))}
      </div>
      <details className="card padded return-operation-secondary">
        <summary>Chỉ tiêu chi tiết · cần nhận, đủ/thiếu, quá hạn</summary>
        <div className="kpi-grid">
          {(
            [
              ["required", "Cần nhận hàng", "required"],
              ["cancelled", "Đơn sàn đã hủy", "cancelled"],
              ["received_full", "Đã nhận đủ số lượng", "received_full"],
              ["received_short", "Đã nhận thiếu số lượng", "received_short"],
              ["not_required", "Không cần nhận hàng", "not_required"],
              [
                "refund_missing",
                "Đã hoàn tiền · hàng chưa về",
                "refund_missing",
              ],
              ["overdue", "Quá hạn dự kiến", "overdue"],
              ["verify", "Dữ liệu cần xác minh", "verify"],
            ] as const
          ).map(([key, label, state]) => (
            <section className="kpi-card kpi" key={key} data-kpi={key}>
              <span>
                {label}{" "}
                <MetricHelp label={label}>
                  {key === "cancelled"
                    ? "Đếm hồ sơ có trạng thái hủy từ nguồn; hủy không đồng nghĩa đã bàn giao."
                    : key === "received_full"
                      ? "Mọi SKU có số lượng thực nhận bằng nguồn, các kiện đã nhận; chưa thay thế kiểm chất lượng."
                      : key === "overdue"
                        ? "Quá ngày dự kiến do quản lý đặt; không tự suy ra mất hàng."
                        : "Đếm yêu cầu duy nhất theo điều kiện ghi trên thẻ và bộ lọc hiện tại."}
                </MetricHelp>
              </span>
              <button
                className="text-button big-number"
                onClick={() => onFilter(state)}
              >
                {n(t[key])}
              </button>
            </section>
          ))}
        </div>
      </details>
      <p className="notice">
        Tiền hoàn cho khách từ nguồn: {vnd(t.refund_amount)} · Giá trị hàng có
        vấn đề: {vnd(t.problem_value)}. Hai giá trị phục vụ mục đích khác nhau
        và không được cộng thành tồn kho.
      </p>
      <ReturnOperationCharts data={data} />
      <div className="card padded">
        <h3>Theo đơn vị vận chuyển</h3>
        <p>
          Bấm hãng/số đơn để mở đúng tập hồ sơ và xử lý. Mỗi hồ sơ chỉ thuộc một
          nhóm hãng; nhiều hãng nằm trong nhóm cần xác minh.
        </p>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>ĐƠN VỊ</th>
                <th>PHẢI HOÀN</th>
                <th>ĐÃ NHẬN</th>
                <th>CẦN KIỂM TRA</th>
                <th>TRUNG CHUYỂN</th>
                <th>NGHI THẤT LẠC</th>
                <th>QUÁ HẠN</th>
                <th>KHIẾU NẠI</th>
                <th>GIÁ TRỊ CẦN KIỂM TRA</th>
              </tr>
            </thead>
            <tbody>
              {data.carriers.map((c: Row) => (
                <tr key={c.carrier_key}>
                  <td>
                    <button
                      className="text-button"
                      onClick={() => onFilter("", c.carrier_key)}
                    >
                      {c.carrier}
                    </button>
                  </td>
                  {[
                    "required",
                    "received",
                    "needs_check",
                    "in_transit",
                    "suspected_lost",
                    "overdue",
                    "claims",
                  ].map((k) => (
                    <td key={k}>
                      <button
                        className="text-button"
                        onClick={() => onFilter(k, c.carrier_key)}
                      >
                        {n(c[k])}
                      </button>
                    </td>
                  ))}
                  <td>{vnd(c.check_value)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!data.carriers.length && <Empty />}
      </div>
      <div className="dashboard-grid">
        <section className="card padded">
          <h3>Phát sinh hàng hoàn theo ngày</h3>
          {data.days.length ? (
            <div className="return-day-bars">
              {data.days.map((d: Row) => (
                <div key={d.day} className="inline">
                  <span>{d.day}</span>
                  <meter
                    min={0}
                    max={Math.max(1, ...data.days.map((x: Row) => x.total))}
                    value={d.total}
                  />
                  <b>{n(d.total)}</b>
                </div>
              ))}
            </div>
          ) : (
            <Empty />
          )}
        </section>
        <section className="card padded">
          <h3>Tình trạng đối soát</h3>
          <p>Các nhóm dưới loại trừ nhau, tổng bằng số hồ sơ trong bộ lọc.</p>
          {data.states.map((s: Row) => (
            <button
              key={s.primary_state}
              className="secondary small"
              onClick={() => onFilter("primary:" + s.primary_state)}
            >
              {stateLabel(s.primary_state)}: {n(s.total)}
            </button>
          ))}
        </section>
      </div>
      <section className="card padded">
        <h3>Vấn đề hàng hóa theo SKU</h3>
        <p>
          Tỷ lệ dưới đây là hồ sơ xác định lỗi hoặc thiếu tại SKU / hồ sơ hoàn
          của SKU trong bộ lọc, không phải tỷ lệ trên đơn bán. Lỗi chưa xác định
          SKU không tự quy cho mọi sản phẩm trong đơn. Phân tích tỷ lệ hoàn trên
          đơn bán cần dữ liệu bán thành công làm mẫu số.
        </p>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>SKU</th>
                <th>SẢN PHẨM</th>
                <th>HỒ SƠ HOÀN</th>
                <th>CÓ VẤN ĐỀ</th>
                <th>TỶ LỆ LỖI</th>
              </tr>
            </thead>
            <tbody>
              {data.products.map((p: Row) => (
                <tr key={p.sku}>
                  <td>{p.sku || "Chưa có SKU"}</td>
                  <td>{p.name}</td>
                  <td>{n(p.requests)}</td>
                  <td>{n(p.problems)}</td>
                  <td>
                    {p.requests
                      ? Math.round((p.problems / p.requests) * 100) + "%"
                      : "Chưa đủ dữ liệu"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <section className="card padded">
        <h3>Kết quả khiếu nại theo tháng</h3>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>THÁNG MỞ HỒ SƠ</th>
                <th>TRẠNG THÁI</th>
                <th>SỐ HỒ SƠ</th>
              </tr>
            </thead>
            <tbody>
              {data.claimMonths.map((c: Row) => (
                <tr key={c.month + c.status}>
                  <td>{c.month ?? "Chưa có ngày mở trong lịch sử"}</td>
                  <td>
                    {{
                      open: "Đang mở",
                      submitted: "Đã gửi",
                      won: "Đã chấp thuận",
                      lost: "Không được chấp thuận",
                      paid: "Đã nhận tiền",
                      closed: "Đã đóng",
                    }[c.status as string] ?? c.status}
                  </td>
                  <td>{n(c.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
function ReturnOperationCharts({ data }: { data: Row }) {
  const colors = [
    "#ff6b22",
    "#16a076",
    "#387ab7",
    "#bd6bcb",
    "#d4a625",
    "#737b8c",
    "#e04452",
    "#3dacae",
  ];
  const claimMonths = Object.values(
    (data.claimMonths as Row[]).reduce((all: Record<string, Row>, r) => {
      const month = r.month ?? "Chưa rõ ngày";
      all[month] ??= { month };
      all[month][r.status] = r.total;
      return all;
    }, {}),
  );
  const frame = (title: string, content: ReactNode, empty: boolean) => (
    <section className="card padded">
      <h3>{title}</h3>
      {empty ? (
        <Empty />
      ) : (
        <div style={{ height: 260, minWidth: 0 }}>{content}</div>
      )}
    </section>
  );
  const axes = (
    <>
      <CartesianGrid strokeDasharray="3 3" />
      <XAxis dataKey="carrier" hide />
      <YAxis allowDecimals={false} />
      <Tooltip />
      <Legend />
    </>
  );
  return (
    <div className="dashboard-grid">
      {frame(
        "Số hồ sơ hoàn theo ngày",
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data.days}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="day" />
            <YAxis allowDecimals={false} />
            <Tooltip />
            <Bar dataKey="total" name="Hồ sơ phát sinh" fill={colors[0]} />
          </BarChart>
        </ResponsiveContainer>,
        !data.days.length,
      )}
      {frame(
        "Tình trạng theo đơn vị vận chuyển",
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data.carriers}>
            {axes}
            <Bar
              dataKey="chart_received"
              name="Đã nhận"
              stackId="a"
              fill={colors[1]}
            />
            <Bar
              dataKey="needs_check"
              name="Cần kiểm tra"
              stackId="a"
              fill={colors[0]}
            />
            <Bar
              dataKey="in_transit"
              name="Trung chuyển"
              stackId="a"
              fill={colors[2]}
            />
            <Bar
              dataKey="chart_other"
              name="Trạng thái khác"
              stackId="a"
              fill={colors[5]}
            />
          </BarChart>
        </ResponsiveContainer>,
        !data.carriers.length,
      )}
      {frame(
        "Tỷ trọng các nhóm đối soát",
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={data.states.map((s: Row) => ({
                name: stateLabel(s.primary_state),
                value: s.total,
              }))}
              dataKey="value"
              nameKey="name"
              innerRadius={45}
              outerRadius={75}
            >
              {data.states.map((s: Row, i: number) => (
                <Cell key={s.primary_state} fill={colors[i % colors.length]} />
              ))}
            </Pie>
            <Tooltip />
            <Legend />
          </PieChart>
        </ResponsiveContainer>,
        !data.states.length,
      )}
      {frame(
        "Quá hạn dự kiến theo hãng",
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data.carriers}>
            {axes}
            <Bar
              dataKey="overdue"
              name="Quá hạn · cần xác minh"
              fill={colors[6]}
            />
          </BarChart>
        </ResponsiveContainer>,
        !data.carriers.length,
      )}
      {frame(
        "Tỷ lệ vấn đề đã xác định theo SKU (%)",
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={data.products.map((p: Row) => ({
              ...p,
              rate: p.requests
                ? Math.round((p.problems / p.requests) * 1000) / 10
                : 0,
            }))}
          >
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="sku" hide />
            <YAxis domain={[0, 100]} />
            <Tooltip />
            <Bar
              dataKey="rate"
              name="Tỷ lệ lỗi trên hồ sơ hoàn của SKU (%)"
              fill={colors[3]}
            />
          </BarChart>
        </ResponsiveContainer>,
        !data.products.length,
      )}
      {frame(
        "Kết quả khiếu nại theo tháng mở",
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={claimMonths}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="month" />
            <YAxis allowDecimals={false} />
            <Tooltip />
            <Legend />
            {Object.entries({
              open: "Đang mở",
              submitted: "Đã gửi",
              won: "Được chấp thuận",
              paid: "Đã nhận tiền",
              lost: "Bị từ chối",
              closed: "Đã đóng",
            }).map(([k, label], i) => (
              <Bar
                key={k}
                dataKey={k}
                name={label}
                stackId="a"
                fill={colors[i]}
              />
            ))}
          </BarChart>
        </ResponsiveContainer>,
        !claimMonths.length,
      )}
    </div>
  );
}
function ReturnOperationImporter({
  refs,
  defaultKind,
}: {
  refs: Row;
  defaultKind: ReturnIntakeKind;
}) {
  const [kind, setKind] = useState<ReturnIntakeKind>(defaultKind),
    [file, setFile] = useState<File | null>(null),
    [warehouse, setWarehouse] = useState(refs.warehouses[0]?.id ?? ""),
    [shop, setShop] = useState("ComsMiu"),
    [channel, setChannel] = useState("TikTok Shop"),
    [mapping, setMapping] = useState<Record<string, string>>({}),
    [preview, setPreview] = useState<Row | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [progress, setProgress] = useState("");
  const abort = useRef<AbortController | null>(null);
  useEffect(() => () => abort.current?.abort(), []);
  const invalidate = () => {
    setPreview(null);
    setError("");
    setProgress("");
  };
  async function run(commit = false) {
    if (!file || busy) return;
    setBusy(true);
    setError("");
    abort.current = new AbortController();
    try {
      if (commit) {
        const result = await saveReturnIntake(
          preview!.jobId,
          setProgress,
          abort.current.signal,
        );
        setPreview((p) => ({
          ...p!,
          completed: true,
          canCommit: false,
          batch: result.batch,
        }));
        refresh();
        toast("Đã xác nhận nhập dữ liệu");
      } else
        setPreview(
          await readReturnIntake(
            file,
            { kind, warehouseId: warehouse, shop, channel },
            mapping,
            setProgress,
            abort.current.signal,
          ),
        );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="card padded">
      <h3>Nhập dữ liệu & Đối chiếu trước khi lưu</h3>
      <p>
        Tệp gốc được lưu bảo mật. Nhập tối đa 50.000 dòng theo từng lô, có thể
        tiếp tục khi gián đoạn; chỉ xác nhận sau khi xem trước.
      </p>
      <div className="form-grid">
        <label className="field">
          Loại nguồn
          <select
            disabled={busy}
            value={kind}
            onChange={(e) => {
              setKind(e.target.value as ReturnIntakeKind);
              invalidate();
            }}
          >
            {Object.entries(returnIntakeKinds).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          Kho
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
          Shop
          <input
            disabled={busy}
            value={shop}
            onChange={(e) => {
              setShop(e.target.value);
              invalidate();
            }}
          />
        </label>
        <label className="field">
          Sàn
          <select
            disabled={busy}
            value={channel}
            onChange={(e) => {
              setChannel(e.target.value);
              invalidate();
            }}
          >
            <option>TikTok Shop</option>
            <option>Shopee</option>
          </select>
        </label>
      </div>
      <FilePicker
        label="Tệp dữ liệu hàng hoàn"
        accept=".xlsx,.csv"
        files={file ? [file] : []}
        help="CSV UTF-8 hoặc XLSX · Tối đa 10 MB / 50.000 dòng · Mã luôn giữ dạng văn bản"
        disabled={busy}
        onFiles={(files) => {
          setFile(files[0]);
          setMapping({});
          invalidate();
        }}
      />
      {preview && (
        <details>
          <summary>Ánh xạ cột / Sửa tên cột chưa nhận diện</summary>
          <div className="form-grid">
            {Object.entries(intakeFields).map(([key, field]) => (
              <label className="field" key={key}>
                {field.label}
                <select
                  disabled={busy}
                  value={
                    mapping[key] ??
                    preview.detectedMapping?.mapping?.[key] ??
                    ""
                  }
                  onChange={(e) => {
                    setMapping((m) => ({ ...m, [key]: e.target.value }));
                    setPreview((p) => ({ ...p!, canCommit: false }));
                  }}
                >
                  <option value="">Không có trong nguồn</option>
                  {preview.headers?.map((h: string) => (
                    <option key={h}>{h}</option>
                  ))}
                </select>
              </label>
            ))}
          </div>
          <p>
            Đổi ánh xạ xong, bấm Đọc và đối chiếu để kiểm tra lại. Không phục
            hồi mã đã mất chữ số trong nguồn.
          </p>
        </details>
      )}
      <div className="inline wrap">
        <button
          className="primary"
          disabled={busy || !file || !warehouse || !shop.trim()}
          onClick={() => void run()}
        >
          Đọc và đối chiếu tệp
        </button>
        {preview?.canCommit && (
          <button
            className="primary"
            disabled={busy}
            onClick={() => void run(true)}
          >
            Xác nhận nhập vào hệ thống
          </button>
        )}
        {busy && (
          <button className="secondary" onClick={() => abort.current?.abort()}>
            Dừng sau lô đang xử lý
          </button>
        )}
      </div>
      <p role="status">{progress}</p>
      <ErrorBox message={error} />
      {preview && (
        <>
          <div className="import-stats">
            {[
              ["rows", "Dòng dữ liệu"],
              ["valid", "Dòng hợp lệ"],
              ["requests", "Hồ sơ duy nhất"],
              ["new_requests", "Hồ sơ mới"],
              ["existing_requests", "Hồ sơ đã có"],
              ["tracking", "Mã vận đơn"],
              ["duplicates", "Dòng trùng chính xác"],
              ["errors", "Dòng cần sửa"],
            ].map(([key, label]) => (
              <span key={key}>
                <b>{n(preview.summary[key])}</b>
                {kind === "warehouse_receipt"
                  ? ((
                      {
                        requests: "Mã đối chiếu duy nhất",
                        new_requests: "Mã nhận mới",
                        existing_requests: "Mã nhận đã có",
                      } as Record<string, string>
                    )[key] ?? label)
                  : label}
                <MetricHelp label={label}>
                  {(
                    {
                      rows: "Số dòng dữ liệu trong toàn bộ file, không gồm dòng tiêu đề.",
                      valid:
                        "Dòng hợp lệ được phép ghi; bỏ các dòng trùng chính xác.",
                      requests:
                        kind === "warehouse_receipt"
                          ? "Số nhóm mã vận đơn hoặc mã đơn dùng để đối chiếu bằng chứng kho."
                          : "Số yêu cầu hoàn duy nhất; nhiều SKU không làm tăng số yêu cầu.",
                      new_requests:
                        kind === "warehouse_receipt"
                          ? "Mã chưa có bằng chứng nhận tại kho này."
                          : "Yêu cầu chưa tồn tại trong shop và nghiệp vụ này.",
                      existing_requests:
                        kind === "warehouse_receipt"
                          ? "Mã đã có bằng chứng nhận; không cộng thêm một kiện vì nhập lại."
                          : "Yêu cầu đã có; nhập mới lưu lịch sử và giữ kết quả nhận/kiểm.",
                      tracking:
                        "Số mã vận đơn khác nhau không trống trong nguồn.",
                      duplicates:
                        "Các dòng lặp hoàn toàn giống nhau được bỏ qua, không cộng lượng.",
                      errors:
                        "Dòng cần sửa hoặc mâu thuẫn. Chưa lưu khi còn lỗi.",
                    } as Record<string, string>
                  )[key] ??
                    "Đếm trên toàn bộ tệp theo bộ lọc và ánh xạ đang chọn."}
                </MetricHelp>
              </span>
            ))}
          </div>
          {preview.summary.reused && (
            <p className="notice">
              Tệp đã nhập trước đó, không tạo trùng hồ sơ.
            </p>
          )}
          {preview.completed && (
            <p className="notice success">Đã có xác nhận lưu trên máy chủ.</p>
          )}
          <p>
            Khoảng ngày nguồn:{" "}
            {preview.summary.from_date
              ? formatTime(preview.summary.from_date)
              : "Chưa có"}{" "}
            →{" "}
            {preview.summary.to_date
              ? formatTime(preview.summary.to_date)
              : "Chưa có"}
            . Hiển thị tối đa 100 dòng mẫu; số đếm tính trên toàn bộ tệp.
          </p>
          {preview.summary.errors > 0 && (
            <button
              className="secondary small"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                setError("");
                try {
                  await downloadReturnIntakeErrors(preview.jobId, setProgress);
                } catch (e) {
                  setError((e as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              Tải toàn bộ dòng lỗi (Excel)
            </button>
          )}
          {preview.errors?.map((e: Row) => (
            <p className="red-text" key={e.row_number}>
              Dòng {e.row_number}: {e.error}
            </p>
          ))}
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>DÒNG</th>
                  <th>MÃ ĐƠN</th>
                  <th>MÃ VẬN ĐƠN</th>
                  <th>TRẠNG THÁI NGUỒN / THAY ĐỔI</th>
                  <th>CẢNH BÁO</th>
                </tr>
              </thead>
              <tbody>
                {preview.rows?.map((r: Row) => (
                  <tr key={r.row_number}>
                    <td>{r.row_number}</td>
                    <td>
                      <CopyId value={r.normalized?.order ?? ""} />
                    </td>
                    <td>
                      <CopyId value={r.normalized?.tracking ?? ""} />
                    </td>
                    <td>
                      {r.normalized?.status ?? "Nhận từ file kho"}
                      {r.previous_status && (
                        <small>
                          Trước: {r.previous_status} → Sau:{" "}
                          {r.normalized?.status}
                        </small>
                      )}
                      {r.previous_order_amount != null &&
                        r.normalized?.orderAmount != null &&
                        String(r.previous_order_amount) !==
                          String(r.normalized.orderAmount) && (
                          <small>
                            Giá trị đơn đổi: {vnd(r.previous_order_amount)} →{" "}
                            {vnd(r.normalized.orderAmount)}
                          </small>
                        )}
                      {r.previous_refund_amount != null &&
                        r.normalized?.meta?.refundAmount != null &&
                        String(r.previous_refund_amount) !==
                          String(r.normalized.meta.refundAmount) && (
                          <small>
                            Số tiền hoàn nguồn đổi:{" "}
                            {vnd(r.previous_refund_amount)} →{" "}
                            {vnd(r.normalized.meta.refundAmount)}
                          </small>
                        )}
                    </td>
                    <td>
                      {r.duplicate
                        ? "Dòng trùng, không cộng thêm"
                        : r.warnings?.join("; ")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}
function ReceiptLinkModal({
  receipt,
  onClose,
}: {
  receipt: Row;
  onClose: () => void;
}) {
  const data = useData<Row>(
    "returns/operations/cases?q=" +
      encodeURIComponent(receipt.tracking_code || receipt.order_code),
  );
  const [caseId, setCase] = useState(""),
    [reason, setReason] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  return (
    <Modal title="Xác minh liên kết nhận hàng" onClose={onClose}>
      <p>
        Chỉ ghép mã chính xác, đúng kho và có bằng chứng. Không đối chiếu theo
        tên khách, ngày hay giá trị.
      </p>
      <CopyId value={receipt.tracking_code || receipt.order_code} />
      <ErrorBox message={error || data.error} />
      <label className="field">
        Hồ sơ tương ứng
        <select value={caseId} onChange={(e) => setCase(e.target.value)}>
          <option value="">Chọn hồ sơ đã xác minh</option>
          {data.data?.rows.map((r: Row) => (
            <option key={r.id} value={r.id}>
              {r.order_code} · {r.external_id} · {r.carrier} · {r.warehouse}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        Lý do / bằng chứng xác minh
        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          minLength={8}
        />
      </label>
      <button
        className="primary"
        disabled={busy || !caseId || reason.trim().length < 8}
        onClick={async () => {
          setBusy(true);
          try {
            await post("returns/operations/verify-receipt", {
              id: receipt.id,
              version: receipt.version,
              caseId,
              reason,
            });
            refresh();
            onClose();
            toast("Đã ghép dữ liệu có lưu lịch sử");
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        Xác nhận ghép
      </button>
    </Modal>
  );
}
function OperationImportHistory({
  data,
  admin,
  onPage,
}: {
  data: Row;
  admin: boolean;
  onPage: (p: number) => void;
}) {
  const [chosen, setChosen] = useState<Row | null>(null),
    [reason, setReason] = useState(""),
    [restore, setRestore] = useState(false),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const states: Record<string, string> = {
    staging: "Đang đọc tệp",
    needs_fix: "Cần sửa dữ liệu",
    ready: "Đã xem trước",
    committing: "Đang lưu theo lô",
    completed: "Đã nhập",
    reused: "Đã có trước đó",
    archived: "Đã loại bỏ",
    archiving: "Đang tính lại nguồn",
  };
  return (
    <section className="card">
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>TỆP / NGUỒN</th>
              <th>THỜI ĐIỂM / NGƯỜI NHẬP</th>
              <th>TIẾN ĐỘ</th>
              <th>KẾT QUẢ</th>
              <th>THAO TÁC</th>
            </tr>
          </thead>
          <tbody>
            {data.rows.map((r: Row) => (
              <tr key={r.id}>
                <td>
                  <a
                    href={
                      "/api/returns/operations/imports/" + r.id + "/original"
                    }
                  >
                    {r.filename}
                  </a>
                  <small>
                    {returnIntakeKinds[r.kind as ReturnIntakeKind]} · {r.shop}
                  </small>
                </td>
                <td>
                  {formatTime(r.created_at)}
                  <small>{r.employee}</small>
                </td>
                <td>
                  {n(r.imported_rows)}/{n(r.summary?.valid ?? r.total_rows)}
                </td>
                <td>{states[r.state] ?? "Cần kiểm tra"}</td>
                <td>
                  {admin &&
                    [
                      "completed",
                      "archived",
                      "archiving",
                      "restoring",
                    ].includes(r.state) && (
                      <button
                        className="secondary small"
                        onClick={() => {
                          setChosen(r);
                          setRestore(
                            ["archived", "restoring"].includes(r.state),
                          );
                          setReason(r.summary?.archiveReason ?? "");
                        }}
                      >
                        {r.state === "archived"
                          ? "Khôi phục"
                          : r.state === "restoring"
                            ? "Tiếp tục khôi phục"
                            : r.state === "archiving"
                              ? "Tiếp tục loại bỏ"
                              : "Loại bỏ đợt nhập"}
                      </button>
                    )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <PageControls total={data.total} page={data.page} onPage={onPage} />
      {chosen && (
        <Modal
          title={restore ? "Khôi phục nguồn nhập" : "Loại bỏ mềm đợt nhập sai"}
          onClose={() => setChosen(null)}
        >
          <p>
            Nguồn được tính lại theo những đợt còn hiệu lực. Lượt nhận thực tế,
            kiểm hàng, khiếu nại và lịch sử được giữ để kiểm toán.
          </p>
          <strong>{chosen.filename}</strong>
          <label className="field">
            Lý do xác nhận
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              minLength={8}
            />
          </label>
          <ErrorBox message={error} />
          <button
            className="primary"
            disabled={busy || reason.trim().length < 8}
            onClick={async () => {
              setBusy(true);
              setError("");
              try {
                let result;
                do {
                  result = await post("returns/operations/imports/archive", {
                    id: chosen.id,
                    restore,
                    reason,
                  });
                } while (!result.done);
                refresh();
                setChosen(null);
                toast("Đã cập nhật nguồn, giữ lịch sử thực tế");
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            {restore ? "Xác nhận khôi phục" : "Xác nhận loại bỏ"}
          </button>
        </Modal>
      )}
    </section>
  );
}
function OperationReportPanel({ filters }: { filters: Row }) {
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState(""),
    [error, setError] = useState("");
  return (
    <section className="card padded">
      <h3>Xuất danh sách chưa nhận – Cần kiểm tra</h3>
      <p>
        Chỉ xuất đúng tập cần tra soát trong bộ lọc. Mỗi hãng một sheet có dữ
        liệu; giữ mã dạng văn bản, không đưa thông tin cá nhân khách hàng vào
        báo cáo.
      </p>
      <button
        className="primary"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError("");
          try {
            const { exportReturnOperations } =
              await import("./return-report-client");
            await exportReturnOperations(filters, setMessage);
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <Download size={16} />
        XUẤT DANH SÁCH CHƯA NHẬN – CẦN KIỂM TRA
      </button>
      <p role="status">{message}</p>
      <ErrorBox message={error} />
    </section>
  );
}
