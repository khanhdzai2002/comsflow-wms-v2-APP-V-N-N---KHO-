import ExcelJS from "exceljs";
import { beforeAll, beforeEach, afterAll, describe, it, expect } from "vitest";
import { readFile, readdir } from "node:fs/promises";
import { db, type User } from "../src/lib/db";
import { carrierCatalog, identifyCarrier } from "../src/lib/carriers";
import { parseReturnFile } from "../src/lib/return-import";
import {
  commitReturns,
  previewReturns,
  returnList,
  returnDetail,
  receiveReturn,
  inspectReturn,
  updateReturn,
} from "../src/lib/returns";
import {
  parseSalesFile,
  commitSales,
  salesFields,
} from "../src/lib/sales-import";
import {
  returnAnalytics,
  productComponents,
  componentValues,
} from "../src/lib/return-analytics";
import {
  saveReturnSettings,
  returnImportHistory,
  recordReturnUpload,
} from "../src/lib/return-settings";
import { previewCleanup, executeCleanup } from "../src/lib/maintenance";
import { CLEANUP_CONFIRMATION } from "../src/lib/maintenance-domain";
import { classifyReason, mergeReturnSource } from "../src/lib/return-source";
import { returnCopyContent } from "../src/components/return-detail-info";
import { returnRow, returnCsv } from "./return-fixture";
const url = process.env.TEST_DATABASE_URL;
if (!url || !new URL(url).pathname.endsWith("_test"))
  throw new Error("Chỉ dùng database *_test");
process.env.DATABASE_URL = url;
const sql = db();
let nativeReasonRules: any[] = [];
let admin: User,
  staff: User,
  warehouse: string,
  shift: string,
  carrier: string,
  spx: string;
const context = () => ({ warehouseId: warehouse, shop: "Shop V2" });
const row = (extra: Record<string, string> = {}) =>
  returnRow({
    "Seller SKU": "MIU37",
    "Return Quantity": "2",
    "Return unit price": "100",
    "Return Reason": "wrong size",
    "Return Logistics Tracking ID": "862000000001",
    "Return Logistics Provider": "J&T",
    Color: "Đen",
    Size: "M",
    ...extra,
  });
const parse = (rows = [row()]) =>
  parseReturnFile(returnCsv(rows), "return.csv");
const csv = (rows: Record<string, string>[]) => {
  const h = [
    ...new Set([
      ...Object.values(salesFields),
      ...rows.flatMap((r) => Object.keys(r)),
    ]),
  ];
  return Buffer.from(
    [h, ...rows.map((r) => h.map((k) => r[k] ?? ""))]
      .map((r) => r.map((s) => '"' + s.replaceAll('"', '""') + '"').join(","))
      .join("\n"),
  );
};
const sale = (extra: Record<string, string> = {}) => ({
  "Order ID": "586000000000000001",
  "SKU ID": "1111111111111111111",
  "Seller SKU": "MIU37",
  Quantity: "10",
  "Created Time": "2026-10-01",
  "Order Status": "Delivered",
  Color: "Đen",
  Size: "M",
  ...extra,
});
const salesContext = {
  channel: "TikTok Shop",
  shop: "Shop V2",
  completedStatuses: ["Delivered", "Completed"],
};
async function addSales(rows = [sale()], ctx = salesContext) {
  return commitSales(
    admin,
    await parseSalesFile(csv(rows), "sales.csv", {}, ctx.completedStatuses),
    "sales.csv",
    ctx,
  );
}
async function addReturns(rows = [row()]) {
  return commitReturns(admin, await parse(rows), "returns.csv", context());
}
beforeAll(async () => {
  await sql`DROP SCHEMA public CASCADE`;
  await sql`CREATE SCHEMA public`;
  for (const f of (await readdir("migrations"))
    .filter((f) => f.endsWith(".sql"))
    .sort())
    await sql.unsafe(await readFile("migrations/" + f, "utf8"));
  nativeReasonRules = await sql`SELECT * FROM return_reason_rules WHERE active`;
});
beforeEach(async () => {
  await sql`TRUNCATE users,warehouses,sales_channels,shipping_carriers,system_settings,return_reason_rules CASCADE`;
  const users =
    await sql`INSERT INTO users(name,email,password_hash,role) VALUES('Admin','admin@test.example','unused','admin'),('Staff','staff@test.example','unused','staff') RETURNING *`;
  admin = users[0] as User;
  staff = users[1] as User;
  const [w] = await sql`INSERT INTO warehouses(name) VALUES('V2') RETURNING id`;
  warehouse = w.id;
  const [s] =
    await sql`INSERT INTO work_shifts(name,warehouse_id,starts_at,ends_at) VALUES('V2',${warehouse},now()-interval '1 hour',now()+interval '1 hour') RETURNING id`;
  shift = s.id;
  await sql`INSERT INTO shift_members(shift_id,user_id) VALUES(${shift},${admin.id})`;
  const cs =
    await sql`INSERT INTO shipping_carriers(name) VALUES('J&T Express'),('SPX Express') RETURNING *`;
  carrier = cs[0].id;
  spx = cs[1].id;
  await sql`INSERT INTO carrier_matching_rules(prefix,carrier_id) VALUES('86',${carrier}),('SPXVN',${spx})`;
  await sql`INSERT INTO carrier_aliases(alias,carrier_id) VALUES('jt',${carrier}),('spx',${spx})`;
  await sql`INSERT INTO return_reason_rules(phrase,group_key) VALUES('wrong size','size'),('change of mind','mind')`;
});
afterAll(() => sql.end());
describe("Đơn hoàn V2: nguồn, nhận diện và tỷ lệ thật", () => {
  it("dùng chung hãng, ưu tiên tên hợp lệ, mâu thuẫn được đánh dấu; unknown không mặc định theo sàn", async () => {
    const catalog = await carrierCatalog(sql);
    expect(identifyCarrier(catalog, "862000000001").carrierId).toBe(carrier);
    expect(identifyCarrier(catalog, "SPXVN999999", "J&T")).toMatchObject({
      carrierId: carrier,
      origin: "file",
      conflict: true,
    });
    expect(identifyCarrier(catalog, "854160000001")).toMatchObject({
      carrierId: null,
      carrier: "Chưa xác định",
    });
    expect(
      identifyCarrier(catalog, "862000000001", "SPX", carrier).carrierId,
    ).toBe(carrier);
    await addReturns();
    const list = await returnList(admin, {});
    expect(list.rows[0].return_carriers).toBe("J&T Express");
    expect(
      (await returnDetail(admin, list.rows[0].id)).parcels[0].identification
        .carrierId,
    ).toBe(carrier);
  });
  it("thêm alias/quy tắc hãng mới không sửa mã; danh mục không trùng theo tên gọi chuẩn", async () => {
    await saveReturnSettings(admin, {
      kind: "alias",
      alias: "Giao Nhanh",
      carrierId: carrier,
    });
    expect(
      identifyCarrier(await carrierCatalog(sql), "NOHINT", "Giao Nhanh")
        .carrierId,
    ).toBe(carrier);
    await sql`INSERT INTO carrier_matching_rules(prefix,carrier_id) VALUES('NEW',${spx})`;
    expect(identifyCarrier(await carrierCatalog(sql), "NEW123").carrierId).toBe(
      spx,
    );
    await expect(
      saveReturnSettings(staff, {
        kind: "alias",
        alias: "x",
        carrierId: carrier,
      }),
    ).rejects.toMatchObject({ status: 403 });
  });
  it("lọc hãng, tìm vận đơn trả và sắp xếp; legacy/null carrier được phân giải cùng service", async () => {
    await addReturns();
    const first = (
      await returnList(admin, {
        carrier: carrier,
        q: "862000000001",
        sort: "carrier",
      })
    ).rows;
    expect(first).toHaveLength(1);
    expect((await returnList(admin, { carrier: spx })).rows).toHaveLength(0);
    await sql`UPDATE return_parcels SET carrier_id=NULL`;
    expect((await returnList(admin, { carrier })).rows).toHaveLength(1);
  });
  it("cập nhật giữ nhận kiện/ghi chú/phân công và ô trống không xoá tài chính hoặc thông tin nguồn", async () => {
    await addReturns([
      row({
        "Seller Return Shipping Fee": "12000",
        "Other Return Fee": "2000",
      }),
    ]);
    const initial = (await returnList(admin, {})).rows[0];
    await receiveReturn(admin, {
      code: "862000000001",
      requestId: crypto.randomUUID(),
      warehouseId: warehouse,
      shiftId: shift,
    });
    let detail = await returnDetail(admin, initial.id);
    await updateReturn(admin, {
      id: initial.id,
      version: detail.record.version,
      status: "checking",
      assignedTo: admin.id,
      note: "Ghi chú nội bộ được giữ",
    });
    const next = await parse([
      row({
        "Return Status": "Approved",
        "Seller SKU": "",
        "Return unit price": "",
        "Return Logistics Tracking ID": "",
        "Seller Return Shipping Fee": "",
        "Other Return Fee": "",
      }),
    ]);
    const preview = await previewReturns(admin, next, context());
    expect(preview.updateSummary.status).toBe(1);
    expect(preview.updateSummary.finance).toBe(0);
    await commitReturns(admin, next, "update.csv", {
      ...context(),
      previewFingerprint: preview.previewFingerprint,
    });
    detail = await returnDetail(admin, initial.id);
    expect(detail.record.processing_status).toBe("checking");
    expect(detail.record.assigned_to).toBe(admin.id);
    expect(detail.parcels[0].received_at).toBeTruthy();
    expect(detail.items[0].unit_amount).toBe("100");
    expect(detail.record.source_data[0].meta).toMatchObject({
      sellerReturnFee: 12000,
      otherReturnFee: 2000,
    });
    expect(
      detail.events.some((e) => e.reason === "Ghi chú nội bộ được giữ"),
    ).toBe(true);
    const raw = await sql`SELECT raw FROM return_snapshots ORDER BY import_id`;
    expect(raw.some((r) => r.raw["Return unit price"] === "")).toBe(true);
  });
  it("import lại không tạo trùng; lịch sử từng trường trước/sau và hai loại phí không trộn", async () => {
    const file = await parse([
      row({
        "Seller Return Shipping Fee": "12000",
        "Other Return Fee": "2000",
      }),
    ]);
    const initial = await commitReturns(admin, file, "first.csv", context());
    expect(
      (await commitReturns(admin, file, "same.csv", context())).reused,
    ).toBe(true);
    const next = await parse([
      row({
        "Return Status": "Approved",
        "Seller Return Shipping Fee": "15000",
        "Other Return Fee": "3000",
      }),
    ]);
    expect(
      (await previewReturns(admin, next, context())).updateSummary.finance,
    ).toBe(1);
    const batch = await commitReturns(admin, next, "update.csv", context());
    const changes = await returnImportHistory(admin, batch.id);
    expect(changes.flatMap((c) => c.changes)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          field: expect.stringContaining(":sellerReturnFee"),
          before: 12000,
          after: 15000,
        }),
        expect.objectContaining({
          field: expect.stringContaining(":otherReturnFee"),
          before: 2000,
          after: 3000,
        }),
      ]),
    );
    expect(await sql`SELECT id FROM return_cases`).toHaveLength(1);
    expect(
      await sql`SELECT import_id FROM return_import_results WHERE import_id=${initial.id}`,
    ).toHaveLength(1);
  });
  it("xem trước có phiên bản; dữ liệu thay đổi sau preview không ghi đè", async () => {
    await addReturns();
    const next = await parse([row({ "Return Status": "Approved" })]),
      p = await previewReturns(admin, next, context());
    const r = (await returnList(admin, {})).rows[0];
    await updateReturn(admin, {
      id: r.id,
      version: r.version,
      note: "Thao tác đồng thời sau preview",
    });
    await expect(
      commitReturns(admin, next, "update.csv", {
        ...context(),
        previewFingerprint: p.previewFingerprint,
      }),
    ).rejects.toMatchObject({ status: 409 });
    expect((await returnDetail(admin, r.id)).record.platform_status).toBe(
      "To Process",
    );
  });
  it("nguồn chỉ có một phần SKU không làm giảm nguồn/số lượng của SKU khác", async () => {
    const file = await parse([
      row(),
      row({ "SKU ID": "2222222222222222222", "Seller SKU": "MIU66" }),
    ]);
    await commitReturns(admin, file, "two.csv", context());
    await addReturns([row({ "Return Status": "Approved" })]);
    const d = await returnDetail(
      admin,
      (await returnList(admin, {})).rows[0].id,
    );
    expect(d.items).toHaveLength(2);
    expect(d.record.source_data).toHaveLength(2);
  });
  it("sao chép đúng đơn được chọn, tách tiền yêu cầu/được duyệt/thực nhận", async () => {
    await addReturns();
    const d = await returnDetail(
      admin,
      (await returnList(admin, {})).rows[0].id,
    );
    const copy = returnCopyContent(d);
    expect(copy).toContain("Mã vận đơn hoàn: 862000000001");
    expect(copy).toContain("MIU37");
    expect(copy).toContain("SL 2");
    expect(returnCopyContent(d, true)).toContain("Lý do sàn: wrong size");
  });
  it("lý do chuẩn chỉ từ lý do gốc, không lấy buyer note; giữ nhóm mâu thuẫn ở other", async () => {
    expect(
      classifyReason("unknown", [
        { phrase: "damaged", group_key: "damaged", active: true },
      ]),
    ).toBe("other");
    expect(
      classifyReason("wrong size damaged", [
        { phrase: "wrong size", group_key: "size", active: true },
        { phrase: "damaged", group_key: "damaged", active: true },
      ]),
    ).toBe("other");
    await addReturns([
      row({ "Return Reason": "unknown", "Buyer Note": "wrong size" }),
    ]);
    const a = await returnAnalytics(admin, {});
    expect(a.reasons[0]).toMatchObject({
      key: "other",
      requests: 1,
      value: 200,
    });
  });
  it("không có nguồn bán thì tỷ lệ null; nhập nguồn bán thật liên kết theo kỳ bán thay vì kỳ hoàn", async () => {
    await addReturns();
    let a = await returnAnalytics(admin, {});
    expect(a.products[0]).toMatchObject({ sold: 0, returned: 2, rate: null });
    await addSales();
    a = await returnAnalytics(admin, { from: "2026-10-01", to: "2026-10-05" });
    expect(a.requests).toBe(0);
    expect(a.products[0]).toMatchObject({ sold: 10, returned: 2, rate: 20 });
  });
  it("đối chiếu đúng shop/sàn; thiếu liên kết không tạo tỷ lệ 0 giả", async () => {
    await addReturns();
    await addSales([sale({ "Order ID": "DIFFERENT-ORDER" })]);
    const a = await returnAnalytics(admin, {});
    expect(a.source.unlinkedReturns).toBe(1);
    expect(a.products[0].rate).toBeNull();
    const b = await returnAnalytics(admin, { shop: "Other shop" });
    expect(b.products).toHaveLength(0);
  });
  it("nguồn bán nhập lại không cộng trùng; file cập nhật huỷ bán loại khỏi mẫu số", async () => {
    await addReturns();
    await addSales();
    expect((await addSales()).reused).toBe(true);
    expect((await returnAnalytics(admin, {})).products[0].sold).toBe(10);
    await addSales([sale({ "Order Status": "Canceled" })]);
    expect((await returnAnalytics(admin, {})).products[0].rate).toBeNull();
  });
  it("combo không tự suy đoán; định lượng 2+3 và phân bổ tiền không tăng tổng", async () => {
    expect(productComponents("MAN8688", [])).toBeNull();
    expect(productComponents("MIU2322", [])).toBeNull();
    const components = [
      { code: "MAN86", quantity: 2, weight: 2 },
      { code: "MAN88", quantity: 3, weight: 3 },
    ];
    await saveReturnSettings(admin, {
      kind: "components",
      sku: "MAN8688",
      components,
    });
    await addReturns([row({ "Seller SKU": "MAN8688" })]);
    await addSales([sale({ "Seller SKU": "MAN8688" })]);
    const a = await returnAnalytics(admin, {});
    expect(a.products.map((p) => p.returned).sort()).toEqual([4, 6]);
    expect(a.products.map((p) => p.sold).sort()).toEqual([20, 30]);
    expect(a.products.reduce((n, p) => n + p.value, 0)).toBe(200);
    expect(
      componentValues(101, components).reduce<number>(
        (n, v) => n + (v ?? 0),
        0,
      ),
    ).toBe(101);
  });
  it("lọc đã chấp thuận khác nhận thực tế; không lấy hoàn tiền thành công làm kho đã nhận", async () => {
    await addReturns([row({ "Return Status": "Approved" })]);
    await addSales();
    expect(
      (await returnAnalytics(admin, { type: "approved" })).products[0].returned,
    ).toBe(2);
    expect(
      (await returnAnalytics(admin, { type: "received" })).products[0].returned,
    ).toBe(0);
    const r = (await returnList(admin, {})).rows[0];
    await receiveReturn(admin, {
      code: "862000000001",
      requestId: crypto.randomUUID(),
      warehouseId: warehouse,
      shiftId: shift,
    });
    let d = await returnDetail(admin, r.id);
    await inspectReturn(admin, {
      id: r.id,
      version: d.record.version,
      condition: "short",
      location: "V2",
      note: "Kiểm nhận thiếu thực tế",
      items: d.items.map((i) => ({ id: i.id, quantity: 1 })),
    });
    d = await returnDetail(admin, r.id);
    expect(d.record.platform_status).toBe("Approved");
    expect(
      (await returnAnalytics(admin, { type: "received" })).products[0],
    ).toMatchObject({ returned: 1, rate: 10 });
  });
  it("ngưỡng màu, min sales, màu và size dùng cùng phạm vi tử/mẫu", async () => {
    await addReturns();
    await addSales();
    await saveReturnSettings(admin, {
      kind: "thresholds",
      low: 10,
      high: 30,
      approvedStatuses: ["Approved"],
    });
    expect(
      (await returnAnalytics(admin, { color: "Đen", size: "M" })).products[0],
    ).toMatchObject({ rate: 20, tone: "attention" });
    expect(
      (await returnAnalytics(admin, { minSold: 11 })).products,
    ).toHaveLength(0);
    expect(
      (await returnAnalytics(admin, { color: "Trắng" })).products[0].rate,
    ).toBeNull();
  });
  it("lỗi dữ liệu bán không nhập một phần; SKU/đơn dài và ngày thật được bảo vệ", async () => {
    const file = await parseSalesFile(
      csv([sale(), sale({ "Order ID": "2", Quantity: "bad" })]),
      "sales.csv",
    );
    expect(file.errors).toHaveLength(1);
    await expect(
      commitSales(admin, file, "bad.csv", salesContext),
    ).rejects.toMatchObject({ status: 400 });
    expect(await sql`SELECT id FROM successful_sales`).toHaveLength(0);
    const broken = await parseSalesFile(
      csv([sale({ "SKU ID": "1.23456E+18" })]),
      "s.csv",
    );
    expect(broken.errors).toHaveLength(1);
    await expect(
      commitSales(
        staff,
        await parseSalesFile(csv([sale()]), "s.csv"),
        "s.csv",
        salesContext,
      ),
    ).rejects.toMatchObject({ status: 403 });
  });
  it("lưu lần đọc lỗi, chỉ summary giữ sau dọn; chi tiết diff bị xoá cùng hồ sơ", async () => {
    await recordReturnUpload(
      admin,
      "bad.csv",
      { channel: "TikTok Shop", shop: "Shop V2" },
      { errors: 1 },
      ["Thiếu SKU"],
    );
    expect(await sql`SELECT id FROM return_upload_attempts`).toHaveLength(1);
    await addReturns();
    const r = (await returnList(admin, {})).rows[0];
    await sql`UPDATE return_cases SET processing_status='closed_unsuccessful',requested_at='2020-01-01',updated_at='2020-01-01' WHERE id=${r.id}`;
    const [oldImport] =
      await sql`INSERT INTO return_imports(file_hash,filename,shop_id,warehouse_id,rows_count,summary,created_by,created_at) VALUES('old-fixture','old.csv',${r.shop_id},${warehouse},1,'{}',${admin.id},'2020-01-01') RETURNING id`;
    const [oldCase] =
      await sql`INSERT INTO return_cases(shop_id,warehouse_id,external_id,order_code,requested_at,platform_status,return_type,source_data,source_hash,last_import_id,processing_status,updated_at) VALUES(${r.shop_id},${warehouse},'OLD-FIXTURE','OLD-ORDER','2020-01-01','Closed','refund','[]','old-fixture',${oldImport.id},'closed_unsuccessful','2020-01-01') RETURNING id`;
    await sql`INSERT INTO return_import_changes(import_id,case_id,external_id,changes) VALUES(${oldImport.id},${oldCase.id},'OLD-FIXTURE','[{"field":"status","before":"Open","after":"Closed"}]')`;
    await sql`INSERT INTO return_import_results(import_id,new_count,updated_count,unchanged_count,status_count,finance_count) VALUES(${oldImport.id},1,0,0,0,0)`;
    const p = await previewCleanup(admin, {
      kind: "returns",
      before: "2021-01-01",
      warehouse,
    });
    expect(p.summary.selected).toBe(1);
    await executeCleanup(admin, {
      jobId: p.id,
      confirmation: CLEANUP_CONFIRMATION,
      acknowledge: true,
      reason: "Dọn hồ sơ fixture đã kết thúc",
    });
    expect(
      await sql`SELECT id FROM return_import_changes WHERE case_id=${oldCase.id}`,
    ).toHaveLength(0);
    expect(
      await sql`SELECT id FROM return_import_changes WHERE case_id=${r.id}`,
    ).toHaveLength(1);
    expect(
      await sql`SELECT import_id FROM return_import_results WHERE import_id=${oldImport.id}`,
    ).toHaveLength(1);
    await expect(
      executeCleanup(staff, {
        jobId: p.id,
        confirmation: CLEANUP_CONFIRMATION,
        acknowledge: true,
        reason: "No access permission",
      }),
    ).rejects.toMatchObject({ status: 403 });
  });
  it("merge bảo toàn số 0 tài chính hợp lệ và raw trống của file mới không thành xoá dữ liệu", async () => {
    const before = (
      await parse([row({ "Seller Return Shipping Fee": "12000" })])
    ).rows;
    const after = (
      await parse([
        row({ "Seller Return Shipping Fee": "0", "Return unit price": "" }),
      ])
    ).rows;
    const merged = mergeReturnSource(before, after);
    expect(merged[0].meta?.sellerReturnFee).toBe(0);
    expect(merged[0].unitAmount).toBe(100);
  });
  it("chặn file có thời điểm cập nhật sàn cũ hơn nguồn hiện có", async () => {
    await addReturns([row({ "Return Updated Time": "20/10/2026 10:00:00" })]);
    const next = await parse([
      row({
        "Return Status": "Old",
        "Return Updated Time": "19/10/2026 10:00:00",
      }),
    ]);
    const p = await previewReturns(admin, next, context());
    expect(p.canCommit).toBe(false);
    expect(p.conflicts[0].message).toContain("cũ hơn");
    await expect(
      commitReturns(admin, next, "old.csv", context()),
    ).rejects.toMatchObject({ status: 409 });
  });
  it("bồi thường sàn báo tách biệt tiền thực nhận và được đối chiếu tài chính", async () => {
    await addReturns([
      row({ "Compensation Amount": "50000", "Compensation Status": "Paid" }),
    ]);
    const detail = await returnDetail(
      admin,
      (await returnList(admin, {})).rows[0].id,
    );
    expect(detail.record.source_data[0].meta.platformCompensation).toBe(50000);
    expect(detail.claims).toHaveLength(0);
    const p = await previewReturns(
      admin,
      await parse([row({ "Compensation Amount": "60000" })]),
      context(),
    );
    expect(p.updateSummary.finance).toBe(1);
  });
  it("cùng file bán nhưng đổi cách hiểu trạng thái bị chặn, không im lặng giữ mẫu số sai", async () => {
    await addSales();
    const file = await parseSalesFile(csv([sale()]), "sales.csv", {}, [
      "Canceled",
    ]);
    await expect(
      commitSales(admin, file, "sales.csv", {
        ...salesContext,
        completedStatuses: ["Canceled"],
      }),
    ).rejects.toMatchObject({ status: 409 });
  });
  it("nhận đủ các nhóm lý do có thật trong XLSX TikTok gốc", async () => {
    const path = process.env.RETURN_SAMPLE_XLSX;
    if (!path) return;
    const file = await parseReturnFile(await readFile(path), path);
    expect(file.summary.requests).toBe(106);
    const labels = new Map([
      ["Item too big or too small", "size"],
      ["Change of mind", "mind"],
      ["Ordered wrong size", "size"],
      ["Poor quality", "quality"],
      ["Package or product is damaged", "damaged"],
      ["Product doesn't match description", "description"],
      ["Wrong product sent", "wrong"],
    ]);
    for (const row of file.rows) {
      expect(classifyReason(String(row.meta?.reason), nativeReasonRules)).toBe(
        labels.get(String(row.meta?.reason)),
      );
    }
  });
  it("file bán XLSX có dòng trống vẫn đọc; ô số dài bị làm tròn bị chặn", async () => {
    const book = new ExcelJS.Workbook(),
      sheet = book.addWorksheet("Sales");
    const fields = Object.keys(sale());
    sheet.addRow(fields);
    sheet.getRow(3).values = fields.map(
      (k) => (sale() as Record<string, string>)[k],
    );
    const file = await parseSalesFile(
      Buffer.from(await book.xlsx.writeBuffer()),
      "sales.xlsx",
    );
    expect(file.rows).toHaveLength(1);
    expect(file.errors).toHaveLength(0);
    sheet.getRow(3).getCell(1).value = Number("586000000000000001");
    await expect(
      parseSalesFile(
        Buffer.from(await book.xlsx.writeBuffer()),
        "rounded.xlsx",
      ),
    ).rejects.toMatchObject({ status: 400 });
  });
  it("thiếu đơn giá/giá trị nguồn không biến thành số tiền hoàn bằng 0", async () => {
    await addReturns([row({ "Return unit price": "" })]);
    const data = await returnAnalytics(admin, {});
    expect(data.reasons[0]).toMatchObject({ value: null, missingValue: 1 });
    expect(data.products[0]).toMatchObject({
      value: null,
      missingValue: 1,
      rate: null,
    });
  });
});
