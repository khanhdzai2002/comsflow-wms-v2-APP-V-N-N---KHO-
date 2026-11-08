import { createClient } from "@supabase/supabase-js";
import { post } from "./shared";
export async function uploadReturnMedia(
  file: File,
  target: { caseId?: string; sessionId?: string },
) {
  if (file.size > 50 * 1024 * 1024)
    throw new Error("Ảnh/PDF/video tối đa 50 MB mỗi tệp");
  const mime =
    file.type ||
    (
      {
        jpg: "image/jpeg",
        jpeg: "image/jpeg",
        png: "image/png",
        webp: "image/webp",
        pdf: "application/pdf",
        mp4: "video/mp4",
        webm: "video/webm",
      } as Record<string, string>
    )[file.name.split(".").at(-1)?.toLowerCase() ?? ""];
  if (!mime) throw new Error("Chọn ảnh JPEG/PNG/WebP, PDF hoặc video MP4/WebM");
  const sha256 = Array.from(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", await file.arrayBuffer()),
    ),
    (b) => b.toString(16).padStart(2, "0"),
  ).join("");
  const upload = await post("returns/operations/media", {
    ...target,
    filename: file.name,
    size: file.size,
    mime,
    sha256,
  });
  const client = createClient(upload.url, upload.key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
  const result = await client.storage
    .from(upload.bucket)
    .uploadToSignedUrl(upload.path, upload.token, file, { contentType: mime });
  if (result.error)
    throw new Error("Tải bằng chứng chưa hoàn tất. Kiểm tra mạng và thử lại");
  return post("returns/operations/media/" + upload.id + "/finalize", {});
}
