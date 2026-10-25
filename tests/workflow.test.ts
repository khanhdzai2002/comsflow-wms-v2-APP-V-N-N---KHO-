import {
  beforeAll,
  beforeEach,
  afterAll,
  describe,
  it,
  expect,
  vi,
} from "vitest";
// Provider contract stub: operational SQL remains real PostgreSQL. Auth passwords
// belong to Supabase in production; this fixture never supplies a local fallback.
const provider = vi.hoisted(() => ({
  passwords: new Map<string, string>(),
  attempts: new Map<string, number>(),
  tokens: new Map<string, string>(),
}));
vi.mock("../src/lib/supabase", async () => {
  const { db } = await import("../src/lib/db");
  const { default: bcrypt } = await import("bcryptjs");
  return {
    supabase: () => ({
      auth: {
        async getUser(token: string) {
          const id = provider.tokens.get(token);
          return id
            ? { data: { user: { id } }, error: null }
            : { data: { user: null }, error: { status: 401 } };
        },
        async refreshSession() {
          return { data: { session: null }, error: { status: 401 } };
        },
        async signInWithPassword({
          email,
          password,
        }: {
          email: string;
          password: string;
        }) {
          const attempts = provider.attempts.get(email) || 0;
          if (attempts >= 10)
            return { data: { session: null }, error: { status: 429 } };
          const [u] = await db()`SELECT * FROM users WHERE email=${email}`;
          const valid =
            u &&
            (provider.passwords.get(email) === password ||
              (await bcrypt.compare(password, u.password_hash)));
          if (!valid) {
            provider.attempts.set(email, attempts + 1);
            return { data: { session: null }, error: { status: 400 } };
          }
          const token = crypto.randomUUID();
          provider.tokens.set(token, u.auth_user_id);
          return {
            data: {
              user: { id: u.auth_user_id },
              session: {
                access_token: token,
                refresh_token: crypto.randomUUID(),
                expires_in: 3600,
              },
            },
            error: null,
          };
        },
        admin: {
          async createUser(data: { email: string; password: string }) {
            provider.passwords.set(data.email, data.password);
            return { data: { user: { id: crypto.randomUUID() } }, error: null };
          },
        },
      },
    }),
  };
});
import { readFile, readdir } from "node:fs/promises";
import bcrypt from "bcryptjs";
import ExcelJS from "exceljs";
import { db, type User } from "../src/lib/db";
import { scan } from "../src/lib/scan";
import {
  importRows,
  parseFile,
  fields,
  validateRows,
} from "../src/lib/imports";
import { dashboard, shipmentList, myScans } from "../src/lib/queries";
import {
  createHandover,
  confirmHandover,
  cancelHandover,
} from "../src/lib/handover";
import { startOwnShift, assignShift } from "../src/lib/shifts";
import { formatTime, todayVN, normalizeCode } from "../src/lib/domain";
import { login, currentUser } from "../src/lib/auth";
import { parseSourcePdf, analyzeLabelPages } from "../src/lib/pdf-source";
import {
  previewSource,
  commitSource,
  sourceReport,
  listSources,
  setSourceArchived,
} from "../src/lib/source-manifests";
import {
  labelText,
  makePdf,
  bestLabelText,
  largeSourcePdf,
  continuationText,
  splitLabelText,
  shopeeLabelText,
} from "./pdf-fixture";
import {
  bootstrapAdmin,
  setupAvailable,
  setupStatus,
} from "../src/lib/bootstrap";

// Never run destructive fixtures against the development or production DB.
const testUrl = process.env.TEST_DATABASE_URL;
if (!testUrl || !new URL(testUrl).pathname.endsWith("_test"))
  throw new Error(
    "TEST_DATABASE_URL phải trỏ đến database riêng có tên kết thúc _test",
  );
process.env.DATABASE_URL = testUrl;
const sql = db();
let admin: User, staff: User, other: User, warehouse: string, shift: string;
const row = (overrides: Record<string, string> = {}) => ({
  tracking_code: "SPXVNTEST0001",
  order_id: "SHOPEE-001",
  channel: "Shopee",
  shop: "ComsMiu Test",
  carrier: "SPX Express",
  due_date: todayVN(),
  status: "awaiting_scan",
  sku: "CM-AO",
  product_name: "Áo thun",
  color: "Đen",
  size: "M",
  quantity: "2",
  warehouse: "Kho Test",
  ...overrides,
});
const input = (
  code = "SPXVNTEST0001",
  extra: Record<string, unknown> = {},
) => ({
  code,
  requestId: crypto.randomUUID(),
  shiftId: shift,
  warehouseId: warehouse,
  method: "hid",
  ...extra,
});
async function load(rows = [row()]) {
  return importRows(admin, "test.csv", rows, {});
}
beforeAll(async () => {
  // URL above is guarded to the dedicated disposable *_test database.
  await sql`DROP SCHEMA public CASCADE`;
  await sql`CREATE SCHEMA public`;
  for (const name of (await readdir("migrations"))
    .filter((n) => n.endsWith(".sql"))
    .sort())
    await sql.unsafe(await readFile("migrations/" + name, "utf8"));
});
beforeEach(async () => {
  provider.passwords.clear();
  provider.tokens.clear();
  provider.attempts.clear();
  await sql`TRUNCATE users,warehouses,sales_channels,shipping_carriers,system_settings,login_attempts CASCADE`;
  const hash = await bcrypt.hash("TestPassword!2026", 4);
  const create = async (name: string, role: string) => {
    const [u] =
      await sql`INSERT INTO users(name,email,password_hash,role) VALUES(${name},${name + "@test.example"},${hash},${role}) RETURNING id,name,email,role`;
    await sql`UPDATE users SET auth_user_id=id WHERE id=${u.id}`;
    return u as User;
  };
  admin = await create("admin", "admin");
  staff = await create("staff", "staff");
  other = await create("other", "staff");
  const [w] =
    await sql`INSERT INTO warehouses(name) VALUES('Kho Test') RETURNING id`;
  warehouse = w.id;
  const [s] =
    await sql`INSERT INTO work_shifts(name,warehouse_id,starts_at,ends_at) VALUES('Ca test',${warehouse},now()-interval '1 hour',now()+interval '1 hour') RETURNING id`;
  shift = s.id;
  for (const u of [admin, staff, other])
    await sql`INSERT INTO shift_members(shift_id,user_id) VALUES(${shift},${u.id})`;
});
afterAll(() => sql.end());
describe("Rà soát tính nhất quán vận hành", () => {
  it("quản lý mở ca nhanh idempotent và nhân viên không được tự phân quyền", async () => {
    await sql`DELETE FROM shift_members WHERE user_id=${admin.id}`;
    const results = await Promise.all(
      Array.from({ length: 8 }, () => startOwnShift(admin, warehouse)),
    );
    const a = results[0];
    expect(new Set(results.map((r) => r.id)).size).toBe(1);
    expect(new Date(a.starts_at).getTime()).toBeLessThanOrEqual(Date.now());
    expect(new Date(a.ends_at).getTime()).toBeGreaterThan(Date.now());
    expect(formatTime(a.ends_at)).toContain("00:00:00");
    await expect(startOwnShift(staff, warehouse)).rejects.toMatchObject({
      status: 403,
    });
    await load();
    const r = await scan(
      admin,
      input(undefined, { shiftId: a.id, method: "manual" }),
    );
    expect(r.outcome).toBe("success");
    expect((await sql`SELECT method FROM scan_events`)[0].method).toBe(
      "manual",
    );
  });
  it("thêm/bỏ phân công có hiệu lực nhưng không thay đổi lịch sử quét", async () => {
    await load();
    await scan(staff, input());
    await assignShift(admin, { shiftId: shift, members: [admin.id] });
    await expect(scan(staff, input())).rejects.toMatchObject({ status: 400 });
    expect(await sql`SELECT * FROM scan_events`).toHaveLength(1);
    await assignShift(admin, { shiftId: shift, members: [admin.id, staff.id] });
    expect((await scan(staff, input())).outcome).toBe("duplicate");
    await expect(
      assignShift(staff, { shiftId: shift, members: [staff.id] }),
    ).rejects.toMatchObject({ status: 403 });
  });
  it("không phân công người bị khóa hoặc sửa ca đã kết thúc", async () => {
    await sql`UPDATE users SET active=false WHERE id=${other.id}`;
    await expect(
      assignShift(admin, { shiftId: shift, members: [other.id] }),
    ).rejects.toMatchObject({ status: 400 });
    await sql`UPDATE work_shifts SET starts_at=now()-interval '2 hours',ends_at=now()-interval '1 hour' WHERE id=${shift}`;
    await expect(
      assignShift(admin, { shiftId: shift, members: [admin.id] }),
    ).rejects.toMatchObject({ status: 409 });
  });
  it("mọi KPI mở danh sách cùng tập vận đơn kể cả pending/đã bàn giao/ngoại lệ sau quét", async () => {
    await load([
      row(),
      row({
        tracking_code: "PENDING0001",
        order_id: "PENDING",
        status: "pending",
      }),
      row({
        tracking_code: "CANCELLED001",
        order_id: "CANCEL",
        status: "cancelled",
      }),
    ]);
    await scan(staff, input());
    const [s] =
      await sql`SELECT * FROM shipments WHERE tracking_code='SPXVNTEST0001'`;
    const batch = await createHandover(admin, {
      carrierId: s.carrier_id,
      warehouseId: warehouse,
      shipmentIds: [s.id],
    });
    let d = await dashboard(admin, {});
    for (const [metric, filter] of [
      ["eligible", "eligible"],
      ["scanned", "scanned_any"],
      ["unscanned", "unscanned"],
      ["waiting", "waiting"],
      ["exceptions", "exceptions"],
    ] as const)
      expect((await shipmentList(admin, { status: filter })).total).toBe(
        d[metric],
      );
    await confirmHandover(admin, batch.id);
    d = await dashboard(admin, {});
    expect((await shipmentList(admin, { status: "scanned_any" })).total).toBe(
      d.scanned,
    );
    expect((await shipmentList(admin, { status: "handed_over" })).total).toBe(
      d.handed,
    );
    await load([row({ tracking_code: "REVIEW0001", order_id: "REVIEW" })]);
    await scan(staff, input("REVIEW0001"));
    await sql`UPDATE shipments SET status='review' WHERE tracking_code='REVIEW0001'`;
    d = await dashboard(admin, {});
    expect((await shipmentList(admin, { status: "waiting" })).total).toBe(
      d.waiting,
    );
    expect((await shipmentList(admin, { status: "exceptions" })).total).toBe(
      d.exceptions,
    );
    expect(d.channels[0].unscanned).toBe(1);
  });
  it("trang rỗng không làm mất tổng số kết quả", async () => {
    await load();
    const list = await shipmentList(admin, { page: "2" });
    expect(list.rows).toHaveLength(0);
    expect(list.total).toBe(1);
  });
  it("nhập lại thiếu một kiện không được thay sản phẩm toàn đơn", async () => {
    await load([
      row(),
      row({ tracking_code: "SPXVNTEST0002", sku: "CM-QUAN", quantity: "3" }),
    ]);
    const result = await load([row({ quantity: "99" })]);
    expect(result.imported).toBe(0);
    expect(result.errors[0].message).toContain("thiếu kiện");
    expect(
      (await sql`SELECT sum(quantity)::int qty FROM order_items`)[0].qty,
    ).toBe(5);
  });
  it("hủy nháp giữ lịch sử và cho phép lập phiếu mới", async () => {
    await load();
    await scan(staff, input());
    const [s] = await sql`SELECT * FROM shipments`;
    const data = {
      carrierId: s.carrier_id,
      warehouseId: warehouse,
      shipmentIds: [s.id],
    };
    const first = await createHandover(admin, data);
    await expect(
      cancelHandover(staff, {
        id: first.id,
        reason: "Kiểm tra quyền hủy nháp",
      }),
    ).rejects.toMatchObject({ status: 403 });
    await cancelHandover(admin, {
      id: first.id,
      reason: "Chọn sai phiếu, lập lại sau kiểm tra",
    });
    expect(
      (await sql`SELECT status,scanned_at FROM shipments`)[0],
    ).toMatchObject({ status: "scanned", scanned_at: s.scanned_at });
    expect(
      (
        await sql`SELECT released_at FROM handover_items WHERE batch_id=${first.id}`
      )[0].released_at,
    ).not.toBeNull();
    expect(await sql`SELECT * FROM scan_events`).toHaveLength(1);
    await expect(confirmHandover(admin, first.id)).rejects.toMatchObject({
      status: 409,
    });
    const second = await createHandover(admin, data);
    await confirmHandover(admin, second.id);
    expect(await sql`SELECT * FROM handover_items`).toHaveLength(2);
    await expect(
      cancelHandover(admin, {
        id: second.id,
        reason: "Không được hủy phiếu đã xác nhận",
      }),
    ).rejects.toMatchObject({ status: 409 });
  });
  it("xác nhận và hủy đồng thời không tạo trạng thái nửa bàn giao", async () => {
    await load();
    await scan(staff, input());
    const [s] = await sql`SELECT * FROM shipments`;
    const batch = await createHandover(admin, {
      carrierId: s.carrier_id,
      warehouseId: warehouse,
      shipmentIds: [s.id],
    });
    const results = await Promise.allSettled([
      confirmHandover(admin, batch.id),
      cancelHandover(admin, {
        id: batch.id,
        reason: "Thử hủy đồng thời với xác nhận",
      }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const [after] =
      await sql`SELECT * FROM handover_batches WHERE id=${batch.id}`;
    const [shipment] = await sql`SELECT * FROM shipments`;
    expect(shipment.status).toBe(
      after.status === "confirmed" ? "handed_over" : "scanned",
    );
    expect(Boolean(shipment.handed_at)).toBe(after.status === "confirmed");
  });
});
describe("Thiết lập Admin lần đầu qua web", () => {
  const secret = "integration-only-setup-token-32-characters";
  const payload = {
    token: secret,
    name: "Quản trị thử nghiệm",
    email: "FIRST@TEST.EXAMPLE",
    password: "IntegrationOnlyPassword!2026",
  };
  it("phân biệt thiếu mã, mã sai độ dài và tài khoản đã có mà không lộ bí mật", async () => {
    for (const value of [undefined, ""])
      expect(await setupStatus(value)).toMatchObject({
        available: false,
        code: "SETUP_TOKEN_MISSING",
      });
    for (const value of ["short", "x".repeat(257)])
      expect(await setupStatus(value)).toMatchObject({
        available: false,
        code: "SETUP_TOKEN_INVALID",
      });
    const status = await setupStatus(secret);
    expect(status).toMatchObject({ available: false, code: "USERS_EXIST" });
    const serialized = JSON.stringify(status);
    expect(serialized).not.toContain(secret);
    expect(serialized).not.toContain(admin.email);
    expect((await sql`SELECT count(*)::int count FROM users`)[0].count).toBe(3);
  });
  it("đóng nếu thiếu mã hoặc database đã có bất kỳ tài khoản nào", async () => {
    expect(await setupAvailable(undefined)).toBe(false);
    expect(await setupAvailable("short")).toBe(false);
    expect(await setupAvailable(secret)).toBe(false);
    await expect(bootstrapAdmin(payload, undefined)).rejects.toThrow(
      "chưa được bật",
    );
    await expect(bootstrapAdmin(payload, secret)).rejects.toThrow(
      "đã có tài khoản",
    );
    expect((await sql`SELECT count(*)::int count FROM users`)[0].count).toBe(3);
  });
  it("tạo Admin, hash mật khẩu, tạo session và tự đóng sau thành công", async () => {
    await sql`TRUNCATE users CASCADE`;
    expect(await setupAvailable(secret)).toBe(true);
    expect(await setupStatus(secret)).toMatchObject({
      available: true,
      code: "SETUP_READY",
    });
    const result = await bootstrapAdmin(payload, secret);
    expect(result.user.role).toBe("admin");
    expect(result.user.email).toBe("first@test.example");
    expect((await currentUser(result.token))?.id).toBe(result.user.id);
    expect(await setupAvailable(secret)).toBe(false);
    const [stored] = await sql`SELECT password_hash FROM users`;
    expect(stored.password_hash).not.toBe(payload.password);
    expect(stored.password_hash).toBe("!supabase-auth");
    expect(provider.passwords.get("first@test.example")).toBe(payload.password);
    const logs = await sql`SELECT * FROM audit_logs`;
    expect(logs).toHaveLength(1);
    expect(JSON.stringify(logs)).not.toContain(secret);
    expect(JSON.stringify(logs)).not.toContain(payload.password);
    await expect(
      bootstrapAdmin({ ...payload, email: "other@test.example" }, secret),
    ).rejects.toThrow("đã có tài khoản");
  });
  it("hai trình duyệt đồng thời chỉ tạo một Admin", async () => {
    await sql`TRUNCATE users CASCADE`;
    const results = await Promise.allSettled([
      bootstrapAdmin(payload, secret),
      bootstrapAdmin({ ...payload, email: "second@test.example" }, secret),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((r) => r.status === "rejected")).toHaveLength(1);
    expect((await sql`SELECT count(*)::int count FROM users`)[0].count).toBe(1);
  });
  it("mã thiết lập sai không tạo tài khoản, không tiết lộ hoặc sửa dữ liệu", async () => {
    await sql`TRUNCATE users CASCADE`;
    for (let attempt = 0; attempt < 10; attempt++) {
      await expect(
        bootstrapAdmin({ ...payload, token: "wrong-token" }, secret),
      ).rejects.toThrow("Mã thiết lập không đúng");
    }
    expect(await setupAvailable(secret)).toBe(true);
    expect((await sql`SELECT count(*)::int count FROM users`)[0].count).toBe(0);
  });
});
describe("Nhập dữ liệu thật vào PostgreSQL", () => {
  it("nhập CSV Shopee và XLSX TikTok", async () => {
    const csv = Buffer.from(
      fields.join(",") + "\n" + fields.map((f) => row()[f]).join(","),
    );
    const parsed = await parseFile(csv, "shopee.csv");
    expect(
      (await importRows(admin, "shopee.csv", parsed.rows, {})).newShipments,
    ).toBe(1);
    const book = new ExcelJS.Workbook(),
      sheet = book.addWorksheet("TikTok");
    sheet.columns = fields.map((f) => ({ header: f, key: f }));
    sheet.addRow(
      row({
        tracking_code: "86TIKTOK001",
        order_id: "TT001",
        channel: "TikTok Shop",
        carrier: "J&T Express",
      }),
    );
    const xlsx = await parseFile(
      Buffer.from(await book.xlsx.writeBuffer()),
      "tiktok.xlsx",
    );
    expect(
      (await importRows(admin, "tiktok.xlsx", xlsx.rows, {})).newShipments,
    ).toBe(1);
    expect((await sql`SELECT * FROM shipments`).length).toBe(2);
  });
  it("nhập lại không tăng đơn, kiện hoặc số lượng sản phẩm", async () => {
    await load([
      row(),
      row({ sku: "CM-QUAN", product_name: "Quần", quantity: "1" }),
    ]);
    await load([
      row(),
      row({ sku: "CM-QUAN", product_name: "Quần", quantity: "1" }),
    ]);
    expect((await sql`SELECT * FROM orders`).length).toBe(1);
    expect((await sql`SELECT * FROM shipments`).length).toBe(1);
    expect(
      (await sql`SELECT sum(quantity)::int qty FROM order_items`)[0].qty,
    ).toBe(3);
  });
  it("một đơn nhiều kiện không nhầm số dòng và số vận đơn", async () => {
    const r = await load([
      row(),
      row({ tracking_code: "SPXVNTEST0002", sku: "CM-QUAN" }),
    ]);
    expect(r.orders).toBe(1);
    expect(r.newShipments).toBe(2);
  });
  it("nhập lại giữ nguyên lịch sử quét và bàn giao", async () => {
    await load();
    await scan(staff, input());
    const [s] = await sql`SELECT * FROM shipments`;
    const batch = await createHandover(admin, {
      carrierId: s.carrier_id,
      warehouseId: warehouse,
      shipmentIds: [s.id],
    });
    await confirmHandover(admin, batch.id);
    const r = await load([row({ product_name: "Tên cập nhật" })]);
    expect(r.errors).toHaveLength(0);
    const [after] = await sql`SELECT * FROM shipments`;
    expect(after.status).toBe("handed_over");
    expect(after.scanned_at).toEqual(s.scanned_at);
    expect((await sql`SELECT * FROM scan_events`).length).toBe(1);
  });
  it("không âm thầm đổi hãng hoặc hủy đơn đã quét", async () => {
    await load();
    await scan(staff, input());
    const r = await load([row({ carrier: "GHN", status: "cancelled" })]);
    expect(r.errors).toHaveLength(1);
    expect((await sql`SELECT status FROM shipments`)[0].status).toBe("scanned");
  });
  it("báo lỗi các dòng mâu thuẫn, ngày sai và không nhận file lạ", async () => {
    expect(
      validateRows([row(), row({ carrier: "GHN" })], {}).valid,
    ).toHaveLength(0);
    expect(
      validateRows([row({ due_date: "2026-02-30" })], {}).errors,
    ).toHaveLength(1);
    await expect(parseFile(Buffer.from("bad"), "file.exe")).rejects.toThrow(
      "Chỉ hỗ trợ",
    );
  });
  it("không cập nhật một phần đơn khi một dòng sản phẩm lỗi", async () => {
    await load([row(), row({ sku: "CM-QUAN", quantity: "3" })]);
    const r = await load([
      row({ quantity: "9" }),
      row({ sku: "CM-QUAN", quantity: "0" }),
    ]);
    expect(r.imported).toBe(0);
    expect(r.errors).toHaveLength(2);
    expect(
      (await sql`SELECT sum(quantity)::int qty FROM order_items`)[0].qty,
    ).toBe(5);
  });
  it("từ chối công thức XLSX và tiêu đề cột trùng", async () => {
    const book = new ExcelJS.Workbook(),
      sheet = book.addWorksheet("Sheet");
    sheet.addRow(["tracking_code"]);
    sheet.addRow([{ formula: "1+1", result: 2 }]);
    await expect(
      parseFile(Buffer.from(await book.xlsx.writeBuffer()), "test.xlsx"),
    ).rejects.toThrow("công thức");
    await expect(
      parseFile(Buffer.from("a,a\n1,2"), "test.csv"),
    ).rejects.toThrow("duy nhất");
  });
});
describe("Luồng quét và chống trùng", () => {
  it("trả đúng dữ liệu Shopee, timestamp máy chủ và không tự bàn giao", async () => {
    await load();
    const before = Date.now();
    const r = await scan(staff, input());
    expect(r.outcome).toBe("success");
    expect(r.shipment.channel).toBe("Shopee");
    expect(r.items[0].sku).toBe("CM-AO");
    expect(new Date(r.at).getTime()).toBeGreaterThanOrEqual(before);
    expect(r.shipment.handed_at).toBeNull();
    expect(r.shipment.status).toBe("scanned");
  });
  it("tra cứu TikTok chính xác bằng mã vận đơn", async () => {
    await load([
      row({
        tracking_code: "86TEST0001",
        channel: "TikTok Shop",
        carrier: "J&T Express",
      }),
    ]);
    const r = await scan(staff, input("86TEST0001"));
    expect(r.shipment.channel).toBe("TikTok Shop");
    expect(r.shipment.carrier).toBe("J&T Express");
  });
  it("quét lại hiển thị người, giờ quét lần đầu và không tăng tổng", async () => {
    await load();
    const a = await scan(staff, input());
    const b = await scan(other, input());
    expect(b.outcome).toBe("duplicate");
    expect(b.shipment.first_scanned_by).toBe(staff.name);
    expect(new Date(b.shipment.scanned_at)).toEqual(new Date(a.at));
    expect((await dashboard(admin, {})).scanned).toBe(1);
  });
  it("12 yêu cầu đồng thời từ hai nhân viên chỉ có 1 thành công", async () => {
    await load();
    const outcomes = await Promise.all(
      Array.from({ length: 12 }, (_, i) =>
        scan(i % 2 ? staff : other, input()),
      ),
    );
    expect(outcomes.filter((r) => r.outcome === "success")).toHaveLength(1);
    expect(outcomes.filter((r) => r.outcome === "duplicate")).toHaveLength(11);
    expect(
      (
        await sql`SELECT count(*)::int count FROM scan_events WHERE outcome='success'`
      )[0].count,
    ).toBe(1);
  });
  it("retry cùng request ID là idempotent kể cả khi đồng thời", async () => {
    await load();
    const request = input();
    const [a, b] = await Promise.all([
      scan(staff, request),
      scan(staff, request),
    ]);
    expect(a.id).toBe(b.id);
    expect(a.outcome).toBe("success");
    expect((await sql`SELECT * FROM scan_events`).length).toBe(1);
    await expect(
      scan(staff, { ...request, code: "OTHER-CODE" }),
    ).rejects.toThrow("dữ liệu khác");
    await expect(scan(other, request)).rejects.toThrow("đã được sử dụng");
  });
  it("mã lạ lưu ngoại lệ; gợi ý tiền tố không phải xác nhận", async () => {
    await load();
    const [s] = await sql`SELECT carrier_id FROM shipments`;
    const [c] = await sql`SELECT id FROM sales_channels`;
    await sql`INSERT INTO carrier_matching_rules(prefix,carrier_id,channel_id) VALUES('SPXVN',${s.carrier_id},${c.id})`;
    const request = input("SPXVNUNKNOWN");
    const a = await scan(staff, request);
    await scan(staff, request);
    expect(a.outcome).toBe("unknown");
    expect(a.hint.carrier).toBe("SPX Express");
    expect(a.shipment).toBeNull();
    expect((await sql`SELECT * FROM exception_cases`).length).toBe(1);
  });
  it("mã sai, đơn hủy và đơn chặn không thành công", async () => {
    await load([
      row({ status: "cancelled" }),
      row({
        tracking_code: "BLOCKED0001",
        order_id: "BLOCK-1",
        status: "blocked",
      }),
    ]);
    expect((await scan(staff, input("!"))).outcome).toBe("invalid");
    expect((await scan(staff, input())).outcome).toBe("cancelled");
    expect((await scan(staff, input("BLOCKED0001"))).outcome).toBe("blocked");
    expect(
      (await sql`SELECT * FROM scan_events WHERE outcome='success'`).length,
    ).toBe(0);
  });
  it("sai hãng hoặc sai kho bị chặn, không sửa nguồn", async () => {
    await load();
    const [carrier] =
      await sql`INSERT INTO shipping_carriers(name) VALUES('GHN') RETURNING id`;
    expect(
      (await scan(staff, input(undefined, { carrierId: carrier.id }))).outcome,
    ).toBe("carrier_mismatch");
    const [w] =
      await sql`INSERT INTO warehouses(name) VALUES('Kho khác') RETURNING id`;
    const [s] =
      await sql`INSERT INTO work_shifts(name,warehouse_id,starts_at,ends_at) VALUES('Khác',${w.id},now()-interval '1 hour',now()+interval '1 hour') RETURNING id`;
    await sql`INSERT INTO shift_members(shift_id,user_id) VALUES(${s.id},${staff.id})`;
    expect(
      (
        await scan(
          staff,
          input(undefined, { warehouseId: w.id, shiftId: s.id }),
        )
      ).outcome,
    ).toBe("warehouse_mismatch");
  });
  it("ca hết hạn hoặc không được phân công không thể quét", async () => {
    await load();
    await sql`DELETE FROM shift_members WHERE user_id=${staff.id}`;
    await expect(scan(staff, input())).rejects.toThrow("phân công");
  });
  it("chuẩn hóa mã và đọc QR JSON mà không bịa thông tin", async () => {
    await load();
    expect(normalizeCode(" spxvntest0001 ")).toBe("SPXVNTEST0001");
    expect(
      (await scan(staff, input('{"tracking_code":"spxvntest0001"}'))).outcome,
    ).toBe("success");
  });
});
describe("Bàn giao, báo cáo và phân quyền", () => {
  it("chỉ bàn giao đúng hãng, có bước nháp và xác nhận riêng", async () => {
    await load();
    await scan(staff, input());
    const [s] = await sql`SELECT * FROM shipments`;
    const [wrong] =
      await sql`INSERT INTO shipping_carriers(name) VALUES('Sai hãng') RETURNING id`;
    await expect(
      createHandover(admin, {
        carrierId: wrong.id,
        warehouseId: warehouse,
        shipmentIds: [s.id],
      }),
    ).rejects.toThrow("cùng hãng");
    const b = await createHandover(admin, {
      carrierId: s.carrier_id,
      warehouseId: warehouse,
      shipmentIds: [s.id],
    });
    expect(
      (await sql`SELECT status,handed_at FROM shipments`)[0],
    ).toMatchObject({ status: "awaiting_handover", handed_at: null });
    await confirmHandover(admin, b.id);
    await confirmHandover(admin, b.id);
    expect((await sql`SELECT status FROM shipments`)[0].status).toBe(
      "handed_over",
    );
  });
  it("dashboard, bộ lọc sàn/hãng và đối soát dùng số liệu thực", async () => {
    await load([
      row(),
      row({
        tracking_code: "86TEST0002",
        order_id: "TT-2",
        channel: "TikTok Shop",
        carrier: "J&T Express",
      }),
    ]);
    expect((await dashboard(admin, {})).unscanned).toBe(2);
    await scan(staff, input());
    const d = await dashboard(admin, {});
    expect(d.scanned).toBe(1);
    expect(d.scanRate).toBe(50);
    expect(d.handed).toBe(0);
    const [c] = await sql`SELECT id FROM sales_channels WHERE name='Shopee'`;
    const [ca] =
      await sql`SELECT id FROM shipping_carriers WHERE name='J&T Express'`;
    expect((await dashboard(admin, { channel: c.id })).scanned).toBe(1);
    expect((await dashboard(admin, { carrier: ca.id })).scanned).toBe(0);
    expect(
      (await shipmentList(admin, { status: "unscanned" })).rows,
    ).toHaveLength(1);
    expect(
      (await shipmentList(admin, { status: "waiting" })).rows,
    ).toHaveLength(1);
    expect((await myScans(staff, shift)).summary.success).toBe(1);
  });
  it("không hiển thị tỷ lệ giả khi thiếu đơn dự kiến", async () => {
    expect((await dashboard(admin, {})).scanRate).toBeNull();
  });
  it("nhân viên không import, xem dashboard hoặc xác nhận bàn giao", async () => {
    await expect(importRows(staff, "x", [], {})).rejects.toThrow(
      "không có quyền",
    );
    await expect(dashboard(staff, {})).rejects.toThrow("không có quyền");
    await expect(createHandover(staff, {})).rejects.toThrow("không có quyền");
    await expect(confirmHandover(staff, crypto.randomUUID())).rejects.toThrow(
      "không có quyền",
    );
  });
  it("lịch sử quét và audit bất biến ở database", async () => {
    await load();
    await scan(staff, input());
    await expect(sql`DELETE FROM scan_events`).rejects.toThrow("append-only");
    await expect(sql`UPDATE audit_logs SET reason='tampered'`).rejects.toThrow(
      "append-only",
    );
  });
  it("hiển thị timestamp UTC đúng UTC+7", () => {
    expect(formatTime("2026-10-18T07:32:08Z")).toContain("14:32:08");
  });
  it("đăng nhập hash mật khẩu, hết quyền khi tài khoản bị khóa", async () => {
    const result = await login(staff.email, "TestPassword!2026");
    if ("error" in result) throw new Error("Login failed");
    expect((await currentUser(result.token))?.id).toBe(staff.id);
    await sql`UPDATE users SET active=false WHERE id=${staff.id}`;
    expect(await currentUser(result.token)).toBeNull();
  });
  it("thử sai nhiều lần bị giới hạn và bộ đếm vẫn lưu", async () => {
    for (let i = 0; i < 10; i++)
      expect(await login(staff.email, "wrong")).toEqual({ error: true });
    await expect(login(staff.email, "wrong")).rejects.toThrow("quá nhiều");
  });
  it("RLS được bật trên bảng vận đơn", async () => {
    const [table] =
      await sql`SELECT relrowsecurity FROM pg_class WHERE relname='shipments'`;
    expect(table.relrowsecurity).toBe(true);
  });
});

describe("Nguồn PDF và đối soát từng mã xuất kho", () => {
  async function context() {
    const [carrier] =
      await sql`INSERT INTO shipping_carriers(name) VALUES('J&T Express') ON CONFLICT(name) DO UPDATE SET name=excluded.name RETURNING id`;
    return {
      warehouseId: warehouse,
      carrierId: carrier.id,
      channel: "TikTok Shop",
      shop: "ComsMiu",
      dueDate: todayVN(),
    };
  }
  async function fixture() {
    const pdf = await parseSourcePdf(
      makePdf([
        labelText(),
        labelText(),
        labelText("862000000002", "586000000000000002"),
      ]),
    );
    return { pdf, c: await context() };
  }
  it("lưu đúng 2 kiện từ 3 trang, không tạo sản phẩm giả; nhập lại đồng thời không nhân đôi", async () => {
    const { pdf, c } = await fixture();
    const [a, b] = await Promise.all([
      commitSource(admin, "a.pdf", pdf, c),
      commitSource(admin, "a.pdf", pdf, c),
    ]);
    expect(a.id).toBe(b.id);
    expect([a.reused, b.reused].sort()).toEqual([false, true]);
    const r = await sourceReport(admin, a.id);
    expect(r.totals).toMatchObject({
      expected: 2,
      orders: 2,
      scanned: 0,
      unscanned: 2,
      handed: 0,
      notHanded: 2,
      complete: false,
    });
    expect(r.rows[0].pages).toEqual([1, 2]);
    expect(await sql`SELECT * FROM order_items`).toHaveLength(0);
    expect(await listSources(admin)).toHaveLength(1);
    expect((await previewSource(admin, pdf, c)).differentDueDates).toBe(0);
    await expect(
      commitSource(admin, "a.pdf", pdf, { ...c, shop: "Shop khác" }),
    ).rejects.toMatchObject({ status: 409 });
  });
  it("đã quét đủ khác bàn giao đủ; lượt trùng không tăng tổng và file mới không nhân đôi vận đơn", async () => {
    const { pdf, c } = await fixture();
    const batch = await commitSource(admin, "a.pdf", pdf, c);
    const a = await scan(staff, input("862000000001"));
    const b = await scan(staff, input("862000000002"));
    expect(a.outcome).toBe("success");
    expect(b.outcome).toBe("success");
    expect((await scan(staff, input("862000000001"))).outcome).toBe(
      "duplicate",
    );
    let r = await sourceReport(admin, batch.id);
    expect(r.totals).toMatchObject({
      scanned: 2,
      unscanned: 0,
      scanComplete: true,
      complete: false,
      notHanded: 2,
    });
    const handover = await createHandover(admin, {
      carrierId: c.carrierId,
      warehouseId: c.warehouseId,
      shipmentIds: r.rows.map((r) => r.shipment_id),
      note: "Đối soát nguồn PDF",
    });
    expect((await sourceReport(admin, batch.id)).totals.complete).toBe(false);
    await confirmHandover(admin, handover.id);
    r = await sourceReport(admin, batch.id);
    expect(r.totals).toMatchObject({ handed: 2, complete: true });
    const another = await commitSource(
      admin,
      "b.pdf",
      { ...pdf, hash: "another-file" },
      c,
    );
    expect(another.newShipments).toBe(0);
    expect((await sourceReport(admin, another.id)).totals).toMatchObject({
      expected: 2,
      handedBeforeImport: 2,
      scannedBeforeImport: 2,
      complete: true,
    });
    expect(await sql`SELECT * FROM shipments`).toHaveLength(2);
  });
  it("nguồn không bị giảm tổng khi đơn hủy/chặn; không dựa bộ lọc ngày để báo đủ", async () => {
    const { pdf, c } = await fixture();
    const b = await commitSource(admin, "a.pdf", pdf, c);
    await sql`UPDATE shipments SET status='cancelled',due_date='2020-01-01' WHERE tracking_code='862000000001'`;
    const r = await sourceReport(admin, b.id);
    expect(r.totals).toMatchObject({
      expected: 2,
      unscanned: 2,
      exceptions: 1,
      complete: false,
      scanComplete: false,
    });
    expect(r.rows).toHaveLength(2);
    expect((await previewSource(admin, pdf, c)).differentDueDates).toBe(1);
    const [otherWarehouse] =
      await sql`INSERT INTO warehouses(name) VALUES('Kho khác nguồn') RETURNING id`;
    await sql`UPDATE shipments SET warehouse_id=${otherWarehouse.id} WHERE tracking_code='862000000002'`;
    const changed = await sourceReport(admin, b.id);
    expect(changed.totals.exceptions).toBe(2);
    expect(
      changed.rows.find((r) => r.tracking_code === "862000000002")
        ?.contextChanged,
    ).toBe(true);
  });
  it("PDF có trang lỗi hoặc xung đột không được nhập một phần", async () => {
    const { pdf, c } = await fixture();
    const bad = analyzeLabelPages([labelText(), "image"], "bad");
    await expect(commitSource(admin, "bad.pdf", bad, c)).rejects.toMatchObject({
      status: 400,
    });
    expect(await sql`SELECT * FROM source_manifests`).toHaveLength(0);
    await load([row({ tracking_code: "862000000002" })]);
    expect((await previewSource(admin, pdf, c)).conflicts).toHaveLength(1);
    await expect(
      commitSource(admin, "conflict.pdf", pdf, c),
    ).rejects.toMatchObject({ status: 409 });
    expect(await sql`SELECT * FROM shipments`).toHaveLength(1);
    expect(await sql`SELECT * FROM source_manifests`).toHaveLength(0);
  });
  it("khóa nguồn, chặn nhân viên nhập/xem báo cáo và không nhận hãng chưa hỗ trợ", async () => {
    const { pdf, c } = await fixture();
    const b = await commitSource(admin, "a.pdf", pdf, c);
    await expect(commitSource(staff, "x.pdf", pdf, c)).rejects.toMatchObject({
      status: 403,
    });
    await expect(previewSource(staff, pdf, c)).rejects.toMatchObject({
      status: 403,
    });
    await expect(sourceReport(staff, b.id)).rejects.toMatchObject({
      status: 403,
    });
    await expect(listSources(staff)).rejects.toMatchObject({ status: 403 });
    await expect(
      commitSource(admin, "x.pdf", pdf, { ...c, channel: "Shopee" }),
    ).rejects.toMatchObject({ status: 400 });
    const policies =
      await sql`SELECT relname,relrowsecurity FROM pg_class WHERE relname IN ('source_manifests','source_manifest_items')`;
    expect(policies).toHaveLength(2);
    expect(policies.every((p) => p.relrowsecurity)).toBe(true);
    await expect(
      sql`UPDATE source_manifest_items SET external_id='other' WHERE manifest_id=${b.id}`,
    ).rejects.toThrow("History is append-only");
    await expect(
      sql`DELETE FROM source_manifests WHERE id=${b.id}`,
    ).rejects.toThrow("History is append-only");
  });
  it("bổ sung Excel đầy đủ sản phẩm giữ nguồn và lịch sử quét", async () => {
    const { pdf, c } = await fixture();
    const b = await commitSource(admin, "a.pdf", pdf, c);
    await scan(staff, input("862000000001"));
    const imported = await load([
      row({
        tracking_code: "862000000001",
        order_id: "586000000000000001",
        channel: c.channel,
        shop: c.shop,
        carrier: "J&T Express",
      }),
    ]);
    expect(imported.newShipments).toBe(0);
    expect(imported.updatedShipments).toBe(1);
    expect(await sql`SELECT * FROM order_items`).toHaveLength(1);
    expect((await sourceReport(admin, b.id)).totals).toMatchObject({
      expected: 2,
      scanned: 1,
      unscanned: 1,
    });
  });
  it("loại bỏ nguồn đã bàn giao và khôi phục không mất vận đơn, lịch sử hay nguồn dùng chung", async () => {
    const { pdf, c } = await fixture();
    const a = await commitSource(admin, "wrong.pdf", pdf, c);
    const b = await commitSource(
      admin,
      "shared.pdf",
      { ...pdf, hash: "shared-source" },
      c,
    );
    for (const l of pdf.labels) await scan(staff, input(l.trackingCode));
    const before = await sourceReport(admin, a.id);
    const h = await createHandover(admin, {
      carrierId: c.carrierId,
      warehouseId: c.warehouseId,
      shipmentIds: before.rows.map((r) => r.shipment_id),
    });
    await confirmHandover(admin, h.id);
    await setSourceArchived(
      admin,
      { id: a.id, reason: "Tải nhầm file nguồn cần loại bỏ" },
      true,
    );
    expect((await listSources(admin)).map((r) => r.id)).toEqual([b.id]);
    expect((await listSources(admin, true)).map((r) => r.id)).toEqual([a.id]);
    const removed = await sourceReport(admin, a.id);
    expect(removed.manifest.archived_at).toBeTruthy();
    expect(removed.totals).toMatchObject({
      expected: 2,
      scanned: 2,
      handed: 2,
      complete: false,
      scanComplete: false,
    });
    expect((await sourceReport(admin, b.id)).totals.complete).toBe(true);
    expect(await sql`SELECT * FROM shipments`).toHaveLength(2);
    expect(await sql`SELECT * FROM source_manifest_items`).toHaveLength(4);
    expect(await sql`SELECT * FROM scan_events`).toHaveLength(2);
    expect((await previewSource(admin, pdf, c)).existingManifestArchived).toBe(
      true,
    );
    await expect(
      commitSource(admin, "again.pdf", pdf, c),
    ).rejects.toMatchObject({ status: 409 });
    await setSourceArchived(
      admin,
      { id: a.id, reason: "Khôi phục nguồn sau khi đã kiểm tra" },
      false,
    );
    expect(await listSources(admin)).toHaveLength(2);
    expect(await listSources(admin, true)).toHaveLength(0);
    expect((await sourceReport(admin, a.id)).totals.complete).toBe(true);
    expect((await commitSource(admin, "again.pdf", pdf, c)).reused).toBe(true);
    expect(
      await sql`SELECT * FROM handover_batches WHERE status='confirmed'`,
    ).toHaveLength(1);
  });
  it("loại bỏ/khôi phục đồng thời chỉ ghi nhật ký một lần và không sửa nguồn gốc", async () => {
    const { pdf, c } = await fixture();
    const a = await commitSource(admin, "a.pdf", pdf, c);
    const input = { id: a.id, reason: "Thử loại bỏ và khôi phục đồng thời" };
    await Promise.all(
      Array.from({ length: 6 }, () => setSourceArchived(admin, input, true)),
    );
    expect(await listSources(admin)).toHaveLength(0);
    expect(
      await sql`SELECT * FROM audit_logs WHERE action='source_manifest_archive'`,
    ).toHaveLength(1);
    await Promise.all(
      Array.from({ length: 6 }, () => setSourceArchived(admin, input, false)),
    );
    expect(await listSources(admin)).toHaveLength(1);
    expect(
      await sql`SELECT * FROM audit_logs WHERE action='source_manifest_restore'`,
    ).toHaveLength(1);
    await expect(
      sql`UPDATE source_manifests SET filename='changed' WHERE id=${a.id}`,
    ).rejects.toThrow("History is append-only");
    const [table] =
      await sql`SELECT relrowsecurity FROM pg_class WHERE relname='source_manifest_archives'`;
    expect(table.relrowsecurity).toBe(true);
  });
  it("nhân viên không được loại bỏ/khôi phục; bắt buộc lý do và kiểm tra nguồn tồn tại", async () => {
    const { pdf, c } = await fixture();
    const a = await commitSource(admin, "a.pdf", pdf, c);
    const input = { id: a.id, reason: "Loại bỏ file tải nhầm để kiểm tra" };
    for (const archived of [true, false])
      await expect(
        setSourceArchived(staff, input, archived),
      ).rejects.toMatchObject({ status: 403 });
    await expect(
      setSourceArchived(admin, { ...input, reason: "   " }, true),
    ).rejects.toThrow();
    await expect(
      setSourceArchived(admin, { ...input, id: crypto.randomUUID() }, true),
    ).rejects.toMatchObject({ status: 404 });
    expect(await listSources(admin)).toHaveLength(1);
  });
  it("BEST tự nhận dạng đúng hãng và giữ TikTok Shop là sàn; chọn J&T bị chặn", async () => {
    const pdf = await parseSourcePdf(
      makePdf([bestLabelText(), bestLabelText()]),
    );
    const c = await context();
    const [best] =
      await sql`INSERT INTO shipping_carriers(name) VALUES('BEST Express') ON CONFLICT(name) DO UPDATE SET name=excluded.name RETURNING id`;
    const auto = { ...c, carrierId: "" };
    const preview = await previewSource(admin, pdf, auto);
    expect(preview).toMatchObject({
      carrierId: best.id,
      carrierName: "BEST Express",
      uniqueShipments: 1,
    });
    await expect(
      commitSource(admin, "wrong-name-jt.pdf", pdf, c),
    ).rejects.toMatchObject({ status: 400 });
    expect(await sql`SELECT * FROM source_manifests`).toHaveLength(0);
    const b = await commitSource(admin, "any-name.pdf", pdf, auto);
    const report = await sourceReport(admin, b.id);
    expect(report.manifest).toMatchObject({
      carrier: "BEST Express",
      channel: "TikTok Shop",
    });
    expect(report.rows[0].tracking_code).toBe("TTVN0000000001");
    expect(
      (await scan(staff, input("TTVN0000000001", { carrierId: c.carrierId })))
        .outcome,
    ).toBe("carrier_mismatch");
    expect(
      (await scan(staff, input("TTVN0000000001", { carrierId: best.id })))
        .outcome,
    ).toBe("success");
  });
  it("tự nhận J&T từ tem dù tên file chứa BEST và giữ chặn file không rõ hãng", async () => {
    const { pdf, c } = await fixture();
    expect(
      (await previewSource(admin, pdf, { ...c, carrierId: "" })).carrierName,
    ).toBe("J&T Express");
    const b = await commitSource(admin, "BEST-filename.pdf", pdf, {
      ...c,
      carrierId: "",
    });
    expect((await sourceReport(admin, b.id)).manifest.carrier).toBe(
      "J&T Express",
    );
    const unknown = analyzeLabelPages(["unreadable image"], "image");
    expect(
      (await previewSource(admin, unknown, { ...c, carrierId: "" }))
        .carrierUnresolved,
    ).toBe(true);
    await expect(
      commitSource(admin, "image.pdf", unknown, { ...c, carrierId: "" }),
    ).rejects.toMatchObject({ status: 400 });
  });
  it("nguồn nhiều trang một kiện: lưu đúng membership, số trang tiếp theo và đối soát, retry giữ nguyên", async () => {
    const c = await context();
    const pdf = await parseSourcePdf(
      makePdf([
        splitLabelText(),
        continuationText(),
        splitLabelText(),
        continuationText(),
      ]),
    );
    const b = await commitSource(admin, "split-order.pdf", pdf, c);
    expect(b).toMatchObject({ total: 1, newShipments: 1 });
    const report = await sourceReport(admin, b.id);
    expect(report.manifest).toMatchObject({
      page_count: 4,
      duplicate_pages: 1,
      continuation_pages: 2,
    });
    expect(report.totals).toMatchObject({
      expected: 1,
      orders: 1,
      unscanned: 1,
    });
    const [item] =
      await sql`SELECT pages FROM source_manifest_items WHERE manifest_id=${b.id}`;
    expect(item.pages).toEqual([1, 2, 3, 4]);
    expect((await commitSource(admin, "retry.pdf", pdf, c)).reused).toBe(true);
    await scan(staff, input("862000000001"));
    expect((await sourceReport(admin, b.id)).totals).toMatchObject({
      expected: 1,
      scanned: 1,
      unscanned: 0,
      handed: 0,
    });
    const invalid = analyzeLabelPages(
      [splitLabelText("862000000002"), continuationText("586000000000000002")],
      "wrong-continuation",
    );
    await expect(
      commitSource(admin, "wrong.pdf", invalid, c),
    ).rejects.toMatchObject({ status: 400 });
    expect(await sql`SELECT * FROM shipments`).toHaveLength(1);
  });
  it("nguồn lớn 1.800 đơn: lưu hàng loạt đủ mã/trang, nhập lại không trùng, quét và đối soát bình thường", async () => {
    const pdf = await parseSourcePdf(largeSourcePdf());
    const c = await context();
    const b = await commitSource(admin, "1800-orders.pdf", pdf, c);
    expect(b).toMatchObject({ total: 1800, newShipments: 1800 });
    expect((await sourceReport(admin, b.id)).totals).toMatchObject({
      expected: 1800,
      orders: 1800,
      unscanned: 1800,
    });
    expect((await commitSource(admin, "1800-again.pdf", pdf, c)).reused).toBe(
      true,
    );
    expect(await sql`SELECT * FROM shipments`).toHaveLength(1800);
    expect(await sql`SELECT * FROM orders`).toHaveLength(1800);
    const [last] =
      await sql`SELECT pages FROM source_manifest_items WHERE manifest_id=${b.id} AND tracking_code=${pdf.labels[1799].trackingCode}`;
    expect(last.pages).toEqual([1800]);
    expect(
      (await scan(staff, input(pdf.labels[1799].trackingCode))).outcome,
    ).toBe("success");
    expect((await sourceReport(admin, b.id)).totals).toMatchObject({
      expected: 1800,
      scanned: 1,
      unscanned: 1799,
    });
  });
  it("bulk nhiều kiện cùng đơn và trộn kiện cũ/mới giữ sản phẩm, timestamp và baseline", async () => {
    const c = await context();
    const first = analyzeLabelPages([labelText()], "bulk-first");
    await commitSource(admin, "first.pdf", first, c);
    await scan(staff, input("862000000001"));
    const pdf = analyzeLabelPages(
      [labelText(), labelText("862000000002"), labelText("862000000003")],
      "bulk-mixed",
    );
    const b = await commitSource(admin, "mixed.pdf", pdf, c);
    expect(b.newShipments).toBe(2);
    expect(await sql`SELECT * FROM orders`).toHaveLength(1);
    expect((await sourceReport(admin, b.id)).totals).toMatchObject({
      expected: 3,
      orders: 1,
      scanned: 1,
      scannedBeforeImport: 1,
    });
  });
  it("Shopee tự nhận sàn/hãng, giữ riêng shop cùng tên, quét/CSV bổ sung/đối soát/bàn giao đúng", async () => {
    const c = { ...(await context()), carrierId: "", channel: "" };
    const [spx] =
      await sql`INSERT INTO shipping_carriers(name) VALUES('SPX Express') RETURNING id`;
    const jt = analyzeLabelPages([labelText()], "jt-channel");
    const p = analyzeLabelPages([shopeeLabelText()], "shopee-channel");
    await commitSource(admin, "tiktok.pdf", jt, c);
    const preview = await previewSource(admin, p, c);
    expect(preview).toMatchObject({
      channelName: "Shopee",
      carrierName: "SPX Express",
      uniqueShipments: 1,
    });
    await expect(
      previewSource(admin, p, { ...c, channel: "TikTok Shop" }),
    ).rejects.toMatchObject({ status: 400 });
    const originalContext = await context();
    await expect(
      previewSource(admin, p, { ...c, carrierId: originalContext.carrierId }),
    ).rejects.toMatchObject({ status: 400 });
    const b = await commitSource(admin, "SPX.pdf", p, c);
    expect(await sql`SELECT * FROM shops WHERE name='ComsMiu'`).toHaveLength(2);
    expect((await listSources(admin)).find((r) => r.id === b.id)).toMatchObject(
      { channel: "Shopee", carrier: "SPX Express" },
    );
    const code = p.labels[0].trackingCode;
    expect(
      (await scan(staff, input(code, { carrierId: originalContext.carrierId })))
        .outcome,
    ).toBe("carrier_mismatch");
    const result = await scan(staff, input(code));
    expect(result.shipment).toMatchObject({
      channel: "Shopee",
      carrier: "SPX Express",
      external_id: "261020TEST0001",
    });
    expect((await scan(staff, input(code))).outcome).toBe("duplicate");
    await load([
      row({
        tracking_code: code,
        order_id: "261020TEST0001",
        channel: "Shopee",
        shop: "ComsMiu",
        carrier: "SPX Express",
      }),
    ]);
    const report = await sourceReport(admin, b.id);
    expect(report.totals).toMatchObject({
      expected: 1,
      scanned: 1,
      handed: 0,
      complete: false,
    });
    expect(new Date(report.rows[0].scanned_at)).toEqual(new Date(result.at));
    const [ch] = await sql`SELECT id FROM sales_channels WHERE name='Shopee'`;
    const list = await shipmentList(admin, { channel: ch.id });
    expect(list.rows).toHaveLength(1);
    expect(list.rows[0].tracking_code).toBe(code);
    const handover = await createHandover(admin, {
      carrierId: spx.id,
      warehouseId: warehouse,
      shipmentIds: report.rows.map((r) => r.shipment_id),
    });
    await confirmHandover(admin, handover.id);
    expect((await sourceReport(admin, b.id)).totals).toMatchObject({
      expected: 1,
      handed: 1,
      complete: true,
    });
    expect((await commitSource(admin, "again.pdf", p, c)).reused).toBe(true);
  });
  it("Shopee GHN: tự nhận, chặn chọn sai hãng/sàn, chống trùng và giữ lịch sử khi thêm nguồn", async () => {
    const c = { ...(await context()), carrierId: "", channel: "" };
    const [ghn] =
      await sql`INSERT INTO shipping_carriers(name) VALUES('GHN') RETURNING id`;
    const [spx] =
      await sql`INSERT INTO shipping_carriers(name) VALUES('SPX Express') RETURNING id`;
    const pdf = analyzeLabelPages([shopeeLabelText("GTEST001")], "ghn-source");
    expect(await previewSource(admin, pdf, c)).toMatchObject({
      channelName: "Shopee",
      carrierName: "GHN",
      carrierId: ghn.id,
      uniqueShipments: 1,
      conflicts: [],
    });
    await expect(
      previewSource(admin, pdf, { ...c, channel: "TikTok Shop" }),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      previewSource(admin, pdf, { ...c, carrierId: spx.id }),
    ).rejects.toMatchObject({ status: 400 });
    const b = await commitSource(admin, "SPX-name-does-not-decide.pdf", pdf, c);
    expect((await listSources(admin)).find((s) => s.id === b.id)).toMatchObject(
      { channel: "Shopee", carrier: "GHN", expected: 1 },
    );
    expect(
      (await scan(staff, input("GTEST001", { carrierId: spx.id }))).outcome,
    ).toBe("carrier_mismatch");
    const result = await scan(staff, input("GTEST001"));
    expect(result).toMatchObject({
      outcome: "success",
      shipment: { channel: "Shopee", carrier: "GHN" },
    });
    expect((await scan(staff, input("GTEST001"))).outcome).toBe("duplicate");
    const overlap = await commitSource(
      admin,
      "other-source.pdf",
      { ...pdf, hash: "ghn-overlap" },
      c,
    );
    const report = await sourceReport(admin, overlap.id);
    expect(report.totals).toMatchObject({
      expected: 1,
      scanned: 1,
      handed: 0,
      scannedBeforeImport: 1,
      complete: false,
    });
    expect(new Date(report.rows[0].scanned_at)).toEqual(new Date(result.at));
    const handover = await createHandover(admin, {
      warehouseId: warehouse,
      carrierId: ghn.id,
      shipmentIds: report.rows.map((r) => r.shipment_id),
    });
    await confirmHandover(admin, handover.id);
    expect((await sourceReport(admin, b.id)).totals).toMatchObject({
      expected: 1,
      handed: 1,
      complete: true,
    });
    expect((await commitSource(admin, "again.pdf", pdf, c)).reused).toBe(true);
    expect(await sql`SELECT id FROM shipments`).toHaveLength(1);
    expect((await scan(staff, input("GTEST999"))).outcome).toBe("unknown");
    expect(await sql`SELECT id FROM shipments`).toHaveLength(1);
  });

  if (process.env.GHN_SAMPLE_PDF)
    it("PDF Shopee GHN gốc: 14 mã lưu đúng hãng, quét đủ và bàn giao đủ theo danh sách nguồn", async () => {
      const pdf = await parseSourcePdf(
        await readFile(process.env.GHN_SAMPLE_PDF!),
      );
      expect(pdf.labels).toHaveLength(14);
      expect(pdf.errors).toEqual([]);
      const [ghn] =
        await sql`INSERT INTO shipping_carriers(name) VALUES('GHN') RETURNING id`;
      const c = {
        warehouseId: warehouse,
        carrierId: "",
        channel: "",
        shop: "ComsMiu",
        dueDate: todayVN(),
      };
      expect(await previewSource(admin, pdf, c)).toMatchObject({
        uniqueShipments: 14,
        channelName: "Shopee",
        carrierName: "GHN",
        conflicts: [],
      });
      const b = await commitSource(admin, "sample.pdf", pdf, c);
      expect(b).toMatchObject({ total: 14, newShipments: 14 });
      for (const label of pdf.labels)
        expect(await scan(staff, input(label.trackingCode))).toMatchObject({
          outcome: "success",
          shipment: {
            channel: "Shopee",
            carrier: "GHN",
            external_id: label.orderId,
          },
        });
      const report = await sourceReport(admin, b.id);
      expect(report.totals).toMatchObject({
        expected: 14,
        orders: 14,
        scanned: 14,
        handed: 0,
        complete: false,
      });
      const handover = await createHandover(admin, {
        warehouseId: warehouse,
        carrierId: ghn.id,
        shipmentIds: report.rows.map((r) => r.shipment_id),
      });
      await confirmHandover(admin, handover.id);
      expect((await sourceReport(admin, b.id)).totals).toMatchObject({
        expected: 14,
        handed: 14,
        complete: true,
      });
      expect((await commitSource(admin, "again.pdf", pdf, c)).reused).toBe(
        true,
      );
      expect(await sql`SELECT id FROM shipments`).toHaveLength(14);
      expect(await sql`SELECT id FROM orders`).toHaveLength(14);
    });

  it("migration SPX gợi ý sàn/hãng cho mã lạ, chạy lại không ghi đè quy tắc quản trị", async () => {
    const migration = await readFile(
      "migrations/009_shopee_spx_source.sql",
      "utf8",
    );
    await sql.unsafe(migration);
    await sql.unsafe(migration);
    const unknown = await scan(staff, input("SPXVN00000009999A"));
    expect(unknown.outcome).toBe("unknown");
    expect(unknown.hint).toMatchObject({
      channel: "Shopee",
      carrier: "SPX Express",
    });
    await sql`UPDATE carrier_matching_rules SET active=false WHERE prefix='SPXVN'`;
    await sql.unsafe(migration);
    const [rule] =
      await sql`SELECT active FROM carrier_matching_rules WHERE prefix='SPXVN'`;
    expect(rule.active).toBe(false);
  });
  if (process.env.SHOPEE_SAMPLE_PDF)
    it("PDF Shopee gốc: 15 trang/15 mã/15 đơn, quét đủ chưa bàn giao đủ; xác nhận đủ sau bàn giao", async () => {
      const pdf = await parseSourcePdf(
        await readFile(process.env.SHOPEE_SAMPLE_PDF!),
      );
      expect(pdf).toMatchObject({
        pageCount: 15,
        orderCount: 15,
        duplicatePages: 0,
        continuationPages: 0,
        detectedCarriers: ["SPX Express"],
        detectedChannels: ["Shopee"],
        errors: [],
      });
      expect(pdf.labels).toHaveLength(15);
      await sql`INSERT INTO shipping_carriers(name) VALUES('SPX Express')`;
      const c = {
        warehouseId: warehouse,
        carrierId: "",
        channel: "",
        shop: "ComsMiu",
        dueDate: todayVN(),
      };
      const b = await commitSource(admin, "shopee-real-sample.pdf", pdf, c);
      for (const l of pdf.labels)
        expect((await scan(staff, input(l.trackingCode))).outcome).toBe(
          "success",
        );
      const report = await sourceReport(admin, b.id);
      expect(report.manifest.channel).toBe("Shopee");
      expect(report.totals).toMatchObject({
        expected: 15,
        orders: 15,
        scanned: 15,
        handed: 0,
        complete: false,
      });
      const h = await createHandover(admin, {
        carrierId: report.manifest.carrier_id,
        warehouseId: warehouse,
        shipmentIds: report.rows.map((r) => r.shipment_id),
      });
      await confirmHandover(admin, h.id);
      expect((await sourceReport(admin, b.id)).totals).toMatchObject({
        expected: 15,
        handed: 15,
        complete: true,
      });
    });
  if (process.env.SOURCE_SAMPLE_PDF)
    it("PDF mẫu thực tế: 50 trang = 50 vận đơn = 50 đơn, đủ xuất chỉ sau bàn giao đủ", async () => {
      const pdf = await parseSourcePdf(
        await readFile(process.env.SOURCE_SAMPLE_PDF!),
      );
      expect(pdf.errors).toEqual([]);
      expect(pdf.pageCount).toBe(50);
      expect(pdf.orderCount).toBe(50);
      expect(pdf.labels).toHaveLength(50);
      expect(pdf.duplicatePages).toBe(0);
      const c = await context();
      const b = await commitSource(admin, "sample.pdf", pdf, c);
      for (const l of pdf.labels)
        expect((await scan(staff, input(l.trackingCode))).outcome).toBe(
          "success",
        );
      const r = await sourceReport(admin, b.id);
      expect(r.totals).toMatchObject({
        expected: 50,
        scanned: 50,
        handed: 0,
        scanComplete: true,
        complete: false,
      });
      const h = await createHandover(admin, {
        carrierId: c.carrierId,
        warehouseId: c.warehouseId,
        shipmentIds: r.rows.map((r) => r.shipment_id),
        note: "Kiểm thử toàn bộ PDF mẫu",
      });
      await confirmHandover(admin, h.id);
      expect((await sourceReport(admin, b.id)).totals).toMatchObject({
        expected: 50,
        handed: 50,
        complete: true,
      });
    });
});

describe("Đối soát xuất kho hai chiều", () => {
  it("quét trước CSV: giữ mã chuẩn hóa, người/giờ/ca gốc; quét lặp không cộng trùng, không cần ca còn mở", async () => {
    const request = input(' {"tracking_code":"spxvntest0001"} ');
    const first = await scan(staff, request);
    expect(first).toMatchObject({
      outcome: "unknown",
      pending: true,
      shipment: null,
      code: "SPXVNTEST0001",
    });
    expect(await scan(staff, request)).toEqual(
      JSON.parse(JSON.stringify(first)),
    );
    await scan(other, input());
    expect((await myScans(staff, shift)).summary).toMatchObject({
      success: 0,
      pending: 1,
      error: 0,
    });
    const original =
      await sql`SELECT * FROM scan_events ORDER BY created_at,id`;
    await sql`UPDATE work_shifts SET ends_at=now()-interval '1 second' WHERE id=${shift}`;
    const result = await load();
    expect(result).toMatchObject({
      imported: 1,
      reconciledScans: 1,
      reconciledDuplicates: 1,
    });
    const [shipment] = await sql`SELECT * FROM shipments`;
    expect(shipment).toMatchObject({
      status: "scanned",
      scanned_by: staff.id,
      shift_id: shift,
      scanned_at: original[0].created_at,
      handed_at: null,
    });
    expect(await sql`SELECT * FROM scan_events ORDER BY created_at,id`).toEqual(
      original,
    );
    expect(
      await sql`SELECT outcome FROM effective_scan_events ORDER BY created_at,id`,
    ).toEqual([{ outcome: "success" }, { outcome: "duplicate" }]);
    expect((await myScans(staff, shift)).summary).toMatchObject({
      success: 1,
      pending: 0,
      error: 0,
    });
    const d = await dashboard(admin, {});
    expect(d).toMatchObject({ scanned: 1, unknown: 0, duplicate: 1 });
    expect(
      d.hours.reduce(
        (sum: number, r: { scanned: number }) => sum + r.scanned,
        0,
      ),
    ).toBe(1);
    expect(await scan(staff, request)).toMatchObject({
      id: first.id,
      outcome: "success",
      pending: false,
      reconciled: true,
      shipment: { id: shipment.id, scanned_by: staff.id },
    });
    expect((await load()).reconciledScans).toBe(0);
    expect(await sql`SELECT * FROM scan_reconciliations`).toHaveLength(2);
    expect(
      await sql`SELECT * FROM exception_cases WHERE status='open'`,
    ).toHaveLength(0);
    await expect(
      sql`UPDATE scan_reconciliations SET outcome='duplicate'`,
    ).rejects.toThrow(/append-only/);
    await expect(scan(staff, input())).rejects.toThrow(/ca đang hoạt động/);
  });
  it("quét trước PDF: xem trước báo số chờ, xác nhận tự khớp, báo cáo nguồn giữ quét trước nhập và có thể bàn giao", async () => {
    await sql`INSERT INTO shipping_carriers(name) VALUES('J&T Express')`;
    const first = await scan(staff, input("862000000001"));
    const pdf = analyzeLabelPages([labelText()], "prescan-pdf");
    const context = {
      warehouseId: warehouse,
      shop: "ComsMiu Test",
      dueDate: todayVN(),
    };
    expect((await previewSource(admin, pdf, context)).pendingPrescans).toBe(1);
    const committed = await commitSource(admin, "test.pdf", pdf, context);
    expect(committed).toMatchObject({
      reconciledScans: 1,
      reconciledDuplicates: 0,
    });
    expect(await commitSource(admin, "test.pdf", pdf, context)).toMatchObject({
      reused: true,
      reconciledScans: 0,
    });
    const report = await sourceReport(admin, committed.id);
    expect(report.totals).toMatchObject({
      expected: 1,
      scanned: 1,
      unscanned: 0,
      scannedBeforeImport: 1,
    });
    expect(new Date(report.rows[0].scanned_at)).toEqual(new Date(first.at));
    expect((await scan(other, input("862000000001"))).outcome).toBe(
      "duplicate",
    );
    const handover = await createHandover(admin, {
      warehouseId: warehouse,
      carrierId: report.rows[0].current_carrier_id,
      shipmentIds: [report.rows[0].shipment_id],
    });
    await confirmHandover(admin, handover.id);
    expect((await sourceReport(admin, committed.id)).totals.handed).toBe(1);
  });
  it("không khớp sai kho, hãng đã chọn, mã gần giống, mã không hợp lệ hoặc nguồn hủy/chặn", async () => {
    const [wrongCarrier] =
      await sql`INSERT INTO shipping_carriers(name) VALUES('GHN') RETURNING id`;
    await scan(staff, input(undefined, { carrierId: wrongCarrier.id }));
    await scan(staff, input("OTHER-WAREHOUSE"));
    await scan(staff, input("CANCELLED0001"));
    await scan(staff, input("BLOCKED0001"));
    await scan(staff, input("SPXVNTEST0002"));
    await scan(staff, input("!"));
    const result = await load([
      row(),
      row({
        tracking_code: "OTHER-WAREHOUSE",
        order_id: "OTHER",
        warehouse: "Kho khác",
      }),
      row({
        tracking_code: "CANCELLED0001",
        order_id: "CANCELLED",
        status: "cancelled",
      }),
      row({
        tracking_code: "BLOCKED0001",
        order_id: "BLOCKED",
        status: "blocked",
      }),
    ]);
    expect(result).toMatchObject({ imported: 4, reconciledScans: 0 });
    expect(
      await sql`SELECT * FROM shipments WHERE scanned_at IS NOT NULL`,
    ).toHaveLength(0);
    expect(await sql`SELECT * FROM scan_reconciliations`).toHaveLength(0);
    expect((await myScans(staff, shift)).summary).toMatchObject({
      pending: 5,
      error: 1,
    });
  });
  it("file lỗi không mất mã quét chờ; nhập lại hợp lệ mới tự khớp", async () => {
    await scan(staff, input());
    expect((await load([row({ quantity: "0" })])).imported).toBe(0);
    expect((await myScans(staff, shift)).summary.pending).toBe(1);
    expect((await load()).reconciledScans).toBe(1);
  });
  it("quét và import đồng thời, lặp nhiều yêu cầu: chỉ một lượt thành công và không bỏ lỡ khớp", async () => {
    const [result, ...scans] = await Promise.all([
      load(),
      ...Array.from({ length: 12 }, () => scan(staff, input())),
    ]);
    expect(result.imported).toBe(1);
    expect(scans).toHaveLength(12);
    expect(
      (
        await sql`SELECT count(*)::int n FROM effective_scan_events WHERE outcome='success'`
      )[0].n,
    ).toBe(1);
    expect(
      (
        await sql`SELECT count(*)::int n FROM effective_scan_events WHERE outcome='duplicate'`
      )[0].n,
    ).toBe(11);
    expect((await myScans(staff, shift)).summary.pending).toBe(0);
    expect((await sql`SELECT status FROM shipments`)[0].status).toBe("scanned");
  });
});
