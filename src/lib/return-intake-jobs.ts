import { z } from "zod";
import { createHash } from "node:crypto";
import { db, type User } from "./db";
import { AppError, requireRole, managerRoles } from "./domain";
import { ownedJob, digest, stable } from "./jobs";
import { verifyStoredFile } from "./stored-file-verification";
import { requireReturnOperations } from "./return-operations-access";
import {
  normalizeReturnIntake,
  validateIntakeHeaders,
  type WarehouseReceiptRow,
} from "./return-intake-normalize";
import {
  resolveIntakeMapping,
  type ReturnIntakeKind,
} from "./return-intake-fields";
import { commitReturns } from "./returns";
import { recordReturnUpload } from "./return-settings";
import {
  recordPhysicalReturn,
  reconcileReturnReceipts,
} from "./return-receipts";
import type { ReturnFile, ReturnRow } from "./return-table";
import { requestContext, environment } from "../server/context";
import { RETURN_INTAKE_VERSION } from "./return-intake-fields";
const intakeContext = z.object({
  kind: z.enum(["customer_return", "delivery_failed", "warehouse_receipt"]),
  warehouseId: z.uuid(),
  shop: z.string().trim().min(1).max(100),
  channel: z.enum(["TikTok Shop", "Shopee"]),
});
function checkIntake(job: any) {
  if (
    job.route !== "returns/intake/preview" ||
    new Date(job.expires_at).getTime() <= Date.now() ||
    ["cancelled", "failed"].includes(job.status)
  )
    throw new AppError(409, "Đợt nhập không còn hoạt động. Chọn lại tệp gốc.");
}
export async function beginReturnIntake(user: User, id: string, raw: unknown) {
  requireRole(user, managerRoles);
  await requireReturnOperations();
  const input = z
    .object({
      headers: z.array(z.string()).min(1).max(100),
      totalRows: z.number().int().min(1).max(50000),
    })
    .parse(raw);
  validateIntakeHeaders(input.headers);
  const job = await ownedJob(user, id);
  checkIntake(job);
  const c = intakeContext.parse(job.payload.context),
    mapping = job.payload.mapping ?? {};
  const [old] = await db()`SELECT * FROM return_intake_batches WHERE id=${id}`;
  if (old) return old;
  await verifyStoredFile(
    {
      storage_path: job.storage_path,
      file_size: job.file_size,
      sha256: job.sha256,
    },
    job.filename.toLowerCase().endsWith(".xlsx") ? "xlsx" : "csv",
  );
  return db().begin(async (tx) => {
    await tx`SELECT pg_advisory_xact_lock(742920)`;
    const [previous] =
      await tx`SELECT * FROM return_intake_batches WHERE id=${id}`;
    if (previous) return previous;
    if (!(await tx`SELECT id FROM warehouses WHERE id=${c.warehouseId}`).length)
      throw new AppError(
        400,
        "Kho không tồn tại; tải lại danh mục và chọn kho trước khi nhập",
      );
    const identity = digest(
      stable({
        version: RETURN_INTAKE_VERSION,
        hash: job.sha256,
        context: c,
        mapping,
      }),
    );
    const [reused] =
      await tx`SELECT id FROM return_intake_batches WHERE identity_hash=${identity} AND state IN ('completed','archived') ORDER BY created_at LIMIT 1`;
    if (reused) {
      const [oldState] =
        await tx`SELECT state FROM return_intake_batches WHERE id=${reused.id}`;
      if (oldState.state === "archived")
        throw new AppError(
          409,
          "Tệp này đã bị loại bỏ. Admin khôi phục tại Lịch sử nhập dữ liệu; không nhập lại thành nguồn trùng",
        );
    }
    const [batch] =
      await tx`INSERT INTO return_intake_batches(id,kind,warehouse_id,shop,channel,identity_hash,headers,mapping,total_rows,created_by,state,reused_batch_id)
   VALUES(${id},${c.kind},${c.warehouseId},${c.shop},${c.channel},${identity},${tx.json(input.headers)},${tx.json(mapping)},${input.totalRows},${user.id},${reused ? "reused" : "staging"},${reused?.id ?? null}) RETURNING *`;
    if (reused)
      await tx`UPDATE data_jobs SET status='succeeded',result=${tx.json({ batchId: id, reusedBatchId: reused.id, done: true })},updated_at=now() WHERE id=${id}`;
    return {
      ...batch,
      detectedMapping: resolveIntakeMapping(input.headers, mapping, c.kind),
    };
  });
}
export async function appendReturnIntake(user: User, id: string, raw: unknown) {
  requireRole(user, managerRoles);
  const input = z
    .object({
      offset: z.number().int().min(0),
      rows: z
        .array(z.array(z.string().max(32768)).max(100))
        .min(1)
        .max(200),
    })
    .parse(raw);
  const job = await ownedJob(user, id);
  checkIntake(job);
  return db().begin(async (tx) => {
    const [b] =
      await tx`SELECT * FROM return_intake_batches WHERE id=${id} AND created_by=${user.id} FOR UPDATE`;
    if (!b || b.state !== "staging")
      throw new AppError(409, "Đợt nhập không ở bước đọc dữ liệu");
    const fingerprint = digest(stable(input));
    if (
      input.offset < b.staged_rows &&
      b.summary.chunks?.[String(input.offset)] === fingerprint
    )
      return { stagedRows: b.staged_rows, totalRows: b.total_rows };
    if (
      input.offset !== b.staged_rows ||
      input.offset + input.rows.length > b.total_rows
    )
      throw new AppError(
        409,
        "Dòng nhập thiếu, lặp hoặc sai thứ tự; chọn lại tệp để tiếp tục",
      );
    const rows = input.rows.map((values, index) => {
      const rowNumber = input.offset + index + 2,
        raw = Object.fromEntries(
          b.headers.map((h: string, c: number) => [h, values[c] ?? ""]),
        );
      try {
        if (values.slice(b.headers.length).some((v) => v.trim()))
          throw new Error(
            "Dòng có nội dung ngoài cột tiêu đề; bổ sung tiêu đề trước khi nhập",
          );
        const parsed = normalizeReturnIntake(
          raw,
          b.headers,
          b.kind,
          b.mapping,
          rowNumber,
        );
        const normalized = parsed.row ?? parsed.receipt;
        return {
          batch_id: id,
          row_number: rowNumber,
          raw,
          normalized,
          request_key:
            parsed.row?.request ??
            parsed.receipt!.tracking + "|" + parsed.receipt!.order,
          item_key: parsed.row?.itemKey ?? "",
          tracking_code: normalized.tracking,
          order_code: normalized.order,
          error: "",
          warnings: parsed.warnings,
        };
      } catch (error) {
        return {
          batch_id: id,
          row_number: rowNumber,
          raw,
          normalized: null,
          request_key: "",
          item_key: "",
          tracking_code: "",
          order_code: "",
          error: (error as Error).message,
          warnings: [],
        };
      }
    });
    await tx`INSERT INTO return_intake_rows(batch_id,row_number,raw,normalized,request_key,item_key,tracking_code,order_code,error,warnings) SELECT x.* FROM jsonb_to_recordset(${tx.json(rows)}) AS x(batch_id uuid,row_number integer,raw jsonb,normalized jsonb,request_key text,item_key text,tracking_code text,order_code text,error text,warnings jsonb)`;
    await tx`UPDATE return_intake_batches SET staged_rows=staged_rows+${rows.length},summary=${tx.json({ ...b.summary, chunks: { ...b.summary.chunks, [String(input.offset)]: fingerprint } })} WHERE id=${id}`;
    return { stagedRows: input.offset + rows.length, totalRows: b.total_rows };
  });
}
export async function previewReturnIntake(user: User, id: string) {
  requireRole(user, managerRoles);
  await ownedJob(user, id);
  return db().begin(async (tx) => {
    await tx`SET LOCAL jit=off`;
    const [b] =
      await tx`SELECT * FROM return_intake_batches WHERE id=${id} AND created_by=${user.id} FOR UPDATE`;
    if (!b) throw new AppError(404, "Không có đợt nhập");
    if (b.state === "completed")
      return {
        batch: b,
        summary: b.summary,
        rows: [],
        errors: [],
        canCommit: false,
        completed: true,
      };
    if (b.state === "reused") {
      const [original] =
        await tx`SELECT summary FROM return_intake_batches WHERE id=${b.reused_batch_id}`;
      return {
        batch: b,
        summary: { ...original?.summary, reused: true },
        rows: [],
        errors: [],
        canCommit: true,
        detectedMapping: resolveIntakeMapping(b.headers, b.mapping, b.kind),
      };
    }
    if (b.staged_rows !== b.total_rows)
      throw new AppError(409, "Chưa đọc đủ mọi dòng trong tệp");
    if (b.kind !== "warehouse_receipt") {
      await tx`WITH duplicates AS MATERIALIZED(SELECT request_key,item_key,min(row_number) first_row FROM return_intake_rows WHERE batch_id=${id} AND error='' GROUP BY request_key,item_key HAVING count(*)>1 AND count(DISTINCT raw::text)=1 AND count(DISTINCT (normalized-'row')::text)=1)
    UPDATE return_intake_rows r SET duplicate=true FROM duplicates d WHERE r.batch_id=${id} AND r.request_key=d.request_key AND r.item_key=d.item_key AND r.row_number<>d.first_row`;
      await tx`WITH conflicts AS MATERIALIZED(SELECT request_key FROM return_intake_rows WHERE batch_id=${id} AND error='' AND NOT duplicate GROUP BY request_key HAVING count(DISTINCT order_code)>1 OR count(DISTINCT item_key)<>count(*) OR count(DISTINCT normalized->>'status')>1 OR count(DISTINCT normalized->>'type')>1)
    UPDATE return_intake_rows r SET error='Hồ sơ có dòng SKU, mã đơn hoặc trạng thái mâu thuẫn; cần mã dòng riêng/ánh xạ và xác minh, không tự gộp' FROM conflicts c WHERE r.batch_id=${id} AND r.request_key=c.request_key`;
      await tx`UPDATE return_intake_rows x SET error='Mã yêu cầu đã có ở đơn/kho khác; cần xác minh' FROM return_cases r JOIN shops sh ON sh.id=r.shop_id JOIN sales_channels ch ON ch.id=sh.channel_id
    WHERE x.batch_id=${id} AND r.external_id=x.request_key AND sh.name=${b.shop} AND ch.name=${b.channel} AND (r.order_code<>x.order_code OR r.warehouse_id<>${b.warehouse_id})`;
    }
    if (b.kind === "warehouse_receipt") {
      await tx`WITH duplicates AS MATERIALIZED(SELECT request_key,normalized->>'sku' sku,min(row_number) first_row FROM return_intake_rows WHERE batch_id=${id} AND error='' GROUP BY request_key,normalized->>'sku' HAVING count(*)>1 AND count(DISTINCT (normalized-'raw')::text)=1) UPDATE return_intake_rows r SET duplicate=true FROM duplicates d WHERE r.batch_id=${id} AND r.request_key=d.request_key AND r.normalized->>'sku'=d.sku AND r.row_number<>d.first_row`;
      await tx`WITH conflicts AS MATERIALIZED(SELECT request_key FROM return_intake_rows WHERE batch_id=${id} AND error='' AND NOT duplicate GROUP BY request_key HAVING count(DISTINCT normalized->>'receivedAt')>1 OR count(DISTINCT normalized->>'sourceCarrier')>1 OR count(DISTINCT normalized->>'sku')<>count(*)) UPDATE return_intake_rows r SET error='Bằng chứng nhận cùng mã có SKU hoặc giờ/hãng mâu thuẫn; xác minh trước khi nhập' FROM conflicts c WHERE r.batch_id=${id} AND r.request_key=c.request_key`;
    }
    if (b.kind !== "warehouse_receipt") {
      await tx`UPDATE return_intake_rows x SET preview_source_hash=r.source_hash FROM return_cases r JOIN shops sh ON sh.id=r.shop_id JOIN sales_channels ch ON ch.id=sh.channel_id WHERE x.batch_id=${id} AND x.request_key=r.external_id AND sh.name=${b.shop} AND ch.name=${b.channel}`;
      await tx`UPDATE return_intake_rows x SET error='Thời gian trạng thái trong file cũ hơn nguồn đang có; không ghi lùi trạng thái' FROM return_cases r JOIN shops sh ON sh.id=r.shop_id JOIN sales_channels ch ON ch.id=sh.channel_id WHERE x.batch_id=${id} AND x.request_key=r.external_id AND sh.name=${b.shop} AND ch.name=${b.channel} AND nullif(x.normalized->'meta'->>'platformUpdated','')::timestamptz<r.platform_updated_at`;
    }
    if (b.kind === "warehouse_receipt")
      await tx`UPDATE return_intake_rows x SET preview_source_hash=r.id::text FROM return_receipts r WHERE x.batch_id=${id} AND r.warehouse_id=${b.warehouse_id} AND r.source_active AND ((x.tracking_code<>'' AND x.tracking_code=r.tracking_code) OR (x.tracking_code='' AND r.tracking_code='' AND x.order_code=r.order_code AND r.shop_id IN (SELECT sh.id FROM shops sh JOIN sales_channels ch ON ch.id=sh.channel_id WHERE sh.name=${b.shop} AND ch.name=${b.channel})))`;
    const [summary] =
      await tx`SELECT count(*)::int rows,count(*) FILTER(WHERE error='' AND NOT duplicate)::int valid,count(*) FILTER(WHERE error<>'')::int errors,count(*) FILTER(WHERE duplicate)::int duplicates,count(DISTINCT request_key) FILTER(WHERE error='' AND NOT duplicate)::int requests,count(DISTINCT order_code) FILTER(WHERE error='' AND order_code<>'')::int orders,count(DISTINCT tracking_code) FILTER(WHERE error='' AND tracking_code<>'')::int tracking,count(*) FILTER(WHERE jsonb_array_length(warnings)>0)::int warnings,count(DISTINCT request_key) FILTER(WHERE error='' AND NOT duplicate AND preview_source_hash IS NULL)::int new_requests,count(DISTINCT request_key) FILTER(WHERE error='' AND NOT duplicate AND preview_source_hash IS NOT NULL)::int existing_requests,min(coalesce(normalized->>'requested',normalized->>'receivedAt')) from_date,max(coalesce(normalized->>'requested',normalized->>'receivedAt')) to_date FROM return_intake_rows WHERE batch_id=${id}`;
    const rows =
      await tx`SELECT x.row_number,x.normalized,x.warnings,x.duplicate,r.platform_status previous_status,r.source_order_amount::text previous_order_amount,r.source_refund_amount::text previous_refund_amount FROM return_intake_rows x LEFT JOIN return_cases r ON r.external_id=x.request_key AND r.shop_id IN (SELECT sh.id FROM shops sh JOIN sales_channels ch ON ch.id=sh.channel_id WHERE sh.name=${b.shop} AND ch.name=${b.channel}) WHERE x.batch_id=${id} AND x.error='' ORDER BY x.row_number LIMIT 100`;
    const errors =
      await tx`SELECT row_number,error,raw FROM return_intake_rows WHERE batch_id=${id} AND error<>'' ORDER BY row_number LIMIT 100`;
    await tx`UPDATE return_intake_batches SET state=${summary.errors ? "needs_fix" : "ready"},summary=${tx.json({ ...b.summary, ...summary })} WHERE id=${id} AND state IN ('staging','ready','needs_fix')`;
    return {
      batch: { ...b, state: summary.errors ? "needs_fix" : "ready" },
      summary,
      rows,
      errors,
      canCommit: summary.errors === 0 && summary.valid > 0,
      detectedMapping: resolveIntakeMapping(b.headers, b.mapping, b.kind),
    };
  });
}
export async function commitReturnIntakeStep(user: User, id: string) {
  requireRole(user, managerRoles);
  const job = await ownedJob(user, id);
  const [initial] =
    await db()`SELECT * FROM return_intake_batches WHERE id=${id} AND created_by=${user.id}`;
  if (!initial) throw new AppError(404, "Không có đợt nhập");
  if (initial.state === "completed" || initial.state === "reused")
    return { done: true, batch: initial, reused: initial.state === "reused" };
  if (!["ready", "committing"].includes(initial.state))
    throw new AppError(409, "Cần xem trước tệp không còn lỗi trước khi nhập");
  if (initial.state === "ready")
    await verifyStoredFile(
      {
        storage_path: job.storage_path,
        file_size: job.file_size,
        sha256: job.sha256,
      },
      job.filename.toLowerCase().endsWith(".xlsx") ? "xlsx" : "csv",
    );
  const parent = requestContext.getStore();
  return db().begin(async (tx) => {
    await tx`SELECT pg_advisory_xact_lock(742920)`;
    const [b] =
      await tx`SELECT * FROM return_intake_batches WHERE id=${id} AND created_by=${user.id} FOR UPDATE`;
    if (b.state === "completed") return { done: true, batch: b };
    if (!["ready", "committing"].includes(b.state))
      throw new AppError(409, "Đợt nhập đã đổi trạng thái");
    const keys =
      await tx`SELECT request_key FROM (SELECT request_key,count(*) n,sum(count(*)) OVER(ORDER BY request_key) cumulative FROM return_intake_rows WHERE batch_id=${id} AND error='' AND NOT duplicate AND NOT imported GROUP BY request_key) grouped WHERE cumulative<=2000 OR cumulative=n ORDER BY request_key LIMIT 100`;
    if (!keys.length) {
      await tx`UPDATE return_intake_batches SET state='completed' WHERE id=${id}`;
      await tx`UPDATE data_jobs SET status='succeeded',result=${tx.json({ batchId: id, done: true })},updated_at=now() WHERE id=${id}`;
      return { done: true, batch: { ...b, state: "completed" } };
    }
    const staged =
      await tx`SELECT * FROM return_intake_rows WHERE batch_id=${id} AND request_key IN ${tx(keys.map((k) => k.request_key))} AND error='' AND NOT duplicate AND NOT imported ORDER BY row_number`;
    if (staged.length > 2000)
      throw new AppError(
        413,
        "Một hồ sơ vượt 2.000 dòng, cần xác minh cấu trúc trước khi nhập",
      );
    if (b.kind !== "warehouse_receipt") {
      const [changed] =
        await tx`SELECT 1 FROM return_intake_rows x LEFT JOIN return_cases r ON r.external_id=x.request_key AND r.shop_id IN (SELECT sh.id FROM shops sh JOIN sales_channels ch ON ch.id=sh.channel_id WHERE sh.name=${b.shop} AND ch.name=${b.channel}) WHERE x.batch_id=${id} AND x.row_number IN ${tx(staged.map((r) => r.row_number))} AND x.preview_source_hash IS DISTINCT FROM r.source_hash LIMIT 1`;
      if (changed)
        throw new AppError(
          409,
          "Nguồn đã thay đổi sau xem trước. Đọc lại và xem thay đổi trước khi tiếp tục; các lô đã lưu vẫn được giữ",
        );
    }
    let importId: string | null = null;
    if (b.kind === "warehouse_receipt") {
      const [channel] =
        await tx`INSERT INTO sales_channels(name) VALUES(${b.channel}) ON CONFLICT(name) DO UPDATE SET name=excluded.name RETURNING id`;
      const [shop] =
        await tx`INSERT INTO shops(name,channel_id) VALUES(${b.shop},${channel.id}) ON CONFLICT(channel_id,name) DO UPDATE SET name=excluded.name RETURNING id`;
      const groups = new Map<string, WarehouseReceiptRow[]>();
      for (const row of staged) {
        const group = groups.get(row.request_key) ?? [];
        group.push(row.normalized as WarehouseReceiptRow);
        groups.set(row.request_key, group);
      }
      for (const records of groups.values()) {
        const p = records[0];
        await recordPhysicalReturn(tx, user, {
          code: p.tracking,
          order: p.order,
          warehouseId: b.warehouse_id,
          shopId: shop.id,
          employee: p.employee,
          courier: p.courier,
          sourceCarrier: p.sourceCarrier,
          note: p.note,
          at: p.receivedAt,
          source: "warehouse_file",
          importId: id,
          skuEvidence: records
            .filter((r) => r.sku && r.quantity !== null)
            .map((r) => ({ sku: r.sku, quantity: r.quantity! })),
        });
      }
      await reconcileReturnReceipts(
        tx,
        user,
        staged.map((r) => r.tracking_code).filter(Boolean),
        staged.map((r) => r.order_code).filter(Boolean),
        { warehouseId: b.warehouse_id, limit: 2000 },
      );
    } else {
      const rows = staged.map((r) => r.normalized as ReturnRow);
      const file: ReturnFile & {
        workflow: Exclude<ReturnIntakeKind, "warehouse_receipt">;
      } = {
        hash: createHash("sha256")
          .update(
            b.identity_hash + ":" + keys.map((k) => k.request_key).join("|"),
          )
          .digest("hex"),
        channel: b.channel,
        workflow: b.kind,
        rows,
        errors: [],
        summary: {
          rows: rows.length,
          requests: keys.length,
          orders: new Set(rows.map((r) => r.order)).size,
          tracking: new Set(rows.map((r) => r.tracking).filter(Boolean)).size,
          quantity: rows.reduce((n, r) => n + r.quantity, 0),
          missingTracking: rows.filter((r) => !r.tracking).length,
          missingSellerSku: rows.filter((r) => !r.sellerSku).length,
          warnings: rows.filter((r) => r.warnings.length).length,
        },
      };
      const bound = new Proxy(tx, {
        get(target, key) {
          if (key === "begin")
            return (first: any, second?: any) =>
              target.savepoint(typeof first === "function" ? first : second);
          return Reflect.get(target, key);
        },
      });
      const result = await requestContext.run(
        {
          ...parent,
          env: environment(),
          sql: bound as any,
          cookies: parent?.cookies ?? [],
          pending: parent?.pending ?? [],
        },
        () =>
          commitReturns(user, file, job.filename, {
            warehouseId: b.warehouse_id,
            shop: b.shop,
          }),
      );
      importId = result.id;
    }
    await tx`UPDATE return_intake_rows SET imported=true,import_id=${importId} WHERE batch_id=${id} AND row_number IN ${tx(staged.map((r) => r.row_number))}`;
    const [left] =
      await tx`SELECT count(*)::int n FROM return_intake_rows WHERE batch_id=${id} AND error='' AND NOT duplicate AND NOT imported`;
    const [after] =
      await tx`UPDATE return_intake_batches SET imported_rows=imported_rows+${staged.length},state=${left.n ? "committing" : "completed"} WHERE id=${id} RETURNING *`;
    if (!left.n)
      await tx`UPDATE data_jobs SET status='succeeded',result=${tx.json({ batchId: id, done: true })},updated_at=now() WHERE id=${id}`;
    return { done: left.n === 0, batch: after };
  });
}

export async function returnIntakeErrors(user: User, id: string, raw: unknown) {
  requireRole(user, managerRoles);
  await ownedJob(user, id);
  const d = z
    .object({ offset: z.number().int().min(0).max(50000).default(0) })
    .parse(raw);
  const [b] =
    await db()`SELECT headers FROM return_intake_batches WHERE id=${id} AND created_by=${user.id}`;
  if (!b) throw new AppError(404, "Không có đợt nhập");
  const rows =
    await db()`SELECT row_number,error,raw FROM return_intake_rows WHERE batch_id=${id} AND error<>'' ORDER BY row_number LIMIT 1000 OFFSET ${d.offset}`;
  return { headers: b.headers, rows, done: rows.length < 1000 };
}

export async function recordReturnIntakeReadError(
  user: User,
  id: string,
  raw: unknown,
) {
  requireRole(user, managerRoles);
  const d = z
    .object({ message: z.string().trim().min(1).max(1000) })
    .parse(raw);
  const job = await ownedJob(user, id);
  if (job.route !== "returns/intake/preview")
    throw new AppError(400, "Không đúng tác vụ nhập hàng hoàn");
  const [batch] =
    await db()`SELECT id FROM return_intake_batches WHERE id=${id}`;
  if (batch) return { ignored: true };
  const [changed] =
    await db()`UPDATE data_jobs SET status='failed',error=${d.message},updated_at=now() WHERE id=${id} AND status<>'failed' RETURNING id`;
  if (changed)
    await recordReturnUpload(
      user,
      job.filename,
      {
        channel: String(job.payload.context?.channel ?? ""),
        shop: String(job.payload.context?.shop ?? ""),
      },
      { errors: 1 },
      [d.message],
    );
  return { ok: true };
}
