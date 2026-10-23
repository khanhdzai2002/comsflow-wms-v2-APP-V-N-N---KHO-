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
import { MetricHelp } from "./metric-help";

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
    [
      "requests",
      "Tổng đơn hoàn",
      Package,
      "Yêu cầu hoàn duy nhất",
      "",
      "Số yêu cầu hoàn khác nhau theo bộ lọc hiện tại. Một đơn mua hàng có thể có nhiều yêu cầu hoàn; không nhân theo SKU hoặc số kiện.",
    ],
    [
      "received",
      "Đơn hoàn đã về kho",
      PackageCheck,
      "Đã tít nhận ít nhất một kiện",
      "received",
      "Yêu cầu đã được tít nhận ít nhất một kiện tại kho. Vẫn có thể còn kiện chưa về hoặc chưa kiểm đủ hàng.",
    ],
    [
      "unreceived",
      "Đơn hoàn chưa về kho",
      Clock3,
      "Chưa tít nhận kiện nào · cần theo dõi",
      "unreceived",
      "Chưa tít nhận kiện nào; loại yêu cầu đã hủy hoặc đã đánh dấu không cần trả hàng. Chưa thể kết luận đơn bị mất.",
    ],
    [
      "lost",
      "Đơn bị mất",
      ShieldAlert,
      "Trạng thái đã xác nhận mất",
      "lost",
      "Yêu cầu có trạng thái nội bộ đã xác nhận mất. Không tự suy ra từ quá hạn hoặc chưa có mã vận đơn hoàn.",
    ],
    [
      "claim_success",
      "Khiếu nại thành công",
      BadgeCheck,
      "Đã thắng / được bồi hoàn",
      "claim_success",
      "Yêu cầu có hồ sơ khiếu nại thắng/đã trả tiền hoặc trạng thái nội bộ thắng/được bồi hoàn. Mỗi yêu cầu tính một lần; tiền thực nhận xem riêng bên dưới.",
    ],
    [
      "waiting_inspection",
      "Chờ kiểm hàng",
      ClipboardCheck,
      "Đã nhận · chưa kiểm hoặc cần kiểm lại",
      "waiting_inspection",
      "Đã nhận ít nhất một kiện nhưng chưa kiểm hàng, hoặc nguồn cập nhật khiến kết quả cũ cần được kiểm lại.",
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
        {cards.map(([key, label, Icon, caption, state, help]) => (
          <div
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
          >
            <button
              type="button"
              className="metric-card-action"
              aria-label={`${label}: ${number(totals[key])}. ${caption}`}
              onClick={() => onNavigate(state)}
            />
            <div className="kpi-label">
              <span className="metric-label">
                {label}
                <MetricHelp label={label}>{help}</MetricHelp>
              </span>
              <span className="kpi-icon">
                <Icon size={20} />
              </span>
            </div>
            <div className="kpi-value">
              {number(totals[key])}
              <ArrowUpRight size={18} />
            </div>
            <div className="kpi-caption">{caption}</div>
          </div>
        ))}
      </div>
      <div className="progress-strip return-progress">
        <div>
          <span className="progress-dot green-bg" />
          <span className="metric-label">
            Tiến độ nhận hoàn
            <MetricHelp label="Tiến độ nhận hoàn">
              Tỷ lệ yêu cầu đã nhận ít nhất một kiện trên tổng hai nhóm đã về
              kho và chưa về kho cần theo dõi.
            </MetricHelp>
          </span>
          <strong>{rate === null ? "Chưa đủ dữ liệu" : rate + "%"}</strong>
          <div className="progress-track green-track">
            <i style={{ width: (rate ?? 0) + "%" }} />
          </div>
        </div>
        <span className="return-progress-metric">
          <button
            className="text-button"
            onClick={() => onNavigate("partial_receipt")}
          >
            {number(totals.partial_receipt)} đơn nhận một phần{" "}
            <ArrowUpRight size={15} />
          </button>
          <MetricHelp label="Đơn nhận một phần">
            Đã nhận ít nhất một kiện, vẫn còn kiện có mã chưa nhận. Chỉ phản ánh
            số kiện; hàng bên trong cần được kiểm riêng.
          </MetricHelp>
        </span>
        <span className="return-progress-metric">
          <button
            className="text-button"
            onClick={() => onNavigate("excluded")}
          >
            {number(totals.excluded)} đơn hủy / không cần trả hàng
          </button>
          <MetricHelp label="Đơn hủy / không cần trả hàng">
            Yêu cầu chưa nhận kiện và đã hủy hoặc được đánh dấu không cần trả
            hàng. Được loại khỏi nhóm chưa về kho cần theo dõi.
          </MetricHelp>
        </span>
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
                    <th>
                      <span className="metric-label">
                        HÃNG / TỶ TRỌNG
                        <MetricHelp label="Tỷ trọng hãng vận chuyển">
                          Số yêu cầu của nhóm hãng chia tổng yêu cầu theo bộ
                          lọc. Mỗi yêu cầu thuộc một nhóm; nhiều hãng vào nhóm
                          cần đối chiếu, chưa có mã vào nhóm chưa xác định.
                        </MetricHelp>
                      </span>
                    </th>
                    <th>
                      <span className="metric-label">
                        TỔNG ĐƠN
                        <MetricHelp label="Tổng đơn theo hãng">
                          Số yêu cầu hoàn khác nhau thuộc nhóm hãng này. Bấm số
                          để mở danh sách.
                        </MetricHelp>
                      </span>
                    </th>
                    <th>
                      <span className="metric-label">
                        ĐÃ VỀ KHO
                        <MetricHelp label="Đã về kho theo hãng">
                          Yêu cầu thuộc nhóm hãng này đã tít nhận ít nhất một
                          kiện. Bấm số để mở danh sách.
                        </MetricHelp>
                      </span>
                    </th>
                    <th>
                      <span className="metric-label">
                        CHƯA VỀ KHO
                        <MetricHelp label="Chưa về kho theo hãng">
                          Yêu cầu thuộc nhóm hãng này chưa tít nhận kiện nào,
                          loại yêu cầu hủy hoặc được đánh dấu không cần trả
                          hàng.
                        </MetricHelp>
                      </span>
                    </th>
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
                        <td data-label="Chưa về kho">
                          <button
                            className="return-count-link orange-text"
                            aria-label={`${carrier.name}: ${carrier.unreceived} đơn chưa về kho`}
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
            [
              "overdue",
              "Quá mốc chưa về",
              "overdue",
              "Chưa nhận kiện và đã quá ngày dự kiến hoặc mốc theo dõi bên dưới. Đây là cảnh báo để liên hệ đối soát, chưa phải kết luận mất đơn.",
            ],
            [
              "open_claims",
              "Đang khiếu nại",
              "open_claims",
              "Yêu cầu có hồ sơ khiếu nại đang mở/đã gửi, hoặc đang ở trạng thái nội bộ khiếu nại. Mỗi yêu cầu tính một lần.",
            ],
            [
              "missing_tracking",
              "Chưa có mã vận đơn hoàn",
              "missing_tracking",
              "Yêu cầu chưa có mã vận đơn hoàn đang được theo dõi trong hệ thống. Khác với đã có mã nhưng chưa nhận kiện tại kho.",
            ],
            [
              "stale",
              "Nguồn đổi · cần kiểm lại",
              "stale",
              "Yêu cầu đã được kiểm hàng nhưng dữ liệu nguồn cập nhật ảnh hưởng đến số lượng hoặc kiện hoàn, nên cần kiểm lại.",
            ],
          ].map(([key, label, state, help]) => (
            <div key={key} className="return-priority-row">
              <button
                type="button"
                className="metric-card-action"
                aria-label={`${label}: ${number(totals[key])}`}
                onClick={() => onNavigate(state)}
              />
              <span className="metric-label">
                {label}
                <MetricHelp label={label}>{help}</MetricHelp>
              </span>
              <strong>{number(totals[key])}</strong>
              <ArrowUpRight size={16} />
            </div>
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
              [
                "claim_requested",
                "Tiền yêu cầu bồi thường",
                "Tổng số tiền đề nghị trong các hồ sơ khiếu nại thuộc bộ lọc hiện tại. Chưa phải tiền được duyệt hoặc đã nhận.",
              ],
              [
                "claim_approved",
                "Tiền được duyệt",
                "Tổng số tiền được duyệt ghi trong các hồ sơ khiếu nại thuộc bộ lọc. Có thể chưa được thanh toán.",
              ],
              [
                "claim_received",
                "Tiền đã thực nhận",
                "Tổng tiền thực nhận được ghi trong hồ sơ khiếu nại nội bộ thuộc bộ lọc. Không suy ra từ Refund Time hoặc giá sản phẩm.",
              ],
            ].map(([key, label, help]) => (
              <div key={key}>
                <dt className="metric-label">
                  {label}
                  <MetricHelp label={label}>{help}</MetricHelp>
                </dt>
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
