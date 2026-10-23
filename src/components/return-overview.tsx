import { useState } from "react";
import {
  Package,
  PackageCheck,
  Clock3,
  ShieldAlert,
  BadgeCheck,
  ClipboardCheck,
  ArrowUpRight,
  RefreshCw,
  Truck,
} from "lucide-react";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  CartesianGrid,
} from "recharts";
import { post, refresh, toast, Empty, type Row } from "./shared";

const number = (value: unknown) => Number(value ?? 0).toLocaleString("vi-VN");
const money = (value: unknown) =>
  Number(value ?? 0).toLocaleString("vi-VN") + " ₫";
export function ReturnOverview({
  data,
  onNavigate,
  onReload,
}: {
  data: Row;
  onNavigate: (state: string, carrier?: string) => void;
  onReload: () => void;
}) {
  const totals = data.totals;
  const [days, setDays] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const physical = Number(totals.received) + Number(totals.unreceived);
  const rate = physical
    ? Math.round((Number(totals.received) / physical) * 100)
    : null;
  const cards = [
    ["requests", "Tổng đơn hoàn", Package, "Yêu cầu hoàn duy nhất", ""],
    [
      "received",
      "Đơn hoàn đã về kho",
      PackageCheck,
      "Đã tít nhận ít nhất một kiện",
      "received",
    ],
    [
      "unreceived",
      "Đơn hoàn còn thiếu",
      Clock3,
      "Chưa nhận kiện · cần theo dõi",
      "unreceived",
    ],
    ["lost", "Đơn bị mất", ShieldAlert, "Trạng thái đã xác nhận mất", "lost"],
    [
      "claim_success",
      "Khiếu nại thành công",
      BadgeCheck,
      "Đã thắng / được bồi hoàn",
      "claim_success",
    ],
    [
      "waiting_inspection",
      "Chờ kiểm hàng",
      ClipboardCheck,
      "Đã nhận · chưa kiểm hoặc cần kiểm lại",
      "waiting_inspection",
    ],
  ] as const;
  return (
    <div className="return-overview">
      <div className="section-toolbar">
        <span className="live-label">
          <span className="live-dot" /> Tự cập nhật mỗi 5 giây
        </span>
        <button
          className="icon-button"
          aria-label="Làm mới tổng quan hoàn"
          onClick={onReload}
        >
          <RefreshCw size={17} />
        </button>
      </div>
      <div className="kpi-grid return-overview-kpis">
        {cards.map(([key, label, Icon, caption, state]) => (
          <button
            key={key}
            className={
              "kpi-card " +
              (key === "received" || key === "claim_success"
                ? "return-kpi-success"
                : key === "lost"
                  ? "return-kpi-danger"
                  : key === "unreceived"
                    ? "featured"
                    : "")
            }
            onClick={() => onNavigate(state)}
          >
            <div className="kpi-label">
              {label}
              <span className="kpi-icon">
                <Icon size={20} />
              </span>
            </div>
            <div className="kpi-value">
              {number(totals[key])}
              <ArrowUpRight size={18} />
            </div>
            <div className="kpi-caption">{caption}</div>
          </button>
        ))}
      </div>
      <div className="progress-strip return-progress">
        <div>
          <span className="progress-dot green-bg" />
          <span>Tiến độ nhận hoàn</span>
          <strong>{rate === null ? "Chưa đủ dữ liệu" : rate + "%"}</strong>
          <div className="progress-track green-track">
            <i style={{ width: (rate ?? 0) + "%" }} />
          </div>
        </div>
        <button
          className="text-button"
          onClick={() => onNavigate("partial_receipt")}
        >
          {number(totals.partial_receipt)} đơn nhận một phần{" "}
          <ArrowUpRight size={15} />
        </button>
        <button className="text-button" onClick={() => onNavigate("excluded")}>
          {number(totals.excluded)} đơn hủy / không cần trả hàng
        </button>
      </div>
      <div className="return-overview-main">
        <section className="card return-carrier-panel">
          <div className="card-heading">
            <div>
              <h2>
                <Truck size={19} /> Đơn hoàn theo hãng vận chuyển
              </h2>
              <p>Bấm tên hãng hoặc số đơn để mở danh sách và xử lý.</p>
            </div>
          </div>
          {data.carriers?.length ? (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>HÃNG / TỶ TRỌNG</th>
                    <th>TỔNG ĐƠN</th>
                    <th>ĐÃ VỀ KHO</th>
                    <th>CÒN THIẾU</th>
                  </tr>
                </thead>
                <tbody>
                  {data.carriers.map((carrier: Row) => {
                    const share = Number(totals.requests)
                      ? (Number(carrier.requests) / Number(totals.requests)) *
                        100
                      : 0;
                    return (
                      <tr key={carrier.id}>
                        <td>
                          <button
                            className="text-button return-carrier-name"
                            onClick={() => onNavigate("", carrier.id)}
                          >
                            {carrier.name}
                            <ArrowUpRight size={15} />
                          </button>
                          <div className="return-carrier-share">
                            <div className="progress-track">
                              <i style={{ width: share + "%" }} />
                            </div>
                            <small>
                              {share.toLocaleString("vi-VN", {
                                maximumFractionDigits: 1,
                              })}
                              %
                            </small>
                          </div>
                        </td>
                        <td data-label="Tổng đơn">
                          <button
                            className="return-count-link"
                            aria-label={`${carrier.name}: ${carrier.requests} tổng đơn`}
                            onClick={() => onNavigate("", carrier.id)}
                          >
                            {number(carrier.requests)}
                          </button>
                        </td>
                        <td data-label="Đã về kho">
                          <button
                            className="return-count-link green-text"
                            aria-label={`${carrier.name}: ${carrier.received} đơn đã về kho`}
                            onClick={() => onNavigate("received", carrier.id)}
                          >
                            {number(carrier.received)}
                          </button>
                        </td>
                        <td data-label="Còn thiếu">
                          <button
                            className="return-count-link orange-text"
                            aria-label={`${carrier.name}: ${carrier.unreceived} đơn còn thiếu`}
                            onClick={() => onNavigate("unreceived", carrier.id)}
                          >
                            {number(carrier.unreceived)}
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <Empty />
          )}
          <p className="small-note return-panel-note">
            Mỗi yêu cầu chỉ thuộc một nhóm. Hồ sơ có nhiều hãng nằm trong “Nhiều
            hãng / cần đối chiếu”; hồ sơ chưa có vận đơn vẫn được tính ở “Chưa
            xác định”.
          </p>
        </section>
        <section className="card return-priority-panel">
          <div className="card-heading">
            <div>
              <h2>Ưu tiên xử lý</h2>
              <p>Những việc cần theo dõi ngay</p>
            </div>
          </div>
          {[
            ["overdue", "Quá mốc chưa về", "overdue"],
            ["open_claims", "Đang khiếu nại", "open_claims"],
            ["missing_tracking", "Chưa có mã vận đơn", "missing_tracking"],
            ["stale", "Nguồn đổi · cần kiểm lại", "stale"],
          ].map(([key, label, state]) => (
            <button
              key={key}
              className="return-priority-row"
              onClick={() => onNavigate(state)}
            >
              <span>{label}</span>
              <strong>{number(totals[key])}</strong>
              <ArrowUpRight size={16} />
            </button>
          ))}
        </section>
      </div>
      <div className="return-overview-main">
        <section className="card chart-card">
          <div className="card-heading">
            <div>
              <h2>Tiến độ theo ngày yêu cầu hoàn</h2>
              <p>
                Trạng thái hiện tại của các đơn thuộc từng ngày · tối đa 60 ngày
                có dữ liệu
              </p>
            </div>
          </div>
          {data.trend?.length ? (
            <div className="chart">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={data.trend}
                  margin={{ left: -20, right: 12, top: 12, bottom: 0 }}
                >
                  <CartesianGrid strokeDasharray="3 4" vertical={false} />
                  <XAxis dataKey="day" tick={{ fontSize: 11 }} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                  <Tooltip />
                  <Legend />
                  <Bar
                    dataKey="requests"
                    name="Tổng đơn hoàn"
                    fill="#f36b2b"
                    radius={[4, 4, 0, 0]}
                    isAnimationActive={false}
                  />
                  <Bar
                    dataKey="received"
                    name="Đã về kho"
                    fill="#16a878"
                    radius={[4, 4, 0, 0]}
                    isAnimationActive={false}
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <Empty />
          )}
        </section>
        <section className="card padded return-finance-panel">
          <h2>Bồi thường & theo dõi</h2>
          <dl>
            {[
              ["claim_requested", "Tiền yêu cầu bồi thường"],
              ["claim_approved", "Tiền được duyệt"],
              ["claim_received", "Tiền đã thực nhận"],
            ].map(([key, label]) => (
              <div key={key}>
                <dt>{label}</dt>
                <dd>{money(totals[key])}</dd>
              </div>
            ))}
          </dl>
          <p className="small-note">
            Tiền thực nhận lấy từ hồ sơ nội bộ, không suy ra từ Refund Time hoặc
            giá sản phẩm.
          </p>
          <label className="field">
            Mốc theo dõi đơn chưa về (ngày)
            <input
              type="number"
              min={1}
              max={90}
              value={days ?? String(data.overdueDays ?? 5)}
              onChange={(e) => setDays(e.target.value)}
            />
          </label>
          <button
            className="secondary small"
            disabled={
              saving ||
              !Number.isInteger(Number(days ?? data.overdueDays)) ||
              Number(days ?? data.overdueDays) < 1 ||
              Number(days ?? data.overdueDays) > 90
            }
            onClick={async () => {
              setSaving(true);
              try {
                await post("returns/settings", {
                  days: Number(days ?? data.overdueDays),
                });
                refresh();
                toast("Đã lưu mốc theo dõi");
              } catch (e) {
                toast((e as Error).message, true);
              } finally {
                setSaving(false);
              }
            }}
          >
            {saving ? "Đang lưu…" : "Lưu mốc theo dõi"}
          </button>
          <p className="small-note">
            Quá mốc chỉ là cảnh báo; hệ thống không tự kết luận mất đơn.
          </p>
        </section>
      </div>
      <details className="card padded return-metric-definitions">
        <summary>Cách tính các chỉ số</summary>
        <p>
          Một đơn ở tổng quan là một yêu cầu hoàn duy nhất, không nhân theo SKU
          hay số kiện. Đã về kho nghĩa là đã tít nhận ít nhất một kiện; đơn nhận
          một phần vẫn cần nhận đủ và kiểm hàng. Còn thiếu là chưa nhận kiện
          nào, loại yêu cầu hủy và không cần trả vật lý. Đơn mất lấy từ trạng
          thái xác nhận mất hiện tại. Khiếu nại thành công tính một lần mỗi đơn
          có hồ sơ thắng/đã trả tiền hoặc trạng thái nội bộ thắng/được bồi hoàn.
          Các nhóm này có thể giao nhau.
        </p>
      </details>
    </div>
  );
}
