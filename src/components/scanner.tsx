"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Camera,
  ScanLine,
  CheckCircle2,
  TriangleAlert,
  Volume2,
  Vibrate,
  Keyboard,
  Flashlight,
  RotateCcw,
} from "lucide-react";
import type { User } from "@/lib/db";
import { formatTime } from "@/lib/domain";
import {
  post,
  useData,
  refresh,
  ErrorBox,
  Badge,
  Loading,
  OptionList,
  useCatalogSelection,
  ApiError,
  type Row,
} from "./shared";
export function Scanner({
  refs,
  user,
  onNavigate,
}: {
  refs: Row;
  user: User;
  onNavigate: (page: string) => void;
}) {
  const [clock, setClock] = useState(() =>
    refs.serverTime ? new Date(refs.serverTime).getTime() : Date.now(),
  );
  useEffect(() => {
    if (refs.serverTime) setClock(new Date(refs.serverTime).getTime());
  }, [refs.serverTime]);
  useEffect(() => {
    const timer = setInterval(() => setClock((value) => value + 1000), 1000);
    return () => clearInterval(timer);
  }, []);
  const active = refs.shifts.filter(
    (s: Row) =>
      s.assigned &&
      new Date(s.starts_at).getTime() <= clock &&
      new Date(s.ends_at).getTime() > clock,
  );
  const [requestedShiftId, setShiftId] = useState("");
  const [warehouseId, setWarehouseId] = useCatalogSelection(
    refs.warehouses,
    active[0]?.warehouse_id ?? "",
  );
  const selectedShift =
    active.find(
      (s: Row) => s.id === requestedShiftId && s.warehouse_id === warehouseId,
    ) ?? active.find((s: Row) => s.warehouse_id === warehouseId);
  const shiftId = selectedShift?.id ?? "";
  const [carrierId, setCarrierId] = useState("");
  const [method, setMethod] = useState<"manual" | "hid">("manual");
  const [online, setOnline] = useState(true);
  const [starting, setStarting] = useState(false);
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);
  const canScan = Boolean(shiftId) && online;
  const [code, setCode] = useState(""),
    [result, setResult] = useState<Row | null>(null),
    [error, setError] = useState(""),
    [pending, setPending] = useState(0),
    [camera, setCamera] = useState(false);
  const [sound, setSound] = useState(true),
    [vibration, setVibration] = useState(true),
    [failed, setFailed] = useState<Row[]>([]);
  const input = useRef<HTMLInputElement>(null),
    queue = useRef(Promise.resolve()),
    audio = useRef<AudioContext | null>(null);
  const {
    data: mine,
    loading,
    error: historyError,
  } = useData<Row>("scans/mine" + (shiftId ? "?shift=" + shiftId : ""), 5000);
  useEffect(() => {
    setSound(localStorage.getItem("wms-sound") !== "false");
    setVibration(localStorage.getItem("wms-vibration") !== "false");
  }, []);
  const feedback = useCallback(
    (ok: boolean) => {
      if (vibration && navigator.vibrate)
        navigator.vibrate(ok ? 80 : [100, 60, 100]);
      if (sound) {
        try {
          const context = (audio.current ??= new AudioContext());
          void context.resume();
          const oscillator = context.createOscillator(),
            gain = context.createGain();
          oscillator.connect(gain);
          gain.connect(context.destination);
          oscillator.frequency.value = ok ? 880 : 220;
          oscillator.type = ok ? "sine" : "square";
          gain.gain.setValueAtTime(0.07, context.currentTime);
          gain.gain.exponentialRampToValueAtTime(
            0.001,
            context.currentTime + 0.2,
          );
          oscillator.start();
          oscillator.stop(context.currentTime + 0.2);
        } catch {
          /* Device without WebAudio still displays status. */
        }
      }
    },
    [sound, vibration],
  );
  const enqueue = (value: string, scanMethod: string, previous?: Row) => {
    if (!value.trim()) return;
    if (!online) {
      setError(
        "Đang mất mạng. Giữ mã và kết nối lại trước khi gửi; chưa ghi nhận thành công.",
      );
      return;
    }
    if (!previous && !shiftId) {
      setError(
        "Chưa có ca hợp lệ tại kho đang chọn. Mở ca cho bạn hoặc nhờ quản lý phân công trước khi xác nhận.",
      );
      input.current?.focus();
      return;
    }
    const payload = previous ?? {
      code: value,
      method: scanMethod,
      requestId: crypto.randomUUID(),
      shiftId,
      warehouseId,
      carrierId,
    };
    setPending((n) => n + 1);
    setResult(null);
    setError("");
    if (!previous) setCode("");
    input.current?.focus();
    queue.current = queue.current.then(async () => {
      try {
        const r = await post("scans", payload);
        setResult(r);
        feedback(r.outcome === "success");
        setFailed((list) =>
          list.filter((item) => item.requestId !== payload.requestId),
        );
        refresh();
      } catch (e) {
        setError(`Mã ${payload.code}: ${(e as Error).message}`);
        setResult(null);
        feedback(false);
        if (e instanceof ApiError && e.retryable)
          setFailed((list) =>
            list.some((item) => item.requestId === payload.requestId)
              ? list
              : [...list, payload],
          );
        else {
          if (e instanceof ApiError && [400, 403].includes(e.status)) refresh();
          setFailed((list) =>
            list.filter((item) => item.requestId !== payload.requestId),
          );
          setCode((current) => current || payload.code);
        }
      } finally {
        setPending((n) => n - 1);
      }
    });
  };
  return (
    <div className="scanner-layout">
      <section className="card scan-station">
        <div className="card-heading">
          <div>
            <h2>
              <ScanLine size={20} /> Trạm quét
            </h2>
            <p>Một quy trình xác minh cho camera, súng quét và nhập tay</p>
          </div>
          <span className="live-label">
            <span className="live-dot" />{" "}
            {pending
              ? "Đang xác minh"
              : canScan
                ? "Sẵn sàng"
                : !online
                  ? "Mất kết nối"
                  : "Cần chọn ca"}
          </span>
        </div>
        <div className="scan-context">
          <label className="field">
            Kho xử lý
            <select
              value={warehouseId}
              disabled={pending > 0}
              onChange={(e) => {
                setWarehouseId(e.target.value);
                setShiftId("");
              }}
            >
              <OptionList rows={refs.warehouses} />
            </select>
          </label>
          <label className="field">
            Ca làm việc
            <select
              value={shiftId}
              disabled={pending > 0}
              onChange={(e) => setShiftId(e.target.value)}
            >
              <option value="">Chọn ca được phân công</option>
              {active
                .filter((s: Row) => s.warehouse_id === warehouseId)
                .map((s: Row) => (
                  <option value={s.id} key={s.id}>
                    {s.name}
                  </option>
                ))}
            </select>
          </label>
          <label className="field">
            Kiểm tra hãng
            <select
              value={carrierId}
              disabled={pending > 0}
              onChange={(e) => setCarrierId(e.target.value)}
            >
              <option value="">Tất cả hãng</option>
              <OptionList rows={refs.carriers} />
            </select>
          </label>
        </div>
        {!shiftId && (
          <div className="scan-prerequisite notice warning">
            <div>
              <strong>
                Chưa có ca được phân công đang hoạt động tại kho này.
              </strong>
              <p>
                Mỗi lượt nhập tay, HID hay camera đều cần ca để ghi đúng nhân
                viên và thời gian.
              </p>
            </div>
            <div className="inline wrap">
              {user.role !== "staff" && (
                <>
                  <button
                    className="primary small"
                    disabled={starting || !warehouseId}
                    onClick={async () => {
                      setStarting(true);
                      setError("");
                      try {
                        const shift = await post("shifts/start-self", {
                          warehouseId,
                        });
                        setShiftId(shift.id);
                        refresh();
                      } catch (e) {
                        setError((e as Error).message);
                      } finally {
                        setStarting(false);
                      }
                    }}
                  >
                    {starting ? "Đang mở ca…" : "Mở ca cho tôi"}
                  </button>
                  <button
                    className="secondary small"
                    onClick={() => onNavigate("people")}
                  >
                    Quản lý phân công ca
                  </button>
                </>
              )}
              <button className="secondary small" onClick={refresh}>
                Tải lại phân công
              </button>
              <button
                className="text-button"
                onClick={() => onNavigate("guide")}
              >
                Xem hướng dẫn
              </button>
            </div>
          </div>
        )}
        <div className="notice scan-source-note">
          Nhập mã chỉ tra cứu vận đơn đã có trong dữ liệu nguồn.{" "}
          {user.role !== "staff" ? (
            <button
              className="text-button"
              onClick={() => onNavigate("imports")}
            >
              Nhập PDF / Excel / CSV trước
            </button>
          ) : (
            <span>Nhờ quản lý nhập PDF / Excel / CSV trước khi quét.</span>
          )}
        </div>
        <div className="scan-input-section">
          <div className="scan-glyph">
            <ScanLine size={36} />
          </div>
          <h2>
            {canScan ? "Sẵn sàng nhận vận đơn" : "Chuẩn bị ca trước khi quét"}
          </h2>
          <p>
            {method === "manual"
              ? "Nhập hoặc dán mã, sau đó nhấn Xác nhận hoặc Enter."
              : "Súng quét USB/Bluetooth gửi Enter hoặc Tab để ghi nhận."}
          </p>
          <div
            className="input-methods"
            role="group"
            aria-label="Phương thức nhập"
          >
            <button
              type="button"
              aria-pressed={method === "manual"}
              className={
                method === "manual" ? "primary small" : "secondary small"
              }
              onClick={() => setMethod("manual")}
            >
              Nhập tay
            </button>
            <button
              type="button"
              aria-pressed={method === "hid"}
              className={method === "hid" ? "primary small" : "secondary small"}
              onClick={() => setMethod("hid")}
            >
              Súng quét HID
            </button>
          </div>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              enqueue(code, method);
            }}
          >
            <div className="scan-input-wrap">
              <Keyboard size={23} />
              <input
                ref={input}
                autoFocus
                autoComplete="off"
                spellCheck={false}
                aria-label="Mã vận đơn"
                placeholder="Quét hoặc nhập mã vận đơn…"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                onKeyDown={(e) => {
                  if (
                    e.key === "Tab" &&
                    method === "hid" &&
                    code.trim() &&
                    !e.nativeEvent.isComposing
                  ) {
                    e.preventDefault();
                    enqueue(code, method);
                  }
                }}
              />
              <button
                className="primary"
                type="submit"
                disabled={!canScan || !code.trim()}
              >
                Xác nhận
              </button>
            </div>
          </form>
          <div className="scan-actions">
            <button
              className="secondary"
              onClick={() => setCamera(!camera)}
              disabled={!canScan}
            >
              <Camera size={18} />
              {camera ? "Đóng camera" : "Quét bằng camera"}
            </button>
            <button
              className="text-button"
              disabled={!code.trim() || !canScan}
              onClick={() => enqueue(code, "manual")}
            >
              Ghi nhận nhập tay
            </button>
            <span className="muted">
              {pending > 0
                ? `Đang xác minh ${pending} mã…`
                : "Chỉ thành công sau khi máy chủ xác nhận"}
            </span>
          </div>
        </div>
        {camera && canScan && (
          <CameraScanner onCode={(value) => enqueue(value, "camera")} />
        )}
        <ErrorBox message={error} />
        {failed.length > 0 && (
          <div className="pending-requests notice warning">
            <strong>
              {failed.length} yêu cầu chưa rõ kết quả — chưa xác nhận thành công
            </strong>
            {failed.map((item) => (
              <button
                key={item.requestId}
                className="secondary small"
                disabled={pending > 0 || !online}
                onClick={() => enqueue(item.code, item.method, item)}
              >
                <RotateCcw size={16} /> Gửi lại yêu cầu {item.code} an toàn
              </button>
            ))}
            <p>
              Giữ trang này để gửi lại cùng mã yêu cầu, tránh đếm trùng nếu phản
              hồi bị mất.
            </p>
          </div>
        )}
        {result && (
          <div
            className={
              "scan-result " +
              (result.outcome === "success"
                ? "success"
                : result.outcome === "unknown"
                  ? "warning"
                  : "failure")
            }
            role="status"
          >
            <div className="result-label">
              {result.outcome === "success" ? (
                <CheckCircle2 />
              ) : (
                <TriangleAlert />
              )}
              {result.message}
            </div>
            <div className="result-code">
              {result.code || "Mã không hợp lệ"}
            </div>
            {result.shipment ? (
              <>
                <div className="result-tags">
                  <span>{result.shipment.channel}</span>
                  <span>{result.shipment.carrier}</span>
                  <span>{result.shipment.shop}</span>
                </div>
                <dl className="details-grid">
                  <div>
                    <dt>Mã đơn sàn</dt>
                    <dd>{result.shipment.external_id}</dd>
                  </div>
                  <div>
                    <dt>
                      {result.outcome === "duplicate"
                        ? "Nhân viên quét lần đầu"
                        : "Nhân viên thao tác"}
                    </dt>
                    <dd>
                      {result.outcome === "duplicate"
                        ? result.shipment.first_scanned_by
                        : result.employee}
                    </dd>
                  </div>
                  <div>
                    <dt>
                      {result.outcome === "duplicate"
                        ? "Thời gian quét lần đầu"
                        : "Thời gian máy chủ"}
                    </dt>
                    <dd>
                      {formatTime(
                        result.outcome === "duplicate"
                          ? result.shipment.scanned_at
                          : result.at,
                      )}
                    </dd>
                  </div>
                  <div>
                    <dt>Trạng thái vận đơn</dt>
                    <dd>
                      <Badge status={result.shipment.status} />
                    </dd>
                  </div>
                </dl>
                {result.items.length > 0 && (
                  <div className="scan-items">
                    {result.items.map((item: Row, i: number) => (
                      <span key={i}>
                        {item.sku} · {item.name} · {item.color} / {item.size} ×{" "}
                        {item.quantity}
                      </span>
                    ))}
                  </div>
                )}
              </>
            ) : (
              <p>
                {result.hint
                  ? `Gợi ý tiền tố: ${result.hint.carrier} / ${result.hint.channel ?? "Chưa xác định"}. Chưa xác minh, cần đối soát.`
                  : "Không suy đoán thông tin đơn khi chưa có dữ liệu nguồn."}
              </p>
            )}
            <small>
              Sự kiện: {result.id} · {formatTime(result.at)}
            </small>
          </div>
        )}
        <div className="scan-preferences">
          <label>
            <input
              type="checkbox"
              checked={sound}
              onChange={(e) => {
                setSound(e.target.checked);
                localStorage.setItem("wms-sound", String(e.target.checked));
              }}
            />
            <Volume2 size={16} /> Âm thanh
          </label>
          <label>
            <input
              type="checkbox"
              checked={vibration}
              onChange={(e) => {
                setVibration(e.target.checked);
                localStorage.setItem("wms-vibration", String(e.target.checked));
              }}
            />
            <Vibrate size={16} /> Rung thiết bị
          </label>
          <span>{user.name} · UTC+7</span>
        </div>
      </section>
      <div>
        <section className="card shift-summary">
          <span className="eyebrow">
            {shiftId ? "CA ĐANG CHỌN" : "HÔM NAY"} · CỦA BẠN
          </span>
          <div className="big-number">{mine?.summary?.success ?? "—"}</div>
          <p>vận đơn quét thành công</p>
          <div className="summary-pair">
            <span>
              <b>{mine?.summary?.duplicate ?? 0}</b> Quét trùng
            </span>
            <span>
              <b>{mine?.summary?.error ?? 0}</b> Lỗi / ngoại lệ
            </span>
          </div>
        </section>
        <section className="card recent-scans">
          <div className="card-heading">
            <div>
              <h2>10 lượt quét gần nhất</h2>
              <p>Nhật ký của bạn</p>
            </div>
          </div>
          <ErrorBox message={historyError} />
          {loading && !mine ? (
            <Loading />
          ) : (
            mine?.recent.map((r: Row) => (
              <div className="recent-row" key={r.id}>
                <div>
                  <strong>{r.tracking_code ?? r.raw_code}</strong>
                  <small>
                    {formatTime(r.created_at)} · {r.method.toUpperCase()}
                  </small>
                </div>
                <Badge status={r.outcome} />
              </div>
            ))
          )}
        </section>
      </div>
    </div>
  );
}
export function CameraScanner({ onCode }: { onCode: (value: string) => void }) {
  const [error, setError] = useState(""),
    [ready, setReady] = useState(false),
    [torch, setTorch] = useState(false),
    [torchSupported, setTorchSupported] = useState(false);
  const scanner = useRef<import("html5-qrcode").Html5Qrcode | null>(null),
    callback = useRef(onCode),
    last = useRef({ code: "", at: 0 });
  useEffect(() => {
    callback.current = onCode;
  }, [onCode]);
  useEffect(() => {
    let stopped = false;
    let instance: import("html5-qrcode").Html5Qrcode | null = null;
    async function start() {
      try {
        if (!window.isSecureContext)
          throw new Error("Camera cần HTTPS (hoặc localhost khi phát triển).");
        const lib = await import("html5-qrcode");
        if (stopped) return;
        instance = new lib.Html5Qrcode("camera-view", {
          formatsToSupport: [
            lib.Html5QrcodeSupportedFormats.QR_CODE,
            lib.Html5QrcodeSupportedFormats.CODE_128,
            lib.Html5QrcodeSupportedFormats.CODE_39,
            lib.Html5QrcodeSupportedFormats.EAN_13,
            lib.Html5QrcodeSupportedFormats.ITF,
            lib.Html5QrcodeSupportedFormats.DATA_MATRIX,
          ],
          experimentalFeatures: { useBarCodeDetectorIfSupported: true },
          verbose: false,
        });
        scanner.current = instance;
        await instance.start(
          { facingMode: "environment" },
          {
            fps: 12,
            qrbox: (width, height) => ({
              width: Math.min(width * 0.85, 400),
              height: Math.min(height * 0.7, 220),
            }),
            disableFlip: false,
          },
          (value) => {
            if (stopped) return;
            const now = Date.now();
            if (last.current.code === value && now - last.current.at < 2500)
              return;
            last.current = { code: value, at: now };
            callback.current(value);
          },
          () => {},
        );
        if (stopped) {
          await instance.stop();
          instance.clear();
          return;
        }
        setReady(true);
        const caps =
          instance.getRunningTrackCapabilities() as MediaTrackCapabilities & {
            torch?: boolean;
          };
        setTorchSupported(Boolean(caps.torch));
      } catch (e) {
        if (!stopped)
          setError(
            "Không mở được camera: " +
              String(e instanceof Error ? e.message : e) +
              ". Kiểm tra quyền camera hoặc dùng súng quét / nhập tay.",
          );
      }
    }
    void start();
    return () => {
      stopped = true;
      if (instance?.isScanning)
        void instance
          .stop()
          .then(() => instance?.clear())
          .catch(() => {});
      scanner.current = null;
    };
  }, []);
  return (
    <div className="camera-panel">
      <ErrorBox message={error} />
      <div id="camera-view" />
      {!ready && !error && <p>Đang xin quyền truy cập camera sau…</p>}
      {torchSupported && (
        <button
          className="secondary"
          onClick={async () => {
            try {
              await scanner.current?.applyVideoConstraints({
                advanced: [{ torch: !torch } as MediaTrackConstraintSet],
              });
              setTorch(!torch);
            } catch {
              setError("Thiết bị không cho phép điều khiển đèn flash.");
            }
          }}
        >
          <Flashlight size={17} />
          {torch ? "Tắt" : "Bật"} đèn flash
        </button>
      )}
      <p className="small-note">
        Đặt QR / barcode trong khung. Camera dùng bộ giải mã dự phòng khi trình
        duyệt thiếu BarcodeDetector.
      </p>
    </div>
  );
}
