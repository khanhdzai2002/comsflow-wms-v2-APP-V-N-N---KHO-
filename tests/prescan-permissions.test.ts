import { beforeAll, afterAll, it, expect } from "vitest";
import { readFile, readdir } from "node:fs/promises";
import { db, type User } from "../src/lib/db";
import { dashboard, myScans } from "../src/lib/queries";
import { prescanAccess, reconcilePrescans } from "../src/lib/prescan";
import { requestContext, type AppEnv } from "../src/server/context";
import { todayVN } from "../src/lib/domain";
if (
  !process.env.TEST_DATABASE_URL ||
  !new URL(process.env.TEST_DATABASE_URL).pathname.endsWith("_test")
)
  throw new Error("Only disposable *_test database");
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
const sql = db();
beforeAll(async () => {
  await sql`DROP SCHEMA public CASCADE`;
  await sql`CREATE SCHEMA public`;
  for (const name of (await readdir("migrations"))
    .filter((n) => n.endsWith(".sql") && n < "019_")
    .sort())
    await sql.unsafe(await readFile("migrations/" + name, "utf8"));
});
afterAll(() => sql.end());
it("reproduces missing Hyperdrive grants and verifies SELECT/INSERT + RLS repair using the limited runtime role", async () => {
  // Transaction-scoped cluster role: always rolled back, never alters an existing
  // role. Dedicated local *_test DB only. Old runtime role cannot read new objects.
  const rollback = new Error("rollback test role");
  try {
    await sql.begin(async (tx) => {
      if (
        (
          await tx`SELECT 1 FROM pg_roles WHERE rolname='comsflow_connection_check'`
        ).length
      )
        throw new Error("Test role exists; refusing to alter it");
      await tx`CREATE ROLE comsflow_connection_check LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS`;
      await tx`GRANT USAGE ON SCHEMA public TO comsflow_connection_check`;
      for (const {
        tablename,
      } of await tx`SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename<>'scan_reconciliations'`) {
        await tx`GRANT SELECT,INSERT,UPDATE,DELETE ON ${tx(tablename)} TO comsflow_connection_check`;
        await tx`CREATE POLICY runtime_fixture ON ${tx(tablename)} TO comsflow_connection_check USING (true) WITH CHECK (true)`;
      }
      const [admin] =
        await tx`INSERT INTO users(name,email,password_hash,role) VALUES('Admin','permissions@local.test','unused','admin') RETURNING id,name,email,role`;
      const [w] =
        await tx`INSERT INTO warehouses(name) VALUES('Test') RETURNING id`;
      const [c] =
        await tx`INSERT INTO shipping_carriers(name) VALUES('SPX Express') ON CONFLICT(name) DO UPDATE SET name=excluded.name RETURNING id`;
      const [channel] =
        await tx`INSERT INTO sales_channels(name) VALUES('Shopee') ON CONFLICT(name) DO UPDATE SET name=excluded.name RETURNING id`;
      const [shop] =
        await tx`INSERT INTO shops(name,channel_id) VALUES('Test',${channel.id}) RETURNING id`;
      const [order] =
        await tx`INSERT INTO orders(external_id,channel_id,shop_id) VALUES('TEST-ORDER',${channel.id},${shop.id}) RETURNING id`;
      const [shift] =
        await tx`INSERT INTO work_shifts(name,warehouse_id,starts_at,ends_at) VALUES('Test',${w.id},now()-interval '1 hour',now()+interval '1 hour') RETURNING id`;
      await tx`INSERT INTO shift_members(shift_id,user_id) VALUES(${shift.id},${admin.id})`;
      await tx`INSERT INTO shipments(tracking_code,order_id,carrier_id,warehouse_id,due_date) VALUES('SPXVN00000000001A',${order.id},${c.id},${w.id},${todayVN()})`;
      await tx`INSERT INTO scan_events(request_id,raw_code,outcome,user_id,shift_id,warehouse_id,method) VALUES(gen_random_uuid(),'SPXVN00000000001A','unknown',${admin.id},${shift.id},${w.id},'hid')`;
      const old = await tx`SELECT * FROM scan_events`;
      await tx`SET LOCAL ROLE comsflow_connection_check`;
      expect(await prescanAccess(tx)).toEqual({
        schemaReady: true,
        canRead: false,
        canWrite: false,
      });
      expect(await tx`SELECT * FROM scan_events`).toHaveLength(1); // Old grants work.
      await expect(
        tx.savepoint((sp) => sp`SELECT * FROM effective_scan_events`),
      ).rejects.toMatchObject({ code: "42501" });
      await expect(
        requestContext.run(
          {
            env: process.env as unknown as AppEnv,
            sql: tx as any,
            cookies: [],
            pending: [],
          },
          () => dashboard(admin as User, {}),
        ),
      ).rejects.toMatchObject({
        status: 503,
        message: expect.stringContaining("thiếu quyền"),
      });
      await tx`SET LOCAL ROLE NONE`;
      const repair = await readFile(
        "migrations/019_prescan_runtime_permissions.sql",
        "utf8",
      );
      await tx.unsafe(repair);
      await tx.unsafe(repair); // Idempotent permissions repair.
      await tx`SET LOCAL ROLE comsflow_connection_check`;
      expect(await prescanAccess(tx)).toEqual({
        schemaReady: true,
        canRead: true,
        canWrite: true,
      });
      expect(await tx`SELECT * FROM scan_reconciliations`).toHaveLength(0);
      expect(
        await reconcilePrescans(tx, admin as User, ["SPXVN00000000001A"]),
      ).toEqual({ matched: 1, duplicates: 0 });
      expect(
        (await tx`SELECT outcome FROM effective_scan_events`)[0].outcome,
      ).toBe("success");
      await requestContext.run(
        {
          env: process.env as unknown as AppEnv,
          sql: tx as any,
          cookies: [],
          pending: [],
        },
        async () => {
          expect(await dashboard(admin as User, {})).toMatchObject({
            total: 1,
            scanned: 1,
            unknown: 0,
          });
          expect(
            (await myScans(admin as User, shift.id)).summary,
          ).toMatchObject({ success: 1, pending: 0, error: 0 });
        },
      );
      expect(await tx`SELECT * FROM scan_events`).toEqual(old);
      expect(
        (
          await tx`SELECT has_table_privilege('scan_reconciliations','UPDATE') u,has_table_privilege('scan_reconciliations','DELETE') d`
        )[0],
      ).toEqual({ u: false, d: false });
      await expect(
        tx.savepoint((sp) => sp`DELETE FROM scan_reconciliations`),
      ).rejects.toMatchObject({ code: "42501" });
      await tx`SET LOCAL ROLE NONE`;
      const grants =
        await tx`SELECT grantee FROM information_schema.role_table_grants WHERE table_schema='public' AND table_name IN ('scan_reconciliations','effective_scan_events') AND grantee IN ('PUBLIC','anon','authenticated')`;
      expect(grants).toHaveLength(0);
      expect(
        (
          await tx`SELECT rolsuper,rolbypassrls FROM pg_roles WHERE rolname='comsflow_connection_check'`
        )[0],
      ).toEqual({ rolsuper: false, rolbypassrls: false });
      throw rollback;
    });
  } catch (error) {
    if (error !== rollback) throw error;
  }
  expect(
    await sql`SELECT 1 FROM pg_roles WHERE rolname='comsflow_connection_check'`,
  ).toHaveLength(0);
});
