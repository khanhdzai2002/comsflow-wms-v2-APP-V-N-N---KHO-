import { fork } from "node:child_process";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { rm, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { db } from "../lib/db";
import { claimJob, failJob } from "../lib/jobs";
import { storage } from "../lib/supabase";
const workerId = randomUUID();
let stopped = false;
process.on("SIGTERM", () => {
  stopped = true;
});
process.on("SIGINT", () => {
  stopped = true;
});
async function cleanup() {
  const sql = db();
  const jobs =
    await sql`SELECT id,storage_path,result FROM data_jobs WHERE expires_at<now() AND status NOT IN ('running') AND storage_cleaned_at IS NULL LIMIT 20`;
  for (const job of jobs) {
    const prefix = "results/" + job.id;
    const listed = await storage().list(prefix, { limit: 100 });
    if (listed.error) continue;
    const paths = [
      job.storage_path,
      job.result?.artifact,
      ...listed.data.map((item) => prefix + "/" + item.name),
    ].filter(Boolean);
    if (paths.length) {
      const removed = await storage().remove(paths);
      if (removed.error) continue;
    }
    await sql`UPDATE data_jobs SET storage_cleaned_at=now(),storage_path=NULL,result=jsonb_build_object('expired',true),payload='{}'::jsonb,status=CASE WHEN status IN ('queued','waiting_upload') THEN 'cancelled' ELSE status END,error=CASE WHEN status IN ('queued','waiting_upload') THEN 'Tác vụ đã hết hạn' ELSE error END WHERE id=${job.id}`;
  }
  await sql`DELETE FROM data_jobs WHERE id IN (SELECT id FROM data_jobs WHERE expires_at<now()-interval '30 days' AND status NOT IN ('running') LIMIT 1000)`;
  await sql`DELETE FROM worker_heartbeats WHERE seen_at<now()-interval '1 day'`;
  await sql`UPDATE data_jobs SET status='failed',error='Đã hết số lần thử. Chọn lại file để tạo tác vụ mới.',lease_token=NULL WHERE status='running' AND lease_expires_at<now() AND attempts>=max_attempts`;
}
export async function runChild(job: { id: string; lease_token: string }) {
  return new Promise<void>((resolve, reject) => {
    const compiled = import.meta.url.endsWith(".mjs");
    const path = fileURLToPath(
      new URL(compiled ? "./child.mjs" : "./child.ts", import.meta.url),
    );
    const child = fork(path, [job.id, job.lease_token], {
      execArgv: compiled
        ? ["--max-old-space-size=384"]
        : ["--max-old-space-size=384", "--import", "tsx"],
      stdio: ["ignore", "inherit", "inherit", "ipc"],
    });
    let outcome:
      { ok: boolean; error?: string; retryable?: boolean } | undefined;
    child.on("message", (message: any) => {
      outcome = message;
    });
    const timeout = setTimeout(() => child.kill("SIGKILL"), 8 * 60 * 1000);
    child.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.on("exit", () => {
      clearTimeout(timeout);
      void (async () => {
        for (const name of await readdir(tmpdir()))
          if (name.startsWith(job.id + "-"))
            await rm(join(tmpdir(), name), { force: true });
        if (!outcome?.ok)
          await failJob(
            job.id,
            job.lease_token,
            outcome?.error ??
              "Worker đọc file bị dừng hoặc vượt giới hạn tài nguyên. Tác vụ sẽ thử lại.",
            outcome?.retryable ?? true,
          );
      })().then(() => resolve(), reject);
    });
  });
}
console.log("ComsFlow worker started; concurrency=1; parser memory=384 MB");
let maintenanceAt = 0;
try {
  while (!stopped) {
    try {
      await db()`INSERT INTO worker_heartbeats(id) VALUES(${workerId}) ON CONFLICT(id) DO UPDATE SET seen_at=now()`;
      if (Date.now() - maintenanceAt > 60000) {
        await cleanup();
        maintenanceAt = Date.now();
      }
      const job = await claimJob();
      if (job) await runChild({ id: job.id, lease_token: job.lease_token });
      else await new Promise((resolve) => setTimeout(resolve, 2000));
    } catch {
      console.error("Worker loop unavailable; retrying in 5 seconds");
      await new Promise((resolve) => setTimeout(resolve, 5000));
    }
  }
} finally {
  await db().end({ timeout: 5 });
}
