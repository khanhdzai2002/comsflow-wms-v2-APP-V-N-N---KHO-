import { z } from "zod";
import { db, audit, type User } from "./db";
import { requireRole, managerRoles, AppError } from "./domain";
import { carrierKey } from "./carriers";
import { reasonGroups } from "./return-source";
export async function returnSettings(user: User) {
  requireRole(user, managerRoles);
  const [aliases, components, reasons, settings] = await Promise.all([
    db()`SELECT a.*,c.name carrier FROM carrier_aliases a JOIN shipping_carriers c ON c.id=a.carrier_id ORDER BY alias`,
    db()`SELECT * FROM product_components ORDER BY source_sku`,
    db()`SELECT * FROM return_reason_rules ORDER BY phrase`,
    db()`SELECT key,value FROM system_settings WHERE key IN ('return_rate_thresholds','return_approved_statuses')`,
  ]);
  return {
    aliases,
    components,
    reasons,
    thresholds: settings.find((r) => r.key === "return_rate_thresholds")
      ?.value ?? { low: 5, high: 10 },
    approvedStatuses: settings.find((r) => r.key === "return_approved_statuses")
      ?.value ?? ["Approved", "Request approved", "Đã chấp thuận"],
  };
}
export async function saveReturnSettings(user: User, raw: unknown) {
  requireRole(user, ["admin"]);
  const d = z
    .discriminatedUnion("kind", [
      z.object({
        kind: z.literal("alias"),
        alias: z.string().trim().min(1).max(100),
        carrierId: z.uuid(),
      }),
      z.object({
        kind: z.literal("components"),
        sku: z.string().trim().min(1).max(100),
        components: z
          .array(
            z.object({
              code: z.string().regex(/^[A-Z0-9_-]{1,40}$/),
              quantity: z.number().int().min(1).max(1000),
              weight: z.number().positive().max(100000),
              color: z.string().max(100).default(""),
              size: z.string().max(100).default(""),
            }),
          )
          .min(1)
          .max(30),
      }),
      z.object({
        kind: z.literal("reason"),
        phrase: z.string().trim().min(2).max(200),
        group: z.enum(Object.keys(reasonGroups) as [string, ...string[]]),
        active: z.boolean().default(true),
      }),
      z.object({
        kind: z.literal("thresholds"),
        low: z.number().min(0).max(100),
        high: z.number().min(0).max(100),
        approvedStatuses: z.array(z.string().trim().min(1).max(100)).max(50),
      }),
    ])
    .parse(raw);
  if (d.kind === "thresholds" && d.low >= d.high)
    throw new AppError(400, "Ngưỡng thấp phải nhỏ hơn ngưỡng cao");
  if (
    d.kind === "components" &&
    new Set(d.components.map((c) => [c.code, c.color, c.size].join("|")))
      .size !== d.components.length
  )
    throw new AppError(
      400,
      "Không lặp thành phần; gộp định lượng trên một dòng",
    );
  return db().begin(async (tx) => {
    await tx`SELECT pg_advisory_xact_lock(742920)`;
    let before, after;
    if (d.kind === "alias") {
      const alias = carrierKey(d.alias);
      if (!alias) throw new AppError(400, "Tên gọi chưa hợp lệ");
      const canonical =
        await tx`SELECT id FROM shipping_carriers WHERE id=${d.carrierId}`;
      if (
        (
          await tx`SELECT id,name FROM shipping_carriers WHERE id<>${d.carrierId}`
        ).some((c) => carrierKey(c.name) === alias)
      )
        throw new AppError(409, "Tên gọi trùng tên chuẩn của hãng khác");
      if (!canonical.length) throw new AppError(400, "Hãng không tồn tại");
      [before] = await tx`SELECT * FROM carrier_aliases WHERE alias=${alias}`;
      [after] =
        await tx`INSERT INTO carrier_aliases(alias,carrier_id) VALUES(${alias},${d.carrierId}) ON CONFLICT(alias) DO UPDATE SET carrier_id=excluded.carrier_id RETURNING *`;
    } else if (d.kind === "components") {
      [before] =
        await tx`SELECT * FROM product_components WHERE source_sku=${d.sku}`;
      [after] =
        await tx`INSERT INTO product_components(source_sku,components,updated_by) VALUES(${d.sku},${tx.json(d.components)},${user.id}) ON CONFLICT(source_sku) DO UPDATE SET components=excluded.components,updated_by=excluded.updated_by,updated_at=now() RETURNING *`;
    } else if (d.kind === "reason") {
      [before] =
        await tx`SELECT * FROM return_reason_rules WHERE phrase=${d.phrase.toLowerCase()}`;
      [after] =
        await tx`INSERT INTO return_reason_rules(phrase,group_key,active) VALUES(${d.phrase.toLowerCase()},${d.group},${d.active}) ON CONFLICT(phrase) DO UPDATE SET group_key=excluded.group_key,active=excluded.active RETURNING *`;
    } else {
      before =
        await tx`SELECT * FROM system_settings WHERE key IN ('return_rate_thresholds','return_approved_statuses')`;
      await tx`INSERT INTO system_settings(key,value) VALUES('return_rate_thresholds',${tx.json({ low: d.low, high: d.high })}),('return_approved_statuses',${tx.json(d.approvedStatuses)}) ON CONFLICT(key) DO UPDATE SET value=excluded.value`;
      after = d;
    }
    await audit(
      tx,
      user,
      "return_v2_settings",
      d.kind,
      before ?? null,
      after,
      "Cấu hình nhận diện/phân tích đơn hoàn",
    );
    return { ok: true };
  });
}
export async function returnImportHistory(user: User, id?: string) {
  requireRole(user, managerRoles);
  if (id) {
    z.uuid().parse(id);
    return db()`SELECT c.external_id,c.changes FROM return_import_changes c WHERE c.import_id=${id} ORDER BY c.external_id`;
  }
  return db()`SELECT i.*,sh.name shop,ch.name channel,u.name employee,r.new_count,r.updated_count,r.unchanged_count,r.error_count,r.status_count,r.finance_count FROM return_imports i JOIN shops sh ON sh.id=i.shop_id JOIN sales_channels ch ON ch.id=sh.channel_id JOIN users u ON u.id=i.created_by LEFT JOIN return_import_results r ON r.import_id=i.id ORDER BY i.created_at DESC LIMIT 200`;
}
export async function recordReturnUpload(
  user: User,
  filename: string,
  context: any,
  summary: any,
  errors: string[],
) {
  requireRole(user, managerRoles);
  await db()`INSERT INTO return_upload_attempts(filename,channel,shop,created_by,summary,errors) VALUES(${filename.slice(0, 255)},${String(context.channel ?? "").slice(0, 100)},${String(context.shop ?? "").slice(0, 100)},${user.id},${db().json(summary)},${db().json(errors.slice(0, 30).map((s) => s.slice(0, 1000)))})`;
}
