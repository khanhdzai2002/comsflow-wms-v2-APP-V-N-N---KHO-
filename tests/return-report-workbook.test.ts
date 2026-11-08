import { it, expect } from "vitest";
import ExcelJS from "exceljs";
import { Open } from "unzipper";
import { buildReturnReportWorkbook } from "../src/worker/return-report-workbook";
import { decodeXlsxTable } from "../src/worker/xlsx-raw-table";
const ids = [
  "862678510680",
  "1234567890123456",
  "586890280579270204",
  "12345678901234567890",
  "0000586890280579270204",
  "TTVN1120898402-A",
];
it("XLSX giữ ô text và roundtrip 12/16/18/20 chữ số, số 0 đầu, chữ/gạch; sheet hãng, 18 cột, màu vàng", async () => {
  const entries = ids.map((id, i) => ({
    carrier: i % 2 ? "BEST Express" : "J&T Express",
    row_data: {
      caseId: "c" + i,
      order: id,
      tracking: id,
      sku: id,
      quantity: 1,
      orderAmount: "20000",
      receiptState: "Chưa nhận – cần kiểm tra",
      verification: "pending",
    },
  }));
  const book = await buildReturnReportWorkbook(entries, {
    created_at: "2026-11-08T10:00:00Z",
    total_cases: 6,
    filters: {},
  });
  const bytes = await book.xlsx.writeBuffer();
  const loaded = new ExcelJS.Workbook();
  await loaded.xlsx.load(bytes);
  expect(loaded.worksheets).toHaveLength(2);
  const found: string[] = [];
  for (const sheet of loaded.worksheets) {
    expect(sheet.columnCount).toBe(18);
    expect(sheet.views[0]).toMatchObject({ state: "frozen", ySplit: 6 });
    expect(sheet.autoFilter).toBeTruthy();
    sheet.eachRow((row, index) => {
      if (index <= 6) return;
      for (const col of [2, 3, 10]) {
        expect(row.getCell(col).type).toBe(ExcelJS.ValueType.String);
        expect(row.getCell(col).numFmt).toBe("@");
        expect(row.getCell(col).value).not.toMatch(/\dE\+/i);
      }
      found.push(row.getCell(2).value as string);
      expect(row.getCell(14).fill).toMatchObject({
        fgColor: { argb: "FFFFF3CD" },
      });
      expect(row.getCell(18).fill).toMatchObject({
        fgColor: { argb: "FFFFF3CD" },
      });
      expect(row.getCell(12).value).toBe(20000);
    });
  }
  expect(found.sort()).toEqual([...ids].sort());
  const zip = await Open.buffer(Buffer.from(bytes));
  const files = new Map<string, string>();
  for (const f of zip.files) {
    if (/\.xml$|\.rels$/.test(f.path))
      files.set(f.path, (await f.buffer()).toString());
  }
  // The raw reader consumes only the first worksheet; the literal XML still
  // contains the same exact text IDs and never numeric exponent IDs.
  const first = decodeXlsxTable(files);
  expect(first.slice(6).map((r) => r[1])).toEqual(
    ids.filter((_, i) => i % 2 === 0),
  );
});
it("không tạo workbook hoặc sheet rỗng", async () => {
  await expect(
    buildReturnReportWorkbook([], {
      created_at: new Date().toISOString(),
      total_cases: 0,
      filters: {},
    }),
  ).rejects.toThrow(/Không có dữ liệu/);
});
it("báo cáo dòng lỗi giữ nguyên ô text và thông báo nguồn để sửa, không đoán lại mã", async () => {
  const { buildReturnIntakeErrorWorkbook } =
    await import("../src/worker/return-report-workbook");
  const book = buildReturnIntakeErrorWorkbook(
    ["Order ID", "Tracking ID"],
    [
      {
        row_number: 2,
        error: "Mã cần sửa từ nguồn",
        raw: {
          "Order ID": "0000586890280579270204",
          "Tracking ID": "862678510680",
        },
      },
    ],
  );
  const read = new ExcelJS.Workbook();
  await read.xlsx.load(await book.xlsx.writeBuffer());
  expect(read.worksheets[0].getCell("C2").value).toBe("0000586890280579270204");
  expect(read.worksheets[0].getCell("C2").type).toBe(ExcelJS.ValueType.String);
  expect(read.worksheets[0].getCell("B2").value).toBe("Mã cần sửa từ nguồn");
});

it("không dịch sai ngày Excel lịch 1904", () => {
  expect(() =>
    decodeXlsxTable(
      new Map([
        ["xl/workbook.xml", '<workbook><workbookPr date1904="1"/></workbook>'],
      ]),
    ),
  ).toThrow(/lịch 1904/);
});
