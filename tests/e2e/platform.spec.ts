import { test, expect } from "@playwright/test";
import { returnCsv, returnRow } from "../return-fixture";
import { parseTikTokReturnCsv } from "../../src/lib/return-csv-parse";
import {
  makePdf,
  labelText,
  continuationText,
  shopeeLabelText,
} from "../pdf-fixture";
import { analyzeLabelPages } from "../../src/lib/pdf-labels";
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

test("real browser PDF worker reads JT/SPX, resumes sent pages and retries a lost save without a processor", async ({
  page,
}) => {
  const files = [
    {
      name: "JT-fixture.pdf",
      mimeType: "application/pdf",
      buffer: makePdf([
        labelText(),
        continuationText(),
        labelText("862000000002"),
      ]),
    },
    {
      name: "SPX-fixture.pdf",
      mimeType: "application/pdf",
      buffer: makePdf([shopeeLabelText()]),
    },
  ];
  const jobs = new Map<string, any>();
  let lostPages = false,
    lostCommit = false;
  const commits: string[] = [];
  await page.route("**/api/sources**", (route) => route.fulfill({ json: [] }));
  await page.route("https://storage.example.test/**", (route) =>
    route.fulfill({ json: { Key: "fixture", Id: jobId } }),
  );
  await page.route("**/api/jobs/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/jobs/uploads") {
      const data = route.request().postDataJSON();
      expect(data.route).toBe("sources/browser/preview");
      const job =
        "77777777-7777-4777-8777-" + String(jobs.size + 1).padStart(12, "0");
      jobs.set(job, {
        ...data,
        id: job,
        pages: [],
        status: "queued",
        attempts: 0,
      });
      return route.fulfill({
        json: {
          id: job,
          status: "waiting_upload",
          path: "input/" + job,
          token: "fixture-upload",
          url: "https://storage.example.test",
          key: "fixture-public",
          bucket: "comsflow-private",
        },
      });
    }
    const [, , , key, action] = path.split("/");
    const job = jobs.get(key);
    if (!job)
      return route.fulfill({ status: 404, json: { error: "Missing fixture" } });
    if (action === "finalize")
      return route.fulfill({ json: { id: key, status: job.status } });
    if (action === "pdf-pages") {
      const body = route.request().postDataJSON();
      expect(body.offset).toBe(job.pages.length);
      expect(body.pages.length).toBeLessThanOrEqual(20);
      expect(body.labels).toBeUndefined();
      job.pages.push(...body.pages);
      job.totalPages = body.totalPages;
      if (job.filename.startsWith("JT") && !lostPages) {
        lostPages = true;
        return route.abort("failed");
      }
      return route.fulfill({
        json: { receivedPages: job.pages.length, totalPages: job.totalPages },
      });
    }
    if (action === "pdf-preview") {
      expect(job.pages).toHaveLength(job.totalPages);
      const parsed = analyzeLabelPages(job.pages, job.sha256);
      expect(parsed.errors).toEqual([]);
      job.status = "succeeded";
      job.result = {
        ...parsed,
        uniqueShipments: parsed.labels.length,
        existingShipments: 0,
        alreadyScanned: 0,
        alreadyHanded: 0,
        differentDueDates: 0,
        conflicts: [],
        existingManifestId: null,
        existingManifestArchived: false,
        carrierUnresolved: false,
        channelName: parsed.detectedChannels[0],
        carrierName: parsed.detectedCarriers[0],
        carrierId: id,
      };
      return route.fulfill({ json: job.result });
    }
    if (action === "commit") {
      job.attempts++;
      if (!commits.includes(key)) commits.push(key);
      job.route = "sources/browser/commit";
      if (job.filename.startsWith("JT") && !lostCommit) {
        lostCommit = true;
        return route.abort("failed");
      }
      return route.fulfill({
        json: {
          id: key,
          total: job.result.uniqueShipments,
          newShipments: job.result.uniqueShipments,
          reused: false,
        },
      });
    }
    expect(action).toBeUndefined();
    return route.fulfill({
      json: {
        id: key,
        route: job.route,
        status: job.status,
        receivedPages: job.pages.length,
        totalPages: job.totalPages,
        workerAvailable: false,
      },
    });
  });
  await page.goto("/#imports/pdf");
  await page.getByLabel("File PDF nguồn", { exact: true }).setInputFiles(files);
  const read = page.getByRole("button", {
    name: "Đọc và đếm PDF",
    exact: true,
  });
  await read.click();
  await expect(read).toBeEnabled({ timeout: 30000 });
  await expect(
    page.locator(".source-preview[data-state='blocked']"),
  ).toHaveCount(1);
  await read.click();
  await expect(page.locator(".source-preview[data-state='ready']")).toHaveCount(
    2,
    { timeout: 30000 },
  );
  const previews = page.locator(".source-preview");
  await expect(previews.filter({ hasText: "JT-fixture.pdf" })).toContainText(
    "2 vận đơn duy nhất",
  );
  await expect(previews.filter({ hasText: "JT-fixture.pdf" })).toContainText(
    "1 trang sản phẩm tiếp theo",
  );
  await expect(previews.filter({ hasText: "SPX-fixture.pdf" })).toContainText(
    "SPX Express",
  );
  await expect(page.locator(".pdf-batch-summary")).toContainText(
    "3 vận đơn duy nhất",
  );
  expect(commits).toHaveLength(0);
  await page
    .getByRole("button", { name: "Lưu 2 file hợp lệ", exact: true })
    .click();
  await expect(page.locator(".source-preview[data-state='saved']")).toHaveCount(
    1,
  );
  await page
    .getByRole("button", { name: /Lưu 1 file hợp lệ \/ thử lại file chưa lưu/ })
    .click();
  await expect(page.locator(".source-preview[data-state='saved']")).toHaveCount(
    2,
  );
  expect(jobs.size).toBe(2);
  expect(commits).toHaveLength(2);
  expect(
    [...jobs.values()].find((j) => j.filename.startsWith("JT")).attempts,
  ).toBe(2);
});

test("TikTok CSV imports without a processor and safely resumes after a lost commit response", async ({
  page,
}) => {
  const bytes = returnCsv([returnRow()]);
  const parsed = parseTikTokReturnCsv(bytes);
  let uploaded = false,
    committed = false,
    commitCalls = 0,
    polled = 0;
  const preview = {
    ...parsed,
    _csvDirect: true,
    _jobId: jobId,
    previewFingerprint: "a".repeat(64),
    canCommit: true,
    existingRequests: 0,
    conflicts: [],
    changes: [],
    carrierChecks: [
      {
        row: 2,
        request: parsed.rows[0].request,
        tracking: parsed.rows[0].tracking,
        carrierId: id,
        carrier: "J&T Express",
        origin: "format",
      },
    ],
    carrierSummary: [{ id, name: "J&T Express", requests: 1 }],
    updateSummary: {
      new: 1,
      existing: 0,
      status: 0,
      unchanged: 0,
      finance: 0,
      errors: 0,
    },
  };
  await page.route("**/api/references", (route) =>
    route.fulfill({
      json: {
        serverTime: new Date().toISOString(),
        warehouses: [{ id, name: "Kho ComsMiu" }],
        channels: [{ id, name: "TikTok Shop" }],
        carriers: [{ id, name: "J&T Express" }],
        shops: [],
        shifts: [],
        users: [],
        rules: [],
        templates: [],
        retention: [],
        settings: {},
        workerAvailable: false,
        workerLastSeen: null,
      },
    }),
  );
  await page.route("https://storage.example.test/**", (route) => {
    uploaded = true;
    return route.fulfill({
      json: { Key: "comsflow-private/input", Id: jobId },
    });
  });
  await page.route("**/api/jobs/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/jobs/uploads") {
      expect(route.request().postDataJSON()).toMatchObject({
        route: "returns/csv/preview",
        filename: "tiktok.csv",
        sha256: parsed.hash,
      });
      return route.fulfill({
        json: {
          id: jobId,
          status: "waiting_upload",
          path: "input",
          token: "fixture-upload",
          url: "https://storage.example.test",
          key: "fixture-public",
          bucket: "comsflow-private",
        },
      });
    }
    if (path.endsWith("/finalize"))
      return route.fulfill({ json: { id: jobId, status: "queued" } });
    if (path.endsWith("/csv-preview")) {
      expect(uploaded).toBe(true);
      return route.fulfill({ json: preview });
    }
    if (path.endsWith("/commit")) {
      commitCalls++;
      if (!committed) {
        committed = true;
        return route.abort("failed");
      }
      return route.fulfill({
        json: {
          id,
          created: 1,
          updated: 0,
          reused: false,
          _csvDirect: true,
          _jobId: jobId,
        },
      });
    }
    polled++;
    return route.fulfill({
      json: { id: jobId, status: "queued", workerAvailable: false },
    });
  });
  await page.goto("/#returns/import");
  await page
    .getByLabel("File đơn hoàn", { exact: true })
    .setInputFiles({ name: "tiktok.csv", mimeType: "text/csv", buffer: bytes });
  await page.getByRole("button", { name: "Đọc và đối chiếu đơn hoàn" }).click();
  const save = page.getByRole("button", {
    name: /Xác nhận lưu 1 yêu cầu hoàn/,
  });
  await expect(save).toBeEnabled();
  await expect(page.locator(".return-carrier-preview")).toContainText(
    "J&T Express",
  );
  await expect(page.locator(".return-carrier-preview")).toContainText("1");
  const importMetrics = page.locator(".import-review .source-counts");
  await expect(
    importMetrics.getByRole("button", { name: /^Giải thích:/ }),
  ).toHaveCount(13);
  await expect(
    page.getByText("Mã vận đơn hoàn", { exact: true }),
  ).toBeVisible();
  const missingHelp = page.getByRole("button", {
    name: "Giải thích: Chưa có mã vận đơn hoàn",
    exact: true,
  });
  if (test.info().project.name === "mobile") await missingHelp.tap();
  else await missingHelp.hover();
  const tooltip = page.getByRole("tooltip");
  await expect(tooltip).toContainText("Return Logistics Tracking ID");
  await expect(tooltip).toContainText("chưa thể kết luận thiếu hàng");
  const tipBounds = await tooltip.boundingBox();
  expect(tipBounds!.x).toBeGreaterThanOrEqual(0);
  expect(tipBounds!.x + tipBounds!.width).toBeLessThanOrEqual(
    page.viewportSize()!.width,
  );
  await page.screenshot({
    path: `test-results/return-import-help-${test.info().project.name}.png`,
  });
  await missingHelp.press("Escape");
  await expect(tooltip).toHaveCount(0);
  const newHelp = page.getByRole("button", {
    name: "Giải thích: Yêu cầu mới",
    exact: true,
  });
  await newHelp.focus();
  await expect(tooltip).toContainText("Chỉ được lưu khi bạn xác nhận");
  await newHelp.press("Escape");
  await expect(tooltip).toHaveCount(0);
  await expect(page.getByText("Đã lưu nguồn", { exact: true })).toHaveCount(0);
  await save.click();
  await expect(
    page.getByText(/Chưa nhận được xác nhận từ máy chủ/),
  ).toBeVisible();
  await expect(save).toBeEnabled();
  await save.click();
  await expect(
    page.getByText(/Đã nhập · 1 yêu cầu mới · 0 yêu cầu cập nhật/),
  ).toBeVisible();
  expect(commitCalls).toBe(2);
  expect(polled).toBe(0);
  await expect(save).toBeDisabled();
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

test.describe("24-hour shift scheduling independent of browser locale", () => {
  test.use({ locale: "en-US", timezoneId: "America/Los_Angeles" });
  test("noon and overnight shifts submit Vietnam times; midnight-before-start is blocked", async ({
    page,
  }) => {
    const submitted: any[] = [];
    await page.route("**/api/references", (route) =>
      route.fulfill({
        json: {
          serverTime: "2026-10-24T01:15:00.000Z",
          warehouses: [{ id, name: "Kho ComsMiu" }],
          channels: [{ id, name: "Shopee" }],
          carriers: [{ id, name: "GHN" }],
          shops: [],
          shifts: [],
          rules: [],
          templates: [],
          retention: [],
          settings: {},
          users: [
            {
              id,
              name: "Quản trị thử nghiệm",
              email: "admin@example.test",
              role: "admin",
              active: true,
            },
          ],
        },
      }),
    );
    await page.route("**/api/shifts", (route) => {
      submitted.push(route.request().postDataJSON());
      return route.fulfill({ json: { id } });
    });
    await page.goto("/#people");
    await page.getByLabel("Tên ca", { exact: true }).fill("Ca sáng");
    await page.getByLabel("Bắt đầu · Ngày", { exact: true }).fill("2026-10-24");
    await page.getByLabel("Bắt đầu · Giờ", { exact: true }).selectOption("08");
    await page.getByLabel("Bắt đầu · Phút", { exact: true }).selectOption("15");
    await page
      .getByLabel("Kết thúc · Ngày", { exact: true })
      .fill("2026-10-24");
    await page.getByLabel("Kết thúc · Giờ", { exact: true }).selectOption("00");
    await page
      .getByLabel("Kết thúc · Phút", { exact: true })
      .selectOption("00");
    await page.getByRole("button", { name: "Tạo ca làm việc" }).click();
    await expect(
      page.getByText(/Kết thúc \(.+\) phải sau bắt đầu/),
    ).toBeVisible();
    expect(submitted).toHaveLength(0);
    await page.getByLabel("Kết thúc · Giờ", { exact: true }).selectOption("12");
    await page.getByRole("button", { name: "Tạo ca làm việc" }).click();
    await expect.poll(() => submitted.length).toBe(1);
    expect(submitted[0]).toMatchObject({
      startsAt: "2026-10-24T01:15:00.000Z",
      endsAt: "2026-10-24T05:00:00.000Z",
    });
    await expect(
      page.getByText("Đã tạo ca làm việc", { exact: true }),
    ).toBeVisible();
    await page.getByLabel("Tên ca", { exact: true }).fill("Ca qua đêm");
    await page.getByLabel("Bắt đầu · Giờ", { exact: true }).selectOption("22");
    await page.getByLabel("Bắt đầu · Phút", { exact: true }).selectOption("00");
    await page
      .getByLabel("Kết thúc · Ngày", { exact: true })
      .fill("2026-10-25");
    await page.getByLabel("Kết thúc · Giờ", { exact: true }).selectOption("00");
    await page.getByRole("button", { name: "Tạo ca làm việc" }).click();
    await expect.poll(() => submitted.length).toBe(2);
    expect(submitted[1]).toMatchObject({
      startsAt: "2026-10-24T15:00:00.000Z",
      endsAt: "2026-10-24T17:00:00.000Z",
    });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: `test-results/shift-time-${test.info().project.name}.png`,
      fullPage: true,
    });
  });
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
            name: "Chưa nhận diện hãng",
            requests: 1,
            received: 0,
            unreceived: 1,
          },
          {
            id: "no_tracking",
            name: "Chưa có mã vận đơn hoàn",
            requests: 3,
            received: 0,
            unreceived: 0,
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
  await expect(
    page
      .locator(".return-carrier-name")
      .filter({ hasText: "Chưa nhận diện hãng" }),
  ).toHaveCount(1);
  await expect(
    page
      .locator(".return-carrier-name")
      .filter({ hasText: "Chưa có mã vận đơn hoàn" }),
  ).toHaveCount(1);
  const kpis = page.locator(".return-overview-kpis");
  await expect(kpis.getByRole("button", { name: /^Giải thích:/ })).toHaveCount(
    6,
  );
  await expect(kpis.locator("button button")).toHaveCount(0);
  const unreceivedHelp = kpis.getByRole("button", {
    name: "Giải thích: Đơn hoàn chưa về kho",
    exact: true,
  });
  if (testInfo.project.name === "mobile") await unreceivedHelp.tap();
  else await unreceivedHelp.hover();
  await expect(page.getByRole("tooltip")).toContainText(
    "Chưa thể kết luận đơn bị mất",
  );
  expect(queries.at(-1)?.get("state")).toBeNull();
  await unreceivedHelp.press("Escape");
  await expect(page.getByRole("tooltip")).toHaveCount(0);
  const lostHelp = kpis.getByRole("button", {
    name: "Giải thích: Đơn bị mất",
    exact: true,
  });
  await lostHelp.focus();
  await expect(page.getByRole("tooltip")).toContainText("đã xác nhận mất");
  await page.screenshot({
    path: `test-results/return-overview-help-${testInfo.project.name}.png`,
  });
  await page.locator(".return-overview .section-toolbar .live-label").click();
  await expect(page.getByRole("tooltip")).toHaveCount(0);
  await expect(
    page.getByRole("tab", { name: "Dashboard đơn hoàn", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(page.viewportSize()!.width + 1);
  await page.screenshot({
    path: `test-results/return-overview-${testInfo.project.name}.png`,
    fullPage: true,
  });
  await page
    .getByRole("button", {
      name: "J&T Express: 3 đơn chưa về kho",
      exact: true,
    })
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
  await page
    .getByRole("button", { name: "Chưa có mã vận đơn hoàn", exact: true })
    .click();
  await expect.poll(() => queries.at(-1)?.get("carrier")).toBe("no_tracking");
  expect(queries.at(-1)?.get("carrierScope")).toBe("exclusive");
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
