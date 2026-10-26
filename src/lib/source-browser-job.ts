import { z } from "zod";
import { createHash } from "node:crypto";
import { db, audit, type User } from "./db";
import { AppError, requireRole, managerRoles } from "./domain";
import { ownedJob } from "./jobs";
import {
  sourceLabelAnalyzer,
  type SourceAnalyzerState,
  type SourcePdf,
} from "./pdf-labels";
import { previewSource, commitSource } from "./source-manifests";
import { verifyStoredPdf } from "./stored-file-verification";
import { environment, requestContext } from "../server/context";
import {
  SOURCE_ANALYZER_VERSION,
  MAX_SOURCE_PDF_PAGES,
  MAX_SOURCE_PDF_TEXT,
  SOURCE_PAGE_BATCH,
  SOURCE_PAGE_TEXT_LIMIT,
} from "./source-limits";

function check(job: any) {
  if (!job) throw new AppError(404, "Không tìm thấy tác vụ PDF.");
  if (
    !job ||
    !/^sources\/browser\/(preview|commit)$/.test(job.route) ||
    !/\.pdf$/i.test(job.filename)
  )
    throw new AppError(400, "Tác vụ không phải PDF xuất kho đọc trực tiếp.");
  if (new Date(job.expires_at).getTime() <= Date.now())
    throw new AppError(410, "PDF đã hết hạn. Chọn lại file gốc.");
  if (["cancelled", "failed"].includes(job.status))
    throw new AppError(409, "Tác vụ đã dừng. Chọn lại PDF gốc.");
}
type Progress = {
  analyzerVersion?: string;
  totalPages: number;
  characters: number;
  chunks: Record<string, string>;
  state: SourceAnalyzerState;
  parsed?: SourcePdf;
};
function checkAnalyzer(progress?: Progress) {
  if (progress && progress.analyzerVersion !== SOURCE_ANALYZER_VERSION)
    throw new AppError(
      409,
      "Bộ đọc PDF đã được cập nhật. Tải lại trang và chọn lại file gốc để đọc bằng bản mới; kết quả cũ chưa được lưu vào vận đơn.",
    );
}
export async function appendSourcePages(user: User, id: string, raw: unknown) {
  requireRole(user, managerRoles);
  const input = z
    .object({
      offset: z.number().int().min(0).max(MAX_SOURCE_PDF_PAGES),
      totalPages: z.number().int().min(1).max(MAX_SOURCE_PDF_PAGES),
      pages: z
        .array(z.string().max(SOURCE_PAGE_TEXT_LIMIT))
        .min(1)
        .max(SOURCE_PAGE_BATCH),
    })
    .parse(raw);
  const fingerprint = createHash("sha256")
    .update(JSON.stringify(input))
    .digest("hex");
  return db().begin(async (tx) => {
    const [job] =
      await tx`SELECT * FROM data_jobs WHERE id=${z.uuid().parse(id)} AND created_by=${user.id} FOR UPDATE`;
    check(job);
    if (job.route.endsWith("/commit") || job.status === "waiting_upload")
      throw new AppError(
        409,
        "Cần tải xong PDF và chưa xác nhận nhập trước khi gửi nội dung trang.",
      );
    const progress = job.payload.browserPdf as Progress | undefined;
    checkAnalyzer(progress);
    const offset = progress?.state.pageCount ?? 0;
    if (progress && progress.totalPages !== input.totalPages)
      throw new AppError(
        409,
        "Số trang PDF không khớp lần đọc trước. Chọn lại file gốc.",
      );
    if (
      input.offset < offset &&
      progress?.chunks[String(input.offset)] === fingerprint
    )
      return { receivedPages: offset, totalPages: input.totalPages };
    if (
      input.offset !== offset ||
      input.offset + input.pages.length > input.totalPages
    )
      throw new AppError(
        409,
        "Nội dung PDF bị thiếu, lặp hoặc gửi sai thứ tự. Đọc lại file để tiếp tục đúng trang.",
      );
    const characters =
      (progress?.characters ?? 0) +
      input.pages.reduce((n, p) => n + p.length, 0);
    if (characters > MAX_SOURCE_PDF_TEXT)
      throw new AppError(413, "Nội dung PDF quá lớn. Hãy tách file gốc.");
    // Page text is untrusted browser input. All label identities, counts and errors
    // are derived again here; the client never supplies business-ready labels.
    const analyzer = sourceLabelAnalyzer(job.sha256, progress?.state);
    input.pages.forEach(analyzer.addPage);
    const parsed =
      offset + input.pages.length === input.totalPages
        ? analyzer.finish()
        : undefined;
    const next: Progress = {
      analyzerVersion: SOURCE_ANALYZER_VERSION,
      totalPages: input.totalPages,
      characters,
      chunks: { ...progress?.chunks, [String(input.offset)]: fingerprint },
      state: analyzer.snapshot(),
      ...(parsed ? { parsed } : {}),
    };
    await tx`UPDATE data_jobs SET payload=${tx.json({ ...job.payload, browserPdf: next })},updated_at=now() WHERE id=${id}`;
    return { receivedPages: next.state.pageCount, totalPages: next.totalPages };
  });
}

export async function processSourceBrowser(
  user: User,
  id: string,
  commit: boolean,
) {
  requireRole(user, managerRoles);
  const initial = await ownedJob(user, id);
  check(initial);
  if (commit && initial.route.endsWith("/commit"))
    return { ...initial.result, _jobId: id };
  const progress = initial.payload.browserPdf as Progress | undefined;
  checkAnalyzer(progress);
  if (!progress?.parsed || progress.state.pageCount !== progress.totalPages)
    throw new AppError(
      409,
      "Chưa đọc đủ mọi trang PDF. Chọn lại file để tiếp tục.",
    );
  if (commit && initial.status !== "succeeded")
    throw new AppError(
      409,
      "Cần xem trước và đối chiếu PDF trước khi xác nhận nhập.",
    );
  await verifyStoredPdf({
    storage_path: initial.storage_path,
    file_size: initial.file_size,
    sha256: initial.sha256,
  });
  const parent = requestContext.getStore();
  return db().begin(async (tx) => {
    const [job] =
      await tx`SELECT * FROM data_jobs WHERE id=${id} AND created_by=${user.id} FOR UPDATE`;
    check(job);
    if (job.route.endsWith("/commit")) {
      if (!commit)
        throw new AppError(
          409,
          "PDF đã được xác nhận nhập. Chọn lại để đối chiếu mới.",
        );
      return { ...job.result, _jobId: id };
    }
    if (commit && job.status !== "succeeded")
      throw new AppError(409, "Cần xem trước PDF trước khi lưu.");
    const parsed = job.payload.browserPdf.parsed as SourcePdf;
    const bound = new Proxy(tx, {
      get(target, key) {
        if (key === "begin")
          return (first: any, second?: any) =>
            target.savepoint(typeof first === "function" ? first : second);
        return Reflect.get(target, key);
      },
    });
    return requestContext.run(
      {
        ...parent,
        env: environment(),
        sql: bound as any,
        cookies: parent?.cookies ?? [],
        pending: parent?.pending ?? [],
      },
      async () => {
        const result = commit
          ? await commitSource(user, job.filename, parsed, job.payload.context)
          : await previewSource(user, parsed, job.payload.context);
        if (commit && "id" in result)
          await audit(
            tx,
            user,
            "source_browser_extract",
            result.id,
            null,
            {
              hash: parsed.hash,
              pages: parsed.pageCount,
              labels: parsed.labels.length,
            },
            "PDF do trình duyệt trích text; máy chủ kiểm tra từng nhóm trang, đối chiếu bản gốc SHA-256 và lưu nguồn trong cùng giao dịch",
          );
        await tx`UPDATE data_jobs SET route=${commit ? "sources/browser/commit" : "sources/browser/preview"},status='succeeded',result=${tx.json(result)},error=NULL,updated_at=now() WHERE id=${id}`;
        return { ...result, _jobId: id };
      },
    );
  });
}
