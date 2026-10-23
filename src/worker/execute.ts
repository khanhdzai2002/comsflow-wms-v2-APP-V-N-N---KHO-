import { createHash } from "node:crypto";
import { db, type User } from "../lib/db";
import {
  requestContext,
  type AppEnv,
  type RequestState,
} from "../server/context";
import { AppRequest } from "../server/http";
import { fileRequest } from "./file-api";
import { dispatch } from "../server/api";
import { reportSink, scanExport } from "./reports";
import { storage } from "../lib/supabase";
import { AppError, requireRole, managerRoles } from "../lib/domain";
export async function executeJob(id: string, token: string) {
  const sql = db();
  const [initial] =
    await sql`SELECT * FROM data_jobs WHERE id=${id} AND status='running' AND lease_token=${token}`;
  if (!initial) return;
  let bytes: Buffer | undefined;
  if (initial.storage_path) {
    const { data, error } = await storage().download(initial.storage_path);
    if (error || !data)
      throw new AppError(503, "Chưa đọc được file từ Storage");
    if (data.size !== Number(initial.file_size) || data.size > 50 * 1024 * 1024)
      throw new AppError(400, "Kích thước file không khớp");
    bytes = Buffer.from(await data.arrayBuffer());
    if (createHash("sha256").update(bytes).digest("hex") !== initial.sha256)
      throw new AppError(
        400,
        "File tải lên không khớp mã kiểm tra SHA-256. Chọn lại file gốc.",
      );
  }
  // Lock + business writes + durable result share one transaction. A killed child
  // rolls back both; a retry cannot replay a successfully committed mutation.
  await sql.begin("isolation level repeatable read", async (tx) => {
    await tx`SET LOCAL idle_in_transaction_session_timeout='9min'`;
    const [job] =
      await tx`SELECT * FROM data_jobs WHERE id=${id} AND status='running' AND lease_token=${token} FOR UPDATE`;
    if (!job) return;
    const [actor] =
      await tx`SELECT id,name,email,role FROM users WHERE id=${job.created_by} AND active`;
    if (!actor) throw new AppError(403, "Tài khoản đã bị khóa");
    requireRole(actor as User, managerRoles);
    const bound = new Proxy(tx, {
      get(target, key) {
        if (key === "begin")
          return (first: any, second?: any) =>
            target.savepoint(typeof first === "function" ? first : second);
        return Reflect.get(target, key);
      },
    });
    const state: RequestState = {
      env: process.env as unknown as AppEnv,
      sql: bound as any,
      cookies: [],
      pending: [],
      exportSink: reportSink(job.id),
    };
    await requestContext.run(state, async () => {
      let result;
      if (job.route === "scan-export")
        result = await scanExport(job.payload.date, job.id);
      else {
        let req: AppRequest;
        if (job.method === "GET")
          req = new AppRequest(
            `https://worker.internal/api/${job.route}?${new URLSearchParams(job.payload)}`,
          );
        else {
          const form = new FormData();
          form.set("file", new File([new Uint8Array(bytes!)], job.filename));
          form.set("context", JSON.stringify(job.payload.context ?? {}));
          if (!job.route.startsWith("sources/"))
            form.set("mapping", JSON.stringify(job.payload.mapping ?? {}));
          req = new AppRequest(`https://worker.internal/api/${job.route}`, {
            method: "POST",
            body: form,
          });
        }
        const response =
          job.method === "GET"
            ? await dispatch(req, actor as User)
            : await fileRequest(req, actor as User);
        if (!response.ok)
          throw new AppError(response.status, "Tác vụ không hoàn tất");
        result = await response.json();
      }
      if (Buffer.byteLength(JSON.stringify(result)) > 12 * 1024 * 1024)
        throw new AppError(
          413,
          "Kết quả quá lớn. Chia nhỏ file để kiểm tra an toàn.",
        );
      await tx`UPDATE data_jobs SET status='succeeded',result=${tx.json(result)},updated_at=now(),lease_token=NULL,lease_expires_at=NULL WHERE id=${id} AND lease_token=${token}`;
    });
  });
}
