import { db, type User } from "./db";
import { AppError, managerRoles, requireRole } from "./domain";
import { ownedJob } from "./jobs";
import { storage } from "./supabase";
import { parseTikTokReturnCsv } from "./return-csv-parse";
import { RETURN_CSV_MAX_BYTES } from "./return-csv-format";
import { previewReturns, commitReturns } from "./returns";
import { recordReturnUpload } from "./return-settings";
import { environment, requestContext } from "../server/context";

export async function processReturnCsv(
  user: User,
  id: string,
  commit: boolean,
) {
  requireRole(user, managerRoles);
  const initial = await ownedJob(user, id);
  function check(job: typeof initial) {
    if (
      !/^returns\/csv\/(preview|commit)$/.test(job.route) ||
      !/\.csv$/i.test(job.filename)
    )
      throw new AppError(400, "Tác vụ không phải CSV đơn hoàn TikTok.");
    if (new Date(job.expires_at).getTime() <= Date.now())
      throw new AppError(410, "File đã hết hạn. Chọn lại file gốc.");
    if (["cancelled", "failed"].includes(job.status))
      throw new AppError(409, "Tác vụ đã dừng. Chọn lại file gốc để kiểm tra.");
    if (
      commit &&
      (job.status !== "succeeded" ||
        (job.route.endsWith("/preview") && !job.result?.canCommit))
    )
      throw new AppError(
        409,
        "Cần đọc và đối chiếu file không còn lỗi trước khi lưu.",
      );
  }
  check(initial);
  if (commit && initial.route.endsWith("/commit"))
    return { ...initial.result, _jobId: id, _csvDirect: true };
  if (initial.file_size <= 0 || initial.file_size > RETURN_CSV_MAX_BYTES)
    throw new AppError(413, "CSV nhập trực tiếp tối đa 1 MB / 2.000 dòng.");
  // Read the original object, never accept normalized rows or fingerprints from the browser.
  const info = await storage().info(initial.storage_path);
  if (info.error || info.data.size !== Number(initial.file_size))
    throw new AppError(
      409,
      "File chưa tải đủ hoặc kích thước không khớp. Chọn lại file.",
    );
  const download = await storage().download(initial.storage_path);
  if (download.error || !download.data)
    throw new AppError(503, "Chưa đọc được file gốc từ Storage. Thử lại.");
  if (download.data.size !== Number(initial.file_size))
    throw new AppError(400, "Kích thước file gốc không khớp.");
  let file;
  try {
    file = parseTikTokReturnCsv(
      Buffer.from(await download.data.arrayBuffer()),
      initial.payload.context?.channel ?? "",
      initial.payload.mapping ?? {},
    );
    if (file.hash !== initial.sha256)
      throw new AppError(
        400,
        "File gốc không khớp SHA-256. Chọn lại file; chưa nhập dữ liệu.",
      );
  } catch (error) {
    if (!commit && error instanceof AppError) {
      await db()`UPDATE data_jobs SET status='failed',error=${error.message.slice(0, 800)},updated_at=now() WHERE id=${id} AND created_by=${user.id} AND route='returns/csv/preview' AND status IN ('waiting_upload','queued')`;
      await recordReturnUpload(
        user,
        initial.filename,
        initial.payload.context ?? {},
        { errors: 1 },
        [error.message],
      );
    }
    throw error;
  }
  const parent = requestContext.getStore();
  return db().begin(async (tx) => {
    const [job] =
      await tx`SELECT * FROM data_jobs WHERE id=${id} AND created_by=${user.id} FOR UPDATE`;
    if (!job) throw new AppError(404, "Không tìm thấy tác vụ");
    check(job);
    if (job.route.endsWith("/commit")) {
      if (!commit)
        throw new AppError(
          409,
          "File đã được xác nhận nhập. Chọn lại file nếu cần đối chiếu mới.",
        );
      return { ...job.result, _jobId: id, _csvDirect: true };
    }
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
        const context = {
          ...job.payload.context,
          previewFingerprint: commit
            ? job.result.previewFingerprint
            : undefined,
        };
        const result = commit
          ? await commitReturns(user, file, job.filename, context)
          : await previewReturns(user, file, context);
        if (!commit) {
          const preview = result as Awaited<ReturnType<typeof previewReturns>>;
          await recordReturnUpload(
            user,
            job.filename,
            { ...context, channel: file.channel },
            preview.updateSummary,
            [
              ...file.errors.map((e) => e.message),
              ...preview.conflicts.map((e) => e.message),
            ],
          );
        }
        await tx`UPDATE data_jobs SET status='succeeded',route=${commit ? "returns/csv/commit" : "returns/csv/preview"},result=${tx.json(result)},error=NULL,updated_at=now() WHERE id=${id}`;
        return { ...result, _jobId: id, _csvDirect: true };
      },
    );
  });
}
