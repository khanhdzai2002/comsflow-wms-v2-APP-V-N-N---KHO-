import { createClient } from "@supabase/supabase-js";
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
  const response = await fetch("/api/" + path, {
    method: body === undefined ? "GET" : "POST",
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: "no-store",
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Chưa xử lý được tác vụ");
  return data;
}
export async function waitJob(id: string) {
  const end = Date.now() + 9 * 60 * 1000;
  while (Date.now() < end) {
    const job = await requestJob("jobs/" + id);
    if (job.status === "succeeded") return { ...job.result, _jobId: id };
    if (job.status === "failed" || job.status === "cancelled")
      throw new Error(job.error || "Tác vụ đã dừng");
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }
  throw new Error(
    "Tác vụ vẫn được lưu trong hệ thống. Mở “Tác vụ dữ liệu” để theo dõi; chưa xác nhận lưu thành công.",
  );
}
export async function fileJob(route: string, form: FormData) {
  const file = form.get("file");
  if (!(file instanceof File)) throw new Error("Chọn file để tiếp tục");
  const hash = Array.from(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", await file.arrayBuffer()),
    ),
  )
    .map((x) => x.toString(16).padStart(2, "0"))
    .join("");
  const payload = {
    context: JSON.parse(String(form.get("context") || "{}")),
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
    await requestJob("jobs/" + cached.id + "/commit", {});
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
    return await waitJob(cached.id!);
  } catch (error) {
    const job = await requestJob("jobs/" + cached.id).catch(() => null);
    if (job?.status === "failed" || job?.status === "cancelled")
      localStorage.removeItem(key);
    throw error;
  }
}
