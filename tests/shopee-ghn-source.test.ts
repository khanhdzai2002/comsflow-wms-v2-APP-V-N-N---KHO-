import { readFile } from "node:fs/promises";
import { describe, it, expect } from "vitest";
import { analyzeLabelPages, parseSourcePdf } from "../src/lib/pdf-source";
import { canonicalSourceCarrier } from "../src/lib/source-carriers";
import {
  shopeeLabelText,
  shopeeContinuationText,
  makePdf,
} from "./pdf-fixture";

const order = "261021TEST0001";
const label = (code = "GTEST001", id = order) => shopeeLabelText(code, id);

describe("Nhận diện nguồn Shopee/GHN", () => {
  it("một mã GHN in một lần, đếm mã duy nhất và giữ nhiều kiện cùng đơn", async () => {
    const pdf = await parseSourcePdf(
      makePdf([label(), label(), label("GTEST002")]),
    );
    expect(pdf).toMatchObject({
      pageCount: 3,
      orderCount: 1,
      duplicatePages: 1,
      continuationPages: 0,
      detectedChannels: ["Shopee"],
      detectedCarriers: ["GHN"],
      errors: [],
    });
    expect(pdf.labels).toHaveLength(2);
    expect(pdf.labels[0]).toMatchObject({
      channel: "Shopee",
      carrier: "GHN",
      trackingCode: "GTEST001",
      orderId: order,
      pages: [1, 2],
    });
  });

  it("ghép trang sản phẩm cùng OrderSN, không lấy số trang làm số kiện", async () => {
    const main = label().split("\n").slice(0, 2).join("\n");
    const pdf = await parseSourcePdf(
      makePdf([
        main,
        shopeeContinuationText(order),
        shopeeContinuationText(order),
      ]),
    );
    expect(pdf).toMatchObject({
      pageCount: 3,
      orderCount: 1,
      duplicatePages: 0,
      continuationPages: 2,
      errors: [],
    });
    expect(pdf.labels).toHaveLength(1);
    expect(pdf.labels[0].pages).toEqual([1, 2, 3]);
  });

  it("chỉ lấy mã từ Mã vận đơn, không nhầm tên sản phẩm hoặc SKU bắt đầu G", () => {
    const pdf = analyzeLabelPages(
      [label() + "\nGPRODUCT SKU: GTEST999"],
      "product-codes",
    );
    expect(pdf.errors).toEqual([]);
    expect(pdf.labels.map((p) => p.trackingCode)).toEqual(["GTEST001"]);
  });

  it.each([
    ["mã quá ngắn", [label("GTEST01")]],
    ["mã quá dài", [label("GTEST0001")]],
    ["hãng chưa hỗ trợ", [label("ZTEST001")]],
    ["mã có hậu tố không hợp lệ", [label("GTEST001/EXTRA")]],
    ["thiếu nhãn vận đơn", [label().replace("Ma van don:", "Other:")]],
    ["thiếu mã đơn", [label().replace(/Ma don hang:.*/g, "")]],
    ["thiếu OrderSN", [label().replace(/OrderSN:.*/g, "")]],
    [
      "sai OrderSN",
      [label().replace(`OrderSN: ${order}`, "OrderSN: 261021TEST0002")],
    ],
    [
      "thiếu bảng sản phẩm",
      [label().split("\n").slice(0, 2).join("\n") + `\nOrderSN: ${order}`],
    ],
    ["hai trường vận đơn", [label() + "\nMa van don: GTEST002"]],
    ["trộn SPX trên cùng tem", [label() + "\nSPXVN00000000001A"]],
    ["trộn J&T trên cùng tem", [label() + "\n862000000001"]],
    ["trang mồ côi", [shopeeContinuationText(order)]],
    [
      "trang tiếp theo sai đơn",
      [label(), shopeeContinuationText("261021TEST0002")],
    ],
    ["trang lỗi cắt chuỗi", [label(), "", shopeeContinuationText(order)]],
    ["cùng vận đơn khác đơn", [label(), label("GTEST001", "261021TEST0002")]],
  ])("chặn %s thay vì đếm/lưu nhầm", (_name, pages) => {
    expect(
      analyzeLabelPages(pages as string[], "invalid").errors.length,
    ).toBeGreaterThan(0);
  });

  it("một file trộn GHN và SPX bị chặn; từng file vẫn được nhận riêng", () => {
    const pdf = analyzeLabelPages([label(), shopeeLabelText()], "mixed");
    expect(pdf.detectedChannels).toEqual(["Shopee"]);
    expect(pdf.detectedCarriers).toEqual(["GHN", "SPX Express"]);
    expect(pdf.errors.some((e) => e.page === 0)).toBe(true);
  });

  it.each([
    "GHN",
    "Giao Hàng Nhanh",
    "Giao Hang Nhanh",
    "GHN - Giao Hàng Nhanh",
  ])("danh mục chấp nhận tên %s cho cùng hãng GHN", (name) =>
    expect(canonicalSourceCarrier(name)).toBe("GHN"),
  );

  if (process.env.GHN_SAMPLE_PDF)
    it("PDF GHN gốc: đọc đủ 14 tem, 14 đơn, 14 mã duy nhất và không có trang lỗi", async () => {
      const pdf = await parseSourcePdf(
        await readFile(process.env.GHN_SAMPLE_PDF!),
      );
      expect(pdf).toMatchObject({
        pageCount: 14,
        orderCount: 14,
        duplicatePages: 0,
        continuationPages: 0,
        detectedChannels: ["Shopee"],
        detectedCarriers: ["GHN"],
        errors: [],
      });
      expect(pdf.labels).toHaveLength(14);
      expect(new Set(pdf.labels.map((p) => p.trackingCode)).size).toBe(14);
      for (const [i, parcel] of pdf.labels.entries()) {
        expect(parcel.trackingCode).toMatch(/^G[A-Z0-9]{7}$/);
        expect(parcel.orderId).toMatch(/^\d{6}[A-Z0-9]{8}$/);
        expect(parcel.pages).toEqual([i + 1]);
      }
    });
});
