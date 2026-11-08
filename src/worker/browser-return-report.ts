import {
  buildReturnReportWorkbook,
  buildReturnIntakeErrorWorkbook,
} from "./return-report-workbook";
globalThis.onmessage = async (event: MessageEvent) => {
  try {
    const book =
      event.data.type === "errors"
        ? buildReturnIntakeErrorWorkbook(event.data.headers, event.data.rows)
        : await buildReturnReportWorkbook(event.data.rows, event.data.meta);
    const buffer = await book.xlsx.writeBuffer();
    const bytes = new Uint8Array(buffer as any);
    globalThis.postMessage(
      { type: "file", bytes: bytes.buffer },
      { transfer: [bytes.buffer] },
    );
  } catch {
    globalThis.postMessage({
      type: "error",
      error: "Chưa tạo được Excel. Thu hẹp bộ lọc và thử lại trên máy tính",
    });
  }
};
