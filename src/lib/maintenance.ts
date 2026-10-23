import { createHash } from "node:crypto";
import { z } from "zod";
import { db, audit, type Tx, type User } from "./db";
import { AppError, requireRole, todayVN } from "./domain";
import {
  CLEANUP_BATCH_LIMIT,
  CLEANUP_CONFIRMATION,
} from "./maintenance-domain";

const filtersSchema = z.object({
  kind: z.enum(["scans", "returns"]),
  before: z.iso.date(),
  warehouse: z.union([z.uuid(), z.literal("")]).default(""),
});
type Filters = z.infer<typeof filtersSchema>;
function filters(raw: unknown) {
  const f = filtersSchema.parse(raw);
  if (f.before > todayVN())
    throw new AppError(
      400,
      "Chỉ dọn dữ liệu trước một ngày đã qua hoặc hôm nay",
    );
  return f;
}
const boundary = (f: Filters) => `${f.before}T00:00:00+07:00`;

function candidates(sql: Tx, f: Filters, ids?: string[]) {
  const before = boundary(f);
  if (f.kind === "scans")
    return sql`
    SELECT e.id,e.created_at,e.warehouse_id,w.name warehouse,e.raw_code code,e.outcome,
      e.request_id,e.shipment_id,s.status,s.scanned_at,s.handed_at,s.updated_at,
      (s.id IS NULL OR (s.status IN ('handed_over','cancelled') AND s.updated_at<${before}::timestamptz))
      AND NOT EXISTS(SELECT 1 FROM exception_cases x WHERE
        (x.scan_event_id=e.id OR (e.shipment_id IS NOT NULL AND x.shipment_id=e.shipment_id))
        AND (x.status<>'resolved' OR x.created_at>=${before}::timestamptz OR x.resolved_at>=${before}::timestamptz))
      AND NOT EXISTS(SELECT 1 FROM exception_cases x WHERE x.scan_event_id=e.id AND x.shipment_id IS DISTINCT FROM e.shipment_id)
      AS eligible
    FROM scan_events e JOIN warehouses w ON w.id=e.warehouse_id LEFT JOIN shipments s ON s.id=e.shipment_id
    WHERE e.created_at<${before}::timestamptz AND (${!f.warehouse} OR e.warehouse_id=${f.warehouse || null}::uuid)
      AND ${ids ? sql`e.id IN ${sql(ids)}` : sql`true`}`;
  return sql`
    SELECT r.id,r.requested_at created_at,r.warehouse_id,w.name warehouse,r.external_id code,r.order_code,
      r.processing_status status,r.inspection_status,r.inspection_stale,r.version,r.updated_at,r.last_import_id,r.source_hash,
      r.processing_status IN ('completed','compensated','closed_unsuccessful') AND NOT r.inspection_stale
      AND r.updated_at<${before}::timestamptz AND i.created_at<${before}::timestamptz
      AND NOT EXISTS(SELECT 1 FROM return_claims c WHERE c.case_id=r.id AND (c.status IN ('open','submitted','won') OR c.updated_at>=${before}::timestamptz))
      AND NOT EXISTS(SELECT 1 FROM return_events e WHERE e.case_id=r.id AND e.created_at>=${before}::timestamptz)
      AND NOT EXISTS(SELECT 1 FROM return_evidence e WHERE e.case_id=r.id AND e.created_at>=${before}::timestamptz)
      AND NOT EXISTS(SELECT 1 FROM return_parcels p WHERE p.case_id=r.id AND p.received_at>=${before}::timestamptz)
      AND NOT EXISTS(SELECT 1 FROM return_events e JOIN return_parcels p ON p.id=e.parcel_id WHERE p.case_id=r.id AND e.case_id IS DISTINCT FROM r.id)
      AND NOT EXISTS(SELECT 1 FROM return_events e JOIN return_parcels p ON p.id=e.parcel_id WHERE e.case_id=r.id AND p.case_id<>r.id)
      AS eligible
    FROM return_cases r JOIN warehouses w ON w.id=r.warehouse_id JOIN return_imports i ON i.id=r.last_import_id
    WHERE r.requested_at<${before}::timestamptz AND (${!f.warehouse} OR r.warehouse_id=${f.warehouse || null}::uuid)
      AND ${ids ? sql`r.id IN ${sql(ids)}` : sql`true`}`;
}

async function capture(sql: Tx, f: Filters, ids: string[]) {
  if (!ids.length)
    return {
      rows: [] as any[],
      counts: {} as Record<string, number>,
      estimatedBytes: 0,
      evidenceBytes: 0,
      fingerprint: "empty",
    };
  const rows =
    await sql`SELECT * FROM (${candidates(sql, f, ids)}) c ORDER BY id`;
  if (rows.length !== ids.length || rows.some((r) => !r.eligible))
    throw new AppError(
      409,
      "Dữ liệu hoặc trạng thái đã thay đổi. Lần này chưa thực hiện xoá; hãy xem trước lại.",
    );
  const graphs: any[] = [];
  const counts: Record<string, number> = {};
  let estimatedBytes = 0,
    evidenceBytes = 0;
  if (f.kind === "scans") {
    const [events] =
      await sql`SELECT count(*)::int n,coalesce(sum(pg_column_size(e)),0)::float8 bytes FROM scan_events e WHERE id IN ${sql(ids)}`;
    const [exceptions] =
      await sql`SELECT count(*)::int n,coalesce(sum(pg_column_size(x)),0)::float8 bytes,
      md5(coalesce(string_agg(md5(x::text),',' ORDER BY x.id),'')) signature FROM exception_cases x
      WHERE x.scan_event_id IN ${sql(ids)}`;
    counts.scans = events.n;
    counts.exceptions = exceptions.n;
    estimatedBytes = events.bytes + exceptions.bytes;
    graphs.push(exceptions.signature);
  } else {
    const [parents] =
      await sql`SELECT coalesce(sum(pg_column_size(r)),0)::float8 bytes FROM return_cases r WHERE id IN ${sql(ids)}`;
    estimatedBytes += parents.bytes;
    for (const table of [
      "return_items",
      "return_parcels",
      "return_claims",
      "return_events",
      "return_import_changes",
    ]) {
      const [g] =
        await sql`SELECT count(*)::int n,coalesce(sum(pg_column_size(t)),0)::float8 bytes,
        md5(coalesce(string_agg(md5(t::text),',' ORDER BY t.id),'')) signature FROM ${sql(table)} t WHERE t.case_id IN ${sql(ids)}`;
      graphs.push(g.signature);
      counts[table] = g.n;
      estimatedBytes += g.bytes;
    }
    const [snapshots] =
      await sql`SELECT count(*)::int n,coalesce(sum(pg_column_size(t)),0)::float8 bytes,
      md5(coalesce(string_agg(t.import_id::text||':'||t.row_number::text,',' ORDER BY t.import_id,t.row_number),'')) signature
      FROM return_snapshots t WHERE t.case_id IN ${sql(ids)}`;
    const [evidence] =
      await sql`SELECT count(*)::int n,coalesce(sum(octet_length(t.bytes)),0)::float8 bytes,
      md5(coalesce(string_agg(t.id::text,',' ORDER BY t.id),'')) signature FROM return_evidence t WHERE t.case_id IN ${sql(ids)}`;
    graphs.push(snapshots.signature, evidence.signature);
    counts.cases = rows.length;
    counts.snapshots = snapshots.n;
    counts.evidence = evidence.n;
    estimatedBytes += snapshots.bytes + evidence.bytes;
    evidenceBytes = evidence.bytes;
  }
  return {
    rows,
    counts,
    estimatedBytes,
    evidenceBytes,
    fingerprint: createHash("sha256")
      .update(JSON.stringify([rows, graphs]))
      .digest("hex"),
  };
}

export async function previewCleanup(user: User, raw: unknown) {
  requireRole(user, ["admin"]);
  const f = filters(raw);
  await db()`DELETE FROM maintenance_jobs WHERE state='preview' AND expires_at<now()`;
  return db().begin("isolation level repeatable read", async (tx) => {
    if (
      f.warehouse &&
      !(await tx`SELECT id FROM warehouses WHERE id=${f.warehouse}`).length
    )
      throw new AppError(400, "Kho không tồn tại");
    const [totals] =
      await tx`SELECT count(*)::int total,count(*) FILTER(WHERE eligible)::int eligible FROM (${candidates(tx, f)}) c`;
    const chosen =
      await tx`SELECT id FROM (${candidates(tx, f)}) c WHERE eligible ORDER BY created_at,id LIMIT ${CLEANUP_BATCH_LIMIT}`;
    const targets = chosen.map((r) => r.id as string);
    const snapshot = await capture(tx, f, targets);
    const summary = {
      selected: targets.length,
      eligible: totals.eligible,
      protected: totals.total - totals.eligible,
      hasMore: totals.eligible > targets.length,
      counts: snapshot.counts,
      estimatedBytes: snapshot.estimatedBytes,
      evidenceBytes: snapshot.evidenceBytes,
    };
    const [job] =
      await tx`INSERT INTO maintenance_jobs(created_by,kind,before_date,warehouse_id,targets,fingerprint,summary)
      VALUES(${user.id},${f.kind},${f.before},${f.warehouse || null},${tx.json(targets)},${snapshot.fingerprint},${tx.json(summary)}) RETURNING id,expires_at`;
    return {
      id: job.id as string,
      expires_at: job.expires_at as Date,
      ...f,
      summary,
      rows: snapshot.rows.slice(0, 50),
    };
  });
}

async function jobFor(sql: Tx, user: User, id: string, lock = false) {
  const [job] =
    await sql`SELECT *,before_date::text before FROM maintenance_jobs WHERE id=${id} ${lock ? sql`FOR UPDATE` : sql``}`;
  if (!job)
    throw new AppError(404, "Không tìm thấy lần xem trước; hãy kiểm tra lại");
  if (job.created_by !== user.id)
    throw new AppError(403, "Lần xem trước thuộc tài khoản khác");
  if (
    job.state !== "completed" &&
    new Date(job.expires_at).getTime() <= Date.now()
  )
    throw new AppError(
      410,
      "Lần xem trước đã hết hạn 30 phút. Hãy kiểm tra lại",
    );
  return job;
}

export async function cleanupExport(user: User, id: string) {
  requireRole(user, ["admin"]);
  z.uuid().parse(id);
  return db().begin("isolation level repeatable read read only", async (tx) => {
    const job = await jobFor(tx, user, id);
    if (job.state !== "preview")
      throw new AppError(
        409,
        "Danh sách đã được xử lý. Hãy tạo lần xem trước mới",
      );
    const snapshot = await capture(
      tx,
      filters({
        kind: job.kind,
        before: job.before,
        warehouse: job.warehouse_id ?? "",
      }),
      job.targets,
    );
    if (snapshot.fingerprint !== job.fingerprint)
      throw new AppError(409, "Dữ liệu đã thay đổi. Hãy xem trước lại");
    return snapshot.rows.map((r) => ({
      "Mã bản ghi": r.id,
      "Mã vận đơn / yêu cầu": r.code,
      "Mã đơn gốc": r.order_code ?? "",
      Kho: r.warehouse,
      "Thời điểm": r.created_at,
      "Trạng thái": r.status ?? r.outcome,
      "Phạm vi":
        "Danh sách dự kiến xoá; không bao gồm ảnh/PDF hay toàn bộ dữ liệu gốc",
    }));
  });
}

export async function executeCleanup(user: User, raw: unknown) {
  requireRole(user, ["admin"]);
  const d = z
    .object({
      jobId: z.uuid(),
      confirmation: z.literal(CLEANUP_CONFIRMATION),
      acknowledge: z.literal(true),
      reason: z.string().trim().min(8).max(1000),
    })
    .parse(raw);
  return db().begin(async (tx) => {
    await tx`SET LOCAL lock_timeout='3s'`;
    await tx`SET LOCAL statement_timeout='60s'`;
    await tx`SELECT pg_advisory_xact_lock(742921)`;
    if (
      !(
        await tx`SELECT id FROM users WHERE id=${user.id} AND active AND role='admin' FOR SHARE`
      ).length
    )
      throw new AppError(403, "Tài khoản không còn quyền Quản trị viên");
    const job = await jobFor(tx, user, d.jobId, true);
    if (job.state === "completed") return { ...job.result, reused: true };
    if (job.state !== "preview")
      throw new AppError(409, "Lần dọn đang được xử lý");
    const ids = job.targets as string[];
    if (!ids.length)
      throw new AppError(400, "Không có dữ liệu đủ điều kiện để xoá");
    const f = filters({
      kind: job.kind,
      before: job.before,
      warehouse: job.warehouse_id ?? "",
    });
    if (f.kind === "returns") {
      await tx`SELECT pg_advisory_xact_lock(742920)`;
      await tx`SELECT id FROM return_cases WHERE id IN ${tx(ids)} ORDER BY id FOR UPDATE`;
      await tx`SELECT id FROM return_parcels WHERE case_id IN ${tx(ids)} ORDER BY id FOR UPDATE`;
    } else {
      await tx`SELECT id FROM shipments WHERE id IN (SELECT shipment_id FROM scan_events WHERE id IN ${tx(ids)}) ORDER BY id FOR UPDATE`;
      await tx`SELECT id FROM scan_events WHERE id IN ${tx(ids)} ORDER BY id FOR UPDATE`;
      await tx`SELECT id FROM exception_cases WHERE scan_event_id IN ${tx(ids)} ORDER BY id FOR UPDATE`;
    }
    const snapshot = await capture(tx, f, ids);
    if (snapshot.fingerprint !== job.fingerprint)
      throw new AppError(
        409,
        "Dữ liệu thay đổi sau khi xem trước. Chưa xoá; hãy kiểm tra lại",
      );
    await tx`UPDATE maintenance_jobs SET state='running',executing_xid=txid_current() WHERE id=${job.id}`;
    await tx`SELECT set_config('comsflow.cleanup_job',${job.id},true)`;
    if (f.kind === "scans") {
      await tx`INSERT INTO retired_requests(kind,request_id,job_id) SELECT 'scans',request_id,${job.id} FROM scan_events WHERE id IN ${tx(ids)} ON CONFLICT DO NOTHING`;
      await tx`DELETE FROM exception_cases WHERE scan_event_id IN ${tx(ids)}`;
      await tx`DELETE FROM scan_events WHERE id IN ${tx(ids)}`;
    } else {
      await tx`INSERT INTO retired_return_cases(shop_id,external_id,job_id) SELECT shop_id,external_id,${job.id} FROM return_cases WHERE id IN ${tx(ids)} ON CONFLICT DO NOTHING`;
      await tx`INSERT INTO retired_requests(kind,request_id,job_id) SELECT 'returns',request_id,${job.id} FROM return_events WHERE case_id IN ${tx(ids)} AND request_id IS NOT NULL ON CONFLICT DO NOTHING`;
      await tx`INSERT INTO return_import_purges(import_id,purged_rows,job_id)
        SELECT import_id,count(*)::int,${job.id} FROM return_snapshots WHERE case_id IN ${tx(ids)} GROUP BY import_id
        ON CONFLICT(import_id) DO UPDATE SET purged_rows=return_import_purges.purged_rows+excluded.purged_rows,job_id=excluded.job_id`;
      await tx`DELETE FROM return_evidence WHERE case_id IN ${tx(ids)}`;
      await tx`DELETE FROM return_events WHERE case_id IN ${tx(ids)}`;
      await tx`DELETE FROM return_snapshots WHERE case_id IN ${tx(ids)}`;
      await tx`DELETE FROM return_claims WHERE case_id IN ${tx(ids)}`;
      await tx`DELETE FROM return_parcels WHERE case_id IN ${tx(ids)}`;
      await tx`DELETE FROM return_items WHERE case_id IN ${tx(ids)}`;
      await tx`DELETE FROM return_cases WHERE id IN ${tx(ids)}`;
    }
    const result = {
      id: job.id,
      kind: f.kind,
      before: f.before,
      deleted: ids.length,
      counts: snapshot.counts,
      estimatedBytes: snapshot.estimatedBytes,
      evidenceBytes: snapshot.evidenceBytes,
      completedAt: new Date().toISOString(),
    };
    await audit(
      tx,
      user,
      "data_cleanup",
      job.id,
      job.summary,
      result,
      d.reason,
    );
    await tx`UPDATE maintenance_jobs SET state='completed',targets='[]',executing_xid=NULL,result=${tx.json(result)},completed_at=clock_timestamp() WHERE id=${job.id}`;
    return { ...result, reused: false };
  });
}

export async function storageInfo(user: User) {
  requireRole(user, ["admin"]);
  const sql = db();
  const [size] =
    await sql`SELECT pg_database_size(current_database())::float8 database_bytes,
    (SELECT coalesce(sum(octet_length(bytes)),0)::float8 FROM return_evidence) evidence_bytes,
    (SELECT count(*)::int FROM scan_events) scans,(SELECT count(*)::int FROM return_cases) returns`;
  const history =
    await sql`SELECT j.id,j.kind,j.before_date::text before,j.result,j.completed_at,u.name employee,w.name warehouse,a.reason
    FROM maintenance_jobs j JOIN users u ON u.id=j.created_by LEFT JOIN warehouses w ON w.id=j.warehouse_id
    LEFT JOIN audit_logs a ON a.action='data_cleanup' AND a.entity_id=j.id::text WHERE j.state='completed' ORDER BY j.completed_at DESC LIMIT 20`;
  return {
    database_bytes: Number(size.database_bytes),
    evidence_bytes: Number(size.evidence_bytes),
    scans: Number(size.scans),
    returns: Number(size.returns),
    history,
  };
}

export async function optimizeStorage(user: User) {
  requireRole(user, ["admin"]);
  const connection = await db().reserve();
  let held = false;
  try {
    held = (await connection`SELECT pg_try_advisory_lock(742922) held`)[0].held;
    if (!held) throw new AppError(409, "Một lần tối ưu khác đang chạy");
    await connection.unsafe("SET lock_timeout='3s'");
    await connection.unsafe("SET statement_timeout='120s'");
    await connection.unsafe(
      "VACUUM (ANALYZE) scan_events, exception_cases, return_cases, return_items, return_parcels, return_events, return_claims, return_snapshots, return_evidence, return_import_changes, return_upload_attempts, maintenance_jobs",
    );
    await db().begin((tx) =>
      audit(
        tx,
        user,
        "storage_optimize",
        "database",
        null,
        { method: "VACUUM ANALYZE" },
        "Tối ưu vùng trống để PostgreSQL tái sử dụng; không chạy VACUUM FULL",
      ),
    );
    return { ok: true };
  } finally {
    try {
      await connection.unsafe("RESET lock_timeout");
      await connection.unsafe("RESET statement_timeout");
      if (held) await connection`SELECT pg_advisory_unlock(742922)`;
    } finally {
      await connection.release();
    }
  }
}
