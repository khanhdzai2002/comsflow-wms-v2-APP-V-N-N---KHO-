import { beforeAll, beforeEach, afterAll, it, expect, vi } from "vitest";
import { readFile, readdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { db, type User } from "../src/lib/db";
import {
  createUpload,
  finalizeUpload,
  ownedJob,
  claimJob,
  failJob,
} from "../src/lib/jobs";
import { executeJob } from "../src/worker/execute";
import {
  makePdf,
  labelText,
  continuationText,
  shopeeLabelText,
} from "./pdf-fixture";
import {
  appendSourcePages,
  processSourceBrowser,
} from "../src/lib/source-browser-job";
import { returnCsv, returnRow } from "./return-fixture";
import { processReturnCsv } from "../src/lib/return-csv-job";
import { parseTikTokReturnCsv } from "../src/lib/return-csv-parse";
import { parseReturnFile } from "../src/lib/return-import";
import { RETURN_CSV_ROUTE } from "../src/lib/return-csv-format";
const mock = vi.hoisted(() => ({
  files: new Map<string, Buffer>(),
  failUpload: false,
}));
vi.mock("../src/lib/supabase", () => ({
  storage: () => ({
    async createSignedUploadUrl(path: string) {
      return { data: { path, token: "test-signed" }, error: null };
    },
    async info(path: string) {
      const bytes = mock.files.get(path);
      return bytes
        ? { data: { size: bytes.length }, error: null }
        : { data: null, error: {} };
    },
    async download(path: string) {
      const bytes = mock.files.get(path);
      return bytes
        ? { data: new Blob([new Uint8Array(bytes)]), error: null }
        : { data: null, error: {} };
    },
    async upload(path: string, stream: AsyncIterable<Buffer>) {
      if (mock.failUpload) return { error: {} };
      const chunks = [];
      for await (const part of stream) chunks.push(part);
      mock.files.set(path, Buffer.concat(chunks));
      return { data: { path }, error: null };
    },
  }),
}));
if (
  !process.env.TEST_DATABASE_URL ||
  !new URL(process.env.TEST_DATABASE_URL).pathname.endsWith("_test")
)
  throw new Error("Only disposable *_test database");
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
const sql = db();
let admin: User, staff: User, warehouse: string, shift: string;
beforeAll(async () => {
  await sql`DROP SCHEMA public CASCADE`;
  await sql`CREATE SCHEMA public`;
  for (const file of (await readdir("migrations"))
    .filter((x) => x.endsWith(".sql"))
    .sort())
    await sql.unsafe(await readFile("migrations/" + file, "utf8"));
});
beforeEach(async () => {
  mock.files.clear();
  mock.failUpload = false;
  await sql`TRUNCATE users,warehouses,sales_channels,shipping_carriers CASCADE`;
  const users =
    await sql`INSERT INTO users(name,email,password_hash,role) VALUES('Admin','a@local.test','unused','admin'),('Staff','s@local.test','unused','staff') RETURNING id,name,email,role`;
  admin = users[0] as User;
  staff = users[1] as User;
  warehouse = (
    await sql`INSERT INTO warehouses(name) VALUES('Test') RETURNING id`
  )[0].id;
  shift = (
    await sql`INSERT INTO work_shifts(name,warehouse_id,starts_at,ends_at) VALUES('Test',${warehouse},now()-interval '1 day',now()+interval '1 day') RETURNING id`
  )[0].id;
  await sql`INSERT INTO shipping_carriers(name) VALUES('J&T Express')`;
});
afterAll(() => sql.end());
async function csvJob(rows = [returnRow()]) {
  const bytes = returnCsv(rows);
  const job = await createUpload(admin, {
    route: RETURN_CSV_ROUTE,
    filename: "returns.csv",
    size: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    payload: { context: { warehouseId: warehouse, shop: "Test" } },
    requestKey: crypto.randomUUID(),
  });
  if (!("path" in job)) throw new Error("Missing test upload path");
  mock.files.set(job.path, bytes);
  await finalizeUpload(admin, job.id);
  return { id: job.id, path: job.path, bytes };
}
it("CSV preview and concurrent commits finish without any processor, preserving original bytes and idempotency", async () => {
  const job = await csvJob();
  expect(await claimJob()).toBeNull();
  const preview = await processReturnCsv(admin, job.id, false);
  expect(preview).toMatchObject({
    canCommit: true,
    _csvDirect: true,
    summary: { requests: 1 },
  });
  expect(await sql`SELECT id FROM return_cases`).toHaveLength(0);
  const results = await Promise.all([
    processReturnCsv(admin, job.id, true),
    processReturnCsv(admin, job.id, true),
  ]);
  expect(results[0].id).toBe(results[1].id);
  expect(await sql`SELECT id FROM return_cases`).toHaveLength(1);
  expect(await sql`SELECT id FROM return_imports`).toHaveLength(1);
  expect(
    await sql`SELECT id FROM audit_logs WHERE action='return_import'`,
  ).toHaveLength(1);
  expect((await ownedJob(admin, job.id)).route).toBe("returns/csv/commit");
  expect(mock.files.get(job.path)).toEqual(job.bytes);
  await expect(processReturnCsv(staff, job.id, true)).rejects.toMatchObject({
    status: 403,
  });
});
it("CSV rows with errors block the complete import and original-file hash mismatch is rejected", async () => {
  const job = await csvJob([
    returnRow(),
    returnRow({
      "Return Order ID": "1234567890123456790",
      "Return Quantity": "0",
    }),
  ]);
  const preview = await processReturnCsv(admin, job.id, false);
  expect(preview).toMatchObject({ canCommit: false, errors: [{ row: 3 }] });
  await expect(processReturnCsv(admin, job.id, true)).rejects.toMatchObject({
    status: 409,
  });
  expect(await sql`SELECT id FROM return_cases`).toHaveLength(0);
  const valid = await csvJob();
  const altered = Buffer.from(
    valid.bytes.toString().replace("TEST SHIRT", "FAKE SHIRT"),
  );
  mock.files.set(valid.path, altered);
  await expect(processReturnCsv(admin, valid.id, false)).rejects.toThrow(
    "SHA-256",
  );
  expect((await ownedJob(admin, valid.id)).status).toBe("failed");
  await expect(processReturnCsv(staff, valid.id, false)).rejects.toMatchObject({
    status: 403,
  });
});
it("CSV commit requires a fresh server preview and refuses cancelled or expired uploads", async () => {
  const first = await csvJob();
  await processReturnCsv(admin, first.id, false);
  await processReturnCsv(admin, first.id, true);
  const next = await csvJob([returnRow({ "Return Quantity": "2" })]);
  await processReturnCsv(admin, next.id, false);
  await sql`UPDATE return_cases SET version=version+1`;
  await expect(processReturnCsv(admin, next.id, true)).rejects.toThrow(
    "Dữ liệu đổi sau khi xem trước",
  );
  expect(await sql`SELECT id FROM return_imports`).toHaveLength(1);
  await processReturnCsv(admin, next.id, false);
  expect(await processReturnCsv(admin, next.id, true)).toMatchObject({
    updated: 1,
  });
  await expect(processReturnCsv(admin, next.id, false)).rejects.toMatchObject({
    status: 409,
  });
  const stopped = await csvJob();
  await sql`UPDATE data_jobs SET status='cancelled' WHERE id=${stopped.id}`;
  await expect(
    processReturnCsv(admin, stopped.id, false),
  ).rejects.toMatchObject({ status: 409 });
  await sql`UPDATE data_jobs SET expires_at=now()-interval '1 hour' WHERE id=${first.id}`;
  await expect(processReturnCsv(admin, first.id, true)).rejects.toMatchObject({
    status: 410,
  });
});
it("fixed TikTok CSV preserves long IDs, BOM and quoted multiline cells with the same validation as the old parser", async () => {
  const bytes = Buffer.concat([
    Buffer.from("\uFEFF"),
    returnCsv([
      returnRow({ "Buyer Note": 'Dòng 1, có dấu phẩy\nDòng 2 "ghi chú"' }),
    ]),
  ]);
  expect(parseTikTokReturnCsv(bytes)).toEqual(
    await parseReturnFile(bytes, "sample.csv"),
  );
  expect(() => parseTikTokReturnCsv(Buffer.alloc(1024 * 1024 + 1))).toThrow(
    "1 MB",
  );
  expect(() =>
    parseTikTokReturnCsv(
      returnCsv(Array.from({ length: 2001 }, () => returnRow())),
    ),
  ).toThrow("2.000 dòng");
  expect(() => parseTikTokReturnCsv(bytes, "Shopee")).toThrow("không khớp");
  expect(() => parseTikTokReturnCsv(Buffer.from('a,b\n"unclosed'))).toThrow(
    "UTF-8",
  );
});
it("777 distinct return requests import in one bulk transaction without a worker", async () => {
  const rows = Array.from({ length: 777 }, (_, i) =>
    returnRow({
      "Return Order ID": String(1234567890123456789n + BigInt(i)),
      "Return Logistics Tracking ID":
        i < 622 ? String(854160000001n + BigInt(i)) : "",
      "Order ID": String(586000000000000001n + BigInt(i % 734)),
    }),
  );
  const job = await csvJob(rows);
  expect(await processReturnCsv(admin, job.id, false)).toMatchObject({
    canCommit: true,
    summary: {
      requests: 777,
      orders: 734,
      tracking: 622,
      missingTracking: 155,
    },
  });
  expect(await processReturnCsv(admin, job.id, true)).toMatchObject({
    created: 777,
    updated: 0,
  });
  expect((await sql`SELECT count(*)::int n FROM return_cases`)[0].n).toBe(777);
  expect((await sql`SELECT count(*)::int n FROM return_snapshots`)[0].n).toBe(
    777,
  );
  expect((await sql`SELECT count(*)::int n FROM return_parcels`)[0].n).toBe(
    622,
  );
  expect(await sql`SELECT id FROM return_imports`).toHaveLength(1);
});
it("a failure after bulk case writes rolls back the entire import and its durable job result", async () => {
  const job = await csvJob([
    returnRow(),
    returnRow({
      "Return Order ID": "1234567890123456790",
      "SKU ID": "1111111111111111112",
    }),
  ]);
  await processReturnCsv(admin, job.id, false);
  await sql.unsafe(
    "CREATE FUNCTION reject_csv_test_snapshot() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'CSV test rollback'; END $$; CREATE TRIGGER reject_csv_test_snapshot BEFORE INSERT ON return_snapshots FOR EACH ROW EXECUTE FUNCTION reject_csv_test_snapshot();",
  );
  try {
    await expect(processReturnCsv(admin, job.id, true)).rejects.toThrow(
      "CSV test rollback",
    );
    expect(await sql`SELECT id FROM return_cases`).toHaveLength(0);
    expect(await sql`SELECT id FROM return_imports`).toHaveLength(0);
    expect(
      await sql`SELECT id FROM audit_logs WHERE action='return_import'`,
    ).toHaveLength(0);
    expect((await ownedJob(admin, job.id)).route).toBe(RETURN_CSV_ROUTE);
  } finally {
    await sql.unsafe(
      "DROP TRIGGER reject_csv_test_snapshot ON return_snapshots; DROP FUNCTION reject_csv_test_snapshot();",
    );
  }
  expect(await processReturnCsv(admin, job.id, true)).toMatchObject({
    created: 2,
  });
});
async function upload(
  bytes = makePdf([labelText(), continuationText()]),
  extra: Record<string, any> = {},
) {
  const raw = {
    route: "sources/preview",
    filename: "test.pdf",
    size: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    payload: {
      context: { warehouseId: warehouse, shop: "Test", dueDate: "2026-10-23" },
    },
    requestKey: crypto.randomUUID(),
    ...extra,
  };
  const job = await createUpload(admin, raw);
  const row = await ownedJob(admin, job.id);
  mock.files.set(row.storage_path, bytes);
  await finalizeUpload(admin, job.id);
  return { job, raw };
}
it("browser PDF stages contiguous pages with replay protection and commits once without a processor", async () => {
  const texts = [labelText(), continuationText()];
  const { job } = await upload(makePdf(texts), {
    route: "sources/browser/preview",
  });
  expect(await claimJob()).toBeNull();
  const first = { offset: 0, totalPages: 2, pages: [texts[0]] };
  expect(await appendSourcePages(admin, job.id, first)).toMatchObject({
    receivedPages: 1,
  });
  expect(await appendSourcePages(admin, job.id, first)).toMatchObject({
    receivedPages: 1,
  });
  await expect(
    appendSourcePages(admin, job.id, {
      ...first,
      pages: [texts[0] + "CHANGED"],
    }),
  ).rejects.toMatchObject({ status: 409 });
  await expect(
    processSourceBrowser(admin, job.id, false),
  ).rejects.toMatchObject({ status: 409 });
  await appendSourcePages(admin, job.id, {
    offset: 1,
    totalPages: 2,
    pages: [texts[1]],
    labels: [{ trackingCode: "FAKE" }],
    duplicatePages: 999,
  });
  const preview = await processSourceBrowser(admin, job.id, false);
  expect(preview).toMatchObject({
    pageCount: 2,
    uniqueShipments: 1,
    continuationPages: 1,
    duplicatePages: 0,
    errors: [],
  });
  expect(await sql`SELECT id FROM shipments`).toHaveLength(0);
  const [a, b] = await Promise.all([
    processSourceBrowser(admin, job.id, true),
    processSourceBrowser(admin, job.id, true),
  ]);
  expect(a.id).toBe(b.id);
  expect(await sql`SELECT id FROM shipments`).toHaveLength(1);
  expect(await sql`SELECT id FROM source_manifests`).toHaveLength(1);
  expect(
    await sql`SELECT id FROM audit_logs WHERE action='source_browser_extract'`,
  ).toHaveLength(1);
  expect((await ownedJob(admin, job.id)).route).toBe("sources/browser/commit");
});
it("browser PDF detects SPX separately from TikTok J&T and preserves a labelled shipment", async () => {
  await sql`INSERT INTO shipping_carriers(name) VALUES('SPX Express')`;
  const text = shopeeLabelText();
  const { job } = await upload(makePdf([text]), {
    route: "sources/browser/preview",
  });
  await appendSourcePages(admin, job.id, {
    offset: 0,
    totalPages: 1,
    pages: [text],
  });
  expect(await processSourceBrowser(admin, job.id, false)).toMatchObject({
    channelName: "Shopee",
    carrierName: "SPX Express",
    uniqueShipments: 1,
    errors: [],
  });
  expect(await processSourceBrowser(admin, job.id, true)).toMatchObject({
    newShipments: 1,
    total: 1,
  });
  const [shipment] =
    await sql`SELECT s.tracking_code,c.name carrier,ch.name channel FROM shipments s JOIN shipping_carriers c ON c.id=s.carrier_id JOIN orders o ON o.id=s.order_id JOIN sales_channels ch ON ch.id=o.channel_id`;
  expect(shipment).toMatchObject({
    tracking_code: "SPXVN00000000001A",
    carrier: "SPX Express",
    channel: "Shopee",
  });
});
it("browser PDF cannot skip pages, commit before preview, use another actor or accept a changed original", async () => {
  const text = labelText(),
    bytes = makePdf([text]);
  const { job } = await upload(bytes, { route: "sources/browser/preview" });
  await expect(
    appendSourcePages(admin, job.id, {
      offset: 1,
      totalPages: 1,
      pages: [text],
    }),
  ).rejects.toMatchObject({ status: 409 });
  await expect(
    appendSourcePages(staff, job.id, {
      offset: 0,
      totalPages: 1,
      pages: [text],
    }),
  ).rejects.toMatchObject({ status: 403 });
  await expect(
    appendSourcePages({ ...admin, id: crypto.randomUUID() }, job.id, {
      offset: 0,
      totalPages: 1,
      pages: [text],
    }),
  ).rejects.toMatchObject({ status: 404 });
  await appendSourcePages(admin, job.id, {
    offset: 0,
    totalPages: 1,
    pages: [text],
  });
  await expect(processSourceBrowser(admin, job.id, true)).rejects.toMatchObject(
    { status: 409 },
  );
  const record = await ownedJob(admin, job.id);
  const changed = Buffer.from(bytes);
  changed[changed.length - 1] ^= 1;
  mock.files.set(record.storage_path, changed);
  await expect(processSourceBrowser(admin, job.id, false)).rejects.toThrow(
    "SHA-256",
  );
  expect(await sql`SELECT id FROM shipments`).toHaveLength(0);
  mock.files.set(record.storage_path, bytes);
  await processSourceBrowser(admin, job.id, false);
  await sql`UPDATE data_jobs SET status='cancelled' WHERE id=${job.id}`;
  await expect(processSourceBrowser(admin, job.id, true)).rejects.toMatchObject(
    { status: 409 },
  );
});
it("a PDF page with unsupported content blocks the whole source; expired jobs cannot resume", async () => {
  const texts = [labelText(), "unsupported page"];
  const { job } = await upload(makePdf(texts), {
    route: "sources/browser/preview",
  });
  await appendSourcePages(admin, job.id, {
    offset: 0,
    totalPages: 2,
    pages: texts,
  });
  const preview = await processSourceBrowser(admin, job.id, false);
  expect(preview.errors.length).toBeGreaterThan(0);
  await expect(processSourceBrowser(admin, job.id, true)).rejects.toMatchObject(
    { status: 400 },
  );
  expect(await sql`SELECT id FROM shipments`).toHaveLength(0);
  expect(await sql`SELECT id FROM source_manifests`).toHaveLength(0);
  await sql`UPDATE data_jobs SET expires_at=now()-interval '1 hour' WHERE id=${job.id}`;
  await expect(
    appendSourcePages(admin, job.id, {
      offset: 0,
      totalPages: 2,
      pages: texts,
    }),
  ).rejects.toMatchObject({ status: 410 });
});
it("signed upload is owner scoped, rejects staff and waits for complete object", async () => {
  await expect(createUpload(staff, {})).rejects.toMatchObject({ status: 403 });
  const { job } = await upload();
  await expect(ownedJob(staff, job.id)).rejects.toMatchObject({ status: 404 });
  expect((await ownedJob(admin, job.id)).status).toBe("queued");
});
it("retrying an upload intent returns one durable job", async () => {
  const { job, raw } = await upload();
  const again = await createUpload(admin, raw);
  expect(again.id).toBe(job.id);
  expect((await sql`SELECT count(*)::int n FROM data_jobs`)[0].n).toBe(1);
});
it("concurrent workers claim different jobs; stale fencing tokens cannot overwrite", async () => {
  await upload();
  await upload();
  const jobs = await Promise.all([claimJob(), claimJob()]);
  expect(jobs[0].id).not.toBe(jobs[1].id);
  const old = jobs[0];
  await sql`UPDATE data_jobs SET lease_expires_at=now()-interval '1 second' WHERE id=${old.id}`;
  const reclaimed = await claimJob();
  expect(reclaimed.id).toBe(old.id);
  expect(reclaimed.lease_token).not.toBe(old.lease_token);
  await failJob(old.id, old.lease_token, "stale", false);
  expect((await ownedJob(admin, old.id)).status).toBe("running");
});
it("multi-page PDF preview runs separately; atomic commit is never replayed", async () => {
  const { job } = await upload();
  let claimed = await claimJob();
  await executeJob(claimed.id, claimed.lease_token);
  let result = await ownedJob(admin, job.id);
  expect(result.status).toBe("succeeded");
  expect(result.result.uniqueShipments).toBe(1);
  await sql`UPDATE data_jobs SET route='sources/commit',status='queued',attempts=0 WHERE id=${job.id}`;
  claimed = await claimJob();
  await executeJob(claimed.id, claimed.lease_token);
  await executeJob(claimed.id, claimed.lease_token);
  result = await ownedJob(admin, job.id);
  expect(result.status).toBe("succeeded");
  expect((await sql`SELECT count(*)::int n FROM source_manifests`)[0].n).toBe(
    1,
  );
  expect((await sql`SELECT count(*)::int n FROM shipments`)[0].n).toBe(1);
});
it("tampered file hash and revoked account fail before business writes", async () => {
  const { job } = await upload();
  const row = await ownedJob(admin, job.id);
  const bytes = mock.files.get(row.storage_path)!;
  bytes[15] ^= 1;
  const claimed = await claimJob();
  await expect(
    executeJob(claimed.id, claimed.lease_token),
  ).rejects.toMatchObject({ status: 400 });
  expect((await sql`SELECT count(*)::int n FROM shipments`)[0].n).toBe(0);
  bytes[15] ^= 1;
  await sql`UPDATE users SET active=false WHERE id=${admin.id}`;
  await expect(
    executeJob(claimed.id, claimed.lease_token),
  ).rejects.toMatchObject({ status: 403 });
});
it("failed processing rolls back job success and operational changes together", async () => {
  const { job } = await upload();
  await sql`UPDATE data_jobs SET route='sources/commit' WHERE id=${job.id}`;
  // Force the final durable-result write to fail after the source import has run.
  await sql`CREATE FUNCTION reject_job_success() RETURNS trigger LANGUAGE plpgsql AS 'BEGIN IF NEW.status=''succeeded'' THEN RAISE EXCEPTION ''test rollback''; END IF; RETURN NEW; END'`;
  await sql`CREATE TRIGGER reject_job_success BEFORE UPDATE ON data_jobs FOR EACH ROW EXECUTE FUNCTION reject_job_success()`;
  const claimed = await claimJob();
  try {
    await expect(executeJob(claimed.id, claimed.lease_token)).rejects.toThrow(
      "test rollback",
    );
  } finally {
    await sql`DROP TRIGGER reject_job_success ON data_jobs`;
    await sql`DROP FUNCTION reject_job_success()`;
  }
  expect((await sql`SELECT count(*)::int n FROM shipments`)[0].n).toBe(0);
  expect((await ownedJob(admin, job.id)).status).toBe("running");
});
it("exports all 1940 rows, preserving leading-zero codes and Vietnam day boundaries", async () => {
  await sql`INSERT INTO scan_events(request_id,raw_code,outcome,user_id,shift_id,warehouse_id,method,created_at) SELECT gen_random_uuid(),lpad(n::text,12,'0'),'unknown',${admin.id},${shift},${warehouse},'manual','2026-10-21T10:00:00Z'::timestamptz FROM generate_series(1,1940) n`;
  await sql`INSERT INTO scan_events(request_id,raw_code,outcome,user_id,shift_id,warehouse_id,method,created_at) VALUES(gen_random_uuid(),'EARLY','unknown',${admin.id},${shift},${warehouse},'manual','2026-10-20T16:59:59Z'),(gen_random_uuid(),'NEXTDAY','unknown',${admin.id},${shift},${warehouse},'manual','2026-10-21T17:00:00Z')`;
  const [job] =
    await sql`INSERT INTO data_jobs(created_by,route,method,status,payload,idempotency_key) VALUES(${admin.id},'scan-export','GET','queued','{"date":"2026-10-21"}',${crypto.randomUUID()}) RETURNING id`;
  const claim = await claimJob();
  await executeJob(claim.id, claim.lease_token);
  const result = await ownedJob(admin, job.id);
  expect(result.result.rows).toBe(1940);
  const csv = mock.files.get(result.result.artifact)!.toString("utf8");
  expect(csv).toContain("000000000001");
  expect(csv).not.toContain("EARLY");
  expect(csv).not.toContain("NEXTDAY");
  expect(csv.split("\r\n")).toHaveLength(1942);
  expect(
    createHash("sha256")
      .update(mock.files.get(result.result.artifact)!)
      .digest("hex"),
  ).toBe(result.result.sha256);
});
