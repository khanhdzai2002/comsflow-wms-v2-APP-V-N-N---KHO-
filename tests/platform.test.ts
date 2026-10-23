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
import { makePdf, labelText, continuationText } from "./pdf-fixture";
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
