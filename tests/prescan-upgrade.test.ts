import { beforeAll, afterAll, it, expect } from "vitest";
import { readFile, readdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { db, type User } from "../src/lib/db";
import { myScans, dashboard } from "../src/lib/queries";
import { prescanReady } from "../src/lib/prescan";
import { importRows } from "../src/lib/imports";
import { todayVN } from "../src/lib/domain";
if (
  !process.env.TEST_DATABASE_URL ||
  !new URL(process.env.TEST_DATABASE_URL).pathname.endsWith("_test")
)
  throw new Error("Only disposable *_test database");
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
const sql = db();
let admin: User, shift: string, warehouse: string;
beforeAll(async () => {
  await sql`DROP SCHEMA public CASCADE`;
  await sql`CREATE SCHEMA public`;
  await sql`CREATE TABLE schema_migrations(name text PRIMARY KEY,checksum text NOT NULL,applied_at timestamptz DEFAULT now())`;
  for (const name of (await readdir("migrations"))
    .filter((n) => n.endsWith(".sql") && n < "018_")
    .sort()) {
    const source = await readFile("migrations/" + name, "utf8");
    await sql.unsafe(source);
    await sql`INSERT INTO schema_migrations(name,checksum) VALUES(${name},${createHash("sha256").update(source).digest("hex")})`;
  }
  admin = (
    await sql`INSERT INTO users(name,email,password_hash,role) VALUES('Admin','admin@upgrade.test','unused','admin') RETURNING id,name,email,role`
  )[0] as User;
  warehouse = (
    await sql`INSERT INTO warehouses(name) VALUES('Upgrade test') RETURNING id`
  )[0].id;
  shift = (
    await sql`INSERT INTO work_shifts(name,warehouse_id,starts_at,ends_at) VALUES('Old shift',${warehouse},'2020-01-01T00:00:00Z','2020-01-02T00:00:00Z') RETURNING id`
  )[0].id;
  // Legacy immutable record, as written by the old version before source import existed.
  await sql`INSERT INTO scan_events(request_id,raw_code,outcome,user_id,shift_id,warehouse_id,method,created_at,response)
    VALUES(gen_random_uuid(),'UPGRADE0001','unknown',${admin.id},${shift},${warehouse},'hid','2020-01-01T01:02:03Z','{}')`;
});
afterAll(() => sql.end());
it("nâng cấp từ 17 migration giữ lịch sử, chạy lại được và khớp mã cũ vào đúng ngày quét", async () => {
  const old = await sql`SELECT * FROM scan_events`;
  expect(await prescanReady(sql)).toBe(false);
  expect((await myScans(admin, shift)).summary).toMatchObject({
    success: 0,
    pending: 1,
    error: 0,
  });
  const data = {
    tracking_code: "UPGRADE0001",
    order_id: "UPGRADE-ORDER",
    channel: "Shopee",
    shop: "Upgrade test",
    carrier: "SPX Express",
    warehouse: "Upgrade test",
    due_date: todayVN(),
    status: "awaiting_scan",
    sku: "TEST",
    product_name: "Test",
    color: "",
    size: "",
    quantity: "1",
  };
  await expect(importRows(admin, "test.csv", [data], {})).rejects.toThrow(
    /nâng cấp 018/,
  );
  const upgrade = await readFile("supabase/upgrade-018.sql", "utf8");
  const reserved = await sql.reserve();
  try {
    await reserved.unsafe(upgrade);
    await reserved.unsafe(upgrade);
  } finally {
    await reserved.unsafe("ROLLBACK");
    reserved.release();
  }
  expect(await prescanReady(sql)).toBe(true);
  expect((await sql`SELECT count(*)::int n FROM schema_migrations`)[0].n).toBe(
    19,
  );
  expect(await sql`SELECT * FROM scan_events`).toEqual(old);
  expect(await sql`SELECT * FROM scan_reconciliations`).toHaveLength(0);
  expect(await importRows(admin, "test.csv", [data], {})).toMatchObject({
    reconciledScans: 1,
    imported: 1,
  });
  expect(
    (await sql`SELECT scanned_at,scanned_by,shift_id FROM shipments`)[0],
  ).toMatchObject({
    scanned_at: old[0].created_at,
    scanned_by: admin.id,
    shift_id: shift,
  });
  const d = await dashboard(admin, { from: "2020-01-01", to: todayVN() });
  expect(
    d.days.find((r: { name: string }) => r.name === "2020-01-01").scanned,
  ).toBe(1);
  expect(
    d.days.find((r: { name: string }) => r.name === todayVN()).scanned,
  ).toBe(0);
  expect(await sql`SELECT * FROM scan_events`).toEqual(old);
});
