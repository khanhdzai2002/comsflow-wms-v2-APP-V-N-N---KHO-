import { audit, db, type Tx, type User } from "./db";
import { AppError } from "./domain";

type Sql = Tx | ReturnType<typeof db>;
export async function prescanReady(sql: Sql) {
  const [row] =
    await sql`SELECT to_regclass('public.effective_scan_events') IS NOT NULL AS ready`;
  return !!row.ready;
}
export async function requirePrescanSchema(sql: Sql) {
  if (!(await prescanReady(sql)))
    throw new AppError(
      503,
      "Chưa bật đối soát quét trước. Admin mở thông báo nâng cấp 018, sao lưu database và chạy SQL trong đúng project Supabase trước khi nhập file xuất kho.",
    );
}
export async function scanHistoryRelation(sql: Sql) {
  return (await prescanReady(sql)) ? "effective_scan_events" : "scan_events";
}
// Both import paths take the same sorted locks BEFORE locking/inserting shipments.
// This also serializes the otherwise unprotected gap where no shipment exists yet.
export async function lockTrackingCodes(tx: Tx, codes: string[]) {
  if (!codes.length) return;
  await tx`SELECT pg_advisory_xact_lock(hashtextextended(code,742921)) FROM (
    SELECT code FROM (SELECT DISTINCT unnest(${tx.array(codes, 25)}::text[]) AS code) unique_codes ORDER BY code COLLATE "C"
  ) codes`;
}
export async function pendingSourceCount(
  sql: Sql,
  codes: string[],
  warehouse: string,
  carrier: string,
) {
  if (!codes.length || !(await prescanReady(sql))) return 0;
  const [row] =
    await sql`SELECT count(DISTINCT upper(btrim(coalesce(e.response->>'code',e.raw_code))))::int n
    FROM scan_events e LEFT JOIN scan_reconciliations r ON r.scan_event_id=e.id
    WHERE e.outcome='unknown' AND e.shipment_id IS NULL AND r.scan_event_id IS NULL
    AND upper(btrim(coalesce(e.response->>'code',e.raw_code))) IN ${sql(codes)}
    AND e.warehouse_id=${warehouse} AND coalesce(e.request_payload->>'carrierId','') IN ('',${carrier})`;
  return row.n as number;
}
export async function reconcilePrescans(tx: Tx, user: User, codes: string[]) {
  await requirePrescanSchema(tx);
  if (!codes.length) return { matched: 0, duplicates: 0 };
  // Callers already hold tracking locks and shipment row locks. Existing successful
  // scans are never overwritten. A closed shift remains valid historical evidence.
  const rows =
    await tx`SELECT e.id,e.created_at,e.user_id,e.shift_id,s.id shipment_id,s.scanned_at,
    row_number() OVER(PARTITION BY s.id ORDER BY e.created_at,e.id) position
    FROM shipments s JOIN scan_events e ON upper(btrim(coalesce(e.response->>'code',e.raw_code)))=s.tracking_code
    LEFT JOIN scan_reconciliations r ON r.scan_event_id=e.id
    WHERE s.tracking_code IN ${tx(codes)} AND e.outcome='unknown' AND e.shipment_id IS NULL
    AND r.scan_event_id IS NULL AND e.warehouse_id=s.warehouse_id
    AND coalesce(e.request_payload->>'carrierId','') IN ('',s.carrier_id::text)
    AND (s.status IN ('pending','awaiting_scan') OR (s.scanned_at IS NOT NULL AND s.status IN ('scanned','awaiting_handover','handed_over')))`;
  if (!rows.length) return { matched: 0, duplicates: 0 };
  const matches = rows.map((r) => ({
    scan_event_id: r.id,
    shipment_id: r.shipment_id,
    outcome:
      !r.scanned_at && Number(r.position) === 1 ? "success" : "duplicate",
    reconciled_by: user.id,
  }));
  const first = rows.filter((r) => !r.scanned_at && Number(r.position) === 1);
  if (first.length)
    await tx`UPDATE shipments s SET status='scanned',scanned_at=p.at,scanned_by=p.actor,shift_id=p.shift,updated_at=now()
    FROM jsonb_to_recordset(${tx.json(first.map((r) => ({ id: r.shipment_id, at: r.created_at, actor: r.user_id, shift: r.shift_id })))}) AS p(id uuid,at timestamptz,actor uuid,shift uuid)
    WHERE s.id=p.id AND s.scanned_at IS NULL`;
  await tx`INSERT INTO scan_reconciliations ${tx(matches, "scan_event_id", "shipment_id", "outcome", "reconciled_by")}`;
  await tx`UPDATE exception_cases x SET status='resolved',shipment_id=r.shipment_id,resolved_at=clock_timestamp(),resolved_by=${user.id},
    reason='Tự đối soát mã quét trước với file nguồn; giữ nguyên lượt quét gốc'
    FROM scan_reconciliations r WHERE x.scan_event_id=r.scan_event_id AND x.scan_event_id IN ${tx(rows.map((r) => r.id))} AND x.status='open' AND x.kind='unknown'`;
  await audit(
    tx,
    user,
    "prescan_reconcile",
    crypto.randomUUID(),
    null,
    matches,
    "Đối soát hai chiều khi nhập nguồn; giữ thời gian, người quét và ca gốc; không xác nhận bàn giao",
  );
  return { matched: first.length, duplicates: matches.length - first.length };
}
