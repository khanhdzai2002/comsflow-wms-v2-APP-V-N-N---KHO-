import { post, api } from "./shared";
export async function exportReturnOperations(
  filters: Record<string, unknown>,
  progress: (text: string) => void,
) {
  progress("Đang chốt dữ liệu theo bộ lọc trên máy chủ…");
  const report = await post("returns/operations/reports", {
    ...filters,
    state: "needs_check",
  });
  const rows: any[] = [];
  for (let offset = 0; offset < report.total_rows;) {
    const page = await api(
      "returns/operations/reports/" + report.id + "?offset=" + offset,
    );
    rows.push(...page.rows);
    offset += page.rows.length;
    progress(
      `Đã nhận ${offset.toLocaleString("vi-VN")}/${report.total_rows.toLocaleString("vi-VN")} dòng báo cáo…`,
    );
    if (!page.rows.length && !page.done)
      throw new Error("Báo cáo thiếu trang dữ liệu; tạo lại để đối chiếu");
  }
  if (rows.length !== report.total_rows)
    throw new Error("Số dòng báo cáo không khớp, chưa tải tệp không đầy đủ");
  const worker = new Worker(
    new URL("../worker/browser-return-report.ts", import.meta.url),
    { type: "module" },
  );
  try {
    progress("Đang tạo Excel với mã nguyên dạng và sheet riêng từng hãng…");
    const bytes = await new Promise<ArrayBuffer>((resolve, reject) => {
      const timer = setTimeout(
        () =>
          reject(
            new Error("Tạo Excel quá thời gian. Thu hẹp bộ lọc theo hãng/ngày"),
          ),
        180000,
      );
      worker.onerror = () => {
        clearTimeout(timer);
        reject(
          new Error("Trình duyệt chưa tạo được Excel. Thử lại trên máy tính"),
        );
      };
      worker.onmessage = (e) => {
        clearTimeout(timer);
        if (e.data.type === "file") resolve(e.data.bytes);
        else reject(new Error(e.data.error));
      };
      worker.postMessage({ rows, meta: report });
    });
    const url = URL.createObjectURL(
      new Blob([bytes], {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download =
      "COMS-FLOW_Doi-soat-hang-hoan_" +
      new Date(report.created_at).toISOString().slice(0, 10) +
      ".xlsx";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
    progress(
      `Đã tạo báo cáo ${report.total_cases.toLocaleString("vi-VN")} hồ sơ / ${rows.length.toLocaleString("vi-VN")} dòng. Mã đơn và vận đơn được lưu bằng ô văn bản.`,
    );
  } finally {
    worker.terminate();
  }
}
