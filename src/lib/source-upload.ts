import Busboy from "busboy";
import { Readable, Transform } from "node:stream";
import type { ReadableStream as NodeReadableStream } from "node:stream/web";
import { pipeline } from "node:stream/promises";
import { AppError } from "./domain";
import {
  MAX_SOURCE_PDF_BYTES,
  MAX_SOURCE_PDF_MB,
  MAX_SOURCE_REQUEST_BYTES,
} from "./source-limits";

const processState = globalThis as typeof globalThis & {
  comsflowSourceUploadBusy?: boolean;
};

export async function withSourceUpload<T>(
  operation: () => Promise<T>,
): Promise<T> {
  if (processState.comsflowSourceUploadBusy)
    throw new AppError(
      503,
      "Máy chủ đang xử lý một file PDF khác. Vui lòng chờ hoàn tất rồi đọc/lưu lại file này.",
    );
  processState.comsflowSourceUploadBusy = true;
  try {
    return await operation();
  } finally {
    processState.comsflowSourceUploadBusy = false;
  }
}

export async function readSourceUpload(req: Request) {
  if (!req.body) throw new AppError(400, "Chưa có file PDF tải lên");
  if (Number(req.headers.get("content-length")) > MAX_SOURCE_REQUEST_BYTES)
    throw new AppError(413, `File PDF tối đa ${MAX_SOURCE_PDF_MB} MB`);
  let parser: ReturnType<typeof Busboy>;
  try {
    parser = Busboy({
      headers: { "content-type": req.headers.get("content-type") ?? "" },
      defParamCharset: "utf8",
      limits: {
        // Busboy emits "limit" when the threshold is reached, including an
        // exact match. Allow the documented 50 MB boundary, reject byte + 1.
        fileSize: MAX_SOURCE_PDF_BYTES + 1,
        files: 1,
        fields: 1,
        fieldSize: 16 * 1024,
        parts: 3,
      },
    });
  } catch {
    throw new AppError(400, "Yêu cầu tải PDF không đúng định dạng multipart");
  }
  let filename = "",
    contextText = "{}",
    total = 0,
    fileSize = 0,
    files = 0;
  const chunks: Buffer[] = [];
  let uploadError: AppError | undefined;
  const fail = (error: AppError) => {
    if (uploadError) return;
    uploadError = error;
    chunks.length = 0;
    // Destroy outside Busboy's synchronous parsing callbacks, which may still
    // be updating the current file stream when a limit/event is emitted.
    queueMicrotask(() => parser.destroy(error));
  };
  parser.on("file", (field, stream, info) => {
    // Busboy destroys its child streams on a parser error; consume their error
    // events as well so malformed uploads cannot become uncaught exceptions.
    stream.on("error", () => {});
    if (
      field !== "file" ||
      ++files !== 1 ||
      !info.filename?.toLowerCase().endsWith(".pdf")
    ) {
      fail(new AppError(400, "Chọn đúng một file PDF"));
      return;
    }
    filename = info.filename;
    stream.on("limit", () =>
      fail(new AppError(413, `File PDF tối đa ${MAX_SOURCE_PDF_MB} MB`)),
    );
    stream.on("data", (chunk: Buffer) => {
      if (uploadError) return;
      fileSize += chunk.length;
      chunks.push(chunk);
    });
  });
  parser.on("field", (name, value, info) => {
    if (name !== "context" || info.nameTruncated || info.valueTruncated) {
      fail(new AppError(400, "Thông tin nguồn PDF không hợp lệ hoặc quá lớn"));
      return;
    }
    contextText = value;
  });
  for (const event of ["filesLimit", "fieldsLimit", "partsLimit"] as const)
    parser.on(event, () =>
      fail(
        new AppError(
          400,
          "Chọn đúng một PDF và một bộ thông tin nguồn cho mỗi yêu cầu",
        ),
      ),
    );
  const limiter = new Transform({
    transform(chunk: Buffer, _encoding, done) {
      total += chunk.length;
      done(
        total > MAX_SOURCE_REQUEST_BYTES
          ? new AppError(413, `File PDF tối đa ${MAX_SOURCE_PDF_MB} MB`)
          : null,
        chunk,
      );
    },
  });
  try {
    await pipeline(
      Readable.fromWeb(req.body as NodeReadableStream<Uint8Array>),
      limiter,
      parser,
      { signal: req.signal },
    );
    if (uploadError) throw uploadError;
    if (!files || !fileSize)
      throw new AppError(400, "Chưa có file PDF tải lên");
    const context: unknown = JSON.parse(contextText);
    // One bounded file buffer, without materializing another Request/FormData,
    // File, and ArrayBuffer copy of the complete multipart request.
    return { filename, buffer: Buffer.concat(chunks, fileSize), context };
  } catch (error) {
    if (uploadError) throw uploadError;
    if (error instanceof AppError) throw error;
    throw new AppError(
      400,
      "File tải lên bị gián đoạn hoặc thông tin nguồn PDF không hợp lệ",
    );
  } finally {
    chunks.length = 0;
  }
}
