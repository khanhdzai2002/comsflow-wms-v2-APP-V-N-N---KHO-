import { AsyncLocalStorage } from "node:async_hooks";
import type postgres from "postgres";

export type AppEnv = {
  DATABASE_URL: string;
  SUPABASE_URL: string;
  SUPABASE_ANON_KEY: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  STORAGE_BUCKET?: string;
  APP_ORIGIN?: string;
  SETUP_TOKEN?: string;
  DB_MAX_CONNECTIONS?: string;
  ASSETS?: { fetch(request: Request): Promise<Response> };
  HYPERDRIVE?: { connectionString: string };
};
export type RequestState = {
  cloudflare?: boolean;
  exportSink?: (
    rows: Record<string, any>[],
    format: string,
    filename: string,
  ) => Promise<Response>;
  env: AppEnv;
  sql?: ReturnType<typeof postgres>;
  cookies: string[];
  refreshToken?: string;
  accessToken?: string;
  pending: Promise<unknown>[];
};
export const requestContext = new AsyncLocalStorage<RequestState>();
export function environment(): AppEnv {
  return requestContext.getStore()?.env ?? (process.env as unknown as AppEnv);
}
export function defer(task: Promise<unknown>) {
  const state = requestContext.getStore();
  if (!state) throw new Error("Không có request context");
  state.pending.push(task);
}
