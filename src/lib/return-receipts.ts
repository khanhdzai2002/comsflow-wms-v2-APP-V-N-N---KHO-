import { db, audit, type Tx, type User } from "./db";
import { AppError, managerRoles, requireRole } from "./domain";
import { identifyCarrier, carrierCatalog } from "./carriers";
import { returnOperationsStatus } from "./return-operations-access";
import { z } from "zod";
export async function recordPhysicalReturn(
  tx: Tx,
  user: User,
  input: {
    code: string;
    warehouseId: string;
    shiftId?: string;
    sessionId?: string;
    courier?: string;
    note?: string;
    carrierId?: string;
    sourceCarrier?: string;
    order?: string;
    employee?: string;
    at?: string;
    shopId?: string;
    source?: "scan" | "warehouse_file";
    importId?: string;
    skuEvidence?: { sku: string; quantity: number }[];
  },
  response: any = {},
) {
  if (!(await returnOperationsStatus(tx)).ready) return response;
  if (input.skuEvidence)
    input = {
      ...input,
      skuEvidence: [...input.skuEvidence].sort((a, b) =>
        a.sku.localeCompare(b.sku),
      ),
    };
  const [existing] =
    await tx`SELECT * FROM return_receipts WHERE source_active AND warehouse_id=${input.warehouseId} AND ((${input.code}<>'' AND tracking_code=${input.code}) OR (${input.code}='' AND tracking_code='' AND order_code=${input.order ?? ""} AND shop_id IS NOT DISTINCT FROM ${input.shopId ?? null}::uuid)) ORDER BY received_at,id FOR UPDATE`;
  if (
    existing?.case_id &&
    response.caseId &&
    existing.case_id !== response.caseId
  )
    throw new AppError(
      409,
      "Mã này đã được ghi nhận cho hồ sơ khác. Quản lý cần xác minh liên kết; không nhận trùng sang hồ sơ thứ hai.",
    );
  if (input.sessionId) {
    const [session] =
      await tx`SELECT * FROM return_handover_sessions WHERE id=${input.sessionId} FOR UPDATE`;
    if (
      !session ||
      session.closed_at ||
      session.warehouse_id !== input.warehouseId ||
      session.created_by !== user.id
    )
      throw new AppError(
        409,
        "Phiên bàn giao đã đóng hoặc không đúng kho/người nhận",
      );
    if (
      session.carrier_id &&
      input.carrierId &&
      session.carrier_id !== input.carrierId
    )
      throw new AppError(409, "Hãng không khớp phiên bàn giao");
    input = {
      ...input,
      carrierId: session.carrier_id ?? input.carrierId,
      courier: input.courier || session.courier_name,
    };
  }
  const identity = identifyCarrier(
    await carrierCatalog(tx),
    input.code,
    input.sourceCarrier ?? "",
    input.carrierId || null,
  );
  if (response.parcelId && input.carrierId) {
    const [p] =
      await tx`SELECT carrier_id FROM return_parcels WHERE id=${response.parcelId}`;
    if (p?.carrier_id && p.carrier_id !== input.carrierId)
      throw new AppError(
        409,
        "Hãng bàn giao không khớp nguồn của vận đơn; cần quản lý xác minh trước",
      );
  }
  let receipt = existing;
  if (!receipt) {
    [receipt] =
      await tx`INSERT INTO return_receipts(warehouse_id,shop_id,tracking_code,order_code,carrier_id,carrier_origin,case_id,parcel_id,received_at,recorded_by,employee_source,courier_name,note,source,session_id,shift_id,sku_evidence,sku_evidence_import_id,match_state)
   VALUES(${input.warehouseId},${input.shopId ?? null},${input.code},${input.order ?? ""},${identity.carrierId},${input.carrierId ? "manual" : identity.origin},${response.caseId ?? null},${response.parcelId ?? null},coalesce(${input.at ?? null}::timestamptz,${response.at ?? null}::timestamptz,clock_timestamp()),${user.id},${input.employee ?? ""},${input.courier ?? ""},${input.note ?? ""},${input.source ?? "scan"},${input.sessionId ?? null},${input.shiftId ?? null},${tx.json(input.skuEvidence ?? [])},${input.skuEvidence?.length ? (input.importId ?? null) : null},${response.caseId ? "matched" : response.outcome === "ambiguous" ? "ambiguous" : "unmatched"}) RETURNING *`;
  } else if (response.caseId && !existing.case_id) {
    [receipt] =
      await tx`UPDATE return_receipts SET case_id=${response.caseId},parcel_id=${response.parcelId ?? null},match_state='matched',version=version+1 WHERE id=${existing.id} RETURNING *`;
    if (response.outcome === "received")
      await tx`UPDATE return_parcels SET received_at=${existing.received_at},received_by=${existing.recorded_by} WHERE id=${response.parcelId}`;
  }
  if (existing && input.skuEvidence?.length) {
    const canonical = (rows: { sku: string; quantity: number }[]) =>
      JSON.stringify([...rows].sort((a, b) => a.sku.localeCompare(b.sku)));
    if (!existing.sku_evidence.length) {
      [receipt] =
        await tx`UPDATE return_receipts SET sku_evidence=${tx.json(input.skuEvidence)},sku_evidence_import_id=${input.importId ?? null},version=version+1 WHERE id=${existing.id} RETURNING *`;
    } else if (
      canonical(existing.sku_evidence) !== canonical(input.skuEvidence)
    ) {
      if (existing.case_id)
        await tx`UPDATE return_cases SET verification_status='source_conflict',version=version+1 WHERE id=${existing.case_id}`;
      throw new AppError(
        409,
        "Số lượng nhận khác bằng chứng đã lưu; mở kiểm hàng để xác minh, không cộng hai file trùng",
      );
    }
    if (receipt.case_id)
      await applyReceiptQuantities(tx, receipt, receipt.case_id);
  }
  await tx`INSERT INTO return_receipt_events(receipt_id,case_id,actor_id,action,data)
  VALUES(${receipt.id},${receipt.case_id},${user.id},${existing ? "duplicate_receipt" : "physical_receipt"},${tx.json({ source: input.source ?? "scan", importId: input.importId ?? null, input, response })})`;
  return {
    ...response,
    receiptId: receipt.id,
    recorded: true,
    matchState: receipt.match_state,
    at: new Date(receipt.received_at).toISOString(),
    ...(existing && !response.caseId
      ? {
          outcome: "duplicate",
          caseId: existing.case_id,
          parcelId: existing.parcel_id,
        }
      : {}),
    employee:
      receipt.employee_source ||
      (receipt.recorded_by === user.id
        ? user.name
        : ((await tx`SELECT name FROM users WHERE id=${receipt.recorded_by}`)[0]
            ?.name ?? user.name)),
  };
}
// SKU evidence is quantity evidence only. It never completes a quality inspection.
export async function applyReceiptQuantities(
  tx: Tx,
  _receipt: any,
  caseId: string,
) {
  const [c] =
    await tx`SELECT inspection_status,inspection_partial,source_data FROM return_cases WHERE id=${caseId}`;
  if (c.inspection_status !== "pending" || c.inspection_partial) return;
  const items =
    await tx`SELECT * FROM return_items WHERE case_id=${caseId} AND active`;
  const proofs =
    await tx`SELECT id,tracking_code,sku_evidence FROM return_receipts WHERE case_id=${caseId} AND match_state='matched' AND source_active AND jsonb_array_length(sku_evidence)>0`;
  const totals = new Map<string, number>();
  let uncertain = false;
  for (const proof of proofs)
    for (const e of proof.sku_evidence as { sku: string; quantity: number }[]) {
      let found = items.filter(
        (i) => i.seller_sku === e.sku || i.sku_id === e.sku,
      );
      if (found.length > 1 && proof.tracking_code)
        found = found.filter((i) =>
          c.source_data.some(
            (r: any) =>
              r.itemKey === i.item_key && r.tracking === proof.tracking_code,
          ),
        );
      if (found.length !== 1) {
        uncertain = true;
        continue;
      }
      totals.set(found[0].id, (totals.get(found[0].id) ?? 0) + e.quantity);
    }
  const updates = [...totals].map(([id, quantity]) => ({ id, quantity }));
  if (updates.some((r) => r.quantity > 2147483647))
    throw new AppError(
      413,
      "Số lượng một SKU vượt phạm vi; cần kiểm tra nguồn kho",
    );
  if (updates.length)
    await tx`UPDATE return_items i SET received_qty=x.quantity FROM jsonb_to_recordset(${tx.json(updates)}) AS x(id uuid,quantity integer) WHERE i.id=x.id`;
  if (
    uncertain ||
    updates.some(
      (u) => u.quantity > items.find((i) => i.id === u.id)!.expected_qty,
    )
  )
    await tx`UPDATE return_cases SET verification_status='source_conflict' WHERE id=${caseId}`;
}
export async function reconcileReturnReceipts(
  tx: Tx,
  user: User,
  codes?: string[],
  orders?: string[],
  options: { warehouseId?: string; after?: string; limit?: number } = {},
) {
  if (
    (codes && !codes.length && !orders?.length) ||
    !(await returnOperationsStatus(tx)).ready
  )
    return {
      matched: 0,
      ambiguous: 0,
      checked: 0,
      cursor: options.after ?? null,
      more: false,
    };
  // Callers hold the shared receive/import lock. A bounded batch also supports
  // manual replay; unmatched codes without a source are kept indefinitely.
  const receipts =
    await tx`SELECT rr.* FROM return_receipts rr WHERE (${!options.warehouseId} OR warehouse_id=${options.warehouseId ?? null}::uuid) AND (${!options.after} OR rr.id>${options.after ?? null}::uuid) AND source_active AND match_state IN ('unmatched','ambiguous') AND
  ${codes ? tx`(tracking_code IN ${tx(codes.length ? codes : [""])} OR (tracking_code='' AND order_code IN ${tx(orders?.length ? orders : [""])}))` : tx`EXISTS(SELECT 1 FROM return_cases c WHERE c.warehouse_id=rr.warehouse_id AND NOT c.source_inactive AND (c.order_code=rr.order_code OR EXISTS(SELECT 1 FROM return_parcels p WHERE p.case_id=c.id AND p.active AND p.tracking_code=rr.tracking_code)))`}
  ORDER BY rr.id LIMIT ${options.limit ?? 1000} FOR UPDATE`;
  if (!receipts.length)
    return {
      matched: 0,
      ambiguous: 0,
      checked: 0,
      cursor: options.after ?? null,
      more: false,
    };
  const trackings = [
    ...new Set(receipts.map((r) => r.tracking_code).filter(Boolean)),
  ];
  const orderCodes = [
    ...new Set(
      receipts.filter((r) => !r.tracking_code).map((r) => r.order_code),
    ),
  ];
  const candidates =
    await tx`SELECT r.id case_id,r.warehouse_id,r.shop_id,r.order_code,p.id,p.tracking_code,p.carrier_id,p.received_at,
  EXISTS(SELECT 1 FROM return_receipts linked WHERE linked.source_active AND linked.match_state='matched' AND linked.parcel_id=p.id) occupied
  FROM return_cases r LEFT JOIN return_parcels p ON p.case_id=r.id AND p.active
  WHERE NOT r.no_physical_return AND NOT r.source_inactive AND r.obligation='required' AND (p.tracking_code IN ${tx(trackings.length ? trackings : [""])} OR r.order_code IN ${tx(orderCodes.length ? orderCodes : [""])}) ORDER BY r.id,p.id`;
  const links: any[] = [],
    ambiguous: string[] = [];
  for (const receipt of receipts) {
    let found = candidates.filter(
      (p) =>
        p.warehouse_id === receipt.warehouse_id &&
        (!receipt.shop_id || receipt.shop_id === p.shop_id) &&
        (receipt.tracking_code
          ? p.tracking_code === receipt.tracking_code
          : p.order_code === receipt.order_code),
    );
    if (!receipt.tracking_code && found.length === 1) {
      // An order alone is insufficient when requests/parcel/SKU identities overlap.
      const evidence = receipt.sku_evidence as {
        sku: string;
        quantity: number;
      }[];
      const items =
        await tx`SELECT sku_id,seller_sku FROM return_items WHERE case_id=${found[0].case_id} AND active`;
      if (
        !evidence.length ||
        evidence.some(
          (e) =>
            items.filter((i) => i.sku_id === e.sku || i.seller_sku === e.sku)
              .length !== 1,
        )
      )
        found = [];
    }
    if (found.length === 1 && !found[0].occupied) {
      const p = found[0];
      if (
        ["manual", "file"].includes(receipt.carrier_origin) &&
        receipt.carrier_id &&
        p.carrier_id &&
        receipt.carrier_id !== p.carrier_id
      ) {
        ambiguous.push(receipt.id);
        continue;
      }
      links.push({
        receipt_id: receipt.id,
        parcel_id: p.id,
        case_id: p.case_id,
        at: receipt.received_at,
        actor: receipt.recorded_by,
        carrier_id: p.carrier_id,
      });
    } else if (found.length > 0 || !receipt.tracking_code)
      ambiguous.push(receipt.id);
  }
  if (links.length) {
    const parents = [...new Set(links.map((x) => x.case_id))];
    await tx`SELECT id FROM return_cases WHERE id IN ${tx(parents)} ORDER BY id FOR UPDATE`;
    await tx`UPDATE return_parcels p SET received_at=x.at,received_by=x.actor FROM jsonb_to_recordset(${tx.json(links)}) AS x(parcel_id uuid,at timestamptz,actor uuid) WHERE p.id=x.parcel_id AND p.received_at IS NULL`;
    await tx`UPDATE return_receipts r SET case_id=x.case_id,parcel_id=x.parcel_id,match_state='matched',version=version+1 FROM jsonb_to_recordset(${tx.json(links)}) AS x(receipt_id uuid,case_id uuid,parcel_id uuid,carrier_id uuid) WHERE r.id=x.receipt_id`;
    for (const link of links)
      await applyReceiptQuantities(
        tx,
        receipts.find((r) => r.id === link.receipt_id)!,
        link.case_id,
      );
    await tx`UPDATE return_cases SET version=version+1,updated_at=now() WHERE id IN ${tx(parents)}`;
    await tx`INSERT INTO return_receipt_events(receipt_id,case_id,actor_id,action,data) SELECT x.receipt_id,x.case_id,${user.id},'source_reconcile',to_jsonb(x) FROM jsonb_to_recordset(${tx.json(links)}) AS x(receipt_id uuid,case_id uuid,parcel_id uuid,at timestamptz,actor uuid)`;
    await audit(
      tx,
      user,
      "return_receipts_reconcile",
      crypto.randomUUID(),
      null,
      links,
      "Ghép mã chính xác; giữ người/giờ nhận thực tế; không tự kiểm chất lượng",
    );
  }
  if (ambiguous.length)
    await tx`UPDATE return_receipts SET match_state='ambiguous',version=version+1 WHERE id IN ${tx(ambiguous)} AND match_state<>'ambiguous'`;
  return {
    matched: links.length,
    ambiguous: ambiguous.length,
    checked: receipts.length,
    cursor: receipts.at(-1)!.id,
    more: receipts.length === (options.limit ?? 1000),
  };
}
export async function returnHandover(user: User, input: unknown) {
  const d = z
    .object({
      warehouseId: z.uuid(),
      carrierId: z.uuid().nullable().optional(),
      courier: z.string().trim().max(200).default(""),
      note: z.string().max(2000).default(""),
      id: z.uuid().optional(),
      close: z.boolean().default(false),
    })
    .parse(input);
  return db().begin(async (tx) => {
    if (d.close) {
      const [before] =
        await tx`SELECT * FROM return_handover_sessions WHERE id=${d.id ?? null} FOR UPDATE`;
      if (!before) throw new AppError(404, "Không có phiên bàn giao");
      if (user.role === "staff" && before.created_by !== user.id)
        throw new AppError(403, "Chỉ đóng phiên của mình");
      const [after] =
        await tx`UPDATE return_handover_sessions SET closed_at=coalesce(closed_at,clock_timestamp()),closed_by=coalesce(closed_by,${user.id}) WHERE id=${before.id} RETURNING *`;
      await audit(
        tx,
        user,
        "return_handover_close",
        before.id,
        before,
        after,
        "Đóng phiên nhận thực tế",
      );
      return after;
    }
    const [shift] =
      await tx`SELECT 1 FROM work_shifts s JOIN shift_members m ON m.shift_id=s.id WHERE m.user_id=${user.id} AND s.warehouse_id=${d.warehouseId} AND s.starts_at<=now() AND s.ends_at>now()`;
    if (!shift)
      throw new AppError(
        403,
        "Cần ca được phân công tại kho để mở phiên bàn giao",
      );
    const [session] =
      await tx`INSERT INTO return_handover_sessions(warehouse_id,carrier_id,courier_name,note,created_by) VALUES(${d.warehouseId},${d.carrierId ?? null},${d.courier},${d.note},${user.id}) RETURNING *`;
    await audit(
      tx,
      user,
      "return_handover_open",
      session.id,
      null,
      session,
      "Mở phiên nhận thực tế",
    );
    return session;
  });
}
export async function verifyReturnReceipt(user: User, raw: unknown) {
  requireRole(user, managerRoles);
  const d = z
    .object({
      id: z.uuid(),
      version: z.number().int(),
      caseId: z.uuid(),
      parcelId: z.uuid().optional(),
      reason: z.string().trim().min(8).max(2000),
    })
    .parse(raw);
  return db().begin(async (tx) => {
    await tx`SELECT pg_advisory_xact_lock(742920)`;
    const [r] =
      await tx`SELECT * FROM return_receipts WHERE id=${d.id} FOR UPDATE`;
    if (!r || r.version !== d.version)
      throw new AppError(409, "Bản ghi nhận đã đổi; tải lại trước khi ghép");
    if (!r.source_active || r.match_state === "matched")
      throw new AppError(
        409,
        "Bản ghi đã được ghép; không tự chuyển bằng chứng sang đơn khác",
      );
    const [c] =
      await tx`SELECT * FROM return_cases WHERE id=${d.caseId} FOR UPDATE`;
    if (
      !c ||
      c.warehouse_id !== r.warehouse_id ||
      c.source_inactive ||
      c.verification_status === "source_rebuild_pending" ||
      c.no_physical_return ||
      c.obligation === "not_required"
    )
      throw new AppError(409, "Hồ sơ không khớp kho hoặc không cần trả hàng");
    const parcels =
      await tx`SELECT * FROM return_parcels WHERE case_id=${c.id} AND active AND (${!r.tracking_code} OR tracking_code=${r.tracking_code}) AND (${!d.parcelId} OR id=${d.parcelId ?? null}::uuid)`;
    const orderOnly =
      !r.tracking_code &&
      r.order_code === c.order_code &&
      (!r.shop_id || r.shop_id === c.shop_id);
    if (
      orderOnly
        ? parcels.length > 1
        : parcels.length !== 1 || parcels[0]?.tracking_code !== r.tracking_code
    )
      throw new AppError(
        409,
        "Cần chọn đúng kiện hoặc hồ sơ mã đơn duy nhất; không ghép theo tên/ngày/giá trị",
      );
    const p = parcels[0];
    if (p) {
      if (
        (
          await tx`SELECT id FROM return_receipts WHERE parcel_id=${p.id} AND source_active`
        ).length
      )
        throw new AppError(409, "Kiện đã có bằng chứng khác, cần xác minh");
      await tx`UPDATE return_parcels SET received_at=coalesce(received_at,${r.received_at}),received_by=coalesce(received_by,${r.recorded_by}) WHERE id=${p.id}`;
    }
    await tx`UPDATE return_receipts SET case_id=${c.id},parcel_id=${p?.id ?? null},match_state='matched',version=version+1 WHERE id=${r.id}`;
    await tx`INSERT INTO return_receipt_events(receipt_id,case_id,actor_id,action,reason,data) VALUES(${r.id},${c.id},${user.id},'manual_link',${d.reason},${tx.json(d)})`;
    await applyReceiptQuantities(tx, r, c.id);
    await tx`UPDATE return_cases SET version=version+1,updated_at=now() WHERE id=${c.id}`;
    return { ok: true };
  });
}
