import { createHash, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { db } from "./db";
import { AppError } from "./domain";
import { createAccount, login } from "./auth";

const input = z.object({
  token: z.string().min(1).max(256),
  name: z.string().trim().min(2).max(100),
  email: z.email().max(200),
  password: z.string().min(12).max(100),
});
const enabled = (secret?: string) =>
  Boolean(secret && secret.length >= 32 && secret.length <= 256);
const digest = (s: string) => createHash("sha256").update(s).digest();
export async function setupStatus(secret?: string) {
  if (!secret)
    return {
      available: false,
      code: "SETUP_TOKEN_MISSING",
      message:
        "Chưa bật tạo Admin. Thêm Secret SETUP_TOKEN trong Cloudflare với mã riêng dài 32–256 ký tự, rồi Deploy.",
    };
  if (!enabled(secret))
    return {
      available: false,
      code: "SETUP_TOKEN_INVALID",
      message:
        "Mã thiết lập chưa hợp lệ. Cập nhật Secret SETUP_TOKEN trong Cloudflare thành mã dài 32–256 ký tự, rồi Deploy.",
    };
  const [r] = await db()`SELECT EXISTS(SELECT 1 FROM users) present`;
  return r.present
    ? {
        available: false,
        code: "USERS_EXIST",
        message:
          "Hệ thống đã có tài khoản nên đã đóng tạo Admin đầu tiên. Đăng nhập bằng tài khoản đã tạo hoặc liên hệ quản trị viên để khôi phục quyền truy cập.",
      }
    : {
        available: true,
        code: "SETUP_READY",
        message: "Hệ thống chưa có tài khoản. Có thể tạo Admin đầu tiên.",
      };
}
export async function setupAvailable(secret?: string) {
  return (await setupStatus(secret)).available;
}
export async function bootstrapAdmin(raw: unknown, secret?: string) {
  if (!enabled(secret))
    throw new AppError(403, "Thiết lập tài khoản chưa được bật");
  const data = input.parse(raw);
  if (!timingSafeEqual(digest(secret!), digest(data.token)))
    throw new AppError(403, "Mã thiết lập không đúng");
  const sql = db();
  const lease = crypto.randomUUID();
  const acquired = await sql.begin(async (tx) => {
    await tx`SELECT pg_advisory_xact_lock(742925)`;
    if ((await tx`SELECT id FROM users LIMIT 1`).length)
      throw new AppError(409, "Hệ thống đã có tài khoản");
    const [row] =
      await tx`INSERT INTO setup_leases(key,token,expires_at) VALUES('first-admin',${lease},now()+interval '2 minutes') ON CONFLICT(key) DO UPDATE SET token=excluded.token,expires_at=excluded.expires_at WHERE setup_leases.expires_at<now() RETURNING token`;
    return !!row;
  });
  if (!acquired)
    throw new AppError(
      409,
      "Một lượt thiết lập đang chạy. Chờ hoàn tất rồi đăng nhập.",
    );
  try {
    await createAccount({ ...data, role: "admin" });
    const result = await login(data.email, data.password);
    if ("error" in result)
      throw new AppError(503, "Đã tạo quản trị viên. Vui lòng đăng nhập lại.");
    return result;
  } finally {
    await sql`DELETE FROM setup_leases WHERE key='first-admin' AND token=${lease}`;
  }
}
