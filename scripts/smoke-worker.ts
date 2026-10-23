// A disposable local integration test of the real polling loop and child process.
// Storage is an HTTP fixture; no production provider or customer files involved.
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createHash } from "node:crypto";
import { db } from "../src/lib/db";
import { largeSourcePdf } from "../tests/pdf-fixture";
const url = new URL(process.env.DATABASE_URL || "");
if (
  !["127.0.0.1", "localhost"].includes(url.hostname) ||
  !url.pathname.endsWith("_smoke_test")
)
  throw new Error("Chỉ chạy với database local riêng *_smoke_test");
const sql = db(),
  bytes = largeSourcePdf(),
  jobId = crypto.randomUUID(),
  userId = crypto.randomUUID();
let worker: ReturnType<typeof spawn> | undefined,
  logs = "";
const server = createServer((req, res) => {
  if (req.method === "GET" && req.url?.endsWith("/input")) {
    res.writeHead(200, {
      "Content-Type": "application/pdf",
      "Content-Length": bytes.length,
    });
    res.end(bytes);
  } else {
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end('{"message":"fixture not found"}');
  }
});
try {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("No fixture port");
  const [warehouse] = await sql`SELECT id FROM warehouses LIMIT 1`;
  if (!warehouse)
    throw new Error("Chạy db:migrate trên database smoke mới trước");
  await sql`INSERT INTO users(id,name,email,password_hash,role) VALUES(${userId},'Smoke only',${userId + "@example.test"},'unused','admin')`;
  await sql`INSERT INTO data_jobs(id,created_by,route,method,filename,storage_path,file_size,sha256,payload,status,idempotency_key) VALUES(${jobId},${userId},'sources/preview','POST','synthetic-1800.pdf',${"jobs/" + userId + "/" + jobId + "/input"},${bytes.length},${createHash("sha256").update(bytes).digest("hex")},${sql.json({ context: { warehouseId: warehouse.id, shop: "Smoke only", dueDate: "2026-10-23" } })},'queued',${crypto.randomUUID()})`;
  worker = spawn(process.execPath, ["--import", "tsx", "src/worker/main.ts"], {
    detached: true,
    env: {
      ...process.env,
      SUPABASE_URL: `http://127.0.0.1:${address.port}`,
      SUPABASE_ANON_KEY: "fixture-public",
      SUPABASE_SERVICE_ROLE_KEY: "fixture-server",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  worker.stdout?.on("data", (chunk) => {
    logs += chunk;
  });
  worker.stderr?.on("data", (chunk) => {
    logs += chunk;
  });
  const end = Date.now() + 90000;
  while (Date.now() < end) {
    const [job] =
      await sql`SELECT status,result,error FROM data_jobs WHERE id=${jobId}`;
    if (job.status === "failed")
      throw new Error("Smoke job failed: " + job.error + "\n" + logs);
    if (job.status === "succeeded") {
      if (
        job.result.uniqueShipments !== 1800 ||
        job.result.labels.length !== 1800
      )
        throw new Error("Wrong unique shipment count");
      console.log(
        JSON.stringify({
          ok: true,
          bytes: bytes.length,
          uniqueShipments: job.result.uniqueShipments,
          execution:
            "real Node worker + isolated 384 MB heap child + HTTP Storage fixture",
        }),
      );
      break;
    }
    if (worker.exitCode !== null) throw new Error("Worker exited: " + logs);
    if (Date.now() + 1000 >= end)
      throw new Error("Worker smoke timed out: " + logs);
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
} finally {
  if (worker?.pid) {
    worker.kill("SIGTERM");
    const timer = setTimeout(() => {
      try {
        process.kill(-worker!.pid!, "SIGKILL");
      } catch {}
    }, 5000);
    if (worker.exitCode === null) await once(worker, "exit");
    clearTimeout(timer);
  }
  await sql`DELETE FROM data_jobs WHERE id=${jobId}`;
  await sql`DELETE FROM users WHERE id=${userId}`;
  await sql.end({ timeout: 5 });
  await new Promise<void>((resolve) => server.close(() => resolve()));
}
