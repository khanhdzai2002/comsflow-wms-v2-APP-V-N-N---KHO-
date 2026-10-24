import { createClient } from "@supabase/supabase-js";
import { RETURN_CSV_MAX_BYTES } from "@/lib/return-csv-format";
function canonical(value: any): string {
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  if (value && typeof value === "object")
    return (
      "{" +
      Object.keys(value)
        .sort()
        .map((k) => JSON.stringify(k) + ":" + canonical(value[k]))
        .join(",") +
      "}"
    );
  return JSON.stringify(value);
}
export async function requestJob(path: string, body?: unknown) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);
  try {
    let response: Response;
    try {
      response = await fetch("/api/" + path, {
        method: body === undefined ? "GET" : "POST",
        headers: { "Content-Type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
        cache: "no-store",
        signal: controller.signal,
      });
    } catch {
      throw new Error(
        "Chưa nhận được xác nhận từ máy chủ. Kiểm tra mạng và mở “Tác vụ dữ liệu” để đối chiếu trước khi thử lại.",
      );
    }
    let data;
    try {
      data = await response.json();
    } catch {
      throw new Error(
        "Máy chủ chưa trả kết quả hợp lệ. Mở “Tác vụ dữ liệu” để kiểm tra; chưa xác nhận thao tác thành công.",
      );
    }
    if (!response.ok) throw new Error(data.error || "Chưa xử lý được tác vụ");
    return data;
  } finally {
    clearTimeout(timeout);
  }
}
export async function waitJob(id: string) {
  const end = Date.now() + 9 * 60 * 1000;
  while (Date.now() < end) {
    const job = await requestJob("jobs/" + id);
    if (job.status === "succeeded") return { ...job.result, _jobId: id };
    if (job.status === "failed" || job.status === "cancelled")
      throw new Error(job.error || "Tác vụ đã dừng");
    if (job.status === "queued" && job.workerAvailable === false)
      throw new Error(
        "File đã được lưu nhưng dịch vụ xử lý file chưa hoạt động. Mở “Tác vụ dữ liệu” để xem trạng thái; cần kết nối dịch vụ xử lý trước khi đọc Excel hoặc xuất báo cáo. PDF xuất kho và CSV TikTok có luồng nhập trực tiếp.",
      );
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }
  throw new Error(
    "Tác vụ vẫn được lưu trong hệ thống. Mở “Tác vụ dữ liệu” để theo dõi; chưa xác nhận lưu thành công.",
  );
}
export async function fileJob(route: string, form: FormData) {
  if (/^sources\/(preview|commit)$/.test(route)) {
    const { browserSourcePdfJob } = await import("./source-pdf-client");
    return browserSourcePdfJob(route, form);
  }
  const file = form.get("file");
  if (!(file instanceof File)) throw new Error("Chọn file để tiếp tục");
  const sourceContext = JSON.parse(String(form.get("context") || "{}"));
  const directCsv =
    /\.csv$/i.test(file.name) &&
    /^returns\/import\/(preview|commit)$/.test(route) &&
    sourceContext.channel !== "Shopee";
  if (directCsv) {
    if (file.size > RETURN_CSV_MAX_BYTES)
      throw new Error(
        "CSV TikTok nhập trực tiếp tối đa 1 MB / 2.000 dòng. Chia nhỏ file lớn trước khi nhập.",
      );
    route = route.replace("returns/import/", "returns/csv/");
  }
  const hash = Array.from(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", await file.arrayBuffer()),
    ),
  )
    .map((x) => x.toString(16).padStart(2, "0"))
    .join("");
  const payload = {
    context: sourceContext,
    mapping: JSON.parse(String(form.get("mapping") || "{}")),
  };
  delete payload.context.previewFingerprint;
  const key =
    "comsflow-job:" +
    canonical({
      hash,
      route: route.replace(/\/(preview|commit)$/, "/preview"),
      payload,
    });
  let cached: { id?: string; requestKey: string };
  try {
    cached = JSON.parse(localStorage.getItem(key) || "null") || {
      requestKey: crypto.randomUUID(),
    };
  } catch {
    cached = { requestKey: crypto.randomUUID() };
  }
  localStorage.setItem(key, JSON.stringify(cached));
  if (route.endsWith("/commit")) {
    if (!cached.id)
      throw new Error("Hãy đọc và xem trước file trước khi xác nhận lưu");
    const result = await requestJob("jobs/" + cached.id + "/commit", {});
    if (directCsv) return result;
    return waitJob(cached.id);
  }
  if (cached.id) {
    const existing = await requestJob("jobs/" + cached.id).catch(() => null);
    if (
      !existing ||
      existing.route.endsWith("/commit") ||
      ["failed", "cancelled"].includes(existing.status)
    )
      cached = { requestKey: crypto.randomUUID() };
  }
  if (!cached.id) {
    const upload = await requestJob("jobs/uploads", {
      route,
      filename: file.name,
      size: file.size,
      sha256: hash,
      payload,
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
          contentType: /\.pdf$/i.test(file.name)
            ? "application/pdf"
            : /\.csv$/i.test(file.name)
              ? "text/csv"
              : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        });
      if (result.error) {
        // A lost upload reply can leave a complete object. Finalize verifies size,
        // and the worker independently verifies its SHA-256 before processing.
        try {
          await requestJob("jobs/" + upload.id + "/finalize", {});
        } catch {
          throw new Error(
            "Chưa tải được file lên Storage. Kiểm tra mạng và thử lại.",
          );
        }
      }
    }
    localStorage.setItem(key, JSON.stringify(cached));
  }
  await requestJob("jobs/" + cached.id + "/finalize", {});
  try {
    if (directCsv)
      return await requestJob("jobs/" + cached.id + "/csv-preview", {});
    return await waitJob(cached.id!);
  } catch (error) {
    const job = await requestJob("jobs/" + cached.id).catch(() => null);
    if (job?.status === "failed" || job?.status === "cancelled")
      localStorage.removeItem(key);
    throw error;
  }
}

export function downloadCsvErrors(
  errors: { row: number; message: string; raw: Record<string, string> }[],
) {
  const headers = [...new Set(errors.flatMap((e) => Object.keys(e.raw)))];
  const cell = (value: unknown) => {
    let text = String(value ?? "");
    if (/^[\s\u0000-\u001f]*[=+@-]/.test(text)) text = "'" + text;
    return '"' + text.replaceAll('"', '""') + '"';
  };
  const rows = [
    ["Dòng", "Lỗi", ...headers],
    ...errors.map((e) => [
      String(e.row),
      e.message,
      ...headers.map((h) => e.raw[h] ?? ""),
    ]),
  ];
  const url = URL.createObjectURL(
    new Blob(["\uFEFF" + rows.map((r) => r.map(cell).join(",")).join("\r\n")], {
      type: "text/csv;charset=utf-8",
    }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = "loi-don-hoan-tiktok.csv";
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
