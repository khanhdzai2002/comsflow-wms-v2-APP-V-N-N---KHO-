import { AppRequest, AppResponse } from "./http";
import { requestContext, type AppEnv, type RequestState } from "./context";
import { handler } from "./api";
import { currentUser } from "../lib/auth";
import { db } from "../lib/db";
import { AppError, requireRole, managerRoles } from "../lib/domain";
import { verifyRequestOrigin } from "../lib/request-origin";
import {
  createUpload,
  finalizeUpload,
  ownedJob,
  enqueueReport,
  fileRoutes,
  reportRoute,
} from "../lib/jobs";
import { storage } from "../lib/supabase";
async function route(req: AppRequest) {
  const path = req.nextUrl.pathname.replace(/^\/api\//, "");
  if (
    !path.startsWith("jobs") &&
    !fileRoutes.includes(path) &&
    !reportRoute(path, req.nextUrl.searchParams)
  )
    return handler(req);
  const state = requestContext.getStore()!;
  const user = await currentUser(req.cookies.get("comsflow_session")?.value);
  if (!user) throw new AppError(401, "Vui lòng đăng nhập");
  requireRole(user, managerRoles);
  if (req.method !== "GET")
    verifyRequestOrigin(req, { appOrigin: state.env.APP_ORIGIN });
  if (fileRoutes.includes(path))
    throw new AppError(
      410,
      "File cần tải trực tiếp lên Storage. Làm mới giao diện và thử lại.",
    );
  if (reportRoute(path, req.nextUrl.searchParams) && req.method === "GET") {
    const job = await enqueueReport(user, path, req.nextUrl.searchParams);
    return new Response(null, {
      status: 303,
      headers: { Location: `/#jobs/${job.id}` },
    });
  }
  const read = async () => {
    if (Number(req.headers.get("content-length")) > 32768)
      throw new AppError(413, "Yêu cầu quá lớn");
    const reader = req.body?.getReader();
    if (!reader) throw new AppError(400, "Thiếu dữ liệu");
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 32768) {
        await reader.cancel();
        throw new AppError(413, "Yêu cầu quá lớn");
      }
      chunks.push(value);
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  };
  if (path === "jobs/uploads" && req.method === "POST")
    return AppResponse.json(await createUpload(user, await read()));
  if (path === "jobs/scan-export" && req.method === "POST") {
    const data = await read();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(data.date))
      throw new AppError(400, "Chọn ngày xuất dữ liệu");
    return AppResponse.json(
      await enqueueReport(
        user,
        "scan-export",
        new URLSearchParams({ date: data.date }),
      ),
    );
  }
  if (path === "jobs" && req.method === "GET") {
    const jobs =
      await db()`SELECT id,route,filename,status,error,attempts,created_at,updated_at,expires_at FROM data_jobs WHERE created_by=${user.id} ORDER BY created_at DESC LIMIT 100`;
    const [health] =
      await db()`SELECT max(seen_at) last_seen FROM worker_heartbeats`;
    return AppResponse.json({ jobs, workerLastSeen: health.last_seen });
  }
  const [, id, action] = path.split("/");
  const job = await ownedJob(user, id);
  if (action === "commit" && req.method === "POST") {
    const result = await db().begin(async (tx) => {
      const [current] =
        await tx`SELECT * FROM data_jobs WHERE id=${id} AND created_by=${user.id} FOR UPDATE`;
      if (!current) throw new AppError(404, "Không tìm thấy tác vụ");
      if (new Date(current.expires_at).getTime() < Date.now())
        throw new AppError(410, "File đã hết hạn. Chọn lại file gốc.");
      if (current.route.endsWith("/commit"))
        return { id, status: current.status };
      if (current.status !== "succeeded" || !current.route.endsWith("/preview"))
        throw new AppError(409, "Cần xem trước file thành công trước khi lưu");
      const payload = {
        ...current.payload,
        context: {
          ...current.payload.context,
          previewFingerprint: current.result?.previewFingerprint,
        },
      };
      await tx`UPDATE data_jobs SET route=${current.route.replace(/preview$/, "commit")},status='queued',attempts=0,result=NULL,error=NULL,payload=${tx.json(payload)},updated_at=now(),next_attempt_at=now() WHERE id=${id}`;
      return { id, status: "queued" };
    });
    return AppResponse.json(result);
  }
  if (action === "finalize" && req.method === "POST")
    return AppResponse.json(await finalizeUpload(user, id));
  if (action === "retry" && req.method === "POST") {
    if (new Date(job.expires_at).getTime() < Date.now())
      throw new AppError(410, "File đã hết hạn. Chọn lại file gốc.");
    const rows =
      await db()`UPDATE data_jobs SET status='queued',attempts=0,error=NULL,lease_token=NULL,lease_expires_at=NULL,next_attempt_at=now(),updated_at=now() WHERE id=${id} AND status='failed' RETURNING id`;
    if (!rows.length) throw new AppError(409, "Chỉ thử lại tác vụ đã báo lỗi");
    return AppResponse.json({ id, status: "queued" });
  }
  if (action === "cancel" && req.method === "POST") {
    // Running commits cannot be cancelled after they have acquired their transaction lock.
    const rows =
      await db()`UPDATE data_jobs SET status='cancelled',updated_at=now() WHERE id=${id} AND status IN ('waiting_upload','queued') RETURNING id`;
    if (!rows.length)
      throw new AppError(409, "Tác vụ đã chạy hoặc kết thúc, chưa thể hủy");
    return AppResponse.json({ ok: true });
  }
  if (action === "download" && req.method === "GET") {
    if (job.status !== "succeeded" || !job.result?.artifact)
      throw new AppError(409, "File chưa sẵn sàng");
    if (new Date(job.expires_at).getTime() < Date.now())
      throw new AppError(410, "File đã hết hạn. Tạo lại báo cáo.");
    const signed = await storage().createSignedUrl(job.result.artifact, 300, {
      download: job.result.filename || true,
    });
    if (signed.error) throw new AppError(503, "Chưa tạo được link tải");
    return Response.redirect(signed.data.signedUrl, 302);
  }
  if (req.method === "GET" && !action)
    return AppResponse.json({
      id,
      route: job.route,
      status: job.status,
      error: job.error,
      result: job.status === "succeeded" ? job.result : null,
      attempts: job.attempts,
    });
  throw new AppError(404, "Không tìm thấy tác vụ");
}
export default {
  async fetch(
    request: Request,
    env: AppEnv,
    ctx: { waitUntil(p: Promise<unknown>): void },
  ) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith("/api/")) {
      if (url.pathname === "/health")
        return AppResponse.json({
          ok: true,
          platform: "cloudflare-supabase",
          version: "2.0.0",
        });
      return env.ASSETS!.fetch(request);
    }
    const req = new AppRequest(request);
    const state: RequestState = {
      cloudflare: true,
      env,
      cookies: [],
      pending: [],
      refreshToken: req.cookies.get("comsflow_refresh")?.value,
    };
    return requestContext.run(state, async () => {
      try {
        let response: Response;
        try {
          response = await route(req);
        } catch (error) {
          const status =
            error instanceof AppError
              ? error.status
              : error instanceof SyntaxError ||
                  (error instanceof Error && error.name === "ZodError")
                ? 400
                : 503;
          response = AppResponse.json(
            {
              error:
                error instanceof AppError
                  ? error.message
                  : status === 400
                    ? "Dữ liệu không hợp lệ"
                    : "Dịch vụ đang bận. Thử lại sau.",
            },
            { status },
          );
        }
        const mutable = new Response(response.body, response);
        state.cookies.forEach((cookie) =>
          mutable.headers.append("Set-Cookie", cookie),
        );
        mutable.headers.set("Cache-Control", "no-store");
        mutable.headers.set("X-Content-Type-Options", "nosniff");
        return mutable;
      } finally {
        ctx.waitUntil(
          Promise.allSettled(state.pending).then(() =>
            state.sql?.end({ timeout: 5 }),
          ),
        );
      }
    });
  },
};
