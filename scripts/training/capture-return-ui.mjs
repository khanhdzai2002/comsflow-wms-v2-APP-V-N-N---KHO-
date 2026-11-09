// Capture local application UI with synthetic, intercepted API responses only.
// Never sign into or submit requests to the hosted project from this script.
import { chromium } from "@playwright/test";
import { mkdir } from "node:fs/promises";
const base = process.env.TRAINING_APP_URL || "http://127.0.0.1:5181";
if (!["localhost", "127.0.0.1"].includes(new URL(base).hostname))
  throw new Error("Local preview required");
const out = "public/huong-dan-hang-hoan/assets";
await mkdir(out, { recursive: true });
const browser = await chromium.launch({
  executablePath:
    process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || "/usr/bin/chromium",
  headless: true,
});
const page = await browser.newPage({
  viewport: { width: 1600, height: 1400 },
  deviceScaleFactor: 1.5,
  reducedMotion: "reduce",
});
const id = "11111111-1111-4111-8111-111111111111",
  jid = "22222222-2222-4222-8222-222222222222",
  pid = "33333333-3333-4333-8333-333333333333";
const at = "2026-11-09T03:00:00.000Z";
let total = 10,
  staged = [],
  kind = "delivery_failed";
const record = {
  id,
  external_id: "DEMO-TH-B001",
  order_code: "DEMO-DH-B001",
  workflow: "customer_return",
  channel: "TikTok Shop",
  shop: "ComsMiu (minh họa)",
  warehouse: "Kho ComsMiu",
  warehouse_id: id,
  requested_at: at,
  inspection_status: "pending",
  processing_status: "pending",
  version: 1,
  location: "",
  no_physical_return: false,
  source_data: [],
  obligation: "required",
  verification_status: "pending",
  quantity: 2,
  parcels: 1,
  received: 1,
};
const row = {
  ...record,
  tracking_codes: "DEMO-VC-B001",
  carrier: "J&T Express",
  primary_state: "received",
  has_receipt: true,
  received_parcels: 1,
  expected_quantity: 2,
  received_quantity: 0,
  quantity_known: false,
  goods_value: "200000",
};
const overview = {
  totals: {
    total: 16,
    required: 12,
    received: 7,
    needs_check: 2,
    in_transit: 3,
    refund_only: 2,
    not_required: 4,
    suspected_lost: 0,
    claims: 0,
    compensation: "0",
    check_value: "400000",
    problem_value: "0",
  },
  carriers: [
    {
      carrier_key: id,
      carrier: "J&T Express",
      total: 8,
      required: 6,
      received: 4,
      needs_check: 1,
      in_transit: 1,
      chart_received: 4,
      chart_other: 2,
    },
    {
      carrier_key: pid,
      carrier: "BEST Express",
      total: 8,
      required: 6,
      received: 3,
      needs_check: 1,
      in_transit: 2,
      chart_received: 3,
      chart_other: 2,
    },
  ],
  days: [{ day: "2026-11-09", total: 16 }],
  states: [
    { primary_state: "received", total: 7 },
    { primary_state: "needs_check", total: 2 },
    { primary_state: "in_transit", total: 3 },
    { primary_state: "not_required", total: 4 },
  ],
  products: [],
  claimMonths: [],
};
const errors = [];
page.on("pageerror", (e) => {
  errors.push(e.message);
  console.error("BROWSER ERROR", e.stack);
});
await page.route("**/*", async (r) => {
  const url = new URL(r.request().url());
  if (url.hostname === "storage.example.test")
    return r.fulfill({ json: { Key: "training", Id: jid } });
  if (!url.pathname.startsWith("/api/")) return r.continue();
  if (!["localhost", "127.0.0.1"].includes(url.hostname))
    throw new Error("Unexpected external API");
  const path = url.pathname.replace("/api/", "");
  let body = {};
  if (path === "auth/me")
    body = {
      user: {
        id,
        name: "Nhân viên minh họa",
        role: "admin",
        email: "training@example.test",
      },
    };
  else if (path === "references")
    body = {
      serverTime: at,
      returnOperationsReady: true,
      returnOperationsInstalled: true,
      prescanReady: true,
      prescanPermissionsReady: true,
      workerAvailable: true,
      warehouses: [{ id, name: "Kho ComsMiu" }],
      channels: [{ id, name: "TikTok Shop" }],
      carriers: [
        { id, name: "J&T Express" },
        { id: pid, name: "BEST Express" },
      ],
      shops: [],
      users: [{ id, name: "Nhân viên minh họa" }],
      rules: [],
      templates: [],
      retention: [],
      settings: {},
      shifts: [
        {
          id: jid,
          name: "Ca nhận hoàn hôm nay",
          assigned: true,
          warehouse_id: id,
          starts_at: "2026-11-09T01:00:00Z",
          ends_at: "2026-11-09T13:00:00Z",
        },
      ],
    };
  else if (path === "jobs") body = { jobs: [], workerLastSeen: at };
  else if (path.startsWith("returns/operations/handovers")) body = [];
  else if (path === "returns/events/mine") body = { events: [] };
  else if (path === "returns/operations/overview") body = overview;
  else if (path === "returns/operations/cases")
    body = { rows: [row], total: 1, page: 1 };
  else if (path === "returns/operations/imports")
    body = { rows: [], total: 0, page: 1 };
  else if (path === "returns/operations/receipts")
    body = { rows: [], total: 0, page: 1 };
  else if (path === "returns/" + id)
    body = {
      record,
      items: [
        {
          id: pid,
          sku_id: "DEMO-SKU-001",
          seller_sku: "AO-DEN-M",
          name: "Áo mẫu",
          variant: "Đen / M",
          color: "Đen",
          size: "M",
          expected_qty: 2,
          received_qty: null,
          active: true,
          unit_amount: "100000",
        },
      ],
      parcels: [
        {
          id: pid,
          tracking_code: "DEMO-VC-B001",
          carrier_id: id,
          active: true,
          received_at: at,
          employee: "Nhân viên minh họa",
          identification: { carrier: "J&T Express", carrierId: id },
        },
      ],
      events: [],
      claims: [],
      evidence: [],
    };
  else if (path === "returns/receive")
    body = {
      outcome: "received",
      recorded: true,
      code: "DEMO-VC-B001",
      eventId: jid,
      caseId: id,
      at,
      employee: "Nhân viên minh họa",
    };
  else if (path === "jobs/uploads") {
    total = kind === "delivery_failed" ? 10 : 6;
    staged = [];
    body = {
      id: jid,
      status: "waiting_upload",
      path: "training/input",
      token: "fixture",
      url: "https://storage.example.test",
      key: "fixture-public",
      bucket: "comsflow-private",
    };
  } else if (path.startsWith("jobs/")) {
    const action = path.split("/")[2];
    if (action === "finalize") body = { id: jid, status: "queued" };
    else if (action === "intake-start")
      body = { state: "staging", staged_rows: 0, total_rows: total };
    else if (action === "intake-rows") {
      staged.push(...r.request().postDataJSON().rows);
      body = { stagedRows: staged.length, totalRows: total };
    } else if (action === "intake-preview")
      body = {
        batch: { state: "ready" },
        summary: {
          rows: total,
          valid: total,
          requests: total,
          new_requests: total,
          existing_requests: 0,
          tracking: total,
          duplicates: 0,
          errors: 0,
        },
        rows: staged.slice(0, 2).map((v, i) => ({
          row_number: i + 2,
          normalized: { order: v[0], tracking: v[1], status: v[2] },
          warnings: [],
        })),
        errors: [],
        canCommit: true,
        detectedMapping: {
          mapping: { order: "Order ID", tracking: "Tracking ID" },
        },
      };
    else body = { id: jid, status: "queued", expiresAt: "2099-01-01" };
  }
  return r.fulfill({ json: body });
});
async function shot(locator, name) {
  await locator.waitFor();
  await locator.screenshot({ path: out + "/" + name + ".png" });
  console.log(name);
}
for (const [route, label, k, count] of [
  ["delivery", "giao-that-bai", "delivery_failed", 10],
  ["refunds", "tra-hang-hoan-tien", "customer_return", 6],
]) {
  kind = k;
  total = count;
  await page.goto(base + "/#returns/" + route);
  await page
    .locator(".return-operations")
    .getByRole("button", { name: "Nhập dữ liệu", exact: true })
    .click();
  const importer = page
    .locator("section.card")
    .filter({
      has: page.getByRole("heading", {
        name: "Nhập dữ liệu & Đối chiếu trước khi lưu",
        exact: true,
      }),
    })
    .last();
  await importer.waitFor();
  await shot(importer.locator(".form-grid").first(), "nguon-" + label);
  const csv =
    "Order ID,Tracking ID,Order Status\n" +
    Array.from(
      { length: count },
      (_, i) =>
        "DEMO-DH-" + (i + 1) + ",DEMO-VC-" + (i + 1) + ",Delivery failed",
    ).join("\n");
  await importer
    .getByLabel("Tệp dữ liệu hàng hoàn", { exact: true })
    .setInputFiles({
      name: label + ".csv",
      mimeType: "text/csv",
      buffer: Buffer.from(csv),
    });
  if (route === "delivery") {
    await importer
      .getByRole("button", { name: "Đọc và đối chiếu tệp", exact: true })
      .click();
    await importer
      .getByRole("button", { name: "Xác nhận nhập vào hệ thống", exact: true })
      .waitFor();
    await shot(importer.locator(".import-stats"), "xem-truoc-so-lieu");
    await shot(
      importer.locator(".inline.wrap").filter({
        has: page.getByRole("button", {
          name: "Xác nhận nhập vào hệ thống",
          exact: true,
        }),
      }),
      "xac-nhan-nhap",
    );
  }
}
await page.goto(base + "/#returns/dashboard");
await shot(page.locator(".kpi-grid").first(), "chi-so");
await page.goto(base + "/#returns/scan");
const scanner = page.locator(".return-scanner");
await shot(scanner.locator(".form-grid").first(), "chon-ca");
await shot(
  scanner
    .locator("details")
    .filter({
      has: page
        .locator("summary")
        .getByText("Phiên bàn giao · hãng / người giao / bằng chứng", {
          exact: true,
        }),
    })
    .first(),
  "phien-ban-giao",
);
await scanner
  .getByRole("textbox", { name: "Mã vận đơn hoàn", exact: true })
  .fill("DEMO-VC-B001");
await scanner
  .getByRole("button", { name: "Xác nhận nhận kiện hoàn", exact: true })
  .click();
await shot(scanner.locator(".return-receive-result"), "nhan-thanh-cong");
await scanner.locator("summary").filter({ hasText: "Thử âm báo" }).click();
await shot(scanner.locator(".return-scan-audio"), "am-bao");
await page.goto(base + "/#returns/inspection");
await page
  .getByRole("button", { name: "Xem / Xử lý", exact: true })
  .first()
  .click();
const dialog = page.getByRole("dialog");
await dialog
  .getByRole("spinbutton", { name: "Thực nhận SKU DEMO-SKU-001" })
  .fill("1");
await dialog
  .getByRole("combobox", { name: "Tình trạng kiểm hàng", exact: true })
  .selectOption("short");
await dialog
  .getByRole("textbox", { name: "Ghi chú / lý do thao tác" })
  .fill("Minh họa: nhận 1, còn thiếu 1 sản phẩm");
await shot(
  dialog.locator(".table-wrap").filter({
    has: page.getByRole("spinbutton", { name: "Thực nhận SKU DEMO-SKU-001" }),
  }),
  "kiem-sku",
);
await shot(
  dialog.getByRole("combobox", { name: "Phạm vi kiểm hàng" }).locator(".."),
  "pham-vi-kiem",
);
await dialog.getByRole("button", { name: "Đóng", exact: true }).click();
await page.goto(base + "/#returns/reports");
await shot(
  page
    .locator("section.card")
    .filter({
      has: page.getByRole("heading", {
        name: "Xuất danh sách chưa nhận – Cần kiểm tra",
        exact: true,
      }),
    })
    .last(),
  "xuat-doi-soat",
);
if (errors.length) throw new Error(errors.join("\n"));
await browser.close();
