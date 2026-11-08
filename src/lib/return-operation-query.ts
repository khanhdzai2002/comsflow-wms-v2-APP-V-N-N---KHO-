export { operationStates } from "./return-operation-labels";
import { z } from "zod";
import { db, type User } from "./db";
import { AppError } from "./domain";
import { requireReturnOperations } from "./return-operations-access";
export const operationFilters = z.object({
  workflow: z.enum(["", "customer_return", "delivery_failed"]).default(""),
  q: z.string().max(2000).default(""),
  warehouse: z.union([z.uuid(), z.literal("")]).default(""),
  shop: z.string().max(100).default(""),
  channel: z.string().max(100).default(""),
  carrier: z.string().max(100).default(""),
  state: z.string().max(50).default(""),
  employee: z.union([z.uuid(), z.literal("")]).default(""),
  reason: z.string().max(50).default(""),
  claim: z.enum(["", "open", "resolved"]).default(""),
  from: z.preprocess(
    (v) => (v === "" ? undefined : v),
    z.iso.date().optional(),
  ),
  to: z.preprocess((v) => (v === "" ? undefined : v), z.iso.date().optional()),
  dateType: z
    .enum(["requested", "ordered", "cancelled", "received", "imported"])
    .default("requested"),
  sort: z.enum(["date", "carrier", "value", "overdue"]).default("date"),
  direction: z.enum(["asc", "desc"]).default("desc"),
  page: z.coerce.number().int().min(1).max(1000000).default(1),
  archived: z
    .union([z.boolean(), z.enum(["true", "false", "1", "0"])])
    .transform((v) => v === true || v === "true" || v === "1")
    .default(false),
});
export type OperationFilters = z.infer<typeof operationFilters>;
export function operationWhere(user: User, f: OperationFilters) {
  const sql = db();
  if (f.from && f.to && f.from > f.to)
    throw new AppError(400, "Ngày bắt đầu phải trước ngày kết thúc");
  const date =
    f.dateType === "ordered"
      ? sql`r.ordered_at`
      : f.dateType === "cancelled"
        ? sql`r.cancelled_at`
        : f.dateType === "received"
          ? sql`coalesce(r.last_receipt_at,r.last_received_at)`
          : f.dateType === "imported"
            ? sql`(SELECT created_at FROM return_imports WHERE id=r.last_import_id)`
            : sql`r.requested_at`;
  const state = f.state.startsWith("primary:")
    ? sql`r.primary_state=${f.state.slice(8)}`
    : f.state === "cancelled"
      ? sql`r.source_cancelled`
      : f.state === "not_required"
        ? sql`r.no_return_required`
        : f.state === "compensation"
          ? sql`r.received_compensation>0`
          : f.state === "required"
            ? sql`r.obligation='required' AND NOT r.no_return_required`
            : f.state === "received"
              ? sql`r.has_receipt`
              : f.state === "unreceived"
                ? sql`NOT r.has_receipt AND NOT r.no_return_required`
                : f.state === "needs_check"
                  ? sql`r.primary_state IN ('needs_check','suspected_lost','lost')`
                  : f.state === "inspected"
                    ? sql`r.inspection_status<>'pending' AND NOT r.inspection_stale AND NOT r.inspection_partial`
                    : f.state === "goods_problem"
                      ? sql`r.has_goods_problem`
                      : f.state === "received_full"
                        ? sql`r.received_full`
                        : f.state === "received_short"
                          ? sql`r.has_receipt AND r.quantity_known AND r.received_quantity<r.expected_quantity`
                          : f.state === "refund_only"
                            ? sql`r.source_refund_only`
                            : f.state === "refund_missing"
                              ? sql`r.source_refund_paid AND r.source_refund_amount>0 AND NOT r.has_receipt AND NOT r.no_return_required`
                              : f.state === "claims"
                                ? sql`r.open_claims>0`
                                : f.state === "overdue"
                                  ? sql`r.overdue`
                                  : f.state
                                    ? sql`r.primary_state=${f.state}`
                                    : sql`true`;
  return sql`(${f.archived} OR NOT r.source_inactive)
 AND (${!f.workflow} OR r.workflow=${f.workflow}) AND (${!f.warehouse} OR r.warehouse_id=${f.warehouse || null}::uuid)
 AND (${!f.shop} OR r.shop=${f.shop}) AND (${!f.channel} OR r.channel=${f.channel})
 AND (${!f.carrier} OR r.carrier_key=${f.carrier}) AND (${!f.employee} OR EXISTS(SELECT 1 FROM return_receipts x WHERE x.case_id=r.id AND x.recorded_by=${f.employee || null}::uuid))
 AND (${!f.from} OR ${date}>=(${f.from ?? null}::date::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh'))
 AND (${!f.to} OR ${date}<((${f.to ?? null}::date+1)::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh'))
 AND (${!f.reason} OR r.reason_group=${f.reason})
 AND (${!f.q} OR r.external_id=${f.q} OR r.order_code=${f.q} OR r.tracking_codes ILIKE ${"%" + f.q + "%"} OR r.external_id ILIKE ${"%" + f.q + "%"} OR r.order_code ILIKE ${"%" + f.q + "%"})
 AND (${f.claim !== "open"} OR r.open_claims>0) AND (${f.claim !== "resolved"} OR r.resolved_claims>0)
 AND (${user.role !== "staff"} OR r.assigned_to=${user.id} OR EXISTS(SELECT 1 FROM return_receipts own WHERE own.case_id=r.id AND own.recorded_by=${user.id}) OR EXISTS(SELECT 1 FROM return_parcels own WHERE own.case_id=r.id AND own.received_by=${user.id})) AND ${state}`;
}
export async function returnOperationList(user: User, raw: unknown) {
  await requireReturnOperations();
  const f = operationFilters.parse(raw),
    sql = db(),
    where = operationWhere(user, f);
  const sort = {
    date: "requested_at",
    carrier: "carrier",
    value: "goods_value",
    overdue: "expected_at",
  }[f.sort];
  return sql.begin("isolation level repeatable read read only", async (tx) => {
    await tx`SET LOCAL jit=off`;
    const [count] =
      await tx`SELECT count(*)::int total FROM return_operation_rows r WHERE ${where}`;
    const rows =
      await tx`SELECT r.id,r.external_id,r.order_code,r.workflow,r.shop,r.channel,r.warehouse,r.carrier,r.carrier_key,r.tracking_codes,r.requested_at,r.ordered_at,r.cancelled_at,r.platform_status,r.platform_substatus,r.obligation,r.shipping_state,r.primary_state,r.has_receipt,r.received_full,r.quantity_known,r.received_quantity,r.expected_quantity,r.parcels,r.received_parcels,r.inspection_status,r.inspection_stale,r.inspection_partial,r.has_goods_problem,r.goods_value,r.source_order_amount,r.source_refund_amount,r.source_refund_only,r.financial_conflict,r.open_claims,r.resolved_claims,r.received_compensation,r.overdue,r.expected_at,r.version,r.assigned_employee,r.verification_status,r.verification_result,r.source_inactive FROM return_operation_rows r WHERE ${where}
   ORDER BY ${tx("r." + sort)} ${f.direction === "asc" ? tx`ASC` : tx`DESC`} NULLS LAST,r.id LIMIT 50 OFFSET ${(f.page - 1) * 50}`;
    return { rows, total: count.total, page: f.page, pageSize: 50 };
  });
}
export async function returnOperationOverview(user: User, raw: unknown) {
  await requireReturnOperations();
  const f = operationFilters.parse(raw),
    sql = db(),
    where = operationWhere(user, f);
  return sql.begin("isolation level repeatable read read only", async (tx) => {
    await tx`SET LOCAL jit=off`;
    const [result] =
      await tx`WITH selected AS (SELECT r.id,r.obligation,r.no_return_required,r.source_cancelled,r.has_receipt,r.primary_state,r.source_refund_only,r.open_claims,r.resolved_claims,r.received_full,r.quantity_known,r.received_quantity,r.expected_quantity,r.inspection_status,r.inspection_stale,r.inspection_partial,r.has_goods_problem,r.overdue,r.source_refund_amount,r.source_refund_paid,r.goods_value,r.received_compensation,r.carrier_key,r.carrier,r.requested_at FROM return_operation_rows r WHERE ${where}),
 totals AS(SELECT count(*)::int total,count(*) FILTER(WHERE obligation='required' AND NOT no_return_required)::int required,
  count(*) FILTER(WHERE source_cancelled)::int cancelled,count(*) FILTER(WHERE has_receipt)::int received,
  count(*) FILTER(WHERE primary_state IN ('needs_check','suspected_lost','lost'))::int needs_check,
  count(*) FILTER(WHERE primary_state='in_transit')::int in_transit,
  count(*) FILTER(WHERE primary_state='suspected_lost')::int suspected_lost,count(*) FILTER(WHERE primary_state='lost')::int lost,
  count(*) FILTER(WHERE source_refund_only)::int refund_only,count(*) FILTER(WHERE no_return_required)::int not_required,
  count(*) FILTER(WHERE primary_state='verify')::int verify,count(*) FILTER(WHERE open_claims>0)::int claims,
  count(*) FILTER(WHERE received_full)::int received_full,count(*) FILTER(WHERE has_receipt AND quantity_known AND received_quantity<expected_quantity)::int received_short,
  count(*) FILTER(WHERE inspection_status<>'pending' AND NOT inspection_stale AND NOT inspection_partial)::int inspected,
  count(*) FILTER(WHERE has_goods_problem)::int goods_problem,count(*) FILTER(WHERE overdue)::int overdue,
  count(*) FILTER(WHERE source_refund_paid AND source_refund_amount>0 AND NOT has_receipt AND NOT no_return_required)::int refund_missing,
  sum(goods_value) FILTER(WHERE primary_state IN ('needs_check','suspected_lost','lost'))::text check_value,
  count(*) FILTER(WHERE primary_state IN ('needs_check','suspected_lost','lost') AND goods_value IS NULL)::int unknown_check_value,
  count(*) FILTER(WHERE has_goods_problem AND goods_value IS NULL)::int unknown_problem_value,
  sum(goods_value) FILTER(WHERE has_goods_problem)::text problem_value,sum(source_refund_amount) FILTER(WHERE source_refund_paid)::text refund_amount,
  coalesce(sum(received_compensation),0)::text compensation,coalesce(sum(expected_quantity),0)::bigint quantity FROM selected),
 carriers AS(SELECT carrier_key,carrier,count(*)::int total,count(*) FILTER(WHERE obligation='required' AND NOT no_return_required)::int required,
  count(*) FILTER(WHERE has_receipt)::int received,count(*) FILTER(WHERE primary_state='received')::int chart_received,count(*) FILTER(WHERE primary_state NOT IN ('received','needs_check','suspected_lost','lost','in_transit'))::int chart_other,count(*) FILTER(WHERE primary_state IN ('needs_check','suspected_lost','lost'))::int needs_check,
  count(*) FILTER(WHERE primary_state='in_transit')::int in_transit,count(*) FILTER(WHERE primary_state='suspected_lost')::int suspected_lost,
  count(*) FILTER(WHERE overdue)::int overdue,count(*) FILTER(WHERE open_claims>0)::int claims,count(*) FILTER(WHERE resolved_claims>0)::int resolved_claims,
  sum(goods_value) FILTER(WHERE primary_state IN ('needs_check','suspected_lost','lost'))::text check_value FROM selected GROUP BY carrier_key,carrier),
 days AS(SELECT to_char(requested_at AT TIME ZONE 'Asia/Ho_Chi_Minh','YYYY-MM-DD') AS "day",count(*)::int total FROM selected GROUP BY 1),
 groups AS(SELECT primary_state,count(*)::int total FROM selected GROUP BY primary_state),
 claim_months AS(SELECT to_char(c.opened_at AT TIME ZONE 'Asia/Ho_Chi_Minh','YYYY-MM') AS "month",c.status,count(*)::int total FROM return_claims c JOIN selected s ON s.id=c.case_id GROUP BY 1,c.status),
 issues AS(SELECT coalesce(nullif(i.seller_sku,''),i.sku_id) sku,max(i.name) name,count(DISTINCT i.case_id)::int requests,
  count(DISTINCT i.case_id) FILTER(WHERE i.quality_condition IS NOT NULL AND i.quality_condition<>'full' OR (s.quantity_known AND i.received_qty<i.expected_qty))::int problems,sum(i.expected_qty)::bigint quantity FROM return_items i JOIN selected s ON s.id=i.case_id WHERE i.active GROUP BY coalesce(nullif(i.seller_sku,''),i.sku_id) ORDER BY problems DESC,requests DESC LIMIT 30)
 SELECT jsonb_build_object('totals',(SELECT to_jsonb(t) FROM totals t),'carriers',coalesce((SELECT jsonb_agg(c ORDER BY needs_check DESC,carrier) FROM carriers c),'[]'::jsonb),
  'days',coalesce((SELECT jsonb_agg(d ORDER BY "day") FROM days d),'[]'::jsonb),'states',coalesce((SELECT jsonb_agg(g) FROM groups g),'[]'::jsonb),
  'claimMonths',coalesce((SELECT jsonb_agg(c ORDER BY "month",status) FROM claim_months c),'[]'::jsonb),'products',coalesce((SELECT jsonb_agg(i) FROM issues i),'[]'::jsonb)) data`;
    return result.data;
  });
}
export async function returnReceiptList(user: User, raw: unknown) {
  await requireReturnOperations();
  const f = z
      .object({
        ...operationFilters.shape,
        state: z
          .enum(["", "unmatched", "ambiguous", "conflict", "matched"])
          .default(""),
      })
      .parse(raw),
    sql = db();
  if (f.from && f.to && f.from > f.to)
    throw new AppError(400, "Ngày bắt đầu phải trước ngày kết thúc");
  const where = sql`(${!f.q} OR r.tracking_code ILIKE ${"%" + f.q + "%"} OR r.order_code ILIKE ${"%" + f.q + "%"}) AND (${!f.state} OR r.match_state=${f.state}) AND (${!f.warehouse} OR r.warehouse_id=${f.warehouse || null}::uuid) AND (${user.role !== "staff"} OR r.recorded_by=${user.id})
 AND (${!f.employee} OR r.recorded_by=${f.employee || null}::uuid)
 AND (${!f.carrier} OR (${f.carrier === "unknown"} AND r.carrier_id IS NULL) OR (${f.carrier === "no_tracking"} AND r.tracking_code='') OR r.carrier_id::text=${f.carrier})
 AND (${!f.workflow} OR rc.workflow=${f.workflow})
 AND (${!f.from} OR r.received_at>=(${f.from ?? null}::date::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh'))
 AND (${!f.to} OR r.received_at<((${f.to ?? null}::date+1)::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh'))
 AND (${!f.claim} OR EXISTS(SELECT 1 FROM return_claims cl WHERE cl.case_id=r.case_id AND ${f.claim === "open" ? sql`cl.status IN ('open','submitted','won')` : sql`cl.status IN ('paid','closed','lost')`}))`;
  return sql.begin("isolation level repeatable read read only", async (tx) => {
    const [count] =
      await tx`SELECT count(*)::int total FROM return_receipts r LEFT JOIN return_cases rc ON rc.id=r.case_id WHERE ${where}`;
    const rows =
      await tx`SELECT r.*,u.name employee,c.name carrier,w.name warehouse,coalesce(rc.source_inactive,false) source_archived FROM return_receipts r JOIN users u ON u.id=r.recorded_by JOIN warehouses w ON w.id=r.warehouse_id LEFT JOIN shipping_carriers c ON c.id=r.carrier_id LEFT JOIN return_cases rc ON rc.id=r.case_id WHERE ${where} ORDER BY r.received_at DESC,r.id LIMIT 50 OFFSET ${(f.page - 1) * 50}`;
    return { rows, total: count.total, page: f.page };
  });
}
