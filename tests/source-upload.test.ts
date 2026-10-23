import { describe, it, expect, vi } from "vitest";
import { readSourceUpload, withSourceUpload } from "../src/lib/source-upload";
import {
  MAX_SOURCE_PDF_BYTES,
  MAX_SOURCE_REQUEST_BYTES,
} from "../src/lib/source-limits";
import { makePdf, labelText } from "./pdf-fixture";

const url = "http://127.0.0.1/api/sources/preview";
async function request(form: FormData) {
  // Encode wire bytes as an HTTP receiver sees them. Cancelling Undici's
  // in-process FormData/File producer itself has a Node 24 enqueue-after-close
  // bug; the server receives an incoming network stream, not that producer.
  const encoded = new Request(url, { method: "POST", body: form });
  return new Request(url, {
    method: "POST",
    headers: encoded.headers,
    body: await encoded.arrayBuffer(),
  });
}
const file = (bytes: Buffer = makePdf([labelText()]), name = "source.pdf") =>
  new File([new Uint8Array(bytes)], name, { type: "application/pdf" });
function form() {
  const data = new FormData();
  data.set("file", file());
  data.set("context", JSON.stringify({ shop: "Test", channel: "Shopee" }));
  return data;
}

describe("Upload PDF có giới hạn bộ nhớ", () => {
  it.each([true, false])(
    "đọc đúng byte PDF, context đứng trước file: %s",
    async (contextFirst) => {
      const pdf = makePdf([labelText()]);
      const body = new FormData();
      if (contextFirst) body.set("context", JSON.stringify({ shop: "Test" }));
      const filename = contextFirst ? "source.PDF" : "nguồn-đã-gộp.PDF";
      body.set("file", file(pdf, filename));
      if (!contextFirst) body.set("context", JSON.stringify({ shop: "Test" }));
      const result = await readSourceUpload(await request(body));
      expect(result.filename).toBe(filename);
      expect(result.buffer).toEqual(pdf);
      expect(result.context).toEqual({ shop: "Test" });
    },
  );

  it.each([
    [
      "thiếu file",
      () => {
        const data = form();
        data.delete("file");
        return data;
      },
    ],
    [
      "file trống",
      () => {
        const data = form();
        data.set("file", file(Buffer.alloc(0)));
        return data;
      },
    ],
    [
      "sai đuôi file",
      () => {
        const data = form();
        data.set("file", file(undefined, "source.xlsx"));
        return data;
      },
    ],
    [
      "sai trường file",
      () => {
        const data = new FormData();
        data.set("other", file());
        return data;
      },
    ],
    [
      "hai file",
      () => {
        const data = form();
        data.append("file", file());
        return data;
      },
    ],
    [
      "hai context",
      () => {
        const data = form();
        data.append("context", "{}");
        return data;
      },
    ],
    [
      "trường không hợp lệ",
      () => {
        const data = form();
        data.set("other", "extra");
        return data;
      },
    ],
    [
      "context quá lớn",
      () => {
        const data = form();
        data.set("context", "x".repeat(17 * 1024));
        return data;
      },
    ],
    [
      "JSON không hợp lệ",
      () => {
        const data = form();
        data.set("context", "{");
        return data;
      },
    ],
  ])("chặn %s và lượt đọc kế tiếp vẫn hoạt động", async (_name, create) => {
    await expect(
      withSourceUpload(async () => readSourceUpload(await request(create()))),
    ).rejects.toMatchObject({ status: 400 });
    expect(
      (
        await withSourceUpload(async () =>
          readSourceUpload(await request(form())),
        )
      ).buffer.length,
    ).toBeGreaterThan(0);
  });

  it("chặn file quá 50 MB trong stream mà không tin Content-Length", async () => {
    const body = new FormData();
    body.set("file", file(Buffer.alloc(MAX_SOURCE_PDF_BYTES + 1)));
    const req = await request(body);
    expect(req.headers.has("content-length")).toBe(false);
    await expect(readSourceUpload(req)).rejects.toMatchObject({ status: 413 });
  });

  it("vẫn nhận file đúng 50 MB tại biên giới hạn", async () => {
    const body = new FormData();
    body.set("file", file(Buffer.alloc(MAX_SOURCE_PDF_BYTES)));
    expect((await readSourceUpload(await request(body))).buffer.length).toBe(
      MAX_SOURCE_PDF_BYTES,
    );
  });

  it("chặn Content-Length vượt giới hạn trước khi đọc body", async () => {
    const req = await request(form());
    req.headers.set("content-length", String(MAX_SOURCE_REQUEST_BYTES + 1));
    await expect(readSourceUpload(req)).rejects.toMatchObject({ status: 413 });
    expect(req.bodyUsed).toBe(false);
    await req.body?.cancel();
  });

  it.each([
    ["application/json", "{}"],
    ["multipart/form-data", "missing-boundary"],
    [
      "multipart/form-data; boundary=test",
      '--test\r\nContent-Disposition: form-data; name="file"; filename="x.pdf"\r\n\r\n%PDF-',
    ],
  ])(
    "multipart hỏng (%s) không gây exception ngoài handler",
    async (contentType, body) => {
      await expect(
        readSourceUpload(
          new Request(url, {
            method: "POST",
            headers: { "Content-Type": contentType },
            body,
          }),
        ),
      ).rejects.toMatchObject({ status: 400 });
    },
  );

  it("huỷ upload giải phóng lượt xử lý, không để khoá treo", async () => {
    const controller = new AbortController();
    const req = new Request(await request(form()), {
      signal: controller.signal,
    });
    controller.abort();
    await expect(
      withSourceUpload(() => readSourceUpload(req)),
    ).rejects.toMatchObject({ status: 400 });
    await expect(withSourceUpload(async () => "available")).resolves.toBe(
      "available",
    );
  });

  it("từ chối lượt thứ hai trước khi tiêu thụ body và giải phóng sau thành công/lỗi", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const first = withSourceUpload(() => gate);
    const secondOperation = vi.fn(async () =>
      readSourceUpload(await request(form())),
    );
    await expect(withSourceUpload(secondOperation)).rejects.toMatchObject({
      status: 503,
    });
    expect(secondOperation).not.toHaveBeenCalled();
    release();
    await first;
    await expect(
      withSourceUpload(async () => {
        throw new Error("failed");
      }),
    ).rejects.toThrow("failed");
    await expect(withSourceUpload(async () => "available")).resolves.toBe(
      "available",
    );
  });
});
