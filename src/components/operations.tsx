"use client";
import { useEffect, useState } from "react";
import {
  Search,
  ChevronLeft,
  ChevronRight,
  ArrowUpRight,
  Truck,
  Check,
  FileCheck2,
} from "lucide-react";
import { todayVN, formatTime, statuses, filterStatuses } from "@/lib/domain";
import {
  useData,
  post,
  refresh,
  toast,
  Loading,
  ErrorBox,
  Empty,
  Badge,
  Modal,
  ExportButtons,
  OptionList,
  useCatalogSelection,
  type Row,
} from "./shared";
import { SourceReconciliation } from "./source-manifests";
export function Shipments({
  query,
  selectable = false,
  onSelect,
}: {
  query: string;
  selectable?: boolean;
  onSelect?: (rows: Row[]) => void;
}) {
  const [page, setPage] = useState(1),
    [search, setSearch] = useState(""),
    [status, setStatus] = useState(""),
    [sort, setSort] = useState("due_date"),
    [detail, setDetail] = useState(""),
    [selected, setSelected] = useState<Row[]>([]);
  const params = new URLSearchParams(query);
  const baseStatus = params.get("status") ?? "";
  params.set("page", String(page));
  if (search) params.set("q", search);
  if (status) params.set("status", status);
  params.set("sort", sort);
  const { data, error, loading } = useData<Row>(
    "shipments?" + params.toString(),
    5000,
  );
  useEffect(() => {
    if (data && page > Math.max(1, Math.ceil(data.total / 50)))
      setPage(Math.max(1, Math.ceil(data.total / 50)));
    if (!selectable || !data) return;
    const next = selected.filter((s) =>
      data.rows.some(
        (r: Row) => r.id === s.id && r.status === "scanned" && !r.handed_at,
      ),
    );
    if (next.length !== selected.length) {
      setSelected(next);
      onSelect?.(next);
    }
  }, [data, page, selectable, selected, onSelect]);
  const select = (s: Row, checked: boolean) => {
    const next = checked
      ? [...selected, s]
      : selected.filter((v) => v.id !== s.id);
    setSelected(next);
    onSelect?.(next);
  };
  return (
    <section className="card">
      <div className="list-toolbar">
        <div className="inline wrap">
          <label className="search-input">
            <Search size={16} />
            <input
              aria-label="Tìm vận đơn"
              placeholder="Tìm mã vận đơn, mã đơn…"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
                setSelected([]);
                onSelect?.([]);
              }}
            />
          </label>
          {baseStatus ? (
            <span className="badge orange">
              {filterStatuses[baseStatus] ?? baseStatus}
            </span>
          ) : (
            <select
              aria-label="Trạng thái vận đơn"
              value={status}
              onChange={(e) => {
                setStatus(e.target.value);
                setPage(1);
              }}
            >
              <option value="">Tất cả trạng thái</option>
              {Object.entries(filterStatuses).map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </select>
          )}
          <select
            aria-label="Sắp xếp"
            value={sort}
            onChange={(e) => {
              setSort(e.target.value);
              setPage(1);
              setSelected([]);
              onSelect?.([]);
            }}
          >
            <option value="due_date">Ngày cần xuất ↓</option>
            <option value="scanned_at">Thời gian quét ↓</option>
            <option value="tracking_code">Mã vận đơn ↓</option>
          </select>
        </div>
        <ExportButtons query={params.toString()} />
      </div>
      <ErrorBox message={error} />
      {selectable && (
        <div className="notice">
          Đã chọn {selected.length} kiện. Chọn các kiện cùng hãng và kho; chỉ
          chọn trong trang đang hiển thị.
        </div>
      )}
      {loading && !data ? (
        <Loading />
      ) : (
        <>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  {selectable && <th>CHỌN</th>}
                  <th>VẬN ĐƠN / MÃ ĐƠN</th>
                  <th>SÀN / SHOP</th>
                  <th>HÃNG VẬN CHUYỂN</th>
                  <th>TRẠNG THÁI</th>
                  <th>NHÂN VIÊN / CA</th>
                  <th>THỜI GIAN QUÉT</th>
                  <th>BÀN GIAO</th>
                </tr>
              </thead>
              <tbody>
                {data?.rows.map((s: Row) => (
                  <tr key={s.id}>
                    {selectable && (
                      <td>
                        <input
                          type="checkbox"
                          aria-label={"Chọn " + s.tracking_code}
                          checked={selected.some((v) => v.id === s.id)}
                          onChange={(e) => select(s, e.target.checked)}
                          disabled={
                            !s.scanned_at ||
                            s.handed_at ||
                            s.status !== "scanned"
                          }
                        />
                      </td>
                    )}
                    <td>
                      <button
                        className="code-link"
                        onClick={() => setDetail(s.id)}
                      >
                        {s.tracking_code}
                        <ArrowUpRight size={13} />
                      </button>
                      <small>{s.external_id}</small>
                    </td>
                    <td>
                      <strong>{s.channel}</strong>
                      <small>{s.shop}</small>
                    </td>
                    <td>
                      {s.carrier}
                      <small>{s.warehouse}</small>
                    </td>
                    <td>
                      <Badge status={s.status} />
                    </td>
                    <td>
                      {s.employee ?? "—"}
                      <small>{s.shift ?? "Chưa quét"}</small>
                    </td>
                    <td className="nowrap">{formatTime(s.scanned_at)}</td>
                    <td>
                      {formatTime(s.handed_at)}
                      <small>{s.handover_employee}</small>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {data?.rows.length === 0 && <Empty />}
          </div>
          <div className="pagination">
            <span>{data?.total ?? 0} vận đơn · Tối đa 50 dòng / trang</span>
            <div className="inline">
              <button
                className="icon-button"
                disabled={page <= 1}
                aria-label="Trang trước"
                onClick={() => {
                  setPage(page - 1);
                  setSelected([]);
                  onSelect?.([]);
                }}
              >
                <ChevronLeft size={17} />
              </button>
              <span>Trang {page}</span>
              <button
                className="icon-button"
                disabled={page * 50 >= (data?.total ?? 0)}
                aria-label="Trang tiếp"
                onClick={() => {
                  setPage(page + 1);
                  setSelected([]);
                  onSelect?.([]);
                }}
              >
                <ChevronRight size={17} />
              </button>
            </div>
          </div>
        </>
      )}
      {detail && <ShipmentDetail id={detail} onClose={() => setDetail("")} />}
    </section>
  );
}
function ShipmentDetail({ id, onClose }: { id: string; onClose: () => void }) {
  const { data, error, loading } = useData<Row>("shipments/" + id);
  const [status, setStatus] = useState("review"),
    [reason, setReason] = useState(""),
    [busy, setBusy] = useState(false);
  return (
    <Modal title="Chi tiết vận đơn" onClose={onClose}>
      <ErrorBox message={error} />
      {loading ? (
        <Loading />
      ) : (
        data && (
          <>
            <div className="detail-hero">
              <h2>{data.shipment.tracking_code}</h2>
              <Badge status={data.shipment.status} />
            </div>
            <dl className="details-grid">
              {[
                ["Mã đơn", data.shipment.external_id],
                [
                  "Sàn / shop",
                  data.shipment.channel + " / " + data.shipment.shop,
                ],
                ["Hãng vận chuyển", data.shipment.carrier],
                ["Kho", data.shipment.warehouse],
                ["Quét lúc", formatTime(data.shipment.scanned_at)],
                ["Nhân viên quét", data.shipment.employee ?? "—"],
                ["Bàn giao lúc", formatTime(data.shipment.handed_at)],
                ["Người bàn giao", data.shipment.handover_employee ?? "—"],
              ].map(([k, v]) => (
                <div key={k}>
                  <dt>{k}</dt>
                  <dd>{v}</dd>
                </div>
              ))}
            </dl>
            <h3>Sản phẩm của đơn (toàn bộ kiện)</h3>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>SKU</th>
                    <th>SẢN PHẨM</th>
                    <th>MÀU / SIZE</th>
                    <th>SL</th>
                  </tr>
                </thead>
                <tbody>
                  {data.items.map((i: Row) => (
                    <tr key={i.id}>
                      <td>{i.sku}</td>
                      <td>{i.name}</td>
                      <td>
                        {i.color} / {i.size}
                      </td>
                      <td>{i.quantity}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <h3>Lịch sử quét · không xóa</h3>
            <div className="timeline">
              {data.events.map((e: Row) => (
                <div key={e.id}>
                  <Badge status={e.outcome} />
                  <strong>{e.employee}</strong>
                  <small>
                    {formatTime(e.created_at)} · {e.method} · {e.id}
                  </small>
                </div>
              ))}
            </div>
            <h3>Điều chỉnh có kiểm soát</h3>
            <form
              className="form-grid"
              onSubmit={async (e) => {
                e.preventDefault();
                setBusy(true);
                try {
                  await post("shipments/adjust", { id, status, reason });
                  toast("Đã ghi nhận điều chỉnh và nhật ký");
                  refresh();
                  setReason("");
                } catch (e) {
                  toast((e as Error).message, true);
                } finally {
                  setBusy(false);
                }
              }}
            >
              <label className="field">
                Trạng thái
                <select
                  value={status}
                  onChange={(e) => setStatus(e.target.value)}
                >
                  {[
                    "review",
                    "blocked",
                    "cancelled",
                    "awaiting_scan",
                    "scanned",
                  ].map((s) => (
                    <option value={s} key={s}>
                      {statuses[s]}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                Lý do (ít nhất 8 ký tự)
                <input
                  required
                  minLength={8}
                  maxLength={1000}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                />
              </label>
              <button className="primary" disabled={busy}>
                Ghi nhận điều chỉnh
              </button>
            </form>
            <h3>Nhật ký thay đổi</h3>
            <div className="timeline">
              {data.logs.map((a: Row) => (
                <div key={a.id}>
                  <strong>{a.action}</strong>
                  <span>
                    {a.employee} · {a.reason}
                  </span>
                  <small>{formatTime(a.created_at)}</small>
                  <details>
                    <summary>Giá trị trước / sau</summary>
                    <pre>
                      {JSON.stringify(
                        { before: a.before_value, after: a.after_value },
                        null,
                        2,
                      )}
                    </pre>
                  </details>
                </div>
              ))}
            </div>
          </>
        )
      )}
    </Modal>
  );
}
export function Reconciliation({
  initialTab = "unscanned",
}: {
  initialTab?: string;
}) {
  const [tab, setTab] = useState(initialTab),
    [from, setFrom] = useState(todayVN()),
    [to, setTo] = useState(todayVN());
  return (
    <>
      <div className="tabbar">
        <button
          className={tab === "sources" ? "selected" : ""}
          onClick={() => setTab("sources")}
        >
          Theo file nguồn PDF
        </button>
        <button
          className={tab === "unscanned" ? "selected" : ""}
          onClick={() => setTab("unscanned")}
        >
          Dự kiến chưa tít
        </button>
        <button
          className={tab === "waiting" ? "selected" : ""}
          onClick={() => setTab("waiting")}
        >
          Đã tít, chưa bàn giao
        </button>
        <button
          className={tab === "exceptions" ? "selected" : ""}
          onClick={() => setTab("exceptions")}
        >
          Ngoại lệ cần đối soát
        </button>
        <button
          className={tab === "events" ? "selected" : ""}
          onClick={() => setTab("events")}
        >
          Nhật ký lượt quét
        </button>
      </div>
      {tab === "sources" ? (
        <SourceReconciliation />
      ) : tab === "events" ? (
        <ScanHistory />
      ) : tab !== "exceptions" ? (
        <>
          <div className="filters inline">
            <label>
              Từ{" "}
              <input
                type="date"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
              />
            </label>
            <label>
              Đến{" "}
              <input
                type="date"
                value={to}
                onChange={(e) => setTo(e.target.value)}
              />
            </label>
          </div>
          <Shipments
            key={tab + from + to}
            query={new URLSearchParams({ from, to, status: tab }).toString()}
          />
        </>
      ) : (
        <Exceptions />
      )}
    </>
  );
}
function ScanHistory() {
  const [outcome, setOutcome] = useState("duplicate");
  const { data, error, loading } = useData<Row[]>(
    "scans/history?outcome=" + outcome,
    5000,
  );
  return (
    <section className="card">
      <div className="card-heading">
        <div>
          <h2>Nhật ký lượt quét</h2>
          <p>500 sự kiện gần nhất · Mỗi lần thử là một sự kiện riêng</p>
        </div>
        <select
          aria-label="Lọc kết quả quét"
          value={outcome}
          onChange={(e) => setOutcome(e.target.value)}
        >
          <option value="">Tất cả kết quả</option>
          <option value="duplicate">Quét trùng</option>
          <option value="unknown">Chưa xác định</option>
          <option value="success">Thành công</option>
          <option value="cancelled">Đơn hủy</option>
          <option value="blocked">Bị chặn</option>
          <option value="carrier_mismatch">Sai hãng</option>
          <option value="warehouse_mismatch">Sai kho</option>
          <option value="invalid">Mã sai</option>
        </select>
      </div>
      <ErrorBox message={error} />
      {loading && !data ? (
        <Loading />
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>MÃ THÔ</th>
                <th>KẾT QUẢ</th>
                <th>NHÂN VIÊN</th>
                <th>THỜI GIAN</th>
                <th>KHO / CA</th>
                <th>PHƯƠNG THỨC</th>
              </tr>
            </thead>
            <tbody>
              {data?.map((e) => (
                <tr key={e.id}>
                  <td>
                    {e.raw_code}
                    <small>{e.id}</small>
                  </td>
                  <td>
                    <Badge status={e.outcome} />
                  </td>
                  <td>{e.employee}</td>
                  <td>{formatTime(e.created_at)}</td>
                  <td>
                    {e.warehouse}
                    <small>{e.shift}</small>
                  </td>
                  <td>{e.method}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!data?.length && <Empty />}
        </div>
      )}
    </section>
  );
}
function Exceptions() {
  const { data, error, loading } = useData<Row[]>("exceptions", 5000);
  const [selected, setSelected] = useState<Row | null>(null),
    [reason, setReason] = useState(""),
    [busy, setBusy] = useState(false);
  return (
    <section className="card">
      <div className="card-heading">
        <div>
          <h2>Ngoại lệ vận hành</h2>
          <p>500 trường hợp gần nhất · không âm thầm bỏ qua mã lạ</p>
        </div>
        <ExportButtons query="type=exceptions" />
      </div>
      <ErrorBox message={error} />
      {loading && !data ? (
        <Loading />
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>MÃ ĐÃ QUÉT</th>
                <th>NGUYÊN NHÂN</th>
                <th>NHÂN VIÊN / THỜI GIAN</th>
                <th>TRẠNG THÁI</th>
                <th>XỬ LÝ</th>
              </tr>
            </thead>
            <tbody>
              {data?.map((x) => (
                <tr key={x.id}>
                  <td>
                    <strong>{x.tracking_code ?? x.raw_code}</strong>
                  </td>
                  <td>
                    <Badge status={x.kind} />
                  </td>
                  <td>
                    {x.employee}
                    <small>{formatTime(x.created_at)}</small>
                  </td>
                  <td>
                    <Badge status={x.status} />
                  </td>
                  <td>
                    {x.status === "open" ? (
                      <button
                        className="secondary small"
                        onClick={() => {
                          setSelected(x);
                          setReason("");
                        }}
                      >
                        Ghi nhận xử lý
                      </button>
                    ) : (
                      x.reason
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!data?.length && <Empty text="Không có ngoại lệ nào" />}
        </div>
      )}
      {selected && (
        <Modal
          title="Ghi nhận xử lý ngoại lệ"
          onClose={() => setSelected(null)}
        >
          <p>
            Thao tác này lưu kết quả đối soát; không tự ghi nhận quét thành công
            hoặc bàn giao.
          </p>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              try {
                await post("exceptions/resolve", { id: selected.id, reason });
                refresh();
                setSelected(null);
                toast("Đã lưu kết quả xử lý ngoại lệ");
              } catch (e) {
                toast((e as Error).message, true);
              } finally {
                setBusy(false);
              }
            }}
          >
            <label className="field">
              Lý do / kết quả đối chiếu
              <textarea
                minLength={8}
                maxLength={1000}
                required
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
            </label>
            <button className="primary" disabled={busy}>
              Xác nhận đã kiểm tra
            </button>
          </form>
        </Modal>
      )}
    </section>
  );
}
export function Handovers({ refs }: { refs: Row }) {
  const { data: batches, error } = useData<Row[]>("handovers", 5000);
  const [carrier, setCarrier] = useCatalogSelection(refs.carriers);
  const [warehouse, setWarehouse] = useCatalogSelection(refs.warehouses);
  const [create, setCreate] = useState(false),
    [selected, setSelected] = useState<Row[]>([]),
    [note, setNote] = useState(""),
    [from, setFrom] = useState(todayVN()),
    [to, setTo] = useState(todayVN()),
    [busy, setBusy] = useState(false),
    [confirm, setConfirm] = useState<Row | null>(null),
    [cancel, setCancel] = useState<Row | null>(null),
    [cancelReason, setCancelReason] = useState("");
  return (
    <>
      <div className="notice warning">
        <Truck size={20} /> Đây là ghi nhận bàn giao nội bộ. Không phải xác nhận
        giao nhận chính thức từ hãng vận chuyển.
      </div>
      <section className="card">
        <div className="card-heading">
          <div>
            <h2>Phiếu bàn giao</h2>
            <p>Chỉ chuyển “Đã bàn giao” khi quản lý xác nhận hợp lệ</p>
          </div>
          <button className="primary" onClick={() => setCreate(!create)}>
            <FileCheck2 size={17} />
            {create ? "Đóng tạo phiếu" : "Tạo phiếu bàn giao"}
          </button>
        </div>
        <ErrorBox message={error} />
        {create && (
          <div className="handover-create">
            <div className="form-grid">
              <label className="field">
                Hãng vận chuyển
                <select
                  value={carrier}
                  onChange={(e) => {
                    setCarrier(e.target.value);
                    setSelected([]);
                  }}
                >
                  <OptionList rows={refs.carriers} />
                </select>
              </label>
              <label className="field">
                Kho
                <select
                  value={warehouse}
                  onChange={(e) => {
                    setWarehouse(e.target.value);
                    setSelected([]);
                  }}
                >
                  <OptionList rows={refs.warehouses} />
                </select>
              </label>
              <label className="field">
                Ngày cần xuất từ
                <input
                  type="date"
                  value={from}
                  onChange={(e) => {
                    setFrom(e.target.value);
                    setSelected([]);
                  }}
                />
              </label>
              <label className="field">
                Đến ngày
                <input
                  type="date"
                  value={to}
                  onChange={(e) => {
                    setTo(e.target.value);
                    setSelected([]);
                  }}
                />
              </label>
              <label className="field full">
                Ghi chú / sai lệch
                <input
                  value={note}
                  maxLength={1000}
                  onChange={(e) => setNote(e.target.value)}
                />
              </label>
            </div>
            <Shipments
              key={carrier + warehouse + from + to}
              selectable
              query={new URLSearchParams({
                from,
                to,
                carrier,
                warehouse,
                status: "scanned",
              }).toString()}
              onSelect={setSelected}
            />
            <button
              className="primary"
              disabled={!selected.length || busy || !warehouse || !carrier}
              onClick={async () => {
                setBusy(true);
                try {
                  await post("handovers", {
                    carrierId: carrier,
                    warehouseId: warehouse,
                    shipmentIds: selected.map((s) => s.id),
                    note,
                  });
                  setCreate(false);
                  setSelected([]);
                  refresh();
                  toast("Đã tạo phiếu nháp. Chưa xác nhận bàn giao.");
                } catch (e) {
                  toast((e as Error).message, true);
                } finally {
                  setBusy(false);
                }
              }}
            >
              Tạo phiếu nháp · {selected.length} kiện
            </button>
          </div>
        )}
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>MÃ PHIẾU</th>
                <th>HÃNG / KHO</th>
                <th>SỐ KIỆN</th>
                <th>NGƯỜI TẠO</th>
                <th>TRẠNG THÁI</th>
                <th>THAO TÁC</th>
              </tr>
            </thead>
            <tbody>
              {batches?.map((b) => (
                <tr key={b.id}>
                  <td>
                    <strong>BG-{b.id.slice(0, 8).toUpperCase()}</strong>
                    <small>{formatTime(b.created_at)}</small>
                  </td>
                  <td>
                    {b.carrier}
                    <small>{b.warehouse}</small>
                  </td>
                  <td>
                    <b>{b.packages}</b>
                  </td>
                  <td>
                    {b.employee}
                    <small>{b.note}</small>
                  </td>
                  <td>
                    <Badge
                      status={b.status}
                      label={
                        b.status === "cancelled" ? "Phiếu đã hủy" : undefined
                      }
                    />
                    <small>{formatTime(b.confirmed_at)}</small>
                  </td>
                  <td>
                    <div className="inline">
                      {b.status === "draft" && (
                        <button
                          className="secondary small"
                          disabled={busy}
                          onClick={() => {
                            setCancel(b);
                            setCancelReason("");
                          }}
                        >
                          Hủy nháp
                        </button>
                      )}
                      {b.status === "draft" && (
                        <button
                          className="secondary small"
                          onClick={() => setConfirm(b)}
                        >
                          <Check size={14} /> Xác nhận
                        </button>
                      )}
                      <ExportButtons query={"type=handover&batch=" + b.id} />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {batches?.length === 0 && <Empty />}
        </div>
      </section>
      {cancel && (
        <Modal title="Hủy phiếu bàn giao nháp" onClose={() => setCancel(null)}>
          <p>
            Phiếu BG-{cancel.id.slice(0, 8).toUpperCase()} sẽ được giữ trong
            lịch sử. {cancel.packages} kiện trở về trạng thái Đã tít để kiểm tra
            hoặc lập phiếu mới.
          </p>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              try {
                await post("handovers/cancel", {
                  id: cancel.id,
                  reason: cancelReason,
                });
                setCancel(null);
                refresh();
                toast(
                  "Đã hủy nháp và giải phóng các kiện; lịch sử được giữ nguyên",
                );
              } catch (e) {
                toast((e as Error).message, true);
              } finally {
                setBusy(false);
              }
            }}
          >
            <label className="field">
              Lý do hủy nháp
              <input
                required
                minLength={8}
                maxLength={1000}
                value={cancelReason}
                onChange={(e) => setCancelReason(e.target.value)}
              />
            </label>
            <button className="primary" disabled={busy}>
              Xác nhận hủy nháp
            </button>
          </form>
        </Modal>
      )}
      {confirm && (
        <Modal
          title="Xác nhận bàn giao thực tế"
          onClose={() => setConfirm(null)}
        >
          <p>
            Bạn xác nhận đã bàn giao <strong>{confirm.packages} kiện</strong>{" "}
            cho <strong>{confirm.carrier}</strong>?
          </p>
          <div className="notice warning">
            Thời gian và người xác nhận sẽ được lưu vào nhật ký bàn giao nội bộ.
          </div>
          <button
            className="primary"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await post("handovers/confirm", { id: confirm.id });
                setConfirm(null);
                refresh();
                toast("Đã xác nhận bàn giao nội bộ");
              } catch (e) {
                toast((e as Error).message, true);
              } finally {
                setBusy(false);
              }
            }}
          >
            Xác nhận đã bàn giao
          </button>
        </Modal>
      )}
    </>
  );
}
