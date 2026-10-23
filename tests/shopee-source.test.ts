import { describe, it, expect } from "vitest";
import {
  analyzeLabelPages,
  parseSourcePdf,
  sourcePageText,
} from "../src/lib/pdf-source";
import {
  makePdf,
  shopeeLabelText,
  shopeeContinuationText,
  labelText,
} from "./pdf-fixture";

describe("Nhận diện nguồn Shopee/SPX", () => {
  it("một mã SPX in một lần, hai tham chiếu mã đơn khớp; giữ mã chữ/số và sàn riêng", async () => {
    const p = await parseSourcePdf(
      makePdf([
        shopeeLabelText(),
        shopeeLabelText(),
        shopeeLabelText("SPXVN00000000002A"),
      ]),
    );
    expect(p).toMatchObject({
      pageCount: 3,
      orderCount: 1,
      duplicatePages: 1,
      continuationPages: 0,
      detectedChannels: ["Shopee"],
      detectedCarriers: ["SPX Express"],
      errors: [],
    });
    expect(p.labels).toHaveLength(2);
    expect(p.labels[0]).toMatchObject({
      channel: "Shopee",
      carrier: "SPX Express",
      trackingCode: "SPXVN00000000001A",
      orderId: "261020TEST0001",
      pages: [1, 2],
    });
  });

  it("đơn dài: OrderSN và bảng có thể nằm ở trang tiếp theo; không tăng số kiện", async () => {
    const main = shopeeLabelText().split("\n").slice(0, 2).join("\n");
    const p = await parseSourcePdf(
      makePdf([main, shopeeContinuationText(), shopeeContinuationText()]),
    );
    expect(p).toMatchObject({
      orderCount: 1,
      duplicatePages: 0,
      continuationPages: 2,
      errors: [],
    });
    expect(p.labels[0].pages).toEqual([1, 2, 3]);
  });

  it("chặn thiếu bằng chứng, sai OrderSN, nhiều tracking và trang mồ côi", () => {
    const good = shopeeLabelText();
    for (const pages of [
      [good.replace(/OrderSN:.*/g, "")],
      [good.replace(/Ma don hang:.*/g, "")],
      [good.replace("Ma van don:", "Other:")],
      [good.replace("OrderSN: 261020TEST0001", "OrderSN: 261020TEST0002")],
      [good + "\nSPXVN00000000002A"],
      [shopeeContinuationText()],
      [good, shopeeContinuationText("261020TEST0002")],
      [good, "", shopeeContinuationText()],
      [labelText("SPXVN00000000001A")],
      [good.replaceAll("SPXVN00000000001A", "SPXVNINVALID")],
    ])
      expect(analyzeLabelPages(pages, "invalid").errors.length).toBeGreaterThan(
        0,
      );
  });

  it("một PDF trộn sàn/hãng bị chặn; không nhầm trang tiếp theo giữa hai sàn", () => {
    const p = analyzeLabelPages(
      [shopeeLabelText(), labelText(), shopeeContinuationText()],
      "mixed",
    );
    expect(p.detectedChannels).toEqual(["Shopee", "TikTok Shop"]);
    expect(p.errors.some((e) => e.page === 0)).toBe(true);
    expect(p.continuationPages).toBe(0);
  });

  it.each(["SPXVN00000000001A", "GTEST001"])(
    "ghép lại glyph tiếng Việt rời và thứ tự vẽ đảo cho mã %s",
    (code) => {
      const items: { str: string; transform: number[]; width: number }[] = [];
      function line(parts: string[], y: number) {
        let x = 0;
        for (const str of parts) {
          items.push({
            str,
            transform: [1, 0, 0, 1, x, y],
            width: str.length * 5,
          });
          x += str.length * 5;
        }
      }
      line(["Mã v", "ậ", "n đ", "ơ", "n: ", code], 100);
      line(["Mã đ", "ơ", "n hàng: ", "261020TEST0001"], 90);
      line(["Nội dung hàng (Tổng SL sản phẩm: 1)"], 80);
      line(["OrderSN: ", "261020TEST0001", " package 1"], 70);
      items.reverse();
      const text = sourcePageText(items);
      expect(text).toContain(`Mã vận đơn: ${code}`);
      expect(analyzeLabelPages([text], "layout").errors).toEqual([]);
      expect(
        analyzeLabelPages([items.map((i) => i.str).join("\n")], "raw").errors
          .length,
      ).toBeGreaterThan(0);
    },
  );
});
