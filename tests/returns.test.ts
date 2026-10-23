import { beforeAll, beforeEach, afterAll, describe, it, expect } from "vitest";
import { readFile, readdir } from "node:fs/promises";
import ExcelJS from "exceljs";
import { db, type User } from "../src/lib/db";
import {
  parseReturnFile,
  returnDate,
  returnMoney,
} from "../src/lib/return-import";
import {
  commitReturns,
  previewReturns,
  returnList,
  returnDetail,
  receiveReturn,
  inspectReturn,
  updateReturn,
  undoReturn,
  saveReturnClaim,
  editReturnParcel,
} from "../src/lib/returns";
import { returnRow, returnCsv, repeatedRowXlsx } from "./return-fixture";
const url = process.env.TEST_DATABASE_URL;
if (!url || !new URL(url).pathname.endsWith("_test"))
  throw new Error("TEST_DATABASE_URL phải là database riêng *_test");
process.env.DATABASE_URL = url;
const sql = db();
let admin: User, staff: User, other: User, warehouse: string, shift: string;
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
    await sql`INSERT INTO users(email,name,password_hash,role) VALUES('admin@test.example','Admin','not-used','admin'),('staff@test.example','Staff','not-used','staff'),('other@test.example','Other','not-used','staff') RETURNING id,email,name,role`;
  admin = users.find((u) => u.role === "admin") as User;
  staff = users.find((u) => u.name === "Staff") as User;
  other = users.find((u) => u.name === "Other") as User;
  const [w] =
    await sql`INSERT INTO warehouses(name) VALUES('Return test') RETURNING id`;
  warehouse = w.id;
  const [s] =
    await sql`INSERT INTO work_shifts(name,warehouse_id,starts_at,ends_at) VALUES('Return shift',${warehouse},now()-interval '1 hour',now()+interval '1 hour') RETURNING id`;
  shift = s.id;
  for (const u of users)
    await sql`INSERT INTO shift_members(shift_id,user_id) VALUES(${shift},${u.id})`;
});
afterAll(async () => {
  await sql.end();
});
const context = () => ({ warehouseId: warehouse, shop: "ComsMiu" });
const parse = (rows = [returnRow()]) =>
  parseReturnFile(returnCsv(rows), "returns.csv");
const receive = (code = "854160000001", extra = {}) => ({
  code,
  warehouseId: warehouse,
  shiftId: shift,
  requestId: crypto.randomUUID(),
  method: "manual",
  ...extra,
});
async function imported(rows = [returnRow()]) {
  const file = await parse(rows);
  await commitReturns(admin, file, "test.csv", context());
  return (await returnList(admin, {})).rows[0];
}
describe("Nguồn hoàn, kho và xử lý độc lập", () => {
  it("CSV/XLSX giữ ID dài, thiếu Seller SKU/vận đơn vẫn hợp lệ; không áp mã 86 xuất kho", async () => {
    const rows = [
      returnRow(),
      returnRow({
        "Return Order ID": "1234567890123456790",
        "Return Logistics Tracking ID": "",
        "Return Quantity": "2",
      }),
    ];
    const f = await parse(rows);
    expect(f.summary).toMatchObject({
      rows: 2,
      requests: 2,
      orders: 1,
      tracking: 1,
      quantity: 3,
      missingTracking: 1,
      missingSellerSku: 2,
    });
    expect(f.errors).toEqual([]);
    expect(f.rows[0].request).toBe("1234567890123456789");
    const wb = new ExcelJS.Workbook(),
      sheet = wb.addWorksheet("0");
    sheet.addRow(Object.keys(rows[0]));
    sheet.addRow(Object.values(rows[0]));
    const x = await parseReturnFile(
      Buffer.from(await wb.xlsx.writeBuffer()),
      "test.xlsx",
    );
    expect(x.rows[0].request).toBe(f.rows[0].request);
  });
  it("ghép XLSX dimension A1, mỗi ô một row tag như file sàn; giữ đúng từng cột", async () => {
    const f = await parseReturnFile(repeatedRowXlsx(), "broken-export.xlsx");
    expect(f.errors).toEqual([]);
    expect(f.summary).toMatchObject({
      rows: 1,
      requests: 1,
      orders: 1,
      tracking: 1,
      quantity: 1,
    });
    expect(f.rows[0].raw["Return Order ID"]).toBe("1234567890123456789");
  });
  it("tiền và ngày đúng định dạng; không chấp nhận ngày sai hoặc mã bị làm tròn", async () => {
    expect(returnMoney("185.540₫")).toBe(185540);
    expect(returnMoney("")).toBe(null);
    expect(returnDate("19/10/2026 10:00:00")).toBe("2026-10-19T03:00:00.000Z");
    expect(() => returnDate("31/02/2026 10:00:00")).toThrow();
    expect(() => returnMoney("185,54")).toThrow();
    expect(
      (await parse([returnRow({ "Return Order ID": "1.234567890123E+18" })]))
        .errors,
    ).toHaveLength(1);
  });
  it("không suy sàn từ tên file, chặn sai sàn, công thức và lặp SKU mơ hồ", async () => {
    await expect(
      parseReturnFile(returnCsv(), "shopee.csv", "Shopee"),
    ).rejects.toMatchObject({ status: 400 });
    expect((await parse([returnRow(), returnRow()])).errors).toHaveLength(2);
    const wb = new ExcelJS.Workbook(),
      s = wb.addWorksheet("0");
    s.getCell("A1").value = { formula: "1+1", result: 2 };
    await expect(
      parseReturnFile(Buffer.from(await wb.xlsx.writeBuffer()), "x.xlsx"),
    ).rejects.toMatchObject({ status: 400 });
  });
  it("nhập lại đồng thời một file chỉ tạo một nguồn; không ảnh hưởng outbound", async () => {
    const f = await parse();
    const out = await Promise.all([
      commitReturns(admin, f, "a.csv", context()),
      commitReturns(admin, f, "b.csv", context()),
    ]);
    expect(out.filter((r) => !r.reused)).toHaveLength(1);
    expect(await sql`SELECT * FROM return_cases`).toHaveLength(1);
    expect(await sql`SELECT * FROM shipments`).toHaveLength(0);
    expect(
      (await returnDetail(admin, (await returnList(admin, {})).rows[0].id))
        .parcels[0].received_at,
    ).toBeNull();
  });
  it("Refund Time/Delivered/Completed không tự nhận kho; 2 nhân viên chỉ một lần nhận", async () => {
    const r = await imported([returnRow({ "Return Status": "Completed" })]);
    expect(r.received).toBe(0);
    const values = await Promise.all(
      Array.from({ length: 8 }, (_, i) =>
        receiveReturn(i % 2 ? staff : other, receive()),
      ),
    );
    expect(values.filter((r) => r.outcome === "received")).toHaveLength(1);
    expect(values.filter((r) => r.outcome === "duplicate")).toHaveLength(7);
    const state = await returnList(admin, {});
    expect(state.totals).toMatchObject({ received: 1, full: 0 });
  });
  it("retry cùng request không thêm log; đổi payload cùng request bị chặn; mã lạ không tạo kiện", async () => {
    await imported();
    const d = receive();
    const a = await receiveReturn(staff, d),
      b = await receiveReturn(staff, d);
    expect(a).toEqual(b);
    expect(
      await sql`SELECT * FROM return_events WHERE action='received'`,
    ).toHaveLength(1);
    await expect(
      receiveReturn(staff, { ...d, code: "OTHER0001" }),
    ).rejects.toMatchObject({ status: 409 });
    expect((await receiveReturn(staff, receive("UNKNOWN001"))).outcome).toBe(
      "unknown",
    );
    expect(await sql`SELECT * FROM return_parcels`).toHaveLength(1);
  });
  it("mã cùng nhiều hồ sơ phải chọn đúng; sai ca và kho không nhận", async () => {
    await imported([
      returnRow(),
      returnRow({ "Return Order ID": "1234567890123456790" }),
    ]);
    const a = await receiveReturn(staff, receive());
    expect(a.outcome).toBe("ambiguous");
    expect(a.candidates).toHaveLength(2);
    expect(
      (
        await receiveReturn(
          staff,
          receive(undefined, { parcelId: a.candidates[1].id }),
        )
      ).outcome,
    ).toBe("received");
    await sql`DELETE FROM shift_members WHERE user_id=${other.id}`;
    await expect(receiveReturn(other, receive())).rejects.toMatchObject({
      status: 403,
    });
  });
  it("kiểm đủ kiểm tra từng SKU, không hoàn thành trước kiểm; nguồn đổi giữ số đã nhận và yêu cầu kiểm lại", async () => {
    const r = await imported();
    await expect(
      updateReturn(admin, {
        id: r.id,
        version: r.version,
        status: "completed",
        note: "Không được hoàn tất giả",
      }),
    ).rejects.toMatchObject({ status: 409 });
    await receiveReturn(staff, receive());
    let d = await returnDetail(admin, r.id);
    await expect(
      inspectReturn(staff, {
        id: r.id,
        version: d.record.version,
        condition: "full",
        note: "Chưa kiểm đếm",
        items: [{ id: d.items[0].id, quantity: 0 }],
      }),
    ).rejects.toMatchObject({ status: 400 });
    await inspectReturn(staff, {
      id: r.id,
      version: d.record.version,
      condition: "full",
      note: "Đã kiểm đúng sản phẩm",
      items: [{ id: d.items[0].id, quantity: 1 }],
    });
    d = await returnDetail(admin, r.id);
    const at = d.parcels[0].received_at;
    await commitReturns(
      admin,
      await parse([
        returnRow({ "Return Status": "In Process", "Return Quantity": "2" }),
      ]),
      "new.csv",
      context(),
    );
    d = await returnDetail(admin, r.id);
    expect(d.items[0].received_qty).toBe(1);
    expect(d.parcels[0].received_at).toEqual(at);
    expect(d.record.inspection_stale).toBe(true);
    await expect(
      inspectReturn(staff, {
        id: r.id,
        version: 1,
        condition: "full",
        note: "Thông tin cũ",
        items: [{ id: d.items[0].id, quantity: 2 }],
      }),
    ).rejects.toMatchObject({ status: 409 });
  });
  it("trạng thái sàn đổi không xóa kiểm đủ; file một phần SKU không làm biến mất sản phẩm cũ", async () => {
    const a = returnRow(),
      b = returnRow({ "SKU ID": "2222222222222222222", "SKU Name": "Red, L" });
    const r = await imported([a, b]);
    await receiveReturn(staff, receive());
    let d = await returnDetail(admin, r.id);
    await inspectReturn(staff, {
      id: r.id,
      version: d.record.version,
      condition: "full",
      note: "Đã kiểm đủ cả hai SKU",
      items: d.items.map((i) => ({ id: i.id, quantity: 1 })),
    });
    await commitReturns(
      admin,
      await parse([
        { ...a, "Return Status": "In Process" },
        { ...b, "Return Status": "In Process" },
      ]),
      "status.csv",
      context(),
    );
    d = await returnDetail(admin, r.id);
    expect(d.record.inspection_stale).toBe(false);
    expect((await returnList(admin, { state: "full" })).totals.requests).toBe(
      1,
    );
    await commitReturns(
      admin,
      await parse([{ ...a, "Return Status": "Completed" }]),
      "partial.csv",
      context(),
    );
    d = await returnDetail(admin, r.id);
    expect(d.items.filter((i) => i.active)).toHaveLength(2);
    expect((await returnList(admin, {})).totals.quantity).toBe(2);
  });
  it("SKU TikTok dùng ID sàn ổn định, đổi tên phân loại không nhân sản phẩm hoặc xóa SKU shop", async () => {
    const a = returnRow({ "Seller SKU": "SHOP-001" });
    const r = await imported([a]);
    await commitReturns(
      admin,
      await parse([{ ...a, "Seller SKU": "", "SKU Name": "Black, size M" }]),
      "rename.csv",
      context(),
    );
    const detail = await returnDetail(admin, r.id);
    expect(detail.items).toHaveLength(1);
    expect(detail.items[0].seller_sku).toBe("SHOP-001");
    expect(detail.items[0].variant).toBe("Black, size M");
  });
  it("nhập cập nhật không mất ghi chú/khiếu nại; mã yêu cầu đổi đơn gốc không được ghi đè", async () => {
    const r = await imported();
    await updateReturn(staff, {
      id: r.id,
      version: r.version,
      note: "Ghi chú giữ nguyên trong lịch sử",
    });
    await saveReturnClaim(admin, {
      caseId: r.id,
      status: "won",
      reason: "Hồ sơ kiểm tra khiếu nại",
      requested: 100000,
      approved: 80000,
      received: null,
      deadline: null,
      receivedOn: null,
    });
    await commitReturns(
      admin,
      await parse([returnRow({ "Return Status": "In Process" })]),
      "new.csv",
      context(),
    );
    const d = await returnDetail(admin, r.id);
    expect(d.claims).toHaveLength(1);
    expect(d.events.some((e) => e.reason.includes("Ghi chú giữ nguyên"))).toBe(
      true,
    );
    const wrong = await parse([
      returnRow({ "Order ID": "586000000000000002" }),
    ]);
    expect((await previewReturns(admin, wrong, context())).canCommit).toBe(
      false,
    );
    await expect(
      commitReturns(admin, wrong, "wrong.csv", context()),
    ).rejects.toMatchObject({ status: 409 });
  });
  it("nhận thiếu, sai, rỗng lưu riêng; hoàn tác không xóa sự kiện và bị chặn sau kiểm", async () => {
    const r = await imported();
    const a = await receiveReturn(staff, receive());
    await undoReturn(staff, {
      eventId: a.eventId,
      reason: "Quét nhầm cần hoàn tác",
    });
    expect((await returnDetail(admin, r.id)).parcels[0].received_at).toBeNull();
    const b = await receiveReturn(staff, receive());
    const d = await returnDetail(admin, r.id);
    await inspectReturn(staff, {
      id: r.id,
      version: d.record.version,
      condition: "empty",
      note: "Mở kiện không có sản phẩm",
      items: [{ id: d.items[0].id, quantity: 0 }],
    });
    await expect(
      undoReturn(staff, {
        eventId: b.eventId,
        reason: "Không được xóa sau kiểm",
      }),
    ).rejects.toMatchObject({ status: 409 });
    expect(
      await sql`SELECT * FROM return_events WHERE action='received'`,
    ).toHaveLength(2);
  });
  it("bồi thường thực nhận bắt buộc ngày, thành công chưa nhận tiền vẫn chưa hoàn tất", async () => {
    const r = await imported([
      returnRow({ "Return Logistics Tracking ID": "" }),
    ]);
    await updateReturn(admin, {
      id: r.id,
      version: r.version,
      noPhysical: true,
      note: "Xác minh sàn không yêu cầu trả vật lý",
    });
    await expect(
      saveReturnClaim(admin, {
        caseId: r.id,
        status: "won",
        reason: "Đã được chấp thuận",
        requested: 100000,
        approved: 80000,
        received: 80000,
        deadline: null,
        receivedOn: null,
      }),
    ).rejects.toMatchObject({ status: 400 });
    const c = await saveReturnClaim(admin, {
      caseId: r.id,
      status: "won",
      reason: "Đã duyệt chưa nhận tiền",
      requested: 100000,
      approved: 80000,
      received: null,
      deadline: null,
      receivedOn: null,
    });
    let d = await returnDetail(admin, r.id);
    await expect(
      updateReturn(admin, {
        id: r.id,
        version: d.record.version,
        status: "completed",
        note: "Còn khiếu nại chưa xong",
      }),
    ).rejects.toMatchObject({ status: 409 });
    await saveReturnClaim(admin, {
      caseId: r.id,
      id: c.id,
      status: "paid",
      reason: "Đã đối chiếu tiền thực nhận",
      requested: 100000,
      approved: 80000,
      received: 80000,
      deadline: null,
      receivedOn: "2026-10-20",
    });
    d = await returnDetail(admin, r.id);
    await updateReturn(admin, {
      id: r.id,
      version: d.record.version,
      status: "completed",
      note: "Đã xong hồ sơ không trả vật lý",
    });
    expect((await returnList(admin, {})).totals.claim_received).toBe("80000");
  });
  it("phân quyền, bổ sung mã và xuất/lọc cùng mẫu số; nguồn/history bất biến", async () => {
    const r = await imported([
      returnRow({ "Return Logistics Tracking ID": "" }),
    ]);
    await expect(
      commitReturns(staff, await parse(), "x.csv", context()),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      updateReturn(staff, {
        id: r.id,
        version: r.version,
        status: "lost",
        note: "Nhân viên không được kết luận mất",
      }),
    ).rejects.toMatchObject({ status: 403 });
    await editReturnParcel(admin, {
      caseId: r.id,
      tracking: "VTPVN1234567890",
      reason: "Đối chiếu mã được sàn bổ sung",
    });
    expect(
      (await returnList(admin, { q: "VTPVN1234567890" })).totals.requests,
    ).toBe(1);
    const a = await returnList(admin, { channel: "TikTok Shop" }, true);
    expect(a.rows.length).toBe(a.totals.requests);
    await expect(sql`DELETE FROM return_snapshots`).rejects.toThrow();
    await expect(
      sql`UPDATE return_events SET reason='changed'`,
    ).rejects.toThrow();
  });
  if (process.env.RETURN_SAMPLE_XLSX)
    it("file TikTok thật: ghép row XML lặp đúng 106/101/89/109, giữ 17 thiếu mã và 66 thiếu Seller SKU", async () => {
      const f = await parseReturnFile(
        await readFile(process.env.RETURN_SAMPLE_XLSX!),
        "sample.xlsx",
      );
      expect(f.errors).toEqual([]);
      expect(f.summary).toMatchObject({
        rows: 106,
        requests: 106,
        orders: 101,
        tracking: 89,
        quantity: 109,
        missingTracking: 17,
        missingSellerSku: 66,
      });
      await commitReturns(admin, f, "sample.xlsx", context());
      expect((await returnList(admin, {})).totals).toMatchObject({
        requests: 106,
        orders: 101,
        parcels: 89,
        quantity: 109,
        received: 0,
        missing_tracking: 17,
      });
      expect(await sql`SELECT * FROM return_snapshots`).toHaveLength(106);
    });
});
