"use client";
import { useState } from "react";
import {
  Package,
  ScanLine,
  Clock3,
  Truck,
  ArrowUpRight,
  RefreshCw,
  TriangleAlert,
} from "lucide-react";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  BarChart,
  Bar,
  Legend,
} from "recharts";
import {
  useData,
  ErrorBox,
  Loading,
  ExportButtons,
  Empty,
  type Row,
} from "./shared";
export function Dashboard({
  query,
  reports,
  onNavigate,
}: {
  query: string;
  reports: boolean;
  onNavigate: (status: string) => void;
}) {
  const { data, error, loading, reload } = useData<Row>(
    "dashboard?" + query,
    5000,
  );
  const [period, setPeriod] = useState("hours");
  if (loading && !data) return <Loading />;
  if (!data) return <ErrorBox message={error} />;
  const cards = [
    [
      "Vận đơn dự kiến",
      data.eligible,
      Package,
      "Tổng hợp lệ cần xử lý",
      "eligible",
    ],
    [
      "Đã tít thành công",
      data.scanned,
      ScanLine,
      "Vận đơn duy nhất",
      "scanned_any",
    ],
    ["Chưa tít đơn", data.unscanned, Clock3, "Cần tiếp tục xử lý", "unscanned"],
    [
      "Đã bàn giao",
      data.handed,
      Truck,
      "Xác nhận bàn giao nội bộ",
      "handed_over",
    ],
  ] as const;
  return (
    <>
      <ErrorBox message={error} />
      <div className="section-toolbar">
        <span className="live-label">
          <span className="live-dot" /> Tự cập nhật mỗi 5 giây
        </span>
        <div className="inline">
          <button
            className="icon-button"
            title="Làm mới dữ liệu"
            onClick={reload}
          >
            <RefreshCw size={17} />
          </button>
          <ExportButtons query={query} />
        </div>
      </div>
      <div className="kpi-grid">
        {cards.map(([label, count, Icon, caption, status], i) => (
          <button
            key={label}
            className={"kpi-card " + (i === 1 ? "featured" : "")}
            onClick={() => onNavigate(status)}
          >
            <div className="kpi-label">
              {label}
              <span className="kpi-icon">
                <Icon size={19} />
              </span>
            </div>
            <div className="kpi-value">
              {Number(count).toLocaleString("vi-VN")}
              <ArrowUpRight size={18} />
            </div>
            <div className="kpi-caption">
              {i === 1 ? (
                <span className="mini-badge">Không tính lượt trùng</span>
              ) : (
                caption
              )}
            </div>
          </button>
        ))}
      </div>
      <div className="progress-strip">
        <div>
          <span className="progress-dot orange-bg" />
          <span>Tiến độ quét</span>
          <strong>
            {data.scanRate === null ? "Chưa đủ dữ liệu" : data.scanRate + "%"}
          </strong>
          <div className="progress-track">
            <i style={{ width: (data.scanRate ?? 0) + "%" }} />
          </div>
        </div>
        <div>
          <span className="progress-dot green-bg" />
          <span>Tiến độ bàn giao</span>
          <strong>
            {data.handoverRate === null
              ? "Chưa đủ dữ liệu"
              : data.handoverRate + "%"}
          </strong>
          <div className="progress-track green-track">
            <i style={{ width: (data.handoverRate ?? 0) + "%" }} />
          </div>
        </div>
        <button
          className="text-button"
          onClick={() => onNavigate("awaiting_handover")}
        >
          {data.waiting} đơn chờ bàn giao <ArrowUpRight size={15} />
        </button>
      </div>
      <div className="dashboard-main">
        <section className="card chart-card">
          <div className="card-heading">
            <div>
              <h2>Nhịp độ xử lý vận đơn</h2>
              <p>Số lượt quét thành công đã được xác nhận</p>
            </div>
            <div className="segmented">
              <button
                className={period === "hours" ? "selected" : ""}
                onClick={() => setPeriod("hours")}
              >
                Theo giờ
              </button>
              <button
                className={period === "days" ? "selected" : ""}
                onClick={() => setPeriod("days")}
              >
                Theo ngày
              </button>
            </div>
          </div>
          <div className="chart">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart
                data={period === "hours" ? data.hours : data.days}
                margin={{ left: -20, right: 14, top: 15, bottom: 0 }}
              >
                <defs>
                  <linearGradient id="orangeFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#f36b2b" stopOpacity={0.24} />
                    <stop offset="100%" stopColor="#f36b2b" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid
                  strokeDasharray="3 4"
                  vertical={false}
                  stroke="#eaedf0"
                />
                <XAxis
                  dataKey="name"
                  tick={{ fontSize: 11, fill: "#89909b" }}
                  axisLine={false}
                  tickLine={false}
                  minTickGap={25}
                />
                <YAxis
                  allowDecimals={false}
                  tick={{ fontSize: 11, fill: "#89909b" }}
                  axisLine={false}
                  tickLine={false}
                />
                <Tooltip />
                <Area
                  type="monotone"
                  name="Đã quét"
                  dataKey="scanned"
                  stroke="#f36b2b"
                  fill="url(#orangeFill)"
                  strokeWidth={2.5}
                  isAnimationActive={false}
                />
                {period === "days" && (
                  <Area
                    type="monotone"
                    name="Dự kiến xuất"
                    dataKey="expected"
                    stroke="#a1a8b4"
                    fill="transparent"
                    strokeDasharray="4 4"
                    isAnimationActive={false}
                  />
                )}
              </AreaChart>
            </ResponsiveContainer>
          </div>
          <div className="chart-legend">
            <span className="legend-dot orange-bg" /> Vận đơn đã quét{" "}
            <span className="muted">· Theo giờ Việt Nam (UTC+7)</span>
          </div>
        </section>
        <section className="card channel-card">
          <div className="card-heading">
            <div>
              <h2>Theo sàn bán hàng</h2>
              <p>Phân bổ và tiến độ xử lý</p>
            </div>
            <span className="subtle-icon">
              <Package size={19} />
            </span>
          </div>
          {data.channels.length ? (
            data.channels.map((c: Row, i: number) => (
              <div className="channel-row" key={c.name}>
                <div className="channel-title">
                  <span
                    className={"channel-logo " + (i % 2 ? "tiktok" : "shopee")}
                  >
                    {String(c.name).startsWith("Shopee") ? "S" : "♪"}
                  </span>
                  <div>
                    <strong>{c.name}</strong>
                    <small>
                      {c.eligible} hợp lệ · {c.exceptions} ngoại lệ
                    </small>
                  </div>
                  <b>
                    {c.scanned}
                    <small>đã quét</small>
                  </b>
                </div>
                <div className="progress-track">
                  <i
                    style={{
                      width: (c.scanRate ?? 0) + "%",
                      background: i % 2 ? "#333b4a" : "#f36b2b",
                    }}
                  />
                </div>
                <div className="channel-caption">
                  <span>{c.unscanned} chưa quét</span>
                  <span>{c.handed} đã bàn giao</span>
                </div>
              </div>
            ))
          ) : (
            <Empty />
          )}
          <div className="card-foot">Theo dữ liệu đơn hàng đã nhập</div>
        </section>
      </div>
      <div className="dashboard-lower">
        <section className="card">
          <div className="card-heading">
            <div>
              <h2>Tiến độ theo hãng vận chuyển</h2>
              <p>Quét đơn và bàn giao theo từng đối tác</p>
            </div>
            <span className="count-pill">{data.carriers.length} hãng</span>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>HÃNG VẬN CHUYỂN</th>
                  <th>DỰ KIẾN</th>
                  <th>ĐÃ TÍT</th>
                  <th>CHỜ BÀN GIAO</th>
                  <th>ĐÃ BÀN GIAO</th>
                  <th>TIẾN ĐỘ QUÉT</th>
                </tr>
              </thead>
              <tbody>
                {data.carriers.map((c: Row, i: number) => (
                  <tr key={c.name}>
                    <td>
                      <span className={"carrier-mark carrier-" + (i % 4)}>
                        {c.name === "SPX Express"
                          ? "SPX"
                          : c.name === "J&T Express"
                            ? "J&T"
                            : String(c.name).slice(0, 3)}
                      </span>
                      <strong>{c.name}</strong>
                    </td>
                    <td>{c.eligible}</td>
                    <td>
                      <span className="green-text">{c.scanned}</span>
                    </td>
                    <td>{c.waiting}</td>
                    <td>{c.handed}</td>
                    <td>
                      <div className="table-progress">
                        <div className="progress-track">
                          <i
                            style={{
                              width: (c.scanRate ?? 0) + "%",
                            }}
                          />
                        </div>
                        <span>
                          {c.scanRate === null ? "—" : c.scanRate + "%"}
                        </span>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!data.carriers.length && <Empty />}
          </div>
        </section>
        <section className="card alerts-card">
          <div className="card-heading">
            <div>
              <h2>Cần chú ý</h2>
              <p>Các chỉ số vận hành</p>
            </div>
            <TriangleAlert size={20} color="#ea8a23" />
          </div>
          {[
            [data.unscanned, "Vận đơn chưa tít", "unscanned", "orange"],
            [data.waiting, "Đã tít, chưa bàn giao", "waiting", "blue"],
            [data.exceptions, "Vận đơn ngoại lệ", "exceptions", "red"],
            [data.duplicate, "Lượt quét trùng", "duplicate", "red"],
            [data.unknown, "Lượt quét chưa xác định", "unknown", "orange"],
          ].map(([count, label, status, color]) => (
            <button
              className="alert-row"
              key={String(label)}
              onClick={() => onNavigate(String(status))}
            >
              <span className={"alert-dot " + color} />
              <span>{label}</span>
              <b>{count}</b>
              <ArrowUpRight size={14} />
            </button>
          ))}
          <p className="small-note">
            Lượt quét trùng và chưa xác định được tính riêng, không tăng tổng
            đơn đã tít.
          </p>
        </section>
      </div>
      {reports && (
        <section className="card">
          <div className="card-heading">
            <div>
              <h2>So sánh theo sàn</h2>
              <p>Vận đơn duy nhất theo bộ lọc</p>
            </div>
          </div>
          <div className="chart">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data.channels}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="name" />
                <YAxis allowDecimals={false} />
                <Tooltip />
                <Legend />
                <Bar
                  dataKey="eligible"
                  name="Dự kiến hợp lệ"
                  fill="#dce0e5"
                  radius={4}
                  isAnimationActive={false}
                />
                <Bar
                  dataKey="scanned"
                  name="Đã quét"
                  fill="#f36b2b"
                  radius={4}
                  isAnimationActive={false}
                />
                <Bar
                  dataKey="handed"
                  name="Đã bàn giao"
                  fill="#27a87d"
                  radius={4}
                  isAnimationActive={false}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </section>
      )}
      <section className="card">
        <div className="card-heading">
          <div>
            <h2>Năng suất nhân viên</h2>
            <p>Chỉ tính các lượt quét thành công, loại trừ trùng và lỗi</p>
          </div>
          <span className="subtle-label">Theo khoảng thời gian đã chọn</span>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>NHÂN VIÊN</th>
                <th>QUÉT THÀNH CÔNG</th>
                <th>QUÉT TRÙNG</th>
                <th>CẦN KIỂM TRA / LỖI</th>
              </tr>
            </thead>
            <tbody>
              {data.staff.map((s: Row, i: number) => (
                <tr key={s.id}>
                  <td>
                    <span className="rank">{i + 1}</span>
                    <strong>{s.name}</strong>
                  </td>
                  <td>
                    <strong className="green-text">{s.success}</strong>
                  </td>
                  <td>{s.duplicate}</td>
                  <td>{s.error}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!data.staff.length && <Empty />}
        </div>
      </section>
    </>
  );
}
