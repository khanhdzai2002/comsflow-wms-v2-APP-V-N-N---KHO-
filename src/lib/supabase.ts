import { createClient } from "@supabase/supabase-js";
import { environment } from "../server/context";
import { AppError } from "./domain";

export function supabase(admin = false) {
  const env = environment();
  const key = admin ? env.SUPABASE_SERVICE_ROLE_KEY : env.SUPABASE_ANON_KEY;
  if (!env.SUPABASE_URL || !key)
    throw new AppError(503, "Chưa cấu hình Supabase cho môi trường này.");
  return createClient(env.SUPABASE_URL, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}
export function storage() {
  return supabase(true).storage.from(
    environment().STORAGE_BUCKET || "comsflow-private",
  );
}
