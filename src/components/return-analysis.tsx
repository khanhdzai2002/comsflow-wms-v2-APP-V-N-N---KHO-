"use client";
import { useState } from "react";
import {
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Tooltip,
  Legend,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
} from "recharts";
import {
  useData,
  api,
  post,
  refresh,
  ErrorBox,
  Loading,
  OptionList,
  type Row,
  toast,
} from "./shared";
import { FilePicker } from "./import-ui";
import { reasonGroups, returnChangeLabel } from "@/lib/return-domain";
import { returnMoneyLabel } from "./return-detail-info";
import { formatTime } from "@/lib/domain";
const chartColors = [
  "#f97316",
  "#3f3f46",
  "#ea580c",
  "#737373",
  "#c2410c",
  "#a3a3a3",
  "#fb923c",
  "#44403c",
  "#d4d4d4",
];
export function ReturnImportUpdates() {
  const attempts = useData<Row[]>("returns/upload-history");
  const { data, error } = useData<Row[]>("returns/import-history");
  const [id, setId] = useState("");
  const detail = useData<Row[]>(id ? "returns/import-history?id=" + id : null);
  return (
    <section className="card padded">
      <h3>Lịch sử cập nhật file</h3>
      <p>
        Chọn một lần nhập để xem những trường đã đổi. File nhập trước V2 chỉ có
        nhật ký nguồn gốc, không dựng lại giá trị cũ.
      </p>
      <ErrorBox message={error} />
      <details>
        <summary>
          Lần tải lên / đọc thử / lỗi ({attempts.data?.length ?? 0})
        </summary>
        {attempts.data?.map((r) => (
          <div className="notice" key={r.id}>
            <p>
              {formatTime(r.created_at)} · {r.filename} · {r.channel}/{r.shop} ·{" "}
              {r.employee}
              <br />
              {r.summary.errors ?? 0} lỗi · Chưa xác nhận lưu
              {r.errors.map((e: string, i: number) => (
                <small className="block" key={i}>
                  {e}
                </small>
              ))}
            </p>
          </div>
        ))}
      </details>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              {[
                "Thời gian / file",
                "Sàn / shop",
                "Người nhập",
                "Mới / cập nhật / không đổi",
                "Đổi trạng thái / tài chính",
                "Lỗi",
                "Chi tiết",
              ].map((h) => (
                <th key={h}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data?.map((r) => (
              <tr key={r.id}>
                <td>
                  {formatTime(r.created_at)}
                  <small className="block">{r.filename}</small>
                </td>
                <td>
                  {r.channel} · {r.shop}
                </td>
                <td>{r.employee}</td>
                <td>
                  {r.new_count ?? "—"} / {r.updated_count ?? "—"} /{" "}
                  {r.unchanged_count ?? "—"}
                </td>
                <td>
                  {r.status_count ?? "—"} / {r.finance_count ?? "—"}
                </td>
                <td>{r.error_count ?? "—"}</td>
                <td>
                  <button
                    className="secondary small"
                    onClick={() => setId(r.id)}
                  >
                    Xem thay đổi
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {id && (
        <div className="return-read-group">
          <h3>Giá trị cũ → mới</h3>
          <ErrorBox message={detail.error} />
          {!detail.data ? (
            <Loading />
          ) : !detail.data.length ? (
            <p>
              Không có thay đổi còn lưu cho lần nhập này. Hồ sơ đã dọn hoặc
              nguồn trước V2 có thể không có chi tiết.
            </p>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Yêu cầu</th>
                    <th>Trường</th>
                    <th>Cũ</th>
                    <th>Mới</th>
                  </tr>
                </thead>
                <tbody>
                  {detail.data.flatMap((r) =>
                    r.changes.map((c: Row, i: number) => (
                      <tr key={r.external_id + i}>
                        <td>{r.external_id}</td>
                        <td>{returnChangeLabel(c.field)}</td>
                        <td>{String(c.before ?? "Chưa có dữ liệu")}</td>
                        <td>{String(c.after ?? "Chưa có dữ liệu")}</td>
                      </tr>
                    )),
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
function SalesImporter() {
  const [file, setFile] = useState<File | null>(null),
    [shop, setShop] = useState("ComsMiu"),
    [channel, setChannel] = useState("TikTok Shop"),
    [statuses, setStatuses] = useState(
      "Completed;Delivered;Đã giao hàng;Hoàn thành",
    ),
    [mapping, setMapping] = useState<Row>({
      order: "Order ID",
      line: "Order Line ID",
      sku: "SKU ID",
      product: "Seller SKU",
      quantity: "Quantity",
      sold: "Created Time",
      status: "Order Status",
      color: "Color",
      size: "Size",
    }),
    [preview, setPreview] = useState<Row | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [done, setDone] = useState("");
  const history = useData<Row[]>("returns/sales/history");
  function clear() {
    setPreview(null);
    setDone("");
    setError("");
  }
  async function run(commit = false) {
    if (!file) return;
    setBusy(true);
    setError("");
    try {
      const form = new FormData();
      form.set("file", file);
      form.set(
        "context",
        JSON.stringify({
          shop,
          channel,
          completedStatuses: statuses
            .split(";")
            .map((s) => s.trim())
            .filter(Boolean),
        }),
      );
      form.set("mapping", JSON.stringify(mapping));
      const r = await api(
        "returns/sales/" + (commit ? "commit" : "preview"),
        { method: "POST", body: form },
        180000,
      );
      if (commit) {
        setDone(r.reused ? "File đã có; không cộng trùng" : "Đã lưu nguồn bán");
        refresh();
      } else setPreview(r);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <details className="card padded return-sales-import">
      <summary>Nhập / cập nhật nguồn bán thành công để tính mẫu số</summary>
      <p>
        Xuất kho không chứng minh bán thành công. Chọn đúng sàn/shop; ánh xạ cột
        từ file bán thật. Nhập cả dòng đã huỷ để cập nhật trạng thái, chỉ trạng
        thái bạn xác nhận bên dưới được tính. Mã đơn và SKU phải là text. Ngày
        yyyy-MM-dd hoặc dd/MM/yyyy HH:mm:ss (giờ Việt Nam).
      </p>
      <a
        className="button secondary small"
        href={"/api/returns/sales/template"}
      >
        Tải mẫu Excel nguồn bán
      </a>
      <div className="form-grid">
        <label className="field">
          Sàn nguồn bán
          <select
            value={channel}
            disabled={busy}
            onChange={(e) => {
              setChannel(e.target.value);
              clear();
            }}
          >
            <option>TikTok Shop</option>
            <option>Shopee</option>
          </select>
        </label>
        <label className="field">
          Shop nguồn bán
          <input
            value={shop}
            disabled={busy}
            onChange={(e) => {
              setShop(e.target.value);
              clear();
            }}
          />
        </label>
        <label className="field">
          Trạng thái bán thành công (cách nhau bằng ;){" "}
          <input
            value={statuses}
            disabled={busy}
            onChange={(e) => {
              setStatuses(e.target.value);
              clear();
            }}
          />
        </label>
      </div>
      <FilePicker
        label="File nguồn bán"
        accept=".xlsx,.csv"
        files={file ? [file] : []}
        disabled={busy}
        help="CSV/XLSX · 5 MB · 10.000 dòng"
        onFiles={(files) => {
          setFile(files[0] ?? null);
          clear();
        }}
        onRemove={() => {
          setFile(null);
          clear();
        }}
      />
      <details>
        <summary>Ánh xạ cột nguồn bán</summary>
        <div className="form-grid">
          {Object.entries(mapping).map(([k, v]) => (
            <label className="field" key={k}>
              {
                (
                  {
                    order: "Mã đơn",
                    line: "Mã dòng (nếu có)",
                    sku: "SKU ID để liên kết yêu cầu hoàn",
                    product: "SKU / mã SP của shop",
                    quantity: "Số lượng bán",
                    sold: "Ngày tạo đơn bán",
                    status: "Trạng thái bán",
                    color: "Màu",
                    size: "Size",
                  } as Row
                )[k]
              }
              <input
                value={v}
                disabled={busy}
                onChange={(e) => {
                  setMapping({ ...mapping, [k]: e.target.value });
                  clear();
                }}
              />
            </label>
          ))}
        </div>
      </details>
      <ErrorBox message={error} />
      <button
        className="primary"
        disabled={busy || !file || !shop.trim()}
        onClick={() => void run()}
      >
        Đọc và đối chiếu nguồn bán
      </button>
      {preview && (
        <div className="return-read-group">
          <p>
            {preview.summary.rows} dòng · {preview.summary.successful} dòng bán
            thành công · {preview.summary.quantity} SP bán ·{" "}
            {preview.errors.length} lỗi. Chưa lưu.
          </p>
          {preview.errors.slice(0, 30).map((r: Row) => (
            <p key={r.row} className="red-text">
              Dòng {r.row}: {r.message}
            </p>
          ))}
          <details>
            <summary>Xem trạng thái và SKU trước khi lưu</summary>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Đơn / SKU</th>
                    <th>Ngày</th>
                    <th>SL</th>
                    <th>Tính bán thành công</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.rows.slice(0, 100).map((r: Row, i: number) => (
                    <tr key={i}>
                      <td>
                        {r.order} / {r.sku}
                        <small className="block">{r.product}</small>
                      </td>
                      <td>{r.sold}</td>
                      <td>{r.quantity}</td>
                      <td>{r.successful ? "Có" : "Không"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
          <button
            className="primary"
            disabled={
              busy || !!done || !!preview.errors.length || !preview.rows.length
            }
            onClick={() => void run(true)}
          >
            Xác nhận lưu nguồn bán
          </button>
        </div>
      )}
      {done && (
        <p className="notice" role="status">
          {done}
        </p>
      )}
      <details>
        <summary>Lịch sử nguồn bán ({history.data?.length ?? 0})</summary>
        {history.data?.map((r) => (
          <p key={r.id}>
            {formatTime(r.created_at)} · {r.filename} · {r.channel}/{r.shop} ·{" "}
            {r.employee} · {r.summary.quantity} SP thành công
          </p>
        ))}
      </details>
    </details>
  );
}
export function ReturnAnalysis({
  refs,
  user,
  onReason,
}: {
  refs: Row;
  user: Row;
  onReason: (reason: string, filters: Row) => void;
}) {
  const [filters, setFilters] = useState<Row>({
      from: "",
      to: "",
      channel: "",
      shop: "",
      type: "all",
      product: "",
      color: "",
      size: "",
      reason: "",
      minSold: "0",
      sort: "rate",
    }),
    [selected, setSelected] = useState("");
  const query = new URLSearchParams(
    Object.fromEntries(Object.entries(filters).filter(([, v]) => v !== "")),
  ).toString();
  const { data, error, loading } = useData<Row>("returns/analytics?" + query),
    [settingsOpen, setSettingsOpen] = useState(false);
  const change = (key: string, value: string) =>
    setFilters({ ...filters, [key]: value });
  return (
    <div className="return-analysis">
      <section className="card padded">
        <h3>Phân tích lý do hoàn trả & hiệu suất sản phẩm</h3>
        <p>
          Biểu đồ lý do theo ngày yêu cầu. Tỷ lệ sản phẩm theo ngày tạo đơn bán,
          liên kết các yêu cầu hoàn về đúng nhóm đơn bán cùng kỳ.
        </p>
        <div className="form-grid">
          {[
            ["from", "Từ ngày"],
            ["to", "Đến ngày"],
          ].map(([k, label]) => (
            <label className="field" key={k}>
              {label}
              <input
                type="date"
                value={filters[k]}
                onChange={(e) => change(k, e.target.value)}
              />
            </label>
          ))}
          <label className="field">
            Sàn phân tích
            <select
              value={filters.channel}
              onChange={(e) => change("channel", e.target.value)}
            >
              <option value="">Tất cả sàn</option>
              <option>TikTok Shop</option>
              <option>Shopee</option>
            </select>
          </label>
          <label className="field">
            Shop phân tích
            <input
              value={filters.shop}
              onChange={(e) => change("shop", e.target.value)}
            />
          </label>
          <label className="field">
            Loại yêu cầu hoàn
            <select
              value={filters.type}
              onChange={(e) => change("type", e.target.value)}
            >
              <option value="all">Tất cả yêu cầu · SL yêu cầu hoàn</option>
              <option value="approved">Sàn chấp thuận · SL yêu cầu hoàn</option>
              <option value="received">Đã nhận thực tế · SL đã kiểm</option>
            </select>
          </label>
          <label className="field">
            Lý do chuẩn
            <select
              value={filters.reason}
              onChange={(e) => change("reason", e.target.value)}
            >
              <option value="">Tất cả lý do</option>
              {Object.entries(reasonGroups).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </label>
        </div>
      </section>
      <ErrorBox message={error} />
      {!data ? (
        loading && <Loading />
      ) : (
        <>
          <div className="notice warning">
            <div>
              {data.warnings.map((w: string) => (
                <p key={w}>{w}</p>
              ))}
              <p>
                {data.source.salesRows} dòng bán thành công ·{" "}
                {data.source.unlinkedReturns} dòng hoàn chưa liên kết ·{" "}
                {data.source.ambiguousLinks} liên kết nhiều dòng ·{" "}
                {data.source.uninspectedItems} SKU chưa kiểm đủ dữ liệu thực
                nhận.
              </p>
              {data.source.unresolvedProducts > 0 && (
                <details>
                  <summary>
                    {data.source.unresolvedProducts} dòng thiếu định nghĩa sản
                    phẩm/combo
                  </summary>
                  <p>{data.source.unresolvedSkus.join(", ")}</p>
                  <p>
                    Quản trị viên cấu hình SKU và định lượng phía dưới; dòng
                    chưa rõ không tự phân rã.
                  </p>
                </details>
              )}
            </div>
          </div>
          <section className="card padded">
            <h3>Phân tích lý do hoàn trả</h3>
            <p>
              {data.requests} yêu cầu trong kỳ yêu cầu · Giá trị sản phẩm yêu
              cầu trả, không phải tiền bồi thường.
            </p>
            <div className="two-columns">
              <div style={{ height: 280, minWidth: 0 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={data.reasons}
                      dataKey="requests"
                      nameKey="label"
                      innerRadius={55}
                      outerRadius={90}
                      isAnimationActive={false}
                      onClick={(r) =>
                        onReason(String(r.payload?.key ?? r.key), filters)
                      }
                    >
                      {data.reasons.map((r: Row, i: number) => (
                        <Cell
                          key={r.key}
                          fill={chartColors[i % chartColors.length]}
                        />
                      ))}
                    </Pie>
                    <Tooltip />
                    <Legend />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Lý do</th>
                      <th>Yêu cầu / %</th>
                      <th>Giá trị</th>
                      <th>Sàn</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.reasons.map((r: Row) => (
                      <tr key={r.key}>
                        <td>
                          <button
                            className="text-button"
                            onClick={() => onReason(r.key, filters)}
                          >
                            {r.label}
                          </button>
                        </td>
                        <td>
                          {r.requests} / {r.percent.toFixed(1)}%
                        </td>
                        <td>
                          {returnMoneyLabel(r.value)}
                          {r.missingValue > 0 && (
                            <small className="block">
                              {r.missingValue} yêu cầu thiếu giá trị
                            </small>
                          )}
                        </td>
                        <td>
                          {Object.entries(r.channels).map(([k, v]) => (
                            <small className="block" key={k}>
                              {k}: {String(v)}
                            </small>
                          ))}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
            <details>
              <summary>Biến động lý do theo ngày yêu cầu</summary>
              <div style={{ height: 300, minWidth: 0 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={data.trend}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="day" />
                    <YAxis allowDecimals={false} />
                    <Tooltip />
                    <Legend />
                    {Object.entries(reasonGroups).map(([key, label], i) => (
                      <Bar
                        key={key}
                        dataKey={key}
                        name={label}
                        isAnimationActive={false}
                        stackId="reasons"
                        fill={chartColors[i % chartColors.length]}
                      />
                    ))}
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </details>
          </section>
          <section className="card padded">
            <h3>Hiệu suất hoàn trả theo mã sản phẩm</h3>
            <p>
              SL bán thành công so với{" "}
              {filters.type === "received"
                ? "SL hoàn đã kiểm thực tế"
                : "SL được yêu cầu hoàn"}{" "}
              trên nhóm đơn bán liên kết. Giá trị = đơn giá sản phẩm trong nguồn
              hoàn × SL tương ứng; combo phân bổ theo trọng số đã cấu hình.
            </p>
            <div className="form-grid">
              {[
                ["product", "Mã sản phẩm"],
                ["color", "Màu"],
                ["size", "Size"],
              ].map(([k, label]) => (
                <label key={k} className="field">
                  {label}
                  <input
                    value={filters[k]}
                    onChange={(e) => change(k, e.target.value)}
                  />
                </label>
              ))}
              <label className="field">
                SL bán tối thiểu
                <input
                  type="number"
                  min="0"
                  value={filters.minSold}
                  onChange={(e) => change("minSold", e.target.value)}
                />
              </label>
              <label className="field">
                Sắp xếp sản phẩm
                <select
                  value={filters.sort}
                  onChange={(e) => change("sort", e.target.value)}
                >
                  <option value="rate">Tỷ lệ cao nhất</option>
                  <option value="returned">SL hoàn cao nhất</option>
                  <option value="value">Giá trị hoàn cao nhất</option>
                  <option value="sold">SL bán cao nhất</option>
                </select>
              </label>
            </div>
            <p className="small-note">
              Ngưỡng đang cấu hình: thấp ≤ {data.thresholds.low}%; cao ≥{" "}
              {data.thresholds.high}%. Đây là ngưỡng theo dõi của shop, có thể
              chỉnh.
            </p>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Mã SP</th>
                    <th>SL bán</th>
                    <th>SL hoàn</th>
                    <th>Tỷ lệ hoàn</th>
                    <th>Giá trị SP yêu cầu hoàn</th>
                    <th>Chi tiết</th>
                  </tr>
                </thead>
                <tbody>
                  {data.products.map((r: Row) => (
                    <tr key={r.code}>
                      <td>{r.code}</td>
                      <td>{r.sold || "Chưa đủ dữ liệu"}</td>
                      <td>
                        {r.returned}
                        {r.unlinked > 0 && (
                          <small className="block">
                            {r.unlinked} chưa liên kết · chưa tính tỷ lệ
                          </small>
                        )}
                      </td>
                      <td>
                        <span className={"return-rate " + r.tone}>
                          {r.rate === null
                            ? "Chưa đủ dữ liệu"
                            : r.rate.toFixed(2) + "%"}
                        </span>
                      </td>
                      <td>
                        {returnMoneyLabel(r.value)}
                        {r.missingValue > 0 && (
                          <small className="block">
                            Thiếu giá trị {r.missingValue} dòng
                          </small>
                        )}
                      </td>
                      <td>
                        <button
                          className="secondary small"
                          onClick={() =>
                            setSelected(selected === r.code ? "" : r.code)
                          }
                        >
                          Phân tích {r.code}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {data.products
              .filter((r: Row) => r.code === selected)
              .map((r: Row) => (
                <div className="return-read-group" key={r.code}>
                  <h3>
                    {r.code} · {r.sold} bán / {r.returned} hoàn ·{" "}
                    {r.rate === null
                      ? "Chưa đủ dữ liệu"
                      : r.rate.toFixed(2) + "%"}
                  </h3>
                  <div className="two-columns">
                    {["colors", "sizes", "reasons", "channels"].map((key) => (
                      <div key={key}>
                        <h4>
                          {
                            (
                              {
                                colors: "Theo màu",
                                sizes: "Theo size",
                                reasons: "Lý do phổ biến",
                                channels: "Theo sàn",
                              } as Row
                            )[key]
                          }
                        </h4>
                        {Object.entries(r[key]).map(([name, value]) => {
                          const sold = r[key + "Sold"]?.[name];
                          return (
                            <p key={name}>
                              {name}: {String(value)} hoàn
                              {["colors", "sizes"].includes(key)
                                ? " / " +
                                  (sold ?? 0) +
                                  " bán · " +
                                  (sold
                                    ? ((Number(value) / sold) * 100).toFixed(
                                        2,
                                      ) + "%"
                                    : "Chưa đủ dữ liệu")
                                : ""}
                            </p>
                          );
                        })}
                      </div>
                    ))}
                  </div>
                </div>
              ))}
          </section>
        </>
      )}
      <SalesImporter />
      {user.role === "admin" && (
        <>
          <button
            className="secondary"
            onClick={() => setSettingsOpen(!settingsOpen)}
          >
            Cấu hình hãng, combo, lý do và ngưỡng
          </button>
          {settingsOpen && <AnalysisSettings refs={refs} />}
        </>
      )}
    </div>
  );
}
function AnalysisSettings({ refs }: { refs: Row }) {
  const { data, error, reload } = useData<Row>("returns/v2-settings");
  const [problem, setProblem] = useState(""),
    [busy, setBusy] = useState(false),
    [sku, setSku] = useState(""),
    [parts, setParts] = useState<Row[]>([
      { code: "", quantity: 1, weight: 1, color: "", size: "" },
    ]);
  async function save(input: Row) {
    setBusy(true);
    setProblem("");
    try {
      await post("returns/v2-settings", input);
      await reload();
      refresh();
      toast("Đã lưu cấu hình");
    } catch (e) {
      setProblem((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="card padded return-analysis-settings">
      <h3>Cấu hình phân tích & nhận diện · Chỉ quản trị viên</h3>
      <ErrorBox message={error || problem} />
      <h4>Chuẩn hoá tên hãng trong file</h4>
      <form
        className="form-grid"
        onSubmit={(e) => {
          e.preventDefault();
          void save({
            kind: "alias",
            ...Object.fromEntries(new FormData(e.currentTarget)),
          });
        }}
      >
        <label className="field">
          Tên gọi / alias trong file
          <input name="alias" required />
        </label>
        <label className="field">
          Tên hãng chuẩn
          <select name="carrierId">
            <OptionList rows={refs.carriers} />
          </select>
        </label>
        <button className="primary" disabled={busy}>
          Lưu tên gọi hãng
        </button>
      </form>
      <p>
        Thêm/đổi tên hãng và quy tắc tiền tố tại Cấu hình hệ thống. Thiếu tên và
        tiền tố không khớp sẽ hiện Chưa xác định; không mặc định theo sàn.
      </p>
      <details>
        <summary>Danh sách tên gọi đang dùng</summary>
        {data?.aliases.map((r: Row) => (
          <p key={r.alias}>
            {r.alias} → {r.carrier}
          </p>
        ))}
      </details>
      <h4>Định lượng thành phần theo SKU thực tế</h4>
      <p>
        SKU đơn như MIU37 giữ một sản phẩm. SKU ghép như MAN8688/MIU2322 cần
        khai báo từng mã, số lượng và trọng số giá trị thật. Không tự giả định
        mỗi mã là một chiếc. SKU hoàn một phần cần ánh xạ đúng phần thực tế được
        yêu cầu trả.
      </p>
      <label className="field">
        SKU nguồn / Seller SKU
        <input value={sku} onChange={(e) => setSku(e.target.value)} />
      </label>
      {parts.map((p, i) => (
        <div className="form-grid" key={i}>
          {[
            ["code", "Mã sản phẩm thành phần"],
            ["quantity", "SL thành phần / 1 SKU"],
            ["weight", "Trọng số phân bổ giá trị"],
            ["color", "Màu (nếu xác định)"],
            ["size", "Size (nếu xác định)"],
          ].map(([k, label]) => (
            <label className="field" key={k}>
              {label}
              <input
                type={["quantity", "weight"].includes(k) ? "number" : "text"}
                min="0.001"
                value={p[k]}
                onChange={(e) =>
                  setParts(
                    parts.map((v, j) =>
                      j === i
                        ? {
                            ...v,
                            [k]: ["quantity", "weight"].includes(k)
                              ? Number(e.target.value)
                              : e.target.value,
                          }
                        : v,
                    ),
                  )
                }
              />
            </label>
          ))}
          <button
            className="secondary small"
            disabled={parts.length === 1}
            onClick={() => setParts(parts.filter((_, j) => j !== i))}
          >
            Bỏ thành phần {i + 1}
          </button>
        </div>
      ))}
      <div className="inline">
        <button
          className="secondary"
          onClick={() =>
            setParts([
              ...parts,
              { code: "", quantity: 1, weight: 1, color: "", size: "" },
            ])
          }
        >
          Thêm thành phần
        </button>
        <button
          className="primary"
          disabled={busy || !sku.trim()}
          onClick={() =>
            void save({ kind: "components", sku, components: parts })
          }
        >
          Lưu định lượng SKU
        </button>
      </div>
      {data?.components.map((r: Row) => (
        <p key={r.source_sku}>
          <button
            className="text-button"
            onClick={() => {
              setSku(r.source_sku);
              setParts(r.components);
            }}
          >
            {r.source_sku} →{" "}
            {r.components
              .map((p: Row) => p.code + " × " + p.quantity)
              .join(" + ")}{" "}
            · sửa
          </button>
        </p>
      ))}
      <h4>Lý do hoàn từ nội dung lý do gốc</h4>
      <form
        className="form-grid"
        onSubmit={(e) => {
          e.preventDefault();
          void save({
            kind: "reason",
            ...Object.fromEntries(new FormData(e.currentTarget)),
            active: true,
          });
        }}
      >
        <label className="field">
          Cụm từ rõ nghĩa trong lý do gốc
          <input name="phrase" required />
        </label>
        <label className="field">
          Nhóm phân tích
          <select name="group">
            {Object.entries(reasonGroups).map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <button className="primary" disabled={busy}>
          Lưu quy tắc lý do
        </button>
      </form>
      <p>
        Chỉ khớp lý do gốc, không suy đoán từ ghi chú khách. Nhiều nhóm cùng
        khớp sẽ vào Khác/chưa phân loại.
      </p>
      <details>
        <summary>Quy tắc lý do</summary>
        {data?.reasons.map((r: Row) => (
          <p key={r.id}>
            {r.phrase} → {reasonGroups[r.group_key]}{" "}
            <button
              className="text-button"
              disabled={busy}
              onClick={() =>
                void save({
                  kind: "reason",
                  phrase: r.phrase,
                  group: r.group_key,
                  active: !r.active,
                })
              }
            >
              {r.active ? "Tắt" : "Bật"}
            </button>
          </p>
        ))}
      </details>
      {data && (
        <form
          className="form-grid"
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            void save({
              kind: "thresholds",
              low: Number(f.get("low")),
              high: Number(f.get("high")),
              approvedStatuses: String(f.get("approved"))
                .split(";")
                .map((s) => s.trim())
                .filter(Boolean),
            });
          }}
        >
          <label className="field">
            Ngưỡng thấp (%)
            <input
              name="low"
              type="number"
              min="0"
              max="100"
              step="0.01"
              defaultValue={data.thresholds.low}
            />
          </label>
          <label className="field">
            Ngưỡng cao (%)
            <input
              name="high"
              type="number"
              min="0"
              max="100"
              step="0.01"
              defaultValue={data.thresholds.high}
            />
          </label>
          <label className="field">
            Trạng thái sàn được chấp thuận (cách nhau bằng ;)
            <input
              name="approved"
              defaultValue={data.approvedStatuses.join(";")}
            />
          </label>
          <button className="primary" disabled={busy}>
            Lưu ngưỡng & trạng thái sàn
          </button>
        </form>
      )}
    </section>
  );
}
