import { getDocumentProxy } from "unpdf";
import { sourcePageText } from "../lib/pdf-labels";
import {
  MAX_SOURCE_PDF_BYTES,
  MAX_SOURCE_PDF_PAGES,
  SOURCE_PAGE_BATCH,
  SOURCE_PAGE_BATCH_BYTES,
  SOURCE_PAGE_TEXT_LIMIT,
} from "../lib/source-limits";

let pdf: Awaited<ReturnType<typeof getDocumentProxy>> | undefined;
const encode = new TextEncoder();
globalThis.onmessage = async (event: MessageEvent) => {
  try {
    if (event.data.type === "open") {
      const file = event.data.file as File;
      if (!file.size || file.size > MAX_SOURCE_PDF_BYTES)
        throw new Error("PDF tối đa 50 MB.");
      const bytes = new Uint8Array(await file.arrayBuffer());
      if (new TextDecoder().decode(bytes.subarray(0, 5)) !== "%PDF-")
        throw new Error("Chọn đúng file PDF gốc.");
      pdf = await getDocumentProxy(bytes, { useSystemFonts: false });
      if (!pdf.numPages || pdf.numPages > MAX_SOURCE_PDF_PAGES)
        throw new Error("PDF tối đa 3.000 trang; hãy tách file lớn hơn.");
      globalThis.postMessage({ type: "ready", pageCount: pdf.numPages });
    } else if (event.data.type === "pages") {
      if (!pdf) throw new Error("Chưa mở được PDF.");
      const offset = event.data.offset as number;
      const pages: string[] = [];
      let size = 0;
      for (
        let pageNumber = offset + 1;
        pageNumber <= Math.min(pdf.numPages, offset + SOURCE_PAGE_BATCH);
        pageNumber++
      ) {
        const page = await pdf.getPage(pageNumber);
        const content = await page.getTextContent();
        const text = sourcePageText(content.items);
        const bytes = encode.encode(JSON.stringify(text)).byteLength;
        page.cleanup();
        if (
          text.length > SOURCE_PAGE_TEXT_LIMIT ||
          bytes > SOURCE_PAGE_BATCH_BYTES / 2
        )
          throw new Error(
            `Trang ${pageNumber} có quá nhiều nội dung; hãy tách file PDF.`,
          );
        if (size + bytes > SOURCE_PAGE_BATCH_BYTES - 8192 && pages.length)
          break;
        pages.push(text);
        size += bytes;
      }
      globalThis.postMessage({ type: "pages", offset, pages });
    }
  } catch (error) {
    globalThis.postMessage({
      type: "error",
      error:
        error instanceof Error
          ? error.message
          : "Không đọc được PDF gốc. PDF ảnh hoặc file có mật khẩu chưa được hỗ trợ.",
    });
    await pdf?.loadingTask.destroy();
    pdf = undefined;
  }
};
