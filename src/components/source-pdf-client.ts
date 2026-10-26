import { createClient } from "@supabase/supabase-js";
import { requestJob } from "./job-client";
import {
  MAX_SOURCE_PDF_BYTES,
  SOURCE_ANALYZER_VERSION,
} from "@/lib/source-limits";

type Progress = (message: string) => void;
const fileHashes = new WeakMap<File, Promise<string>>();
function fileHash(file: File) {
  if (!fileHashes.has(file))
    fileHashes.set(
      file,
      file
        .arrayBuffer()
        .then((bytes) => crypto.subtle.digest("SHA-256", bytes))
        .then((bytes) =>
          Array.from(new Uint8Array(bytes), (b) =>
            b.toString(16).padStart(2, "0"),
          ).join(""),
        ),
    );
  return fileHashes.get(file)!;
}
function workerRequest(
  worker: Worker,
  body: unknown,
  signal?: AbortSignal,
): Promise<any> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error("Đã dừng đọc PDF. Tiến độ đã gửi vẫn được giữ."));
      return;
    }
    const finish = () => {
      worker.removeEventListener("message", message);
      worker.removeEventListener("error", error);
      signal?.removeEventListener("abort", abort);
      clearTimeout(timer);
    };
    const message = (event: MessageEvent) => {
      if (!["ready", "pages", "error"].includes(event.data?.type)) return;
      finish();
      if (event.data.type === "error") reject(new Error(event.data.error));
      else resolve(event.data);
    };
    const error = () => {
      finish();
      reject(
        new Error(
          "Trình duyệt chưa đọc được PDF. Thử lại file gốc trên máy tính; file ảnh/mật khẩu chưa được hỗ trợ.",
        ),
      );
    };
    const abort = () => {
      finish();
      reject(
        new Error(
          "Đã dừng đọc PDF. Chọn lại file để tiếp tục từ tiến độ đã gửi.",
        ),
      );
    };
    const timer = setTimeout(() => {
      finish();
      reject(
        new Error("Đọc PDF quá thời gian chờ. Chọn lại file để tiếp tục."),
      );
    }, 180000);
    worker.addEventListener("message", message);
    worker.addEventListener("error", error);
    signal?.addEventListener("abort", abort, { once: true });
    worker.postMessage(body);
  });
}

export async function browserSourcePdfJob(
  route: string,
  form: FormData,
  onProgress: Progress = () => {},
  signal?: AbortSignal,
) {
  const file = form.get("file");
  if (
    !(file instanceof File) ||
    !/\.pdf$/i.test(file.name) ||
    !file.size ||
    file.size > MAX_SOURCE_PDF_BYTES
  )
    throw new Error("Chọn PDF gốc, tối đa 50 MB.");
  const context = JSON.parse(String(form.get("context") || "{}"));
  onProgress("Đang kiểm tra PDF và mã SHA-256…");
  const hash = await fileHash(file);
  // Stable context ordering across the form and a page refresh.
  const ordered = Object.fromEntries(
    Object.entries(context).sort(([a], [b]) => a.localeCompare(b)),
  );
  const key =
    "comsflow-browser-pdf:" +
    SOURCE_ANALYZER_VERSION +
    ":" +
    hash +
    ":" +
    JSON.stringify(ordered);
  let cached: { id?: string; requestKey: string };
  try {
    cached = JSON.parse(localStorage.getItem(key) || "null") || {
      requestKey: crypto.randomUUID(),
    };
  } catch {
    cached = { requestKey: crypto.randomUUID() };
  }
  if (route.endsWith("/commit")) {
    if (!cached.id)
      throw new Error("Đọc và đối chiếu PDF trước khi xác nhận lưu.");
    onProgress("Đang lưu nguồn PDF; chờ máy chủ xác nhận…");
    return requestJob("jobs/" + cached.id + "/commit", {});
  }
  let existing: any = null;
  if (cached.id)
    existing = await requestJob("jobs/" + cached.id).catch(() => null);
  if (
    cached.id &&
    (!existing ||
      existing.route.endsWith("/commit") ||
      (existing.expiresAt &&
        new Date(existing.expiresAt).getTime() <= Date.now()) ||
      ["failed", "cancelled"].includes(existing.status))
  ) {
    cached = { requestKey: crypto.randomUUID() };
    existing = null;
  }
  localStorage.setItem(key, JSON.stringify(cached));
  if (!cached.id) {
    onProgress("Đang lưu PDF gốc vào kho tệp bảo mật…");
    const upload = await requestJob("jobs/uploads", {
      route: "sources/browser/preview",
      filename: file.name,
      size: file.size,
      sha256: hash,
      payload: { context },
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
          contentType: "application/pdf",
        });
      if (result.error) {
        try {
          await requestJob("jobs/" + cached.id + "/finalize", {});
        } catch {
          throw new Error(
            "Chưa tải đủ PDF gốc lên Storage. Kiểm tra mạng rồi chọn lại file.",
          );
        }
      }
    }
    localStorage.setItem(key, JSON.stringify(cached));
  }
  await requestJob("jobs/" + cached.id + "/finalize", {});
  const worker = new Worker(
    new URL("../worker/browser-source-pdf.ts", import.meta.url),
    { type: "module" },
  );
  try {
    onProgress("Đang mở PDF trên máy của bạn…");
    const ready = await workerRequest(worker, { type: "open", file }, signal);
    let offset = existing?.receivedPages ?? 0;
    while (offset < ready.pageCount) {
      if (signal?.aborted)
        throw new Error("Đã dừng đọc PDF. Chọn lại file để tiếp tục.");
      onProgress(
        `Đang đọc PDF: ${offset}/${ready.pageCount} trang · ${file.name}`,
      );
      const chunk = await workerRequest(
        worker,
        { type: "pages", offset },
        signal,
      );
      const result = await requestJob("jobs/" + cached.id + "/pdf-pages", {
        offset,
        totalPages: ready.pageCount,
        pages: chunk.pages,
      });
      offset = result.receivedPages;
    }
    onProgress(
      `Đã đọc ${ready.pageCount}/${ready.pageCount} trang · đang kiểm tra bản gốc và đối chiếu…`,
    );
    return await requestJob("jobs/" + cached.id + "/pdf-preview", {});
  } finally {
    worker.terminate();
  }
}
