import { expect, it } from "vitest";
import postgres from "postgres";
import {
  databaseConnection,
  databaseFailure,
  databaseErrorMetadata,
} from "../src/lib/database-connection";
const pooler =
  "postgresql://postgres.example:dummy-password@aws-0-ap-southeast-1.pooler.supabase.com:6543/postgres";
it("enables TLS and removes unsupported pooler startup options", async () => {
  const config = databaseConnection({
    DATABASE_URL:
      pooler +
      "?pgbouncer=true&connection_limit=1&pool_timeout=10&schema=public&statement_timeout=123",
    SUPABASE_URL: "https://example.supabase.co",
  });
  expect(config.options.ssl).toBe("require");
  expect(config.url).not.toMatch(
    /pgbouncer|connection_limit|pool_timeout|schema|statement_timeout/,
  );
  const sql = postgres(config.url, config.options);
  expect(sql.options.connection).not.toHaveProperty("statement_timeout");
  expect(sql.options.prepare).toBe(false);
  await sql.end();
});
it("preserves explicit TLS mode and local statement timeout", () => {
  expect(
    databaseConnection({ DATABASE_URL: pooler + "?sslmode=verify-full" }).url,
  ).toContain("sslmode=verify-full");
  const local = databaseConnection({
    DATABASE_URL: "postgres://test:dummy@localhost/test",
  });
  expect(local.options).not.toHaveProperty("ssl");
  expect(local.options.connection.statement_timeout).toBe(30000);
  expect(databaseConnection({ DATABASE_URL: '"' + pooler + '"' }).url).toBe(
    pooler,
  );
});
it.each([
  [undefined, "DB_URL_MISSING"],
  ["https://example.supabase.co", "DB_URL_INVALID"],
  [
    pooler.replace("dummy-password", "[YOUR-PASSWORD]"),
    "DB_PASSWORD_PLACEHOLDER",
  ],
  [pooler.replace("dummy-password", "bad%ZZ"), "DB_PASSWORD_ENCODING"],
  [pooler.replace("postgres.example", "postgres"), "DB_POOLER_USER_INVALID"],
  [pooler + "?sslmode=disable", "DB_TLS_REQUIRED"],
])("rejects invalid runtime configuration safely", (url, code) => {
  try {
    databaseConnection({ DATABASE_URL: url });
    throw Error("expected validation failure");
  } catch (error) {
    expect(databaseFailure(error).code).toBe(code);
    expect(JSON.stringify(databaseFailure(error))).not.toContain(
      "dummy-password",
    );
  }
});
it("rejects a different Supabase project", () => {
  expect(() =>
    databaseConnection({
      DATABASE_URL: pooler,
      SUPABASE_URL: "https://other.supabase.co",
    }),
  ).toThrow(/PROJECT_REF/);
});
it.each([
  ["28P01", "DB_AUTH_FAILED"],
  ["ENOTFOUND", "DB_DNS_FAILED"],
  ["CERT_HAS_EXPIRED", "DB_TLS_FAILED"],
  ["42P01", "DB_SCHEMA_MISSING"],
  ["CONNECT_TIMEOUT", "DB_CONNECT_TIMEOUT"],
  ["ECONNREFUSED", "DB_NETWORK_FAILED"],
  ["UNKNOWN", "DB_CONNECTION_FAILED"],
])(
  "classifies failures without disclosing provider details",
  (code, expected) => {
    const result = databaseFailure({ code, message: "failure " + pooler });
    expect(result.code).toBe(expected);
    expect(JSON.stringify(result)).not.toContain(pooler);
    expect(JSON.stringify(result)).not.toContain("dummy-password");
  },
);
it("recognizes pooler startup and nested network failures", () => {
  expect(
    databaseFailure({
      message: "unsupported startup parameter: statement_timeout",
    }).code,
  ).toBe("DB_POOLER_PARAMETER_UNSUPPORTED");
  expect(databaseFailure({ cause: { code: "ENOTFOUND" } }).code).toBe(
    "DB_DNS_FAILED",
  );
});

it("recognizes Supavisor generic SQLSTATE authentication errors", () => {
  expect(
    databaseFailure({
      code: "XX000",
      message:
        'Authentication error, reason: password authentication failed for user "postgres"',
    }).code,
  ).toBe("DB_AUTH_FAILED");
  expect(
    databaseFailure({
      message: "Cannot perform I/O on behalf of a different request",
    }).code,
  ).toBe("DB_RUNTIME_IO_FAILED");
});
it("limits diagnostic metadata to known exception names and SQLSTATE", () => {
  expect(
    databaseErrorMetadata({
      name: "PostgresError",
      code: "XX000",
      message: pooler,
    }),
  ).toEqual({ errorType: "PostgresError", sqlState: "XX000" });
  expect(
    databaseErrorMetadata({ name: pooler, code: pooler, message: pooler }),
  ).toEqual({ errorType: "Other", sqlState: null });
});

it.each([
  "proxy request failed",
  "failed to connect",
  "connection attempt failed",
  "Network connection lost",
  "Socket closed",
])("recognizes raw Cloudflare socket failure: %s", (message) => {
  expect(databaseFailure(new Error(message)).code).toBe("DB_NETWORK_FAILED");
});

it("identifies the subrequest quota without treating it as a password failure", () => {
  expect(
    databaseFailure(
      new Error("Too many subrequests by single Worker invocation"),
    ).code,
  ).toBe("DB_SUBREQUEST_LIMIT");
  expect(databaseFailure({ code: "DB_CONNECTION_RETRY_LIMIT" }).code).toBe(
    "DB_CONNECTION_RETRY_LIMIT",
  );
});

it("keeps transport TLS required when the socket owns the handshake", () => {
  expect(databaseConnection({ DATABASE_URL: pooler }).secure).toBe(true);
  expect(
    databaseConnection({ DATABASE_URL: pooler + "?sslmode=verify-full" })
      .secure,
  ).toBe(true);
  expect(
    databaseConnection({
      DATABASE_URL: "postgres://test:dummy@localhost/test?sslmode=require",
    }).secure,
  ).toBe(true);
  expect(
    databaseConnection({ DATABASE_URL: "postgres://test:dummy@localhost/test" })
      .secure,
  ).toBe(false);
});
