"use client";
import { ReturnOverview } from "./return-overview";
import { MetricHelp } from "./metric-help";
import {
  returnSourceMetrics,
  returnUpdateMetrics,
} from "./return-import-metrics";
import { ReturnAnalysis, ReturnImportUpdates } from "./return-analysis";
import { ReturnDetailInfo, QuickCopy } from "./return-detail-info";
import { ReturnStatus, warehouseState } from "./return-status";
import { useEffect, useRef, useState } from "react";
import {
  LayoutDashboard,
  FileSpreadsheet,
  ScanLine,
  ListChecks,
  ShieldAlert,
  History,
  Check,
  CheckCircle2,
  Info,
  ArrowRight,
  LoaderCircle,
} from "lucide-react";
import type { User } from "@/lib/db";
import { todayVN, formatTime } from "@/lib/domain";
import {
  returnFields,
  returnChangeLabel,
  reasonGroups,
  returnInspection,
  returnProcessing,
  visibleReturnTabs,
  type ReturnTab,
} from "@/lib/return-domain";
import {
  api,
  post,
  useData,
  refresh,
  toast,
  ErrorBox,
  Loading,
  Modal,
  OptionList,
  useCatalogSelection,
  type Row,
} from "./shared";
import { CameraScanner } from "./scanner";
import { FilePicker, ImportSteps } from "./import-ui";

const returnTabIcons = {
  dashboard: LayoutDashboard,
  analytics: LayoutDashboard,
  updates: History,
  import: FileSpreadsheet,
  scan: ScanLine,
  list: ListChecks,
  claims: ShieldAlert,
  history: History,
};

const money = (n: unknown) =>
  n === null || n === undefined || n === ""
    ? "Chưa có dữ liệu"
    : new Intl.NumberFormat("vi-VN", {
        style: "currency",
        currency: "VND",
      }).format(Number(n));
const actionNames: Record<string, string> = {
  received: "Nhận kiện",
  duplicate: "Quét trùng",
  unknown: "Mã chưa có nguồn",
  ambiguous: "Mã khớp nhiều hồ sơ",
  inspect: "Kiểm nhận sản phẩm",
  update: "Ghi chú / xử lý",
  undo_receive: "Hoàn tác nhận",
  claim: "Cập nhật khiếu nại",
  import: "Nhập nguồn",
  parcel: "Cập nhật mã / hãng",
  evidence: "Thêm bằng chứng",
};
const outcome: Record<string, string> = {
  received: "ĐÃ NHẬN KIỆN · CHỜ KIỂM HÀNG",
  duplicate: "VẬN ĐƠN NÀY ĐÃ ĐƯỢC XÁC NHẬN HOÀN KHO",
  unknown: "KHÔNG TÌM THẤY VẬN ĐƠN TRONG DỮ LIỆU ĐÃ NHẬP",
  ambiguous: "MÃ KHỚP NHIỀU HỒ SƠ · CHỌN ĐÚNG KIỆN",
};
export function ReturnsModule({
  user,
  refs,
  tab,
  onTabChange: setTab,
}: {
  user: User;
  refs: Row;
  tab: ReturnTab;
  onTabChange: (tab: ReturnTab) => void;
}) {
  const manager = user.role !== "staff";
  const keyboardTab = useRef<ReturnTab | null>(null);
  useEffect(() => {
    if (keyboardTab.current === tab)
      document.getElementById(`returns-tab-${tab}`)?.focus();
    keyboardTab.current = null;
  }, [tab]);
  const [filters, setFilters] = useState<Row>({
    from: "",
    to: "",
    dateType: "requested",
    channel: "",
    warehouse: "",
    shop: "",
    state: tab === "claims" ? "claims_or_lost" : "",
    carrier: "",
    carrierScope: "any",
    sort: "date",
    reason: "",
    q: "",
    page: "1",
  });
  const query = new URLSearchParams(
    Object.fromEntries(Object.entries(filters).filter(([, v]) => v !== "")),
  ).toString();
  const listVisible = ["dashboard", "list", "claims", "history"].includes(tab);
  const { data, error, loading, reload } = useData<Row>(
    listVisible
      ? "returns?" + query
      : tab === "scan"
        ? "returns/events/mine"
        : null,
    5000,
  );
  const [selected, setSelected] = useState("");
  const change = (key: string, value: string) =>
    setFilters((f) => ({
      ...f,
      [key]:
        key === "state" && tab === "claims" && !value
          ? "claims_or_lost"
          : value,
      page: key === "page" ? value : "1",
      ...(key === "carrier" ? { carrierScope: "any" } : {}),
    }));
  const tabs = visibleReturnTabs(user.role);
  const currentTab = tabs.find((item) => item.key === tab) ?? tabs[0];
  const [advancedFilters, setAdvancedFilters] = useState(false);
  const navigateTab = (key: ReturnTab) => {
    setTab(key);
    if (key === "claims" || key === "dashboard")
      setFilters((f) => ({
        ...f,
        state: key === "claims" ? "claims_or_lost" : "",
        page: "1",
      }));
  };
  const openOverviewList = (state: string, carrier?: string) => {
    setFilters((f) => ({
      ...f,
      state,
      ...(carrier === undefined ? {} : { carrier, carrierScope: "exclusive" }),
      page: "1",
    }));
    setTab("list");
  };
  return (
    <div
      className={
        "return-module" + (tab === "dashboard" ? " return-overview-view" : "")
      }
    >
      <div className="return-navigation">
        <div className="return-navigation-label">
          CÁC MỤC TRONG QUẢN LÝ ĐƠN HOÀN
        </div>
        <div
          className="tabs return-tabs"
          role="tablist"
          aria-label="Quản lý đơn hoàn"
        >
          {tabs.map(({ key, label, description }) => {
            const Icon = returnTabIcons[key];
            return (
              <button
                key={key}
                id={`returns-tab-${key}`}
                role="tab"
                aria-label={label}
                aria-selected={tab === key}
                aria-controls="returns-panel"
                tabIndex={tab === key ? 0 : -1}
                className={tab === key ? "active" : ""}
                onKeyDown={(event) => {
                  const index = tabs.findIndex((item) => item.key === key);
                  let next = index;
                  if (event.key === "ArrowRight" || event.key === "ArrowDown")
                    next = (index + 1) % tabs.length;
                  else if (event.key === "ArrowLeft" || event.key === "ArrowUp")
                    next = (index + tabs.length - 1) % tabs.length;
                  else if (event.key === "Home") next = 0;
                  else if (event.key === "End") next = tabs.length - 1;
                  else return;
                  event.preventDefault();
                  keyboardTab.current = tabs[next].key;
                  navigateTab(tabs[next].key);
                }}
                onClick={() => {
                  navigateTab(key);
                }}
              >
                <span className="return-tab-icon">
                  <Icon size={19} />
                </span>
                <span className="return-tab-copy">
                  <strong>{label}</strong>
                  <small>{description}</small>
                </span>
                {tab === key && (
                  <Check size={16} className="return-tab-check" />
                )}
              </button>
            );
          })}
        </div>
      </div>
      <div className="return-current-view">
        <span className="current-view-label">Bạn đang ở</span>
        <div>
          <h2>{currentTab.label}</h2>
          <p>{currentTab.description}</p>
        </div>
        <span className="current-view-badge">
          <CheckCircle2 size={15} /> Đang mở
        </span>
      </div>
      {tab !== "import" && tab !== "dashboard" && (
        <div className="notice return-flow-note">
          <Info size={18} aria-hidden="true" />
          <p>
            Nguồn sàn → Nhận kiện → Kiểm đếm → Xử lý/khiếu nại → Hoàn tất. Quét
            mã chỉ xác nhận nhận kiện; không tự cộng tồn bán được hay xác nhận
            đủ sản phẩm.
          </p>
        </div>
      )}
      <section
        id="returns-panel"
        role="tabpanel"
        aria-labelledby={`returns-tab-${tab}`}
      >
        <ErrorBox message={error} />
        {tab === "import" ? (
          <ReturnImporter refs={refs} onOpenList={() => setTab("list")} />
        ) : tab === "analytics" ? (
          <ReturnAnalysis
            refs={refs}
            user={user}
            onReason={(reason, scope) => {
              setFilters((f) => ({
                ...f,
                reason,
                from: scope.from,
                to: scope.to,
                channel: scope.channel,
                shop: scope.shop,
                state:
                  scope.type === "approved"
                    ? "approved"
                    : scope.type === "received"
                      ? "received"
                      : "",
                q: "",
                carrier: "",
                carrierScope: "any",
                warehouse: "",
                dateType: "requested",
                page: "1",
              }));
              setTab("list");
            }}
          />
        ) : tab === "updates" ? (
          <ReturnImportUpdates />
        ) : tab === "scan" ? (
          <ReturnScanner
            refs={refs}
            user={user}
            events={data?.events ?? []}
            onOpen={setSelected}
          />
        ) : (
          <>
            <section
              className="card padded return-filter-panel"
              data-expanded={advancedFilters}
            >
              <div className="form-grid return-filter-grid">
                <label className="field return-filter-advanced">
                  Tìm mã yêu cầu / đơn gốc / vận đơn
                  <input
                    placeholder="Dán một hoặc nhiều mã, cách nhau bằng dấu phẩy"
                    value={filters.q}
                    onChange={(e) => change("q", e.target.value)}
                  />
                </label>
                <label className="field return-filter-advanced">
                  Loại ngày
                  <select
                    value={filters.dateType}
                    onChange={(e) => change("dateType", e.target.value)}
                  >
                    <option value="requested">Ngày yêu cầu hoàn</option>
                    <option value="received">Ngày nhận kiện gần nhất</option>
                    <option value="imported">Ngày nhập nguồn gần nhất</option>
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
                <label className="field">
                  Sàn đơn hoàn
                  <select
                    value={filters.channel}
                    onChange={(e) => change("channel", e.target.value)}
                  >
                    <option value="">Tất cả sàn</option>
                    <option>Shopee</option>
                    <option>TikTok Shop</option>
                  </select>
                </label>
                <label className="field">
                  Kho đơn hoàn
                  <select
                    value={filters.warehouse}
                    onChange={(e) => change("warehouse", e.target.value)}
                  >
                    <option value="">Tất cả kho</option>
                    <OptionList rows={refs.warehouses} />
                  </select>
                </label>
                <label className="field return-filter-advanced">
                  Shop đơn hoàn
                  <input
                    value={filters.shop}
                    placeholder="Đúng tên shop, để trống xem tất cả"
                    onChange={(e) => change("shop", e.target.value)}
                  />
                </label>
                <label className="field">
                  Đơn vị trả hàng
                  <select
                    value={filters.carrier}
                    onChange={(e) => change("carrier", e.target.value)}
                  >
                    <option value="">Tất cả hãng</option>
                    <option value="unknown">Chưa xác định</option>
                    <option value="mixed">Nhiều hãng / cần đối chiếu</option>
                    <OptionList rows={refs.carriers} />
                  </select>
                </label>
                <label className="field return-filter-advanced">
                  Lý do hoàn chuẩn
                  <select
                    value={filters.reason}
                    onChange={(e) => change("reason", e.target.value)}
                  >
                    <option value="">Tất cả lý do</option>
                    {Object.entries(reasonGroups).map(([key, label]) => (
                      <option key={key} value={key}>
                        {label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field return-filter-advanced">
                  Sắp xếp danh sách
                  <select
                    value={filters.sort}
                    onChange={(e) => change("sort", e.target.value)}
                  >
                    <option value="date">Ngày yêu cầu mới nhất</option>
                    <option value="carrier">Hãng trả hàng</option>
                  </select>
                </label>
                <label className="field return-filter-advanced">
                  Lọc đối soát hoàn
                  <select
                    value={filters.state}
                    onChange={(e) => change("state", e.target.value)}
                  >
                    <option value="">Tất cả yêu cầu</option>
                    <option value="unreceived">
                      Chưa nhận · không gồm yêu cầu hủy
                    </option>
                    <option value="received">Đã nhận ít nhất một kiện</option>
                    <option value="approved">
                      Đã được sàn chấp thuận (theo cấu hình)
                    </option>
                    <option value="missing_tracking">Chưa có mã vận đơn</option>
                    <option value="stale">Nguồn đổi · cần kiểm lại</option>
                    <option value="overdue">Quá mốc theo dõi</option>
                    <option value="claims">Có hồ sơ khiếu nại</option>
                    <option value="claims_or_lost">
                      Khiếu nại / nghi mất / mất
                    </option>
                    <option value="claim_success">Khiếu nại thành công</option>
                    <option value="open_claims">Đang khiếu nại</option>
                    <option value="waiting_inspection">Chờ kiểm hàng</option>
                    <option value="partial_receipt">Nhận một phần</option>
                    <option value="excluded">
                      Đơn hủy / không cần trả hàng
                    </option>
                    {Object.entries(returnInspection)
                      .filter(([k]) => k !== "pending")
                      .map(([k, l]) => (
                        <option value={k} key={k}>
                          {l}
                        </option>
                      ))}
                    {Object.entries(returnProcessing)
                      .filter(([k]) => k !== "pending")
                      .map(([k, l]) => (
                        <option value={k} key={k}>
                          {l}
                        </option>
                      ))}
                  </select>
                </label>
              </div>
              <div className="inline wrap">
                <button
                  className="secondary small"
                  aria-expanded={advancedFilters}
                  onClick={() => setAdvancedFilters((v) => !v)}
                >
                  {advancedFilters ? "Thu gọn bộ lọc" : "Bộ lọc +"}
                </button>
                {(filters.state || filters.carrierScope === "exclusive") && (
                  <span className="return-active-scope">
                    Đang lọc:{" "}
                    {returnProcessing[filters.state] ??
                      returnInspection[filters.state] ??
                      (
                        {
                          unreceived: "Chưa về kho",
                          received: "Đã về kho",
                          claim_success: "Khiếu nại thành công",
                          open_claims: "Đang khiếu nại",
                          waiting_inspection: "Chờ kiểm hàng",
                          partial_receipt: "Nhận một phần",
                          excluded: "Hủy / không trả hàng",
                          overdue: "Quá mốc",
                          claims: "Có khiếu nại",
                          claims_or_lost: "Khiếu nại / nghi mất / mất",
                          missing_tracking: "Chưa có vận đơn",
                          stale: "Cần kiểm lại",
                        } as Row
                      )[filters.state] ??
                      "Theo nhóm hãng"}
                    {filters.carrierScope === "exclusive"
                      ? " · Nhóm hãng duy nhất"
                      : ""}{" "}
                    <button
                      className="text-button"
                      onClick={() =>
                        setFilters((f) => ({
                          ...f,
                          state: tab === "claims" ? "claims_or_lost" : "",
                          carrier: "",
                          carrierScope: "any",
                          page: "1",
                        }))
                      }
                    >
                      Bỏ lọc trạng thái / hãng
                    </button>
                  </span>
                )}
                <button
                  className="secondary small"
                  onClick={() => {
                    setFilters((f) => ({
                      ...f,
                      from: todayVN(),
                      to: todayVN(),
                      page: "1",
                    }));
                  }}
                >
                  Hôm nay
                </button>
                <button
                  className="secondary small"
                  onClick={() => {
                    setFilters((f) => ({
                      ...f,
                      from: todayVN().slice(0, 7) + "-01",
                      to: todayVN(),
                      page: "1",
                    }));
                  }}
                >
                  Tháng này
                </button>
                <button
                  className="secondary small"
                  onClick={() =>
                    setFilters((f) => ({
                      ...f,
                      from: "",
                      to: "",
                      state: tab === "claims" ? "claims_or_lost" : "",
                      q: "",
                      page: "1",
                    }))
                  }
                >
                  Toàn bộ thời gian
                </button>
                {manager && (
                  <>
                    <a
                      className="button secondary small"
                      href={"/api/returns/export?" + query + "&format=xlsx"}
                    >
                      Xuất đơn hoàn Excel
                    </a>
                    <a
                      className="button secondary small"
                      href={"/api/returns/export?" + query + "&format=csv"}
                    >
                      CSV
                    </a>
                  </>
                )}
              </div>
            </section>
            {loading && !data ? (
              <Loading />
            ) : (
              data && (
                <>
                  {tab === "dashboard" ? (
                    <ReturnOverview
                      data={data}
                      onNavigate={openOverviewList}
                      onReload={reload}
                    />
                  ) : (
                    <>
                      <ReturnTable rows={data.rows} onOpen={setSelected} />
                      <div className="inline">
                        <button
                          className="secondary"
                          disabled={data.page <= 1}
                          onClick={() => change("page", String(data.page - 1))}
                        >
                          Trang trước
                        </button>
                        <span>
                          Trang {data.page}/
                          {Math.max(1, Math.ceil(data.totals.requests / 50))} ·{" "}
                          {data.totals.requests} yêu cầu
                        </span>
                        <button
                          className="secondary"
                          disabled={data.page * 50 >= data.totals.requests}
                          onClick={() => change("page", String(data.page + 1))}
                        >
                          Trang sau
                        </button>
                      </div>
                    </>
                  )}
                  {tab === "history" && (
                    <section className="card padded">
                      <h3>20 thao tác gần nhất của bạn</h3>
                      <ReturnEvents events={data.events} />
                    </section>
                  )}
                </>
              )
            )}
          </>
        )}
      </section>
      {selected && (
        <ReturnCase
          id={selected}
          refs={refs}
          user={user}
          onClose={() => setSelected("")}
        />
      )}
    </div>
  );
}
function ReturnTable({
  rows,
  onOpen,
}: {
  rows: Row[];
  onOpen: (id: string) => void;
}) {
  const [columns, setColumns] = useState({
    source: true,
    parcels: true,
    attention: true,
    context: true,
  });
  return (
    <section className="card return-list-table">
      <details className="return-column-settings">
        <summary>Ẩn / hiện cột danh sách</summary>
        <div className="inline wrap">
          {Object.entries(columns).map(([key, on]) => (
            <label className="inline" key={key}>
              <input
                type="checkbox"
                checked={on}
                onChange={(e) =>
                  setColumns({ ...columns, [key]: e.target.checked })
                }
              />
              {
                (
                  {
                    source: "Trạng thái sàn",
                    parcels: "Kiện / sản phẩm",
                    attention: "Cần chú ý",
                    context: "Sàn / shop / kho",
                  } as Row
                )[key]
              }
            </label>
          ))}
        </div>
      </details>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Yêu cầu / đơn gốc</th>
              <th>Mã vận chuyển trả hàng</th>
              <th>Đơn vị trả hàng</th>
              {columns.context && <th>Sàn / shop / kho</th>}
              {columns.source && <th>Nguồn sàn</th>}
              {columns.parcels && <th>Kiện / sản phẩm</th>}
              <th className="return-state-column">Kiểm hàng / xử lý</th>
              {columns.attention && <th>Cần chú ý</th>}
              <th>Thao tác</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td>
                  <strong>{r.external_id}</strong>
                  <small className="block">{r.order_code}</small>
                  <small>{formatTime(r.requested_at)}</small>
                </td>
                <td>
                  <strong>{r.return_tracking || "Chưa có mã"}</strong>
                  <QuickCopy value={r.return_tracking ?? ""} />
                </td>
                <td>
                  {r.return_carriers || "Chưa xác định"}
                  {r.carrier_conflict && (
                    <small className="return-status attention">
                      Hãng mâu thuẫn · cần đối soát
                    </small>
                  )}
                </td>
                {columns.context && (
                  <td>
                    {r.channel}
                    <small className="block">
                      {r.shop} · {r.warehouse}
                    </small>
                  </td>
                )}
                {columns.source && (
                  <td>
                    {r.platform_status}
                    <small className="block">{r.platform_substatus}</small>
                  </td>
                )}
                {columns.parcels && (
                  <td>
                    {r.received}/{r.parcels} kiện nhận
                    <small className="block">
                      {r.quantity} SP yêu cầu · {r.received_quantity} SP kiểm
                    </small>
                  </td>
                )}
                <td>
                  <ReturnStatus kind="warehouse" value={warehouseState(r)} />
                  <ReturnStatus value={r.processing_status} />
                </td>
                {columns.attention && (
                  <td>
                    {r.overdue ? "Quá mốc theo dõi " : ""}
                    {!r.parcels ? "Chưa có mã " : ""}
                    {r.inspection_stale ? "Nguồn đổi, cần kiểm lại " : ""}
                    {r.claims ? `${r.claims} hồ sơ khiếu nại` : ""}
                  </td>
                )}
                <td>
                  <button
                    className="secondary small"
                    onClick={() => onOpen(r.id)}
                  >
                    Xem / xử lý
                  </button>
                </td>
              </tr>
            ))}
            {!rows.length && (
              <tr>
                <td colSpan={7}>Chưa có dữ liệu trong bộ lọc.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
function ReturnImporter({
  refs,
  onOpenList,
}: {
  refs: Row;
  onOpenList: () => void;
}) {
  const [warehouse, setWarehouse] = useCatalogSelection(refs.warehouses);
  const [updateMode, setUpdateMode] = useState(false);
  const [file, setFile] = useState<File | null>(null),
    [shop, setShop] = useState("ComsMiu"),
    [channel, setChannel] = useState(""),
    [mapping, setMapping] = useState<Record<string, string>>({
      ...returnFields,
    }),
    [advanced, setAdvanced] = useState(false),
    [preview, setPreview] = useState<Row | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [done, setDone] = useState("");
  function clear() {
    setPreview(null);
    setDone("");
    setError("");
  }
  function form() {
    const data = new FormData();
    if (file) data.set("file", file);
    data.set(
      "context",
      JSON.stringify({
        shop,
        warehouseId: warehouse,
        channel,
        previewFingerprint: preview?.previewFingerprint,
      }),
    );
    data.set("mapping", JSON.stringify(mapping));
    return data;
  }
  async function run(commit = false) {
    setBusy(true);
    setError("");
    try {
      if (!file) throw new Error("Chọn file trước");
      const result = await api(
        "returns/import/" + (commit ? "commit" : "preview"),
        { method: "POST", body: form() },
        180000,
      );
      if (commit) {
        setDone(
          `${result.reused ? "File đã có" : "Đã nhập"} · ${result.created} yêu cầu mới · ${result.updated} yêu cầu cập nhật`,
        );
        refresh();
      } else {
        setPreview(result);
        setDone("");
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="card padded return-import">
      <div className="import-panel-heading">
        <span className="import-heading-icon">
          <FileSpreadsheet size={25} />
        </span>
        <div>
          <span className="import-type-badge">ĐƠN TRẢ HÀNG / HOÀN TIỀN</span>
          <h2>
            {updateMode
              ? "Cập nhật dữ liệu từ file mới"
              : "Nhập nguồn đơn hoàn"}
          </h2>
        </div>
      </div>
      <div className="inline return-import-mode">
        <button
          className={updateMode ? "secondary" : "primary"}
          disabled={busy}
          onClick={() => {
            setUpdateMode(false);
            clear();
          }}
        >
          Nhập nguồn ban đầu
        </button>
        <button
          className={updateMode ? "primary" : "secondary"}
          disabled={busy}
          onClick={() => {
            setUpdateMode(true);
            clear();
          }}
        >
          Cập nhật file
        </button>
      </div>
      <p>
        Hỗ trợ XLSX/CSV tối đa 5 MB, 10.000 dòng. Mẫu TikTok được nhận theo tên
        cột. Chưa có mẫu Shopee gốc: chọn sàn và ánh xạ cột khi cần; không tự
        đoán định dạng.
      </p>
      <ImportSteps
        current={done || preview?.canCommit ? 3 : file ? 2 : 1}
        complete={!!done}
      />
      <div className="import-section">
        <div className="import-section-heading">
          <h3>Thông tin nhận hoàn</h3>
          <span>Chọn shop và kho trước khi đọc file</span>
        </div>
        <div className="form-grid">
          <label className="field">
            Shop của đơn hoàn
            <input
              disabled={busy}
              value={shop}
              onChange={(e) => {
                setShop(e.target.value);
                clear();
              }}
            />
          </label>
          <label className="field">
            Kho nhận hoàn
            <select
              disabled={busy}
              value={warehouse}
              onChange={(e) => {
                setWarehouse(e.target.value);
                clear();
              }}
            >
              <OptionList rows={refs.warehouses} />
            </select>
          </label>
          <label className="field">
            Sàn của file hoàn
            <select
              disabled={busy}
              value={channel}
              onChange={(e) => {
                setChannel(e.target.value);
                clear();
              }}
            >
              <option value="">Tự nhận dạng</option>
              <option>TikTok Shop</option>
              <option>Shopee</option>
            </select>
          </label>
        </div>
      </div>
      <FilePicker
        label="File đơn hoàn"
        accept=".xlsx,.csv"
        files={file ? [file] : []}
        disabled={busy}
        help="1 file Excel (.xlsx) hoặc CSV · Tối đa 5 MB / 10.000 dòng"
        onFiles={(files) => {
          setFile(files[0] ?? null);
          clear();
        }}
        onRemove={() => {
          setFile(null);
          clear();
        }}
      />
      <p className="small-note">
        CSV mẫu TikTok Shop: nhập trực tiếp, không cần dịch vụ xử lý file, tối
        đa 1 MB / 2.000 dòng. Giữ nguyên file CSV gốc để bảo toàn mã đơn dài.
        Excel và CSV sàn khác vẫn cần dịch vụ xử lý riêng.
      </p>
      <details
        className="import-advanced"
        open={advanced}
        onToggle={(e) => setAdvanced(e.currentTarget.open)}
      >
        <summary>Ánh xạ cột tùy chỉnh</summary>
        <p>
          Điền đúng tên cột trong file cho từng thông tin. Cột mặc định là mẫu
          TikTok đã kiểm chứng; với Shopee chọn sàn thủ công và đối chiếu cột
          thật. Ngày dd/MM/yyyy HH:mm:ss, giờ Việt Nam; tiền VND nguyên.
        </p>
        <div className="form-grid">
          {Object.entries(returnFields).map(([key, defaultName]) => (
            <label className="field" key={key}>
              {(
                {
                  request: "Mã yêu cầu hoàn",
                  order: "Mã đơn gốc",
                  sku: "SKU trên sàn",
                  sellerSku: "SKU của shop",
                  name: "Tên sản phẩm",
                  variant: "Phân loại",
                  quantity: "Số lượng hoàn",
                  tracking: "Vận đơn hoàn",
                  requested: "Ngày yêu cầu",
                  status: "Trạng thái sàn",
                  substatus: "Trạng thái con",
                  type: "Loại yêu cầu",
                  unitAmount: "Đơn giá hoàn",
                  orderAmount: "Giá trị đơn gốc",
                  refundTime: "Thời gian hoàn tiền",
                  reason: "Lý do hoàn",
                  note: "Ghi chú người mua",
                } as Row
              )[key] ?? defaultName}
              <input
                disabled={busy}
                value={mapping[key]}
                placeholder={defaultName}
                onChange={(e) => {
                  setMapping({ ...mapping, [key]: e.target.value });
                  clear();
                }}
              />
            </label>
          ))}
        </div>
      </details>
      <ErrorBox message={error} />
      <div className="import-action-row">
        <p>
          {busy
            ? "Đang xử lý, vui lòng chờ máy chủ xác nhận…"
            : file
              ? "File đã được chọn. Bấm đọc để kiểm tra trước khi lưu."
              : "Chọn file để bắt đầu kiểm tra dữ liệu."}
        </p>
        <button
          className="primary import-read-button"
          disabled={busy || !file || !shop.trim() || !warehouse}
          onClick={() => run()}
        >
          {busy ? (
            <LoaderCircle size={17} className="spin" />
          ) : (
            <FileSpreadsheet size={17} />
          )}
          Đọc và đối chiếu đơn hoàn
        </button>
      </div>
      {preview && (
        <section className="import-review">
          <div className="import-review-heading">
            <div>
              <span className="import-type-badge">BƯỚC KIỂM TRA</span>
              <h3>Kết quả đối chiếu nguồn hoàn</h3>
            </div>
            <span
              className={`import-state ${done ? "saved" : preview.canCommit ? "ready" : "blocked"}`}
            >
              {done
                ? "Đã lưu nguồn"
                : preview.canCommit
                  ? "Có thể xác nhận lưu"
                  : "Cần xử lý dữ liệu"}
            </span>
          </div>
          {!done && (
            <p className="import-unsaved">
              <Info size={16} /> Đã đọc file. Dữ liệu chưa được lưu vào hệ
              thống.
            </p>
          )}
          <p>
            Sàn: <strong>{preview.channel}</strong> · {preview.existingRequests}{" "}
            yêu cầu đã có. File không có thời điểm cập nhật trạng thái từ sàn;
            kiểm tra thay đổi trước khi xác nhận nhập bản mới.
          </p>
          {preview.updateSummary && (
            <div
              className="source-counts"
              aria-label="Số liệu đối chiếu cập nhật"
            >
              {returnUpdateMetrics.map(([key, label, help]) => (
                <div key={key}>
                  <strong>{preview.updateSummary[key]}</strong>
                  <span className="metric-label">
                    {label}
                    <MetricHelp label={label}>{help}</MetricHelp>
                  </span>
                </div>
              ))}
            </div>
          )}
          {!!preview.carrierChecks?.filter(
            (c: Row) => c.conflict || c.unrecognizedName,
          ).length && (
            <div className="notice warning">
              <div>
                {preview.carrierChecks
                  .filter((c: Row) => c.conflict || c.unrecognizedName)
                  .slice(0, 20)
                  .map((c: Row) => (
                    <p key={c.tracking}>
                      {c.tracking}: {c.carrier} ·{" "}
                      {c.conflict
                        ? "Tên hãng mâu thuẫn quy tắc mã"
                        : "Tên trong file chưa có trong danh mục"}
                      ; kiểm tra đối soát.
                    </p>
                  ))}
              </div>
            </div>
          )}
          <div className="source-counts" aria-label="Số liệu nguồn hoàn">
            {returnSourceMetrics.map(([k, l, help]) => (
              <div
                key={k}
                className={
                  (k === "missingTracking" || k === "missingSellerSku") &&
                  preview.summary[k] > 0
                    ? "metric-warning"
                    : ""
                }
              >
                <strong>{preview.summary[k]}</strong>
                <span className="metric-label">
                  {l}
                  <MetricHelp label={l}>{help}</MetricHelp>
                </span>
              </div>
            ))}
          </div>
          {!!preview.changes?.length && (
            <details>
              <summary>
                Đối chiếu {preview.changes.length} yêu cầu đã có trước khi cập
                nhật
              </summary>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Yêu cầu</th>
                      <th>Trạng thái sàn cũ → mới</th>
                      <th>SL cũ → mới</th>
                      <th>Vận đơn cũ → mới</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.changes.slice(0, 500).map((c: Row) => (
                      <tr key={c.request}>
                        <td>
                          {c.request}
                          {c.hasInspection && (
                            <small> · Đã có kiểm hàng, kết quả được giữ</small>
                          )}
                        </td>
                        <td>
                          {c.previousStatus} → {c.nextStatus}
                          <details>
                            <summary>
                              {c.fields?.length ?? 0} trường thay đổi
                            </summary>
                            {c.fields?.map((d: Row, i: number) => (
                              <p key={i}>
                                {returnChangeLabel(d.field)}:{" "}
                                {String(d.before ?? "Chưa có")} →{" "}
                                {String(d.after ?? "Chưa có")}
                              </p>
                            ))}
                          </details>
                        </td>
                        <td>
                          {c.previousQuantity} → {c.nextQuantity}
                        </td>
                        <td>
                          {c.previousTracking.join(", ") || "Chưa có"} →{" "}
                          {c.nextTracking.join(", ") || "Chưa có"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          )}
          <div className="notice">
            Chưa có mã vận đơn hoàn hoặc SKU của shop vẫn lưu yêu cầu. Mã đơn và
            SKU luôn giữ dạng text. Trạng thái sàn, Refund Time và đơn giá hoàn
            không thay thế xác nhận kho hoặc tiền thực nhận.
          </div>
          <ErrorBox
            message={
              preview.errors.length || preview.conflicts.length
                ? `${preview.errors.length} dòng lỗi · ${preview.conflicts.length} mâu thuẫn. Chưa lưu file; không bỏ dòng âm thầm.`
                : ""
            }
          />
          {preview.errors.slice(0, 20).map((r: Row) => (
            <p className="red-text" key={r.row}>
              Dòng {r.row}: {r.message}
            </p>
          ))}
          {preview.conflicts.map((r: Row) => (
            <p className="red-text" key={r.request}>
              {r.request}: {r.message}
            </p>
          ))}
          {!!preview.errors.length && (
            <button
              className="secondary"
              onClick={async () => {
                try {
                  const { fileJob, downloadCsvErrors } =
                    await import("./job-client");
                  if (preview._csvDirect) {
                    downloadCsvErrors(preview.errors);
                    return;
                  }
                  const result = await fileJob("returns/import/errors", form());
                  window.location.assign(
                    "/api/jobs/" + result._jobId + "/download",
                  );
                } catch (e) {
                  setError((e as Error).message);
                }
              }}
            >
              Tải báo cáo dòng lỗi
            </button>
          )}
          <details>
            <summary>Xem {preview.rows.length} dòng hợp lệ và cảnh báo</summary>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Dòng</th>
                    <th>Yêu cầu / đơn</th>
                    <th>SKU / SL</th>
                    <th>Vận đơn</th>
                    <th>Cảnh báo</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.rows.slice(0, 500).map((r: Row) => (
                    <tr key={r.row}>
                      <td>{r.row}</td>
                      <td>
                        {r.request}
                        <small className="block">{r.order}</small>
                      </td>
                      <td>
                        {r.sku} · {r.quantity}
                      </td>
                      <td>{r.tracking || "Chờ bổ sung"}</td>
                      <td>{r.warnings.join("; ")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {preview.rows.length > 500 && (
              <p>
                Hiển thị 500 dòng đầu; số liệu và thao tác lưu lấy toàn bộ file.
              </p>
            )}
          </details>
          <div className="import-save-row">
            <p>
              {done
                ? "Đã lưu nguồn"
                : preview.canCommit
                  ? "Đối chiếu xong, xác nhận để lưu nguồn đơn hoàn."
                  : "Xử lý lỗi trong file rồi đọc lại trước khi lưu."}
            </p>
            <button
              className="primary import-save-button"
              disabled={busy || !preview.canCommit || !!done}
              onClick={() => run(true)}
            >
              {updateMode ? "Xác nhận cập nhật" : "Xác nhận lưu"}{" "}
              {preview.summary.requests} yêu cầu hoàn
              <ArrowRight size={17} />
            </button>
          </div>
        </section>
      )}
      {done && (
        <div className="import-success">
          <p role="status">
            <CheckCircle2 size={22} />
            {done}
          </p>
          <button className="secondary" onClick={onOpenList}>
            Xem danh sách đơn hoàn <ArrowRight size={16} />
          </button>
        </div>
      )}
    </section>
  );
}
function ReturnScanner({
  refs,
  user,
  events,
  onOpen,
}: {
  refs: Row;
  user: User;
  events: Row[];
  onOpen: (id: string) => void;
}) {
  const [warehouse, setWarehouse] = useCatalogSelection(refs.warehouses);
  const [starting, setStarting] = useState(false);
  const [requestedShift, setShift] = useState(""),
    [code, setCode] = useState(""),
    [result, setResult] = useState<Row | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [camera, setCamera] = useState(false),
    [method, setMethod] = useState("manual");
  const input = useRef<HTMLInputElement>(null),
    running = useRef(false),
    pending = useRef<Row | null>(null);
  const [clock, setClock] = useState(() => new Date(refs.serverTime).getTime());
  useEffect(() => {
    setClock(new Date(refs.serverTime).getTime());
    const timer = setInterval(() => setClock((v) => v + 1000), 1000);
    return () => clearInterval(timer);
  }, [refs.serverTime]);
  const shifts = refs.shifts.filter(
    (s: Row) =>
      s.assigned &&
      s.warehouse_id === warehouse &&
      new Date(s.starts_at).getTime() <= clock &&
      new Date(s.ends_at).getTime() > clock,
  );
  const shift = shifts.find((s: Row) => s.id === requestedShift) ?? shifts[0];
  async function receive(value = code, parcelId?: string, scanMethod = method) {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    setError("");
    try {
      if (!shift) throw new Error("Chọn ca đang hoạt động trước khi nhận hàng");
      const payload = {
        code: value,
        warehouseId: warehouse,
        shiftId: shift.id,
        method: scanMethod,
        ...(parcelId ? { parcelId } : {}),
      };
      const key = JSON.stringify(payload);
      if (pending.current?.key !== key)
        pending.current = {
          key,
          payload: { ...payload, requestId: crypto.randomUUID() },
        };
      const r = await post("returns/receive", pending.current!.payload);
      pending.current = null;
      setResult(r);
      setCode("");
      refresh();
      try {
        const audio = new AudioContext();
        const o = audio.createOscillator(),
          g = audio.createGain();
        o.connect(g);
        g.connect(audio.destination);
        g.gain.value = 0.08;
        o.frequency.value = r.outcome === "received" ? 880 : 220;
        o.start();
        o.stop(audio.currentTime + 0.12);
        o.onended = () => {
          void audio.close();
        };
      } catch {}
    } catch (e) {
      setError((e as Error).message);
    } finally {
      running.current = false;
      setBusy(false);
      input.current?.focus();
    }
  }
  return (
    <section className="card padded return-scanner">
      <h2>Quét mã hoàn kho</h2>
      <div className="form-grid">
        <label className="field">
          Kho quét hoàn
          <select
            value={warehouse}
            onChange={(e) => {
              setWarehouse(e.target.value);
              setResult(null);
            }}
          >
            <OptionList rows={refs.warehouses} />
          </select>
        </label>
        <label className="field">
          Ca nhận hoàn
          <select
            value={shift?.id ?? ""}
            onChange={(e) => setShift(e.target.value)}
          >
            <option value="">Chọn ca được phân công</option>
            {shifts.map((s: Row) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          Phương thức nhận hoàn
          <select value={method} onChange={(e) => setMethod(e.target.value)}>
            <option value="manual">Nhập tay</option>
            <option value="hid">Súng HID · Enter/Tab</option>
          </select>
        </label>
      </div>
      {!shift && (
        <div className="notice warning">
          Chưa có ca được phân công tại kho này.{" "}
          {user.role !== "staff" && (
            <button
              className="secondary small"
              disabled={starting || !warehouse}
              onClick={async () => {
                try {
                  setStarting(true);
                  await post("shifts/start-self", { warehouseId: warehouse });
                  refresh();
                } catch (e) {
                  setError((e as Error).message);
                } finally {
                  setStarting(false);
                }
              }}
            >
              {starting ? "Đang mở ca…" : "Mở ca nhận cho tôi"}
            </button>
          )}
        </div>
      )}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void receive();
        }}
      >
        <label className="field">
          Mã vận đơn hoàn
          <input
            className="return-code-input"
            ref={input}
            autoFocus
            autoComplete="off"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Tab" && method === "hid" && code.trim()) {
                e.preventDefault();
                void receive();
              }
            }}
          />
        </label>
        <button disabled={busy || !shift || !code.trim()}>
          Xác nhận nhận kiện hoàn
        </button>{" "}
        <button
          className="secondary"
          type="button"
          onClick={() => setCamera((c) => !c)}
        >
          {camera ? "Đóng camera" : "Quét camera hàng hoàn"}
        </button>
      </form>
      {camera && (
        <CameraScanner
          onCode={(value) => {
            void receive(value, undefined, "camera");
          }}
        />
      )}
      <ErrorBox message={error} />
      {result && (
        <div
          className={
            "notice return-receive-result " +
            (result.outcome === "received"
              ? "success"
              : result.outcome === "duplicate"
                ? "warning"
                : "danger")
          }
          role="status"
        >
          <strong className="return-receive-heading">
            {result.outcome === "received" && (
              <CheckCircle2 size={24} aria-hidden="true" />
            )}
            {outcome[result.outcome]}
          </strong>
          <p>
            {result.code}{" "}
            {result.at && (
              <>
                · {formatTime(result.at)} · {result.employee}
              </>
            )}
          </p>
          {result.caseId && (
            <button className="secondary" onClick={() => onOpen(result.caseId)}>
              Mở hồ sơ / kiểm hàng
            </button>
          )}
          {result.outcome === "received" && (
            <button
              className="secondary"
              onClick={async () => {
                const reason = window.prompt(
                  "Lý do hoàn tác (ít nhất 8 ký tự)",
                );
                if (!reason) return;
                try {
                  await post("returns/undo", {
                    eventId: result.eventId,
                    reason,
                  });
                  setResult(null);
                  refresh();
                } catch (e) {
                  setError((e as Error).message);
                }
              }}
            >
              Hoàn tác lượt nhận
            </button>
          )}
          {result.candidates?.map((c: Row) => (
            <button
              key={c.id}
              className="secondary"
              onClick={() => receive(result.code, c.id)}
            >
              {c.channel} · {c.shop} · {c.external_id}
            </button>
          ))}
        </div>
      )}
      <h3>20 lượt thao tác gần nhất của bạn</h3>
      <ReturnEvents events={events} />
    </section>
  );
}
function ReturnEvents({ events }: { events: Row[] }) {
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Thời gian</th>
            <th>Nhân viên</th>
            <th>Thao tác / mã</th>
            <th>Ghi chú</th>
          </tr>
        </thead>
        <tbody>
          {events.map((e) => (
            <tr key={e.id}>
              <td>{formatTime(e.created_at)}</td>
              <td>{e.employee}</td>
              <td>
                {actionNames[e.action] ?? e.action}
                <small className="block">{e.code}</small>
              </td>
              <td>
                {e.reason}
                {e.data?.changes?.length > 0 && (
                  <details>
                    <summary>Trước → sau ({e.data.changes.length})</summary>
                    {e.data.changes.map((c: Row, i: number) => (
                      <p key={i}>
                        {returnChangeLabel(c.field)}:{" "}
                        {String(c.before ?? "Chưa có")} →{" "}
                        {String(c.after ?? "Chưa có")}
                      </p>
                    ))}
                  </details>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
function ReturnCase({
  id,
  refs,
  user,
  onClose,
}: {
  id: string;
  refs: Row;
  user: User;
  onClose: () => void;
}) {
  const { data, error, reload } = useData<Row>("returns/" + id);
  const [problem, setProblem] = useState(""),
    [busy, setBusy] = useState(false);
  async function save(path: string, input: Row) {
    setProblem("");
    setBusy(true);
    try {
      await post("returns/" + path, input);
      await reload();
      refresh();
      toast("Đã lưu xử lý đơn hoàn");
    } catch (e) {
      setProblem((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title="Chi tiết đơn hoàn" onClose={onClose}>
      <ErrorBox message={error || problem} />
      {!data ? (
        <Loading />
      ) : (
        <ReturnCaseBody
          key={data.record.version}
          data={data}
          refs={refs}
          manager={user.role !== "staff"}
          busy={busy}
          save={save}
          onRefresh={() => void reload()}
          onEvidence={async (file) => {
            setProblem("");
            setBusy(true);
            try {
              const form = new FormData();
              form.set("caseId", id);
              form.set("file", file);
              await api("returns/evidence", { method: "POST", body: form });
              await reload();
              toast("Đã lưu bằng chứng");
            } catch (e) {
              setProblem((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        />
      )}
    </Modal>
  );
}
function ReturnCaseBody({
  data,
  refs,
  manager,
  busy,
  save,
  onEvidence,
  onRefresh,
}: {
  onRefresh: () => void;
  data: Row;
  refs: Row;
  manager: boolean;
  busy: boolean;
  save: (path: string, input: Row) => Promise<void>;
  onEvidence: (file: File) => Promise<void>;
}) {
  const r = data.record;
  const active = data.items.filter((i: Row) => i.active);
  const [qty, setQty] = useState<Row>(
      Object.fromEntries(active.map((i: Row) => [i.id, i.received_qty ?? 0])),
    ),
    [condition, setCondition] = useState(
      r.inspection_status === "pending" ? "full" : r.inspection_status,
    ),
    [note, setNote] = useState(""),
    [location, setLocation] = useState(r.location);
  const [status, setStatus] = useState(r.processing_status),
    [assigned, setAssigned] = useState(r.assigned_to ?? ""),
    [expected, setExpected] = useState(r.expected_at?.slice(0, 10) ?? ""),
    [noPhysical, setNoPhysical] = useState(r.no_physical_return);
  const [tracking, setTracking] = useState(""),
    [carrier, setCarrier] = useState("");
  const [parcelCarriers, setParcelCarriers] = useState<Row>(
    Object.fromEntries(
      data.parcels.map((p: Row) => [p.id, p.carrier_id ?? ""]),
    ),
  );
  const blankClaim = {
    id: "",
    status: "open",
    reason: "",
    deadline: "",
    requested: "",
    approved: "",
    received: "",
    receivedOn: "",
  };
  const [claim, setClaim] = useState<Row>(blankClaim);
  return (
    <div className="return-case">
      <ReturnDetailInfo data={data} onRefresh={onRefresh} />
      <h2 className="return-manual-heading">
        Kiểm tra / xử lý · thao tác nhân viên
      </h2>
      {r.inspection_stale && (
        <div className="notice warning">
          Nguồn đã thay đổi sau kiểm hàng. Kết quả nhận trước vẫn được giữ; cần
          kiểm lại trước khi hoàn thành.
        </div>
      )}
      <h3>Kiện hàng hoàn</h3>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Vận đơn / hãng</th>
              <th>Nhận kiện</th>
              <th>Thao tác</th>
            </tr>
          </thead>
          <tbody>
            {data.parcels.map((p: Row) => (
              <tr key={p.id}>
                <td>
                  {p.tracking_code}
                  <small className="block">
                    {p.identification?.carrier ?? p.carrier ?? "Chưa xác định"}{" "}
                    {!p.active ? "· Đã loại bỏ" : ""}
                  </small>
                </td>
                <td>
                  {p.received_at
                    ? `${formatTime(p.received_at)} · ${p.employee}`
                    : "Chưa nhận"}
                </td>
                <td>
                  {manager && p.active && (
                    <>
                      <select
                        aria-label={"Hãng của vận đơn hoàn " + p.tracking_code}
                        value={parcelCarriers[p.id]}
                        onChange={(e) =>
                          setParcelCarriers({
                            ...parcelCarriers,
                            [p.id]: e.target.value,
                          })
                        }
                      >
                        <option value="">Chưa xác minh hãng</option>
                        <OptionList rows={refs.carriers} />
                      </select>
                      <button
                        className="secondary small"
                        disabled={busy || note.trim().length < 8}
                        onClick={() =>
                          save("parcel", {
                            caseId: r.id,
                            id: p.id,
                            carrierId: parcelCarriers[p.id] || null,
                            reason: note,
                          })
                        }
                      >
                        Lưu hãng đã xác minh
                      </button>
                    </>
                  )}
                  {manager && !p.active && (
                    <button
                      disabled={busy || note.trim().length < 8}
                      className="secondary small"
                      onClick={() =>
                        save("parcel", {
                          caseId: r.id,
                          id: p.id,
                          exclude: false,
                          reason: note,
                        })
                      }
                    >
                      Khôi phục mã đã loại
                    </button>
                  )}
                  {manager && p.active && !p.received_at && (
                    <button
                      disabled={busy}
                      className="secondary small"
                      onClick={() =>
                        save("parcel", {
                          caseId: r.id,
                          id: p.id,
                          exclude: true,
                          reason: note,
                        })
                      }
                    >
                      Loại bỏ mã sai
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!data.parcels.length && (
        <p>Chưa có mã vận đơn từ nguồn. Hồ sơ vẫn được giữ.</p>
      )}
      {manager && (
        <div className="form-grid">
          <label className="field">
            Bổ sung mã vận đơn hoàn
            <input
              value={tracking}
              onChange={(e) => setTracking(e.target.value)}
            />
          </label>
          <label className="field">
            Hãng đã xác minh
            <select
              value={carrier}
              onChange={(e) => setCarrier(e.target.value)}
            >
              <option value="">Chưa rõ hãng</option>
              <OptionList rows={refs.carriers} />
            </select>
          </label>
          <button
            disabled={busy || !tracking}
            className="secondary"
            onClick={() =>
              save("parcel", {
                caseId: r.id,
                tracking,
                carrierId: carrier || null,
                reason: note,
              })
            }
          >
            Lưu mã hoàn bổ sung
          </button>
        </div>
      )}
      <h3>Kiểm đếm từng SKU</h3>
      <p>
        Nhập số đã kiểm thực tế, không mặc định bằng số nguồn. Không cộng tồn
        kho tự động.
      </p>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>SKU / sản phẩm / phân loại</th>
              <th>Yêu cầu</th>
              <th>Thực nhận</th>
            </tr>
          </thead>
          <tbody>
            {active.map((i: Row) => (
              <tr key={i.id}>
                <td>
                  {i.seller_sku || i.sku_id}
                  <small className="block">
                    {i.name} · {i.variant}
                  </small>
                </td>
                <td>{i.expected_qty}</td>
                <td>
                  <input
                    type="number"
                    min="0"
                    max="100000"
                    aria-label={"Thực nhận SKU " + i.sku_id}
                    value={qty[i.id]}
                    onChange={(e) => setQty({ ...qty, [i.id]: e.target.value })}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ReturnStatus kind="warehouse" value={condition} />
      <label className="field">
        Tình trạng kiểm hàng
        <select
          value={condition}
          onChange={(e) => setCondition(e.target.value)}
        >
          {Object.entries(returnInspection)
            .filter(([k]) => k !== "pending")
            .map(([k, l]) => (
              <option key={k} value={k}>
                {l}
              </option>
            ))}
        </select>
      </label>
      <label className="field">
        Vị trí hàng hoàn
        <input value={location} onChange={(e) => setLocation(e.target.value)} />
      </label>
      <label className="field">
        Ghi chú / lý do thao tác
        <textarea
          value={note}
          minLength={8}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Nhập lý do cụ thể; dùng cho thao tác lưu bên dưới"
        />
      </label>
      <button
        disabled={busy || note.trim().length < 8}
        onClick={() =>
          save("inspect", {
            id: r.id,
            version: r.version,
            condition,
            location,
            note,
            items: active.map((i: Row) => ({
              id: i.id,
              quantity: Number(qty[i.id]),
            })),
          })
        }
      >
        Lưu kiểm nhận sản phẩm
      </button>
      {manager && (
        <div className="form-grid">
          <ReturnStatus value={status} />
          <label className="field">
            Trạng thái xử lý nội bộ
            <select value={status} onChange={(e) => setStatus(e.target.value)}>
              {Object.entries(returnProcessing).map(([k, l]) => (
                <option key={k} value={k}>
                  {l}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            Người phụ trách
            <select
              value={assigned}
              onChange={(e) => setAssigned(e.target.value)}
            >
              <option value="">Chưa phân công</option>
              <OptionList rows={refs.users} />
            </select>
          </label>
          <label className="field">
            Ngày dự kiến hàng về
            <input
              type="date"
              value={expected}
              onChange={(e) => setExpected(e.target.value)}
            />
          </label>
          <label className="inline">
            <input
              type="checkbox"
              checked={noPhysical}
              onChange={(e) => setNoPhysical(e.target.checked)}
            />
            Xác minh không yêu cầu trả hàng vật lý
          </label>
        </div>
      )}
      <button
        disabled={busy || note.trim().length < 8}
        className="secondary"
        onClick={() =>
          save("update", {
            id: r.id,
            version: r.version,
            note,
            ...(manager
              ? {
                  status,
                  assignedTo: assigned,
                  expectedAt: expected,
                  noPhysical,
                }
              : {}),
          })
        }
      >
        Lưu ghi chú / trạng thái
      </button>
      <h3>Khiếu nại và tiền bồi thường</h3>
      {data.claims.map((c: Row) => (
        <div className="notice" key={c.id}>
          <span
            className={
              "return-status " +
              (
                {
                  open: "attention",
                  submitted: "waiting",
                  won: "success",
                  lost: "danger",
                  paid: "success",
                  closed: "neutral",
                } as Row
              )[c.status]
            }
          >
            {
              (
                {
                  open: "Đang khiếu nại",
                  submitted: "Đã gửi",
                  won: "Thành công · chờ đối soát tiền",
                  lost: "Không thành công",
                  paid: "Đã ghi nhận bồi thường",
                  closed: "Đã đóng",
                } as Row
              )[c.status]
            }
          </span>{" "}
          · {c.reason}
          <br />
          Yêu cầu {money(c.requested_amount)} · Duyệt {money(c.approved_amount)}{" "}
          · Thực nhận {money(c.received_amount)}
          {manager && (
            <button
              className="secondary small"
              onClick={() =>
                setClaim({
                  id: c.id,
                  status: c.status,
                  reason: c.reason,
                  deadline: c.deadline?.slice(0, 10) ?? "",
                  requested: c.requested_amount ?? "",
                  approved: c.approved_amount ?? "",
                  received: c.received_amount ?? "",
                  receivedOn: c.received_on?.slice(0, 10) ?? "",
                })
              }
            >
              Cập nhật hồ sơ
            </button>
          )}
        </div>
      ))}
      {manager && (
        <details>
          <summary>
            {claim.id ? "Cập nhật khiếu nại" : "Tạo hồ sơ khiếu nại"}
          </summary>
          <div className="form-grid">
            <label className="field">
              Trạng thái khiếu nại
              <select
                value={claim.status}
                onChange={(e) => setClaim({ ...claim, status: e.target.value })}
              >
                {[
                  ["open", "Đang xử lý"],
                  ["submitted", "Đã gửi"],
                  ["won", "Thành công · chưa xác nhận tiền"],
                  ["lost", "Thất bại"],
                  ["paid", "Đã nhận bồi thường"],
                  ["closed", "Đóng hồ sơ"],
                ].map(([k, l]) => (
                  <option value={k} key={k}>
                    {l}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              Lý do khiếu nại
              <textarea
                value={claim.reason}
                onChange={(e) => setClaim({ ...claim, reason: e.target.value })}
              />
            </label>
            {[
              ["requested", "Tiền yêu cầu (VND)"],
              ["approved", "Tiền được duyệt (VND)"],
              ["received", "Tiền thực nhận (VND)"],
            ].map(([k, l]) => (
              <label className="field" key={k}>
                {l}
                <input
                  type="number"
                  min="0"
                  value={claim[k]}
                  onChange={(e) => setClaim({ ...claim, [k]: e.target.value })}
                />
              </label>
            ))}
            <label className="field">
              Hạn phản hồi
              <input
                type="date"
                value={claim.deadline}
                onChange={(e) =>
                  setClaim({ ...claim, deadline: e.target.value })
                }
              />
            </label>
            <label className="field">
              Ngày thực nhận bồi thường
              <input
                type="date"
                value={claim.receivedOn}
                onChange={(e) =>
                  setClaim({ ...claim, receivedOn: e.target.value })
                }
              />
            </label>
          </div>
          <button
            disabled={busy || claim.reason.trim().length < 8}
            onClick={() =>
              save("claim", {
                caseId: r.id,
                ...(claim.id ? { id: claim.id } : {}),
                status: claim.status,
                reason: claim.reason,
                deadline: claim.deadline || null,
                requested:
                  claim.requested === "" ? null : Number(claim.requested),
                approved: claim.approved === "" ? null : Number(claim.approved),
                received: claim.received === "" ? null : Number(claim.received),
                receivedOn: claim.receivedOn || null,
              })
            }
          >
            Lưu hồ sơ khiếu nại
          </button>
          <button className="secondary" onClick={() => setClaim(blankClaim)}>
            Hồ sơ mới
          </button>
        </details>
      )}
      <h3>Bằng chứng</h3>
      <label className="field">
        Đính kèm ảnh hoặc PDF · tối đa 5 MB/file
        <input
          disabled={busy}
          type="file"
          accept="image/png,image/jpeg,application/pdf"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void onEvidence(file);
            e.target.value = "";
          }}
        />
      </label>
      {data.evidence.map((e: Row) => (
        <p key={e.id}>
          <a href={"/api/returns/evidence/" + e.id}>{e.filename}</a> ·{" "}
          {formatTime(e.created_at)}
        </p>
      ))}
      <details>
        <summary>Dữ liệu sàn gốc · không thay thế trạng thái kho</summary>
        {r.source_data.map((source: Row, i: number) => (
          <dl key={i}>
            {Object.entries(source.raw).map(([key, value]) => (
              <div className="return-raw" key={key}>
                <dt>{key}</dt>
                <dd>{String(value || "—")}</dd>
              </div>
            ))}
          </dl>
        ))}
      </details>
      <h3>Nhật ký thao tác</h3>
      <ReturnEvents events={data.events} />
    </div>
  );
}
