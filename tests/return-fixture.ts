import { returnFields } from "../src/lib/return-domain";
export function returnRow(
  overrides: Record<string, string> = {},
): Record<string, string> {
  return {
    "Return Order ID": "1234567890123456789",
    "Order ID": "586000000000000001",
    "Order Amount": "112.100₫",
    "Order Status": "Shipped",
    "Order Substatus": "Delivered",
    "SKU ID": "1111111111111111111",
    "Seller SKU": "",
    "Product Name": "TEST SHIRT",
    "SKU Name": "Black, M",
    "Return Type": "Return and refund",
    "Time Requested": "19/10/2026 10:00:00",
    "Return Reason": "Change of mind",
    "Return unit price": "94.350₫",
    "Return Quantity": "1",
    "Return Logistics Tracking ID": "854160000001",
    "Return Status": "To Process",
    "Return Sub Status": "Return shipped",
    "Refund Time": "20/10/2026 10:00:00",
    ...overrides,
  };
}
export function returnCsv(rows = [returnRow()]) {
  const keys = [
    ...new Set([
      ...Object.values(returnFields),
      ...rows.flatMap((r) => Object.keys(r)),
    ]),
  ];
  const esc = (s: string) => '"' + s.replaceAll('"', '""') + '"';
  return Buffer.from(
    [keys, ...rows.map((r) => keys.map((k) => r[k] ?? ""))]
      .map((r) => r.map(esc).join(","))
      .join("\r\n"),
  );
}

// Minimal stored ZIP used to reproduce TikTok's repeated-row XML without PII.
export function repeatedRowXlsx(row = returnRow()) {
  const escape = (s: string) =>
    s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
  const cols = (n: number) => {
    let s = "";
    for (n++; n; n = Math.floor((n - 1) / 26))
      s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
    return s;
  };
  const xml = [Object.keys(row), Object.values(row)]
    .flatMap((values, i) =>
      values.map(
        (v, j) =>
          `<row r="${i + 1}"><c r="${cols(j)}${i + 1}" t="str"><v>${escape(v)}</v></c></row>`,
      ),
    )
    .join("");
  const files = [
    [
      "xl/workbook.xml",
      '<workbook xmlns:r="x"><sheets><sheet name="0" r:id="rId1"/></sheets></workbook>',
    ],
    [
      "xl/_rels/workbook.xml.rels",
      '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>',
    ],
    [
      "xl/worksheets/sheet1.xml",
      `<worksheet><dimension ref="A1"/><sheetData>${xml}</sheetData></worksheet>`,
    ],
  ];
  const locals: Buffer[] = [],
    central: Buffer[] = [];
  let offset = 0;
  for (const [path, content] of files) {
    const name = Buffer.from(path),
      data = Buffer.from(content);
    let crc = 0xffffffff;
    for (const b of data) {
      crc ^= b;
      for (let i = 0; i < 8; i++)
        crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
    crc = (crc ^ 0xffffffff) >>> 0;
    const h = Buffer.alloc(30);
    h.writeUInt32LE(0x04034b50);
    h.writeUInt16LE(20, 4);
    h.writeUInt32LE(crc, 14);
    h.writeUInt32LE(data.length, 18);
    h.writeUInt32LE(data.length, 22);
    h.writeUInt16LE(name.length, 26);
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50);
    c.writeUInt16LE(20, 4);
    c.writeUInt16LE(20, 6);
    c.writeUInt32LE(crc, 16);
    c.writeUInt32LE(data.length, 20);
    c.writeUInt32LE(data.length, 24);
    c.writeUInt16LE(name.length, 28);
    c.writeUInt32LE(offset, 42);
    locals.push(h, name, data);
    central.push(c, name);
    offset += h.length + name.length + data.length;
  }
  const directory = Buffer.concat(central),
    end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}
