// Small synthetic, text-only PDF; contains no customer data.
export function labelText(code = "862000000001", order = "586000000000000001") {
  return `${code}\n${code}\nOrder ID: ${order}\nProduct Name SKU Seller SKU Qty\nTest item\nQty Total: 1\nOrder ID: ${order}`;
}
// Product-only page as in the supplied screenshot: no shipping barcode.
export function continuationText(order = "586000000000000001") {
  return `In transit by: 19/10/2026 23:59\nProduct Name SKU Seller SKU Qty\nQty Total: 2\nTikTok Shop\nOrder ID: ${order}`;
}
export function splitLabelText(
  code = "862000000001",
  order = "586000000000000001",
) {
  return labelText(code, order).replace("Qty Total: 1\n", "");
}
// ASCII-only synthetic text so the minimal Helvetica fixture needs no customer data/font.
export function shopeeLabelText(
  code = "SPXVN00000000001A",
  order = "261020TEST0001",
) {
  return `Ma van don: ${code}\nMa don hang: ${order}\nNoi dung hang (Tong SL san pham: 1)\nTHONG TIN DON HANG\nOrderSN: ${order} package 1\nSKU Ten san pham SL\nTEST ITEM 1`;
}
export function shopeeContinuationText(order = "261020TEST0001") {
  return `THONG TIN DON HANG\nOrderSN: ${order} package 1\nSKU Ten san pham SL\nTEST ITEM 2`;
}
export function makePdf(pages: string[], paddingBytes = 0): Buffer {
  const objects: string[] = [];
  objects.push("<< /Type /Catalog /Pages 2 0 R >>");
  objects.push(
    `<< /Type /Pages /Kids [${pages.map((_, i) => `${4 + i * 2} 0 R`).join(" ")}] /Count ${pages.length} >>`,
  );
  objects.push("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  pages.forEach((text, i) => {
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 298 420] /Resources << /Font << /F1 3 0 R >> >> /Contents ${5 + i * 2} 0 R >>`,
    );
    const escape = (s: string) => s.replace(/([\\()])/g, "\\$1");
    const stream =
      "BT /F1 9 Tf 12 400 Td 13 TL " +
      text
        .split("\n")
        .map((s) => `(${escape(s)}) Tj T*`)
        .join("\n") +
      " ET";
    objects.push(
      `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
    );
  });
  if (paddingBytes)
    objects.push(
      `<< /Length ${paddingBytes} >>\nstream\n${"X".repeat(paddingBytes)}\nendstream`,
    );
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((obj, i) => {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${i + 1} 0 obj\n${obj}\nendobj\n`;
  });
  const xref = Buffer.byteLength(pdf);
  pdf +=
    `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n` +
    offsets
      .slice(1)
      .map((n) => `${String(n).padStart(10, "0")} 00000 n \n`)
      .join("");
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(pdf);
}

export function bestLabelText(
  code = "TTVN0000000001",
  order = "586000000000000001",
) {
  return (
    "TikTok Shop\nBEST EXPRESS\nTT-VN-BEST-COD-STD\n" + labelText(code, order)
  );
}

export function largeSourcePdf(
  count = 1800,
  paddingBytes = 18 * 1024 * 1024,
  sequenceStart = 0,
) {
  return makePdf(
    Array.from({ length: count }, (_, i) =>
      labelText(
        `86${String(sequenceStart + i + 1).padStart(10, "0")}`,
        `586${String(sequenceStart + i + 1).padStart(15, "0")}`,
      ),
    ),
    paddingBytes,
  );
}

// Synthetic TikTok shipping form whose carrier logo has no extractable text.
// No private sample data is copied into this fixture.
export function bestImageLogoLabelText(
  code = "TTVN0000000001",
  order = "586000000000000001",
) {
  return (
    "Nguoi gui: Test shop\nNguoi nhan: Test recipient\nTrong luong: 0.1 KG\nThoi gian dat hang: 2026-10-26 08:00\nNgay giao du kien: 27-10-2026\n" +
    labelText(code, order)
  );
}
