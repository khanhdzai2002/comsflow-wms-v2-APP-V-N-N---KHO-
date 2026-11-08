import { beforeAll, beforeEach, afterAll, it, expect, vi } from "vitest";
import { readFile, readdir } from "node:fs/promises";
import { createHash } from "node:crypto";
const fixture = vi.hoisted(() => ({ files: new Map<string, Buffer>() }));
vi.mock("../src/lib/supabase", () => ({
  storage: () => ({
    createSignedUploadUrl: async (path: string) => ({
      data: { path, token: "fixture" },
      error: null,
    }),
    info: async (path: string) => ({
      data: { size: fixture.files.get(path)?.length },
      error: null,
    }),
    download: async (path: string) => ({
      data: new Blob([new Uint8Array(fixture.files.get(path)!)]),
      error: null,
    }),
  }),
}));
import { db, type User } from "../src/lib/db";
import { createUpload, ownedJob, finalizeUpload } from "../src/lib/jobs";
import {
  beginReturnIntake,
  appendReturnIntake,
  previewReturnIntake,
  commitReturnIntakeStep,
} from "../src/lib/return-intake-jobs";
import { receiveReturn, returnDetail, inspectReturn } from "../src/lib/returns";
import {
  returnOperationOverview,
  returnOperationList,
} from "../src/lib/return-operation-query";
if (
  !process.env.TEST_DATABASE_URL ||
  !new URL(process.env.TEST_DATABASE_URL).pathname.endsWith("_test")
)
  throw new Error("Dedicated *_test database required");
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
const sql = db();
let admin: User, staff: User, other: User, warehouse: string, shift: string;
beforeAll(async () => {
  await sql`DROP SCHEMA public CASCADE`;
  await sql`CREATE SCHEMA public`;
  for (const name of (await readdir("migrations"))
    .filter((n) => n.endsWith(".sql"))
    .sort())
    await sql.unsafe(await readFile("migrations/" + name, "utf8"));
});
beforeEach(async () => {
  fixture.files.clear();
  await sql`TRUNCATE users,warehouses,sales_channels,shipping_carriers CASCADE`;
  const users =
    await sql`INSERT INTO users(name,email,password_hash,role) VALUES('Admin','a@operations.test','unused','admin'),('Staff','s@operations.test','unused','staff'),('Other','o@operations.test','unused','staff') RETURNING id,name,email,role`;
  [admin, staff, other] = users as unknown as User[];
  warehouse = (
    await sql`INSERT INTO warehouses(name) VALUES('Kho V2') RETURNING id`
  )[0].id;
  shift = (
    await sql`INSERT INTO work_shifts(name,warehouse_id,starts_at,ends_at) VALUES('Ca',${warehouse},now()-interval '1 hour',now()+interval '1 hour') RETURNING id`
  )[0].id;
  await sql`INSERT INTO shift_members(shift_id,user_id) VALUES(${shift},${staff.id}),(${shift},${admin.id}),(${shift},${other.id})`;
  await sql`INSERT INTO shipping_carriers(name) VALUES('J&T Express'),('BEST Express'),('Viettel Post'),('SPX Express')`;
});
afterAll(() => sql.end());
async function intake(kind: string, records: Record<string, string>[]) {
  const headers = Object.keys(records[0]);
  const matrix = records.map((r) => headers.map((h) => r[h] ?? ""));
  const bytes = Buffer.from(
    "\uFEFF" +
      [headers, ...matrix]
        .map((r) => r.map((v) => '"' + v.replaceAll('"', '""') + '"').join(","))
        .join("\r\n"),
  );
  const job = await createUpload(admin, {
    route: "returns/intake/preview",
    filename: "fixture.csv",
    size: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    payload: {
      context: {
        kind,
        warehouseId: warehouse,
        shop: "ComsMiu",
        channel: "TikTok Shop",
      },
    },
    requestKey: crypto.randomUUID(),
  });
  const stored = await ownedJob(admin, job.id);
  fixture.files.set(stored.storage_path, bytes);
  await finalizeUpload(admin, job.id);
  const b = await beginReturnIntake(admin, job.id, {
    headers,
    totalRows: matrix.length,
  });
  if (b.state !== "reused")
    for (let offset = 0; offset < matrix.length; offset += 200)
      await appendReturnIntake(admin, job.id, {
        offset,
        rows: matrix.slice(offset, offset + 200),
      });
  const preview = await previewReturnIntake(admin, job.id);
  return {
    id: job.id,
    preview,
    commit: async () => {
      let result;
      do {
        result = await commitReturnIntakeStep(admin, job.id);
      } while (!result.done);
      return result;
    },
  };
}
const failed = (o: Record<string, string> = {}) => ({
  "Order ID": "000586890280579270204",
  "Tracking ID": "862678510680",
  "Order Status": "Delivery failed",
  "Shipped Time": "01/11/2026 08:00:00",
  "Created Time": "31/10/2026 10:00:00",
  "Cancelled Time": "02/11/2026 11:00:00",
  "SKU ID": "SKU-A",
  "Product Name": "Áo test",
  Quantity: "2",
  "Unit Price": "10000",
  "Order Amount": "20000",
  "Shipping Provider": "J&T Express",
  ...o,
});
const scan = (code = "862678510680") => ({
  code,
  requestId: crypto.randomUUID(),
  warehouseId: warehouse,
  shiftId: shift,
  method: "hid",
});
it("quét trước nguồn giao thất bại: lưu thực tế, khớp sau nhập, giữ giờ/người/ca và chống nhận lặp", async () => {
  const first = await receiveReturn(staff, scan());
  expect(first).toMatchObject({
    outcome: "unknown",
    recorded: true,
    matchState: "unmatched",
  });
  const repeat = await receiveReturn(staff, scan());
  expect(repeat.outcome).toBe("duplicate");
  expect(repeat.receiptId).toBe(first.receiptId);
  const job = await intake("delivery_failed", [failed()]);
  expect(job.preview.canCommit).toBe(true);
  await job.commit();
  const list = await returnOperationList(admin, {});
  expect(list.total).toBe(1);
  expect(list.rows[0]).toMatchObject({
    primary_state: "received",
    has_receipt: true,
    received_full: false,
    order_code: "000586890280579270204",
  });
  const detail = await returnDetail(staff, list.rows[0].id);
  expect(new Date(detail.parcels[0].received_at)).toEqual(new Date(first.at));
  expect(detail.parcels[0].received_by).toBe(staff.id);
  await expect(returnDetail(other, list.rows[0].id)).rejects.toMatchObject({
    status: 403,
  });
  const overview = await returnOperationOverview(admin, {});
  expect(overview.totals).toMatchObject({
    total: 1,
    required: 1,
    received: 1,
    needs_check: 0,
    inspected: 0,
  });
  expect(await sql`SELECT * FROM return_receipts`).toHaveLength(1);
  expect(
    (await intake("delivery_failed", [failed()])).preview.summary.reused,
  ).toBe(true);
});
it("hủy trước bàn giao, trung chuyển, chưa nhận và báo thất lạc được phân biệt", async () => {
  const job = await intake("delivery_failed", [
    failed({
      "Order ID": "0001",
      "Tracking ID": "862678510681",
      "Order Status": "Cancelled before handover",
      "Shipped Time": "",
    }),
    failed({
      "Order ID": "0002",
      "Tracking ID": "862678510682",
      "Order Status": "Returning to sender",
    }),
    failed({
      "Order ID": "0003",
      "Tracking ID": "862678510683",
      "Order Status": "Delivery failed",
    }),
    failed({
      "Order ID": "0004",
      "Tracking ID": "862678510684",
      "Order Status": "Lost in transit",
    }),
    failed({
      "Order ID": "0005",
      "Tracking ID": "862678510685",
      "Order Status": "Cancelled",
      "Shipped Time": "",
    }),
  ]);
  expect(job.preview.canCommit).toBe(true);
  await job.commit();
  const result = await returnOperationOverview(admin, {});
  expect(result.totals).toMatchObject({
    total: 5,
    required: 3,
    not_required: 1,
    in_transit: 1,
    needs_check: 2,
    suspected_lost: 1,
    lost: 0,
    verify: 1,
  });
  expect(
    (await returnOperationList(admin, { state: "needs_check" })).total,
  ).toBe(2);
  expect(
    result.states.reduce((n: number, g: { total: number }) => n + g.total, 0),
  ).toBe(5);
});
it("bản sao dòng chính xác không nhân đôi SKU; mâu thuẫn chặn trước nhập", async () => {
  const duplicate = await intake("delivery_failed", [failed(), failed()]);
  expect(duplicate.preview.summary).toMatchObject({
    duplicates: 1,
    valid: 1,
    errors: 0,
  });
  await duplicate.commit();
  expect(await sql`SELECT * FROM return_items`).toHaveLength(1);
  const conflict = await intake("delivery_failed", [
    failed({ "Order ID": "0002" }),
    failed({ "Order ID": "0002", Quantity: "9" }),
  ]);
  expect(conflict.preview.canCommit).toBe(false);
  await expect(conflict.commit()).rejects.toMatchObject({ status: 409 });
  expect(await sql`SELECT * FROM return_cases`).toHaveLength(1);
});

it("SaleWork trước nguồn: giữ chứng cứ đơn không có vận đơn và chỉ khớp khi một yêu cầu/SKU chắc chắn", async () => {
  const file = await intake("warehouse_receipt", [
    {
      "Mã đơn hàng": "000586890280579270204",
      "Mã vận đơn": "",
      SKU: "SKU-A",
      "Số lượng": "1",
      "Ngày nhận": "03/11/2026 09:00:00",
      "Nhân viên": "Nhân viên từ file",
    },
  ]);
  expect(file.preview.canCommit).toBe(true);
  await file.commit();
  expect((await sql`SELECT * FROM return_receipts`)[0]).toMatchObject({
    match_state: "ambiguous",
    recorded_by: admin.id,
    employee_source: "Nhân viên từ file",
  });
  const source = await intake("delivery_failed", [
    failed({ "Tracking ID": "" }),
  ]);
  await source.commit();
  const [record] = (await returnOperationList(admin, {})).rows;
  expect(record).toMatchObject({
    has_receipt: true,
    received_quantity: 1,
    received_full: false,
    inspection_status: "pending",
  });
  expect((await returnOperationOverview(admin, {})).totals.received_short).toBe(
    1,
  );
  expect((await sql`SELECT * FROM return_receipts`)[0].match_state).toBe(
    "matched",
  );
});
it("SaleWork nhiều SKU không nhân kiện, đủ số lượng vẫn chưa là đã kiểm hàng", async () => {
  const source = await intake("delivery_failed", [
    failed(),
    failed({ "SKU ID": "SKU-B", Quantity: "1" }),
  ]);
  await source.commit();
  const warehouseFile = await intake("warehouse_receipt", [
    {
      "Mã đơn hàng": "000586890280579270204",
      "Mã vận đơn": "862678510680",
      SKU: "SKU-A",
      "Số lượng": "2",
      "Ngày nhận": "03/11/2026 09:00:00",
    },
    {
      "Mã đơn hàng": "000586890280579270204",
      "Mã vận đơn": "862678510680",
      SKU: "SKU-B",
      "Số lượng": "1",
      "Ngày nhận": "03/11/2026 09:00:00",
    },
  ]);
  expect(warehouseFile.preview.canCommit).toBe(true);
  await warehouseFile.commit();
  expect(await sql`SELECT * FROM return_receipts`).toHaveLength(1);
  expect((await returnOperationList(admin, {})).rows[0]).toMatchObject({
    received_full: true,
    inspection_status: "pending",
    received_quantity: 3,
  });
});
it("mã dùng trong hai yêu cầu không tự ghép hoặc xác nhận cả hai đã nhận", async () => {
  await receiveReturn(staff, scan());
  const source = await intake("customer_return", [
    {
      ...failed(),
      "Return Order ID": "R-1",
      "Return Type": "Return and refund",
      "Return Status": "Return approved",
      "Time Requested": "01/11/2026 08:00:00",
    },
    {
      ...failed({ "Order ID": "OTHER-ORDER" }),
      "Return Order ID": "R-2",
      "Return Type": "Return and refund",
      "Return Status": "Return approved",
      "Time Requested": "01/11/2026 08:00:00",
    },
  ]);
  await source.commit();
  expect(
    (await sql`SELECT match_state FROM return_receipts`)[0].match_state,
  ).toBe("ambiguous");
  const result = await returnOperationOverview(admin, {});
  expect(result.totals).toMatchObject({ total: 2, received: 0, verify: 2 });
});
it("nhiều SKU, trả một phần, chỉ hoàn tiền: không cộng trùng tiền hoặc gán nghĩa vụ sai", async () => {
  const common = {
    ...failed(),
    "Return Order ID": "R-1",
    "Return Type": "Return and refund",
    "Return Status": "Return approved",
    "Time Requested": "01/11/2026 08:00:00",
    "Refund Amount": "15000",
    "Refund Time": "03/11/2026 08:00:00",
  };
  const source = await intake("customer_return", [
    common,
    { ...common, "SKU ID": "SKU-B", Quantity: "1" },
    {
      ...common,
      "Order ID": "002",
      "Return Order ID": "R-2",
      "Tracking ID": "",
      "Return Type": "Refund only",
    },
  ]);
  await source.commit();
  const t = (await returnOperationOverview(admin, {})).totals;
  expect(t).toMatchObject({
    total: 2,
    required: 1,
    refund_only: 1,
    needs_check: 1,
    refund_amount: "30000",
  });
  const caseId = (await returnOperationList(admin, { q: "R-1" })).rows[0].id;
  await receiveReturn(staff, scan());
  const detail = await returnDetail(staff, caseId);
  await inspectReturn(staff, {
    id: caseId,
    version: detail.record.version,
    condition: "short",
    location: "Kệ A",
    note: "Kiểm đếm thực tế theo SKU",
    items: detail.items.map((i: any) => ({
      id: i.id,
      quantity: i.sku_id === "SKU-A" ? 1 : 1,
      condition: i.sku_id === "SKU-A" ? "short" : "full",
    })),
  });
  expect(
    (await returnOperationList(admin, { q: "R-1" })).rows[0],
  ).toMatchObject({ received_full: false, has_goods_problem: true });
  const problems = (await returnOperationOverview(admin, {})).products;
  expect(problems.find((p: any) => p.sku === "SKU-B").problems).toBe(0);
});
it("quét đồng thời và lặp request giữ một lần nhận; hoàn tác không để lại số đã nhận ảo", async () => {
  const source = await intake("delivery_failed", [failed()]);
  await source.commit();
  const input = scan();
  const [a, b] = await Promise.all([
    receiveReturn(staff, input),
    receiveReturn(staff, input),
  ]);
  expect(a.eventId).toBe(b.eventId);
  expect(await sql`SELECT * FROM return_receipts`).toHaveLength(1);
  const { undoReturn } = await import("../src/lib/returns");
  await undoReturn(staff, {
    eventId: a.eventId,
    reason: "Quét nhầm trong phiên kiểm thử",
  });
  expect((await returnOperationList(admin, {})).rows[0].has_receipt).toBe(
    false,
  );
  expect((await sql`SELECT * FROM return_receipts`)[0].source_active).toBe(
    false,
  );
  await receiveReturn(staff, scan());
  expect((await returnOperationList(admin, {})).rows[0].has_receipt).toBe(true);
});
it("loại bỏ/khôi phục nguồn sai giữ nguyên lần nhận và lịch sử, nguồn khác vẫn hiện", async () => {
  const { archiveReturnIntake } =
    await import("../src/lib/return-source-archive");
  const first = await intake("delivery_failed", [
    failed({ Color: "Đỏ", Size: "XL" }),
  ]);
  await first.commit();
  const receipt = await receiveReturn(staff, scan());
  const second = await intake("delivery_failed", [
    failed({
      "Order Status": "Returning to sender",
      "Updated Time": "05/11/2026 10:00:00",
    }),
  ]);
  await second.commit();
  let step;
  do {
    step = await archiveReturnIntake(admin, {
      id: second.id,
      reason: "Nguồn cập nhật sai cần loại bỏ",
    });
  } while (!step.done);
  expect((await returnOperationList(admin, {})).rows[0]).toMatchObject({
    shipping_state: "failed",
    has_receipt: true,
  });
  do {
    step = await archiveReturnIntake(admin, {
      id: first.id,
      reason: "Kiểm thử loại bỏ hết nguồn",
    });
  } while (!step.done);
  expect((await returnOperationList(admin, {})).total).toBe(0);
  expect((await sql`SELECT * FROM return_receipts`)[0].id).toBe(
    receipt.receiptId,
  );
  do {
    step = await archiveReturnIntake(admin, {
      id: first.id,
      restore: true,
      reason: "Khôi phục nguồn đã xác minh",
    });
  } while (!step.done);
  expect((await returnOperationList(admin, {})).rows[0].has_receipt).toBe(true);
  expect(
    (await sql`SELECT color,size FROM return_items WHERE active`)[0],
  ).toMatchObject({ color: "Đỏ", size: "XL" });
  expect(await sql`SELECT * FROM return_source_versions`).toHaveLength(2);
  await expect(
    archiveReturnIntake(staff, {
      id: first.id,
      reason: "Không đủ quyền loại bỏ",
    }),
  ).rejects.toMatchObject({ status: 403 });
});
it("loại bỏ file kho chưa kiểm có thể khôi phục, không xóa sổ nhận hoặc tệp gốc", async () => {
  const { archiveReturnIntake } =
    await import("../src/lib/return-source-archive");
  const source = await intake("delivery_failed", [failed()]);
  await source.commit();
  const file = await intake("warehouse_receipt", [
    { "Mã vận đơn": "862678510680", "Ngày nhận": "03/11/2026 09:00:00" },
  ]);
  await file.commit();
  await archiveReturnIntake(admin, {
    id: file.id,
    reason: "Nhập thử nhầm danh sách kho",
  });
  expect((await returnOperationList(admin, {})).rows[0].has_receipt).toBe(
    false,
  );
  await archiveReturnIntake(admin, {
    id: file.id,
    restore: true,
    reason: "Xác minh lại biên bản bàn giao",
  });
  expect((await returnOperationList(admin, {})).rows[0].has_receipt).toBe(true);
  expect(await sql`SELECT * FROM return_receipts`).toHaveLength(1);
});
it("phiên bàn giao, bằng chứng riêng tư và khiếu nại có người/giờ/tiền thực nhận, retry không tạo trùng", async () => {
  const { returnHandover } = await import("../src/lib/return-receipts");
  const { beginReturnMedia, finishReturnMedia, downloadReturnMedia } =
    await import("../src/lib/return-media");
  const { saveReturnClaim } = await import("../src/lib/returns");
  const session = await returnHandover(staff, {
    warehouseId: warehouse,
    courier: "Anh giao hoàn",
    note: "Đợt 1",
  });
  const receipt = await receiveReturn(staff, {
    ...scan(),
    sessionId: session.id,
    courier: "Anh giao hoàn",
  });
  const bytes = Buffer.from("%PDF-1.7\nfixture evidence");
  const media = await beginReturnMedia(staff, {
    sessionId: session.id,
    filename: "bien-ban.pdf",
    size: bytes.length,
    mime: "application/pdf",
    sha256: createHash("sha256").update(bytes).digest("hex"),
  });
  fixture.files.set(media.path, bytes);
  await finishReturnMedia(staff, media.id);
  expect((await finishReturnMedia(staff, media.id)).reused).toBe(true);
  await expect(downloadReturnMedia(other, media.id)).rejects.toMatchObject({
    status: 403,
  });
  await returnHandover(staff, {
    warehouseId: warehouse,
    id: session.id,
    close: true,
  });
  await expect(
    receiveReturn(staff, { ...scan("862678510681"), sessionId: session.id }),
  ).rejects.toMatchObject({ status: 409 });
  const source = await intake("delivery_failed", [failed()]);
  await source.commit();
  const r = (await returnOperationList(admin, {})).rows[0];
  const input = {
    caseId: r.id,
    requestId: crypto.randomUUID(),
    version: r.version,
    status: "paid",
    claimType: "lost",
    responsibleParty: "carrier",
    assignedTo: admin.id,
    reason: "Được hãng chấp thuận và thực trả",
    deadline: "2026-11-20",
    requested: 20000,
    approved: 18000,
    received: 17000,
    receivedOn: "2026-11-08",
    closedOn: "2026-11-08",
  };
  const claim = await saveReturnClaim(admin, input);
  expect((await saveReturnClaim(admin, input)).id).toBe(claim.id);
  expect(await sql`SELECT * FROM return_claims`).toHaveLength(1);
  expect((await returnOperationOverview(admin, {})).totals.compensation).toBe(
    "17000",
  );
  expect((await sql`SELECT * FROM return_receipts`)[0].id).toBe(
    receipt.receiptId,
  );
  await expect(saveReturnClaim(staff, input)).rejects.toMatchObject({
    status: 403,
  });
});
it("xuất snapshot chỉ tập cần tra soát, mỗi hãng riêng, số tiền cả đơn một lần, không lộ dữ liệu khách", async () => {
  const { startReturnReport, returnReportPage } =
    await import("../src/lib/return-reports");
  const source = await intake("delivery_failed", [
    failed({ "SKU ID": "A" }),
    failed({ "SKU ID": "B" }),
    failed({
      "Order ID": "00022222222222222222",
      "Tracking ID": "TTVN1120898402",
      "Shipping Provider": "BEST Express",
    }),
    failed({
      "Order ID": "003",
      "Tracking ID": "VTPVN0000000001",
      "Shipping Provider": "Viettel Post",
      "Order Status": "Returning to sender",
    }),
  ]);
  await source.commit();
  const report = await startReturnReport(admin, {});
  expect(report.total_cases).toBe(2);
  expect(report.total_rows).toBe(3);
  const page = await returnReportPage(admin, report.id, 0);
  expect(
    page.rows.map((r: any) => r.row_data.orderAmount).filter(Boolean),
  ).toEqual(["20000", "20000"]);
  expect(new Set(page.rows.map((r: any) => r.carrier)).size).toBe(2);
  expect(JSON.stringify(page.rows)).not.toMatch(/buyer|email|address|phone/);
  await receiveReturn(staff, scan());
  expect((await returnReportPage(admin, report.id, 0)).rows).toEqual(page.rows);
  await expect(startReturnReport(staff, {})).rejects.toMatchObject({
    status: 403,
  });
});
it("bảo vệ lịch sử v2 khỏi thao tác dọn vĩnh viễn của module cũ", async () => {
  const { previewCleanup } = await import("../src/lib/maintenance");
  await expect(
    previewCleanup(admin, { kind: "returns", before: "2020-01-01" }),
  ).rejects.toMatchObject({ status: 409 });
});
it("745 hồ sơ minh họa: 634 đã hủy, 483 nhận, 151 cần kiểm, 111 trung chuyển — chỉ là fixture", async () => {
  const records = Array.from({ length: 745 }, (_, i) =>
    failed({
      "Order ID": "EXAMPLE-" + String(i).padStart(6, "0"),
      "Tracking ID": "86" + String(i).padStart(10, "0"),
      "Order Status": i < 634 ? "Cancelled" : "Returning to sender",
    }),
  );
  const source = await intake("delivery_failed", records);
  await source.commit();
  // Synthetic receipts are inserted in the dedicated test database only.
  await sql`UPDATE return_parcels p SET received_at='2026-11-03T01:00:00Z',received_by=${staff.id} FROM return_cases r WHERE r.id=p.case_id AND r.order_code<='EXAMPLE-000482'`;
  const t = (await returnOperationOverview(admin, {})).totals;
  expect(t).toMatchObject({
    total: 745,
    cancelled: 634,
    received: 483,
    needs_check: 151,
    in_transit: 111,
    lost: 0,
  });
});
it("nguồn cập nhật cũ bị chặn trước ghi; thay đổi sau preview cần đối chiếu lại", async () => {
  const first = await intake("delivery_failed", [
    failed({ "Updated Time": "05/11/2026 08:00:00" }),
  ]);
  await first.commit();
  const stale = await intake("delivery_failed", [
    failed({
      "Updated Time": "04/11/2026 08:00:00",
      "Order Status": "Returning to sender",
    }),
  ]);
  expect(stale.preview.canCommit).toBe(false);
  const pending = await intake("delivery_failed", [
    failed({
      "Updated Time": "07/11/2026 08:00:00",
      "Order Status": "Returning to sender",
    }),
  ]);
  expect(pending.preview.canCommit).toBe(true);
  const other = await intake("delivery_failed", [
    failed({
      "Updated Time": "06/11/2026 08:00:00",
      "Order Status": "Lost in transit",
    }),
  ]);
  await other.commit();
  await expect(pending.commit()).rejects.toMatchObject({ status: 409 });
  await previewReturnIntake(admin, pending.id);
  await pending.commit();
  expect((await returnOperationList(admin, {})).rows[0].shipping_state).toBe(
    "returning",
  );
});
it("bằng chứng sai nội dung/hash không được đánh dấu sẵn sàng", async () => {
  const { beginReturnMedia, finishReturnMedia } =
    await import("../src/lib/return-media");
  const source = await intake("delivery_failed", [failed()]);
  await source.commit();
  const c = (await returnOperationList(admin, {})).rows[0];
  const bytes = Buffer.from("<html>not an image</html>");
  const m = await beginReturnMedia(admin, {
    caseId: c.id,
    filename: "gia-mao.png",
    size: bytes.length,
    mime: "image/png",
    sha256: createHash("sha256").update(bytes).digest("hex"),
  });
  fixture.files.set(m.path, bytes);
  await expect(finishReturnMedia(admin, m.id)).rejects.toMatchObject({
    status: 400,
  });
  expect(
    (await sql`SELECT state FROM return_media WHERE id=${m.id}`)[0].state,
  ).toBe("pending");
});
it("tải 20.000 dòng từ staging tới dữ liệu thật, checkpoint/retry, phân trang và tổng hợp SQL", async () => {
  const { writeFile } = await import("node:fs/promises");
  const count = 20000,
    start = performance.now();
  const source = await intake(
    "delivery_failed",
    Array.from({ length: count }, (_, i) => ({
      "Order ID": "LOAD-" + String(i).padStart(10, "0"),
      "Tracking ID": "86" + String(i).padStart(10, "0"),
      "Order Status": i % 4 === 0 ? "Returning to sender" : "Delivery failed",
      "Created Time": "01/11/2026 08:00:00",
      "SKU ID": "SKU-" + (i % 20),
      Quantity: "1",
      "Unit Price": "10000",
      "Order Amount": "10000",
    })),
  );
  expect(source.preview.summary).toMatchObject({
    rows: count,
    valid: count,
    requests: count,
    errors: 0,
  });
  const stagedMs = performance.now() - start,
    times: number[] = [];
  let result;
  do {
    const at = performance.now();
    result = await commitReturnIntakeStep(admin, source.id);
    times.push(performance.now() - at);
    if (times.length === 1) {
      const resumed = await beginReturnIntake(admin, source.id, {
        headers: ["ignored on resume"],
        totalRows: count,
      });
      expect(resumed.imported_rows).toBe(100);
    }
  } while (!result.done);
  expect((await commitReturnIntakeStep(admin, source.id)).done).toBe(true);
  const queryStart = performance.now(),
    overview = await returnOperationOverview(admin, {}),
    aggregateMs = performance.now() - queryStart;
  expect(overview.totals).toMatchObject({
    total: count,
    required: count,
    needs_check: 15000,
    in_transit: 5000,
  });
  const listAt = performance.now(),
    list = await returnOperationList(admin, { page: 400 }),
    listMs = performance.now() - listAt;
  expect(list.total).toBe(count);
  expect(list.rows).toHaveLength(50);
  expect(await sql`SELECT id FROM return_cases`).toHaveLength(count);
  const resultStats = {
    dataset: "synthetic, local *_test only",
    rows: count,
    stagingPreviewMs: Math.round(stagedMs),
    commitSteps: times.length,
    commitTotalMs: Math.round(times.reduce((n, x) => n + x, 0)),
    maxCommitMs: Math.round(Math.max(...times)),
    overviewMs: Math.round(aggregateMs),
    lastPageMs: Math.round(listMs),
    elapsedMs: Math.round(performance.now() - start),
  };
  await writeFile(
    "/tmp/returns-v2-load-result.json",
    JSON.stringify(resultStats, null, 2),
  );
}, 180000);
it("loại bỏ lượng từ file giữ lượt quét độc lập; khôi phục lượng không tự kiểm chất lượng", async () => {
  const { archiveReturnIntake } =
    await import("../src/lib/return-source-archive");
  const source = await intake("delivery_failed", [failed()]);
  await source.commit();
  await receiveReturn(staff, scan());
  const qty = await intake("warehouse_receipt", [
    {
      "Mã vận đơn": "862678510680",
      SKU: "SKU-A",
      "Số lượng": "2",
      "Ngày nhận": "03/11/2026 09:00:00",
    },
  ]);
  await qty.commit();
  expect((await returnOperationList(admin, {})).rows[0]).toMatchObject({
    has_receipt: true,
    quantity_known: true,
    received_full: true,
  });
  await archiveReturnIntake(admin, {
    id: qty.id,
    reason: "Lượng nhận trong file cần thu hồi",
  });
  expect((await returnOperationList(admin, {})).rows[0]).toMatchObject({
    has_receipt: true,
    quantity_known: false,
    received_full: false,
  });
  await archiveReturnIntake(admin, {
    id: qty.id,
    restore: true,
    reason: "Đã đối chiếu lại số lượng thực tế",
  });
  expect((await returnOperationList(admin, {})).rows[0]).toMatchObject({
    has_receipt: true,
    quantity_known: true,
    received_full: true,
    inspection_status: "pending",
  });
});
it("quản lý xác minh nghĩa vụ hoàn; nhập sau không ghi đè quyết định và có cảnh báo nguồn trái", async () => {
  const { updateReturn } = await import("../src/lib/returns");
  const first = await intake("delivery_failed", [
    failed({ "Order Status": "Cancelled", "Shipped Time": "" }),
  ]);
  await first.commit();
  const r = (await returnOperationList(admin, {})).rows[0];
  expect(r.primary_state).toBe("verify");
  await updateReturn(admin, {
    id: r.id,
    version: r.version,
    note: "Đã kiểm tra biên bản bàn giao thực tế",
    obligationOverride: "required",
  });
  expect((await returnOperationList(admin, {})).rows[0].primary_state).toBe(
    "needs_check",
  );
  const update = await intake("delivery_failed", [
    failed({
      "Order Status": "Cancelled before handover",
      "Shipped Time": "",
      "Updated Time": "07/11/2026 10:00:00",
    }),
  ]);
  await update.commit();
  expect((await returnOperationList(admin, {})).rows[0]).toMatchObject({
    obligation: "required",
    primary_state: "verify",
  });
});
it("bộ lọc từ KPI, nhóm loại trừ nhau, sổ nhận theo ngày/hãng/người đều khớp tập đếm", async () => {
  const { updateReturn } = await import("../src/lib/returns");
  const { returnReceiptList } =
    await import("../src/lib/return-operation-query");
  const source = await intake("delivery_failed", [failed()]);
  await source.commit();
  await receiveReturn(staff, scan());
  const r = (await returnOperationList(admin, {})).rows[0];
  await updateReturn(admin, {
    id: r.id,
    version: r.version,
    note: "Xác minh đây là hồ sơ đã nhận thực tế",
    verificationStatus: "checking",
  });
  const totals = (await returnOperationOverview(admin, {})).totals;
  for (const key of [
    "received",
    "required",
    "not_required",
    "needs_check",
    "cancelled",
    "received_full",
    "received_short",
    "refund_only",
    "refund_missing",
    "overdue",
    "verify",
    "claims",
  ])
    expect((await returnOperationList(admin, { state: key })).total, key).toBe(
      totals[key] ?? 0,
    );
  const groups = (await returnOperationOverview(admin, {})).states;
  for (const g of groups)
    expect(
      (
        await returnOperationList(admin, {
          state: "primary:" + g.primary_state,
        })
      ).total,
    ).toBe(g.total);
  expect(
    (
      await returnReceiptList(admin, {
        employee: staff.id,
        from: "2026-11-01",
        to: "2026-12-31",
      })
    ).total,
  ).toBe(1);
  expect((await returnReceiptList(admin, { employee: other.id })).total).toBe(
    0,
  );
  expect(
    (await returnReceiptList(admin, { from: "2020-01-01", to: "2020-01-31" }))
      .total,
  ).toBe(0);
});
it("phân công hàng loạt có version, audit và chặn nhân viên hoặc danh sách cũ", async () => {
  const { assignReturnCases } =
    await import("../src/lib/return-operation-actions");
  const source = await intake("delivery_failed", [
    failed(),
    failed({ "Order ID": "TWO", "Tracking ID": "862678510681" }),
  ]);
  await source.commit();
  const items = (await returnOperationList(admin, {})).rows.map((r) => ({
    id: r.id,
    version: r.version,
  }));
  await expect(
    assignReturnCases(staff, {
      items,
      assignedTo: staff.id,
      reason: "Không có quyền quản lý kho",
    }),
  ).rejects.toMatchObject({ status: 403 });
  expect(
    await assignReturnCases(admin, {
      items,
      assignedTo: other.id,
      reason: "Phân công nhân viên đối chiếu hai hồ sơ",
    }),
  ).toEqual({ updated: 2 });
  expect((await returnOperationList(other, {})).total).toBe(2);
  await expect(
    assignReturnCases(admin, {
      items,
      assignedTo: staff.id,
      reason: "Lượt cũ chưa tải lại phiên bản",
    }),
  ).rejects.toMatchObject({ status: 409 });
  expect(
    await sql`SELECT * FROM return_events WHERE data->>'bulk'='true'`,
  ).toHaveLength(2);
});
it("lỗi đọc tệp lưu một lần vào lịch sử, không làm xuất hiện hồ sơ hoặc xác nhận nhập", async () => {
  const { recordReturnIntakeReadError } =
    await import("../src/lib/return-intake-jobs");
  const bytes = Buffer.from('"Unclosed CSV');
  const upload = await createUpload(admin, {
    route: "returns/intake/preview",
    filename: "bad.csv",
    size: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    requestKey: crypto.randomUUID(),
    payload: {
      context: {
        kind: "delivery_failed",
        warehouseId: warehouse,
        shop: "ComsMiu",
        channel: "TikTok Shop",
      },
    },
  });
  await recordReturnIntakeReadError(admin, upload.id, {
    message: "CSV có dấu ngoặc kép không nhất quán",
  });
  await recordReturnIntakeReadError(admin, upload.id, {
    message: "CSV có dấu ngoặc kép không nhất quán",
  });
  expect((await ownedJob(admin, upload.id)).status).toBe("failed");
  expect(await sql`SELECT * FROM return_upload_attempts`).toHaveLength(1);
  expect((await returnOperationList(admin, {})).total).toBe(0);
});
it("đối soát nhiều lô dùng cursor, mã mơ hồ ở đầu không chặn các mã chắc chắn phía sau", async () => {
  const { reconcileReturnReceipts } =
    await import("../src/lib/return-receipts");
  const source = await intake("delivery_failed", [
    failed({ "Order ID": "A1" }),
    failed({ "Order ID": "A2" }),
    failed({ "Order ID": "B", "Tracking ID": "862678510681" }),
    failed({ "Order ID": "C", "Tracking ID": "862678510682" }),
  ]);
  await source.commit();
  await sql`INSERT INTO return_receipts(id,warehouse_id,tracking_code,received_at,recorded_by,source) VALUES('00000000-0000-4000-8000-000000000001',${warehouse},'862678510680','2026-11-03T01:00:00Z',${staff.id},'scan'),('00000000-0000-4000-8000-000000000002',${warehouse},'862678510681','2026-11-03T01:00:00Z',${staff.id},'scan'),('00000000-0000-4000-8000-000000000003',${warehouse},'862678510682','2026-11-03T01:00:00Z',${staff.id},'scan')`;
  let cursor: string | undefined,
    total = 0,
    calls = 0;
  for (;;) {
    const step = await sql.begin(async (tx) => {
      await tx`SELECT pg_advisory_xact_lock(742920)`;
      return reconcileReturnReceipts(tx, admin, undefined, undefined, {
        after: cursor,
        limit: 1,
      });
    });
    total += step.matched;
    calls++;
    if (!step.more) break;
    cursor = step.cursor!;
    if (calls > 4) throw new Error("Cursor did not advance");
  }
  expect(total).toBe(2);
  expect(calls).toBe(4);
  expect(
    (
      await sql`SELECT match_state FROM return_receipts WHERE tracking_code='862678510680'`
    )[0].match_state,
  ).toBe("ambiguous");
});
it("loại bỏ/khôi phục nguồn không bật lại kiện đã loại thủ công, mã đã nhận ngoài nguồn mới được cảnh báo", async () => {
  const { editReturnParcel } = await import("../src/lib/returns");
  const { archiveReturnIntake } =
    await import("../src/lib/return-source-archive");
  const first = await intake("delivery_failed", [failed()]);
  await first.commit();
  const c = (await returnOperationList(admin, {})).rows[0],
    p = (await returnDetail(admin, c.id)).parcels[0];
  await editReturnParcel(admin, {
    caseId: c.id,
    id: p.id,
    exclude: true,
    reason: "Loại mã nguồn sai đã xác minh",
  });
  await archiveReturnIntake(admin, {
    id: first.id,
    reason: "Loại nguồn để kiểm thử khôi phục",
  });
  await archiveReturnIntake(admin, {
    id: first.id,
    restore: true,
    reason: "Khôi phục nguồn không đổi quyết định kho",
  });
  expect((await returnDetail(admin, c.id)).parcels[0]).toMatchObject({
    active: false,
    excluded_manually: true,
  });
  await editReturnParcel(admin, {
    caseId: c.id,
    id: p.id,
    exclude: false,
    reason: "Xác minh cho phép nhận mã này",
  });
  await receiveReturn(staff, scan());
  const next = await intake("delivery_failed", [
    failed({
      "Tracking ID": "862678510681",
      "Updated Time": "07/11/2026 10:00:00",
    }),
  ]);
  await next.commit();
  // A manually verified parcel may legitimately be additional to platform source;
  // unverified carrier-origin parcels must be reviewed rather than moved silently.
  await sql`UPDATE return_parcels SET carrier_origin='format' WHERE id=${p.id}`;
  const newer = await intake("delivery_failed", [
    failed({
      "Tracking ID": "862678510681",
      "Updated Time": "08/11/2026 10:00:00",
    }),
  ]);
  await newer.commit();
  expect((await returnOperationList(admin, {})).rows[0]).toMatchObject({
    has_receipt: true,
    primary_state: "verify",
  });
  expect(
    (await returnDetail(admin, c.id)).parcels.find((x: any) => x.id === p.id)
      .received_at,
  ).toBeTruthy();
});
it("kiểm riêng từng kiện khi hàng về một phần; cộng lượng thực tế, không tự kiểm đủ và retry không thêm lần kiểm", async () => {
  const { editReturnParcel } = await import("../src/lib/returns");
  const source = await intake("delivery_failed", [failed({ Quantity: "4" })]);
  await source.commit();
  let detail = await returnDetail(
    admin,
    (await returnOperationList(admin, {})).rows[0].id,
  );
  const caseId = detail.record.id;
  const second = await editReturnParcel(admin, {
    caseId,
    tracking: "862678510681",
    reason: "Hai kiện cùng yêu cầu đã xác minh",
  });
  await receiveReturn(staff, scan());
  detail = await returnDetail(staff, caseId);
  const first = detail.parcels.find(
    (p: any) => p.tracking_code === "862678510680",
  );
  const input = {
    id: caseId,
    version: detail.record.version,
    requestId: crypto.randomUUID(),
    parcelId: first.id,
    condition: "full",
    note: "Kiểm riêng kiện thứ nhất thực nhận hai áo",
    items: detail.items.map((i: any) => ({
      id: i.id,
      quantity: 2,
      condition: "full",
    })),
  };
  await inspectReturn(staff, input);
  await inspectReturn(staff, input);
  expect((await returnOperationList(admin, {})).rows[0]).toMatchObject({
    received_quantity: 2,
    inspection_partial: true,
    received_full: false,
    quantity_known: false,
    has_goods_problem: false,
  });
  expect((await returnOperationOverview(admin, {})).totals.inspected).toBe(0);
  await receiveReturn(staff, scan("862678510681"));
  detail = await returnDetail(staff, caseId);
  await inspectReturn(staff, {
    ...input,
    parcelId: second.id,
    requestId: crypto.randomUUID(),
    version: detail.record.version,
    note: "Kiểm riêng kiện thứ hai đủ hai áo",
  });
  expect((await returnOperationList(admin, {})).rows[0]).toMatchObject({
    received_quantity: 4,
    inspection_partial: false,
    received_full: true,
    quantity_known: true,
    inspection_status: "full",
  });
  expect(
    await sql`SELECT id FROM return_events WHERE case_id=${caseId} AND action='inspect'`,
  ).toHaveLength(2);
});
it("lượng file kho cộng theo hai kiện; rút một file không xóa lượng của file độc lập", async () => {
  const { editReturnParcel } = await import("../src/lib/returns");
  const { archiveReturnIntake } =
    await import("../src/lib/return-source-archive");
  const source = await intake("delivery_failed", [failed({ Quantity: "4" })]);
  await source.commit();
  const c = (await returnOperationList(admin, {})).rows[0];
  await editReturnParcel(admin, {
    caseId: c.id,
    tracking: "862678510681",
    reason: "Bổ sung kiện thứ hai theo biên bản",
  });
  const a = await intake("warehouse_receipt", [
    {
      "Mã vận đơn": "862678510680",
      SKU: "SKU-A",
      "Số lượng": "2",
      "Ngày nhận": "03/11/2026 09:00:00",
    },
  ]);
  await a.commit();
  const b = await intake("warehouse_receipt", [
    {
      "Mã vận đơn": "862678510681",
      SKU: "SKU-A",
      "Số lượng": "2",
      "Ngày nhận": "03/11/2026 09:00:00",
    },
  ]);
  await b.commit();
  expect((await returnOperationList(admin, {})).rows[0]).toMatchObject({
    received_quantity: 4,
    received_full: true,
    inspection_status: "pending",
  });
  await archiveReturnIntake(admin, {
    id: a.id,
    reason: "Dòng nhận kiện đầu trong tệp nhập nhầm",
  });
  expect((await returnOperationList(admin, {})).rows[0]).toMatchObject({
    has_receipt: true,
    received_quantity: 2,
    quantity_known: false,
    received_full: false,
  });
  expect(
    (
      await sql`SELECT * FROM return_receipts WHERE tracking_code='862678510681'`
    )[0].source_active,
  ).toBe(true);
});
it("mã chữ thường/chữ hoa và gạch được giữ nguyên từ nhập, QR/tít, dữ liệu tới báo cáo", async () => {
  const source = await intake("delivery_failed", [
    failed({ "Order ID": "000abC-001", "Tracking ID": "abC-0001" }),
  ]);
  await source.commit();
  const r = await receiveReturn(staff, scan("abC-0001"));
  expect(r.outcome).toBe("received");
  expect(r.code).toBe("abC-0001");
  const list = await returnOperationList(admin, {});
  expect(list.rows[0]).toMatchObject({
    order_code: "000abC-001",
    tracking_codes: "abC-0001",
  });
  expect(
    (
      await receiveReturn(
        staff,
        scan(JSON.stringify({ tracking_code: "abC-0001" })),
      )
    ).outcome,
  ).toBe("duplicate");
  await expect(
    receiveReturn(staff, scan(JSON.stringify({ tracking_code: 862678510680 }))),
  ).rejects.toMatchObject({ status: 400 });
});
