import { useState } from "react";
import {
  CheckCircle2,
  Clock,
  Download,
  FileUp,
  AlertCircle,
} from "lucide-react";
import { useData, post, toast, ErrorBox } from "./shared";
import { todayVN, formatTime } from "@/lib/domain";
const labels: Record<string, string> = {
  waiting_upload: "Đang tải file",
  queued: "Đang chờ",
  running: "Đang xử lý",
  succeeded: "Hoàn tất",
  failed: "Cần kiểm tra",
  cancelled: "Đã hủy",
};
export function DataJobs() {
  const { data, error, reload } = useData<any>("jobs", 4000);
  const [date, setDate] = useState(todayVN()),
    [selected, setSelected] = useState<string | null>(
      window.location.hash.split("/")[1] || null,
    ),
    [busy, setBusy] = useState(false);
  const detail = useData<any>(
    selected ? "jobs/" + selected : null,
    selected ? 4000 : 0,
  );
  async function act(path: string, body: unknown = {}) {
    setBusy(true);
    try {
      const result = await post(path, body);
      if (result.id) {
        setSelected(result.id);
        window.history.replaceState(null, "", "#jobs/" + result.id);
      }
      reload();
      detail.reload();
    } catch (e) {
      toast((e as Error).message, true);
    } finally {
      setBusy(false);
    }
  }
  const stale =
    !data?.workerLastSeen ||
    Date.now() - new Date(data.workerLastSeen).getTime() > 11 * 60 * 1000;
  return (
    <div className="data-jobs">
      <section className="card padded">
        <h2>
          <Download size={22} /> Tải lịch sử quét xuất kho
        </h2>
        <p>
          Lấy toàn bộ lượt quét của ngày theo giờ Việt Nam, gồm mã vận đơn, kết
          quả, nhân viên và thời gian. File CSV mở được trong Excel.
        </p>
        <div className="inline">
          <label>
            Ngày quét
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </label>
          <button
            className="primary"
            disabled={busy || !date}
            onClick={() => act("jobs/scan-export", { date })}
          >
            Tạo file tải xuống
          </button>
        </div>
      </section>
      {error && <ErrorBox message={error} />}
      {stale && (
        <div className="notice warning">
          <AlertCircle size={18} /> Worker xử lý file chưa kết nối gần đây. Tác
          vụ được giữ trong hàng đợi; quét đơn vẫn hoạt động riêng.
        </div>
      )}
      <section className="card padded">
        <h2>
          <Clock size={22} /> Tác vụ gần đây
        </h2>
        <p>
          Tiến độ được lưu trên hệ thống. Bạn có thể F5 hoặc quay lại sau. File
          tạm và báo cáo tải xuống được giữ 7 ngày.
        </p>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Thời gian</th>
                <th>File / tác vụ</th>
                <th>Trạng thái</th>
                <th>Thao tác</th>
              </tr>
            </thead>
            <tbody>
              {data?.jobs.map((job: any) => (
                <tr
                  key={job.id}
                  className={selected === job.id ? "job-selected" : ""}
                >
                  <td>{formatTime(job.created_at)}</td>
                  <td>
                    {job.filename ||
                      (job.route === "scan-export"
                        ? "Lịch sử quét xuất kho"
                        : job.route)}
                    <small>
                      {job.route.endsWith("/preview")
                        ? "Xem trước — chưa lưu dữ liệu"
                        : job.route.endsWith("/commit")
                          ? "Xác nhận lưu dữ liệu"
                          : ""}
                    </small>
                  </td>
                  <td>
                    <span className={"job-state " + job.status}>
                      {job.status === "succeeded" ? (
                        <CheckCircle2 size={16} />
                      ) : (
                        <Clock size={16} />
                      )}{" "}
                      {labels[job.status]}
                    </span>
                    {job.error && <small>{job.error}</small>}
                  </td>
                  <td>
                    <button
                      className="secondary"
                      onClick={() => {
                        setSelected(job.id);
                        window.history.replaceState(
                          null,
                          "",
                          "#jobs/" + job.id,
                        );
                      }}
                    >
                      Xem chi tiết
                    </button>
                    {job.status === "failed" && (
                      <button
                        className="secondary"
                        disabled={busy}
                        onClick={() => act("jobs/" + job.id + "/retry")}
                      >
                        Thử lại
                      </button>
                    )}
                    {["queued", "waiting_upload"].includes(job.status) && (
                      <button
                        className="secondary"
                        disabled={busy}
                        onClick={() => act("jobs/" + job.id + "/cancel")}
                      >
                        Hủy
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      {selected && detail.data && (
        <section className="card padded">
          <h2>
            <FileUp size={22} /> Kết quả tác vụ
          </h2>
          <p>
            {labels[detail.data.status]} · {selected}
          </p>
          {detail.data.error && <ErrorBox message={detail.data.error} />}{" "}
          {detail.data.result?.artifact && (
            <a className="primary" href={"/api/jobs/" + selected + "/download"}>
              <Download size={18} /> Tải file ({detail.data.result.rows} dòng)
            </a>
          )}
          {data?.jobs
            .find((j: any) => j.id === selected)
            ?.route.endsWith("/preview") &&
            detail.data.status === "succeeded" && (
              <button
                className="primary"
                disabled={busy}
                onClick={() => {
                  if (
                    window.confirm(
                      "Xác nhận lưu dữ liệu từ kết quả xem trước này?",
                    )
                  )
                    void act("jobs/" + selected + "/commit");
                }}
              >
                Xác nhận lưu dữ liệu đã xem trước
              </button>
            )}
          <details>
            <summary>Xem kết quả chi tiết</summary>
            <pre className="job-json">
              {JSON.stringify(detail.data.result, null, 2)}
            </pre>
          </details>
        </section>
      )}
    </div>
  );
}
