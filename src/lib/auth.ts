import { createHash } from "node:crypto";
import { db, type User } from "./db";
import { AppError } from "./domain";
import { supabase } from "./supabase";
import { requestContext, environment } from "../server/context";
import { serializeCookie } from "../server/http";

export const sessionHash = (token: string) =>
  createHash("sha256").update(token).digest("hex");
export function sessionCookies(
  access: string,
  refresh: string,
  expires = 3600,
) {
  const env = environment();
  const options = {
    path: "/",
    httpOnly: true,
    sameSite: "strict" as const,
    secure: env.APP_ORIGIN
      ? env.APP_ORIGIN.startsWith("https://")
      : !env.SUPABASE_URL?.startsWith("http://127.0.0.1"),
  };
  return [
    serializeCookie("comsflow_session", access, {
      ...options,
      maxAge: expires,
    }),
    serializeCookie("comsflow_refresh", refresh, {
      ...options,
      maxAge: 30 * 86400,
    }),
  ];
}
async function profile(authId: string): Promise<User | null> {
  const [user] =
    await db()`SELECT id,name,email,role FROM users WHERE auth_user_id=${authId} AND active`;
  return (user as User) ?? null;
}
export async function currentUser(
  token: string | undefined,
): Promise<User | null> {
  const auth = supabase().auth;
  if (token) {
    const result = await auth.getUser(token);
    if (!result.error && result.data.user) {
      const state = requestContext.getStore();
      if (state) state.accessToken = token;
      return profile(result.data.user.id);
    }
    if (result.error && (!result.error.status || result.error.status >= 500))
      throw new AppError(503, "Dịch vụ đăng nhập đang bận. Vui lòng thử lại.");
  }
  const state = requestContext.getStore();
  if (!state?.refreshToken) return null;
  const result = await auth.refreshSession({
    refresh_token: state.refreshToken,
  });
  if (result.error) {
    if (!result.error.status || result.error.status >= 500)
      throw new AppError(503, "Chưa thể gia hạn đăng nhập. Vui lòng thử lại.");
    return null;
  }
  const session = result.data.session;
  if (!session) return null;
  const user = await profile(session.user.id);
  if (user) {
    state.accessToken = session.access_token;
    state.cookies.push(
      ...sessionCookies(
        session.access_token,
        session.refresh_token,
        session.expires_in,
      ),
    );
  }
  return user;
}
export async function login(email: string, password: string) {
  const result = await supabase().auth.signInWithPassword({
    email: email.toLowerCase().trim(),
    password,
  });
  if (result.error || !result.data.session) {
    if (result.error?.status === 429)
      throw new AppError(
        429,
        "Thử đăng nhập quá nhiều lần. Vui lòng chờ rồi thử lại.",
      );
    if (!result.error?.status || result.error.status >= 500)
      throw new AppError(
        503,
        "Dịch vụ đăng nhập chưa sẵn sàng. Vui lòng thử lại.",
      );
    return { error: true as const };
  }
  const user = await profile(result.data.user.id);
  if (!user)
    throw new AppError(
      403,
      "Tài khoản chưa được cấp quyền hoặc đã bị khóa. Liên hệ quản trị viên.",
    );
  await db()`INSERT INTO audit_logs(user_id,action,entity_id,reason) VALUES(${user.id},'login',${user.id},'Đăng nhập Supabase Auth')`;
  const session = result.data.session;
  return {
    token: session.access_token,
    refresh: session.refresh_token,
    expires: session.expires_in,
    user,
  };
}
export async function createAccount(data: {
  name: string;
  email: string;
  password: string;
  role: User["role"];
}) {
  const result = await supabase(true).auth.admin.createUser({
    email: data.email.toLowerCase().trim(),
    password: data.password,
    email_confirm: true,
    user_metadata: { name: data.name },
    app_metadata: { app_role: data.role, comsflow_provisioned: true },
  });
  if (result.error || !result.data.user)
    throw new AppError(
      result.error?.status === 422 ? 409 : 503,
      "Chưa tạo được tài khoản Supabase. Kiểm tra email đã tồn tại và cấu hình Auth.",
    );
  const authId = result.data.user.id;
  const linked = await profile(authId);
  if (linked) return linked;
  await db()`INSERT INTO users(id,auth_user_id,email,name,password_hash,role) VALUES(${authId},${authId},${data.email.toLowerCase().trim()},${data.name},'!supabase-auth',${data.role}) ON CONFLICT(id) DO NOTHING`;
  const user = await profile(authId);
  if (!user)
    throw new AppError(
      503,
      "Auth đã tạo tài khoản nhưng hồ sơ chưa được liên kết. Liên hệ quản trị để kiểm tra, không tạo lặp.",
    );
  return user;
}
