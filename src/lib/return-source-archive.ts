import { z } from "zod";
import { db, audit, type User } from "./db";
import { AppError, requireRole } from "./domain";
import { deriveReturnFacts } from "./return-facts";
import { mergeReturnSource, sourceDigest } from "./return-source";
import type { ReturnRow } from "./return-table";
import {
  reconcileReturnReceipts,
  applyReceiptQuantities,
} from "./return-receipts";
export async function archiveReturnIntake(user: User, raw: unknown) {
  requireRole(user, ["admin"]);
  const d = z
    .object({
      id: z.uuid(),
      restore: z.boolean().default(false),
      reason: z.string().trim().min(8).max(2000),
    })
    .parse(raw);
  return db().begin(async (tx) => {
    await tx`SELECT pg_advisory_xact_lock(742920)`;
    const [b] =
      await tx`SELECT * FROM return_intake_batches WHERE id=${d.id} FOR UPDATE`;
    if (!b) throw new AppError(404, "Không có đợt nhập");
    if (
      (!d.restore && b.state === "archived") ||
      (d.restore && b.state === "completed")
    )
      return { done: true, reused: true };
    if (!["completed", "archived", "archiving", "restoring"].includes(b.state))
      throw new AppError(
        409,
        "Chỉ loại bỏ đợt đã nhập hoàn tất hoặc tiếp tục tác vụ đang chạy",
      );
    const inProgress = ["archiving", "restoring"].includes(b.state);
    if (inProgress && (b.state === "restoring") !== d.restore)
      throw new AppError(
        409,
        "Cần hoàn tất tác vụ trước khi đổi sang thao tác ngược lại",
      );
    const imports =
      await tx`SELECT DISTINCT import_id FROM return_intake_rows WHERE batch_id=${b.id} AND import_id IS NOT NULL`;
    const importIds = imports.map((r) => r.import_id);
    if (b.kind === "warehouse_receipt") {
      const receiptCursor = inProgress ? b.summary.archiveReceiptCursor : null;
      const affected =
        await tx`SELECT r.*, (r.source='warehouse_file' AND NOT EXISTS(SELECT 1 FROM return_receipt_events other WHERE other.receipt_id=r.id AND other.action IN ('physical_receipt','duplicate_receipt') AND other.data->>'importId' IS DISTINCT FROM ${b.id} AND (other.data->>'importId' IS NULL OR EXISTS(SELECT 1 FROM return_intake_batches ab WHERE ab.id::text=other.data->>'importId' AND ab.state IN ('completed','committing'))))) withdraw_physical
       FROM return_receipts r WHERE (${!receiptCursor} OR r.id>${receiptCursor ?? null}::uuid) AND EXISTS(SELECT 1 FROM return_receipt_events e WHERE e.receipt_id=r.id AND e.data->>'importId'=${b.id}) ORDER BY r.id LIMIT 100 FOR UPDATE OF r`;
      const affectedIds = affected.map((r) => r.id);
      if (!affected.length) {
        await tx`UPDATE return_intake_batches SET state=${d.restore ? "completed" : "archived"} WHERE id=${b.id}`;
        return { done: true, receipts: 0 };
      }
      // Withdraw quantity assertions independently of physical scan evidence.
      // A later manual inspection remains authoritative. Identical assertions
      // from a different active batch retain their own provenance.
      if (!d.restore) {
        const quantities =
          await tx`SELECT * FROM return_receipts WHERE sku_evidence_import_id=${b.id} AND id IN ${tx(affectedIds)} FOR UPDATE`;
        for (const r of quantities) {
          const [alternative] =
            await tx`SELECT e.data->>'importId' import_id FROM return_receipt_events e JOIN return_intake_batches other ON other.id::text=e.data->>'importId' WHERE e.receipt_id=${r.id} AND other.id<>${b.id} AND other.state IN ('completed','committing') AND e.data->'input'->'skuEvidence'=${tx.json(r.sku_evidence)} ORDER BY e.created_at DESC LIMIT 1`;
          await tx`INSERT INTO return_receipt_events(receipt_id,case_id,actor_id,action,reason,data) VALUES(${r.id},${r.case_id},${user.id},'withdraw_quantity_source',${d.reason},${tx.json({ batchId: b.id, before: r.sku_evidence, replacement: alternative?.import_id ?? null })})`;
          if (alternative)
            await tx`UPDATE return_receipts SET sku_evidence_import_id=${alternative.import_id} WHERE id=${r.id}`;
          else {
            if (r.case_id)
              await tx`UPDATE return_items i SET received_qty=NULL WHERE i.case_id=${r.case_id} AND EXISTS(SELECT 1 FROM return_cases c WHERE c.id=i.case_id AND c.inspection_status='pending' AND NOT c.inspection_partial) AND EXISTS(SELECT 1 FROM jsonb_to_recordset(${tx.json(r.sku_evidence)}) AS q(sku text) WHERE q.sku=i.sku_id OR q.sku=i.seller_sku)`;
            await tx`UPDATE return_receipts SET sku_evidence='[]',sku_evidence_import_id=NULL WHERE id=${r.id}`;
          }
        }
      } else {
        const records =
          await tx`SELECT DISTINCT ON(r.id) r.id,e.data->'input'->'skuEvidence' evidence FROM return_receipts r JOIN return_receipt_events e ON e.receipt_id=r.id WHERE r.id IN ${tx(affectedIds)} AND e.data->>'importId'=${b.id} AND jsonb_array_length(coalesce(e.data->'input'->'skuEvidence','[]'))>0 AND r.sku_evidence_import_id IS NULL ORDER BY r.id,e.created_at DESC`;
        for (const r of records)
          await tx`UPDATE return_receipts SET sku_evidence=${tx.json(r.evidence)},sku_evidence_import_id=${b.id} WHERE id=${r.id}`;
      }
      const receipts = affected.filter((r) => r.withdraw_physical);
      if (!d.restore && receipts.some((r) => r.case_id)) {
        const caseIds = [
          ...new Set(receipts.map((r) => r.case_id).filter(Boolean)),
        ];
        const blocking =
          await tx`SELECT r.id FROM return_cases r WHERE r.id IN ${tx(caseIds)} AND (r.inspection_status<>'pending' OR r.inspection_partial OR EXISTS(SELECT 1 FROM return_claims c WHERE c.case_id=r.id))`;
        if (blocking.length)
          throw new AppError(
            409,
            "Đã có kiểm hàng hoặc khiếu nại sau nhận từ tệp. Chưa gỡ bằng chứng; cần quản lý xác minh từng hồ sơ trước",
          );
      }
      for (const r of receipts) {
        if (!d.restore && r.parcel_id) {
          await tx`UPDATE return_parcels p SET received_at=NULL,received_by=NULL WHERE p.id=${r.parcel_id}
      AND NOT EXISTS(SELECT 1 FROM return_receipts other WHERE other.parcel_id=p.id AND other.id<>${r.id} AND other.source_active AND other.match_state='matched')`;
        }
        await tx`UPDATE return_receipts SET source_active=${d.restore},match_state=${d.restore ? "unmatched" : "conflict"},parcel_id=NULL,version=version+1 WHERE id=${r.id}`;
        await tx`INSERT INTO return_receipt_events(receipt_id,case_id,actor_id,action,reason,data) VALUES(${r.id},${r.case_id},${user.id},${d.restore ? "restore_warehouse_source" : "archive_warehouse_source"},${d.reason},${tx.json({ batchId: b.id, before: r })})`;
        if (r.case_id)
          await tx`UPDATE return_cases SET version=version+1,updated_at=now() WHERE id=${r.case_id}`;
      }
      if (d.restore)
        await reconcileReturnReceipts(
          tx,
          user,
          receipts.map((r) => r.tracking_code).filter(Boolean),
          receipts.map((r) => r.order_code).filter(Boolean),
          { warehouseId: b.warehouse_id, limit: 2000 },
        );
      if (d.restore) {
        const matched =
          await tx`SELECT * FROM return_receipts WHERE id IN ${tx(affectedIds)} AND source_active AND match_state='matched' AND case_id IS NOT NULL`;
        for (const r of matched) await applyReceiptQuantities(tx, r, r.case_id);
      }
      if (!d.restore) {
        for (const caseId of [
          ...new Set(affected.map((r) => r.case_id).filter(Boolean)),
        ])
          await applyReceiptQuantities(tx, {}, caseId);
      }
      const next = affected.at(-1)!.id;
      const [remaining] =
        await tx`SELECT EXISTS(SELECT 1 FROM return_receipts r WHERE r.id>${next} AND EXISTS(SELECT 1 FROM return_receipt_events e WHERE e.receipt_id=r.id AND e.data->>'importId'=${b.id})) more`;
      await tx`UPDATE return_intake_batches SET state=${remaining.more ? (d.restore ? "restoring" : "archiving") : d.restore ? "completed" : "archived"},summary=${tx.json({ ...b.summary, archiveReceiptCursor: next })} WHERE id=${b.id}`;

      await audit(
        tx,
        user,
        d.restore ? "return_intake_restore" : "return_intake_archive",
        b.id,
        b,
        {
          state: d.restore ? "completed" : "archived",
          receipts: receipts.length,
        },
        d.reason,
      );
      return { done: !remaining.more, receipts: affected.length };
    }
    if (!importIds.length)
      throw new AppError(409, "Đợt không có nguồn đã lưu để loại bỏ");
    if (!inProgress) {
      if (d.restore)
        await tx`DELETE FROM return_import_archives WHERE import_id IN ${tx(importIds)}`;
      else
        await tx`INSERT INTO return_import_archives(import_id,archived_by,reason) SELECT unnest(${tx.array(importIds, 2950)}::uuid[]),${user.id},${d.reason} ON CONFLICT DO NOTHING`;
      await tx`UPDATE return_cases SET verification_status='source_rebuild_pending',version=version+1 WHERE id IN (SELECT case_id FROM return_source_versions WHERE import_id IN ${tx(importIds)})`;
      await tx`UPDATE return_intake_batches SET state=${d.restore ? "restoring" : "archiving"},summary=${tx.json({ ...b.summary, archiveCursor: null, archiveReason: d.reason, archiveProcessed: 0 })} WHERE id=${b.id}`;
      await audit(
        tx,
        user,
        d.restore
          ? "return_intake_restore_start"
          : "return_intake_archive_start",
        b.id,
        b,
        { imports: importIds },
        d.reason,
      );
    }
    const cursor = inProgress ? b.summary.archiveCursor : null;
    const targets =
      await tx`SELECT DISTINCT case_id FROM return_source_versions WHERE import_id IN ${tx(importIds)} AND (${!cursor} OR case_id>${cursor ?? null}::uuid) ORDER BY case_id LIMIT 20`;
    if (!targets.length) {
      await tx`UPDATE return_intake_batches SET state=${d.restore ? "completed" : "archived"} WHERE id=${b.id}`;
      return { done: true };
    }
    const ids = targets.map((r) => r.case_id);
    const records =
      await tx`SELECT * FROM return_cases WHERE id IN ${tx(ids)} ORDER BY id FOR UPDATE`;
    const versions =
      await tx`SELECT v.* FROM return_source_versions v LEFT JOIN return_import_archives a ON a.import_id=v.import_id WHERE v.case_id IN ${tx(ids)} AND a.import_id IS NULL ORDER BY v.created_at,v.import_id`;
    const updates: any[] = [],
      items: any[] = [],
      parcels: any[] = [],
      events: any[] = [];
    for (const record of records) {
      const active = versions.filter((v) => v.case_id === record.id);
      let rows: ReturnRow[] = [];
      for (const version of active)
        rows = mergeReturnSource(rows, version.rows_data);
      if (!rows.length) {
        updates.push({
          id: record.id,
          inactive: true,
          source_data: record.source_data,
          source_hash: record.source_hash,
          workflow: record.workflow,
        });
      } else {
        const facts = deriveReturnFacts(rows, record.workflow);
        updates.push({
          id: record.id,
          inactive: false,
          source_data: rows,
          source_hash: sourceDigest(rows),
          ...facts,
          requested_at: rows[0].requested,
          status: rows[0].status,
          substatus: rows[0].substatus,
          type: rows[0].type,
          last_import: active.at(-1)!.import_id,
        });
        for (const row of rows) {
          items.push({
            case_id: record.id,
            item_key: row.itemKey,
            sku_id: row.sku,
            seller_sku: row.sellerSku,
            name: row.name,
            variant: row.variant,
            expected_qty: row.quantity,
            unit_amount: row.unitAmount,
            color: String(row.meta?.color ?? ""),
            size: String(row.meta?.size ?? ""),
          });
          if (row.tracking)
            parcels.push({ case_id: record.id, tracking_code: row.tracking });
        }
      }
      events.push({
        case_id: record.id,
        before: record.source_hash,
        after: rows.length ? sourceDigest(rows) : null,
      });
    }
    await tx`UPDATE return_cases r SET source_inactive=x.inactive,source_data=x.source_data,source_hash=x.source_hash,
   requested_at=coalesce(x.requested_at,r.requested_at),platform_status=coalesce(x.status,r.platform_status),platform_substatus=coalesce(x.substatus,r.platform_substatus),return_type=coalesce(x.type,r.return_type),last_import_id=coalesce(x.last_import,r.last_import_id),
   obligation=CASE WHEN r.obligation_verified THEN r.obligation ELSE coalesce(x.obligation,r.obligation) END,obligation_conflict=coalesce(r.obligation_verified AND x.obligation<>'verify' AND r.obligation<>x.obligation,false),shipping_state=coalesce(x.shipping,r.shipping_state),source_order_amount=x."orderAmount",source_refund_amount=x."refundAmount",source_refund_paid=coalesce(x."refundPaid",false),source_goods_value=x."goodsValue",source_refund_only=coalesce(x."refundOnly",r.source_refund_only),source_cancelled=coalesce(x.cancelled,r.source_cancelled),
   ordered_at=x."orderedAt",cancelled_at=x."cancelledAt",platform_updated_at=x."platformUpdated",approved_at=x."approvedAt",financial_conflict=coalesce(x."financialConflict",r.financial_conflict),
   inspection_stale=(r.inspection_stale OR (r.inspection_status<>'pending' AND r.source_hash IS DISTINCT FROM x.source_hash)),verification_status='pending',version=r.version+1,updated_at=now()
   FROM jsonb_to_recordset(${tx.json(updates)}) AS x(id uuid,inactive boolean,source_data jsonb,source_hash text,requested_at timestamptz,status text,substatus text,type text,last_import uuid,obligation text,shipping text,"orderAmount" numeric,"refundAmount" numeric,"refundPaid" boolean,"goodsValue" numeric,"refundOnly" boolean,cancelled boolean,"orderedAt" timestamptz,"cancelledAt" timestamptz,"platformUpdated" timestamptz,"approvedAt" timestamptz,"financialConflict" boolean) WHERE r.id=x.id`;
    if (items.length) {
      await tx`UPDATE return_items i SET active=false WHERE i.case_id IN ${tx(ids)} AND NOT EXISTS(SELECT 1 FROM jsonb_to_recordset(${tx.json(items)}) AS x(case_id uuid,item_key text) WHERE x.case_id=i.case_id AND x.item_key=i.item_key)`;
      await tx`INSERT INTO return_items(case_id,item_key,sku_id,seller_sku,name,variant,expected_qty,unit_amount,color,size) SELECT x.* FROM jsonb_to_recordset(${tx.json(items)}) AS x(case_id uuid,item_key text,sku_id text,seller_sku text,name text,variant text,expected_qty integer,unit_amount numeric,color text,size text)
    ON CONFLICT(case_id,item_key) DO UPDATE SET expected_qty=excluded.expected_qty,seller_sku=excluded.seller_sku,name=excluded.name,variant=excluded.variant,unit_amount=excluded.unit_amount,color=excluded.color,size=excluded.size,active=true`;
    }
    await tx`UPDATE return_parcels p SET active=false WHERE p.case_id IN ${tx(ids)} AND p.received_at IS NULL AND NOT EXISTS(SELECT 1 FROM jsonb_to_recordset(${tx.json(parcels)}) AS x(case_id uuid,tracking_code text) WHERE x.case_id=p.case_id AND x.tracking_code=p.tracking_code)`;
    if (parcels.length)
      await tx`UPDATE return_parcels p SET active=true FROM jsonb_to_recordset(${tx.json(parcels)}) AS x(case_id uuid,tracking_code text) WHERE p.case_id=x.case_id AND p.tracking_code=x.tracking_code AND NOT p.excluded_manually`;
    await tx`UPDATE return_cases r SET verification_status='source_conflict' WHERE r.id IN ${tx(ids)} AND NOT r.source_inactive AND EXISTS(SELECT 1 FROM return_parcels p WHERE p.case_id=r.id AND p.active AND p.received_at IS NOT NULL AND p.carrier_origin<>'manual' AND NOT EXISTS(SELECT 1 FROM jsonb_to_recordset(${tx.json(parcels)}) AS x(case_id uuid,tracking_code text) WHERE x.case_id=p.case_id AND x.tracking_code=p.tracking_code))`;
    await tx`INSERT INTO return_events(case_id,actor_id,action,reason,data) SELECT x.case_id,${user.id},${d.restore ? "source_restore" : "source_archive"},${d.reason},to_jsonb(x)||jsonb_build_object('batchId',${b.id}::text) FROM jsonb_to_recordset(${tx.json(events)}) AS x(case_id uuid,before text,after text)`;
    const nextCursor = ids.at(-1);
    const [left] =
      await tx`SELECT count(DISTINCT case_id)::int n FROM return_source_versions WHERE import_id IN ${tx(importIds)} AND case_id>${nextCursor}::uuid`;
    await tx`UPDATE return_intake_batches SET state=${left.n ? (d.restore ? "restoring" : "archiving") : d.restore ? "completed" : "archived"},summary=${tx.json({ ...b.summary, archiveCursor: nextCursor, archiveReason: d.reason, archiveProcessed: Number(b.summary.archiveProcessed ?? 0) + ids.length })} WHERE id=${b.id}`;
    return { done: left.n === 0, processed: ids.length };
  });
}
