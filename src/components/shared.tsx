"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { LoaderCircle, Inbox, X, Download } from "lucide-react";
import { formatTime, statuses } from "@/lib/domain";
export type Row = Record<string, any>;
export class ApiError extends Error {
  constructor(
    message: string,
    public status: number = 0,
  ) {
    super(message);
  }
  get retryable() {
    return this.status === 0 || this.status >= 500;
  }
}
export async function api(
  path: string,
  options: RequestInit = {},
  timeoutMs = 30000,
) {
  if (
    options.body instanceof FormData &&
    /^(sources|imports|returns\/(import|sales))\/(preview|commit)$/.test(path)
  ) {
    const { fileJob } = await import("./job-client");
    return fileJob(path, options.body);
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    let response: Response;
    try {
      response = await fetch("/api/" + path, {
        ...options,
        headers: {
          ...(options.body instanceof FormData
            ? {}
            : { "Content-Type": "application/json" }),
          ...options.headers,
        },
        cache: "no-store",
        signal: options.signal ?? controller.signal,
      });
    } catch {
      throw new ApiError(
        controller.signal.aborted
          ? "Máy chủ chưa xác nhận trong thời gian chờ. Kiểm tra kết nối và thử lại; không ghi nhận thành công."
          : "Mất kết nối. Chưa có xác nhận từ máy chủ. Không ghi nhận thành công.",
      );
    }
    let data;
    try {
      data = await response.json();
    } catch {
      throw new ApiError(
        "Máy chủ chưa trả kết quả hợp lệ. Chưa xác nhận thao tác thành công.",
        response.status >= 400 ? response.status : 502,
      );
    }
    if (!response.ok)
      throw new ApiError(
        data.error ?? "Không thể xử lý yêu cầu",
        response.status,
      );
    return data;
  } finally {
    clearTimeout(timeout);
  }
}

export const post = (path: string, data: unknown) =>
  api(path, { method: "POST", body: JSON.stringify(data) });
export function refresh() {
  window.dispatchEvent(new Event("wms:refresh"));
}
export function toast(message: string, error = false) {
  window.dispatchEvent(
    new CustomEvent("wms:toast", { detail: { message, error } }),
  );
}
export function useData<T = any>(path: string | null, interval = 0) {
  const [data, setData] = useState<T | null>(null),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(true);
  const generation = useRef(0);
  const load = useCallback(async () => {
    if (!path) return;
    const ticket = ++generation.current;
    try {
      const next = await api(path);
      if (ticket === generation.current) {
        setData(next);
        setError("");
      }
    } catch (e) {
      if (ticket === generation.current) setError((e as Error).message);
    } finally {
      if (ticket === generation.current) setLoading(false);
    }
  }, [path]);
  useEffect(() => {
    setData(null);
    setLoading(true);
    void load();
    const tick = interval ? setInterval(load, interval) : null;
    const invalidate = () => {
      generation.current += 1;
    };
    window.addEventListener("wms:refresh", load);
    return () => {
      invalidate();
      if (tick) clearInterval(tick);
      window.removeEventListener("wms:refresh", load);
    };
  }, [load, interval]);
  return { data, error, loading, reload: load };
}
export function useCatalogSelection(rows: Row[], preferred = "") {
  const [requested, setRequested] = useState(preferred);
  const value = rows.some((r) => r.id === requested)
    ? requested
    : rows.some((r) => r.id === preferred)
      ? preferred
      : (rows[0]?.id ?? "");
  return [value as string, setRequested] as const;
}
export function Loading() {
  return (
    <div className="empty">
      <LoaderCircle className="spin" />
      <span>Đang tải dữ liệu…</span>
    </div>
  );
}
export function Empty({
  text = "Chưa có dữ liệu trong bộ lọc này",
}: {
  text?: string;
}) {
  return (
    <div className="empty">
      <Inbox size={32} />
      <p>{text}</p>
    </div>
  );
}
export function ErrorBox({ message }: { message: string }) {
  return message ? (
    <div className="notice danger" role="alert">
      {message}
    </div>
  ) : null;
}
export function Badge({ status, label }: { status: string; label?: string }) {
  return (
    <span
      className={
        "badge " +
        ([
          "scanned",
          "handed_over",
          "success",
          "confirmed",
          "resolved",
        ].includes(status)
          ? "green"
          : ["cancelled", "blocked", "duplicate", "invalid"].includes(status)
            ? "red"
            : "orange")
      }
    >
      {label ??
        statuses[status] ??
        (
          {
            draft: "Phiếu nháp",
            confirmed: "Đã xác nhận",
            cancelled: "Đã hủy",
            open: "Chưa xử lý",
            resolved: "Đã xử lý",
            success: "Thành công",
            duplicate: "Quét trùng",
            unknown: "Chờ file đối soát",
            invalid: "Mã không hợp lệ",
            carrier_mismatch: "Sai hãng",
            warehouse_mismatch: "Sai kho",
          } as Row
        )[status] ??
        status}
    </span>
  );
}
export function Modal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  useEffect(() => {
    const handle = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handle);
    return () => window.removeEventListener("keydown", handle);
  }, [onClose]);
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <section
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="card-heading">
          <h2>{title}</h2>
          <button className="icon-button" aria-label="Đóng" onClick={onClose}>
            <X />
          </button>
        </div>
        {children}
      </section>
    </div>
  );
}
export function ExportButtons({ query = "" }: { query?: string }) {
  return (
    <div className="inline">
      <a
        className="button secondary small"
        href={"/api/export?" + query + "&format=xlsx"}
      >
        <Download size={15} /> Excel
      </a>
      <a
        className="button secondary small"
        href={"/api/export?" + query + "&format=csv"}
      >
        CSV
      </a>
    </div>
  );
}
export function Time({ value }: { value?: string }) {
  return <span className="nowrap">{formatTime(value)}</span>;
}
export function OptionList({ rows }: { rows: Row[] }) {
  return (
    <>
      {!rows.length && (
        <option value="">Chưa có danh mục · cần thiết lập</option>
      )}
      {rows.map((row) => (
        <option key={row.id} value={row.id}>
          {row.name}
        </option>
      ))}
    </>
  );
}
export function FormField({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
    </label>
  );
}
