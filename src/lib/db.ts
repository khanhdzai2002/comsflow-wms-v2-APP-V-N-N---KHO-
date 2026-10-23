import postgres from "postgres";
import { databaseConnection } from "./database-connection";
import { createRequestSocketFactory } from "../server/database-socket";
import { createCloudflareSocketFactory } from "../server/cloudflare-database-socket";
import { environment, requestContext } from "../server/context";
const globalDb = globalThis as unknown as {
  comsflowDb?: ReturnType<typeof postgres>;
};
export function db() {
  const state = requestContext.getStore();
  const env = environment();
  if (state?.sql) return state.sql;
  const config = databaseConnection(
    env,
    state ? "comsflow-web" : "comsflow-worker",
  );
  const create = () =>
    postgres(config.url, {
      ...config.options,
      // Cloudflare socket hook completes TLS before handing the stream to the
      // driver. Disable only the driver's second STARTTLS, not transport TLS.
      ...(state?.cloudflare
        ? { socket: createCloudflareSocketFactory(config.secure), ssl: false }
        : state
          ? { socket: createRequestSocketFactory() }
          : {}),
      max: state
        ? 1
        : Math.min(4, Math.max(1, Number(env.DB_MAX_CONNECTIONS) || 2)),
      connect_timeout: 10,
      idle_timeout: 20,
      max_lifetime: 300,
    });
  if (state) return (state.sql = create());
  return (globalDb.comsflowDb ??= create());
}
export type Tx = postgres.TransactionSql;
export type User = {
  id: string;
  name: string;
  email: string;
  role: "admin" | "manager" | "staff";
};
export async function audit(
  tx: Tx,
  user: User,
  action: string,
  id: string,
  before: unknown,
  after: unknown,
  reason: string,
) {
  await tx`INSERT INTO audit_logs(user_id,action,entity_id,before_value,after_value,reason)
    VALUES(${user.id},${action},${id},${tx.json(before as any)},${tx.json(after as any)},${reason})`;
}
