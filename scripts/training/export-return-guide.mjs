// Export the checked HTML to print PDF, high-resolution slide PNGs and poster.
import { chromium } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
const out = "public/huong-dan-hang-hoan";
const base = process.env.TRAINING_GUIDE_URL || "http://127.0.0.1:5190";
if (!["localhost", "127.0.0.1"].includes(new URL(base).hostname))
  throw new Error("Local guide preview required");
await mkdir(out + "/slides", { recursive: true });
const browser = await chromium.launch({
  executablePath:
    process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || "/usr/bin/chromium",
  headless: true,
});
const page = await browser.newPage({
  viewport: { width: 1600, height: 1040 },
  deviceScaleFactor: 1.5,
});
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
await page.goto(base + "/index.html");
await page.evaluate(() => document.fonts.ready);
await page.evaluate(async () => {
  await Promise.all([...document.images].map((i) => i.decode()));
});
const count = await page.locator(".slide").count(),
  checks = [],
  notes = [];
for (let i = 0; i < count; i++) {
  await page.selectOption("#chooser", String(i));
  const slide = page.locator(".slide.active");
  const check = await slide.evaluate((s) => ({
    page: s.id,
    slideHeight: s.clientHeight,
    scrollHeight: s.scrollHeight,
    bodyHeight: s.querySelector(".body").clientHeight,
    bodyScroll: s.querySelector(".body").scrollHeight,
  }));
  if (
    check.scrollHeight > check.slideHeight + 2 ||
    check.bodyScroll > check.bodyHeight + 2
  )
    throw new Error("Slide overflow: " + JSON.stringify(check));
  checks.push(check);
  notes.push(await slide.innerText());
  await slide.screenshot({
    path: out + "/slides/" + String(i + 1).padStart(2, "0") + ".png",
    animations: "disabled",
  });
  console.log("slide", i + 1);
}
await page.pdf({
  path: out + "/Huong-dan-hang-hoan-V2.pdf",
  printBackground: true,
  preferCSSPageSize: true,
});
// Validate navigation and a genuine continuous-reading mobile page, not a
// screenshot of a desktop page reduced to illegible size.
await page.getByRole("button", { name: "Trình chiếu", exact: true }).click();
await page.selectOption("#chooser", "0");
await page.keyboard.press("ArrowRight");
if ((await page.locator("#counter").innerText()) !== "2 / " + count)
  throw new Error("Navigation failed");
await page.getByRole("button", { name: "Đọc liên tục", exact: true }).click();
if ((await page.locator(".slide:visible").count()) !== count)
  throw new Error("Reading mode failed");
await page.setViewportSize({ width: 390, height: 844 });
if (
  await page.evaluate(
    () => document.documentElement.scrollWidth > innerWidth + 1,
  )
)
  throw new Error("Mobile horizontal overflow");
await page.screenshot({
  path: "/tmp/return-training-mobile.png",
  fullPage: false,
});
await page.setViewportSize({ width: 794, height: 1300 });
await page.goto(base + "/quy-trinh-nhan-hoan.html");
await page.evaluate(() => document.fonts.ready);
await page.evaluate(async () => {
  await Promise.all([...document.images].map((i) => i.decode()));
});
const poster = page.locator(".poster");
const pc = await poster.evaluate((p) => ({
  height: p.clientHeight,
  scroll: p.scrollHeight,
}));
if (pc.scroll > pc.height + 2)
  throw new Error("Poster overflow " + JSON.stringify(pc));
await poster.screenshot({ path: out + "/Quy-trinh-nhan-hoan-A4.png" });
await page.pdf({
  path: out + "/Quy-trinh-nhan-hoan-A4.pdf",
  printBackground: true,
  preferCSSPageSize: true,
});
if (errors.length) throw new Error(errors.join("\n"));
await writeFile(out + "/slides/notes.json", JSON.stringify(notes, null, 2));
await writeFile(
  "/tmp/return-training-layout-checks.json",
  JSON.stringify(
    { slides: checks, poster: pc, browserErrors: errors },
    null,
    2,
  ),
);
await browser.close();
console.log("Exported", count, "slides and A4 poster");
