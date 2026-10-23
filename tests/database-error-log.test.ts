import { expect, it } from "vitest";
import { databaseErrorLog } from "../src/server/database-error-log";

const password = "Dummy-P@ss%/word!";
const encoded = encodeURIComponent(password);
const url = `postgresql://postgres.test:${encoded}@pooler.example.test:6543/postgres`;
const env = {
  DATABASE_URL: url,
  SUPABASE_SERVICE_ROLE_KEY: "dummy-service-role-value",
  SUPABASE_ANON_KEY: "dummy-public-key-value",
  SETUP_TOKEN: "dummy-setup-token-value",
  HYPERDRIVE: {
    connectionString: "postgres://hyper:hyper-password@hyper.test/database",
  },
};
it("retains safe connection failure text while removing configured secrets", () => {
  const message = `proxy request failed: ${url} ${password} ${encoded.toLowerCase()} ${env.SUPABASE_SERVICE_ROLE_KEY} ${env.SUPABASE_ANON_KEY} ${env.SETUP_TOKEN} ${env.HYPERDRIVE.connectionString} hyper-password`;
  const result = databaseErrorLog(new Error(message), env);
  expect(result.message).toContain("proxy request failed");
  for (const secret of [
    url,
    password,
    encoded,
    env.SUPABASE_SERVICE_ROLE_KEY,
    env.SUPABASE_ANON_KEY,
    env.SETUP_TOKEN,
    env.HYPERDRIVE.connectionString,
    "hyper-password",
  ])
    expect(result.message.toLowerCase()).not.toContain(secret.toLowerCase());
});
it("redacts arbitrary URI credentials, JWTs, sb keys and credential fields", () => {
  const message =
    "failed to connect postgresql://other:other-password@private.test/db https://user:pass@api.test sb_secret_unknown_value eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJzZWNyZXQifQ.fake_signature Bearer mystery-token password=unknown-password token:mystery-token";
  const result = databaseErrorLog(new Error(message), {});
  for (const secret of [
    "other-password",
    "private.test",
    "api.test",
    "sb_secret_unknown_value",
    "eyJhbGci",
    "mystery-token",
    "unknown-password",
  ])
    expect(result.message).not.toContain(secret);
});
it("drops quoted values, inline SQL and injected stack traces", () => {
  expect(
    databaseErrorLog(
      new Error('failed for user "private-email@example.test"'),
      {},
    ).message,
  ).toBe("failed for user [redacted]");
  expect(
    databaseErrorLog(
      new Error("query failed: SELECT email,password FROM users"),
      {},
    ).message,
  ).not.toContain("users");
  expect(
    databaseErrorLog(
      new Error(
        "socket failed\n at private/path.ts:15\nSELECT secret FROM private_table",
      ),
      {},
    ).message,
  ).toBe("socket failed");
  expect(
    databaseErrorLog(
      {
        message: "connection failed",
        stack: "private stack",
        query: "SELECT private",
        parameters: ["private-password"],
      },
      {},
    ),
  ).toEqual({ message: "connection failed" });
});
it("handles hostile properties, non-string messages and cyclic causes", () => {
  const hostile = new Proxy(
    {},
    {
      get() {
        throw new Error("must not leak");
      },
    },
  );
  expect(databaseErrorLog(hostile, {})).toEqual({
    message: "Unknown database error",
  });
  expect(
    databaseErrorLog({ message: hostile, cause: { message: 12 } }, {}),
  ).toEqual({
    message: "Unknown database error",
    cause: "Unknown database error",
  });
  const cyclic: { message: string; cause?: unknown } = {
    message: "socket failed",
  };
  cyclic.cause = cyclic;
  expect(databaseErrorLog(cyclic, {})).toEqual({ message: "socket failed" });
});
it("bounds output, reads only one cause and tolerates invalid URI encoding", () => {
  const result = databaseErrorLog(
    {
      message: "x ".repeat(20000),
      cause: {
        message: "Network connection lost",
        cause: new Error("nested-password"),
      },
    },
    { DATABASE_URL: "postgres://test:bad%XX@private.test/db" },
  );
  expect(result.message.length).toBeLessThanOrEqual(500);
  expect(result.cause).toBe("Network connection lost");
  expect(JSON.stringify(result)).not.toContain("nested-password");
  expect(
    databaseErrorLog(new Error("bad%XX"), {
      DATABASE_URL: "postgres://test:bad%XX@private.test/db",
    }).message,
  ).not.toContain("bad%XX");
});
it("redacts repeatedly encoded password text and keeps plain exceptions useful", () => {
  const double = encodeURIComponent(encoded);
  expect(
    databaseErrorLog(new Error(double + " " + password), {
      DATABASE_URL: `postgres://test:${double}@host.test/db`,
    }).message,
  ).not.toContain(password);
  expect(
    databaseErrorLog(new Error("failed to connect to destination address"), {}),
  ).toEqual({ message: "failed to connect to destination address" });
});

it("redacts unconfigured quoted credential values with whitespace", () => {
  const result = databaseErrorLog(
    new Error(
      "password=\"secret with spaces\" token='another spaced secret' secret=`third spaced secret`",
    ),
    {},
  );
  for (const part of [
    "secret with spaces",
    "another spaced secret",
    "third spaced secret",
    "with spaces",
    "spaced secret",
  ])
    expect(result.message).not.toContain(part);
});
