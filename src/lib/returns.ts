import { warehouseIdSchema } from "./domain";
import { createHash, randomUUID } from "node:crypto";
import { carrierCatalog, identifyCarrier } from "./carriers";
import { groupReturnCarriers, returnCarrierGroups } from "./return-carriers";
import {
  mergeReturnSource,
  sourceDigest,
  sourceChanges,
  classifyReason,
} from "./return-source";
import { z } from "zod";
import { db, audit, type User, type Tx } from "./db";
import {
  AppError,
  managerRoles,
  requireRole,
  normalizeCode,
  validCode,
} from "./domain";
import type { ReturnFile, ReturnRow } from "./return-table";
import { returnProcessing, platformApproved } from "./return-domain";

const contextSchema = z.object({
  warehouseId: warehouseIdSchema,
  shop: z.string().trim().min(1).max(100),
  previewFingerprint: z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .optional(),
});
async function context(
  sql: ReturnType<typeof db> | Tx,
  file: ReturnFile,
  raw: unknown,
) {
  const c = contextSchema.parse(raw);
  if (!(await sql`SELECT id FROM warehouses WHERE id=${c.warehouseId}`).length)
    throw new AppError(400, "Kho không tồn tại");
  return c;
}
const groupRows = (f: ReturnFile) => {
  const m = new Map<string, ReturnRow[]>();
  for (const r of f.rows)
    (m.get(r.request) ?? (m.set(r.request, []), m.get(r.request)!)).push(r);
  return m;
};
function importFingerprint(file: ReturnFile, existing: any[]) {
  const requests = new Set(file.rows.map((r) => r.request));
  return createHash("sha256")
    .update(
      JSON.stringify(
        existing
          .filter((r) => requests.has(r.external_id))
          .sort((a, b) => a.id.localeCompare(b.id))
          .map((r) => [r.id, r.source_hash, r.version, r.last_import_id]),
      ),
    )
    .digest("hex");
}
function issues(file: ReturnFile, existing: any[]) {
  const groups = groupRows(file);
  return existing.flatMap((c) => {
    const next = groups.get(c.external_id);
    if (!next) return [];
    if (next[0].order !== c.order_code)
      return [
        {
          request: c.external_id,
          message:
            "Mã yêu cầu đã tồn tại với đơn gốc khác. Không ghi đè danh tính.",
        },
      ];
    const oldTime = c.source_data
        .map((r: any) => r.meta?.platformUpdated)
        .filter(Boolean)
        .sort()
        .at(-1),
      newTime = next
        .map((r) => r.meta?.platformUpdated)
        .filter(Boolean)
        .sort()
        .at(-1);
    if (oldTime && newTime && String(newTime) < String(oldTime))
      return [
        {
          request: c.external_id,
          message:
            "Thời điểm cập nhật từ sàn cũ hơn nguồn đã có. Không ghi lùi trạng thái.",
        },
      ];
    return [];
  });
}
export async function previewReturns(
  user: User,
  file: ReturnFile,
  raw: unknown,
) {
  requireRole(user, managerRoles);
  const groups = groupRows(file);
  const sql = db(),
    c = await context(sql, file, raw);
  const existing =
    await sql`SELECT r.* FROM return_cases r JOIN shops sh ON sh.id=r.shop_id JOIN sales_channels ch ON ch.id=sh.channel_id WHERE ch.name=${file.channel} AND sh.name=${c.shop} AND r.external_id=ANY(${[...groups.keys()]}::text[])`;
  const [purged] =
    await sql`SELECT p.purged_rows FROM return_import_purges p JOIN return_imports i ON i.id=p.import_id JOIN shops sh ON sh.id=i.shop_id JOIN sales_channels ch ON ch.id=sh.channel_id WHERE i.file_hash=${file.hash} AND sh.name=${c.shop} AND ch.name=${file.channel}`;
  const retired = file.rows.length
    ? await sql`SELECT r.external_id FROM retired_return_cases r JOIN shops sh ON sh.id=r.shop_id JOIN sales_channels ch ON ch.id=sh.channel_id WHERE sh.name=${c.shop} AND ch.name=${file.channel} AND r.external_id IN ${sql([...groups.keys()])}`
    : [];
  const conflicts = [
    ...(purged
      ? [
          {
            request: "File đã dọn dữ liệu",
            message: `File này có ${purged.purged_rows} dòng đã xoá vĩnh viễn. Lọc các yêu cầu đã dọn khỏi nguồn trước khi nhập lại.`,
          },
        ]
      : []),
    ...(!purged
      ? retired.map((r) => ({
          request: r.external_id,
          message:
            "Yêu cầu đã xoá vĩnh viễn. Loại khỏi file nguồn để không tự nhập lại dữ liệu đã dọn.",
        }))
      : []),
    ...issues(file, existing),
    ...existing
      .filter(
        (r) => groups.has(r.external_id) && r.warehouse_id !== c.warehouseId,
      )
      .map((r) => ({
        request: r.external_id,
        message: "Yêu cầu đã thuộc kho khác. Không tự chuyển kho.",
      })),
  ];
  const changes = existing
    .filter((r) => groups.has(r.external_id))
    .map((r) => {
      const merged = mergeReturnSource(
        r.source_data,
        groups.get(r.external_id)!,
      );
      const fields = sourceChanges(r.source_data, merged);
      return {
        request: r.external_id,
        caseId: r.id,
        previousStatus: r.platform_status,
        nextStatus: merged[0].status,
        previousQuantity: r.source_data.reduce(
          (n: number, x: any) => n + x.quantity,
          0,
        ),
        nextQuantity: merged.reduce((n, x) => n + x.quantity, 0),
        previousTracking: r.source_data
          .map((x: any) => x.tracking)
          .filter(Boolean),
        nextTracking: merged.map((x) => x.tracking).filter(Boolean),
        hasInspection: r.inspection_status !== "pending",
        fields,
      };
    });
  const catalog = await carrierCatalog(sql);
  const manualParcels = existing.length
    ? await sql`SELECT r.external_id,p.tracking_code,p.carrier_id FROM return_parcels p JOIN return_cases r ON r.id=p.case_id WHERE p.case_id=ANY(${existing.map((r) => r.id)}::uuid[]) AND p.active AND p.carrier_origin='manual'`
    : [];
  const manualByCode = new Map(
    manualParcels.map((p) => [
      JSON.stringify([p.external_id, p.tracking_code]),
      p.carrier_id,
    ]),
  );
  const checkedRows = file.rows.map((r) => ({
    row: r.row,
    request: r.request,
    tracking: r.tracking,
    ...identifyCarrier(
      catalog,
      r.tracking,
      r.sourceCarrier,
      manualByCode.get(JSON.stringify([r.request, r.tracking])) ?? null,
    ),
  }));
  const carrierChecks = checkedRows.filter((r) => r.tracking);
  const carrierSummaryMap = new Map<
    string,
    { id: string; name: string; requests: number }
  >();
  for (const group of groupReturnCarriers(
    checkedRows.map((r) => ({
      caseId: r.request,
      hasTracking: !!r.tracking,
      carrierId: r.carrierId,
      carrier: r.carrier,
    })),
  )) {
    const summary = carrierSummaryMap.get(group.carrier_id) ?? {
      id: group.carrier_id,
      name: group.carrier,
      requests: 0,
    };
    summary.requests++;
    carrierSummaryMap.set(group.carrier_id, summary);
  }
  return {
    ...file,
    carrierChecks,
    carrierSummary: [...carrierSummaryMap.values()].sort(
      (a, b) => b.requests - a.requests || a.name.localeCompare(b.name),
    ),
    updateSummary: {
      new: file.summary.requests - changes.length,
      existing: changes.length,
      status: changes.filter(
        (c) =>
          c.previousStatus !== c.nextStatus ||
          c.fields.some((x) => x.field.endsWith(":substatus")),
      ).length,
      unchanged: changes.filter((c) => !c.fields.length).length,
      finance: changes.filter((c) => c.fields.some((x) => x.financial)).length,
      errors: file.errors.length + conflicts.length,
    },
    context: c,
    previewFingerprint: importFingerprint(file, existing),
    conflicts,
    changes,
    existingRequests: existing.filter((r) => groups.has(r.external_id)).length,
    canCommit:
      file.errors.length === 0 &&
      conflicts.length === 0 &&
      file.rows.length > 0,
  };
}
export async function commitReturns(
  user: User,
  file: ReturnFile,
  filename: string,
  raw: unknown,
) {
  requireRole(user, managerRoles);
  if (file.errors.length || !file.rows.length)
    throw new AppError(
      400,
      "Chưa lưu file còn lỗi. Tải báo cáo lỗi và xử lý trước; không nhập thiếu nguồn.",
    );
  const groups = groupRows(file);
  return db().begin(async (tx) => {
    await tx`SELECT pg_advisory_xact_lock(742920)`;
    const c = await context(tx, file, raw);
    const [channel] =
      await tx`INSERT INTO sales_channels(name) VALUES(${file.channel}) ON CONFLICT(name) DO UPDATE SET name=excluded.name RETURNING id`;
    const [shop] =
      await tx`INSERT INTO shops(name,channel_id) VALUES(${c.shop},${channel.id}) ON CONFLICT(channel_id,name) DO UPDATE SET name=excluded.name RETURNING id`;
    const retired =
      await tx`SELECT external_id FROM retired_return_cases WHERE shop_id=${shop.id} AND external_id IN ${tx([...groups.keys()])}`;
    if (retired.length)
      throw new AppError(
        409,
        `File có ${retired.length} yêu cầu đã xoá vĩnh viễn. Loại khỏi file nguồn trước khi nhập.`,
      );
    const [prior] =
      await tx`SELECT * FROM return_imports WHERE shop_id=${shop.id} AND file_hash=${file.hash}`;
    if (prior) {
      if (prior.warehouse_id !== c.warehouseId)
        throw new AppError(409, "File đã được nhập cho kho khác");
      if (
        (
          await tx`SELECT import_id FROM return_import_purges WHERE import_id=${prior.id}`
        ).length
      )
        throw new AppError(
          409,
          "File này có dữ liệu đã xoá vĩnh viễn. Không nhập lại nguyên file cũ; hãy xuất nguồn mới.",
        );
      return { id: prior.id, reused: true, created: 0, updated: 0 };
    }
    const existing =
      await tx`SELECT * FROM return_cases WHERE shop_id=${shop.id} AND external_id IN ${tx([...groups.keys()])} ORDER BY id FOR UPDATE`;
    if (
      c.previewFingerprint &&
      c.previewFingerprint !== importFingerprint(file, existing)
    )
      throw new AppError(
        409,
        "Dữ liệu đổi sau khi xem trước. Đọc và đối chiếu lại file trước khi cập nhật.",
      );
    if (
      issues(file, existing).length ||
      existing.some(
        (r) => groups.has(r.external_id) && r.warehouse_id !== c.warehouseId,
      )
    )
      throw new AppError(
        409,
        "Mã yêu cầu mâu thuẫn đơn gốc/kho. Xem trước và kiểm tra nguồn.",
      );
    const [batch] =
      await tx`INSERT INTO return_imports(file_hash,filename,shop_id,warehouse_id,rows_count,summary,created_by) VALUES(${file.hash},${filename.slice(0, 255)},${shop.id},${c.warehouseId},${file.summary.rows},${tx.json(file.summary)},${user.id}) RETURNING id`;
    const catalog = await carrierCatalog(tx);
    const reasonRules =
      await tx`SELECT * FROM return_reason_rules WHERE active`;
    let created = 0,
      updated = 0,
      unchanged = 0,
      statusCount = 0,
      financeCount = 0;
    const existingByExternal = new Map(existing.map((r) => [r.external_id, r]));
    const cases: Record<string, any>[] = [],
      items: Record<string, any>[] = [],
      snapshots: Record<string, any>[] = [],
      events: Record<string, any>[] = [],
      changes: Record<string, any>[] = [];
    const oldParcels = existing.length
      ? await tx`SELECT * FROM return_parcels WHERE case_id=ANY(${existing.map((r) => r.id)}::uuid[])`
      : [];
    const previousParcels = new Map(
      oldParcels.map((p) => [p.case_id + ":" + p.tracking_code, p]),
    );
    const parcels = new Map<string, Record<string, any>>();
    const signature = (rows: ReturnRow[]) =>
      JSON.stringify(
        rows
          .map((x) => [x.itemKey, x.quantity])
          .sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
      );
    for (const [external, group] of groups) {
      const current = existingByExternal.get(external);
      const caseId = current?.id ?? randomUUID();
      const merged = current
        ? mergeReturnSource(current.source_data, group)
        : group;
      const row = merged.find((x) => x.itemKey === group[0].itemKey)!;
      const digest = sourceDigest(merged);
      const fields = sourceChanges(current?.source_data ?? [], merged);
      if (!current) created++;
      else if (fields.length) {
        updated++;
        if (
          fields.some(
            (x) =>
              x.field.endsWith(":status") || x.field.endsWith(":substatus"),
          )
        )
          statusCount++;
        if (fields.some((x) => x.financial)) financeCount++;
      } else unchanged++;
      const needsInspection =
        !!current &&
        (signature(current.source_data) !== signature(merged) ||
          group.some(
            (x) =>
              x.tracking &&
              !current.source_data.some(
                (y: ReturnRow) => y.tracking === x.tracking,
              ),
          ));
      const originalReason = String(
        row.meta?.reason ??
          row.raw["Return Reason"] ??
          current?.reason_original ??
          "",
      );
      cases.push({
        id: caseId,
        is_new: !current,
        changed: fields.length > 0,
        external_id: external,
        order_code: row.order,
        requested_at: row.requested,
        platform_status: row.status,
        platform_substatus: row.substatus,
        return_type: row.type,
        source_data: merged,
        source_hash: digest,
        needs_inspection: needsInspection,
        reason_original: originalReason,
        reason_group: classifyReason(originalReason, reasonRules),
      });
      if (fields.length)
        changes.push({
          case_id: caseId,
          external_id: external,
          changes: fields,
        });
      // A later source can omit SKUs. Only upsert incoming items; retain prior items and warehouse work.
      for (const incoming of group) {
        const item = merged.find((x) => x.itemKey === incoming.itemKey)!;
        items.push({
          case_id: caseId,
          item_key: item.itemKey,
          sku_id: item.sku,
          seller_sku: item.sellerSku,
          name: item.name,
          variant: item.variant,
          expected_qty: item.quantity,
          unit_amount: item.unitAmount,
        });
        if (item.tracking) {
          const key = caseId + ":" + item.tracking;
          const prior = previousParcels.get(key);
          const identity = identifyCarrier(
            catalog,
            item.tracking,
            item.sourceCarrier,
            prior?.carrier_origin === "manual" ? prior.carrier_id : null,
          );
          parcels.set(key, {
            case_id: caseId,
            tracking_code: item.tracking,
            carrier_id: identity.carrierId,
            source_carrier: item.sourceCarrier ?? "",
            carrier_conflict: identity.conflict,
            carrier_origin: identity.origin,
          });
        }
        snapshots.push({
          row_number: incoming.row,
          case_id: caseId,
          raw: incoming.raw,
        });
      }
      events.push({
        case_id: caseId,
        data: {
          importId: batch.id,
          previousSourceHash: current?.source_hash ?? digest,
          sourceHash: digest,
          changes: fields,
        },
      });
    }
    // A bounded number of SQL statements for the whole file: no request per item.
    // Every write, including import history, remains in the same transaction.
    await tx`INSERT INTO return_cases(id,shop_id,warehouse_id,external_id,order_code,requested_at,platform_status,platform_substatus,return_type,source_data,source_hash,last_import_id,reason_original,reason_group)
      SELECT x.id,${shop.id},${c.warehouseId},x.external_id,x.order_code,x.requested_at,x.platform_status,x.platform_substatus,x.return_type,x.source_data,x.source_hash,${batch.id},x.reason_original,x.reason_group
      FROM jsonb_to_recordset(${tx.json(cases)}) AS x(id uuid,is_new boolean,external_id text,order_code text,requested_at timestamptz,platform_status text,platform_substatus text,return_type text,source_data jsonb,source_hash text,reason_original text,reason_group text) WHERE x.is_new`;
    await tx`UPDATE return_cases r SET
      requested_at=CASE WHEN x.changed THEN x.requested_at ELSE r.requested_at END,
      platform_status=CASE WHEN x.changed THEN x.platform_status ELSE r.platform_status END,
      platform_substatus=CASE WHEN x.changed THEN x.platform_substatus ELSE r.platform_substatus END,
      return_type=CASE WHEN x.changed THEN x.return_type ELSE r.return_type END,
      source_data=CASE WHEN x.changed THEN x.source_data ELSE r.source_data END,
      source_hash=CASE WHEN x.changed THEN x.source_hash ELSE r.source_hash END,
      last_import_id=${batch.id},reason_original=x.reason_original,reason_group=x.reason_group,
      inspection_stale=(r.inspection_stale OR (x.changed AND x.needs_inspection AND r.inspection_status<>'pending')),
      version=r.version+CASE WHEN x.changed THEN 1 ELSE 0 END,
      updated_at=CASE WHEN x.changed THEN now() ELSE r.updated_at END
      FROM jsonb_to_recordset(${tx.json(cases)}) AS x(id uuid,is_new boolean,changed boolean,requested_at timestamptz,platform_status text,platform_substatus text,return_type text,source_data jsonb,source_hash text,needs_inspection boolean,reason_original text,reason_group text)
      WHERE r.id=x.id AND NOT x.is_new`;
    await tx`INSERT INTO return_items(case_id,item_key,sku_id,seller_sku,name,variant,expected_qty,unit_amount)
      SELECT x.case_id,x.item_key,x.sku_id,x.seller_sku,x.name,x.variant,x.expected_qty,x.unit_amount
      FROM jsonb_to_recordset(${tx.json(items)}) AS x(case_id uuid,item_key text,sku_id text,seller_sku text,name text,variant text,expected_qty integer,unit_amount numeric)
      ON CONFLICT(case_id,item_key) DO UPDATE SET seller_sku=COALESCE(NULLIF(excluded.seller_sku,''),return_items.seller_sku),name=COALESCE(NULLIF(excluded.name,''),return_items.name),variant=COALESCE(NULLIF(excluded.variant,''),return_items.variant),expected_qty=excluded.expected_qty,unit_amount=COALESCE(excluded.unit_amount,return_items.unit_amount),active=true`;
    if (parcels.size)
      await tx`INSERT INTO return_parcels(case_id,tracking_code,carrier_id,source_carrier,carrier_conflict,carrier_origin)
      SELECT x.case_id,x.tracking_code,x.carrier_id,x.source_carrier,x.carrier_conflict,x.carrier_origin
      FROM jsonb_to_recordset(${tx.json([...parcels.values()])}) AS x(case_id uuid,tracking_code text,carrier_id uuid,source_carrier text,carrier_conflict boolean,carrier_origin text)
      ON CONFLICT(case_id,tracking_code) DO UPDATE SET source_carrier=excluded.source_carrier,carrier_conflict=excluded.carrier_conflict,carrier_id=CASE WHEN return_parcels.carrier_origin='manual' THEN return_parcels.carrier_id ELSE excluded.carrier_id END,carrier_origin=CASE WHEN return_parcels.carrier_origin='manual' THEN 'manual' ELSE excluded.carrier_origin END`;
    await tx`INSERT INTO return_snapshots(import_id,row_number,case_id,raw)
      SELECT ${batch.id},x.row_number,x.case_id,x.raw FROM jsonb_to_recordset(${tx.json(snapshots)}) AS x(row_number integer,case_id uuid,raw jsonb)`;
    if (changes.length)
      await tx`INSERT INTO return_import_changes(import_id,case_id,external_id,changes)
      SELECT ${batch.id},x.case_id,x.external_id,x.changes FROM jsonb_to_recordset(${tx.json(changes)}) AS x(case_id uuid,external_id text,changes jsonb)`;
    await tx`INSERT INTO return_events(case_id,actor_id,action,data)
      SELECT x.case_id,${user.id},'import',x.data FROM jsonb_to_recordset(${tx.json(events)}) AS x(case_id uuid,data jsonb)`;
    await tx`INSERT INTO return_import_results(import_id,new_count,updated_count,unchanged_count,status_count,finance_count) VALUES(${batch.id},${created},${updated},${unchanged},${statusCount},${financeCount})`;
    await audit(
      tx,
      user,
      "return_import",
      batch.id,
      null,
      { created, updated, summary: file.summary },
      "Nhập nguồn đơn hoàn; giữ trạng thái kho và hồ sơ nội bộ",
    );
    return {
      id: batch.id,
      reused: false,
      created,
      updated,
      unchanged,
      statusCount,
      financeCount,
    };
  });
}
export const returnFilters = z.object({
  q: z.string().max(2000).default(""),
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
  dateType: z.enum(["requested", "received", "imported"]).default("requested"),
  channel: z.string().max(100).default(""),
  warehouse: z.union([z.uuid(), z.literal("")]).default(""),
  shop: z.string().max(100).default(""),
  state: z.string().max(40).default(""),
  carrier: z.string().max(100).default(""),
  carrierScope: z.enum(["any", "exclusive"]).default("any"),
  sort: z.enum(["date", "carrier"]).default("date"),
  reason: z.string().max(50).default(""),
  page: z.coerce.number().int().min(1).max(100000).default(1),
});
export async function returnList(user: User, raw: unknown, all = false) {
  const f = returnFilters.parse(raw);
  if (f.from && f.to && f.from > f.to)
    throw new AppError(400, "Ngày bắt đầu sau ngày kết thúc");
  return db().begin(
    "isolation level repeatable read read only",
    async (sql) => {
      const catalog = await carrierCatalog(sql);
      const scopeDate =
        f.dateType === "received"
          ? sql`(SELECT max(received_at) FROM return_parcels WHERE active AND case_id=r.id)`
          : f.dateType === "imported"
            ? sql`(SELECT created_at FROM return_imports WHERE id=r.last_import_id)`
            : sql`r.requested_at`;
      const scope = sql`(${!f.warehouse} OR r.warehouse_id=${f.warehouse || null}::uuid)
        AND (${!f.channel} OR ch.name=${f.channel}) AND (${!f.shop} OR sh.name=${f.shop})
        AND (${!f.from} OR (${scopeDate} AT TIME ZONE 'Asia/Ho_Chi_Minh')::date>=${f.from ?? null}::date)
        AND (${!f.to} OR (${scopeDate} AT TIME ZONE 'Asia/Ho_Chi_Minh')::date<=${f.to ?? null}::date)`;
      const parcelIdentities: any[] = (
        await sql`SELECT p.id,p.case_id,p.tracking_code,p.source_carrier,p.carrier_id,p.carrier_origin FROM return_parcels p JOIN return_cases r ON r.id=p.case_id JOIN shops sh ON sh.id=r.shop_id JOIN sales_channels ch ON ch.id=sh.channel_id WHERE p.active AND ${scope}`
      ).map((p: any): any => ({
        ...p,
        ...identifyCarrier(
          catalog,
          p.tracking_code,
          p.source_carrier,
          p.carrier_origin === "manual" ? p.carrier_id : null,
        ),
      }));
      const identities = groupReturnCarriers(
        parcelIdentities.map((p) => ({
          caseId: p.case_id,
          hasTracking: true,
          carrierId: p.carrierId,
          carrier: p.carrier,
        })),
      );
      const exclusiveCases = identities
        .filter((p) => p.carrier_id === f.carrier)
        .map((p) => p.case_id);
      const carrierCases = parcelIdentities
        .filter((p) =>
          f.carrier === "unknown" ? !p.carrierId : p.carrierId === f.carrier,
        )
        .map((p) => p.case_id as string);
      const approvedStatuses = (
        await sql`SELECT value FROM system_settings WHERE key='return_approved_statuses'`
      )[0]?.value ?? ["Approved", "Request approved", "Đã chấp thuận"];
      const approvedIds =
        f.state === "approved"
          ? (
              await sql`SELECT r.id,r.source_data,r.platform_status,r.platform_substatus FROM return_cases r JOIN shops sh ON sh.id=r.shop_id JOIN sales_channels ch ON ch.id=sh.channel_id WHERE ${scope}`
            )
              .filter((r) => platformApproved(r, approvedStatuses))
              .map((r) => r.id as string)
          : [];
      const reasonRules = f.reason
        ? await sql`SELECT * FROM return_reason_rules WHERE active`
        : [];
      const reasonCases = f.reason
        ? (
            await sql`SELECT r.id,r.reason_original,r.source_data FROM return_cases r JOIN shops sh ON sh.id=r.shop_id JOIN sales_channels ch ON ch.id=sh.channel_id WHERE ${scope}`
          )
            .filter(
              (r) =>
                classifyReason(
                  r.reason_original ||
                    r.source_data.find((x: any) => x.meta?.reason)?.meta
                      ?.reason ||
                    r.source_data.find((x: any) => x.raw?.["Return Reason"])
                      ?.raw?.["Return Reason"] ||
                    "",
                  reasonRules,
                ) === f.reason,
            )
            .map((r) => r.id as string)
        : [];
      const sortedCarrierCases = [
        ...new Map(
          [...parcelIdentities]
            .sort((a, b) => a.carrier.localeCompare(b.carrier))
            .map((p) => [p.case_id, p]),
        ).keys(),
      ];
      const tokens = f.q.split(/[\s,;]+/).filter(Boolean);
      const overdueDays = Number(
        (
          await sql`SELECT value FROM system_settings WHERE key='return_overdue_days'`
        )[0]?.value ?? 5,
      );
      const base = sql`SELECT r.*,sh.name shop,ch.name channel,w.name warehouse,u.name assignee,
  COALESCE(p.parcels,0)::int parcels,COALESCE(p.received,0)::int received,p.received_at,
  COALESCE(i.quantity,0)::int quantity,COALESCE(i.received_quantity,0)::int received_quantity,COALESCE(i.missing_sku,0)::int missing_sku,
  COALESCE(cl.claims,0)::int claims,COALESCE(cl.requested_amount,0) claim_requested,COALESCE(cl.approved_amount,0) claim_approved,COALESCE(cl.received_amount,0) claim_received,
  (COALESCE(cl.claim_success,false) OR r.processing_status IN ('claim_won','compensated')) claim_success,
  (COALESCE(cl.claim_open,false) OR r.processing_status IN ('claim_open','claim_submitted')) claim_open,
  (NOT r.no_physical_return AND COALESCE(p.received,0)=0 AND r.platform_substatus NOT IN ('Request Canceled') AND
   COALESCE(r.expected_at,((r.requested_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date+${overdueDays}::int))<(now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date) overdue,
  (SELECT filename FROM return_imports WHERE id=r.last_import_id) source_file,
  (SELECT created_at FROM return_imports WHERE id=r.last_import_id) imported_at
 FROM return_cases r JOIN shops sh ON sh.id=r.shop_id JOIN sales_channels ch ON ch.id=sh.channel_id JOIN warehouses w ON w.id=r.warehouse_id LEFT JOIN users u ON u.id=r.assigned_to
 LEFT JOIN LATERAL(SELECT count(*) parcels,count(received_at) received,max(received_at) received_at FROM return_parcels WHERE case_id=r.id AND active) p ON true
 LEFT JOIN LATERAL(SELECT sum(expected_qty) quantity,sum(received_qty) received_quantity,count(*) FILTER(WHERE seller_sku='') missing_sku FROM return_items WHERE case_id=r.id AND active) i ON true
 LEFT JOIN LATERAL(SELECT count(*) claims,sum(requested_amount) requested_amount,sum(approved_amount) approved_amount,sum(received_amount) received_amount,bool_or(status IN ('won','paid')) claim_success,bool_or(status IN ('open','submitted')) claim_open FROM return_claims WHERE case_id=r.id) cl ON true`;
      const date =
        f.dateType === "received"
          ? sql`b.received_at`
          : f.dateType === "imported"
            ? sql`b.imported_at`
            : sql`b.requested_at`;
      const filter = sql`(${!f.from} OR (${date} AT TIME ZONE 'Asia/Ho_Chi_Minh')::date>=${f.from ?? null}::date) AND (${!f.to} OR (${date} AT TIME ZONE 'Asia/Ho_Chi_Minh')::date<=${f.to ?? null}::date)
 AND (${!f.channel} OR b.channel=${f.channel}) AND (${!f.warehouse} OR b.warehouse_id=${f.warehouse || null}::uuid) AND (${!f.shop} OR b.shop=${f.shop})
 AND (${!tokens.length} OR b.external_id=ANY(${tokens}::text[]) OR b.order_code=ANY(${tokens}::text[]) OR EXISTS(SELECT 1 FROM return_parcels p WHERE p.case_id=b.id AND p.tracking_code=ANY(${tokens}::text[])) OR b.external_id ILIKE ${"%" + f.q + "%"} OR b.order_code ILIKE ${"%" + f.q + "%"})
 AND (${!f.carrier}
 OR (${f.carrierScope === "exclusive" || f.carrier === "mixed"} AND b.id=ANY(${exclusiveCases}::uuid[]))
 OR (${f.carrierScope !== "exclusive" && f.carrier !== "mixed"} AND b.id=ANY(${carrierCases}::uuid[]))
 OR (${f.carrier === "no_tracking"} AND b.parcels=0))
 AND (${!f.reason} OR b.id=ANY(${reasonCases}::uuid[]))
 AND (${!f.state} OR b.processing_status=${f.state} OR (b.inspection_status=${f.state} AND (b.inspection_status<>'full' OR NOT b.inspection_stale))
 OR (${f.state === "unreceived"} AND b.received=0 AND NOT b.no_physical_return AND b.platform_substatus<>'Request Canceled')
 OR (${f.state === "received"} AND b.received>0)
 OR (${f.state === "approved"} AND b.id=ANY(${approvedIds}::uuid[]))
 OR (${f.state === "missing_tracking"} AND b.parcels=0)
 OR (${f.state === "overdue"} AND b.overdue)
 OR (${f.state === "stale"} AND b.inspection_stale)
 OR (${f.state === "claims"} AND b.claims>0)
 OR (${f.state === "claims_or_lost"} AND (b.claims>0 OR b.processing_status IN ('lost','suspected_lost','claim_open','claim_submitted','claim_won','claim_lost','compensated')))
 OR (${f.state === "claim_success"} AND b.claim_success)
 OR (${f.state === "open_claims"} AND b.claim_open)
 OR (${f.state === "waiting_inspection"} AND b.received>0 AND (b.inspection_status='pending' OR b.inspection_stale))
 OR (${f.state === "partial_receipt"} AND b.received>0 AND b.received<b.parcels)
 OR (${f.state === "excluded"} AND b.received=0 AND (b.no_physical_return OR b.platform_substatus='Request Canceled')))`;
      const [totals] =
        await sql`WITH b AS (${base}),filtered AS(SELECT * FROM b WHERE ${filter}) SELECT count(*)::int requests,count(DISTINCT (shop_id,order_code))::int orders,
 (SELECT count(DISTINCT tracking_code)::int FROM return_parcels WHERE active AND case_id IN(SELECT id FROM filtered)) tracking_codes,
 COALESCE(sum(parcels),0)::int parcels,COALESCE(sum(quantity),0)::int quantity,count(*) FILTER(WHERE received=0 AND NOT no_physical_return AND platform_substatus<>'Request Canceled')::int unreceived,
 count(*) FILTER(WHERE received>0)::int received,count(*) FILTER(WHERE inspection_status='full' AND NOT inspection_stale)::int full,
 count(*) FILTER(WHERE overdue)::int overdue,count(*) FILTER(WHERE parcels=0)::int missing_tracking,count(*) FILTER(WHERE claims>0)::int claims,
 count(*) FILTER(WHERE inspection_stale)::int stale,
 count(*) FILTER(WHERE processing_status='lost')::int lost,
 count(*) FILTER(WHERE claim_success)::int claim_success,
 count(*) FILTER(WHERE claim_open)::int open_claims,
 count(*) FILTER(WHERE received>0 AND (inspection_status='pending' OR inspection_stale))::int waiting_inspection,
 count(*) FILTER(WHERE received>0 AND received<parcels)::int partial_receipt,
 count(*) FILTER(WHERE received=0 AND (no_physical_return OR platform_substatus='Request Canceled'))::int excluded,
 COALESCE(sum(claim_requested),0) claim_requested,COALESCE(sum(claim_approved),0) claim_approved,COALESCE(sum(claim_received),0) claim_received FROM filtered`;
      const rows =
        await sql`WITH b AS (${base}) SELECT * FROM b WHERE ${filter} ORDER BY ${f.sort === "carrier" ? sql`array_position(${sortedCarrierCases}::uuid[],b.id),` : sql``} requested_at DESC,id LIMIT ${all ? 10001 : 50} OFFSET ${all ? 0 : (f.page - 1) * 50}`;
      if (all && rows.length > 10000)
        throw new AppError(400, "Xuất tối đa 10.000 yêu cầu; thu hẹp bộ lọc");
      const events =
        await sql`SELECT e.*,u.name employee FROM return_events e JOIN users u ON u.id=e.actor_id WHERE actor_id=${user.id} ORDER BY e.created_at DESC LIMIT 20`;
      const channels =
        await sql`WITH b AS (${base}) SELECT channel,count(*)::int requests,sum(parcels)::int parcels,sum(received)::int received FROM b WHERE ${filter} GROUP BY channel ORDER BY channel`;
      const carriers =
        await sql`WITH b AS (${base}), filtered AS(SELECT * FROM b WHERE ${filter}),
 identities AS (SELECT * FROM jsonb_to_recordset(${sql.json(identities)}) AS x(case_id uuid,carrier_id text,carrier text))
 SELECT coalesce(i.carrier_id,'no_tracking') id,coalesce(i.carrier,${returnCarrierGroups.no_tracking}) name,
 count(*)::int requests,count(*) FILTER(WHERE b.received>0)::int received,
 count(*) FILTER(WHERE b.received=0 AND NOT b.no_physical_return AND b.platform_substatus<>'Request Canceled')::int unreceived,
 count(*) FILTER(WHERE b.processing_status='lost')::int lost,
 count(*) FILTER(WHERE b.claim_success)::int claim_success
 FROM filtered b LEFT JOIN identities i ON i.case_id=b.id GROUP BY i.carrier_id,i.carrier ORDER BY requests DESC,name`;
      const trend =
        await sql`WITH b AS (${base}) SELECT to_char(requested_at AT TIME ZONE 'Asia/Ho_Chi_Minh','YYYY-MM-DD') AS bucket_day,count(*)::int requests,count(*) FILTER(WHERE received>0)::int received FROM b WHERE ${filter} GROUP BY bucket_day ORDER BY bucket_day DESC LIMIT 60`;
      for (const r of rows) {
        const parcels = parcelIdentities.filter((p) => p.case_id === r.id);
        r.return_tracking = parcels.map((p) => p.tracking_code).join(", ");
        r.return_carriers =
          [...new Set(parcels.map((p) => p.carrier))].join(", ") ||
          returnCarrierGroups.no_tracking;
        r.carrier_conflict = parcels.some((p) => p.conflict);
      }
      return {
        rows,
        totals,
        page: f.page,
        events,
        overdueDays,
        channels,
        carriers,
        trend: trend.reverse().map((r) => ({ ...r, day: r.bucket_day })),
      };
    },
  );
}
export async function returnDetail(user: User, id: string) {
  z.uuid().parse(id);
  const sql = db();
  const [r] =
    await sql`SELECT r.*,sh.name shop,ch.name channel,w.name warehouse FROM return_cases r JOIN shops sh ON sh.id=r.shop_id JOIN sales_channels ch ON ch.id=sh.channel_id JOIN warehouses w ON w.id=r.warehouse_id WHERE r.id=${id}`;
  if (!r) throw new AppError(404, "Không tìm thấy yêu cầu hoàn");
  const [items, parcels, events, claims, evidence] = await Promise.all([
    sql`SELECT * FROM return_items WHERE case_id=${id} ORDER BY active DESC,sku_id`,
    sql`SELECT p.*,u.name employee,c.name carrier FROM return_parcels p LEFT JOIN users u ON u.id=p.received_by LEFT JOIN shipping_carriers c ON c.id=p.carrier_id WHERE p.case_id=${id} ORDER BY p.tracking_code`,
    sql`SELECT e.*,u.name employee FROM return_events e JOIN users u ON u.id=e.actor_id WHERE case_id=${id} ORDER BY e.created_at DESC LIMIT 200`,
    sql`SELECT * FROM return_claims WHERE case_id=${id} ORDER BY updated_at DESC`,
    sql`SELECT id,filename,mime,created_at FROM return_evidence WHERE case_id=${id} ORDER BY created_at DESC`,
  ]);
  const catalog = await carrierCatalog(sql);
  return {
    record: r,
    items,
    parcels: parcels.map((p: any): any => ({
      ...p,
      identification: identifyCarrier(
        catalog,
        p.tracking_code,
        p.source_carrier,
        p.carrier_origin === "manual" ? p.carrier_id : null,
      ),
    })),
    events,
    claims,
    evidence,
  };
}
const receiveSchema = z.object({
  code: z.string().min(1).max(2048),
  requestId: z.uuid(),
  warehouseId: warehouseIdSchema,
  shiftId: z.uuid(),
  parcelId: z.uuid().optional(),
  method: z.enum(["manual", "hid", "camera"]).default("manual"),
});
export async function receiveReturn(user: User, raw: unknown) {
  const d = receiveSchema.parse(raw),
    code = normalizeCode(d.code);
  if (!validCode(code)) throw new AppError(400, "Mã vận đơn không hợp lệ");
  return db().begin(async (tx) => {
    await tx`SELECT pg_advisory_xact_lock(hashtextextended(${d.requestId},0))`;
    const [prior] =
      await tx`SELECT * FROM return_events WHERE request_id=${d.requestId}`;
    if (prior) {
      if (
        prior.actor_id !== user.id ||
        Object.entries(d).some(([k, v]) => prior.data.payload[k] !== v)
      )
        throw new AppError(409, "Mã thao tác đã dùng cho nội dung khác");
      return { ...prior.data.response, eventId: prior.id };
    }
    if (
      (
        await tx`SELECT request_id FROM retired_requests WHERE kind='returns' AND request_id=${d.requestId}`
      ).length
    )
      throw new AppError(
        410,
        "Lượt nhận hoàn cũ đã được dọn. Không ghi nhận lại bằng mã yêu cầu cũ.",
      );
    const catalog = await carrierCatalog(tx);
    let identification = identifyCarrier(catalog, code);
    const [shift] =
      await tx`SELECT s.id FROM work_shifts s JOIN shift_members m ON m.shift_id=s.id WHERE s.id=${d.shiftId} AND s.warehouse_id=${d.warehouseId} AND m.user_id=${user.id} AND s.starts_at<=clock_timestamp() AND s.ends_at>clock_timestamp()`;
    if (!shift)
      throw new AppError(
        403,
        "Chọn ca đang hoạt động và được phân công đúng kho",
      );
    // Lock parent case first, shared with imports/inspection/undo to prevent races.
    const candidates =
      await tx`SELECT p.id,p.case_id,r.external_id,r.order_code,sh.name shop,ch.name channel FROM return_parcels p JOIN return_cases r ON r.id=p.case_id JOIN shops sh ON sh.id=r.shop_id JOIN sales_channels ch ON ch.id=sh.channel_id WHERE p.tracking_code=${code} AND p.active AND r.warehouse_id=${d.warehouseId} AND NOT r.no_physical_return ORDER BY p.id`;
    const selected = d.parcelId
      ? candidates.find((p) => p.id === d.parcelId)
      : candidates.length === 1
        ? candidates[0]
        : null;
    if (d.parcelId && !selected)
      throw new AppError(409, "Kiện đã chọn không khớp mã/kho");
    let response: any;
    if (!selected)
      response = {
        outcome: candidates.length ? "ambiguous" : "unknown",
        code,
        candidates,
      };
    else {
      await tx`SELECT id FROM return_cases WHERE id=${selected.case_id} FOR UPDATE`;
      const [p] =
        await tx`SELECT p.*,r.no_physical_return,r.warehouse_id FROM return_parcels p JOIN return_cases r ON r.id=p.case_id WHERE p.id=${selected.id}`;
      if (
        !p ||
        !p.active ||
        p.no_physical_return ||
        p.warehouse_id !== d.warehouseId
      )
        throw new AppError(409, "Kiện đã thay đổi, cần tìm lại");
      identification = identifyCarrier(
        catalog,
        code,
        p.source_carrier,
        p.carrier_origin === "manual" ? p.carrier_id : null,
      );
      if (p.received_at) {
        const [employee] =
          await tx`SELECT name FROM users WHERE id=${p.received_by}`;
        response = {
          outcome: "duplicate",
          code,
          caseId: p.case_id,
          parcelId: p.id,
          at: new Date(p.received_at).toISOString(),
          employee: employee.name,
        };
      } else {
        const [updated] =
          await tx`UPDATE return_parcels SET received_at=clock_timestamp(),received_by=${user.id} WHERE id=${p.id} RETURNING received_at`;
        await tx`UPDATE return_cases SET version=version+1,updated_at=now() WHERE id=${p.case_id}`;
        response = {
          outcome: "received",
          code,
          caseId: p.case_id,
          parcelId: p.id,
          at: new Date(updated.received_at).toISOString(),
          employee: user.name,
        };
      }
    }
    response.carrierIdentification = identification;
    const [event] =
      await tx`INSERT INTO return_events(case_id,parcel_id,request_id,actor_id,shift_id,action,code,data) VALUES(${response.caseId ?? null},${response.parcelId ?? null},${d.requestId},${user.id},${d.shiftId},${response.outcome},${code},${tx.json({ payload: d, response })}) RETURNING id`;
    return { ...response, eventId: event.id };
  });
}
export async function inspectReturn(user: User, raw: unknown) {
  const d = z
    .object({
      id: z.uuid(),
      version: z.number().int(),
      condition: z.enum(["full", "short", "damaged", "wrong", "empty"]),
      location: z.string().max(200).default(""),
      note: z.string().min(3).max(2000),
      items: z
        .array(
          z.object({
            id: z.uuid(),
            quantity: z.number().int().min(0).max(100000),
          }),
        )
        .min(1)
        .max(1000),
    })
    .parse(raw);
  return db().begin(async (tx) => {
    const [r] =
      await tx`SELECT * FROM return_cases WHERE id=${d.id} FOR UPDATE`;
    if (!r) throw new AppError(404, "Không tìm thấy yêu cầu");
    if (r.version !== d.version)
      throw new AppError(
        409,
        "Dữ liệu đã thay đổi; mở lại chi tiết trước khi kiểm nhận",
      );
    const parcels =
      await tx`SELECT * FROM return_parcels WHERE case_id=${d.id} AND active`;
    if (
      r.no_physical_return ||
      !parcels.length ||
      parcels.some((p) => !p.received_at)
    )
      throw new AppError(
        409,
        "Phải nhận đủ các kiện đã khai báo trước khi kiểm nhận toàn yêu cầu",
      );
    const items =
      await tx`SELECT * FROM return_items WHERE case_id=${d.id} AND active`;
    if (
      items.length !== d.items.length ||
      new Set(d.items.map((i) => i.id)).size !== items.length ||
      items.some((i) => !d.items.some((x) => x.id === i.id))
    )
      throw new AppError(400, "Kiểm đếm phải có đủ mọi SKU đang hoạt động");
    if (
      d.condition === "full" &&
      items.some(
        (i) => d.items.find((x) => x.id === i.id)!.quantity !== i.expected_qty,
      )
    )
      throw new AppError(400, "Nhận đủ yêu cầu số lượng mỗi SKU bằng nguồn");
    if (
      d.condition === "short" &&
      !items.some(
        (i) => d.items.find((x) => x.id === i.id)!.quantity < i.expected_qty,
      )
    )
      throw new AppError(400, "Chọn thiếu hàng khi ít nhất một SKU thiếu");
    if (d.condition === "empty" && d.items.some((i) => i.quantity !== 0))
      throw new AppError(400, "Kiện rỗng phải có số lượng bằng 0");
    for (const i of d.items)
      await tx`UPDATE return_items SET received_qty=${i.quantity} WHERE id=${i.id}`;
    await tx`UPDATE return_cases SET inspection_status=${d.condition},inspection_stale=false,location=${d.location},version=version+1,updated_at=now() WHERE id=${d.id}`;
    await tx`INSERT INTO return_events(case_id,actor_id,action,reason,data) VALUES(${d.id},${user.id},'inspect',${d.note},${tx.json({ before: items, input: d })})`;
    return { ok: true };
  });
}
export async function updateReturn(user: User, raw: unknown) {
  const d = z
    .object({
      id: z.uuid(),
      version: z.number().int(),
      note: z.string().trim().min(8).max(2000),
      status: z.string().optional(),
      assignedTo: z.union([z.uuid(), z.literal("")]).optional(),
      expectedAt: z.union([z.iso.date(), z.literal("")]).optional(),
      noPhysical: z.boolean().optional(),
    })
    .parse(raw);
  if (
    d.status ||
    d.assignedTo !== undefined ||
    d.expectedAt !== undefined ||
    d.noPhysical !== undefined
  )
    requireRole(user, managerRoles);
  if (d.status && !Object.hasOwn(returnProcessing, d.status))
    throw new AppError(400, "Trạng thái không hợp lệ");
  return db().begin(async (tx) => {
    const [r] =
      await tx`SELECT * FROM return_cases WHERE id=${d.id} FOR UPDATE`;
    if (!r) throw new AppError(404, "Không có yêu cầu");
    if (r.version !== d.version)
      throw new AppError(409, "Dữ liệu đã đổi; tải lại chi tiết");
    if (
      d.assignedTo &&
      !(await tx`SELECT id FROM users WHERE id=${d.assignedTo} AND active`)
        .length
    )
      throw new AppError(400, "Nhân viên không tồn tại hoặc đã khóa");
    const parcels =
      await tx`SELECT * FROM return_parcels WHERE case_id=${d.id} AND active`;
    if (d.noPhysical && parcels.some((p) => p.received_at))
      throw new AppError(
        409,
        "Đã nhận kiện, không thể đổi thành không cần trả hàng",
      );
    if (
      d.status === "compensated" &&
      !(
        await tx`SELECT id FROM return_claims WHERE case_id=${d.id} AND received_amount>0 AND received_on IS NOT NULL`
      ).length
    )
      throw new AppError(
        409,
        "Chưa có số tiền và ngày thực nhận bồi thường để xác nhận đã được bồi hoàn",
      );
    if (
      d.status === "completed" &&
      (
        await tx`SELECT id FROM return_claims WHERE case_id=${d.id} AND status IN ('open','submitted','won')`
      ).length
    )
      throw new AppError(
        409,
        "Còn hồ sơ khiếu nại chưa kết thúc hoặc chưa xác nhận tiền",
      );
    if (
      d.status === "completed" &&
      !(d.noPhysical ?? r.no_physical_return) &&
      (r.inspection_status !== "full" ||
        r.inspection_stale ||
        !parcels.length ||
        parcels.some((p) => !p.received_at))
    )
      throw new AppError(
        409,
        "Chỉ hoàn thành khi kiểm đủ mới nhất, hoặc quản lý xác nhận không yêu cầu trả vật lý",
      );
    await tx`UPDATE return_cases SET processing_status=${d.status ?? r.processing_status},assigned_to=${d.assignedTo === undefined ? r.assigned_to : d.assignedTo || null},expected_at=${d.expectedAt === undefined ? r.expected_at : d.expectedAt || null},no_physical_return=${d.noPhysical ?? r.no_physical_return},version=version+1,updated_at=now() WHERE id=${d.id}`;
    await tx`INSERT INTO return_events(case_id,actor_id,action,reason,data) VALUES(${d.id},${user.id},'update',${d.note},${tx.json({ before: r, change: d })})`;
    return { ok: true };
  });
}
export async function undoReturn(user: User, raw: unknown) {
  const d = z
    .object({ eventId: z.uuid(), reason: z.string().trim().min(8).max(1000) })
    .parse(raw);
  return db().begin(async (tx) => {
    const [event] =
      await tx`SELECT * FROM return_events WHERE id=${d.eventId} AND action='received'`;
    if (!event) throw new AppError(404, "Không có lượt nhận hợp lệ");
    if (
      user.role === "staff" &&
      (event.actor_id !== user.id ||
        Date.now() - new Date(event.created_at).getTime() > 10 * 60 * 1000)
    )
      throw new AppError(
        403,
        "Nhân viên chỉ hoàn tác lượt của mình trong 10 phút",
      );
    await tx`SELECT id FROM return_cases WHERE id=${event.case_id} FOR UPDATE`;
    const later =
      await tx`SELECT id FROM return_events WHERE case_id=${event.case_id} AND created_at>(SELECT created_at FROM return_events WHERE id=${event.id}) AND action NOT IN ('duplicate','unknown','ambiguous')`;
    if (later.length)
      throw new AppError(
        409,
        "Đã có kiểm nhận/cập nhật sau lượt này; không hoàn tác để tránh mất lịch sử",
      );
    await tx`UPDATE return_parcels SET received_at=null,received_by=null WHERE id=${event.parcel_id}`;
    await tx`UPDATE return_cases SET version=version+1,updated_at=now() WHERE id=${event.case_id}`;
    await tx`INSERT INTO return_events(case_id,parcel_id,actor_id,action,reason,data) VALUES(${event.case_id},${event.parcel_id},${user.id},'undo_receive',${d.reason},${tx.json({ eventId: event.id })})`;
    return { ok: true };
  });
}
export async function saveReturnClaim(user: User, raw: unknown) {
  requireRole(user, managerRoles);
  const money = z.number().int().min(0).max(999999999999).nullable();
  const d = z
    .object({
      caseId: z.uuid(),
      id: z.uuid().optional(),
      status: z.enum(["open", "submitted", "won", "lost", "paid", "closed"]),
      reason: z.string().trim().min(8).max(2000),
      deadline: z.iso.date().nullable(),
      requested: money,
      approved: money,
      received: money,
      receivedOn: z.iso.date().nullable(),
    })
    .parse(raw);
  if (d.received !== null && !d.receivedOn)
    throw new AppError(400, "Số tiền thực nhận cần ngày thực nhận để đối soát");
  if (d.status === "paid" && (d.received === null || !d.receivedOn))
    throw new AppError(400, "Đã nhận tiền cần số tiền và ngày thực nhận");
  return db().begin(async (tx) => {
    if (
      !(await tx`SELECT id FROM return_cases WHERE id=${d.caseId} FOR UPDATE`)
        .length
    )
      throw new AppError(404, "Không có yêu cầu");
    const [old] = d.id
      ? await tx`SELECT * FROM return_claims WHERE id=${d.id} AND case_id=${d.caseId}`
      : [];
    if (d.id && !old) throw new AppError(404, "Không có hồ sơ khiếu nại");
    let claim;
    if (old)
      [claim] =
        await tx`UPDATE return_claims SET status=${d.status},reason=${d.reason},deadline=${d.deadline},requested_amount=${d.requested},approved_amount=${d.approved},received_amount=${d.received},received_on=${d.receivedOn},updated_at=now() WHERE id=${d.id!} RETURNING *`;
    else
      [claim] =
        await tx`INSERT INTO return_claims(case_id,status,reason,deadline,requested_amount,approved_amount,received_amount,received_on,created_by) VALUES(${d.caseId},${d.status},${d.reason},${d.deadline},${d.requested},${d.approved},${d.received},${d.receivedOn},${user.id}) RETURNING *`;
    await tx`INSERT INTO return_events(case_id,actor_id,action,reason,data) VALUES(${d.caseId},${user.id},'claim',${d.reason},${tx.json({ before: old ?? null, after: claim })})`;
    await tx`UPDATE return_cases SET version=version+1,updated_at=now() WHERE id=${d.caseId}`;
    return claim;
  });
}
export async function editReturnParcel(user: User, raw: unknown) {
  requireRole(user, managerRoles);
  const d = z
    .object({
      caseId: z.uuid(),
      id: z.uuid().optional(),
      tracking: z.string().max(80).optional(),
      carrierId: z.uuid().nullable().optional(),
      exclude: z.boolean().default(false),
      reason: z.string().trim().min(8).max(1000),
    })
    .parse(raw);
  return db().begin(async (tx) => {
    if (
      !(await tx`SELECT id FROM return_cases WHERE id=${d.caseId} FOR UPDATE`)
        .length
    )
      throw new AppError(404, "Không có yêu cầu");
    let parcel;
    if (d.id) {
      const [p] =
        await tx`SELECT * FROM return_parcels WHERE id=${d.id} AND case_id=${d.caseId}`;
      if (!p) throw new AppError(404, "Không có kiện");
      if (d.exclude && p.received_at)
        throw new AppError(409, "Không loại bỏ kiện đã nhận");
      [parcel] =
        await tx`UPDATE return_parcels SET carrier_origin=CASE WHEN ${d.carrierId !== undefined} THEN 'manual' ELSE carrier_origin END,active=${!d.exclude},carrier_id=${d.carrierId === undefined ? p.carrier_id : d.carrierId} WHERE id=${p.id} RETURNING *`;
    } else {
      const code = normalizeCode(d.tracking ?? "");
      if (!validCode(code)) throw new AppError(400, "Mã không hợp lệ");
      [parcel] =
        await tx`INSERT INTO return_parcels(case_id,tracking_code,carrier_id,carrier_origin) VALUES(${d.caseId},${code},${d.carrierId ?? null},'manual') RETURNING *`;
    }
    await tx`UPDATE return_cases SET version=version+1,inspection_stale=(inspection_status<>'pending'),updated_at=now() WHERE id=${d.caseId}`;
    await tx`INSERT INTO return_events(case_id,parcel_id,actor_id,action,reason,data) VALUES(${d.caseId},${parcel.id},${user.id},'parcel',${d.reason},${tx.json(d)})`;
    return parcel;
  });
}
