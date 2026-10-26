import { formatSourcePages } from "../src/lib/pdf-labels";
import { describe, it, expect } from "vitest";
import { analyzeLabelPages, parseSourcePdf } from "../src/lib/pdf-source";
import {
  MAX_SOURCE_PDF_BYTES,
  MAX_SOURCE_PDF_PAGES,
} from "../src/lib/source-limits";
import {
  makePdf,
  labelText,
  bestLabelText,
  bestImageLogoLabelText,
  largeSourcePdf,
  continuationText,
  splitLabelText,
} from "./pdf-fixture";

describe("Đếm tem PDF bằng danh tính mã, không theo số trang/lần in", () => {
  it("đọc PDF thật, giữ nguyên mã đơn dài và gom tem trùng về một kiện", async () => {
    const result = await parseSourcePdf(
      makePdf([labelText(), labelText(), labelText("862000000002")]),
    );
    expect(result).toMatchObject({
      pageCount: 3,
      orderCount: 1,
      duplicatePages: 1,
      errors: [],
    });
    expect(result.labels).toHaveLength(2);
    expect(result.labels[0]).toEqual({
      trackingCode: "862000000001",
      orderId: "586000000000000001",
      carrier: "J&T Express",
      channel: "TikTok Shop",
      pages: [1, 2],
    });
    expect(result.hash).toHaveLength(64);
  });
  it("tem như trang 19 không có Qty Total vẫn nhận đúng; trang tiếp theo không tăng số kiện", async () => {
    const r = await parseSourcePdf(
      makePdf([
        splitLabelText("862575363249", "586653367958275284"),
        continuationText("586653367958275284"),
      ]),
    );
    expect(r).toMatchObject({
      pageCount: 2,
      orderCount: 1,
      duplicatePages: 0,
      continuationPages: 1,
      errors: [],
    });
    expect(r.labels).toEqual([
      {
        trackingCode: "862575363249",
        orderId: "586653367958275284",
        carrier: "J&T Express",
        channel: "TikTok Shop",
        pages: [1, 2],
      },
    ]);
    expect(analyzeLabelPages([splitLabelText()], "no-total").errors).toEqual(
      [],
    );
  });
  it("ghép nhiều trang sản phẩm, kể cả bảng bắt đầu ở trang sau; tem in lại vẫn chỉ một kiện", () => {
    const header = "862000000001\n862000000001\nOrder ID: 586000000000000001";
    const r = analyzeLabelPages(
      [
        header,
        continuationText(),
        continuationText(),
        splitLabelText(),
        continuationText(),
      ],
      "multi",
    );
    expect(r).toMatchObject({
      orderCount: 1,
      continuationPages: 3,
      duplicatePages: 1,
      errors: [],
    });
    expect(r.labels).toHaveLength(1);
    expect(r.labels[0].pages).toEqual([1, 2, 3, 4, 5]);
    expect(analyzeLabelPages([header], "no-products").errors).toHaveLength(1);
  });
  it("BEST cũng ghép trang tiếp theo; một đơn nhiều kiện ghép vào tem liền trước", () => {
    const r = analyzeLabelPages(
      [
        bestLabelText(),
        continuationText(),
        bestLabelText("TTVN0000000002"),
        continuationText(),
      ],
      "best-multi",
    );
    expect(r).toMatchObject({
      orderCount: 1,
      continuationPages: 2,
      duplicatePages: 0,
      errors: [],
    });
    expect(r.labels.map((l) => l.pages)).toEqual([
      [1, 2],
      [3, 4],
    ]);
  });
  it("không ghép trang mồ côi, sai Order ID, nhiều Order ID hoặc vượt qua trang lỗi", () => {
    for (const pages of [
      [continuationText()],
      [splitLabelText(), continuationText("586000000000000002")],
      [splitLabelText(), continuationText() + "\nOrder ID: 586000000000000002"],
      [splitLabelText(), "", continuationText()],
      [splitLabelText(), "Order ID: 586000000000000001"],
      [splitLabelText(), "SPXVN00000001\n" + continuationText()],
    ]) {
      const r = analyzeLabelPages(pages, "bad-continuation");
      expect(r.errors.length).toBeGreaterThan(0);
      expect(r.continuationPages).toBe(0);
    }
  });
  it("file 1.832 trang không nhầm 32 trang tiếp theo thành đơn hay tem trùng", async () => {
    const pages = Array.from({ length: 1800 }, (_, i) =>
      splitLabelText(
        `86${String(i + 1).padStart(10, "0")}`,
        `586${String(i + 1).padStart(15, "0")}`,
      ),
    );
    for (let i = 31; i >= 0; i--)
      pages.splice(
        i + 1,
        0,
        continuationText(`586${String(i + 1).padStart(15, "0")}`),
      );
    const r = await parseSourcePdf(makePdf(pages));
    expect(r).toMatchObject({
      pageCount: 1832,
      orderCount: 1800,
      continuationPages: 32,
      duplicatePages: 0,
      errors: [],
    });
    expect(r.labels).toHaveLength(1800);
  });
  it("không đếm số điện thoại, thời gian hay số lượng sản phẩm thành mã vận đơn", () => {
    const result = analyzeLabelPages(
      [labelText() + "\n0987654321\nQty Total: 8\n2026-10-17 17:39"],
      "test",
    );
    expect(result.labels).toHaveLength(1);
    expect(result.errors).toEqual([]);
  });
  it("đếm đơn khác kiện khi một đơn có nhiều kiện", () => {
    const r = analyzeLabelPages(
      [
        labelText(),
        labelText("862000000002"),
        labelText("862000000003", "586000000000000002"),
      ],
      "x",
    );
    expect(r.orderCount).toBe(2);
    expect(r.labels).toHaveLength(3);
  });
  it("chặn trang ảnh/trống thay vì tự lấy số trang làm tổng đơn", async () => {
    const r = await parseSourcePdf(makePdf([labelText(), ""]));
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0].page).toBe(2);
  });
  it("chặn trang có nhiều mã vận đơn hoặc Order ID mâu thuẫn", () => {
    expect(
      analyzeLabelPages([labelText() + "\n862000000002"], "x").errors,
    ).toHaveLength(1);
    expect(
      analyzeLabelPages([labelText() + "\nOrder ID: 586000000000000002"], "x")
        .errors,
    ).toHaveLength(1);
    expect(
      analyzeLabelPages(
        [labelText(), labelText(undefined, "586000000000000002")],
        "x",
      ).errors,
    ).toHaveLength(1);
  });
  it("không đoán mã chỉ xuất hiện một lần hoặc sai mẫu", () => {
    expect(
      analyzeLabelPages(["862000000001\nOrder ID: 586000000000000001"], "x")
        .errors,
    ).toHaveLength(1);
    expect(
      analyzeLabelPages(
        [labelText().replaceAll("862000000001", "SPXVN00000001")],
        "x",
      ).errors,
    ).toHaveLength(1);
  });
  it("BEST: 151 tem text giả lập được đếm 151 mã duy nhất, hãng BEST khác sàn TikTok", async () => {
    const pages = Array.from({ length: 151 }, (_, i) =>
      bestLabelText(
        `TTVN${String(i + 1).padStart(10, "0")}`,
        `586${String(i + 1).padStart(15, "0")}`,
      ),
    );
    const r = await parseSourcePdf(makePdf(pages));
    expect(r).toMatchObject({
      pageCount: 151,
      orderCount: 151,
      duplicatePages: 0,
      errors: [],
      detectedCarriers: ["BEST Express"],
    });
    expect(r.labels).toHaveLength(151);
    expect(r.labels.every((l) => l.carrier === "BEST Express")).toBe(true);
  });
  it("BEST cần cả dấu hãng và mã TTVN; không đoán từ prefix đơn lẻ", () => {
    expect(
      analyzeLabelPages([labelText("TTVN0000000001")], "x").errors,
    ).toHaveLength(1);
    expect(
      analyzeLabelPages(["BEST EXPRESS\n" + labelText()], "x").errors,
    ).toHaveLength(1);
    expect(
      analyzeLabelPages([labelText() + "\nBEST cotton shirt"], "product")
        .errors,
    ).toEqual([]);
    const r = analyzeLabelPages(
      [bestLabelText().replace("BEST EXPRESS\n", "").toLowerCase()],
      "x",
    );
    expect(r.errors).toEqual([]);
    expect(r.labels[0].trackingCode).toBe("TTVN0000000001");
  });
  it("một PDF trộn BEST/J&T bị chặn; nên chọn hai file theo hãng", () => {
    const r = analyzeLabelPages([labelText(), bestLabelText()], "x");
    expect(r.detectedCarriers).toEqual(["J&T Express", "BEST Express"]);
    expect(r.errors).toHaveLength(1);
  });
  it("BEST logo hình ảnh: đầy đủ form giao hàng và tham chiếu in lặp vẫn nhận đúng hãng", async () => {
    const result = await parseSourcePdf(
      makePdf([bestImageLogoLabelText(), continuationText()]),
    );
    expect(result).toMatchObject({
      pageCount: 2,
      orderCount: 1,
      continuationPages: 1,
      errors: [],
      detectedCarriers: ["BEST Express"],
      detectedChannels: ["TikTok Shop"],
    });
    expect(result.carrierGroups).toEqual([
      {
        carrier: "BEST Express",
        channel: "TikTok Shop",
        shipments: 1,
        orders: 1,
        pages: [1, 2],
      },
    ]);
    expect(result.labels[0].trackingCode).toBe("TTVN0000000001");
  });
  it("không nhận TTVN khi logo không có text mà form chỉ có một phần hoặc mã/order không được xác nhận lặp", () => {
    const text = bestImageLogoLabelText();
    for (const incomplete of [
      text.replace("Nguoi gui:", "Unknown field:"),
      text.replace("Nguoi nhan:", "Unknown field:"),
      text.replace("Trong luong:", "Unknown field:"),
      text.replace("Thoi gian dat hang:", "Unknown field:"),
      text.replace("Ngay giao du kien:", "Unknown field:"),
      text.replace("TTVN0000000001\nTTVN0000000001", "TTVN0000000001"),
      text.replace(/Order ID: 586000000000000001$/, ""),
    ])
      expect(
        analyzeLabelPages([incomplete], "incomplete").errors.length,
      ).toBeGreaterThan(0);
  });
  it("chỉ rõ hãng và trang của file trộn, gồm trang sản phẩm liền sau; không ép J&T thành BEST", () => {
    const result = analyzeLabelPages(
      [
        bestImageLogoLabelText(),
        continuationText(),
        labelText(undefined, "586000000000000002"),
        continuationText("586000000000000002"),
      ],
      "mixed",
    );
    expect(result).toMatchObject({
      pageCount: 4,
      orderCount: 2,
      continuationPages: 2,
    });
    expect(result.carrierGroups).toEqual([
      {
        carrier: "BEST Express",
        channel: "TikTok Shop",
        shipments: 1,
        orders: 1,
        pages: [1, 2],
      },
      {
        carrier: "J&T Express",
        channel: "TikTok Shop",
        shipments: 1,
        orders: 1,
        pages: [3, 4],
      },
    ]);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toMatchObject({
      page: 0,
      message: expect.stringContaining("J&T Express: 1 vận đơn, trang 3–4"),
    });
  });
  it("rút gọn dãy trang chính xác, không lặp trang và không bỏ trang sản phẩm", () => {
    expect(formatSourcePages([7, 3, 2, 1, 7, 4, 10])).toBe("1–4, 7, 10");
    expect(formatSourcePages([1, 3, 5, 7], 2)).toBe("1, 3, …");
    expect(formatSourcePages([])).toBe("");
  });
  it("PDF hơn 17,3 MB / 1.800 trang đếm đủ mã, không bị giới hạn 5 MB hay 300 trang", async () => {
    const file = largeSourcePdf();
    expect(file.length).toBeGreaterThan(17.3 * 1024 * 1024);
    const r = await parseSourcePdf(file);
    expect(r).toMatchObject({
      pageCount: 1800,
      orderCount: 1800,
      errors: [],
      duplicatePages: 0,
    });
    expect(r.labels).toHaveLength(1800);
  });
  it("chặn file giả PDF, hỏng, quá lớn và quá 3.000 trang", async () => {
    await expect(
      parseSourcePdf(Buffer.from("not a pdf")),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      parseSourcePdf(Buffer.from("%PDF-broken")),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      parseSourcePdf(Buffer.alloc(MAX_SOURCE_PDF_BYTES + 1)),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      parseSourcePdf(makePdf(Array(MAX_SOURCE_PDF_PAGES + 1).fill(""))),
    ).rejects.toMatchObject({ status: 400 });
  });
});
