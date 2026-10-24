import { createHash } from "node:crypto";
import { getDocumentProxy } from "unpdf";
import {
  sourceLabelAnalyzer,
  sourcePageText,
  type SourcePdf,
} from "./pdf-labels";
export { analyzeLabelPages, sourcePageText } from "./pdf-labels";
export type { SourceLabel, SourcePdf } from "./pdf-labels";
import {
  MAX_SOURCE_PDF_BYTES,
  MAX_SOURCE_PDF_MB,
  MAX_SOURCE_PDF_PAGES,
  MAX_SOURCE_PDF_TEXT,
} from "./source-limits";
import { AppError } from "./domain";

export async function parseSourcePdf(buffer: Buffer): Promise<SourcePdf> {
  if (
    !buffer.length ||
    buffer.length > MAX_SOURCE_PDF_BYTES ||
    buffer.subarray(0, 5).toString() !== "%PDF-"
  )
    throw new AppError(400, `Chọn PDF hợp lệ, tối đa ${MAX_SOURCE_PDF_MB} MB`);
  let pdf: Awaited<ReturnType<typeof getDocumentProxy>> | undefined;
  try {
    pdf = await getDocumentProxy(new Uint8Array(buffer), {
      useSystemFonts: false,
    });
    if (pdf.numPages < 1 || pdf.numPages > MAX_SOURCE_PDF_PAGES)
      throw new AppError(
        400,
        `PDF phải có từ 1 đến ${MAX_SOURCE_PDF_PAGES.toLocaleString("vi-VN")} trang; hãy tách file lớn hơn`,
      );
    // Keep only parcel identities and the current page, rather than retaining
    // all extracted text while PDF.js still holds the document and its fonts.
    const analyzer = sourceLabelAnalyzer(
      createHash("sha256").update(buffer).digest("hex"),
    );
    let characters = 0;
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      const text = sourcePageText(content.items);
      characters += text.length;
      if (characters > MAX_SOURCE_PDF_TEXT)
        throw new AppError(400, "Nội dung PDF quá lớn");
      analyzer.addPage(text);
      page.cleanup();
    }
    return analyzer.finish();
  } catch (e) {
    if (e instanceof AppError) throw e;
    throw new AppError(
      400,
      "Không đọc được PDF. Hãy chọn bản tải gốc không khóa mật khẩu; PDF ảnh chưa được hỗ trợ.",
    );
  } finally {
    await pdf?.loadingTask.destroy();
  }
}
