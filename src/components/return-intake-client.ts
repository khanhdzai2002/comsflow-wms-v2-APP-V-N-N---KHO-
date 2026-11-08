import { createClient } from "@supabase/supabase-js";
import { RETURN_INTAKE_VERSION } from "../lib/return-intake-fields";
import { requestJob } from "./job-client";
type Progress = (message: string) => void;
function workerMessage(
  worker: Worker,
  body: unknown,
  signal?: AbortSignal,
): Promise<any> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error("Đã dừng; chọn lại tệp để tiếp tục"));
      return;
    }
    const stop = () => {
      clearTimeout(timer);
      worker.removeEventListener("message", listener);
      worker.removeEventListener("error", failure);
      signal?.removeEventListener("abort", cancel);
    };
    const listener = (event: MessageEvent) => {
      if (!["ready", "rows", "error"].includes(event.data?.type)) return;
      stop();
      if (event.data.type === "error") {
        const error = new Error(event.data.error);
        Object.assign(error, { code: "RETURN_PARSE_FAILED" });
        reject(error);
      } else resolve(event.data);
    };
    const failure = () => {
      stop();
      reject(
        new Error(
          "Không đọc được tệp trong trình duyệt. Dùng bản gốc CSV UTF-8/XLSX không có mật khẩu",
        ),
      );
    };
    const cancel = () => {
      stop();
      reject(
        new Error("Đã dừng; tiến độ được giữ để tiếp tục khi chọn lại tệp"),
      );
    };
    const timer = setTimeout(() => {
      stop();
      reject(new Error("Đọc tệp quá thời gian; chọn lại để tiếp tục"));
    }, 180000);
    worker.addEventListener("message", listener);
    worker.addEventListener("error", failure);
    signal?.addEventListener("abort", cancel, { once: true });
    worker.postMessage(body);
  });
}
export async function readReturnIntake(
  file: File,
  context: Record<string, unknown>,
  mapping: Record<string, string>,
  progress: Progress,
  signal?: AbortSignal,
) {
  if (
    !/\.(csv|xlsx)$/i.test(file.name) ||
    !file.size ||
    file.size > 10 * 1024 * 1024
  )
    throw new Error("Chọn CSV/XLSX gốc, tối đa 10 MB và 50.000 dòng");
  progress("Đang kiểm tra mã toàn vẹn tệp gốc…");
  const hash = Array.from(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", await file.arrayBuffer()),
    ),
    (b) => b.toString(16).padStart(2, "0"),
  ).join("");
  const ordered = (value: Record<string, unknown>) =>
    Object.fromEntries(
      Object.entries(value).sort(([a], [b]) => a.localeCompare(b)),
    );
  const key =
    "comsflow-return-intake:" +
    RETURN_INTAKE_VERSION +
    ":" +
    hash +
    ":" +
    JSON.stringify({ context: ordered(context), mapping: ordered(mapping) });
  let cached: { id?: string; requestKey: string };
  try {
    cached = JSON.parse(localStorage.getItem(key) || "null") || {
      requestKey: crypto.randomUUID(),
    };
  } catch {
    cached = { requestKey: crypto.randomUUID() };
  }
  if (cached.id) {
    const old = await requestJob("jobs/" + cached.id).catch(() => null);
    if (
      !old ||
      ["failed", "cancelled"].includes(old.status) ||
      (old.expiresAt && new Date(old.expiresAt).getTime() <= Date.now())
    )
      cached = { requestKey: crypto.randomUUID() };
  }
  if (!cached.id) {
    progress("Đang lưu tệp gốc vào kho bảo mật…");
    const upload = await requestJob("jobs/uploads", {
      route: "returns/intake/preview",
      filename: file.name,
      size: file.size,
      sha256: hash,
      payload: { context, mapping },
      requestKey: cached.requestKey,
    });
    cached.id = upload.id;
    if (upload.status === "waiting_upload") {
      const client = createClient(upload.url, upload.key, {
        auth: {
          persistSession: false,
          autoRefreshToken: false,
          detectSessionInUrl: false,
        },
      });
      const result = await client.storage
        .from(upload.bucket)
        .uploadToSignedUrl(upload.path, upload.token, file, {
          contentType: /\.xlsx$/i.test(file.name)
            ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            : "text/csv",
        });
      if (result.error)
        throw new Error("Chưa tải đủ tệp gốc. Kiểm tra kết nối rồi thử lại");
    }
    localStorage.setItem(key, JSON.stringify(cached));
  }
  await requestJob("jobs/" + cached.id + "/finalize", {});
  const worker = new Worker(
    new URL("../worker/browser-return-intake.ts", import.meta.url),
    { type: "module" },
  );
  try {
    progress("Đang đọc các ô ở dạng văn bản, giữ nguyên mã dài…");
    const ready = await workerMessage(worker, { type: "open", file }, signal);
    const batch = await requestJob("jobs/" + cached.id + "/intake-start", {
      headers: ready.headers,
      totalRows: ready.rows,
    });
    if (batch.state === "reused" || batch.state === "completed")
      return {
        ...(await requestJob("jobs/" + cached.id + "/intake-preview", {})),
        jobId: cached.id,
        headers: ready.headers,
      };
    let offset = batch.staged_rows;
    while (offset < ready.rows) {
      if (signal?.aborted)
        throw new Error(
          "Đã dừng; tiến độ đã lưu, chọn lại cùng tệp để tiếp tục",
        );
      progress(
        `Đang đối chiếu ${offset.toLocaleString("vi-VN")}/${ready.rows.toLocaleString("vi-VN")} dòng…`,
      );
      const chunk = await workerMessage(
        worker,
        { type: "rows", offset },
        signal,
      );
      const saved = await requestJob("jobs/" + cached.id + "/intake-rows", {
        offset,
        rows: chunk.rows,
      });
      offset = saved.stagedRows;
    }
    progress("Đang kiểm tra trùng, mâu thuẫn và tổng hợp bản xem trước…");
    return {
      ...(await requestJob("jobs/" + cached.id + "/intake-preview", {})),
      jobId: cached.id,
      headers: ready.headers,
    };
  } catch (error) {
    if ((error as any).code === "RETURN_PARSE_FAILED")
      await requestJob("jobs/" + cached.id + "/intake-read-error", {
        message: (error as Error).message.slice(0, 1000),
      }).catch(() => {});
    throw error;
  } finally {
    worker.terminate();
  }
}
export async function saveReturnIntake(
  jobId: string,
  progress: Progress,
  signal?: AbortSignal,
) {
  for (;;) {
    if (signal?.aborted)
      throw new Error(
        "Đã dừng ở lô đã xác nhận. Chọn lại cùng tệp để tiếp tục; không nhập trùng",
      );
    const result = await requestJob("jobs/" + jobId + "/intake-commit", {});
    if (result.reused) {
      progress("Tệp đã được lưu từ lần nhập trước; không tạo trùng dữ liệu");
      return result;
    }
    progress(
      `Đã lưu ${Number(result.batch.imported_rows ?? 0).toLocaleString("vi-VN")}/${Number(result.batch.summary?.valid ?? result.batch.total_rows).toLocaleString("vi-VN")} dòng hợp lệ…`,
    );
    if (result.done) return result;
  }
}

export async function downloadReturnIntakeErrors(
  jobId: string,
  progress: Progress,
) {
  const rows: any[] = [];
  let headers: string[] = [];
  for (let offset = 0; ;) {
    const page = await requestJob("jobs/" + jobId + "/intake-errors", {
      offset,
    });
    rows.push(...page.rows);
    headers = page.headers;
    offset += page.rows.length;
    progress("Đang lấy báo cáo lỗi: " + offset + " dòng");
    if (page.done) break;
  }
  if (!rows.length) throw new Error("Không có dòng lỗi để xuất");
  const worker = new Worker(
    new URL("../worker/browser-return-report.ts", import.meta.url),
    { type: "module" },
  );
  try {
    const result = await new Promise<any>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error("Tạo tệp quá thời gian")),
        180000,
      );
      worker.onmessage = (e) => {
        clearTimeout(timer);
        if (e.data.type === "file") resolve(e.data);
        else reject(new Error(e.data.error));
      };
      worker.onerror = () => {
        clearTimeout(timer);
        reject(new Error("Chưa tạo được báo cáo lỗi"));
      };
      worker.postMessage({ type: "errors", headers, rows });
    });
    const url = URL.createObjectURL(
      new Blob([result.bytes], {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = "COMS-FLOW_Dong-can-sua.xlsx";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
    progress("Đã tạo báo cáo toàn bộ " + rows.length + " dòng lỗi");
  } finally {
    worker.terminate();
  }
}
