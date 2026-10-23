import { expect, it } from "vitest";
import postgres from "postgres";
import {
  databaseConnection,
  databaseFailure,
} from "../src/lib/database-connection";
import { db } from "../src/lib/db";
import {
  requestContext,
  type AppEnv,
  type RequestState,
} from "../src/server/context";
const managed =
  "postgres://internal:dummy@managed.hyperdrive.local:5432/postgres";
it("uses the managed binding before a stale direct URI without sending origin TLS options", async () => {
  const config = databaseConnection({
    HYPERDRIVE: {
      connectionString:
        managed + "?sslmode=require&pgbouncer=true&statement_timeout=100",
    },
    DATABASE_URL: "invalid-stale-url",
  });
  expect(config.mode).toBe("hyperdrive");
  expect(config.secure).toBe(false);
  expect(config.options).toHaveProperty("ssl", false);
  const sql = postgres(config.url, config.options);
  expect(sql.options.ssl).toBe(false);
  expect(sql.options.connection).not.toHaveProperty("statement_timeout");
  expect(sql.options.connection).not.toHaveProperty("pgbouncer");
  await sql.end();
});
it("refuses an incomplete managed binding instead of falling back to another database", () => {
  try {
    databaseConnection({
      HYPERDRIVE: { connectionString: "" },
      DATABASE_URL: "postgres://test:dummy@localhost/other",
    });
    throw Error("expected validation failure");
  } catch (error) {
    expect(databaseFailure(error).code).toBe("DB_HYPERDRIVE_MISSING");
  }
});
it("preserves direct origin TLS when there is no Hyperdrive binding", () => {
  const config = databaseConnection({
    DATABASE_URL:
      "postgres://postgres.project:dummy@aws-0-ap-northeast-2.pooler.supabase.com:5432/postgres",
  });
  expect(config.mode).toBe("direct");
  expect(config.secure).toBe(true);
});
it("preserves parameterized transactions through a simulated binding", async () => {
  const local = process.env.TEST_DATABASE_URL;
  if (!local || !new URL(local).pathname.endsWith("_test"))
    throw Error("Only disposable *_test database");
  const state: RequestState = {
    env: {
      HYPERDRIVE: { connectionString: local },
      DATABASE_URL: "intentionally-invalid-direct-url",
    } as AppEnv,
    cookies: [],
    pending: [],
  };
  await requestContext.run(state, async () => {
    const sql = db();
    try {
      const rows = await sql.begin(
        (tx) =>
          tx`SELECT ${"000123456789"}::text AS tracking_code, ${42}::int AS quantity`,
      );
      expect(rows).toMatchObject([
        { tracking_code: "000123456789", quantity: 42 },
      ]);
    } finally {
      await sql.end({ timeout: 0 });
    }
  });
});
