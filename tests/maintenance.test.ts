import { beforeAll, beforeEach, afterAll, describe, it, expect } from "vitest";
import { readFile, readdir } from "node:fs/promises";
import { db, type User } from "../src/lib/db";
import {
  previewCleanup,
  executeCleanup,
  cleanupExport,
  storageInfo,
  optimizeStorage,
} from "../src/lib/maintenance";
import {
  CLEANUP_CONFIRMATION,
  CLEANUP_BATCH_LIMIT,
} from "../src/lib/maintenance-domain";
import { scan } from "../src/lib/scan";
import {
  receiveReturn,
  commitReturns,
  previewReturns,
} from "../src/lib/returns";
import { parseReturnFile } from "../src/lib/return-import";
import { returnRow, returnCsv } from "./return-fixture";
const url = process.env.TEST_DATABASE_URL;
if (!url || !new URL(url).pathname.endsWith("_test"))
  throw new Error("TEST_DATABASE_URL phải trỏ database riêng *_test");
process.env.DATABASE_URL = url;
const sql = db();
let admin: User,
  manager: User,
  staff: User,
  secondAdmin: User,
  warehouse: string,
  otherWarehouse: string,
  shift: string,
  shop: string,
  carrier: string;
const old = "2020-01-01T00:00:00Z";
beforeAll(async () => {
  await sql`DROP SCHEMA public CASCADE`;
  await sql`CREATE SCHEMA public`;
  for (const f of (await readdir("migrations"))
    .filter((f) => f.endsWith(".sql"))
    .sort())
    await sql.unsafe(await readFile("migrations/" + f, "utf8"));
});
beforeEach(async () => {
  await sql`TRUNCATE users,warehouses,sales_channels,shipping_carriers,system_settings CASCADE`;
  const users =
    await sql`INSERT INTO users(name,email,password_hash,role) VALUES('Admin','a@test.example','unused','admin'),('Admin 2','b@test.example','unused','admin'),('Manager','m@test.example','unused','manager'),('Staff','s@test.example','unused','staff') RETURNING id,name,email,role`;
  admin = users.find((u) => u.name === "Admin") as User;
  secondAdmin = users.find((u) => u.name === "Admin 2") as User;
  manager = users.find((u) => u.role === "manager") as User;
  staff = users.find((u) => u.role === "staff") as User;
  const ws =
    await sql`INSERT INTO warehouses(name) VALUES('A'),('B') RETURNING id`;
  warehouse = ws[0].id;
  otherWarehouse = ws[1].id;
  const [s] =
    await sql`INSERT INTO work_shifts(name,warehouse_id,starts_at,ends_at) VALUES('shift',${warehouse},now()-interval '1 hour',now()+interval '1 hour') RETURNING id`;
  shift = s.id;
  await sql`INSERT INTO shift_members(shift_id,user_id) VALUES(${shift},${admin.id}),(${shift},${staff.id})`;
  const [c] =
    await sql`INSERT INTO sales_channels(name) VALUES('TikTok Shop') RETURNING id`;
  const [sh] =
    await sql`INSERT INTO shops(name,channel_id) VALUES('Test',${c.id}) RETURNING id`;
  shop = sh.id;
  const [ca] =
    await sql`INSERT INTO shipping_carriers(name) VALUES('J&T Express') RETURNING id`;
  carrier = ca.id;
});
afterAll(async () => {
  await sql.end();
});
const scope = (kind: "scans" | "returns" = "scans", extra = {}) => ({
  kind,
  before: "2021-01-01",
  warehouse,
  ...extra,
});
const confirm = (id: string) => ({
  jobId: id,
  confirmation: CLEANUP_CONFIRMATION,
  acknowledge: true,
  reason: "Dọn dữ liệu kiểm thử cũ",
});
async function oldScan(
  extra: { warehouse?: string; at?: string; shipment?: string } = {},
) {
  const [e] =
    await sql`INSERT INTO scan_events(request_id,shipment_id,raw_code,outcome,user_id,shift_id,warehouse_id,method,created_at,response)
    VALUES(${crypto.randomUUID()},${extra.shipment ?? null},'TEST-CODE',${extra.shipment ? "success" : "invalid"},${admin.id},${shift},${extra.warehouse ?? warehouse},'manual',${extra.at ?? old},${sql.json({ payload: "x".repeat(10240) })}) RETURNING *`;
  return e;
}
async function shipment(status = "handed_over") {
  const [o] =
    await sql`INSERT INTO orders(external_id,channel_id,shop_id) SELECT ${crypto.randomUUID()},channel_id,id FROM shops WHERE id=${shop} RETURNING id`;
  const [s] =
    await sql`INSERT INTO shipments(tracking_code,order_id,carrier_id,warehouse_id,due_date,status,scanned_at,scanned_by,shift_id,handed_at,handed_by,created_at,updated_at)
    VALUES(${crypto.randomUUID().toUpperCase()},${o.id},${carrier},${warehouse},'2020-01-01',${status},${old},${admin.id},${shift},${status === "handed_over" ? old : null},${status === "handed_over" ? admin.id : null},${old},${old}) RETURNING *`;
  return s;
}
async function oldReturns() {
  const file = await parseReturnFile(
    returnCsv([
      returnRow({ "Time Requested": "01/01/2020 07:00:00" }),
      returnRow({
        "Return Order ID": "1234567890123456790",
        "Order ID": "586000000000000002",
        "Time Requested": "01/01/2020 07:00:00",
      }),
    ]),
    "old.csv",
  );
  const [batch] =
    await sql`INSERT INTO return_imports(file_hash,filename,shop_id,warehouse_id,rows_count,summary,created_by,created_at) VALUES(${file.hash},'old.csv',${shop},${warehouse},2,${sql.json(file.summary)},${admin.id},${old}) RETURNING id`;
  const cases = [];
  for (let i = 0; i < 2; i++) {
    const r = file.rows[i];
    const [c] =
      await sql`INSERT INTO return_cases(shop_id,warehouse_id,external_id,order_code,requested_at,platform_status,return_type,source_data,source_hash,last_import_id,processing_status,no_physical_return,created_at,updated_at)
      VALUES(${shop},${warehouse},${r.request},${r.order},${old},'Completed','return',${sql.json([r])},${file.hash},${batch.id},${i === 0 ? "completed" : "pending"},true,${old},${old}) RETURNING *`;
    await sql`INSERT INTO return_items(case_id,item_key,sku_id,name,expected_qty) VALUES(${c.id},${r.itemKey},${r.sku},'Test product',1)`;
    const [p] =
      await sql`INSERT INTO return_parcels(case_id,tracking_code) VALUES(${c.id},${r.tracking + String(i)}) RETURNING id`;
    const requestId = crypto.randomUUID();
    await sql`INSERT INTO return_events(case_id,parcel_id,request_id,actor_id,action,code,created_at) VALUES(${c.id},${p.id},${requestId},${admin.id},'received','TEST-CODE',${old})`;
    await sql`INSERT INTO return_snapshots(import_id,row_number,case_id,raw) VALUES(${batch.id},${i + 2},${c.id},${sql.json(r.raw)})`;
    cases.push({ id: c.id as string, requestId });
  }
  await sql`INSERT INTO return_evidence(case_id,filename,mime,bytes,created_by,created_at) VALUES(${cases[0].id},'old.pdf','application/pdf',${Buffer.alloc(256 * 1024, 1)},${admin.id},${old})`;
  return { file, batch, cases };
}

describe("Dọn dữ liệu theo ngày, không xoá dữ liệu đang xử lý", () => {
  it("phân quyền cả dịch vụ xem trước/xoá/xuất/tối ưu và chủ sở hữu bản xem trước", async () => {
    await oldScan();
    const p = await previewCleanup(admin, scope());
    for (const user of [staff, manager]) {
      await expect(previewCleanup(user, scope())).rejects.toMatchObject({
        status: 403,
      });
      await expect(executeCleanup(user, confirm(p.id))).rejects.toMatchObject({
        status: 403,
      });
      await expect(cleanupExport(user, p.id)).rejects.toMatchObject({
        status: 403,
      });
      await expect(storageInfo(user)).rejects.toMatchObject({ status: 403 });
      await expect(optimizeStorage(user)).rejects.toMatchObject({
        status: 403,
      });
    }
    await expect(
      executeCleanup(secondAdmin, confirm(p.id)),
    ).rejects.toMatchObject({ status: 403 });
    await expect(cleanupExport(secondAdmin, p.id)).rejects.toMatchObject({
      status: 403,
    });
    await expect(
      previewCleanup(admin, scope("scans", { before: "2999-01-01" })),
    ).rejects.toMatchObject({ status: 400 });
    // A previously authenticated admin may have lost access after preview.
    await sql`UPDATE users SET active=false WHERE id=${admin.id}`;
    await expect(executeCleanup(admin, confirm(p.id))).rejects.toMatchObject({
      status: 403,
    });
    await sql`UPDATE users SET active=true,role='manager' WHERE id=${admin.id}`;
    await expect(executeCleanup(admin, confirm(p.id))).rejects.toMatchObject({
      status: 403,
    });
    expect(await sql`SELECT id FROM scan_events`).toHaveLength(1);
    expect(
      await sql`SELECT id FROM audit_logs WHERE action='data_cleanup'`,
    ).toHaveLength(0);
  });
  it("ranh giới nửa đêm Việt Nam, lọc kho, xuất danh sách trước xoá không tự làm mất dữ liệu", async () => {
    const included = await oldScan({ at: "2020-12-31T16:59:59.999Z" });
    await oldScan({ at: "2020-12-31T17:00:00Z" });
    await oldScan({ warehouse: otherWarehouse });
    const p = await previewCleanup(admin, scope());
    expect(p.summary.selected).toBe(1);
    expect(p.rows[0].id).toBe(included.id);
    expect(await cleanupExport(admin, p.id)).toHaveLength(1);
    expect(await sql`SELECT * FROM scan_events`).toHaveLength(3);
    await expect(
      executeCleanup(admin, { ...confirm(p.id), confirmation: "WRONG" }),
    ).rejects.toThrow();
    await expect(
      executeCleanup(admin, { ...confirm(p.id), acknowledge: false }),
    ).rejects.toThrow();
    await expect(
      executeCleanup(admin, { ...confirm(p.id), reason: "short" }),
    ).rejects.toThrow();
    const r = await executeCleanup(admin, confirm(p.id));
    expect(r.deleted).toBe(1);
    expect(await sql`SELECT * FROM scan_events`).toHaveLength(2);
  });
  it("giữ nhật ký đơn chưa bàn giao, ngoại lệ mở và hồ sơ mới có hoạt động", async () => {
    const waiting = await shipment("scanned"),
      handed = await shipment();
    await oldScan({ shipment: waiting.id });
    const good = await oldScan({ shipment: handed.id });
    const unresolved = await oldScan();
    await sql`INSERT INTO exception_cases(scan_event_id,kind,created_at) VALUES(${unresolved.id},'unknown',${old})`;
    const p = await previewCleanup(admin, scope());
    expect(p.summary.selected).toBe(1);
    expect(p.summary.protected).toBe(2);
    const initial = JSON.stringify(handed);
    await executeCleanup(admin, confirm(p.id));
    expect(
      await sql`SELECT * FROM scan_events WHERE id=${good.id}`,
    ).toHaveLength(0);
    expect(await sql`SELECT * FROM exception_cases`).toHaveLength(1);
    expect(
      JSON.stringify(
        (await sql`SELECT * FROM shipments WHERE id=${handed.id}`)[0],
      ),
    ).toBe(initial);
  });
  it("xoá ngoại lệ đã giải quyết kèm lượt quét, giữ kết quả vận đơn và chặn retry cũ", async () => {
    const s = await shipment();
    const e = await oldScan({ shipment: s.id });
    await sql`INSERT INTO exception_cases(scan_event_id,shipment_id,kind,status,created_at,resolved_at) VALUES(${e.id},${s.id},'blocked','resolved',${old},${old})`;
    const p = await previewCleanup(admin, scope());
    expect(p.summary.counts).toMatchObject({ scans: 1, exceptions: 1 });
    await executeCleanup(admin, confirm(p.id));
    expect(await sql`SELECT * FROM exception_cases`).toHaveLength(0);
    expect(
      (
        await sql`SELECT scanned_at,handed_at,status FROM shipments WHERE id=${s.id}`
      )[0],
    ).toMatchObject({ status: "handed_over" });
    await expect(
      scan(admin, {
        code: "TEST-CODE",
        requestId: e.request_id,
        shiftId: shift,
        warehouseId: warehouse,
        method: "manual",
      }),
    ).rejects.toMatchObject({ status: 410 });
    const duplicate = await scan(admin, {
      code: s.tracking_code,
      requestId: crypto.randomUUID(),
      shiftId: shift,
      warehouseId: warehouse,
      method: "manual",
    });
    expect(duplicate.outcome).toBe("duplicate");
  });
  it("dọn trọn hồ sơ hoàn và ảnh/PDF, giữ hồ sơ đang xử lý cùng file, chặn nhập lại file đã dọn", async () => {
    const { file, batch, cases } = await oldReturns();
    const p = await previewCleanup(admin, scope("returns"));
    expect(p.summary.selected).toBe(1);
    expect(p.summary.protected).toBe(1);
    expect(p.summary.evidenceBytes).toBe(256 * 1024);
    expect(p.summary.counts).toMatchObject({
      cases: 1,
      snapshots: 1,
      evidence: 1,
    });
    const result = await executeCleanup(admin, confirm(p.id));
    expect(result.deleted).toBe(1);
    for (const table of [
      "return_items",
      "return_parcels",
      "return_events",
      "return_snapshots",
      "return_evidence",
      "return_claims",
    ])
      expect(
        await sql`SELECT * FROM ${sql(table)} WHERE case_id=${cases[0].id}`,
      ).toHaveLength(0);
    expect(
      await sql`SELECT * FROM return_cases WHERE id=${cases[1].id}`,
    ).toHaveLength(1);
    expect(
      await sql`SELECT * FROM return_snapshots WHERE case_id=${cases[1].id}`,
    ).toHaveLength(1);
    expect(
      (
        await sql`SELECT * FROM return_import_purges WHERE import_id=${batch.id}`
      )[0].purged_rows,
    ).toBe(1);
    expect(
      await sql`SELECT * FROM return_imports WHERE id=${batch.id}`,
    ).toHaveLength(1);
    const c = { warehouseId: warehouse, shop: "Test" };
    expect((await previewReturns(admin, file, c)).canCommit).toBe(false);
    await expect(
      commitReturns(admin, file, "old.csv", c),
    ).rejects.toMatchObject({ status: 409 });
    const newFile = await parseReturnFile(
      returnCsv(
        file.rows.map((r) => ({
          ...r.raw,
          "Buyer Note": "A new platform export",
        })),
      ),
      "new.csv",
    );
    expect(newFile.hash).not.toBe(file.hash);
    const preview = await previewReturns(admin, newFile, c);
    expect(preview.canCommit).toBe(false);
    expect(
      preview.conflicts.some((r) => r.request === file.rows[0].request),
    ).toBe(true);
    await expect(
      commitReturns(admin, newFile, "new.csv", c),
    ).rejects.toMatchObject({ status: 409 });
    await expect(
      receiveReturn(admin, {
        code: "TEST-CODE",
        requestId: cases[0].requestId,
        shiftId: shift,
        warehouseId: warehouse,
        method: "manual",
      }),
    ).rejects.toMatchObject({ status: 410 });
    expect((await storageInfo(admin)).evidence_bytes).toBe(0);
  });
  it("không dọn hồ sơ có khiếu nại mở, nguồn cần kiểm lại hoặc hoạt động nhận hàng mới", async () => {
    const { cases } = await oldReturns();
    await sql`INSERT INTO return_claims(case_id,reason,created_by,updated_at) VALUES(${cases[0].id},'Unresolved',${admin.id},${old})`;
    expect(
      (await previewCleanup(admin, scope("returns"))).summary.selected,
    ).toBe(0);
    await sql`UPDATE return_claims SET status='closed' WHERE case_id=${cases[0].id}`;
    await sql`UPDATE return_cases SET inspection_stale=true WHERE id=${cases[0].id}`;
    expect(
      (await previewCleanup(admin, scope("returns"))).summary.selected,
    ).toBe(0);
    await sql`UPDATE return_cases SET inspection_stale=false WHERE id=${cases[0].id}`;
    await sql`INSERT INTO return_events(case_id,actor_id,action) VALUES(${cases[0].id},${admin.id},'update')`;
    expect(
      (await previewCleanup(admin, scope("returns"))).summary.selected,
    ).toBe(0);
  });
  it("bản xem trước cũ/hết hạn không xoá; thay đổi dữ liệu con cũng được phát hiện", async () => {
    const { cases } = await oldReturns();
    const p = await previewCleanup(admin, scope("returns"));
    await sql`UPDATE return_items SET name='Updated by employee' WHERE case_id=${cases[0].id}`;
    await expect(executeCleanup(admin, confirm(p.id))).rejects.toMatchObject({
      status: 409,
    });
    expect(await sql`SELECT * FROM return_cases`).toHaveLength(2);
    const fresh = await previewCleanup(admin, scope("returns"));
    await sql`UPDATE maintenance_jobs SET expires_at=now()-interval '1 second' WHERE id=${fresh.id}`;
    await expect(
      executeCleanup(admin, confirm(fresh.id)),
    ).rejects.toMatchObject({ status: 410 });
  });
  it("hai thiết bị xác nhận cùng lần dọn chỉ xoá và audit một lần", async () => {
    await oldScan();
    const p = await previewCleanup(admin, scope());
    const results = await Promise.all([
      executeCleanup(admin, confirm(p.id)),
      executeCleanup(admin, confirm(p.id)),
    ]);
    expect(results.map((x) => x.reused).sort()).toEqual([false, true]);
    expect(
      await sql`SELECT * FROM audit_logs WHERE action='data_cleanup'`,
    ).toHaveLength(1);
    expect(
      (
        await sql`SELECT targets,state FROM maintenance_jobs WHERE id=${p.id}`
      )[0],
    ).toMatchObject({ targets: [], state: "completed" });
  });
  it("hai bản xem trước trùng nhau không xoá thêm sau lần đầu", async () => {
    await oldScan();
    const a = await previewCleanup(admin, scope()),
      b = await previewCleanup(admin, scope());
    await executeCleanup(admin, confirm(a.id));
    await expect(executeCleanup(admin, confirm(b.id))).rejects.toMatchObject({
      status: 409,
    });
  });
  it("lỗi ở cuối giao dịch rollback cả tệp đính kèm, dấu chống trùng và nhật ký xoá", async () => {
    const { cases } = await oldReturns();
    const p = await previewCleanup(admin, scope("returns"));
    await sql.unsafe(
      "CREATE FUNCTION test_fail_cleanup() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'fixture rollback'; END $$; CREATE TRIGGER test_fail_cleanup BEFORE DELETE ON return_cases FOR EACH ROW EXECUTE FUNCTION test_fail_cleanup()",
    );
    try {
      await expect(executeCleanup(admin, confirm(p.id))).rejects.toThrow(
        "fixture rollback",
      );
    } finally {
      await sql.unsafe(
        "DROP TRIGGER test_fail_cleanup ON return_cases; DROP FUNCTION test_fail_cleanup()",
      );
    }
    expect(
      await sql`SELECT * FROM return_evidence WHERE case_id=${cases[0].id}`,
    ).toHaveLength(1);
    expect(
      await sql`SELECT * FROM return_events WHERE case_id=${cases[0].id}`,
    ).toHaveLength(1);
    expect(await sql`SELECT * FROM retired_requests`).toHaveLength(0);
    expect(await sql`SELECT * FROM return_import_purges`).toHaveLength(0);
    expect(await sql`SELECT * FROM retired_return_cases`).toHaveLength(0);
    expect(
      await sql`SELECT * FROM audit_logs WHERE action='data_cleanup'`,
    ).toHaveLength(0);
    expect(
      (await sql`SELECT state FROM maintenance_jobs WHERE id=${p.id}`)[0].state,
    ).toBe("preview");
  });
  it("trigger vẫn cấm cập nhật/xoá tuỳ tiện; GUC giả không mở quyền và audit bất biến", async () => {
    const e = await oldScan();
    const p = await previewCleanup(admin, scope());
    await expect(
      sql`UPDATE scan_events SET raw_code='changed' WHERE id=${e.id}`,
    ).rejects.toThrow(/append-only/);
    await expect(sql`DELETE FROM scan_events WHERE id=${e.id}`).rejects.toThrow(
      /append-only/,
    );
    await expect(
      sql.begin(async (tx) => {
        await tx`SELECT set_config('comsflow.cleanup_job',${p.id},true)`;
        await tx`DELETE FROM scan_events WHERE id=${e.id}`;
      }),
    ).rejects.toThrow(/append-only/);
    await executeCleanup(admin, confirm(p.id));
    await expect(sql`DELETE FROM audit_logs`).rejects.toThrow(/append-only/);
    const protectedTables =
      await sql`SELECT relname FROM pg_class WHERE relrowsecurity AND relname IN ('maintenance_jobs','retired_requests','return_import_purges','retired_return_cases')`;
    expect(protectedTables).toHaveLength(4);
  });
  it("chia đợt tối đa 500 bản ghi và dọn tiếp không bỏ sót", async () => {
    await sql`INSERT INTO scan_events(request_id,raw_code,outcome,user_id,shift_id,warehouse_id,method,created_at)
      SELECT gen_random_uuid(),'TEST-'||n,'invalid',${admin.id},${shift},${warehouse},'manual',${old} FROM generate_series(1,${CLEANUP_BATCH_LIMIT + 1}) n`;
    const p = await previewCleanup(admin, scope());
    expect(p.summary.selected).toBe(CLEANUP_BATCH_LIMIT);
    expect(p.summary.hasMore).toBe(true);
    await executeCleanup(admin, confirm(p.id));
    const next = await previewCleanup(admin, scope());
    expect(next.summary.selected).toBe(1);
    expect(next.summary.hasMore).toBe(false);
    await executeCleanup(admin, confirm(next.id));
    expect(await sql`SELECT * FROM scan_events`).toHaveLength(0);
  });
  it("chỉ xoá IDs đã xem trước; ngữ cảnh chạy hợp lệ không mở quyền với bản ghi khác hay UPDATE", async () => {
    const selected = await oldScan();
    const p = await previewCleanup(admin, scope());
    const later = await oldScan();
    for (const action of ["deleteOther", "updateSelected"]) {
      await expect(
        sql.begin(async (tx) => {
          await tx`UPDATE maintenance_jobs SET state='running',executing_xid=txid_current() WHERE id=${p.id}`;
          await tx`SELECT set_config('comsflow.cleanup_job',${p.id},true)`;
          if (action === "deleteOther")
            await tx`DELETE FROM scan_events WHERE id=${later.id}`;
          else
            await tx`UPDATE scan_events SET raw_code='changed' WHERE id=${selected.id}`;
        }),
      ).rejects.toThrow(/append-only/);
    }
    await executeCleanup(admin, confirm(p.id));
    expect(await sql`SELECT id FROM scan_events`).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: later.id })]),
    );
    expect(
      await sql`SELECT id FROM scan_events WHERE id=${selected.id}`,
    ).toHaveLength(0);
  });
  it("nguồn vừa được nhập lại bảo vệ hồ sơ dù ngày yêu cầu và updated_at vẫn cũ", async () => {
    const { cases } = await oldReturns();
    const [batch] =
      await sql`INSERT INTO return_imports(file_hash,filename,shop_id,warehouse_id,rows_count,summary,created_by) VALUES('new-file','new.csv',${shop},${warehouse},0,'{}',${admin.id}) RETURNING id`;
    await sql`UPDATE return_cases SET last_import_id=${batch.id} WHERE id=${cases[0].id}`;
    expect(
      (await previewCleanup(admin, scope("returns"))).summary.selected,
    ).toBe(0);
  });
  it("liên kết sự kiện/kiện chéo hồ sơ được giữ để kiểm tra, không xoá dữ liệu hồ sơ khác", async () => {
    const { cases } = await oldReturns();
    const [parcel] =
      await sql`SELECT id FROM return_parcels WHERE case_id=${cases[0].id}`;
    await sql`INSERT INTO return_events(case_id,parcel_id,actor_id,action,created_at) VALUES(${cases[1].id},${parcel.id},${admin.id},'received',${old})`;
    expect(
      (await previewCleanup(admin, scope("returns"))).summary.selected,
    ).toBe(0);
    expect(await sql`SELECT id FROM return_cases`).toHaveLength(2);
  });
  it("tối ưu vùng trống dùng VACUUM thường và giữ nguyên dữ liệu", async () => {
    await oldScan();
    expect(await optimizeStorage(admin)).toEqual({ ok: true });
    expect(await sql`SELECT * FROM scan_events`).toHaveLength(1);
    expect(
      await sql`SELECT * FROM audit_logs WHERE action='storage_optimize'`,
    ).toHaveLength(1);
  });
});
