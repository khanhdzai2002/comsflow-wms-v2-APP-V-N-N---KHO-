import { test, expect } from "@playwright/test";
const id = "11111111-1111-4111-8111-111111111111";
const jobId = "22222222-2222-4222-8222-222222222222";
test.beforeEach(async ({ page }) => {
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname.replace("/api/", "");
    let body: any = {};
    if (path === "auth/me")
      body = {
        user: {
          id,
          name: "Quản trị thử nghiệm",
          email: "admin@example.test",
          role: "admin",
        },
      };
    else if (path === "references")
      body = {
        serverTime: new Date().toISOString(),
        warehouses: [{ id, name: "Kho ComsMiu" }],
        channels: [{ id, name: "Shopee" }],
        carriers: [{ id, name: "GHN" }],
        shops: [],
        shifts: [],
        users: [],
        rules: [],
        templates: [],
        retention: [],
        settings: {},
      };
    else if (path === "jobs")
      body = {
        workerLastSeen: new Date().toISOString(),
        jobs: [
          {
            id: jobId,
            route: "scan-export",
            filename: "",
            status: "succeeded",
            created_at: new Date().toISOString(),
            expires_at: "2099-01-01",
          },
        ],
      };
    else if (path === "jobs/" + jobId)
      body = {
        id: jobId,
        status: "succeeded",
        result: {
          artifact: "results/test.csv",
          filename: "test.csv",
          rows: 1940,
        },
      };
    else if (
      path === "imports" ||
      path === "returns/upload-history" ||
      path === "returns/import-history"
    )
      body = [];
    else if (path === "returns/settings") body = {};
    else if (path === "dashboard") body = {};
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(body),
    });
  });
});
test("old branding, import selection and active location survive refresh", async ({
  page,
}) => {
  await page.goto("/#imports/pdf");
  await expect(
    page.getByRole("heading", { name: "Nhập dữ liệu đơn hàng", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".brand-logo").first()).toBeVisible();
  await expect(
    page.getByRole("tab", { name: /PDF tem vận đơn/ }),
  ).toHaveAttribute("aria-selected", "true");
  await expect(page.locator(".pdf-source-import")).toBeVisible();
  await page.reload();
  await expect(page.locator(".pdf-source-import")).toBeVisible();
  expect(new URL(page.url()).hash).toBe("#imports/pdf");
});
test("durable jobs show complete row count and stable download route after F5", async ({
  page,
}) => {
  await page.goto("/#jobs/" + jobId);
  await expect(
    page.getByRole("heading", { name: "Tác vụ dữ liệu", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: /Tải file \(1940 dòng\)/ }),
  ).toHaveAttribute("href", "/api/jobs/" + jobId + "/download");
  await page.reload();
  await expect(
    page.getByRole("link", { name: /Tải file \(1940 dòng\)/ }),
  ).toBeVisible();
  await page.screenshot({
    path: "test-results/platform-jobs.png",
    fullPage: true,
  });
});
test("return import remains directly identifiable as its own selected tab", async ({
  page,
}) => {
  await page.goto("/#returns/import");
  await expect(
    page.getByRole("tab", { name: "Nhập dữ liệu đơn hoàn", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await expect(page.locator(".return-import")).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("tab", { name: "Nhập dữ liệu đơn hoàn", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
});
test("first-admin setup explains disabled status and can recheck after configuration", async ({
  page,
}) => {
  let state = "missing";
  await page.route("**/api/auth/me", (route) =>
    route.fulfill({ json: { user: null } }),
  );
  await page.route("**/api/auth/setup-status", (route) => {
    if (state === "error")
      return route.fulfill({
        status: 503,
        json: { error: "Database tạm thời không khả dụng" },
      });
    return route.fulfill({
      json:
        state === "ready"
          ? { available: true, code: "SETUP_READY" }
          : {
              available: false,
              code: "SETUP_TOKEN_MISSING",
              message:
                "Chưa bật tạo Admin. Thêm Secret SETUP_TOKEN trong Cloudflare.",
            },
    });
  });
  await page.goto("/");
  await expect(page.getByText(/Chưa bật tạo Admin/)).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Tạo Admin đầu tiên" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Đăng nhập", exact: true }),
  ).toBeEnabled();
  state = "error";
  await page.getByRole("button", { name: "Kiểm tra lại thiết lập" }).click();
  await expect(page.getByRole("alert")).toContainText(
    "Chưa kiểm tra được trạng thái tạo Admin",
  );
  state = "ready";
  await page.getByRole("button", { name: "Kiểm tra lại thiết lập" }).click();
  await page.getByRole("button", { name: "Tạo Admin đầu tiên" }).click();
  await expect(page.getByLabel("Mã thiết lập", { exact: true })).toBeVisible();
  await expect(
    page.getByText(
      "Dùng mã thiết lập đã lưu trong Cloudflare để khởi tạo hệ thống.",
    ),
  ).toBeVisible();
});

test("empty catalogs can be initialized and the open shift form submits the newly loaded warehouse", async ({
  page,
}) => {
  let ready = false;
  let submitted: any = null;
  const owner = {
    id,
    name: "Quản trị thử nghiệm",
    email: "admin@example.test",
    role: "admin",
    active: true,
  };
  await page.route("**/api/references", (route) =>
    route.fulfill({
      json: {
        serverTime: new Date().toISOString(),
        warehouses: ready ? [{ id, name: "Kho ComsMiu" }] : [],
        channels: ready ? [{ id, name: "Shopee" }] : [],
        carriers: ready ? [{ id, name: "GHN" }] : [],
        shops: [],
        shifts: [],
        users: [owner],
        rules: [],
        templates: [],
        retention: [],
        settings: {},
      },
    }),
  );
  await page.route("**/api/config/setup", (route) => {
    ready = true;
    return route.fulfill({
      json: { ok: true, created: [{ id, name: "Kho ComsMiu" }] },
    });
  });
  await page.route("**/api/shifts", (route) => {
    submitted = route.request().postDataJSON();
    return route.fulfill({ json: { id } });
  });
  await page.goto("/#people");
  await page.getByLabel("Tên ca", { exact: true }).fill("Ca kiểm thử");
  await expect(
    page.getByRole("button", { name: "Tạo ca làm việc" }),
  ).toBeDisabled();
  await page
    .getByRole("button", { name: "Thiết lập danh mục cơ bản", exact: true })
    .click();
  await expect(
    page.getByRole("combobox", { name: "Kho", exact: true }),
  ).toHaveValue(id);
  await page.getByRole("button", { name: "Tạo ca làm việc" }).click();
  await expect.poll(() => submitted?.warehouseId).toBe(id);
  expect(submitted.members).toEqual([id]);
});

test("administrator can change a colleague's role through the account screen", async ({
  page,
}) => {
  const colleague = "33333333-3333-4333-8333-333333333333";
  let currentRole = "staff";
  let submitted: any;
  await page.route("**/api/references", (route) =>
    route.fulfill({
      json: {
        serverTime: new Date().toISOString(),
        warehouses: [{ id, name: "Kho" }],
        channels: [{ id, name: "Shopee" }],
        carriers: [{ id, name: "GHN" }],
        shops: [],
        shifts: [],
        users: [
          { id, name: "Owner", role: "admin", active: true },
          {
            id: colleague,
            name: "Nhân viên thử nghiệm",
            email: "staff@example.test",
            role: currentRole,
            active: true,
          },
        ],
        rules: [],
        templates: [],
        retention: [],
        settings: {},
      },
    }),
  );
  await page.route("**/api/users/update", (route) => {
    submitted = route.request().postDataJSON();
    currentRole = submitted.role;
    return route.fulfill({
      json: { id: colleague, role: currentRole, active: true },
    });
  });
  await page.goto("/#people");
  await page
    .getByRole("button", { name: "Tài khoản nhân viên", exact: true })
    .click();
  await page
    .getByRole("row")
    .filter({ hasText: "Nhân viên thử nghiệm" })
    .getByRole("button", { name: "Đổi quyền", exact: true })
    .click();
  await page.getByLabel("Vai trò mới").selectOption("admin");
  await page
    .getByLabel("Lý do đổi quyền")
    .fill("Cấp quản trị cho nhân viên thử nghiệm");
  await page.getByRole("button", { name: "Lưu quyền", exact: true }).click();
  await expect.poll(() => submitted?.role).toBe("admin");
  expect(submitted.id).toBe(colleague);
  expect(submitted).not.toHaveProperty("active");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(
    page.getByRole("row").filter({ hasText: "Nhân viên thử nghiệm" }),
  ).toContainText("admin");
});

test("return overview opens matching carrier cases and permits processing without leaving the list", async ({
  page,
}, testInfo) => {
  const jt = "33333333-3333-4333-8333-333333333333";
  const caseId = "55555555-5555-4555-8555-555555555555";
  const record: any = {
    id: caseId,
    external_id: "1234567890123456789",
    order_code: "586000000000000001",
    channel: "TikTok Shop",
    shop: "Shop thử nghiệm",
    warehouse: "Kho ComsMiu",
    warehouse_id: id,
    requested_at: "2026-10-21T03:00:00.000Z",
    received: 0,
    parcels: 1,
    quantity: 2,
    received_quantity: 0,
    return_tracking: "862000000001",
    return_carriers: "J&T Express",
    platform_status: "To Process",
    platform_substatus: "Return shipped",
    inspection_status: "pending",
    processing_status: "pending",
    version: 1,
    location: "",
    no_physical_return: false,
    source_data: [],
  };
  const queries: URLSearchParams[] = [];
  let submitted: any;
  await page.route("**/api/returns**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/api/returns/" + caseId)
      return route.fulfill({
        json: {
          record,
          items: [],
          parcels: [
            {
              id: "66666666-6666-4666-8666-666666666666",
              tracking_code: "862000000001",
              carrier_id: jt,
              active: true,
              received_at: null,
              identification: { carrier: "J&T Express", carrierId: jt },
            },
          ],
          claims: [],
          events: [],
          evidence: [],
        },
      });
    if (url.pathname === "/api/returns/update") {
      submitted = route.request().postDataJSON();
      record.processing_status = submitted.status;
      record.version++;
      return route.fulfill({ json: { ok: true } });
    }
    if (url.pathname !== "/api/returns") return route.fallback();
    queries.push(url.searchParams);
    const filtered =
      !!url.searchParams.get("state") || !!url.searchParams.get("carrier");
    return route.fulfill({
      json: {
        rows: filtered ? [record] : [],
        page: 1,
        events: [],
        overdueDays: 7,
        totals: {
          requests: filtered ? 1 : 10,
          received: 6,
          unreceived: 4,
          lost: 1,
          claim_success: 2,
          waiting_inspection: 3,
          excluded: 0,
          partial_receipt: 1,
          overdue: 2,
          open_claims: 3,
          missing_tracking: 1,
          stale: 1,
          claim_requested: 100000,
          claim_approved: 80000,
          claim_received: 50000,
        },
        carriers: [
          {
            id: jt,
            name: "J&T Express",
            requests: 6,
            received: 3,
            unreceived: 3,
          },
          {
            id: "unknown",
            name: "Chưa xác định",
            requests: 4,
            received: 3,
            unreceived: 1,
          },
        ],
        trend: [{ day: "2026-10-21", requests: 10, received: 6 }],
      },
    });
  });
  await page.goto("/#returns/dashboard");
  await expect(
    page.getByRole("button", { name: /^Tổng đơn hoàn/ }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: /^Đơn hoàn đã về kho/ }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: /^Đơn bị mất/ })).toBeVisible();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(page.viewportSize()!.width + 1);
  await page.screenshot({
    path: `test-results/return-overview-${testInfo.project.name}.png`,
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "J&T Express: 3 đơn còn thiếu", exact: true })
    .click();
  await expect(
    page.getByRole("tab", { name: "Danh sách & xử lý", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await expect.poll(() => queries.at(-1)?.get("carrier")).toBe(jt);
  expect(queries.at(-1)?.get("carrierScope")).toBe("exclusive");
  expect(queries.at(-1)?.get("state")).toBe("unreceived");
  await page.getByRole("button", { name: "Xem / xử lý", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Chi tiết đơn hoàn" });
  await expect(
    dialog.getByText("862000000001", { exact: true }).first(),
  ).toBeVisible();
  await dialog.getByLabel("Trạng thái xử lý nội bộ").selectOption("checking");
  await dialog
    .getByLabel("Ghi chú / lý do thao tác")
    .fill("Đang liên hệ hãng để đối soát kiện hoàn");
  await dialog
    .getByRole("button", { name: "Lưu ghi chú / trạng thái", exact: true })
    .click();
  await expect.poll(() => submitted?.status).toBe("checking");
  expect(submitted.id).toBe(caseId);
  await dialog.getByRole("button", { name: "Đóng", exact: true }).click();
  await page
    .getByRole("tab", { name: "Dashboard đơn hoàn", exact: true })
    .click();
  await expect.poll(() => queries.at(-1)?.get("state")).toBeNull();
  await expect(page.getByLabel("Mốc theo dõi đơn chưa về (ngày)")).toHaveValue(
    "7",
  );
  await page
    .getByRole("tab", { name: "Khiếu nại & đơn mất", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Toàn bộ thời gian", exact: true })
    .click();
  await expect.poll(() => queries.at(-1)?.get("state")).toBe("claims_or_lost");
  await page
    .getByRole("tab", { name: "Dashboard đơn hoàn", exact: true })
    .click();
  await expect.poll(() => queries.at(-1)?.get("state")).toBeNull();
});

test("both scan stations open a valid assigned shift after catalogs arrive", async ({
  page,
}) => {
  let initialized = false,
    started = false;
  let submitted: any;
  const shiftId = "77777777-7777-4777-8777-777777777777";
  await page.route("**/api/references", (route) =>
    route.fulfill({
      json: {
        serverTime: new Date().toISOString(),
        warehouses: initialized ? [{ id, name: "Kho kiểm thử" }] : [],
        channels: initialized ? [{ id, name: "TikTok Shop" }] : [],
        carriers: initialized ? [{ id, name: "GHN" }] : [],
        shops: [],
        shifts: started
          ? [
              {
                id: shiftId,
                name: "Ca kiểm thử",
                warehouse_id: id,
                assigned: true,
                member_ids: [id],
                starts_at: new Date(Date.now() - 60000).toISOString(),
                ends_at: new Date(Date.now() + 3600000).toISOString(),
              },
            ]
          : [],
        users: [{ id, name: "Admin", role: "admin", active: true }],
        rules: [],
        templates: [],
        retention: [],
        settings: {},
      },
    }),
  );
  await page.route("**/api/config/setup", (route) => {
    initialized = true;
    return route.fulfill({ json: { ok: true, created: [{ id }] } });
  });
  await page.route("**/api/shifts/start-self", (route) => {
    submitted = route.request().postDataJSON();
    started = true;
    return route.fulfill({ json: { id: shiftId } });
  });
  await page.route("**/api/scans/mine**", (route) =>
    route.fulfill({
      json: { summary: { success: 0, duplicate: 0, error: 0 }, recent: [] },
    }),
  );
  for (const station of ["scan", "returns/scan"]) {
    initialized = false;
    started = false;
    submitted = null;
    await page.goto("/?station=" + station + "#" + station);
    const open = page.getByRole("button", {
      name: station === "scan" ? "Mở ca cho tôi" : "Mở ca nhận cho tôi",
      exact: true,
    });
    await expect(open).toBeDisabled();
    await page
      .getByRole("button", { name: "Thiết lập danh mục cơ bản", exact: true })
      .click();
    await expect(open).toBeEnabled();
    await open.click();
    await expect.poll(() => submitted?.warehouseId).toBe(id);
    await expect(
      page.getByRole("combobox", {
        name: station === "scan" ? "Ca làm việc" : "Ca nhận hoàn",
        exact: true,
      }),
    ).toHaveValue(shiftId);
  }
});
