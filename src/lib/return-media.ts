import { z } from "zod";
import { db, type User } from "./db";
import { storage } from "./supabase";
import { AppError } from "./domain";
import {
  requireReturnCaseAccess,
  requireReturnOperations,
} from "./return-operations-access";
import { verifyStoredFile } from "./stored-file-verification";
const mediaSchema = z
  .object({
    caseId: z.uuid().optional(),
    sessionId: z.uuid().optional(),
    filename: z.string().min(1).max(240),
    size: z
      .number()
      .int()
      .min(1)
      .max(50 * 1024 * 1024),
    mime: z.enum([
      "image/jpeg",
      "image/png",
      "image/webp",
      "application/pdf",
      "video/mp4",
      "video/webm",
    ]),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .refine(
    (d) => !!d.caseId !== !!d.sessionId,
    "Chọn một hồ sơ hoặc một phiên bàn giao",
  );
async function mediaAccess(
  user: User,
  row: { case_id?: string | null; session_id?: string | null },
) {
  if (row.case_id) return requireReturnCaseAccess(user, row.case_id);
  const [session] =
    await db()`SELECT id FROM return_handover_sessions WHERE id=${row.session_id ?? null} AND (${user.role !== "staff"} OR created_by=${user.id})`;
  if (!session)
    throw new AppError(403, "Không có quyền truy cập bằng chứng phiên này");
}
export async function beginReturnMedia(user: User, raw: unknown) {
  await requireReturnOperations();
  const d = mediaSchema.parse(raw);
  await mediaAccess(user, { case_id: d.caseId, session_id: d.sessionId });
  const id = crypto.randomUUID(),
    path = `return-evidence/${user.id}/${id}`;
  const signed = await storage().createSignedUploadUrl(path);
  if (signed.error)
    throw new AppError(503, "Chưa mở được đường tải bằng chứng bảo mật");
  await db()`INSERT INTO return_media(id,case_id,session_id,storage_path,filename,mime,file_size,sha256,created_by) VALUES(${id},${d.caseId ?? null},${d.sessionId ?? null},${path},${d.filename},${d.mime},${d.size},${d.sha256},${user.id})`;
  const { environment } = await import("../server/context");
  const env = environment();
  return {
    id,
    path,
    token: signed.data.token,
    url: env.SUPABASE_URL,
    key: env.SUPABASE_ANON_KEY,
    bucket: env.STORAGE_BUCKET || "comsflow-private",
  };
}
async function prefix(path: string) {
  if ((globalThis.crypto as any).DigestStream) {
    const signed = await storage().createSignedUrl(path, 60);
    if (signed.error) throw new AppError(503, "Chưa kiểm tra được bằng chứng");
    const response = await fetch(signed.data.signedUrl, {
      headers: { Range: "bytes=0-31" },
      signal: AbortSignal.timeout(30000),
    });
    if (!response.ok || !response.body)
      throw new AppError(503, "Chưa đọc được bằng chứng");
    const reader = response.body.getReader(),
      chunks: Uint8Array[] = [];
    let length = 0;
    try {
      while (length < 32) {
        const next = await reader.read();
        if (next.done) break;
        const b = next.value.subarray(0, 32 - length);
        chunks.push(b);
        length += b.length;
      }
    } finally {
      await reader.cancel();
    }
    const bytes = new Uint8Array(length);
    let at = 0;
    for (const b of chunks) {
      bytes.set(b, at);
      at += b.length;
    }
    return bytes;
  }
  const object = await storage().download(path);
  if (object.error || !object.data)
    throw new AppError(503, "Chưa đọc được bằng chứng");
  return new Uint8Array(await object.data.slice(0, 32).arrayBuffer());
}
function validMedia(mime: string, b: Uint8Array) {
  const text = new TextDecoder().decode(b);
  return mime === "image/jpeg"
    ? b[0] === 255 && b[1] === 216 && b[2] === 255
    : mime === "image/png"
      ? [137, 80, 78, 71, 13, 10, 26, 10].every((x, i) => b[i] === x)
      : mime === "image/webp"
        ? text.startsWith("RIFF") && text.slice(8, 12) === "WEBP"
        : mime === "application/pdf"
          ? text.startsWith("%PDF-")
          : mime === "video/mp4"
            ? text.slice(4, 8) === "ftyp"
            : mime === "video/webm"
              ? [0x1a, 0x45, 0xdf, 0xa3].every((x, i) => b[i] === x)
              : false;
}
export async function finishReturnMedia(user: User, id: string) {
  z.uuid().parse(id);
  const [m] =
    await db()`SELECT * FROM return_media WHERE id=${id} AND created_by=${user.id}`;
  if (!m) throw new AppError(404, "Không có tệp bằng chứng");
  await mediaAccess(user, m);
  if (m.state === "ready") return { id, reused: true };
  await verifyStoredFile(
    { storage_path: m.storage_path, file_size: m.file_size, sha256: m.sha256 },
    "csv",
    50 * 1024 * 1024,
  );
  if (!validMedia(m.mime, await prefix(m.storage_path)))
    throw new AppError(400, "Nội dung tệp không khớp ảnh/PDF/video đã chọn");
  return db().begin(async (tx) => {
    const [current] =
      await tx`SELECT * FROM return_media WHERE id=${id} FOR UPDATE`;
    if (current.state === "ready") return { id, reused: true };
    await tx`UPDATE return_media SET state='ready' WHERE id=${id}`;
    if (m.case_id)
      await tx`INSERT INTO return_events(case_id,actor_id,action,data) VALUES(${m.case_id},${user.id},'evidence',${tx.json({ mediaId: id, filename: m.filename, mime: m.mime })})`;
    else
      await tx`INSERT INTO return_receipt_events(actor_id,action,data) VALUES(${user.id},'session_evidence',${tx.json({ mediaId: id, sessionId: m.session_id, filename: m.filename })})`;
    return { id };
  });
}
export async function downloadReturnMedia(user: User, id: string) {
  z.uuid().parse(id);
  const [m] =
    await db()`SELECT * FROM return_media WHERE id=${id} AND state='ready'`;
  if (!m)
    throw new AppError(404, "Bằng chứng chưa được xác nhận hoặc không tồn tại");
  await mediaAccess(user, m);
  const signed = await storage().createSignedUrl(m.storage_path, 60, {
    download: m.filename,
  });
  if (signed.error) throw new AppError(503, "Chưa tải được bằng chứng");
  return signed.data.signedUrl;
}
