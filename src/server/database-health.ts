import { randomUUID } from "node:crypto";
import { db } from "../lib/db";
import {
  databaseConnection,
  databaseFailure,
  databaseErrorMetadata,
} from "../lib/database-connection";
import { environment } from "./context";
import { AppResponse } from "./http";
export async function databaseHealth() {
  const env = environment();
  try {
    databaseConnection(env);
    const [row] =
      await db()`SELECT count(*)::int applied FROM public.schema_migrations WHERE name IN ('015_supabase_platform.sql','016_background_jobs.sql','017_job_storage_cleanup.sql')`;
    if (row.applied !== 3)
      return AppResponse.json(
        {
          ok: false,
          database: "unavailable",
          code: "DB_SCHEMA_INCOMPLETE",
          error: "Database chưa có đủ cấu trúc ComsFlow v2.",
          hint: "Kiểm tra DATABASE_URL trỏ đúng project đã chạy 17 migration. Không xóa bảng hoặc chạy seed.",
        },
        {
          status: 503,
          headers: { "Cache-Control": "no-store", "Retry-After": "5" },
        },
      );
    return AppResponse.json(
      { ok: true, database: "connected" },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    const failure = databaseFailure(error),
      requestId = randomUUID();
    const diagnostics = databaseErrorMetadata(error);
    console.error("Database health failed", {
      code: failure.code,
      requestId,
      ...diagnostics,
    });
    return AppResponse.json(
      {
        ok: false,
        database: "unavailable",
        ...failure,
        requestId,
        diagnostics,
        configuration: {
          databaseUrlPresent: !!(
            env.DATABASE_URL?.trim() || env.HYPERDRIVE?.connectionString
          ),
          serviceRolePresent: !!env.SUPABASE_SERVICE_ROLE_KEY?.trim(),
        },
      },
      {
        status: 503,
        headers: {
          "Cache-Control": "no-store",
          "Retry-After": "5",
          "X-Request-Id": requestId,
        },
      },
    );
  }
}
