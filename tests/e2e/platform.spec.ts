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
