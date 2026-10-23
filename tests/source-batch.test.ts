import { describe, it, expect } from "vitest";
import { summarizePdfBatch } from "../src/lib/source-batch";
import { analyzeLabelPages } from "../src/lib/pdf-source";
import { labelText, bestLabelText, shopeeLabelText } from "./pdf-fixture";
const record = (pages: string[], hash: string) => ({
  preview: { ...analyzeLabelPages(pages, hash), conflicts: [] },
});
describe("Đếm và kiểm tra nhiều PDF trước khi nhập", () => {
  it("gộp mã duy nhất, giữ hai hãng, bỏ bản sao byte giống nhau dù khác tên", () => {
    const a = record([labelText()], "a");
    const b = record(
      [labelText(), labelText("862000000002", "586000000000000002")],
      "b",
    );
    const c = record(
      [bestLabelText("TTVN0000000001", "586000000000000003")],
      "c",
    );
    const r = summarizePdfBatch([a, b, c, a]);
    expect(r).toMatchObject({
      readyIndexes: [0, 1, 2],
      duplicateIndexes: [3],
      uniqueShipments: 3,
      orders: 3,
      overlapShipments: 1,
    });
  });
  it("file có cùng mã nhưng khác đơn chặn mọi file liên quan, kể cả file thứ ba khớp file đầu", () => {
    const a = record([labelText()], "a");
    const b = record([labelText(undefined, "586000000000000002")], "b");
    const r = summarizePdfBatch([
      a,
      b,
      { ...a, preview: { ...a.preview, hash: "c" } },
    ]);
    expect(r.readyIndexes).toEqual([]);
    for (const i of [0, 1, 2])
      expect(r.crossErrors[i]).toEqual(["862000000001"]);
  });
  it("hàng đợi Shopee và TikTok nhận riêng từng sàn, mã đơn cùng chuỗi vẫn là hai đơn", () => {
    const shopee = record([shopeeLabelText()], "spx");
    const tiktok = record([labelText()], "jt");
    // Namespace protects future templates where external order IDs can overlap.
    tiktok.preview.labels[0].orderId = shopee.preview.labels[0].orderId;
    expect(summarizePdfBatch([shopee, tiktok])).toMatchObject({
      readyIndexes: [0, 1],
      uniqueShipments: 2,
      orders: 2,
    });
  });
  it("file lỗi/đã loại bỏ không ngăn file khác hợp lệ và không được cộng vào tổng nguồn", () => {
    const good = record([bestLabelText()], "good");
    const r = summarizePdfBatch([
      { error: "File hỏng" },
      record(["image"], "bad"),
      { preview: { ...good.preview, existingManifestArchived: true } },
      good,
    ]);
    expect(r.readyIndexes).toEqual([3]);
    expect(r.uniqueShipments).toBe(1);
  });
  it("nhiều file Shopee GHN/SPX và TikTok giữ đúng hãng, cùng đơn Shopee chỉ đếm một đơn", () => {
    const ghn = record([shopeeLabelText("GTEST001")], "ghn");
    const spx = record([shopeeLabelText()], "spx");
    const jt = record([labelText()], "jt");
    const result = summarizePdfBatch([ghn, spx, jt, ghn]);
    expect(result).toMatchObject({
      readyIndexes: [0, 1, 2],
      duplicateIndexes: [3],
      uniqueShipments: 3,
      orders: 2,
      overlapShipments: 0,
    });
  });
});
