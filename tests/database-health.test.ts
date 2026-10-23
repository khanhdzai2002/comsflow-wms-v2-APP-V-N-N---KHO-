import { afterEach, expect, it, vi } from "vitest";
import { databaseHealth } from "../src/server/database-health";
import { requestContext, type AppEnv } from "../src/server/context";
const mock = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock("../src/lib/db", () => ({ db: () => mock.query }));
const log = vi.spyOn(console, "error").mockImplementation(() => {});
afterEach(() => {
  mock.query.mockReset();
  log.mockClear();
});
function health(env: Partial<AppEnv> = {}) {
  return requestContext.run(
    { env: env as AppEnv, cookies: [], pending: [] },
    databaseHealth,
  );
}
const env = { DATABASE_URL: "postgres://test:dummy-secret@localhost/test" };
it("explains missing runtime secrets without attempting a query", async () => {
  const response = await health();
  expect(response.status).toBe(503);
  expect(await response.json()).toMatchObject({
    code: "DB_URL_MISSING",
    diagnosticVersion: "2026-10-23.5",
    diagnostics: { phase: "configuration" },
    configuration: { databaseUrlPresent: false, serviceRolePresent: false },
  });
  expect(mock.query).not.toHaveBeenCalled();
});
it("returns safe diagnostics and correlation id for authentication failure", async () => {
  mock.query.mockRejectedValue({ code: "28P01", message: env.DATABASE_URL });
  const response = await health(env);
  const body = await response.json();
  expect(response.status).toBe(503);
  expect(body.code).toBe("DB_AUTH_FAILED");
  expect(body.diagnostics.phase).toBe("query");
  expect(response.headers.get("X-Request-Id")).toBe(body.requestId);
  expect(JSON.stringify(body) + JSON.stringify(log.mock.calls)).not.toContain(
    "dummy-secret",
  );
  expect(response.headers.get("Cache-Control")).toBe("no-store");
});
it("does not report an incomplete or wrong database healthy", async () => {
  mock.query.mockResolvedValue([{ applied: 0 }]);
  const response = await health(env);
  expect(response.status).toBe(503);
  expect(await response.json()).toMatchObject({ code: "DB_SCHEMA_INCOMPLETE" });
});
it("preserves the successful health response", async () => {
  mock.query.mockResolvedValue([{ applied: 3 }]);
  const response = await health(env);
  expect(response.status).toBe(200);
  expect(response.headers.get("X-ComsFlow-Diagnostic-Version")).toBe(
    "2026-10-23.5",
  );
  expect(await response.json()).toEqual({ ok: true, database: "connected" });
});
it("keeps redacted runtime details in private logs rather than public health", async () => {
  mock.query.mockRejectedValue(
    new Error("Socket transport rejected " + env.DATABASE_URL),
  );
  const response = await health(env);
  const body = await response.json();
  expect(body).not.toHaveProperty("runtimeDetails");
  expect(log).toHaveBeenCalledWith(
    "Database health failed",
    expect.objectContaining({
      requestId: body.requestId,
      runtimeDetails: { message: "Socket transport rejected [redacted]" },
    }),
  );
  expect(JSON.stringify(log.mock.calls)).not.toContain("dummy-secret");
});
