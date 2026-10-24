import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { db, type User } from "./db";
import { AppError, requireRole, managerRoles } from "./domain";
import { storage } from "./supabase";
import { environment } from "../server/context";
import { RETURN_CSV_ROUTE, RETURN_CSV_MAX_BYTES } from "./return-csv-format";
export const fileRoutes = [
  "sources/preview",
  "sources/commit",
  "imports/preview",
  "imports/commit",
  "returns/import/preview",
  "returns/import/commit",
  "returns/import/errors",
  "returns/sales/preview",
  "returns/sales/commit",
  RETURN_CSV_ROUTE,
  "sources/browser/preview",
];
export function reportRoute(path: string, params: URLSearchParams) {
  return (
    path === "export" ||
    path === "returns/export" ||
    path === "returns/sales/template" ||
    (/^sources\/[a-f0-9-]{36}$/.test(path) && params.has("format")) ||
    /^maintenance\/export\/[a-f0-9-]{36}$/.test(path)
  );
}
export function stable(value: any): string {
  if (Array.isArray(value)) return "[" + value.map(stable).join(",") + "]";
  if (value && typeof value === "object")
    return (
      "{" +
      Object.keys(value)
        .sort()
        .map((k) => JSON.stringify(k) + ":" + stable(value[k]))
        .join(",") +
      "}"
    );
  return JSON.stringify(value);
}
export function digest(value: string) {
  return createHash("sha256").update(value).digest("hex");
}
export async function createUpload(user: User, raw: unknown) {
  requireRole(user, managerRoles);
  const data = z
    .object({
      route: z.enum(fileRoutes as [string, ...string[]]),
      filename: z.string().min(1).max(240),
      size: z
        .number()
        .int()
        .positive()
        .max(50 * 1024 * 1024),
      sha256: z.string().regex(/^[a-f0-9]{64}$/),
      payload: z
        .object({
          context: z.record(z.string(), z.unknown()).optional(),
          mapping: z.record(z.string(), z.string()).optional(),
        })
        .default({}),
      requestKey: z.uuid(),
    })
    .parse(raw);
  if (data.route.endsWith("/commit"))
    throw new AppError(409, "Cần xem trước file trước khi xác nhận lưu");
  if (
    data.route === RETURN_CSV_ROUTE &&
    (!/\.csv$/i.test(data.filename) || data.size > RETURN_CSV_MAX_BYTES)
  )
    throw new AppError(
      413,
      "CSV TikTok nhập trực tiếp tối đa 1 MB / 2.000 dòng. Chia nhỏ file lớn trước khi nhập.",
    );
  if (data.size > (data.route.startsWith("sources/") ? 50 : 5) * 1024 * 1024)
    throw new AppError(413, "PDF tối đa 50 MB; Excel/CSV tối đa 5 MB");
  if (
    !(data.route.startsWith("sources/") ? /\.pdf$/i : /\.(xlsx|csv)$/i).test(
      data.filename,
    )
  )
    throw new AppError(400, "Định dạng file chưa được hỗ trợ");
  const key = digest(stable({ ...data, requestKey: data.requestKey }));
  const sql = db();
  // Bound unfinished work for each account; prevents unlimited abandoned storage intents.
  const [quota] =
    await sql`SELECT count(*)::int n FROM data_jobs WHERE created_by=${user.id} AND status IN ('waiting_upload','queued','running') AND expires_at>now()`;
  if (quota.n >= 40)
    throw new AppError(
      429,
      "Tối đa 40 tác vụ chưa hoàn tất. Chờ xử lý hoặc hủy bớt.",
    );
  const jobId = randomUUID(),
    path = `jobs/${user.id}/${jobId}/input`;
  const [job] =
    await sql`INSERT INTO data_jobs(id,created_by,route,method,filename,storage_path,file_size,sha256,payload,idempotency_key) VALUES(${jobId},${user.id},${data.route},'POST',${data.filename},${path},${data.size},${data.sha256},${sql.json(data.payload as any)},${key}) ON CONFLICT(created_by,idempotency_key) DO UPDATE SET updated_at=data_jobs.updated_at RETURNING id,status,storage_path`;
  if (job.status !== "waiting_upload")
    return { id: job.id, status: job.status };
  const signed = await storage().createSignedUploadUrl(job.storage_path, {
    upsert: false,
  });
  if (signed.error)
    throw new AppError(503, "Chưa tạo được đường tải file. Kiểm tra Storage.");
  return {
    id: job.id,
    status: job.status,
    path: job.storage_path,
    token: signed.data.token,
    url: environment().SUPABASE_URL,
    key: environment().SUPABASE_ANON_KEY,
    bucket: environment().STORAGE_BUCKET || "comsflow-private",
  };
}
export async function ownedJob(user: User, id: string) {
  z.uuid().parse(id);
  const [row] =
    await db()`SELECT * FROM data_jobs WHERE id=${id} AND created_by=${user.id}`;
  if (!row) throw new AppError(404, "Không tìm thấy tác vụ");
  return row;
}
export async function finalizeUpload(user: User, id: string) {
  requireRole(user, managerRoles);
  const job = await ownedJob(user, id);
  if (new Date(job.expires_at).getTime() < Date.now())
    throw new AppError(410, "Tác vụ đã hết hạn. Chọn lại file.");
  if (job.status !== "waiting_upload")
    return { id: job.id, status: job.status };
  const info = await storage().info(job.storage_path);
  if (info.error)
    throw new AppError(409, "File chưa tải xong. Vui lòng thử lại.");
  if (info.data.size !== Number(job.file_size))
    throw new AppError(400, "Kích thước file tải lên không khớp");
  const [row] =
    await db()`UPDATE data_jobs SET status='queued',updated_at=now() WHERE id=${id} AND status='waiting_upload' RETURNING id,status`;
  return row ?? { id, status: "queued" };
}
export async function enqueueReport(
  user: User,
  path: string,
  params: URLSearchParams,
) {
  requireRole(user, managerRoles);
  if (!reportRoute(path, params) && path !== "scan-export")
    throw new AppError(400, "Báo cáo không hợp lệ");
  if (path.startsWith("maintenance/")) requireRole(user, ["admin"]);
  const [quota] =
    await db()`SELECT count(*)::int n FROM data_jobs WHERE created_by=${user.id} AND status IN ('waiting_upload','queued','running') AND expires_at>now()`;
  if (quota.n >= 40)
    throw new AppError(
      429,
      "Tối đa 40 tác vụ chưa hoàn tất. Chờ xử lý hoặc hủy bớt.",
    );
  const key = randomUUID();
  const [row] =
    await db()`INSERT INTO data_jobs(created_by,route,method,status,payload,idempotency_key) VALUES(${user.id},${path},'GET','queued',${db().json(Object.fromEntries(params))},${key}) RETURNING id`;
  return row;
}
export async function claimJob() {
  const sql = db(),
    token = randomUUID();
  const [row] =
    await sql`WITH candidate AS (SELECT id FROM data_jobs WHERE route NOT LIKE 'returns/csv/%' AND route NOT LIKE 'sources/browser/%' AND expires_at>now() AND attempts<max_attempts AND ((status='queued' AND next_attempt_at<=now()) OR (status='running' AND lease_expires_at<now())) ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1) UPDATE data_jobs j SET status='running',attempts=attempts+1,lease_token=${token},lease_expires_at=now()+interval '10 minutes',updated_at=now(),error=NULL FROM candidate c WHERE j.id=c.id RETURNING j.*`;
  return row ?? null;
}
export async function failJob(
  id: string,
  token: string,
  message: string,
  retryable: boolean,
) {
  const safe = message.slice(0, 800);
  await db()`UPDATE data_jobs SET status=CASE WHEN ${retryable} AND attempts<max_attempts THEN 'queued' ELSE 'failed' END,error=${safe},next_attempt_at=now()+interval '30 seconds',updated_at=now(),lease_token=NULL,lease_expires_at=NULL WHERE id=${id} AND status='running' AND lease_token=${token}`;
}
