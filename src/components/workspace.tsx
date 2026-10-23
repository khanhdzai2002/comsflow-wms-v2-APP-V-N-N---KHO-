"use client";
import { useEffect, useState } from "react";
import {
  LayoutDashboard,
  ScanLine,
  Package,
  GitCompareArrows,
  Truck,
  ChartNoAxesCombined,
  Upload,
  Users,
  Settings,
  LogOut,
  Menu,
  Bell,
  Search,
  ArrowUpRight,
  WifiOff,
  X,
  BookOpen,
  Undo2,
  Info,
  Clock,
} from "lucide-react";
import { BrandLogo } from "./brand-logo";
import type { User } from "@/lib/db";
import { todayVN, filterStatuses } from "@/lib/domain";
import { visibleReturnTabs, type ReturnTab } from "@/lib/return-domain";
import {
  api,
  post,
  Loading,
  ErrorBox,
  useData,
  type Row,
  OptionList,
  toast,
} from "./shared";
import { Dashboard } from "./dashboard";
import { Scanner } from "./scanner";
import { Shipments, Reconciliation, Handovers } from "./operations";
import { Imports, People, Configuration } from "./management";
import { ReturnsModule } from "./returns";
import { DataJobs } from "./jobs";
import { UserGuide } from "./user-guide";
const navigation = [
  ["dashboard", "Tổng quan", LayoutDashboard],
  ["scan", "Quét vận đơn", ScanLine],
  ["shipments", "Danh sách vận đơn", Package],
  ["reconcile", "Đối soát xuất kho", GitCompareArrows],
  ["handover", "Bàn giao vận chuyển", Truck],
  ["reports", "Báo cáo & Thống kê", ChartNoAxesCombined],
  ["imports", "Nhập dữ liệu", Upload],
  ["jobs", "Tác vụ dữ liệu", Clock],
  ["returns", "Quản lý đơn hoàn", Undo2],
  ["people", "Nhân viên & Ca làm việc", Users],
  ["settings", "Cấu hình hệ thống", Settings],
  ["guide", "Hướng dẫn sử dụng", BookOpen],
] as const;
function workspaceLocation(user: User, hash: string) {
  const [requestedPage, requestedTab] = hash.replace(/^#/, "").split("/");
  const page =
    navigation.find(
      ([key]) =>
        key === requestedPage &&
        (user.role !== "staff" || ["scan", "guide", "returns"].includes(key)),
    )?.[0] ?? (user.role === "staff" ? "scan" : "dashboard");
  const tabs = visibleReturnTabs(user.role);
  const returnTab =
    tabs.find((tab) => tab.key === requestedTab)?.key ?? tabs[0].key;
  const importMode =
    requestedTab === "excel" ? ("excel" as const) : ("pdf" as const);
  return { page, returnTab, importMode };
}
const titles: Row = {
  jobs: [
    "Tác vụ dữ liệu",
    "Theo dõi nhập file và tải báo cáo đầy đủ, kể cả sau khi tải lại trang.",
  ],
  returns: [
    "Quản lý đơn hoàn",
    "Đối chiếu nguồn sàn, nhận kiện, kiểm hàng và theo dõi khiếu nại.",
  ],
  guide: [
    "Hướng dẫn sử dụng",
    "Ý nghĩa danh mục, các bước thao tác và quy trình xuất kho.",
  ],
  dashboard: [
    "Tổng quan xuất kho",
    "Theo dõi hoạt động kho và tiến độ xử lý vận đơn.",
  ],
  scan: [
    "Trạm quét vận đơn",
    "Quét nhanh. Xác minh chính xác. Không đếm trùng.",
  ],
  shipments: [
    "Danh sách vận đơn",
    "Quản lý vận đơn, sản phẩm và lịch sử xử lý.",
  ],
  reconcile: [
    "Đối soát xuất kho",
    "Phát hiện chênh lệch và xử lý các trường hợp cần kiểm tra.",
  ],
  handover: [
    "Bàn giao vận chuyển",
    "Lập phiếu và xác nhận bàn giao nội bộ theo từng hãng.",
  ],
  reports: [
    "Báo cáo & Thống kê",
    "Số liệu thực tế từ dữ liệu đã nhập và nhật ký quét.",
  ],
  imports: [
    "Nhập dữ liệu đơn hàng",
    "Đưa đơn Shopee, TikTok Shop vào cùng một quy trình.",
  ],
  people: [
    "Nhân viên & Ca làm việc",
    "Phân công ca và quản lý quyền truy cập hệ thống.",
  ],
  settings: [
    "Cấu hình hệ thống",
    "Quản lý kho, hãng vận chuyển và quy tắc nhận diện.",
  ],
};
export function Workspace() {
  const [user, setUser] = useState<User | null>(null),
    [checking, setChecking] = useState(true);
  const [note, setNote] = useState<{ message: string; error: boolean } | null>(
    null,
  );
  useEffect(() => {
    api("auth/me")
      .then((r) => setUser(r.user))
      .catch(() => {})
      .finally(() => setChecking(false));
    const handler = (event: Event) => setNote((event as CustomEvent).detail);
    window.addEventListener("wms:toast", handler);
    if ("serviceWorker" in navigator)
      navigator.serviceWorker.register("/sw.js").catch(() => {});
    return () => window.removeEventListener("wms:toast", handler);
  }, []);
  useEffect(() => {
    if (!note) return;
    const timeout = setTimeout(() => setNote(null), 6500);
    return () => clearTimeout(timeout);
  }, [note]);
  return (
    <>
      {checking ? (
        <Loading />
      ) : user ? (
        <Shell user={user} onLogout={() => setUser(null)} />
      ) : (
        <Login onLogin={setUser} />
      )}{" "}
      {note && (
        <div className={"toast " + (note.error ? "danger" : "")} role="status">
          {note.message}
          <button
            className="icon-button"
            onClick={() => setNote(null)}
            aria-label="Đóng thông báo"
          >
            <X size={16} />
          </button>
        </div>
      )}
    </>
  );
}
function Login({ onLogin }: { onLogin: (u: User) => void }) {
  const { data: setup } = useData<{ available: boolean }>("auth/setup-status");
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [setupToken, setSetupToken] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [email, setEmail] = useState(""),
    [password, setPassword] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  return (
    <main className="login-layout">
      <div className="login-story">
        <div className="brand">
          <BrandLogo />
        </div>
        <div>
          <span className="eyebrow">VẬN HÀNH KHO THÔNG MINH</span>
          <h1>
            Mỗi vận đơn.
            <br />
            Một luồng vận hành
            <br />
            <em>rõ ràng.</em>
          </h1>
          <p>
            Từ quét mã đến bàn giao — kiểm soát mọi chuyển động tại kho ComsMiu.
          </p>
        </div>
        <span className="muted">COMS-FLOW WMS · Outbound Management</span>
      </div>
      <section className="login-panel">
        <div className="login-card">
          <span className="eyebrow">CHÀO MỪNG TRỞ LẠI</span>
          <h2>{creating ? "Tạo Admin đầu tiên" : "Đăng nhập hệ thống"}</h2>
          <p className="muted">
            {creating
              ? "Dùng mã thiết lập đã lưu trong Railway để khởi tạo hệ thống."
              : "Sử dụng tài khoản được quản trị viên cấp."}
          </p>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              setError("");
              try {
                if (creating && password !== confirmation)
                  throw new Error("Hai mật khẩu chưa khớp");
                const r = creating
                  ? await post("auth/setup", {
                      name,
                      email,
                      password,
                      token: setupToken,
                    })
                  : await post("auth/login", { email, password });
                onLogin(r.user);
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            {creating && (
              <>
                <label className="field">
                  Mã thiết lập
                  <input
                    type="password"
                    required
                    autoComplete="off"
                    maxLength={256}
                    value={setupToken}
                    onChange={(e) => setSetupToken(e.target.value)}
                  />
                </label>
                <label className="field">
                  Họ và tên
                  <input
                    required
                    minLength={2}
                    maxLength={100}
                    autoComplete="name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                  />
                </label>
              </>
            )}
            <label className="field">
              Email
              <input
                type="email"
                autoComplete="username"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="ten@congty.vn"
              />
            </label>
            <label className="field">
              Mật khẩu
              <input
                type="password"
                autoComplete={creating ? "new-password" : "current-password"}
                minLength={creating ? 12 : undefined}
                maxLength={100}
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Nhập mật khẩu"
              />
            </label>
            {creating && (
              <label className="field">
                Nhập lại mật khẩu
                <input
                  type="password"
                  autoComplete="new-password"
                  minLength={12}
                  maxLength={100}
                  required
                  value={confirmation}
                  onChange={(e) => setConfirmation(e.target.value)}
                />
              </label>
            )}
            <ErrorBox message={error} />
            <button className="primary wide" disabled={busy}>
              {busy
                ? "Đang xác thực…"
                : creating
                  ? "Tạo tài khoản và đăng nhập"
                  : "Đăng nhập"}
              <ArrowUpRight size={18} />
            </button>
          </form>
          {setup?.available && (
            <div className="notice">
              {creating
                ? "Chỉ tạo được một lần khi hệ thống chưa có tài khoản."
                : "Hệ thống chưa có tài khoản."}
              <button
                className="text-button"
                type="button"
                onClick={() => {
                  setCreating(!creating);
                  setError("");
                }}
              >
                {creating ? "Quay lại đăng nhập" : "Tạo Admin đầu tiên"}
              </button>
            </div>
          )}
          <p className="login-foot">
            Hệ thống vận hành nội bộ · Truy cập có phân quyền
          </p>
        </div>
      </section>
    </main>
  );
}
function Shell({ user, onLogout }: { user: User; onLogout: () => void }) {
  const [location, setLocation] = useState(() =>
      workspaceLocation(
        user,
        typeof window === "undefined" ? "" : window.location.hash,
      ),
    ),
    [menu, setMenu] = useState(false),
    [online, setOnline] = useState(true);
  const page = location.page;
  const [reconcileTab, setReconcileTab] = useState("unscanned");
  const { data: refs, error } = useData<Row>("references", 30000);
  const [filters, setFilters] = useState<Row>({
    from: todayVN(),
    to: todayVN(),
    channel: "",
    carrier: "",
    warehouse: "",
    employee: "",
    shift: "",
    shop: "",
    status: "",
  });
  const query = new URLSearchParams(
    Object.fromEntries(Object.entries(filters).filter(([, v]) => v !== "")),
  ).toString();
  const retainedHistory = (refs?.retention ?? []).filter(
    (entry: Row) =>
      (page === "returns" && entry.kind === "returns") ||
      (["dashboard", "reports", "shipments", "reconcile"].includes(page) &&
        entry.kind === "scans" &&
        (!filters.warehouse ||
          !entry.warehouse_id ||
          filters.warehouse === entry.warehouse_id) &&
        (page === "reconcile" ||
          !filters.from ||
          filters.from < entry.before_date)),
  );
  useEffect(() => {
    const handle = () => setOnline(navigator.onLine);
    handle();
    window.addEventListener("online", handle);
    window.addEventListener("offline", handle);
    return () => {
      window.removeEventListener("online", handle);
      window.removeEventListener("offline", handle);
    };
  }, []);
  useEffect(() => {
    const handleNavigation = () => {
      setLocation(workspaceLocation(user, window.location.hash));
      setMenu(false);
    };
    window.addEventListener("hashchange", handleNavigation);
    return () => window.removeEventListener("hashchange", handleNavigation);
  }, [user]);
  const changePage = (key: string, returnTab?: ReturnTab | "pdf" | "excel") => {
    const next = workspaceLocation(user, `#${key}/${returnTab ?? ""}`);
    setLocation(next);
    const hash = `#${next.page}${next.page === "returns" ? "/" + next.returnTab : next.page === "imports" ? "/" + next.importMode : ""}`;
    if (window.location.hash !== hash) window.location.hash = hash;
    setMenu(false);
  };
  return (
    <div className="app-layout">
      <aside className={"sidebar " + (menu ? "open" : "")}>
        <a
          className="brand"
          href="#"
          onClick={(e) => {
            e.preventDefault();
            changePage(user.role === "staff" ? "scan" : "dashboard");
          }}
        >
          <BrandLogo />
        </a>
        <div className="workspace-label">
          <span className="warehouse-icon">
            <img src="/brand/comsflow-mark.png" alt="" width={26} height={26} />
          </span>
          <span>
            ComsMiu<small>Không gian vận hành</small>
          </span>
          <span className="live-dot" />
        </div>
        <div className="nav-label">KHÔNG GIAN LÀM VIỆC</div>
        <nav>
          {navigation
            .filter(
              ([key]) =>
                user.role !== "staff" ||
                ["scan", "guide", "returns"].includes(key),
            )
            .map(([key, label, Icon]) => (
              <button
                key={key}
                aria-current={page === key ? "page" : undefined}
                onClick={() => changePage(key)}
                className={"nav-item " + (page === key ? "active" : "")}
              >
                <Icon size={19} />
                <span>{label}</span>
                {key === "scan" && <span className="nav-tag">SCAN</span>}
              </button>
            ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="support-card">
            <span className="live-dot" /> PostgreSQL · dữ liệu bền vững
            <small>Thời gian hiển thị UTC+7</small>
          </div>
          <div className="user-profile">
            <span className="avatar">
              {user.name
                .split(" ")
                .slice(-2)
                .map((s) => s[0])
                .join("")}
            </span>
            <div>
              <strong>{user.name}</strong>
              <small>
                {user.role === "admin"
                  ? "Quản trị viên"
                  : user.role === "manager"
                    ? "Quản lý kho"
                    : "Nhân viên kho"}
              </small>
            </div>
            <button
              className="icon-button"
              title="Đăng xuất"
              onClick={async () => {
                try {
                  await post("auth/logout", {});
                  onLogout();
                } catch (e) {
                  toast((e as Error).message, true);
                }
              }}
            >
              <LogOut size={17} />
            </button>
          </div>
        </div>
      </aside>
      {menu && <div className="sidebar-scrim" onClick={() => setMenu(false)} />}
      <div className="main-layout">
        <header className="topbar">
          <div className="inline">
            <button
              className="icon-button mobile-menu"
              aria-label="Mở menu"
              onClick={() => setMenu(!menu)}
            >
              <Menu />
            </button>
            <span className="muted">Không gian vận hành</span>
            <span className="breadcrumb">/</span>
            <strong>{titles[page][0]}</strong>
            {page === "returns" && (
              <span className="current-subpage">
                {
                  visibleReturnTabs(user.role).find(
                    (tab) => tab.key === location.returnTab,
                  )?.label
                }
              </span>
            )}
            {page === "imports" && (
              <span className="current-subpage">
                {location.importMode === "pdf"
                  ? "PDF tem vận đơn"
                  : "Excel / CSV đơn hàng"}
              </span>
            )}
          </div>
          <div className="inline">
            <span className={"connection " + (!online ? "offline" : "")}>
              <span className="live-dot" />
              {online ? "Đã kết nối" : "Mất kết nối"}
            </span>
            <button
              className="icon-button"
              title="Cảnh báo vận hành"
              onClick={() =>
                changePage(user.role === "staff" ? "scan" : "reconcile")
              }
            >
              <Bell size={19} />
            </button>
            <span className="avatar small-avatar">{user.name[0]}</span>
          </div>
        </header>
        <main className="content">
          {!online && (
            <div className="notice danger">
              <WifiOff size={18} /> Mất kết nối. Chưa xác nhận thành công cho
              đến khi máy chủ phản hồi.
            </div>
          )}
          {refs?.settings?.demo_mode && (
            <div className="demo-banner">
              <span>DEMO</span> Dữ liệu mô phỏng để chạy thử. Không sử dụng làm
              số liệu sản xuất.
            </div>
          )}
          <div className="page-heading">
            <div>
              <div className="eyebrow">OUTBOUND MANAGEMENT</div>
              <h1>{titles[page][0]}</h1>
              <p>{titles[page][1]}</p>
            </div>
            {user.role !== "staff" &&
              page === "returns" &&
              location.returnTab !== "import" && (
                <button
                  className="primary"
                  onClick={() => changePage("returns", "import")}
                >
                  <Upload size={18} /> Nhập dữ liệu đơn hoàn
                </button>
              )}
            {user.role !== "staff" && !["scan", "returns"].includes(page) && (
              <button className="primary" onClick={() => changePage("scan")}>
                <ScanLine size={18} /> Quét vận đơn
              </button>
            )}
          </div>
          <ErrorBox message={error} />
          {retainedHistory.length > 0 && (
            <div className="notice warning retention-notice">
              <Info size={18} />
              <p>
                {page === "returns"
                  ? "Một số hồ sơ hoàn cũ đã được Quản trị viên dọn vĩnh viễn. Danh sách và báo cáo lịch sử không còn các hồ sơ đã xoá."
                  : "Một số nhật ký quét cũ trong phạm vi này đã được Quản trị viên dọn. Báo cáo lượt quét/nhân viên không còn các dòng đã xoá; vận đơn và kết quả quét, bàn giao vẫn được giữ."}
              </p>
            </div>
          )}
          {!refs ? (
            <Loading />
          ) : (
            <>
              {["dashboard", "reports", "shipments"].includes(page) && (
                <Filters refs={refs} value={filters} onChange={setFilters} />
              )}
              {(page === "dashboard" || page === "reports") && (
                <Dashboard
                  query={query}
                  reports={page === "reports"}
                  onNavigate={(status: string) => {
                    if (["duplicate", "unknown"].includes(status)) {
                      setReconcileTab(
                        status === "duplicate" ? "events" : "exceptions",
                      );
                      changePage("reconcile");
                    } else {
                      setFilters({ ...filters, status });
                      changePage("shipments");
                    }
                  }}
                />
              )}
              {page === "scan" && (
                <Scanner refs={refs} user={user} onNavigate={changePage} />
              )}
              {page === "guide" && (
                <UserGuide user={user} onNavigate={changePage} />
              )}
              {page === "shipments" && <Shipments key={query} query={query} />}
              {page === "reconcile" && (
                <Reconciliation initialTab={reconcileTab} />
              )}
              {page === "handover" && <Handovers refs={refs} />}
              {page === "imports" && (
                <Imports
                  refs={refs}
                  onImportReturns={() => changePage("returns", "import")}
                  mode={location.importMode}
                  onModeChange={(mode) => changePage("imports", mode)}
                />
              )}
              {page === "returns" && (
                <ReturnsModule
                  user={user}
                  refs={refs}
                  tab={location.returnTab}
                  onTabChange={(tab) => changePage("returns", tab)}
                />
              )}
              {page === "people" && <People refs={refs} user={user} />}
              {page === "jobs" && <DataJobs />}
              {page === "settings" && <Configuration refs={refs} user={user} />}
            </>
          )}
          <footer className="footer">
            <span>
              <BrandLogo compact /> <span className="muted">/</span> ComsMiu
            </span>
            <span>Dữ liệu xác nhận tại máy chủ · Asia/Ho_Chi_Minh</span>
          </footer>
        </main>
      </div>
    </div>
  );
}
function Filters({
  refs,
  value,
  onChange,
}: {
  refs: Row;
  value: Row;
  onChange: (v: Row) => void;
}) {
  const [more, setMore] = useState(false);
  const update = (key: string, v: string) => onChange({ ...value, [key]: v });
  return (
    <section className="filters">
      <div className="date-presets">
        {[
          ["Hôm nay", 0],
          ["Hôm qua", 1],
          ["7 ngày", 6],
          ["30 ngày", 29],
        ].map(([label, days]) => (
          <button
            className="text-button"
            key={label}
            onClick={() => {
              const from = new Date(todayVN() + "T00:00:00Z");
              from.setUTCDate(from.getUTCDate() - Number(days));
              const date = from.toISOString().slice(0, 10);
              onChange({
                ...value,
                from: date,
                to: days === 1 ? date : todayVN(),
              });
            }}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="filter-main">
        <label className="date-filter">
          Từ
          <input
            type="date"
            aria-label="Từ ngày"
            value={value.from}
            onChange={(e) => update("from", e.target.value)}
          />
        </label>
        <label className="date-filter">
          Đến
          <input
            type="date"
            aria-label="Đến ngày"
            value={value.to}
            onChange={(e) => update("to", e.target.value)}
          />
        </label>
        {[
          ["channel", "Tất cả sàn", refs.channels],
          ["carrier", "Tất cả hãng vận chuyển", refs.carriers],
          ["warehouse", "Tất cả kho", refs.warehouses],
        ].map(([key, label, rows]) => (
          <select
            key={key as string}
            aria-label={label as string}
            value={value[key as string] ?? ""}
            onChange={(e) => update(key as string, e.target.value)}
          >
            <option value="">{label as string}</option>
            <OptionList rows={rows as Row[]} />
          </select>
        ))}
        <button className="secondary" onClick={() => setMore(!more)}>
          Bộ lọc {more ? "−" : "+"}
        </button>
      </div>
      {more && (
        <div className="filter-more">
          <label className="search-input">
            <Search size={16} />
            <input
              placeholder="Tìm mã đơn, vận đơn…"
              value={value.q ?? ""}
              onChange={(e) => update("q", e.target.value)}
            />
          </label>
          {[
            ["employee", "Nhân viên", refs.users],
            ["shop", "Gian hàng", refs.shops],
            ["shift", "Ca làm việc", refs.shifts],
          ].map(([key, label, rows]) => (
            <select
              key={key as string}
              aria-label={label as string}
              value={value[key as string] ?? ""}
              onChange={(e) => update(key as string, e.target.value)}
            >
              <option value="">Tất cả {String(label).toLowerCase()}</option>
              <OptionList rows={rows as Row[]} />
            </select>
          ))}
          <select
            aria-label="Lọc trạng thái dashboard"
            value={value.status ?? ""}
            onChange={(e) => update("status", e.target.value)}
          >
            <option value="">Tất cả trạng thái</option>
            {Object.entries(filterStatuses).map(([key, label]) => (
              <option value={key} key={key}>
                {label}
              </option>
            ))}
          </select>
          <button
            className="text-button"
            onClick={() => onChange({ from: todayVN(), to: todayVN() })}
          >
            Đặt lại
          </button>
        </div>
      )}
      <div className="filter-note">
        Theo ngày cần xuất. Biểu đồ lượt quét theo thời gian sự kiện trong cùng
        khoảng ngày.
      </div>
    </section>
  );
}
