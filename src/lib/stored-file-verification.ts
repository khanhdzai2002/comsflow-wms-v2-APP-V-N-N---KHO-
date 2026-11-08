import { createHash } from "node:crypto";
import { AppError } from "./domain";
import { storage } from "./supabase";
import { MAX_SOURCE_PDF_BYTES } from "./source-limits";

type FileJob = {
  storage_path: string;
  file_size: number | string;
  sha256: string;
};
export async function verifyStoredPdf(job: FileJob) {
  return verifyStoredFile(job, "pdf", MAX_SOURCE_PDF_BYTES);
}
export async function verifyStoredFile(
  job: FileJob,
  kind: "pdf" | "xlsx" | "csv",
  maxBytes = 10 * 1024 * 1024,
) {
  const size = Number(job.file_size);
  if (!size || size > maxBytes)
    throw new AppError(413, `Tệp tối đa ${maxBytes / 1024 / 1024} MB.`);
  const info = await storage().info(job.storage_path);
  if (info.error || info.data.size !== size)
    throw new AppError(409, "Tệp gốc chưa tải đủ hoặc kích thước không khớp.");
  type DigestStream = WritableStream<Uint8Array> & {
    digest: Promise<ArrayBuffer>;
  };
  const NativeDigestStream = (
    globalThis.crypto as Crypto & {
      DigestStream?: new (algorithm: string) => DigestStream;
    }
  ).DigestStream;
  let hash: string;
  if (NativeDigestStream) {
    const signed = await storage().createSignedUrl(job.storage_path, 120);
    if (signed.error)
      throw new AppError(503, "Chưa đọc được tệp gốc từ Storage. Thử lại.");
    const response = await fetch(signed.data.signedUrl, {
      signal: AbortSignal.timeout(90000),
    });
    if (!response.ok || !response.body)
      throw new AppError(503, "Chưa tải được tệp gốc để kiểm tra.");
    const digest = new NativeDigestStream("SHA-256");
    const digestResult = digest.digest;
    // A failed pipe may reject both promises; observe the digest as well.
    void digestResult.catch(() => {});
    let total = 0,
      prefix = "";
    await response.body
      .pipeThrough(
        new TransformStream<Uint8Array, Uint8Array>({
          transform(bytes, controller) {
            if (prefix.length < 5)
              prefix += new TextDecoder().decode(
                bytes.subarray(0, 5 - prefix.length),
              );
            total += bytes.byteLength;
            if (total > size || total > maxBytes)
              throw new AppError(400, "Kích thước tệp gốc không khớp.");
            controller.enqueue(bytes);
          },
        }),
      )
      .pipeTo(digest);
    hash = Array.from(new Uint8Array(await digestResult), (b) =>
      b.toString(16).padStart(2, "0"),
    ).join("");
    if (
      total !== size ||
      (kind === "pdf" && prefix !== "%PDF-") ||
      (kind === "xlsx" && !prefix.startsWith("PK"))
    )
      throw new AppError(400, "Tệp gốc không đúng định dạng hoặc kích thước.");
  } else {
    // Node test/processor runtime; Cloudflare uses its native streaming digest above.
    const result = await storage().download(job.storage_path);
    if (result.error || !result.data)
      throw new AppError(503, "Chưa đọc được tệp gốc từ Storage.");
    if (result.data.size !== size)
      throw new AppError(400, "Kích thước tệp gốc không khớp.");
    const bytes = Buffer.from(await result.data.arrayBuffer());
    if (
      (kind === "pdf" && bytes.subarray(0, 5).toString() !== "%PDF-") ||
      (kind === "xlsx" && bytes.subarray(0, 2).toString() !== "PK")
    )
      throw new AppError(400, "Tệp gốc không đúng định dạng đã chọn.");
    hash = createHash("sha256").update(bytes).digest("hex");
  }
  if (hash !== job.sha256)
    throw new AppError(
      400,
      "Tệp gốc không khớp SHA-256. Chọn lại tệp; chưa nhập dữ liệu.",
    );
  return hash;
}
