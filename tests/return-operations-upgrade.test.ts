import { beforeAll, afterAll, it, expect } from "vitest";
import { readFile, readdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { db, type User } from "../src/lib/db";
import { requestContext, type AppEnv } from "../src/server/context";
import { returnOperationsStatus } from "../src/lib/return-operations-access";
import {
  returnOperationOverview,
  returnOperationList,
} from "../src/lib/return-operation-query";
if (
  !process.env.TEST_DATABASE_URL ||
  !new URL(process.env.TEST_DATABASE_URL).pathname.endsWith("_test")
)
  throw new Error("Dedicated *_test DB only");
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
const sql = db();
let actor: User, warehouse: string;
beforeAll(async () => {
  await sql`DROP SCHEMA public CASCADE`;
  await sql`CREATE SCHEMA public`;
  await sql`CREATE TABLE schema_migrations(name text PRIMARY KEY,checksum text NOT NULL,applied_at timestamptz DEFAULT now())`;
  for (const name of (await readdir("migrations"))
    .filter((n) => n.endsWith(".sql") && n < "020_")
    .sort()) {
    const source = await readFile("migrations/" + name, "utf8");
    await sql.unsafe(source);
    await sql`INSERT INTO schema_migrations(name,checksum) VALUES(${name},${createHash("sha256").update(source).digest("hex")})`;
  }
  actor = (
    await sql`INSERT INTO users(name,email,password_hash,role) VALUES('Legacy','legacy@upgrade.test','unused','admin') RETURNING id,name,email,role`
  )[0] as User;
  warehouse = (
    await sql`INSERT INTO warehouses(name) VALUES('Legacy') RETURNING id`
  )[0].id;
  const [channel] =
    await sql`INSERT INTO sales_channels(name) VALUES('TikTok Shop') RETURNING id`;
  const [shop] =
    await sql`INSERT INTO shops(name,channel_id) VALUES('Legacy',${channel.id}) RETURNING id`;
  const [imp] =
    await sql`INSERT INTO return_imports(file_hash,filename,shop_id,warehouse_id,rows_count,summary,created_by) VALUES('old-hash','old.csv',${shop.id},${warehouse},1,'{}',${actor.id}) RETURNING id`;
  const source = [
    {
      row: 2,
      request: "0000586890280579270204",
      order: "586890280579270204",
      sku: "SKU-1",
      sellerSku: "A-001",
      name: "Áo",
      variant: "Đỏ/L",
      quantity: 2,
      tracking: "862678510680",
      requested: "2026-10-21T01:00:00Z",
      status: "Returning to sender",
      substatus: "",
      type: "Return and refund",
      unitAmount: 10000,
      orderAmount: 20000,
      itemKey: "item-1",
      raw: {},
      meta: {
        orderedAt: "2026-10-20T01:00:00Z",
        refundAmount: 15000,
        refundTime: "2026-10-21T02:00:00Z",
      },
    },
  ];
  const [c] =
    await sql`INSERT INTO return_cases(external_id,order_code,shop_id,warehouse_id,platform_status,return_type,requested_at,source_hash,source_data,last_import_id) VALUES('0000586890280579270204','586890280579270204',${shop.id},${warehouse},'Returning to sender','Return and refund','2026-10-21T01:00:00Z','source-hash',${sql.json(source)},${imp.id}) RETURNING id`;
  await sql`INSERT INTO return_items(case_id,item_key,sku_id,seller_sku,name,expected_qty,received_qty,unit_amount) VALUES(${c.id},'item-1','SKU-1','A-001','Áo',2,2,10000)`;
  await sql`INSERT INTO return_parcels(case_id,tracking_code,received_at,received_by) VALUES(${c.id},'862678510680','2026-10-22T01:00:00Z',${actor.id})`;
  await sql`INSERT INTO return_events(actor_id,action,code,data,created_at) VALUES(${actor.id},'unknown','TTVN1120898402',${sql.json({ payload: { warehouseId: warehouse } })},'2026-10-21T02:00:00Z')`;
});
afterAll(() => sql.end());
it("020 chạy lại an toàn, giữ UUID/source/history/giờ nhận và khôi phục lượt trước nguồn; hoàn tiền không tạo thêm nhận hàng", async () => {
  const before = {
    cases:
      await sql`SELECT id,external_id,order_code,source_data,source_hash FROM return_cases`,
    parcels: await sql`SELECT * FROM return_parcels`,
    events: await sql`SELECT * FROM return_events`,
    items: await sql`SELECT id,case_id,received_qty FROM return_items`,
  };
  expect((await returnOperationsStatus()).ready).toBe(false);
  const reserved = await sql.reserve();
  try {
    const upgrade = await readFile("supabase/upgrade-020.sql", "utf8");
    await reserved.unsafe(upgrade);
    await reserved.unsafe(upgrade);
  } finally {
    await reserved.unsafe("ROLLBACK");
    reserved.release();
  }
  expect(
    await sql`SELECT id,external_id,order_code,source_data,source_hash FROM return_cases`,
  ).toEqual(before.cases);
  expect(
    (await sql`SELECT * FROM return_parcels`).map((p) =>
      Object.fromEntries(
        Object.entries(p).filter(([k]) => k !== "excluded_manually"),
      ),
    ),
  ).toEqual(before.parcels);
  expect(await sql`SELECT * FROM return_events`).toEqual(before.events);
  expect(await sql`SELECT id,case_id,received_qty FROM return_items`).toEqual(
    before.items,
  );
  const r = (await returnOperationList(actor, {})).rows[0];
  expect(r).toMatchObject({
    shipping_state: "returning",
    ordered_at: new Date("2026-10-20T01:00:00Z"),
    source_refund_amount: "15000",
    received_full: false,
  });
  const receipts =
    await sql`SELECT * FROM return_receipts ORDER BY tracking_code`;
  expect(receipts).toHaveLength(2);
  expect(
    receipts.find((r) => r.tracking_code === "TTVN1120898402"),
  ).toMatchObject({
    received_at: new Date("2026-10-21T02:00:00Z"),
    match_state: "unmatched",
    recorded_by: actor.id,
  });
  expect((await returnOperationOverview(actor, {})).totals).toMatchObject({
    total: 1,
    received: 1,
    refund_amount: "15000",
  });
});
it("quyền runtime giới hạn đọc/ghi đủ toàn luồng; lịch sử append-only và không cấp anon/authenticated", async () => {
  const rollback = new Error("local role rollback");
  try {
    await sql.begin(async (tx) => {
      if (
        (
          await tx`SELECT 1 FROM pg_roles WHERE rolname='comsflow_connection_check'`
        ).length
      )
        throw new Error("Refuse to alter existing role");
      await tx`CREATE ROLE comsflow_connection_check LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS`;
      // Grant script has a hard production-db guard. Test the exact permission body
      // in the disposable DB without weakening that guard in the shipped artifact.
      const script = await readFile(
        "scripts/sql/grant-hyperdrive-runtime.sql",
        "utf8",
      );
      const body = script
        .slice(script.indexOf("DO $permissions$"), script.indexOf("COMMIT;"))
        .replace("current_database() <> 'postgres'", "false");
      await tx.unsafe(body);
      await tx.unsafe(body);
      await tx`SET LOCAL ROLE comsflow_connection_check`;
      expect(await returnOperationsStatus(tx)).toEqual({
        ready: true,
        permissions: true,
      });
      await requestContext.run(
        {
          env: process.env as unknown as AppEnv,
          sql: new Proxy(tx, {
            get(target, key) {
              if (key === "begin")
                return (first: any, second?: any) =>
                  target.savepoint(
                    typeof first === "function" ? first : second,
                  );
              return Reflect.get(target, key);
            },
          }) as any,
          cookies: [],
          pending: [],
        },
        async () => {
          expect((await returnOperationOverview(actor, {})).totals.total).toBe(
            1,
          );
          expect((await returnOperationList(actor, {})).total).toBe(1);
        },
      );
      await expect(
        tx.savepoint((sp) => sp`DELETE FROM return_receipt_events`),
      ).rejects.toMatchObject({ code: "42501" });
      await expect(
        tx.savepoint(
          (sp) => sp`UPDATE return_source_versions SET rows_data='[]'`,
        ),
      ).rejects.toMatchObject({ code: "42501" });
      const [receipt] = await tx`SELECT * FROM return_receipts LIMIT 1`;
      await tx`UPDATE return_receipts SET note='Runtime smoke' WHERE id=${receipt.id}`;
      await tx`INSERT INTO return_receipt_events(receipt_id,actor_id,action) VALUES(${receipt.id},${actor.id},'runtime_smoke')`;
      await tx`SET LOCAL ROLE NONE`;
      expect(
        await tx`SELECT grantee FROM information_schema.role_table_grants WHERE table_schema='public' AND table_name LIKE 'return_%' AND grantee IN ('PUBLIC','anon','authenticated')`,
      ).toHaveLength(0);
      throw rollback;
    });
  } catch (e) {
    if (e !== rollback) throw e;
  }
  expect(
    await sql`SELECT 1 FROM pg_roles WHERE rolname='comsflow_connection_check'`,
  ).toHaveLength(0);
});
