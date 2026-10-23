import {
  beforeAll,
  beforeEach,
  afterEach,
  afterAll,
  it,
  expect,
  vi,
} from "vitest";
import { readFile, readdir } from "node:fs/promises";
import { db } from "../src/lib/db";
import {
  createAccount,
  currentUser,
  login,
  sessionCookies,
} from "../src/lib/auth";
import {
  requestContext,
  type RequestState,
  type AppEnv,
} from "../src/server/context";
const url = process.env.TEST_DATABASE_URL;
if (!url || !new URL(url).pathname.endsWith("_test"))
  throw new Error("Dedicated test database required");
process.env.DATABASE_URL = url;
const sql = db();
let authId: string,
  mode = "ok";
let calls: { url: string; authorization: string | null; body: any }[] = [];
beforeAll(async () => {
  await sql`DROP SCHEMA public CASCADE`;
  await sql`CREATE SCHEMA public`;
  for (const file of (await readdir("migrations"))
    .filter((x) => x.endsWith(".sql"))
    .sort())
    await sql.unsafe(await readFile("migrations/" + file, "utf8"));
});
beforeEach(async () => {
  await sql`TRUNCATE users CASCADE`;
  calls = [];
  authId = crypto.randomUUID();
  mode = "ok";
  process.env.SUPABASE_URL = "http://127.0.0.1:55439";
  process.env.SUPABASE_ANON_KEY = "public-test-key";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "secret-test-key";
  vi.stubGlobal("fetch", async (input: any, init: RequestInit = {}) => {
    const url = String(input),
      headers = new Headers(init.headers),
      body = init.body ? JSON.parse(String(init.body)) : null;
    calls.push({ url, authorization: headers.get("authorization"), body });
    if (mode === "outage")
      return Response.json({ message: "unavailable" }, { status: 503 });
    if (url.includes("/admin/users"))
      return Response.json({
        id: authId,
        email: "admin@test.example",
        app_metadata: body.app_metadata,
        user_metadata: body.user_metadata,
        aud: "authenticated",
        created_at: new Date().toISOString(),
      });
    if (url.includes("/token"))
      return mode === "wrong"
        ? Response.json(
            {
              msg: "Invalid login credentials",
              error_code: "invalid_credentials",
            },
            { status: 400 },
          )
        : Response.json({
            access_token: "test-access-token",
            refresh_token: "test-refresh-token",
            expires_in: 3600,
            token_type: "bearer",
            user: {
              id: authId,
              email: "admin@test.example",
              aud: "authenticated",
            },
          });
    if (url.endsWith("/user"))
      return mode === "expired"
        ? Response.json({ msg: "JWT expired" }, { status: 401 })
        : Response.json({
            id: authId,
            email: "admin@test.example",
            app_metadata: { app_role: "admin" },
            aud: "authenticated",
          });
    return Response.json({});
  });
});
afterEach(() => vi.unstubAllGlobals());
afterAll(() => sql.end());
async function account() {
  return createAccount({
    name: "Admin",
    email: "admin@test.example",
    password: "Local-test-password-2026!",
    role: "admin",
  });
}
it("official SDK sends admin creation only with secret; public login never gets service role", async () => {
  const user = await account();
  expect(user.role).toBe("admin");
  expect(calls[0].authorization).toBe("Bearer secret-test-key");
  expect(calls[0].body.app_metadata.comsflow_provisioned).toBe(true);
  const signed = await login(user.email, "Local-test-password-2026!");
  expect(signed).toHaveProperty("token", "test-access-token");
  expect(calls.find((c) => c.url.includes("/token"))?.authorization).toBe(
    "Bearer public-test-key",
  );
  expect((await sql`SELECT password_hash FROM users`)[0].password_hash).toBe(
    "!supabase-auth",
  );
});
it("database role/active override stale provider role metadata", async () => {
  const user = await account();
  await sql`UPDATE users SET role='staff' WHERE id=${user.id}`;
  expect((await currentUser("test-access-token"))?.role).toBe("staff");
  await sql`UPDATE users SET active=false WHERE id=${user.id}`;
  expect(await currentUser("test-access-token")).toBeNull();
});
it("invalid credentials and provider outages are distinct, never local password fallback", async () => {
  await account();
  mode = "wrong";
  expect(await login("admin@test.example", "incorrect")).toEqual({
    error: true,
  });
  mode = "outage";
  await expect(currentUser("test-access-token")).rejects.toMatchObject({
    status: 503,
  });
});
it("expired access refreshes securely without exposing refresh tokens in response JSON", async () => {
  await account();
  mode = "expired";
  const state: RequestState = {
    env: process.env as unknown as AppEnv,
    cookies: [],
    pending: [],
    refreshToken: "old-refresh",
  };
  try {
    const user = await requestContext.run(state, () => currentUser("expired"));
    expect(user?.id).toBe(authId);
    expect(state.cookies).toHaveLength(2);
    expect(state.cookies.join(";")).toContain("HttpOnly");
    expect(
      calls.find((c) => c.url.includes("grant_type=refresh_token"))?.body
        .refresh_token,
    ).toBe("old-refresh");
  } finally {
    await state.sql?.end({ timeout: 5 });
  }
  const cookies = sessionCookies("access", "refresh");
  expect(cookies.join(";")).toContain("SameSite=strict");
});
it("profile trigger blocks self-signup escalation and links legacy UUID without changing role", async () => {
  const oldId = crypto.randomUUID(),
    providerId = crypto.randomUUID();
  await sql`INSERT INTO users(id,name,email,password_hash,role) VALUES(${oldId},'Legacy','legacy@test.example','unused','manager')`;
  await sql.begin(async (tx) => {
    await tx`CREATE TEMP TABLE auth_provider_fixture(id uuid,email text,raw_app_meta_data jsonb,raw_user_meta_data jsonb) ON COMMIT DROP`;
    await tx`CREATE TRIGGER profile_sync AFTER INSERT ON auth_provider_fixture FOR EACH ROW EXECUTE FUNCTION public.comsflow_auth_profile()`;
    await tx`INSERT INTO auth_provider_fixture VALUES(${providerId},'legacy@test.example','{"comsflow_provisioned":true,"app_role":"admin"}','{}')`;
    await tx`INSERT INTO auth_provider_fixture VALUES(${crypto.randomUUID()},'untrusted@test.example','{}','{"role":"admin","name":"Untrusted"}')`;
  });
  const [legacy] =
    await sql`SELECT id,role,auth_user_id FROM users WHERE email='legacy@test.example'`;
  expect(legacy).toMatchObject({
    id: oldId,
    role: "manager",
    auth_user_id: providerId,
  });
  const [untrusted] =
    await sql`SELECT role,active FROM users WHERE email='untrusted@test.example'`;
  expect(untrusted).toMatchObject({ role: "staff", active: false });
});
