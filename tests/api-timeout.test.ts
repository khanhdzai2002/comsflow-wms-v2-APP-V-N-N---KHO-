import { it, expect, afterEach, vi } from "vitest";
import { api, ApiError } from "../src/components/shared";
import { SOURCE_REQUEST_TIMEOUT_MS } from "../src/lib/source-limits";
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
it("PDF lớn có thời gian chờ riêng; không hủy sau 30 giây và vẫn không báo thành công giả", async () => {
  vi.useFakeTimers();
  let signal: AbortSignal | undefined;
  vi.stubGlobal(
    "fetch",
    vi.fn((_url, options) => {
      signal = options.signal;
      return new Promise((_resolve, reject) =>
        signal!.addEventListener("abort", () => reject(new Error("aborted"))),
      );
    }),
  );
  const result = api("sources/commit", {}, SOURCE_REQUEST_TIMEOUT_MS).catch(
    (e) => e,
  );
  await vi.advanceTimersByTimeAsync(31000);
  expect(signal?.aborted).toBe(false);
  await vi.advanceTimersByTimeAsync(SOURCE_REQUEST_TIMEOUT_MS);
  const error = await result;
  expect(error).toBeInstanceOf(ApiError);
  expect(error.retryable).toBe(true);
  expect(signal?.aborted).toBe(true);
});
it("thời gian chờ bảo vệ cả lúc đọc response body, không kết thúc ngay khi nhận header", async () => {
  vi.useFakeTimers();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url, options) => ({
      ok: true,
      status: 200,
      json: () =>
        new Promise((_resolve, reject) =>
          options.signal.addEventListener("abort", () =>
            reject(new Error("body aborted")),
          ),
        ),
    })),
  );
  const result = api("test").catch((e) => e);
  await vi.advanceTimersByTimeAsync(30001);
  expect(await result).toBeInstanceOf(ApiError);
});
it("a saved file reports an offline processor immediately without claiming success", async () => {
  const { waitJob } = await import("../src/components/job-client");
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      Response.json({ status: "queued", workerAvailable: false }),
    ),
  );
  await expect(waitJob("fixture-job")).rejects.toThrow(
    "File đã được lưu nhưng dịch vụ xử lý file chưa hoạt động",
  );
});
it("file job requests time out rather than hanging after a lost network response", async () => {
  vi.useFakeTimers();
  const { requestJob } = await import("../src/components/job-client");
  vi.stubGlobal(
    "fetch",
    vi.fn(
      (_url, options) =>
        new Promise((_resolve, reject) =>
          options.signal.addEventListener("abort", () =>
            reject(new Error("aborted")),
          ),
        ),
    ),
  );
  const result = requestJob("jobs/fixture/commit", {}).catch((e) => e);
  await vi.advanceTimersByTimeAsync(30001);
  expect((await result).message).toContain(
    "Chưa nhận được xác nhận từ máy chủ",
  );
});
