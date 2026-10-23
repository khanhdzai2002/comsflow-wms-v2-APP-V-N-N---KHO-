import { test, expect, type Page } from "@playwright/test";
import ExcelJS from "exceljs";
import { fields } from "../../src/lib/import-fields";
import { todayVN } from "../../src/lib/domain";
import { CLEANUP_CONFIRMATION } from "../../src/lib/maintenance-domain";
const base = process.env.E2E_BASE_URL ?? "http://127.0.0.1:3000";
const headers = { Origin: base };

test("dọn dữ liệu cũ: xem trước, huỷ, xuất danh sách, xác nhận và retry sau mất phản hồi", async ({
  page,
}, info) => {
  const databaseUrl = process.env.DATABASE_URL;
  test.skip(
    !databaseUrl ||
      !["localhost", "127.0.0.1"].includes(new URL(databaseUrl).hostname) ||
      !["localhost", "127.0.0.1"].includes(new URL(base).hostname),
    "Fixture xoá chỉ chạy trên môi trường local có dữ liệu demo",
  );
  const { default: postgres } = await import("postgres");
  const fixture = postgres(databaseUrl!, { max: 1, prepare: false });
  try {
    const [demo] =
      await fixture`SELECT value FROM system_settings WHERE key='demo_mode'`;
    test.skip(
      demo?.value !== true,
      "Không chạy fixture lên database không đánh dấu demo",
    );
    await signIn(page);
    const tick = Date.now(),
      code = `E2E-CLEANUP-${tick}`;
    const created = await page.request.post("/api/config", {
      headers,
      data: { kind: "warehouse", name: `E2E Cleanup ${tick}` },
    });
    expect(created.ok(), await created.text()).toBeTruthy();
    const warehouse = await created.json();
    const { user } = await (await page.request.get("/api/auth/me")).json();
    const [shift] =
      await fixture`INSERT INTO work_shifts(name,warehouse_id,starts_at,ends_at) VALUES('E2E cleanup',${warehouse.id},now()-interval '1 hour',now()+interval '1 hour') RETURNING id`;
    const requestId = crypto.randomUUID();
    await fixture`INSERT INTO scan_events(request_id,raw_code,outcome,user_id,shift_id,warehouse_id,method,created_at,response)
      VALUES(${requestId},${code},'invalid',${user.id},${shift.id},${warehouse.id},'manual','2020-01-01','{}')`;
    await page.reload();
    await navigate(page, "Cấu hình hệ thống");
    const panel = page.locator(".data-maintenance");
    await panel
      .getByRole("combobox", { name: "Kho cần dọn", exact: true })
      .selectOption(warehouse.id);
    await panel
      .getByLabel("Xoá dữ liệu trước ngày", { exact: true })
      .fill("2021-01-01");
    await panel
      .getByRole("button", { name: "Xem trước dữ liệu sẽ xoá", exact: true })
      .click();
    await expect(
      panel
        .locator(".maintenance-preview")
        .getByRole("cell", { name: code, exact: true }),
    ).toBeVisible();
    await expect(panel.locator(".import-state")).toContainText("Chưa xoá");
    const exports = await page.request.get(
      (await panel
        .getByRole("link", { name: "Xuất Excel", exact: true })
        .getAttribute("href")) ?? "",
    );
    expect(exports.ok(), await exports.text()).toBeTruthy();
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(Buffer.from(await exports.body()) as any);
    expect(workbook.worksheets[0].rowCount).toBe(2);
    expect(workbook.worksheets[0].getRow(2).getCell(2).text).toBe(code);
    await panel
      .getByRole("button", { name: "Xoá 1 bản ghi đã xem trước", exact: true })
      .click();
    let dialog = page.getByRole("dialog", {
      name: "Xác nhận xoá vĩnh viễn dữ liệu cũ",
    });
    await expect(
      dialog.getByRole("button", {
        name: "Xoá vĩnh viễn 1 bản ghi",
        exact: true,
      }),
    ).toBeDisabled();
    await dialog.getByRole("button", { name: "Huỷ", exact: true }).click();
    expect(
      await fixture`SELECT id FROM scan_events WHERE request_id=${requestId}`,
    ).toHaveLength(1);
    await panel
      .getByRole("button", { name: "Xoá 1 bản ghi đã xem trước", exact: true })
      .click();
    dialog = page.getByRole("dialog", {
      name: "Xác nhận xoá vĩnh viễn dữ liệu cũ",
    });
    await dialog
      .getByLabel("Lý do dọn dữ liệu", { exact: true })
      .fill(`E2E cleanup confirmed ${tick}`);
    await dialog
      .getByLabel(`Nhập ${CLEANUP_CONFIRMATION} để xác nhận`, { exact: true })
      .fill(CLEANUP_CONFIRMATION);
    await dialog.getByRole("checkbox").check();
    await page.screenshot({
      path: `/tmp/wms-maintenance-confirm-${info.project.name}.png`,
    });
    let jobId = "";
    await page.route("**/api/maintenance/execute", async (route) => {
      const response = await route.fetch();
      expect(response.ok(), await response.text()).toBeTruthy();
      jobId = (await response.json()).id;
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({
          error:
            "E2E mất phản hồi sau khi máy chủ xoá; thử lại cùng lần xem trước",
        }),
      });
    });
    await dialog
      .getByRole("button", { name: "Xoá vĩnh viễn 1 bản ghi", exact: true })
      .click();
    await expect(dialog.getByRole("alert")).toContainText("E2E mất phản hồi");
    expect(
      await fixture`SELECT id FROM scan_events WHERE request_id=${requestId}`,
    ).toHaveLength(0);
    const newRequest = crypto.randomUUID();
    await fixture`INSERT INTO scan_events(request_id,raw_code,outcome,user_id,shift_id,warehouse_id,method,created_at)
      VALUES(${newRequest},${code + "-NEW"},'invalid',${user.id},${shift.id},${warehouse.id},'manual','2020-01-01')`;
    await expect(panel.locator(".import-state")).toContainText(
      "Chưa nhận kết quả xoá",
    );
    await expect(
      panel.getByRole("combobox", { name: "Kho cần dọn", exact: true }),
    ).toBeDisabled();
    await expect(
      dialog.getByRole("button", { name: "Đóng hộp thoại", exact: true }),
    ).toBeVisible();
    await page.unroute("**/api/maintenance/execute");
    await dialog
      .getByRole("button", { name: "Thử lại cùng lần xoá", exact: true })
      .click();
    await expect(panel.locator(".maintenance-result")).toContainText(
      "Lần dọn này đã được xử lý",
    );
    expect(
      await fixture`SELECT id FROM scan_events WHERE request_id=${newRequest}`,
    ).toHaveLength(1);
    expect(
      await fixture`SELECT id FROM audit_logs WHERE action='data_cleanup' AND entity_id=${jobId}`,
    ).toHaveLength(1);
    await panel.locator(".maintenance-heading").scrollIntoViewIfNeeded();
    await page.screenshot({
      path: `/tmp/wms-maintenance-${info.project.name}.png`,
    });
    const csrf = await page.request.post("/api/maintenance/preview", {
      headers: { Origin: "https://untrusted.example" },
      data: { kind: "scans", before: "2021-01-01", warehouse: warehouse.id },
    });
    expect(csrf.status()).toBe(403);
  } finally {
    await fixture.end();
  }
});
for (const role of ["manager", "staff"])
  test(`dọn dữ liệu cũ: ${role} không thấy nút và không gọi được API`, async ({
    page,
  }) => {
    await signIn(page, `${role}@comsflow.demo`, "/#settings");
    await expect(page.locator(".data-maintenance")).toHaveCount(0);
    for (const path of ["preview", "execute", "optimize"]) {
      const response = await page.request.post("/api/maintenance/" + path, {
        headers,
        data: {},
      });
      expect(response.status()).toBe(403);
    }
    expect((await page.request.get("/api/maintenance/storage")).status()).toBe(
      403,
    );
  });
async function signIn(page: Page, email = "admin@comsflow.demo", path = "/") {
  await page.goto(path);
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page
    .getByLabel("Mật khẩu", { exact: true })
    .fill(process.env.DEMO_PASSWORD ?? "ComsFlowDemo!2026");
  await page.getByRole("button", { name: "Đăng nhập", exact: true }).click();
  await expect(
    page.getByText("Dữ liệu mô phỏng để chạy thử.", { exact: false }),
  ).toBeVisible();
}
async function navigate(page: Page, name: string) {
  await page.getByRole("navigation").waitFor({ state: "attached" });
  const menu = page.getByRole("button", { name: "Mở menu" });
  if (await menu.isVisible()) await menu.click();
  await page
    .getByRole("navigation")
    .getByRole("button", { name, exact: true })
    .click();
  if (name === "Quét vận đơn SCAN")
    await page
      .getByRole("combobox", { name: "Kho xử lý", exact: true })
      .selectOption({ label: "Kho ComsMiu" });
}
async function makeShipment(
  page: Page,
  suffix: string,
  warehouse = "Kho ComsMiu",
) {
  const tracking = "E2E" + Date.now() + suffix;
  const row: Record<string, string> = {
    tracking_code: tracking,
    order_id: "E2E-" + tracking,
    channel: "Shopee",
    shop: "E2E DEMO",
    carrier: "SPX Express",
    due_date: todayVN(),
    status: "awaiting_scan",
    sku: "E2E-AO",
    product_name: "Áo DEMO kiểm thử",
    color: "Đen",
    size: "M",
    quantity: "1",
    warehouse,
  };
  const csv = fields.join(",") + "\n" + fields.map((f) => row[f]).join(",");
  const response = await page.request.post("/api/imports/commit", {
    headers,
    multipart: {
      file: {
        name: "e2e-demo.csv",
        mimeType: "text/csv",
        buffer: Buffer.from(csv),
      },
      mapping: "{}",
    },
  });
  expect(response.ok(), await response.text()).toBeTruthy();
  expect((await response.json()).newShipments).toBe(1);
  return tracking;
}
test("nhập tay bị thiếu ca giữ nguyên mã; mở ca nhanh rồi xác nhận đúng phương thức", async ({
  page,
}, info) => {
  await signIn(page);
  const warehouse = "ZZ E2E kho ca " + Date.now();
  const response = await page.request.post("/api/config", {
    headers,
    data: { kind: "warehouse", name: warehouse },
  });
  expect(response.ok()).toBeTruthy();
  const w = await response.json();
  const code = await makeShipment(page, "MANUAL", warehouse);
  await page.reload();
  await navigate(page, "Quét vận đơn SCAN");
  await page
    .getByRole("combobox", { name: "Kho xử lý", exact: true })
    .selectOption(w.id);
  const input = page.getByRole("textbox", { name: "Mã vận đơn", exact: true });
  await input.fill(code);
  await expect(
    page.getByRole("button", { name: "Xác nhận", exact: true }),
  ).toBeDisabled();
  await input.press("Enter");
  await expect(input).toHaveValue(code);
  await expect(page.getByText("Cần chọn ca", { exact: true })).toBeVisible();
  await page
    .getByRole("button", { name: "Mở ca cho tôi", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Xác nhận", exact: true }),
  ).toBeEnabled();
  await expect(input).toHaveValue(code);
  await input.press("Tab");
  await expect(input).toHaveValue(code);
  await expect(
    page.getByText("QUÉT ĐƠN THÀNH CÔNG", { exact: true }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Xác nhận", exact: true }).click();
  await expect(
    page.getByText("QUÉT ĐƠN THÀNH CÔNG", { exact: true }),
  ).toBeVisible();
  const list = await (
    await page.request.get("/api/shipments?q=" + code)
  ).json();
  const detail = await (
    await page.request.get("/api/shipments/" + list.rows[0].id)
  ).json();
  expect(detail.events).toHaveLength(1);
  expect(detail.events[0].method).toBe("manual");
  expect(detail.events[0].warehouse_id).toBe(w.id);
  await page.screenshot({
    path: `/tmp/wms-manual-${info.project.name}.png`,
    fullPage: true,
  });
});
test("nhân viên có hướng dẫn và không tự mở ca hoặc gửi mã khi chưa phân công", async ({
  page,
}) => {
  await signIn(page);
  const warehouse = "ZZ E2E staff " + Date.now();
  const response = await page.request.post("/api/config", {
    headers,
    data: { kind: "warehouse", name: warehouse },
  });
  const w = await response.json();
  const menu = page.getByRole("button", { name: "Mở menu" });
  if (await menu.isVisible()) await menu.click();
  await page.getByTitle("Đăng xuất").click();
  await signIn(page, "staff@comsflow.demo");
  await page
    .getByRole("combobox", { name: "Kho xử lý", exact: true })
    .selectOption(w.id);
  const input = page.getByRole("textbox", { name: "Mã vận đơn", exact: true });
  await input.fill("862572202698");
  await input.press("Enter");
  await expect(input).toHaveValue("862572202698");
  await expect(
    page.getByRole("button", { name: "Mở ca cho tôi", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Xác nhận", exact: true }),
  ).toBeDisabled();
  await navigate(page, "Hướng dẫn sử dụng");
  await expect(
    page.getByRole("heading", {
      name: "Sơ đồ quy trình làm việc",
      exact: true,
    }),
  ).toBeVisible();
  expect(
    (
      await page.request.post("/api/shifts/start-self", {
        headers,
        data: { warehouseId: w.id },
      })
    ).status(),
  ).toBe(403);
});
test("hướng dẫn đủ danh mục, sơ đồ và hiển thị trên điện thoại", async ({
  page,
}, info) => {
  await signIn(page);
  await navigate(page, "Hướng dẫn sử dụng");
  for (const title of [
    "Sơ đồ quy trình làm việc",
    "Kiểm tra trước khi bắt đầu ca",
    "Danh sách vận đơn",
    "Nhập dữ liệu",
    "Bàn giao vận chuyển",
  ])
    await expect(
      page.getByRole("heading", { name: title, exact: true }),
    ).toBeVisible();
  await expect(
    page.getByRole("img", { name: /Nhập dữ liệu và phân công ca/ }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
  ).toBeTruthy();
  await page.screenshot({
    path: `/tmp/wms-guide-${info.project.name}.png`,
    fullPage: true,
  });
});
test("hủy phiếu nháp từ UI giải phóng kiện và giữ lịch sử", async ({
  page,
}) => {
  await signIn(page);
  const code = await makeShipment(page, "CANCEL");
  const refs = await (await page.request.get("/api/references")).json();
  const warehouse = refs.warehouses.find(
    (w: Record<string, any>) => w.name === "Kho ComsMiu",
  );
  const shift = refs.shifts.find(
    (s: Record<string, any>) =>
      s.warehouse_id === warehouse.id &&
      s.assigned &&
      s.warehouse_id ===
        refs.warehouses.find(
          (w: Record<string, any>) => w.name === "Kho ComsMiu",
        ).id &&
      new Date(s.starts_at).getTime() <= Date.now() &&
      new Date(s.ends_at).getTime() > Date.now(),
  );
  expect(
    (
      await page.request.post("/api/scans", {
        headers,
        data: {
          code,
          requestId: crypto.randomUUID(),
          warehouseId: warehouse.id,
          shiftId: shift.id,
          method: "manual",
        },
      })
    ).ok(),
  ).toBeTruthy();
  const list = await (
    await page.request.get("/api/shipments?q=" + code)
  ).json();
  const s = list.rows[0];
  const batch = await (
    await page.request.post("/api/handovers", {
      headers,
      data: {
        carrierId: s.carrier_id,
        warehouseId: s.warehouse_id,
        shipmentIds: [s.id],
        note: "E2E DEMO thử hủy nháp",
      },
    })
  ).json();
  await navigate(page, "Bàn giao vận chuyển");
  const row = page
    .getByRole("row")
    .filter({ hasText: "BG-" + batch.id.slice(0, 8).toUpperCase() });
  await row.getByRole("button", { name: "Hủy nháp", exact: true }).click();
  const modal = page.getByRole("dialog", { name: "Hủy phiếu bàn giao nháp" });
  await modal
    .getByLabel("Lý do hủy nháp")
    .fill("E2E kiểm đếm lại và lập phiếu mới");
  await modal.getByRole("button", { name: "Xác nhận hủy nháp" }).click();
  await expect(row.getByText("Phiếu đã hủy", { exact: true })).toBeVisible();
  const detail = await (
    await page.request.get("/api/shipments/" + s.id)
  ).json();
  expect(detail.shipment.status).toBe("scanned");
  expect(detail.events).toHaveLength(1);
});
test("quản lý cập nhật phân công ca từ giao diện", async ({ page }) => {
  await signIn(page);
  const refs = await (await page.request.get("/api/references")).json();
  const admin = (await (await page.request.get("/api/auth/me")).json()).user;
  const staff = refs.users.find(
    (u: Record<string, any>) => u.email === "staff@comsflow.demo",
  );
  const name = "E2E phân công " + Date.now();
  const response = await page.request.post("/api/shifts", {
    headers,
    data: {
      name,
      warehouseId: refs.warehouses[0].id,
      startsAt: new Date(Date.now() - 60000).toISOString(),
      endsAt: new Date(Date.now() + 3600000).toISOString(),
      members: [admin.id],
    },
  });
  expect(response.ok()).toBeTruthy();
  await page.reload();
  await navigate(page, "Nhân viên & Ca làm việc");
  const row = page.getByRole("row").filter({ hasText: name });
  await row.getByRole("button", { name: "Phân công", exact: true }).click();
  const modal = page.getByRole("dialog");
  await modal.getByRole("checkbox", { name: staff.name, exact: true }).check();
  await modal.getByRole("button", { name: "Lưu phân công" }).click();
  await expect(modal).toHaveCount(0);
  await expect(row).toContainText(staff.name);
});
test("dashboard thật và bố cục responsive", async ({ page }, info) => {
  await signIn(page);
  await expect(
    page.getByRole("heading", { name: "Tổng quan xuất kho", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Theo sàn bán hàng", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: /Vận đơn dự kiến/ }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
  ).toBeTruthy();
  const channel = page.getByRole("combobox", {
    name: "Tất cả sàn",
    exact: true,
  });
  await channel.selectOption({ label: "Shopee" });
  await page.getByRole("button", { name: "Bộ lọc +", exact: true }).click();
  await page.getByRole("button", { name: "Đặt lại", exact: true }).click();
  await expect(channel).toHaveValue("");
  await expect(
    page.getByRole("button", { name: /Vận đơn dự kiến/ }),
  ).toBeVisible();
  await page.screenshot({
    path: `/tmp/comsflow-${info.project.name}.png`,
    fullPage: true,
  });
});
test("HID Enter/Tab, quét trùng và tổng dashboard", async ({ page }) => {
  await signIn(page);
  const code = await makeShipment(page, "A"),
    second = await makeShipment(page, "B");
  await navigate(page, "Quét vận đơn SCAN");
  await page
    .getByRole("button", { name: "Súng quét HID", exact: true })
    .click();
  const input = page.getByRole("textbox", { name: "Mã vận đơn", exact: true });
  await input.fill(code);
  await input.press("Enter");
  await expect(
    page.getByText("QUÉT ĐƠN THÀNH CÔNG", { exact: true }),
  ).toBeVisible();
  await expect(input).toBeFocused();
  await input.fill(code);
  await input.press("Tab");
  await expect(
    page.getByText("ĐƠN NÀY ĐÃ ĐƯỢC QUÉT", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Nhân viên quét lần đầu")).toBeVisible();
  await input.fill(second);
  await input.press("Tab");
  await expect(page.locator(".result-code")).toHaveText(second);
  await expect(
    page.getByText("QUÉT ĐƠN THÀNH CÔNG", { exact: true }),
  ).toBeVisible();
  const dashboard = await (await page.request.get("/api/dashboard")).json();
  expect(dashboard.scanned).toBeGreaterThanOrEqual(2);
  const records = await (
    await page.request.get("/api/shipments?q=" + second)
  ).json();
  const record = await (
    await page.request.get("/api/shipments/" + records.rows[0].id)
  ).json();
  expect(record.events[0].method).toBe("hid");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
  ).toBeTruthy();
});
test("mất phản hồi sau khi lưu: không báo thành công giả, retry không đếm lại", async ({
  page,
}) => {
  await signIn(page);
  const code = await makeShipment(page, "C");
  await navigate(page, "Quét vận đơn SCAN");
  await page.route("**/api/scans", async (route) => {
    await route.fetch();
    await route.abort("failed");
  });
  const input = page.getByRole("textbox", { name: "Mã vận đơn", exact: true });
  await input.fill(code);
  await input.press("Enter");
  await expect(
    page.getByRole("alert").filter({ hasText: "Chưa có xác nhận" }),
  ).toBeVisible();
  await expect(
    page.getByText("QUÉT ĐƠN THÀNH CÔNG", { exact: true }),
  ).toHaveCount(0);
  await page.unroute("**/api/scans");
  await page
    .getByRole("button", { name: new RegExp("Gửi lại yêu cầu " + code) })
    .click();
  await expect(
    page.getByText("QUÉT ĐƠN THÀNH CÔNG", { exact: true }),
  ).toBeVisible();
  const list = await (
    await page.request.get("/api/shipments?q=" + code)
  ).json();
  const detail = await (
    await page.request.get("/api/shipments/" + list.rows[0].id)
  ).json();
  expect(detail.events).toHaveLength(1);
});
test("phân quyền server và bảo vệ CSRF", async ({ page }) => {
  await signIn(page, "staff@comsflow.demo");
  expect((await page.request.get("/api/dashboard")).status()).toBe(403);
  expect(
    (await page.request.post("/api/users", { headers, data: {} })).status(),
  ).toBe(403);
  expect(
    (
      await page.request.post("/api/scans", {
        headers: { Origin: "https://wrong.example" },
        data: {},
      })
    ).status(),
  ).toBe(403);
  expect((await page.request.get("/api/scans/mine")).status()).toBe(200);
  await expect(
    page.getByRole("heading", { name: "Trạm quét vận đơn", exact: true }),
  ).toBeVisible();
});
test("xem trước mọi file CSV và nhập nhiều file có kết quả riêng", async ({
  page,
}) => {
  await signIn(page);
  await navigate(page, "Nhập dữ liệu");
  await page
    .getByRole("tab", { name: "Excel / CSV đơn hàng", exact: true })
    .click();
  const suffix = Date.now();
  const files = [0, 1].map((index) => {
    const code = `E2EMULTI${suffix}${index}`;
    const row: Record<string, string> = {
      tracking_code: code,
      order_id: code,
      channel: "Shopee",
      shop: "E2E nhiều file",
      carrier: "SPX Express",
      due_date: todayVN(),
      status: "awaiting_scan",
      sku: "E2E",
      product_name: "DEMO nhiều file",
      color: "Đen",
      size: "M",
      quantity: "1",
      warehouse: "Kho ComsMiu",
    };
    return {
      name: `e2e-multi-${suffix}-${index}.csv`,
      mimeType: "text/csv",
      buffer: Buffer.from(
        fields.join(",") + "\n" + fields.map((f) => row[f]).join(","),
      ),
    };
  });
  await page
    .getByLabel("File Excel hoặc CSV", { exact: true })
    .setInputFiles(files);
  const button = page.getByRole("button", { name: "Nhập 2 file vào hệ thống" });
  await expect(button).toBeEnabled();
  for (const file of files)
    await expect(
      page.getByRole("cell", { name: file.name, exact: true }),
    ).toBeVisible();
  await button.click();
  await expect(page.getByText(/1\/1 dòng nhập thành công/)).toHaveCount(2);
});
test("nhập CSV trong UI, báo cáo XLSX chứa đúng vận đơn", async ({ page }) => {
  await signIn(page);
  await navigate(page, "Nhập dữ liệu");
  await page
    .getByRole("tab", { name: "Excel / CSV đơn hàng", exact: true })
    .click();
  const code = "E2EIMPORT" + Date.now();
  const row: Record<string, string> = {
    tracking_code: code,
    order_id: "=1+1",
    channel: "TikTok Shop",
    shop: "E2E Import Demo " + code,
    carrier: "J&T Express",
    due_date: todayVN(),
    status: "awaiting_scan",
    sku: "E2E",
    product_name: "DEMO",
    color: "Đen",
    size: "M",
    quantity: "1",
    warehouse: "Kho ComsMiu",
  };
  await page.getByLabel("File Excel hoặc CSV", { exact: true }).setInputFiles({
    name: "e2e-ui.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(
      fields.join(",") + "\n" + fields.map((f) => row[f]).join(","),
    ),
  });
  await expect(
    page.getByRole("button", { name: "Nhập 1 file vào hệ thống" }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "Nhập 1 file vào hệ thống" }).click();
  await expect(page.getByText(/1\/1 dòng nhập thành công/)).toBeVisible();
  const response = await page.request.get(
    "/api/export?q=" + code + "&format=xlsx",
  );
  expect(response.status()).toBe(200);
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(new Uint8Array(await response.body()).buffer);
  const sheet = book.worksheets[0];
  expect(sheet.rowCount).toBe(2);
  expect(sheet.getRow(2).getCell(1).text).toBe(code);
  expect(sheet.getRow(2).getCell(2).text).toBe("'=1+1");
});
test("camera báo lỗi có hướng dẫn khi không có thiết bị", async ({ page }) => {
  await signIn(page);
  await navigate(page, "Quét vận đơn SCAN");
  await page.evaluate(() => {
    Object.defineProperty(navigator.mediaDevices, "getUserMedia", {
      configurable: true,
      value: () =>
        Promise.reject(
          new DOMException(
            "Thiết bị kiểm thử không có camera",
            "NotFoundError",
          ),
        ),
    });
  });
  await page
    .getByRole("button", { name: "Quét bằng camera", exact: true })
    .click();
  await expect(page.getByText(/Không mở được camera:/)).toBeVisible();
  await expect(
    page.getByRole("textbox", { name: "Mã vận đơn", exact: true }),
  ).toBeVisible();
});
test("điều chỉnh bảo toàn lịch sử và bàn giao cần xác nhận riêng", async ({
  page,
}) => {
  await signIn(page);
  const code = await makeShipment(page, "D");
  const refs = await (await page.request.get("/api/references")).json();
  const shift = refs.shifts.find(
    (s: Record<string, any>) =>
      s.assigned &&
      s.warehouse_id ===
        refs.warehouses.find(
          (w: Record<string, any>) => w.name === "Kho ComsMiu",
        ).id &&
      new Date(s.starts_at).getTime() <= Date.now() &&
      new Date(s.ends_at).getTime() > Date.now(),
  );
  const scanned = await page.request.post("/api/scans", {
    headers,
    data: {
      code,
      requestId: crypto.randomUUID(),
      shiftId: shift.id,
      warehouseId: shift.warehouse_id,
      method: "manual",
    },
  });
  expect((await scanned.json()).outcome).toBe("success");
  const list = await (
    await page.request.get("/api/shipments?q=" + code)
  ).json();
  const shipment = list.rows[0];
  const adjustment = await page.request.post("/api/shipments/adjust", {
    headers,
    data: {
      id: shipment.id,
      status: "review",
      reason: "E2E DEMO kiểm tra tem vận đơn",
    },
  });
  expect(adjustment.status()).toBe(200);
  const detail = await (
    await page.request.get("/api/shipments/" + shipment.id)
  ).json();
  expect(detail.events).toHaveLength(1);
  expect(detail.events[0].outcome).toBe("success");
  expect(
    detail.logs.some(
      (a: Record<string, any>) =>
        a.action === "shipment_adjust" &&
        a.before_value.status === "scanned" &&
        a.after_value.status === "review",
    ),
  ).toBeTruthy();
  await page.request.post("/api/shipments/adjust", {
    headers,
    data: {
      id: shipment.id,
      status: "scanned",
      reason: "E2E DEMO đã kiểm tra đủ điều kiện",
    },
  });
  const draftResponse = await page.request.post("/api/handovers", {
    headers,
    data: {
      carrierId: shipment.carrier_id,
      warehouseId: shipment.warehouse_id,
      shipmentIds: [shipment.id],
      note: "E2E DEMO bàn giao nội bộ",
    },
  });
  expect(draftResponse.status()).toBe(200);
  const draft = await draftResponse.json();
  const pending = await (
    await page.request.get("/api/shipments/" + shipment.id)
  ).json();
  expect(pending.shipment.status).toBe("awaiting_handover");
  expect(pending.shipment.handed_at).toBeNull();
  const confirmation = await page.request.post("/api/handovers/confirm", {
    headers,
    data: { id: draft.id },
  });
  expect(confirmation.status()).toBe(200);
  const done = await (
    await page.request.get("/api/shipments/" + shipment.id)
  ).json();
  expect(done.shipment.status).toBe("handed_over");
  expect(done.events).toHaveLength(1);
});

test("PDF nguồn: đếm tem trùng, lưu 2 kiện, đối soát thiếu và cập nhật bàn giao đủ", async ({
  page,
}) => {
  const { makePdf, labelText } = await import("../pdf-fixture");
  await signIn(page);
  const tick = Date.now();
  const code1 = "86" + String(tick).slice(-9) + "1",
    code2 = "86" + String(tick).slice(-9) + "2";
  const order1 = "586" + tick + "01",
    order2 = "586" + tick + "02";
  const buffer = makePdf([
    labelText(code1, order1),
    labelText(code1, order1),
    labelText(code2, order2),
  ]);
  await navigate(page, "Nhập dữ liệu");
  const panel = page.locator(".pdf-source-import");
  await panel
    .getByLabel("Kho của file PDF")
    .selectOption({ label: "Kho ComsMiu" });
  await panel.getByLabel("Shop của file PDF").fill("E2E PDF " + tick);
  await panel.getByLabel("File PDF nguồn").setInputFiles({
    name: `source-${tick}.pdf`,
    mimeType: "application/pdf",
    buffer,
  });
  await panel
    .getByRole("button", { name: "Đọc và đếm PDF", exact: true })
    .click();
  await expect(panel.locator(".import-stats")).toContainText(
    "2 vận đơn duy nhất",
  );
  await expect(panel.locator(".import-stats")).toContainText(
    "1 trang tem trùng",
  );
  await panel
    .getByRole("button", { name: "Xác nhận lưu 2 vận đơn nguồn", exact: true })
    .click();
  const report = page.locator(".source-reconciliation");
  await expect(report.getByRole("status")).toContainText(
    "Còn 2 mã chưa quét, 2 mã chưa bàn giao",
  );
  await report.getByLabel("Lọc đối soát nguồn").selectOption("unscanned");
  await expect(report.locator("tbody tr")).toHaveCount(2);
  await report.getByLabel("Tìm mã trong nguồn").fill(code2);
  await expect(report.locator("tbody tr")).toHaveCount(1);
  await expect(report.locator("tbody")).toContainText(order2);
  const id = await report.getByLabel("Danh sách nguồn").inputValue();
  const data = await (await page.request.get(`/api/sources/${id}`)).json();
  expect(data.totals).toMatchObject({
    expected: 2,
    orders: 2,
    unscanned: 2,
    complete: false,
  });
  const shiftResponse = await page.request.post("/api/shifts/start-self", {
    headers,
    data: { warehouseId: data.manifest.warehouse_id },
  });
  expect(shiftResponse.ok()).toBeTruthy();
  const shift = await shiftResponse.json();
  for (const code of [code1, code2]) {
    const response = await page.request.post("/api/scans", {
      headers,
      data: {
        code,
        requestId: crypto.randomUUID(),
        warehouseId: data.manifest.warehouse_id,
        shiftId: shift.id,
        method: "manual",
      },
    });
    expect((await response.json()).outcome).toBe("success");
  }
  await expect(report.getByRole("status")).toContainText(
    "Đã quét đủ, chưa bàn giao đủ",
    { timeout: 12000 },
  );
  await expect(report.locator("tbody tr")).toHaveCount(0);
  const handoverResponse = await page.request.post("/api/handovers", {
    headers,
    data: {
      carrierId: data.manifest.carrier_id,
      warehouseId: data.manifest.warehouse_id,
      shipmentIds: data.rows.map((r: any) => r.shipment_id),
    },
  });
  expect(handoverResponse.ok()).toBeTruthy();
  const handover = await handoverResponse.json();
  expect(
    (
      await page.request.post("/api/handovers/confirm", {
        headers,
        data: { id: handover.id },
      })
    ).ok(),
  ).toBeTruthy();
  await expect(report.getByRole("status")).toContainText(
    "Đã bàn giao đủ theo nguồn",
    { timeout: 12000 },
  );
  const exported = await page.request.get(`/api/sources/${id}?format=csv`);
  expect(exported.ok()).toBeTruthy();
  const csv = await exported.text();
  expect(csv).toContain(code1);
  expect(csv).toContain(order2);
  expect(csv.trim().split("\r\n")).toHaveLength(3);
  const excel = await page.request.get(`/api/sources/${id}?format=xlsx`);
  expect(excel.ok()).toBeTruthy();
  const reimport = await page.request.post("/api/sources/commit", {
    headers,
    multipart: {
      file: { name: "again.pdf", mimeType: "application/pdf", buffer },
      context: JSON.stringify({
        warehouseId: data.manifest.warehouse_id,
        carrierId: data.manifest.carrier_id,
        channel: "TikTok Shop",
        shop: data.manifest.shop,
        dueDate: data.manifest.due_date,
      }),
    },
  });
  expect(await reimport.json()).toMatchObject({
    id,
    reused: true,
    newShipments: 0,
  });
  await navigate(page, "Đối soát xuất kho");
  await page
    .getByRole("button", { name: "Theo file nguồn PDF", exact: true })
    .click();
  await page.getByLabel("Danh sách nguồn").selectOption(id);
  await expect(
    page.locator(".source-reconciliation").getByRole("status"),
  ).toContainText("Đã bàn giao đủ theo nguồn");
  await page
    .getByRole("button", { name: "Loại bỏ nguồn", exact: true })
    .click();
  let modal = page.getByRole("dialog", { name: "Loại bỏ nguồn PDF" });
  await expect(modal).toContainText("không xóa vận đơn");
  await modal.getByRole("button", { name: "Hủy", exact: true }).click();
  await expect(page.getByLabel("Danh sách nguồn")).toHaveValue(id);
  await page
    .getByRole("button", { name: "Loại bỏ nguồn", exact: true })
    .click();
  modal = page.getByRole("dialog", { name: "Loại bỏ nguồn PDF" });
  await expect(
    modal.getByRole("button", { name: "Xác nhận loại bỏ", exact: true }),
  ).toBeDisabled();
  await modal.getByLabel("Lý do loại bỏ").fill("E2E tải nhầm file cần loại bỏ");
  await modal
    .getByRole("button", { name: "Xác nhận loại bỏ", exact: true })
    .click();
  await expect(modal).toHaveCount(0);
  await expect(page.locator(`select option[value="${id}"]`)).toHaveCount(0);
  await page.getByLabel("Hiển thị nguồn").selectOption("archived");
  await expect(page.locator(`select option[value="${id}"]`)).toHaveCount(1);
  await page.getByLabel("Danh sách nguồn").selectOption(id);
  await expect(
    page.getByRole("button", { name: "Khôi phục nguồn", exact: true }),
  ).toBeVisible();
  await expect(
    page.locator(".source-reconciliation").getByRole("status"),
  ).toContainText("Nguồn đã loại bỏ");
  const archived = await (await page.request.get(`/api/sources/${id}`)).json();
  expect(archived.totals).toMatchObject({
    expected: 2,
    handed: 2,
    complete: false,
  });
  const refused = await page.request.post("/api/sources/commit", {
    headers,
    multipart: {
      file: { name: "removed.pdf", mimeType: "application/pdf", buffer },
      context: JSON.stringify({
        warehouseId: data.manifest.warehouse_id,
        carrierId: data.manifest.carrier_id,
        channel: "TikTok Shop",
        shop: data.manifest.shop,
        dueDate: data.manifest.due_date,
      }),
    },
  });
  expect(refused.status()).toBe(409);
  await page
    .getByRole("button", { name: "Khôi phục nguồn", exact: true })
    .click();
  modal = page.getByRole("dialog", { name: "Khôi phục nguồn PDF" });
  await modal
    .getByLabel("Lý do khôi phục")
    .fill("E2E đã kiểm tra và khôi phục nguồn");
  await modal
    .getByRole("button", { name: "Xác nhận khôi phục", exact: true })
    .click();
  await expect(modal).toHaveCount(0);
  await page.getByLabel("Hiển thị nguồn").selectOption("active");
  await expect(page.locator(`select option[value="${id}"]`)).toHaveCount(1);
  await page.getByLabel("Danh sách nguồn").selectOption(id);
  await expect(
    page.locator(".source-reconciliation").getByRole("status"),
  ).toContainText("Đã bàn giao đủ theo nguồn");
});

test("PDF đơn dài: ghép trang sản phẩm, không có Qty Total trên tem vẫn lưu và đếm đúng", async ({
  page,
}) => {
  const { makePdf, splitLabelText, continuationText } =
    await import("../pdf-fixture");
  await signIn(page);
  const tick = Date.now();
  const code = "86" + String(tick).slice(-10);
  const order = "586" + tick + "31";
  await navigate(page, "Nhập dữ liệu");
  const panel = page.locator(".pdf-source-import");
  await panel
    .getByLabel("Kho của file PDF")
    .selectOption({ label: "Kho ComsMiu" });
  await panel.getByLabel("Shop của file PDF").fill("E2E split " + tick);
  await panel.getByLabel("File PDF nguồn").setInputFiles({
    name: `split-${tick}.pdf`,
    mimeType: "application/pdf",
    buffer: makePdf([splitLabelText(code, order), continuationText(order)]),
  });
  await panel
    .getByRole("button", { name: "Đọc và đếm PDF", exact: true })
    .click();
  await expect(panel.locator(".import-stats")).toContainText("2 trang");
  await expect(panel.locator(".import-stats")).toContainText(
    "1 vận đơn duy nhất",
  );
  await expect(panel.locator(".import-stats")).toContainText(
    "0 trang tem trùng",
  );
  await expect(
    panel.getByText(/1 trang sản phẩm tiếp theo đã ghép/),
  ).toBeVisible();
  await panel
    .getByRole("button", { name: "Xác nhận lưu 1 vận đơn nguồn", exact: true })
    .click();
  const report = page.locator(".source-reconciliation");
  await expect(
    report.getByText(/0 trang tem trùng,.*1 trang sản phẩm tiếp theo/),
  ).toBeVisible();
  await expect(report.locator("tbody tr")).toHaveCount(1);
  const id = await report.getByLabel("Danh sách nguồn").inputValue();
  const data = await (await page.request.get(`/api/sources/${id}`)).json();
  expect(data.manifest).toMatchObject({
    page_count: 2,
    continuation_pages: 1,
    duplicate_pages: 0,
  });
  expect(data.totals).toMatchObject({
    expected: 1,
    orders: 1,
    unscanned: 1,
    complete: false,
  });
  expect(data.rows[0].pages).toEqual([1, 2]);
  await page.reload();
  await navigate(page, "Đối soát xuất kho");
  await page
    .getByRole("button", { name: "Theo file nguồn PDF", exact: true })
    .click();
  await page.getByLabel("Danh sách nguồn").selectOption(id);
  await expect(
    page
      .locator(".source-reconciliation")
      .getByText(/1 trang sản phẩm tiếp theo/),
  ).toBeVisible();
});

test("PDF có trang không đọc được bị chặn lưu toàn bộ và thay file xóa xem trước cũ", async ({
  page,
}) => {
  const { makePdf, labelText } = await import("../pdf-fixture");
  await signIn(page);
  await navigate(page, "Nhập dữ liệu");
  const panel = page.locator(".pdf-source-import");
  await panel
    .getByLabel("Kho của file PDF")
    .selectOption({ label: "Kho ComsMiu" });
  await panel.getByLabel("File PDF nguồn").setInputFiles({
    name: "broken-page.pdf",
    mimeType: "application/pdf",
    buffer: makePdf([labelText(), ""]),
  });
  await panel
    .getByRole("button", { name: "Đọc và đếm PDF", exact: true })
    .click();
  await expect(panel.getByRole("alert")).toContainText("1 trang lỗi");
  await expect(
    panel.getByRole("button", { name: "Xác nhận lưu 1 vận đơn nguồn" }),
  ).toBeDisabled();
  await expect(panel.getByText("Trang 2:", { exact: false })).toBeVisible();
  await panel.getByLabel("Shop của file PDF").fill("Thay thông tin nguồn");
  await expect(
    panel.getByRole("heading", { name: "Kết quả đọc PDF" }),
  ).toHaveCount(0);
  const csrf = await page.request.post("/api/sources/commit", {
    headers: { Origin: "https://untrusted.example" },
    data: {},
  });
  expect(csrf.status()).toBe(403);
});

test("nhiều PDF J&T/BEST: nhận hãng, đếm trùng liên file và retry không nhập lại file đã lưu", async ({
  page,
}) => {
  const { makePdf, labelText, bestLabelText } = await import("../pdf-fixture");
  await signIn(page);
  await navigate(page, "Nhập dữ liệu");
  const panel = page.locator(".pdf-source-import");
  const tick = Date.now();
  const a = "86" + String(tick).slice(-9) + "1",
    b = "86" + String(tick).slice(-9) + "2",
    c = "TTVN" + String(tick).slice(-10);
  const o1 = "586" + tick + "01",
    o2 = "586" + tick + "02",
    o3 = "586" + tick + "03";
  const first = makePdf([labelText(a, o1)]);
  const names = [`jt-a-${tick}.pdf`, `jt-ab-${tick}.pdf`, `best-${tick}.pdf`];
  await panel
    .getByLabel("Kho của file PDF")
    .selectOption({ label: "Kho ComsMiu" });
  await panel.getByLabel("Shop của file PDF").fill("E2E multi PDF " + tick);
  await panel.getByLabel("File PDF nguồn").setInputFiles([
    { name: names[0], mimeType: "application/pdf", buffer: first },
    {
      name: names[1],
      mimeType: "application/pdf",
      buffer: makePdf([labelText(a, o1), labelText(b, o2)]),
    },
    {
      name: names[2],
      mimeType: "application/pdf",
      buffer: makePdf([bestLabelText(c, o3)]),
    },
    { name: `copy-${tick}.pdf`, mimeType: "application/pdf", buffer: first },
    {
      name: `broken-${tick}.pdf`,
      mimeType: "application/pdf",
      buffer: Buffer.from("not pdf"),
    },
  ]);
  await panel
    .getByRole("button", { name: "Đọc và đếm PDF", exact: true })
    .click();
  await expect(panel.locator(".pdf-batch-summary")).toContainText(
    "3 file hợp lệ",
  );
  await expect(panel.locator(".pdf-batch-summary")).toContainText(
    "3 vận đơn duy nhất",
  );
  await expect(panel.locator(".pdf-batch-summary")).toContainText(
    "1 mã lặp giữa các file",
  );
  await expect(panel.locator(".pdf-batch-summary")).toContainText(
    "1 file trùng nội dung",
  );
  await expect(
    panel.locator(".source-preview").filter({
      has: page.getByRole("heading", {
        name: `Kết quả đọc PDF · ${names[2]}`,
        exact: true,
      }),
    }),
  ).toContainText("BEST Express");
  let attempts = 0;
  await page.route("**/api/sources/commit", async (route) => {
    attempts++;
    const response = await route.fetch();
    expect(response.ok()).toBeTruthy();
    if (attempts === 2)
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({
          error: "E2E mất phản hồi sau khi server đã lưu",
        }),
      });
    else await route.fulfill({ response });
  });
  await panel
    .getByRole("button", { name: "Lưu 3 file hợp lệ", exact: true })
    .click();
  const retry = panel.getByRole("button", { name: /Lưu 1 file hợp lệ/ });
  await expect(retry).toBeEnabled();
  await expect(
    panel.getByRole("alert").filter({ hasText: "Chưa xác nhận lưu" }),
  ).toBeVisible();
  await retry.click();
  await expect(
    panel.getByRole("alert").filter({ hasText: "Chưa xác nhận lưu" }),
  ).toHaveCount(0);
  expect(attempts).toBe(4);
  await expect(panel.getByText(/Đã mở nguồn cũ:/)).toBeVisible();
  const sources = await (await page.request.get("/api/sources")).json();
  const imported = sources.filter((s: any) => names.includes(s.filename));
  expect(imported).toHaveLength(3);
  const reports = await Promise.all(
    imported.map(async (s: any) =>
      (await page.request.get(`/api/sources/${s.id}`)).json(),
    ),
  );
  const allCodes = new Set(
    reports.flatMap((r) => r.rows.map((l: any) => l.tracking_code)),
  );
  expect(allCodes.size).toBe(3);
  expect(
    reports.find((r) => r.manifest.filename === names[2]).manifest,
  ).toMatchObject({ carrier: "BEST Express", channel: "TikTok Shop" });
});

test("PDF BEST chọn sai J&T bị chặn; đổi tự nhận dạng, thêm/bỏ file và giới hạn số file", async ({
  page,
}) => {
  const { makePdf, labelText, bestLabelText } = await import("../pdf-fixture");
  await signIn(page);
  await navigate(page, "Nhập dữ liệu");
  const panel = page.locator(".pdf-source-import");
  await panel
    .getByLabel("Kho của file PDF")
    .selectOption({ label: "Kho ComsMiu" });
  await panel
    .getByLabel("Hãng của file PDF")
    .selectOption({ label: "J&T Express" });
  const file = {
    name: "BEST-check.pdf",
    mimeType: "application/pdf",
    buffer: makePdf([bestLabelText()]),
  };
  await panel.getByLabel("File PDF nguồn").setInputFiles(file);
  await panel
    .getByRole("button", { name: "Đọc và đếm PDF", exact: true })
    .click();
  await expect(panel.getByRole("alert")).toContainText(
    "nhận dạng BEST Express",
  );
  await expect(
    panel.getByRole("button", {
      name: "Xác nhận lưu 0 vận đơn nguồn",
      exact: true,
    }),
  ).toBeDisabled();
  await panel.getByLabel("Hãng của file PDF").selectOption("");
  await panel
    .getByRole("button", { name: "Đọc và đếm PDF", exact: true })
    .click();
  await expect(panel.locator(".source-preview")).toContainText(
    "Hãng: BEST Express",
  );
  await panel.getByLabel("File PDF nguồn").setInputFiles({
    name: "JT-add.pdf",
    mimeType: "application/pdf",
    buffer: makePdf([labelText()]),
  });
  await expect(
    panel.getByRole("columnheader", { name: "FILE ĐANG CHỌN (2/20)" }),
  ).toBeVisible();
  await expect(
    panel.getByRole("heading", { name: "Kết quả đọc PDF", exact: true }),
  ).toHaveCount(0);
  await panel
    .getByRole("button", { name: "Bỏ file BEST-check.pdf", exact: true })
    .click();
  await expect(
    panel.getByRole("columnheader", { name: "FILE ĐANG CHỌN (1/20)" }),
  ).toBeVisible();
  await panel.getByLabel("File PDF nguồn").setInputFiles(
    Array.from({ length: 20 }, (_, i) => ({
      ...file,
      name: `extra-${i}.pdf`,
    })),
  );
  await expect(panel.getByRole("alert")).toContainText("tối đa 20 PDF");
  await expect(
    panel.getByRole("columnheader", { name: "FILE ĐANG CHỌN (1/20)" }),
  ).toBeVisible();
});

test("PDF Shopee và TikTok cùng lần nhập: tự nhận sàn/hãng, quét và bàn giao SPX đúng nguồn", async ({
  page,
}) => {
  const { makePdf, shopeeLabelText, labelText } =
    await import("../pdf-fixture");
  await signIn(page);
  const tick = Date.now(),
    spx = "SPXVN" + String(tick).slice(-11) + "A",
    order = "261020" + String(tick).slice(-8);
  const jt = "86" + String(tick).slice(-10);
  await navigate(page, "Nhập dữ liệu");
  const panel = page.locator(".pdf-source-import");
  await panel
    .getByLabel("Kho của file PDF")
    .selectOption({ label: "Kho ComsMiu" });
  await panel.getByLabel("Shop của file PDF").fill("E2E shared shop " + tick);
  await panel.getByLabel("File PDF nguồn").setInputFiles([
    {
      name: `BEST-${tick}.pdf`,
      mimeType: "application/pdf",
      buffer: makePdf([shopeeLabelText(spx, order)]),
    },
    {
      name: `SPX-${tick}.pdf`,
      mimeType: "application/pdf",
      buffer: makePdf([labelText(jt, "586" + tick + "01")]),
    },
  ]);
  await panel
    .getByRole("button", { name: "Đọc và đếm PDF", exact: true })
    .click();
  await expect(
    panel.locator(".source-preview").filter({ hasText: `BEST-${tick}.pdf` }),
  ).toContainText("Sàn: Shopee · Hãng: SPX Express");
  await expect(
    panel.locator(".source-preview").filter({ hasText: `SPX-${tick}.pdf` }),
  ).toContainText("Sàn: TikTok Shop · Hãng: J&T Express");
  await expect(panel.locator(".pdf-batch-summary")).toContainText(
    "2 file hợp lệ · 2 vận đơn duy nhất · 2 đơn hàng",
  );
  await panel
    .getByRole("button", { name: "Lưu 2 file hợp lệ", exact: true })
    .click();
  await expect(panel.getByText(/Đã lưu nguồn:/)).toHaveCount(2);
  const sources = await (await page.request.get("/api/sources")).json();
  const source = sources.find(
    (r: { filename: string }) => r.filename === `BEST-${tick}.pdf`,
  );
  expect(source).toMatchObject({
    channel: "Shopee",
    carrier: "SPX Express",
    expected: 1,
  });
  const data = await (
    await page.request.get(`/api/sources/${source.id}`)
  ).json();
  const shift = await (
    await page.request.post("/api/shifts/start-self", {
      headers,
      data: { warehouseId: data.manifest.warehouse_id },
    })
  ).json();
  for (const expected of ["success", "duplicate"]) {
    const scan = await page.request.post("/api/scans", {
      headers,
      data: {
        code: spx,
        requestId: crypto.randomUUID(),
        method: "manual",
        warehouseId: data.manifest.warehouse_id,
        shiftId: shift.id,
      },
    });
    expect(scan.ok(), await scan.text()).toBeTruthy();
    expect(await scan.json()).toMatchObject({
      outcome: expected,
      shipment: { channel: "Shopee", carrier: "SPX Express" },
    });
  }
  const handover = await (
    await page.request.post("/api/handovers", {
      headers,
      data: {
        warehouseId: data.manifest.warehouse_id,
        carrierId: data.manifest.carrier_id,
        shipmentIds: data.rows.map(
          (r: { shipment_id: string }) => r.shipment_id,
        ),
      },
    })
  ).json();
  const confirmed = await page.request.post("/api/handovers/confirm", {
    headers,
    data: { id: handover.id },
  });
  expect(confirmed.ok(), await confirmed.text()).toBeTruthy();
  await navigate(page, "Đối soát xuất kho");
  await page
    .getByRole("button", { name: "Theo file nguồn PDF", exact: true })
    .click();
  await page.getByLabel("Danh sách nguồn").selectOption(source.id);
  const report = page.locator(".source-reconciliation");
  await expect(report.getByRole("status")).toContainText(
    "Đã bàn giao đủ theo nguồn",
  );
  await expect(report).toContainText("Shopee · SPX Express");
  const exported = await page.request.get(
    `/api/sources/${source.id}?format=csv`,
  );
  const csv = await exported.text();
  expect(exported.ok()).toBeTruthy();
  expect(csv).toContain("Shopee");
  expect(csv).toContain(spx);
  expect(csv).toContain(order);
  expect(csv.trim().split("\r\n")).toHaveLength(2);
});

test("PDF Shopee chọn sai sàn bị chặn; đổi tự nhận dạng xóa kết quả sai và nhận đúng SPX", async ({
  page,
}) => {
  const { makePdf, shopeeLabelText } = await import("../pdf-fixture");
  await signIn(page);
  await navigate(page, "Nhập dữ liệu");
  const panel = page.locator(".pdf-source-import");
  await panel
    .getByLabel("Kho của file PDF")
    .selectOption({ label: "Kho ComsMiu" });
  await panel.getByLabel("Sàn của file PDF").selectOption("TikTok Shop");
  await panel.getByLabel("File PDF nguồn").setInputFiles({
    name: "shopee.pdf",
    mimeType: "application/pdf",
    buffer: makePdf([shopeeLabelText()]),
  });
  await panel
    .getByRole("button", { name: "Đọc và đếm PDF", exact: true })
    .click();
  await expect(panel.getByRole("alert")).toContainText("nhận dạng sàn Shopee");
  await expect(
    panel.getByRole("button", {
      name: "Xác nhận lưu 0 vận đơn nguồn",
      exact: true,
    }),
  ).toBeDisabled();
  await panel.getByLabel("Sàn của file PDF").selectOption("");
  await expect(panel.locator(".source-preview")).toHaveCount(0);
  await panel
    .getByRole("button", { name: "Đọc và đếm PDF", exact: true })
    .click();
  await expect(panel.locator(".source-preview")).toContainText(
    "Sàn: Shopee · Hãng: SPX Express",
  );
  await expect(
    panel.getByRole("button", {
      name: "Xác nhận lưu 1 vận đơn nguồn",
      exact: true,
    }),
  ).toBeEnabled();
});

test("PDF Shopee GHN: tự nhận từ nội dung, lưu nguồn, quét và xuất đối soát đúng hãng", async ({
  page,
}, info) => {
  const { makePdf, shopeeLabelText } = await import("../pdf-fixture");
  await signIn(page);
  const tick = String(Date.now()),
    code = "G" + tick.slice(-7),
    order = "261021" + tick.slice(-8),
    filename = `SPX-tên-khác-đã-gộp-${tick}.pdf`;
  await navigate(page, "Nhập dữ liệu");
  const panel = page.locator(".pdf-source-import");
  await panel
    .getByLabel("Kho của file PDF")
    .selectOption({ label: "Kho ComsMiu" });
  await panel.getByLabel("Shop của file PDF").fill("E2E GHN " + tick);
  await expect(
    panel
      .getByLabel("Hãng của file PDF")
      .getByRole("option", { name: "GHN", exact: true }),
  ).toHaveCount(1);
  await panel.getByLabel("File PDF nguồn").setInputFiles({
    name: filename,
    mimeType: "application/pdf",
    buffer: makePdf([shopeeLabelText(code, order)]),
  });
  await panel
    .getByRole("button", { name: "Đọc và đếm PDF", exact: true })
    .click();
  await expect(panel.locator(".source-preview")).toContainText(
    "Sàn: Shopee · Hãng: GHN",
  );
  await expect(panel.locator(".import-stats")).toContainText(
    "1 đơn hàng duy nhất",
  );
  await expect(panel.locator(".import-stats")).toContainText(
    "1 vận đơn duy nhất",
  );
  await page.screenshot({
    path: `/tmp/coms-ghn-preview-${info.project.name}.png`,
    fullPage: true,
  });
  await panel
    .getByRole("button", { name: "Xác nhận lưu 1 vận đơn nguồn", exact: true })
    .click();
  await expect(panel.getByText(/Đã lưu nguồn:/)).toBeVisible();
  const sources = await (await page.request.get("/api/sources")).json();
  const source = sources.find(
    (r: { filename: string }) => r.filename === filename,
  );
  expect(source).toMatchObject({
    channel: "Shopee",
    carrier: "GHN",
    expected: 1,
  });
  const data = await (
    await page.request.get(`/api/sources/${source.id}`)
  ).json();
  const shift = await page.request.post("/api/shifts/start-self", {
    headers,
    data: { warehouseId: data.manifest.warehouse_id },
  });
  expect(shift.ok(), await shift.text()).toBeTruthy();
  await page.reload();
  await navigate(page, "Quét vận đơn SCAN");
  await page
    .getByRole("textbox", { name: "Mã vận đơn", exact: true })
    .fill(code);
  await page.getByRole("button", { name: "Xác nhận", exact: true }).click();
  await expect(
    page.getByText("QUÉT ĐƠN THÀNH CÔNG", { exact: true }),
  ).toBeVisible();
  await navigate(page, "Đối soát xuất kho");
  await page
    .getByRole("button", { name: "Theo file nguồn PDF", exact: true })
    .click();
  await page.getByLabel("Danh sách nguồn").selectOption(source.id);
  const report = page.locator(".source-reconciliation");
  await expect(report).toContainText("Shopee · GHN");
  await expect(
    report.getByRole("cell", { name: code, exact: false }),
  ).toBeVisible();
  await expect(report.getByRole("status")).toContainText(
    "Đã quét đủ, chưa bàn giao đủ",
  );
  const exported = await page.request.get(
    `/api/sources/${source.id}?format=csv`,
  );
  expect(exported.ok()).toBeTruthy();
  const csv = await exported.text();
  expect(csv).toContain("GHN");
  expect(csv).toContain(filename);
  expect(csv).toContain("Shopee");
  expect(csv).toContain(code);
  expect(csv).toContain(order);
  expect(csv.trim().split("\r\n")).toHaveLength(2);
});

if (process.env.GHN_SAMPLE_PDF)
  test("PDF Shopee GHN gốc: upload 14 trang nhận đủ 14 đơn và 14 vận đơn", async ({
    page,
  }, info) => {
    await signIn(page);
    await navigate(page, "Nhập dữ liệu");
    const panel = page.locator(".pdf-source-import");
    await panel
      .getByLabel("Kho của file PDF")
      .selectOption({ label: "Kho ComsMiu" });
    await panel
      .getByLabel("File PDF nguồn")
      .setInputFiles(process.env.GHN_SAMPLE_PDF!);
    await panel
      .getByRole("button", { name: "Đọc và đếm PDF", exact: true })
      .click();
    await expect(panel.locator(".source-preview")).toContainText(
      "Sàn: Shopee · Hãng: GHN",
    );
    await expect(panel.locator(".import-stats")).toContainText("14 trang");
    await expect(panel.locator(".import-stats")).toContainText(
      "14 đơn hàng duy nhất",
    );
    await expect(panel.locator(".import-stats")).toContainText(
      "14 vận đơn duy nhất",
    );
    await expect(
      panel.getByRole("button", {
        name: "Xác nhận lưu 14 vận đơn nguồn",
        exact: true,
      }),
    ).toBeEnabled();
    await panel.locator(".source-preview").screenshot({
      path: `/tmp/coms-ghn-original-${info.project.name}.png`,
    });
  });

if (process.env.SHOPEE_SAMPLE_PDF)
  test("PDF Shopee gốc: upload thật nhận 15 trang, 15 đơn, 15 vận đơn và đúng SPX", async ({
    page,
  }) => {
    await signIn(page);
    await navigate(page, "Nhập dữ liệu");
    const panel = page.locator(".pdf-source-import");
    await panel
      .getByLabel("Kho của file PDF")
      .selectOption({ label: "Kho ComsMiu" });
    await panel
      .getByLabel("File PDF nguồn")
      .setInputFiles(process.env.SHOPEE_SAMPLE_PDF!);
    await panel
      .getByRole("button", { name: "Đọc và đếm PDF", exact: true })
      .click();
    await expect(panel.locator(".import-stats")).toContainText("15 trang");
    await expect(panel.locator(".import-stats")).toContainText(
      "15 đơn hàng duy nhất",
    );
    await expect(panel.locator(".import-stats")).toContainText(
      "15 vận đơn duy nhất",
    );
    await expect(panel.locator(".source-preview")).toContainText(
      "Sàn: Shopee · Hãng: SPX Express",
    );
    await expect(
      panel.getByRole("button", {
        name: "Xác nhận lưu 15 vận đơn nguồn",
        exact: true,
      }),
    ).toBeEnabled();
  });

test("PDF bộ nhớ: hai upload lớn đồng thời được giới hạn, file hỏng không làm chết server", async ({
  page,
}) => {
  test.setTimeout(120000);
  const { largeSourcePdf, makePdf, shopeeLabelText } =
    await import("../pdf-fixture");
  await signIn(page);
  const refs = await (await page.request.get("/api/references")).json();
  const warehouse = refs.warehouses.find(
    (w: { name: string }) => w.name === "Kho ComsMiu",
  );
  const context = JSON.stringify({
    warehouseId: warehouse.id,
    carrierId: "",
    channel: "",
    shop: "E2E Memory",
    dueDate: todayVN(),
  });
  const pdf = largeSourcePdf(
    1800,
    18 * 1024 * 1024,
    Number(String(Date.now()).slice(-8)),
  );
  const send = () =>
    page.request.post("/api/sources/preview", {
      headers,
      multipart: {
        context,
        file: { name: "memory.pdf", mimeType: "application/pdf", buffer: pdf },
      },
    });
  const responses = await Promise.all([send(), send()]);
  expect(responses.map((r) => r.status()).sort()).toEqual([200, 503]);
  const busy = responses.find((r) => r.status() === 503)!;
  expect(busy.headers()["retry-after"]).toBe("5");
  expect(await busy.json()).toMatchObject({
    error: expect.stringContaining("đang xử lý"),
  });
  const accepted = await responses.find((r) => r.status() === 200)!.json();
  expect(accepted.uniqueShipments).toBe(1800);
  expect(accepted.errors).toEqual([]);
  const malformed = await page.request.post("/api/sources/preview", {
    headers,
    multipart: {
      context,
      file: {
        name: "wrong.xlsx",
        mimeType: "application/pdf",
        buffer: pdf.subarray(0, 1024),
      },
    },
  });
  expect(malformed.status()).toBe(400);
  expect((await page.request.get("/api/health")).ok()).toBeTruthy();
  const retry = await page.request.post("/api/sources/preview", {
    headers,
    multipart: {
      context,
      file: {
        name: "retry.pdf",
        mimeType: "application/pdf",
        buffer: makePdf([shopeeLabelText("GTEST001")]),
      },
    },
  });
  expect(retry.ok(), await retry.text()).toBeTruthy();
  expect(await retry.json()).toMatchObject({
    uniqueShipments: 1,
    carrierName: "GHN",
    errors: [],
  });
});

test("PDF lớn hơn 17 MB / 1.800 đơn: đọc, lưu, phân trang, tra mã và quét đúng nguồn", async ({
  page,
}) => {
  test.setTimeout(120000);
  const { largeSourcePdf } = await import("../pdf-fixture");
  await signIn(page);
  await navigate(page, "Nhập dữ liệu");
  const panel = page.locator(".pdf-source-import");
  const tick = Date.now(),
    sequence = 5000000000 + (Math.floor(tick / 1000) % 1000000) * 4000;
  const buffer = largeSourcePdf(1800, 18 * 1024 * 1024, sequence);
  expect(buffer.length).toBeGreaterThan(17.3 * 1024 * 1024);
  await panel
    .getByLabel("Kho của file PDF")
    .selectOption({ label: "Kho ComsMiu" });
  await panel.getByLabel("Shop của file PDF").fill("E2E 1800 " + tick);
  await panel.getByLabel("File PDF nguồn").setInputFiles({
    name: `large-${tick}.pdf`,
    mimeType: "application/pdf",
    buffer,
  });
  await panel
    .getByRole("button", { name: "Đọc và đếm PDF", exact: true })
    .click();
  await expect(panel.locator(".import-stats")).toContainText(
    "1800 vận đơn duy nhất",
    { timeout: 90000 },
  );
  await panel
    .getByRole("button", {
      name: "Xác nhận lưu 1800 vận đơn nguồn",
      exact: true,
    })
    .click();
  const report = page.locator(".source-reconciliation");
  await expect(report.getByRole("status")).toContainText(
    "Còn 1800 mã chưa quét",
    { timeout: 90000 },
  );
  await expect(report.locator("tbody tr")).toHaveCount(100);
  await expect(report.getByText("Trang 1/18", { exact: true })).toBeVisible();
  await report.getByRole("button", { name: "Trang sau", exact: true }).click();
  await expect(report.getByText("Trang 2/18", { exact: true })).toBeVisible();
  await expect(report.locator("tbody tr").first()).toContainText(
    "86" + String(sequence + 101).padStart(10, "0"),
  );
  const last = "86" + String(sequence + 1800).padStart(10, "0");
  await report.getByLabel("Tìm mã trong nguồn").fill(last);
  await expect(report.locator("tbody tr")).toHaveCount(1);
  await expect(report.locator("tbody")).toContainText(last);
  const id = await report.getByLabel("Danh sách nguồn").inputValue();
  const data = await (await page.request.get(`/api/sources/${id}`)).json();
  expect(data.totals).toMatchObject({
    expected: 1800,
    orders: 1800,
    unscanned: 1800,
  });
  const shift = await (
    await page.request.post("/api/shifts/start-self", {
      headers,
      data: { warehouseId: data.manifest.warehouse_id },
    })
  ).json();
  const scan = await page.request.post("/api/scans", {
    headers,
    data: {
      code: last,
      requestId: crypto.randomUUID(),
      method: "manual",
      warehouseId: data.manifest.warehouse_id,
      shiftId: shift.id,
    },
  });
  expect((await scan.json()).outcome).toBe("success");
  await expect(report.getByRole("status")).toContainText(
    "Còn 1799 mã chưa quét",
    { timeout: 12000 },
  );
  const exported = await page.request.get(`/api/sources/${id}?format=csv`);
  expect(exported.ok()).toBeTruthy();
  expect((await exported.text()).trim().split("\r\n")).toHaveLength(1801);
});

test("giao diện nhập file: biết mục đang mở, đổi loại file, bỏ chọn và điều hướng bàn phím", async ({
  page,
}, info) => {
  await signIn(page, "admin@comsflow.demo", "/#imports/excel");
  await expect(
    page.getByRole("tab", { name: "Excel / CSV đơn hàng", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await expect(page.getByLabel("File PDF nguồn", { exact: true })).toBeHidden();
  await page.getByRole("tab", { name: "PDF tem vận đơn", exact: true }).click();
  await page.getByLabel("File PDF nguồn", { exact: true }).setInputFiles({
    name: "file-đang-chọn.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("%PDF-1.4\n"),
  });
  await page
    .getByRole("tab", { name: "Excel / CSV đơn hàng", exact: true })
    .click();
  await page.getByRole("tab", { name: "PDF tem vận đơn", exact: true }).click();
  await expect(
    page
      .locator(".pdf-source-import")
      .getByRole("cell", { name: "file-đang-chọn.pdf", exact: true }),
  ).toBeVisible();
  await page
    .locator(".return-import-entry")
    .getByRole("button", { name: "Nhập dữ liệu đơn hoàn", exact: true })
    .click();
  await expect(page.locator(".return-current-view")).toContainText(
    "Nhập dữ liệu đơn hoàn",
  );
  await expect(
    page
      .getByRole("navigation")
      .getByRole("button", { name: "Quản lý đơn hoàn", exact: true }),
  ).toHaveAttribute("aria-current", "page");
  const { returnRow, returnCsv } = await import("../return-fixture");
  const form = page.locator(".return-import");
  await form.getByLabel("File đơn hoàn", { exact: true }).setInputFiles({
    name: "nguồn-đơn-hoàn.csv",
    mimeType: "text/csv",
    buffer: returnCsv([returnRow()]),
  });
  await expect(form.locator(".picked-files")).toContainText(
    "nguồn-đơn-hoàn.csv",
  );
  await form
    .getByRole("button", { name: "Đọc và đối chiếu đơn hoàn", exact: true })
    .click();
  await expect(form.locator(".import-unsaved")).toContainText("chưa được lưu");
  await expect(form.locator(".import-state")).toContainText(
    "Có thể xác nhận lưu",
  );
  await page.screenshot({
    path: `/tmp/wms-import-redesign-${info.project.name}.png`,
    fullPage: true,
  });
  await form
    .getByRole("button", { name: "Bỏ file nguồn-đơn-hoàn.csv", exact: true })
    .click();
  await expect(form.locator(".import-review")).toHaveCount(0);
  await expect(
    form.getByRole("button", {
      name: "Đọc và đối chiếu đơn hoàn",
      exact: true,
    }),
  ).toBeDisabled();
  await expect(form.locator('[aria-current="step"]')).toContainText(
    "Chọn file",
  );
  const tab = page.getByRole("tab", {
    name: "Nhập dữ liệu đơn hoàn",
    exact: true,
  });
  await tab.focus();
  await tab.press("ArrowRight");
  await expect(
    page.getByRole("tab", { name: "Quét mã hoàn kho", exact: true }),
  ).toBeFocused();
  await expect(page.locator(".return-current-view")).toContainText(
    "Quét mã hoàn kho",
  );
  await page.reload();
  await expect(page.locator(".return-current-view")).toContainText(
    "Quét mã hoàn kho",
  );
});

for (const role of ["admin", "manager", "staff"]) {
  test(`đơn hoàn: mở biểu mẫu bằng liên kết và nút nhập theo quyền ${role}`, async ({
    page,
  }, info) => {
    await signIn(page, `${role}@comsflow.demo`, "/#returns/import");
    const form = page.locator(".return-import");
    if (role === "staff") {
      await expect(page.locator(".return-scanner")).toBeVisible();
      await expect(form).toHaveCount(0);
      await expect(
        page.getByRole("tab", { name: "Nhập dữ liệu đơn hoàn", exact: true }),
      ).toHaveCount(0);
      await page.reload();
      await expect(page.locator(".return-scanner")).toBeVisible();
      return;
    }
    await expect(
      form.getByLabel("File đơn hoàn", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("tab", { name: "Nhập dữ liệu đơn hoàn", exact: true }),
    ).toHaveAttribute("aria-selected", "true");
    await page.reload();
    await expect(form).toBeVisible();
    await navigate(page, "Nhập dữ liệu");
    await page
      .locator(".return-import-entry")
      .getByRole("button", { name: "Nhập dữ liệu đơn hoàn", exact: true })
      .click();
    await expect(page).toHaveURL(/#returns\/import$/);
    await expect(form).toBeVisible();
    await page.goBack();
    await expect(page.locator(".return-import-entry")).toBeVisible();
    await page.goForward();
    await expect(form).toBeVisible();
    await navigate(page, "Quản lý đơn hoàn");
    await expect(
      page.getByRole("tab", { name: "Dashboard đơn hoàn", exact: true }),
    ).toHaveAttribute("aria-selected", "true");
    await page
      .getByRole("button", { name: "Nhập dữ liệu đơn hoàn", exact: true })
      .click();
    await expect(form).toBeVisible();
    await page.screenshot({
      path: `/tmp/wms-return-import-${role}-${info.project.name}.png`,
      fullPage: true,
    });
    await page
      .getByRole("tab", { name: "Quét mã hoàn kho", exact: true })
      .click();
    await expect(page).toHaveURL(/#returns\/scan$/);
    await page.reload();
    await expect(page.locator(".return-scanner")).toBeVisible();
  });
}

test("đơn hoàn: nhập nguồn, nhận kiện, chống trùng, kiểm đủ, F5 và xuất giữ ID", async ({
  page,
}) => {
  const { returnRow, returnCsv } = await import("../return-fixture");
  await signIn(page);
  const tick = String(Date.now()),
    request = "7" + tick + "00000",
    order = "586" + tick + "01",
    code = "85416" + tick.slice(-7);
  await navigate(page, "Quản lý đơn hoàn");
  await page
    .getByRole("tab", { name: "Nhập dữ liệu đơn hoàn", exact: true })
    .click();
  await page.getByLabel("Shop của đơn hoàn").fill("E2E Returns " + tick);
  await page
    .getByRole("combobox", { name: "Kho nhận hoàn", exact: true })
    .selectOption({ label: "Kho ComsMiu" });
  await page.getByLabel("File đơn hoàn", { exact: true }).setInputFiles({
    name: "returns.csv",
    mimeType: "text/csv",
    buffer: returnCsv([
      returnRow({
        "Return Order ID": request,
        "Order ID": order,
        "Return Logistics Tracking ID": code,
      }),
    ]),
  });
  await page
    .getByRole("button", { name: "Đọc và đối chiếu đơn hoàn", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Kết quả đối chiếu nguồn hoàn" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Xác nhận lưu 1 yêu cầu hoàn", exact: true })
    .click();
  await expect(
    page.locator(".return-import").getByRole("status"),
  ).toContainText("1 yêu cầu mới");
  await page
    .getByRole("tab", { name: "Quét mã hoàn kho", exact: true })
    .click();
  await page
    .getByRole("combobox", { name: "Kho quét hoàn", exact: true })
    .selectOption({ label: "Kho ComsMiu" });
  const start = page.getByRole("button", {
    name: "Mở ca nhận cho tôi",
    exact: true,
  });
  if (await start.isVisible()) await start.click();
  const input = page.getByLabel("Mã vận đơn hoàn", { exact: true });
  await input.fill(code);
  await input.press("Enter");
  await expect(
    page.locator(".return-scanner").getByRole("status"),
  ).toContainText("ĐÃ NHẬN KIỆN");
  await input.fill(code);
  await input.press("Enter");
  await expect(
    page.locator(".return-scanner").getByRole("status"),
  ).toContainText("VẬN ĐƠN NÀY ĐÃ ĐƯỢC XÁC NHẬN");
  await page
    .getByRole("button", { name: "Mở hồ sơ / kiểm hàng", exact: true })
    .click();
  const dialog = page.getByRole("dialog", { name: "Chi tiết đơn hoàn" });
  await dialog
    .getByLabel("Thực nhận SKU 1111111111111111111", { exact: true })
    .fill("1");
  await dialog
    .getByLabel("Ghi chú / lý do thao tác", { exact: true })
    .fill("E2E kiểm đủ hàng nguyên vẹn theo SKU");
  await dialog
    .getByRole("button", { name: "Lưu kiểm nhận sản phẩm", exact: true })
    .click();
  await expect(
    dialog.locator("tbody").filter({ hasText: "Kiểm nhận sản phẩm" }),
  ).toBeVisible();
  await dialog.getByText("Tạo hồ sơ khiếu nại", { exact: true }).click();
  await dialog
    .getByRole("combobox", { name: "Trạng thái khiếu nại", exact: true })
    .selectOption("won");
  await dialog
    .getByLabel("Lý do khiếu nại", { exact: true })
    .fill("E2E đã duyệt nhưng chưa nhận tiền bồi thường");
  await dialog.getByLabel("Tiền yêu cầu (VND)", { exact: true }).fill("100000");
  await dialog
    .getByLabel("Tiền được duyệt (VND)", { exact: true })
    .fill("80000");
  await dialog
    .getByRole("button", { name: "Lưu hồ sơ khiếu nại", exact: true })
    .click();
  await expect(
    dialog
      .locator(".notice")
      .filter({ hasText: "E2E đã duyệt nhưng chưa nhận tiền bồi thường" }),
  ).toBeVisible();
  await expect(dialog.locator('input[type="file"]')).toBeEnabled();
  const { makePdf, labelText } = await import("../pdf-fixture");
  await dialog.locator('input[type="file"]').setInputFiles({
    name: "proof.pdf",
    mimeType: "application/pdf",
    buffer: makePdf([labelText()]),
  });
  const evidence = dialog.getByRole("link", { name: "proof.pdf", exact: true });
  await expect(evidence).toBeVisible();
  const downloaded = await page.request.get(
    (await evidence.getAttribute("href"))!,
  );
  expect(downloaded.ok()).toBeTruthy();
  expect(downloaded.headers()["content-type"]).toBe("application/pdf");
  await dialog.getByRole("button", { name: "Đóng", exact: true }).click();
  await page
    .getByRole("tab", { name: "Danh sách & xử lý", exact: true })
    .click();
  await page
    .getByLabel("Tìm mã yêu cầu / đơn gốc / vận đơn", { exact: true })
    .fill(code);
  await expect(page.locator(".return-module tbody")).toContainText(
    "Nhận đủ · nguyên vẹn",
  );
  const exported = await page.request.get(
    "/api/returns/export?format=csv&q=" + code,
  );
  expect(exported.ok()).toBeTruthy();
  const csv = await exported.text();
  expect(csv).toContain(request);
  expect(csv).toContain(order);
  expect(csv.trim().split("\r\n")).toHaveLength(2);
  await page.reload();
  await navigate(page, "Quản lý đơn hoàn");
  await page
    .getByRole("tab", { name: "Danh sách & xử lý", exact: true })
    .click();
  await page
    .getByLabel("Tìm mã yêu cầu / đơn gốc / vận đơn", { exact: true })
    .fill(code);
  await expect(page.locator(".return-module tbody")).toContainText(request);
  await expect(page.locator(".return-module tbody")).toContainText(
    "Nhận đủ · nguyên vẹn",
  );
});

test("đơn hoàn: mã lạ, khớp nhiều hồ sơ, mất phản hồi và phân quyền staff", async ({
  page,
}) => {
  const { returnCsv, returnRow } = await import("../return-fixture");
  await signIn(page);
  const tick = String(Date.now()),
    code = "85416" + tick.slice(-7),
    req1 = "8" + tick + "00001",
    req2 = "8" + tick + "00002";
  const refs = await (await page.request.get("/api/references")).json();
  const warehouse = refs.warehouses.find(
    (w: { name: string }) => w.name === "Kho ComsMiu",
  );
  const file = returnCsv([
    returnRow({
      "Return Order ID": req1,
      "Return Logistics Tracking ID": code,
    }),
    returnRow({
      "Return Order ID": req2,
      "Return Logistics Tracking ID": code,
    }),
  ]);
  const imported = await page.request.post("/api/returns/import/commit", {
    headers,
    multipart: {
      file: { name: "ambiguous.csv", mimeType: "text/csv", buffer: file },
      context: JSON.stringify({
        shop: "E2E ambiguous " + tick,
        warehouseId: warehouse.id,
      }),
    },
  });
  expect(imported.ok(), await imported.text()).toBeTruthy();
  await navigate(page, "Quản lý đơn hoàn");
  await page
    .getByRole("tab", { name: "Quét mã hoàn kho", exact: true })
    .click();
  await page
    .getByRole("combobox", { name: "Kho quét hoàn", exact: true })
    .selectOption(warehouse.id);
  const start = page.getByRole("button", {
    name: "Mở ca nhận cho tôi",
    exact: true,
  });
  if (await start.isVisible()) await start.click();
  const input = page.getByLabel("Mã vận đơn hoàn", { exact: true });
  await input.fill("UNKNOWNRETURN" + tick);
  await input.press("Enter");
  await expect(
    page.locator(".return-scanner").getByRole("status"),
  ).toContainText("KHÔNG TÌM THẤY");
  await input.fill(code);
  await input.press("Enter");
  await expect(
    page.locator(".return-scanner").getByRole("status"),
  ).toContainText("MÃ KHỚP NHIỀU HỒ SƠ");
  await page.route("**/api/returns/receive", async (route) => {
    await route.fetch();
    await route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({ error: "E2E mất phản hồi sau khi đã lưu" }),
    });
  });
  await page.getByRole("button", { name: new RegExp(req2) }).click();
  await expect(
    page.locator(".return-scanner").getByRole("alert"),
  ).toContainText("E2E mất phản hồi");
  await expect(
    page.locator(".return-scanner").getByRole("status"),
  ).toContainText("MÃ KHỚP NHIỀU HỒ SƠ");
  await page.unroute("**/api/returns/receive");
  await page.getByRole("button", { name: new RegExp(req2) }).click();
  await expect(
    page.locator(".return-scanner").getByRole("status"),
  ).toContainText("ĐÃ NHẬN KIỆN");
  await page.reload();
  await signInAfterLogoutForReturn();
  async function signInAfterLogoutForReturn() {
    await page.request.post("/api/auth/logout", { headers, data: {} });
    await signIn(page, "staff@comsflow.demo");
  }
  await navigate(page, "Quản lý đơn hoàn");
  await expect(
    page.getByRole("tab", { name: "Nhập dữ liệu đơn hoàn", exact: true }),
  ).toHaveCount(0);
  const denied = await page.request.post("/api/returns/import/commit", {
    headers,
    multipart: {
      file: { name: "forbidden.csv", mimeType: "text/csv", buffer: file },
      context: JSON.stringify({ shop: "forbidden", warehouseId: warehouse.id }),
    },
  });
  expect(denied.status()).toBe(403);
});

if (process.env.RETURN_SAMPLE_XLSX)
  test("đơn hoàn TikTok gốc: nhập preview đúng 106 yêu cầu / 101 đơn / 89 mã / 109 sản phẩm", async ({
    page,
  }) => {
    await signIn(page);
    await navigate(page, "Quản lý đơn hoàn");
    await page
      .getByRole("tab", { name: "Nhập dữ liệu đơn hoàn", exact: true })
      .click();
    await page
      .getByLabel("File đơn hoàn", { exact: true })
      .setInputFiles(process.env.RETURN_SAMPLE_XLSX!);
    await page
      .getByRole("button", { name: "Đọc và đối chiếu đơn hoàn", exact: true })
      .click();
    const counts = page.getByLabel("Số liệu nguồn hoàn", { exact: true });
    await expect(counts).toContainText("106Yêu cầu hoàn");
    await expect(counts).toContainText("101Đơn gốc");
    await expect(counts).toContainText("89Mã vận đơn");
    await expect(counts).toContainText("109SP yêu cầu");
    await expect(counts).toContainText("17Chưa có vận đơn");
    await expect(counts).toContainText("66Thiếu Seller SKU");
    await expect(
      page.getByRole("button", {
        name: "Xác nhận lưu 106 yêu cầu hoàn",
        exact: true,
      }),
    ).toBeEnabled();
  });

test("đơn hoàn V2: cập nhật file, sao chép, lịch sử và tỷ lệ từ nguồn bán thật", async ({
  page,
  context,
}, info) => {
  test.setTimeout(90000);
  await signIn(page, "admin@comsflow.demo", "/#returns/import");
  const { returnRow, returnCsv } = await import("../return-fixture");
  const tick = String(Date.now()),
    shop = "E2E V2 " + tick,
    request = "7" + tick + "00000",
    order = "586" + tick + "01",
    code = "86" + tick.slice(-10);
  const refs = await (await page.request.get("/api/references")).json();
  const warehouse = refs.warehouses.find((w: any) => w.name === "Kho ComsMiu");
  const row = returnRow({
    "Return Order ID": request,
    "Order ID": order,
    "Return Logistics Tracking ID": code,
    "Seller SKU": "MIU37",
    "Return unit price": "100000",
    "Return Reason": "wrong size",
    "Return Logistics Provider": "J&T",
    "Seller Return Shipping Fee": "12000",
    "Other Return Fee": "2000",
    Color: "Đen",
    Size: "M",
  });
  const initial = await page.request.post("/api/returns/import/commit", {
    headers,
    multipart: {
      file: {
        name: "v2-first.csv",
        mimeType: "text/csv",
        buffer: returnCsv([row]),
      },
      context: JSON.stringify({ shop, warehouseId: warehouse.id }),
    },
  });
  expect(initial.ok(), await initial.text()).toBeTruthy();
  const shift = await page.request.post("/api/shifts/start-self", {
    headers,
    data: { warehouseId: warehouse.id },
  });
  expect(shift.ok(), await shift.text()).toBeTruthy();
  const s = await shift.json();
  const received = await page.request.post("/api/returns/receive", {
    headers,
    data: {
      code,
      requestId: crypto.randomUUID(),
      warehouseId: warehouse.id,
      shiftId: s.id,
    },
  });
  expect(received.ok(), await received.text()).toBeTruthy();
  const form = page.locator(".return-import");
  await form
    .getByRole("button", { name: "Cập nhật file", exact: true })
    .click();
  await form.getByLabel("Shop của đơn hoàn", { exact: true }).fill(shop);
  await form
    .getByRole("combobox", { name: "Kho nhận hoàn", exact: true })
    .selectOption(warehouse.id);
  await form.getByLabel("File đơn hoàn", { exact: true }).setInputFiles({
    name: "v2-update.csv",
    mimeType: "text/csv",
    buffer: returnCsv([
      {
        ...row,
        "Return Status": "Approved",
        "Return unit price": "120000",
        "Seller Return Shipping Fee": "15000",
        "Other Return Fee": "3000",
      },
    ]),
  });
  await form
    .getByRole("button", { name: "Đọc và đối chiếu đơn hoàn", exact: true })
    .click();
  await expect(form.locator(".import-review")).toContainText("Đổi tài chính");
  await form
    .getByRole("button", {
      name: "Xác nhận cập nhật 1 yêu cầu hoàn",
      exact: true,
    })
    .click();
  await expect(form.getByRole("status")).toContainText("1 yêu cầu cập nhật");
  await page
    .getByRole("tab", { name: "Danh sách & xử lý", exact: true })
    .click();
  await page
    .getByLabel("Tìm mã yêu cầu / đơn gốc / vận đơn", { exact: true })
    .fill(code);
  const record = page
    .locator(".return-list-table tbody tr")
    .filter({ hasText: request });
  await expect(record).toContainText("J&T Express");
  await expect(record).toContainText(code);
  await expect(record).toContainText("Đã nhận kiện");
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await record
    .getByRole("button", { name: "Sao chép mã vận đơn hoàn", exact: true })
    .click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(code);
  await record
    .getByRole("button", { name: "Xem / xử lý", exact: true })
    .click();
  const dialog = page.getByRole("dialog", {
    name: "Chi tiết đơn hoàn",
    exact: true,
  });
  await expect(
    dialog.getByRole("heading", { name: "Thông tin đơn hàng", exact: true }),
  ).toBeVisible();
  await expect(dialog.locator(".return-detail-header")).toContainText(code);
  await expect(
    dialog
      .getByText("Phí vận chuyển trả nhà bán chịu", { exact: true })
      .locator(".."),
  ).toContainText("15.000");
  await expect(
    dialog.getByText("Phí hoàn khác", { exact: true }).locator(".."),
  ).toContainText("3.000");
  await dialog.locator(".return-copy-menu summary").click();
  await dialog
    .getByRole("button", { name: "Toàn bộ thông tin", exact: true })
    .click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toContain(
    "Mã vận đơn hoàn: " + code,
  );
  await page.screenshot({
    path: "/tmp/wms-v2-detail-" + info.project.name + ".png",
  });
  await dialog.getByRole("button", { name: "Đóng", exact: true }).click();
  await page
    .getByRole("tab", { name: "Lịch sử cập nhật file", exact: true })
    .click();
  const history = page.getByRole("row").filter({ hasText: "v2-update.csv" });
  await history
    .getByRole("button", { name: "Xem thay đổi", exact: true })
    .first()
    .click();
  await expect(page.locator("#returns-panel")).toContainText(
    "Phí vận chuyển trả nhà bán chịu",
  );
  await page
    .getByRole("tab", { name: "Phân tích hoàn trả", exact: true })
    .click();
  await page.getByLabel("Shop phân tích", { exact: true }).fill(shop);
  await expect(page.locator(".return-analysis")).toContainText(
    "Chưa có dữ liệu bán thành công trong kỳ",
  );
  const sales = page.locator(".return-sales-import");
  await sales.locator("summary").first().click();
  await sales.getByLabel("Shop nguồn bán", { exact: true }).fill(shop);
  await sales.getByLabel("File nguồn bán", { exact: true }).setInputFiles({
    name: "sales-v2.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(
      "Order ID,SKU ID,Seller SKU,Quantity,Created Time,Order Status,Color,Size\n" +
        order +
        ",1111111111111111111,MIU37,10,2026-10-01,Delivered,Đen,M",
    ),
  });
  await sales
    .getByRole("button", { name: "Đọc và đối chiếu nguồn bán", exact: true })
    .click();
  await expect(sales).toContainText("10 SP bán");
  await sales
    .getByRole("button", { name: "Xác nhận lưu nguồn bán", exact: true })
    .click();
  await expect(sales.getByRole("status")).toContainText("Đã lưu nguồn bán");
  const product = page
    .getByRole("row")
    .filter({ has: page.getByRole("cell", { name: "MIU37", exact: true }) });
  await expect(product).toContainText("10.00%");
  await product
    .getByRole("button", { name: "Phân tích MIU37", exact: true })
    .click();
  await expect(page.locator(".return-analysis")).toContainText("Theo màu");
  await page.screenshot({
    path: "/tmp/wms-v2-analysis-" + info.project.name + ".png",
    fullPage: true,
  });
  await page.reload();
  await expect(
    page.getByRole("tab", { name: "Phân tích hoàn trả", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await page.getByLabel("Shop phân tích", { exact: true }).fill(shop);
  await expect(page.locator(".recharts-pie-sector")).toHaveCount(1);
  const sector = page.locator(".recharts-pie-sector").first();
  const bounds = await sector.boundingBox();
  expect(bounds).not.toBeNull();
  await sector.click({ position: { x: bounds!.width / 2, y: 12 } });
  await expect(
    page.getByRole("tab", { name: "Danh sách & xử lý", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await expect(page.locator(".return-list-table")).toContainText(request);
});
for (const role of ["manager", "staff"])
  test("đơn hoàn V2: quyền phân tích và cấu hình " + role, async ({ page }) => {
    await signIn(page, role + "@comsflow.demo", "/#returns/analytics");
    if (role === "staff") {
      await expect(
        page.getByRole("tab", { name: "Phân tích hoàn trả", exact: true }),
      ).toHaveCount(0);
      for (const path of [
        "analytics",
        "v2-settings",
        "import-history",
        "upload-history",
        "sales/history",
      ])
        expect((await page.request.get("/api/returns/" + path)).status()).toBe(
          403,
        );
    } else {
      await expect(page.locator(".return-analysis")).toBeVisible();
      await expect(
        page.getByRole("button", {
          name: "Cấu hình hãng, combo, lý do và ngưỡng",
          exact: true,
        }),
      ).toHaveCount(0);
    }
    expect(
      (
        await page.request.post("/api/returns/v2-settings", {
          headers,
          data: {
            kind: "thresholds",
            low: 1,
            high: 5,
            approvedStatuses: ["Approved"],
          },
        })
      ).status(),
    ).toBe(403);
  });
