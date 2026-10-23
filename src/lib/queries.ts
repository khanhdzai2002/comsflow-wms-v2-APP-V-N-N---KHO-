import { db, type User } from "./db";
import { todayVN, managerRoles, requireRole, AppError } from "./domain";
import { z } from "zod";
export type Filters = {
  from?: string;
  to?: string;
  channel?: string;
  carrier?: string;
  warehouse?: string;
  employee?: string;
  shift?: string;
  shop?: string;
  status?: string;
  q?: string;
  page?: string;
  sort?: string;
};
const optionalId = z.union([z.uuid(), z.literal("")]).optional();
const filtersSchema = z.object({
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
  channel: optionalId,
  carrier: optionalId,
  warehouse: optionalId,
  employee: optionalId,
  shift: optionalId,
  shop: optionalId,
  status: z
    .enum([
      "",
      "pending",
      "awaiting_scan",
      "scanned",
      "awaiting_handover",
      "handed_over",
      "cancelled",
      "blocked",
      "review",
      "unscanned",
      "waiting",
      "eligible",
      "scanned_any",
      "exceptions",
    ])
    .optional(),
  q: z.string().max(150).optional(),
  page: z
    .string()
    .regex(/^\d{1,7}$/)
    .optional(),
  sort: z.enum(["due_date", "tracking_code", "scanned_at"]).optional(),
});
export function filterSQL(raw: Filters) {
  const f = filtersSchema.parse(raw),
    sql = db();
  if (f.from && f.to && f.from > f.to)
    throw new AppError(400, "Ngày bắt đầu phải trước ngày kết thúc");
  return sql` s.due_date BETWEEN ${f.from ?? todayVN()}::date AND ${f.to ?? todayVN()}::date
 AND (${!f.channel} OR o.channel_id=${f.channel || null}::uuid)
 AND (${!f.shop} OR o.shop_id=${f.shop || null}::uuid)
 AND (${!f.carrier} OR s.carrier_id=${f.carrier || null}::uuid)
 AND (${!f.warehouse} OR s.warehouse_id=${f.warehouse || null}::uuid)
 AND (${!f.employee} OR s.scanned_by=${f.employee || null}::uuid)
 AND (${!f.shift} OR s.shift_id=${f.shift || null}::uuid)
 AND (${!f.status} OR s.status=${f.status || ""}
  OR (${f.status === "unscanned"} AND s.scanned_at IS NULL AND s.status IN ('pending','awaiting_scan'))
  OR (${f.status === "waiting"} AND s.scanned_at IS NOT NULL AND s.handed_at IS NULL AND s.status IN ('scanned','awaiting_handover'))
  OR (${f.status === "eligible"} AND s.status NOT IN ('cancelled','blocked','review'))
  OR (${f.status === "scanned_any"} AND s.scanned_at IS NOT NULL)
  OR (${f.status === "exceptions"} AND s.status IN ('cancelled','blocked','review')))
 AND (${!f.q} OR s.tracking_code ILIKE ${"%" + (f.q ?? "") + "%"} OR o.external_id ILIKE ${"%" + (f.q ?? "") + "%"})`;
}
export async function referenceData(user: User) {
  const sql = db();
  const [
    warehouses,
    channels,
    carriers,
    shops,
    shifts,
    settings,
    rules,
    templates,
    retention,
  ] = await Promise.all([
    sql`SELECT * FROM warehouses ORDER BY name`,
    sql`SELECT * FROM sales_channels ORDER BY name`,
    sql`SELECT * FROM shipping_carriers ORDER BY name`,
    sql`SELECT * FROM shops ORDER BY name`,
    sql`SELECT s.*,w.name warehouse,EXISTS(SELECT 1 FROM shift_members m WHERE m.shift_id=s.id AND m.user_id=${user.id}) assigned,
      ARRAY(SELECT user_id FROM shift_members WHERE shift_id=s.id) member_ids
      FROM work_shifts s JOIN warehouses w ON w.id=s.warehouse_id WHERE s.ends_at>now()-interval '1 day' ORDER BY s.starts_at DESC`,
    sql`SELECT * FROM system_settings`,
    sql`SELECT r.*,c.name carrier,sc.name channel FROM carrier_matching_rules r JOIN shipping_carriers c ON c.id=r.carrier_id LEFT JOIN sales_channels sc ON sc.id=r.channel_id ORDER BY prefix`,
    user.role === "staff"
      ? Promise.resolve([])
      : sql`SELECT * FROM import_templates ORDER BY name`,
    sql`SELECT kind,warehouse_id,max(before_date)::text before_date,sum((result->>'deleted')::bigint)::float8 deleted FROM maintenance_jobs WHERE state='completed' GROUP BY kind,warehouse_id`,
  ]);
  const users =
    user.role === "staff"
      ? []
      : await sql`SELECT id,name,email,role,active FROM users ORDER BY name`;
  return {
    serverTime: (await sql`SELECT clock_timestamp() AS at`)[0].at,
    warehouses,
    channels,
    carriers,
    shops,
    shifts,
    users,
    settings: Object.fromEntries(settings.map((s) => [s.key, s.value])),
    rules,
    templates,
    retention,
  };
}
export async function shipmentList(user: User, filters: Filters, all = false) {
  requireRole(user, managerRoles);
  const sql = db(),
    where = filterSQL(filters);
  const page = Math.max(1, Number(filters.page) || 1),
    sort = ["tracking_code", "scanned_at"].includes(filters.sort ?? "")
      ? filters.sort!
      : "due_date";
  const [count] =
    await sql`SELECT count(*)::int total FROM shipments s JOIN orders o ON o.id=s.order_id WHERE ${where}`;
  const rows =
    await sql`SELECT s.*,o.external_id,c.name channel,sh.name shop,ca.name carrier,w.name warehouse,u.name employee,h.name handover_employee,ws.name shift,
 count(*) OVER()::int total_count FROM shipments s JOIN orders o ON o.id=s.order_id JOIN sales_channels c ON c.id=o.channel_id
 JOIN shops sh ON sh.id=o.shop_id JOIN shipping_carriers ca ON ca.id=s.carrier_id JOIN warehouses w ON w.id=s.warehouse_id
 LEFT JOIN users u ON u.id=s.scanned_by LEFT JOIN users h ON h.id=s.handed_by LEFT JOIN work_shifts ws ON ws.id=s.shift_id
 WHERE ${where} ORDER BY ${sql("s." + sort)} DESC NULLS LAST,s.id LIMIT ${all ? 50001 : 50} OFFSET ${all ? 0 : (page - 1) * 50}`;
  if (all && rows.length > 50000)
    throw new AppError(
      400,
      "Tối đa 50.000 vận đơn mỗi lần xuất. Thu hẹp bộ lọc.",
    );
  return { rows, total: count.total, page };
}
export async function dashboard(user: User, filters: Filters) {
  requireRole(user, managerRoles);
  const sql = db(),
    where = filterSQL(filters);
  // Aggregate inside PostgreSQL. Returning raw scan responses previously made
  // dashboard CPU/RAM grow with every event and every polling client.
  const grouped = (key: "channel" | "carrier") => sql`
    SELECT ${sql(key)} name,count(*)::int total,
      count(*) FILTER(WHERE scanned_at IS NOT NULL)::int scanned,
      count(*) FILTER(WHERE handed_at IS NOT NULL)::int handed,
      count(*) FILTER(WHERE status IN ('scanned','awaiting_handover'))::int waiting,
      count(*) FILTER(WHERE scanned_at IS NULL AND status IN ('pending','awaiting_scan'))::int unscanned,
      count(*) FILTER(WHERE status NOT IN ('cancelled','blocked','review'))::int eligible,
      round(100.0*count(*) FILTER(WHERE scanned_at IS NOT NULL AND status NOT IN ('cancelled','blocked','review')) / nullif(count(*) FILTER(WHERE status NOT IN ('cancelled','blocked','review')),0))::int "scanRate",
      count(*) FILTER(WHERE status IN ('cancelled','blocked','review'))::int exceptions
    FROM selected GROUP BY ${sql(key)}`;
  const [row] = await sql`
    WITH selected AS (
      SELECT s.id,s.status,s.scanned_at,s.handed_at,s.due_date,c.name channel,ca.name carrier
      FROM shipments s JOIN orders o ON o.id=s.order_id JOIN sales_channels c ON c.id=o.channel_id
      JOIN shipping_carriers ca ON ca.id=s.carrier_id WHERE ${where}
    ), events AS (
      SELECT e.user_id,e.outcome,e.created_at,u.name employee FROM scan_events e JOIN users u ON u.id=e.user_id
      WHERE e.created_at>=(${filters.from ?? todayVN()}::date::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh')
      AND e.created_at<((${filters.to ?? todayVN()}::date+1)::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh')
      AND (${!filters.employee} OR e.user_id=${filters.employee || null}::uuid)
      AND (${!filters.shift} OR e.shift_id=${filters.shift || null}::uuid)
      AND (${!filters.warehouse} OR e.warehouse_id=${filters.warehouse || null}::uuid)
      AND (e.shipment_id IN (SELECT id FROM selected) OR (e.shipment_id IS NULL AND ${!filters.channel && !filters.carrier && !filters.status && !filters.shop && !filters.q}))
    ), summary AS (
      SELECT count(*)::int total,
        count(*) FILTER(WHERE status NOT IN ('cancelled','blocked','review'))::int eligible,
        count(*) FILTER(WHERE scanned_at IS NOT NULL)::int scanned,
        count(*) FILTER(WHERE scanned_at IS NULL AND status NOT IN ('cancelled','blocked','review'))::int unscanned,
        count(*) FILTER(WHERE scanned_at IS NOT NULL AND status IN ('scanned','awaiting_handover'))::int waiting,
        count(*) FILTER(WHERE handed_at IS NOT NULL)::int handed,
        count(*) FILTER(WHERE status IN ('cancelled','blocked','review'))::int exceptions,
        round(100.0*count(*) FILTER(WHERE scanned_at IS NOT NULL AND status NOT IN ('cancelled','blocked','review')) / nullif(count(*) FILTER(WHERE status NOT IN ('cancelled','blocked','review')),0))::int "scanRate",
        round(100.0*count(*) FILTER(WHERE handed_at IS NOT NULL AND status NOT IN ('cancelled','blocked','review')) / nullif(count(*) FILTER(WHERE status NOT IN ('cancelled','blocked','review')),0))::int "handoverRate"
      FROM selected
    ), channels AS (${grouped("channel")}),carriers AS (${grouped("carrier")}),
    staff AS (
      SELECT user_id id,employee name,
        count(*) FILTER(WHERE outcome='success')::int success,
        count(*) FILTER(WHERE outcome='duplicate')::int duplicate,
        count(*) FILTER(WHERE outcome NOT IN ('success','duplicate'))::int error,
        min(created_at) AS "first",max(created_at) AS "last" FROM events GROUP BY user_id,employee
    ), event_hours AS (
      SELECT extract(hour FROM created_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::int AS bucket_hour,count(*)::int scanned
      FROM events WHERE outcome='success' GROUP BY bucket_hour
    ), hours AS (
      SELECT lpad(h::text,2,'0')||':00' name,coalesce(e.scanned,0) scanned
      FROM generate_series(0,23) h LEFT JOIN event_hours e ON e.bucket_hour=h ORDER BY h
    ), due_days AS (
      SELECT due_date::text name,count(*) FILTER(WHERE status NOT IN ('cancelled','blocked','review'))::int expected FROM selected GROUP BY due_date
    ), event_days AS (
      SELECT to_char(created_at AT TIME ZONE 'Asia/Ho_Chi_Minh','YYYY-MM-DD') name,count(*)::int scanned FROM events WHERE outcome='success' GROUP BY name
    ), days AS (
      SELECT coalesce(d.name,e.name) name,coalesce(d.expected,0) expected,coalesce(e.scanned,0) scanned FROM due_days d FULL JOIN event_days e USING(name)
    )
    SELECT to_jsonb(summary)||jsonb_build_object(
      'duplicate',(SELECT count(*) FROM events WHERE outcome='duplicate'),
      'unknown',(SELECT count(*) FROM events WHERE outcome='unknown'),
      'channels',coalesce((SELECT jsonb_agg(to_jsonb(c) ORDER BY name) FROM channels c),'[]'::jsonb),
      'carriers',coalesce((SELECT jsonb_agg(to_jsonb(c) ORDER BY name) FROM carriers c),'[]'::jsonb),
      'staff',coalesce((SELECT jsonb_agg(to_jsonb(s) ORDER BY success DESC,name) FROM staff s),'[]'::jsonb),
      'hours',(SELECT jsonb_agg(to_jsonb(h) ORDER BY name) FROM hours h),
      'days',coalesce((SELECT jsonb_agg(to_jsonb(d) ORDER BY name) FROM days d),'[]'::jsonb)
    ) data FROM summary`;
  return row.data;
}
export async function myScans(user: User, shift?: string) {
  if (shift) z.uuid().parse(shift);
  const sql = db();
  const [summary] =
    await sql`SELECT count(*) FILTER(WHERE outcome='success')::int success,count(*) FILTER(WHERE outcome='duplicate')::int duplicate,count(*) FILTER(WHERE outcome NOT IN ('success','duplicate'))::int error FROM scan_events WHERE user_id=${user.id} AND ((${Boolean(shift)} AND shift_id=${shift ?? null}::uuid) OR (${!shift} AND (created_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date=(now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date))`;
  const recent =
    await sql`SELECT e.*,s.tracking_code,c.name carrier,ch.name channel FROM scan_events e LEFT JOIN shipments s ON s.id=e.shipment_id LEFT JOIN shipping_carriers c ON c.id=s.carrier_id LEFT JOIN orders o ON o.id=s.order_id LEFT JOIN sales_channels ch ON ch.id=o.channel_id WHERE e.user_id=${user.id} ORDER BY e.created_at DESC LIMIT 10`;
  return { summary, recent };
}
