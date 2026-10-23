import { beforeAll, beforeEach, afterAll, it, expect } from "vitest";
import { readFile, readdir } from "node:fs/promises";
import { db, type User } from "../src/lib/db";
import { setupCatalogs } from "../src/lib/catalog-setup";
import { carrierCatalog, identifyCarrier } from "../src/lib/carriers";
import { startOwnShift } from "../src/lib/shifts";
import { workerHealth } from "../src/lib/worker-health";
import { dispatch } from "../src/server/api";
import { AppRequest } from "../src/server/http";
const url = process.env.TEST_DATABASE_URL;
if (!url || !new URL(url).pathname.endsWith("_test"))
  throw new Error("Dedicated *_test database required");
process.env.DATABASE_URL = url;
const sql = db();
let admin: User, staff: User, manager: User;
beforeAll(async () => {
  await sql`DROP SCHEMA public CASCADE`;
  await sql`CREATE SCHEMA public`;
  for (const file of (await readdir("migrations"))
    .filter((f) => f.endsWith(".sql"))
    .sort())
    await sql.unsafe(await readFile("migrations/" + file, "utf8"));
});
beforeEach(async () => {
  await sql`TRUNCATE users,warehouses,sales_channels,shipping_carriers,system_settings,worker_heartbeats CASCADE`;
  const rows =
    await sql`INSERT INTO users(name,email,password_hash,role) VALUES('Admin','admin@local.test','unused','admin'),('Staff','staff@local.test','unused','staff'),('Manager','manager@local.test','unused','manager') RETURNING *`;
  [admin, staff, manager] = rows as unknown as User[];
});
afterAll(() => sql.end());
it("an empty install can initialize real catalogs and open a usable shift, safely on retries", async () => {
  const results = await Promise.all([
    setupCatalogs(admin),
    setupCatalogs(admin),
    setupCatalogs(admin),
  ]);
  expect(results.filter((r) => r.created.length)).toHaveLength(1);
  const [warehouse] = await sql`SELECT * FROM warehouses`;
  expect(warehouse.name).toBe("Kho ComsMiu");
  expect(await sql`SELECT * FROM sales_channels`).toHaveLength(2);
  expect(await sql`SELECT * FROM users`).toHaveLength(3);
  expect(await sql`SELECT * FROM shipments`).toHaveLength(0);
  const catalog = await carrierCatalog(sql);
  expect(identifyCarrier(catalog, "NOHINT", "J&T").carrier).toBe("J&T Express");
  const shifts = await Promise.all([
    startOwnShift(admin, warehouse.id),
    startOwnShift(admin, warehouse.id),
  ]);
  expect(shifts[0].id).toBe(shifts[1].id);
  expect(
    await sql`SELECT * FROM shift_members WHERE shift_id=${shifts[0].id} AND user_id=${admin.id}`,
  ).toHaveLength(1);
  expect(
    await sql`SELECT * FROM audit_logs WHERE action='catalog_setup'`,
  ).toHaveLength(1);
});
it("catalog setup respects existing warehouse IDs, names, aliases and cutoff settings", async () => {
  const [warehouse] =
    await sql`INSERT INTO warehouses(name) VALUES('Custom warehouse') RETURNING id`;
  const [carrier] =
    await sql`INSERT INTO shipping_carriers(name) VALUES('J&T') RETURNING id`;
  await sql`INSERT INTO system_settings(key,value) VALUES('cutoff_hour','20')`;
  await setupCatalogs(admin);
  expect(await sql`SELECT * FROM warehouses`).toHaveLength(1);
  expect((await sql`SELECT id FROM warehouses`)[0].id).toBe(warehouse.id);
  expect(
    (await sql`SELECT value FROM system_settings WHERE key='cutoff_hour'`)[0]
      .value,
  ).toBe(20);
  expect(
    identifyCarrier(await carrierCatalog(sql), "NOHINT", "J&T Express")
      .carrierId,
  ).toBe(carrier.id);
  expect(
    await sql`SELECT * FROM shipping_carriers WHERE name='J&T Express'`,
  ).toHaveLength(0);
});
it("only admins initialize catalogs and invalid warehouse selections cannot open shifts", async () => {
  await expect(setupCatalogs(staff)).rejects.toMatchObject({ status: 403 });
  await expect(setupCatalogs(manager)).rejects.toMatchObject({ status: 403 });
  await expect(startOwnShift(admin, "")).rejects.toThrow("Chọn kho hợp lệ");
  await expect(startOwnShift(admin, "not-a-uuid")).rejects.toThrow(
    "Chọn kho hợp lệ",
  );
  await expect(startOwnShift(admin, crypto.randomUUID())).rejects.toMatchObject(
    { status: 404 },
  );
  expect(await sql`SELECT * FROM work_shifts`).toHaveLength(0);
});
it("role-only and lock-only updates preserve the other field and require administrator rights", async () => {
  const req = (body: unknown) =>
    new AppRequest(
      new Request("http://localhost/api/users/update", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      }),
    );
  await dispatch(
    req({ id: staff.id, active: false, reason: "Lock fixture account" }),
    admin,
  );
  await dispatch(
    req({ id: staff.id, role: "manager", reason: "Promote fixture account" }),
    admin,
  );
  let [row] = await sql`SELECT role,active FROM users WHERE id=${staff.id}`;
  expect(row).toMatchObject({ role: "manager", active: false });
  await dispatch(
    req({ id: staff.id, active: true, reason: "Unlock fixture account" }),
    admin,
  );
  [row] = await sql`SELECT role,active FROM users WHERE id=${staff.id}`;
  expect(row).toMatchObject({ role: "manager", active: true });
  await expect(
    dispatch(
      req({ id: staff.id, role: "admin", reason: "Unauthorized fixture" }),
      manager,
    ),
  ).rejects.toMatchObject({ status: 403 });
  await expect(
    dispatch(
      req({ id: admin.id, role: "staff", reason: "Self change fixture" }),
      admin,
    ),
  ).rejects.toMatchObject({ status: 400 });
  expect(
    await sql`SELECT * FROM audit_logs WHERE action='user_update'`,
  ).toHaveLength(3);
});
it("worker readiness reports no heartbeat, recent heartbeat, and expired heartbeat correctly", async () => {
  expect((await workerHealth()).workerAvailable).toBe(false);
  await sql`INSERT INTO worker_heartbeats(id) VALUES('fixture')`;
  expect((await workerHealth()).workerAvailable).toBe(true);
  await sql`UPDATE worker_heartbeats SET seen_at=now()-interval '12 minutes'`;
  expect((await workerHealth()).workerAvailable).toBe(false);
});
it("the return scan station only loads the current user's small event history", async () => {
  await sql`INSERT INTO return_events(actor_id,action,code) VALUES(${staff.id},'unknown','STAFF-CODE'),(${admin.id},'unknown','ADMIN-CODE')`;
  const response = await dispatch(
    new AppRequest(new Request("http://localhost/api/returns/events/mine")),
    staff,
  );
  const body = await response.json();
  expect(body.events).toHaveLength(1);
  expect(body.events[0].code).toBe("STAFF-CODE");
  expect(body).not.toHaveProperty("totals");
});
