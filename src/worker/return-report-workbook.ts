import ExcelJS from "exceljs";
type ReportRow = { carrier: string; row_data: Record<string, any> };
const columns = [
  ["stt", "STT"],
  ["order", "Mã đơn hàng"],
  ["tracking", "Mã vận đơn"],
  ["carrier", "Đơn vị vận chuyển"],
  ["orderedAt", "Ngày tạo đơn"],
  ["returnAt", "Ngày hủy / Ngày phát sinh hoàn"],
  ["reason", "Lý do hoàn"],
  ["platformStatus", "Trạng thái đơn trên sàn"],
  ["product", "Tên sản phẩm"],
  ["sku", "SKU"],
  ["quantity", "Số lượng"],
  ["orderAmount", "Giá trị đơn hàng"],
  ["receiptState", "Trạng thái nhận kho"],
  ["courier", "Nhân viên giao hoàn về kho"],
  ["receivedAt", "Ngày bàn giao hàng về kho"],
  ["verification", "Tình trạng tra soát"],
  ["carrierResult", "Kết quả xác minh của ĐVVC"],
  ["note", "Ghi chú"],
] as const;
const date = (value: unknown) =>
  value
    ? new Intl.DateTimeFormat("vi-VN", {
        timeZone: "Asia/Ho_Chi_Minh",
        dateStyle: "short",
        timeStyle: "short",
      }).format(new Date(String(value)))
    : "";
export async function buildReturnReportWorkbook(
  rows: ReportRow[],
  meta: {
    created_at: string;
    total_cases: number;
    filters: Record<string, any>;
  },
) {
  const book = new ExcelJS.Workbook();
  book.creator = "COMS-FLOW / COMSMIU";
  book.created = new Date(meta.created_at);
  const groups = new Map<string, ReportRow[]>();
  for (const row of rows) {
    const group = groups.get(row.carrier) ?? [];
    group.push(row);
    groups.set(row.carrier, group);
  }
  const usedNames = new Set<string>();
  for (const [carrier, records] of groups) {
    if (!records.length) continue;
    const base =
      carrier
        .replace(/[\\/?*\[\]:]/g, " ")
        .trim()
        .slice(0, 27) || "Chưa xác định";
    let name = base,
      index = 1;
    while (usedNames.has(name.toLowerCase()))
      name = base.slice(0, 25) + " " + index++;
    usedNames.add(name.toLowerCase());
    const sheet = book.addWorksheet(name, {
      views: [{ state: "frozen", ySplit: 6 }],
    });
    sheet.mergeCells("A1:R1");
    sheet.getCell("A1").value =
      "COMS-FLOW / COMSMIU – DANH SÁCH CHƯA NHẬN CẦN KIỂM TRA";
    sheet.getCell("A1").font = { bold: true, size: 14 };
    sheet.mergeCells("A2:R2");
    sheet.getCell("A2").value = "Đơn vị vận chuyển: " + carrier;
    sheet.mergeCells("A3:R3");
    sheet.getCell("A3").value =
      "Thời điểm đối soát: " + date(meta.created_at) + " (giờ Việt Nam)";
    sheet.mergeCells("A4:R4");
    sheet.getCell("A4").value =
      `Tổng hồ sơ của hãng: ${new Set(records.map((r) => r.row_data.caseId ?? r.row_data.order)).size} · Tổng toàn báo cáo: ${meta.total_cases} · Phạm vi ngày: ${meta.filters.from || "Từ đầu"} → ${meta.filters.to || "Hiện tại"}`;
    sheet.mergeCells("A5:R5");
    sheet.getCell("A5").value =
      "Các cột vàng dành cho đơn vị vận chuyển phản hồi. Giá trị đơn chỉ ghi một lần dù có nhiều SKU.";
    sheet.addRow(columns.map((c) => c[1]));
    sheet.getRow(6).font = { bold: true, color: { argb: "FFFFFFFF" } };
    sheet.getRow(6).fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FF285A8D" },
    };
    records.forEach((entry, index) => {
      const data = entry.row_data;
      const values = columns.map(([key]) =>
        key === "stt"
          ? index + 1
          : ["orderedAt", "returnAt", "receivedAt"].includes(key)
            ? date(data[key])
            : key === "verification"
              ? ((
                  {
                    pending: "Chờ xử lý",
                    checking: "Đang xác minh",
                    resolved: "Đã xác minh",
                    rejected: "Chưa thống nhất",
                  } as Record<string, string>
                )[data[key]] ?? String(data[key] ?? ""))
              : key === "orderAmount" &&
                  /^\d{1,15}$/.test(String(data[key] ?? ""))
                ? Number(data[key])
                : key === "quantity"
                  ? (data[key] ?? "")
                  : String(data[key] ?? ""),
      );
      const row = sheet.addRow(values);
      row.alignment = { vertical: "top", wrapText: true };
      for (const column of [2, 3, 10]) {
        row.getCell(column).value = String(values[column - 1]);
        row.getCell(column).numFmt = "@";
      }
      for (let column = 14; column <= 18; column++)
        row.getCell(column).fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: "FFFFF3CD" },
        };
    });
    columns.forEach(([, label], index) => {
      sheet.getColumn(index + 1).width = Math.min(
        48,
        Math.max(
          index === 0 ? 7 : 16,
          label.length + 2,
          ...records
            .slice(0, 200)
            .map((r) => String(r.row_data[columns[index][0]] ?? "").length + 2),
        ),
      );
    });
    sheet.autoFilter = {
      from: { row: 6, column: 1 },
      to: { row: sheet.rowCount, column: 18 },
    };
  }
  if (!book.worksheets.length) throw new Error("Không có dữ liệu để xuất");
  return book;
}

export function buildReturnIntakeErrorWorkbook(
  headers: string[],
  records: { row_number: number; error: string; raw: Record<string, string> }[],
) {
  const book = new ExcelJS.Workbook();
  book.creator = "COMS-FLOW / COMSMIU";
  const sheet = book.addWorksheet("Dòng cần sửa", {
    views: [{ state: "frozen", ySplit: 1 }],
  });
  sheet.addRow(["Dòng trong nguồn", "Lỗi cần sửa", ...headers]);
  sheet.getRow(1).font = { bold: true };
  for (const r of records) {
    const row = sheet.addRow([
      String(r.row_number),
      r.error,
      ...headers.map((h) => String(r.raw[h] ?? "")),
    ]);
    row.eachCell((c) => {
      c.numFmt = "@";
      c.alignment = { vertical: "top", wrapText: true };
    });
  }
  sheet.columns.forEach((c, i) => {
    c.width = i === 0 ? 12 : i === 1 ? 60 : 25;
  });
  sheet.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: sheet.rowCount, column: headers.length + 2 },
  };
  return book;
}
