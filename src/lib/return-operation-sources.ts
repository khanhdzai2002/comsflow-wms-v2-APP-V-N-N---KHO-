import type { Tx, User } from "./db";
import { deriveReturnFacts, type ReturnWorkflow } from "./return-facts";
import type { ReturnFile, ReturnRow } from "./return-table";
import { returnOperationsStatus } from "./return-operations-access";
export async function saveReturnOperationSources(
  tx: Tx,
  _user: User,
  file: ReturnFile,
  cases: Record<string, any>[],
  importId: string,
) {
  if (!(await returnOperationsStatus(tx)).ready) return;
  const groups = new Map<string, ReturnRow[]>();
  for (const row of file.rows) {
    const group = groups.get(row.request) ?? [];
    group.push(row);
    groups.set(row.request, group);
  }
  const workflow =
    (file as ReturnFile & { workflow?: ReturnWorkflow }).workflow ??
    "customer_return";
  const rows = cases.map((c) => ({
    id: c.id,
    ...deriveReturnFacts(c.source_data, workflow),
  }));
  if (!rows.length) return;
  await tx`UPDATE return_cases r SET workflow=x.workflow,obligation=CASE WHEN r.obligation_verified THEN r.obligation ELSE x.obligation END,obligation_conflict=(r.obligation_verified AND x.obligation<>'verify' AND r.obligation<>x.obligation),shipping_state=x.shipping,
  ordered_at=x."orderedAt",cancelled_at=x."cancelledAt",platform_updated_at=x."platformUpdated",approved_at=x."approvedAt",
  source_order_amount=x."orderAmount",source_refund_amount=x."refundAmount",source_refund_paid=coalesce(x."refundPaid",false),source_goods_value=x."goodsValue",source_refund_only=x."refundOnly",source_cancelled=x.cancelled,financial_conflict=x."financialConflict",source_inactive=false
  FROM jsonb_to_recordset(${tx.json(rows)}) AS x(id uuid,workflow text,obligation text,shipping text,"orderedAt" timestamptz,"cancelledAt" timestamptz,"platformUpdated" timestamptz,"approvedAt" timestamptz,"orderAmount" numeric,"refundAmount" numeric,"refundPaid" boolean,"goodsValue" numeric,"refundOnly" boolean,cancelled boolean,"financialConflict" boolean) WHERE r.id=x.id`;
  const resetIds = cases.filter((c) => c.source_was_inactive).map((c) => c.id);
  if (resetIds.length) {
    const sourceItems = cases.flatMap((c) =>
      c.source_data.map((r: ReturnRow) => ({
        case_id: c.id,
        item_key: r.itemKey,
      })),
    );
    const sourceParcels = cases.flatMap((c) =>
      c.source_data
        .filter((r: ReturnRow) => r.tracking)
        .map((r: ReturnRow) => ({ case_id: c.id, tracking_code: r.tracking })),
    );
    await tx`UPDATE return_items i SET active=false WHERE i.case_id IN ${tx(resetIds)} AND NOT EXISTS(SELECT 1 FROM jsonb_to_recordset(${tx.json(sourceItems)}) AS x(case_id uuid,item_key text) WHERE x.case_id=i.case_id AND x.item_key=i.item_key)`;
    await tx`UPDATE return_parcels p SET active=false WHERE p.case_id IN ${tx(resetIds)} AND p.received_at IS NULL AND NOT EXISTS(SELECT 1 FROM jsonb_to_recordset(${tx.json(sourceParcels)}) AS x(case_id uuid,tracking_code text) WHERE x.case_id=p.case_id AND x.tracking_code=p.tracking_code)`;
    await tx`UPDATE return_cases r SET verification_status='source_conflict' WHERE r.id IN ${tx(resetIds)} AND EXISTS(SELECT 1 FROM return_parcels p WHERE p.case_id=r.id AND p.received_at IS NOT NULL AND NOT EXISTS(SELECT 1 FROM jsonb_to_recordset(${tx.json(sourceParcels)}) AS x(case_id uuid,tracking_code text) WHERE x.case_id=p.case_id AND x.tracking_code=p.tracking_code))`;
  }
  const currentTrackings = cases.flatMap((c) =>
    c.source_data
      .filter((r: ReturnRow) => r.tracking)
      .map((r: ReturnRow) => ({ case_id: c.id, tracking_code: r.tracking })),
  );
  await tx`UPDATE return_cases r SET verification_status='source_conflict' WHERE r.id IN ${tx(cases.map((c) => c.id))} AND EXISTS(SELECT 1 FROM return_parcels p WHERE p.case_id=r.id AND p.active AND p.received_at IS NOT NULL AND p.carrier_origin<>'manual' AND NOT EXISTS(SELECT 1 FROM jsonb_to_recordset(${tx.json(currentTrackings)}) AS x(case_id uuid,tracking_code text) WHERE x.case_id=p.case_id AND x.tracking_code=p.tracking_code))`;
  const variants = cases.flatMap((c) =>
    c.source_data.map((r: ReturnRow) => ({
      case_id: c.id,
      item_key: r.itemKey,
      color: r.meta?.color ?? "",
      size: r.meta?.size ?? "",
    })),
  );
  await tx`UPDATE return_items i SET color=x.color,size=x.size FROM jsonb_to_recordset(${tx.json(variants)}) AS x(case_id uuid,item_key text,color text,size text) WHERE i.case_id=x.case_id AND i.item_key=x.item_key`;
  await tx`INSERT INTO return_source_versions(case_id,import_id,rows_data)
 SELECT x.id,${importId},x.rows FROM jsonb_to_recordset(${tx.json(cases.map((c) => ({ id: c.id, rows: groups.get(c.external_id) })))}) AS x(id uuid,rows jsonb) ON CONFLICT DO NOTHING`;
}
