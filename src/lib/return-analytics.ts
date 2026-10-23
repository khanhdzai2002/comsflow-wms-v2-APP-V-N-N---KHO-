import { platformApproved } from "./return-domain";
import { z } from "zod";
import { db, type User } from "./db";
import { AppError, managerRoles, requireRole, todayVN } from "./domain";
import { classifyReason, reasonGroups } from "./return-source";
export type Component = {
  code: string;
  quantity: number;
  weight: number;
  color?: string;
  size?: string;
};
export function productComponents(
  sku: string,
  rules: any[],
): Component[] | null {
  const configured = rules.find((r) => r.source_sku === sku)?.components;
  if (configured) return configured;
  const match = /^([A-Z]{2,12}\d{2})(?:$|[-_ ])/i.exec(sku);
  return match
    ? [{ code: match[1].toUpperCase(), quantity: 1, weight: 1 }]
    : null;
}
export function componentValues(total: number | null, parts: Component[]) {
  if (total === null) return parts.map(() => null);
  const sum = parts.reduce((n, c) => n + c.weight, 0);
  let allocated = 0;
  return parts.map((c, i) => {
    const amount =
      i === parts.length - 1
        ? total - allocated
        : Math.round((total * c.weight) / sum);
    allocated += amount;
    return amount;
  });
}
const filters = z.object({
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
  channel: z.string().max(100).default(""),
  shop: z.string().max(100).default(""),
  type: z.enum(["all", "approved", "received"]).default("all"),
  product: z.string().max(100).default(""),
  color: z.string().max(100).default(""),
  size: z.string().max(100).default(""),
  reason: z.string().max(50).default(""),
  minSold: z.coerce.number().int().min(0).max(100000000).default(0),
  sort: z.enum(["rate", "returned", "value", "sold"]).default("rate"),
});
export async function returnAnalytics(user: User, raw: unknown) {
  requireRole(user, managerRoles);
  const f = filters.parse(raw);
  if (f.from && f.to && f.from > f.to)
    throw new AppError(400, "Khoảng ngày chưa hợp lệ");
  return db().begin(
    "isolation level repeatable read read only",
    async (sql) => {
      const [cases, items, sales, rules, reasonRules, settings] =
        await Promise.all([
          sql`SELECT r.*,sh.name shop,ch.name channel,EXISTS(SELECT 1 FROM return_parcels p WHERE p.case_id=r.id AND p.active AND p.received_at IS NOT NULL) received FROM return_cases r JOIN shops sh ON sh.id=r.shop_id JOIN sales_channels ch ON ch.id=sh.channel_id WHERE (${!f.channel} OR ch.name=${f.channel}) AND (${!f.shop} OR sh.name=${f.shop})`,
          sql`SELECT i.* FROM return_items i JOIN return_cases r ON r.id=i.case_id JOIN shops sh ON sh.id=r.shop_id JOIN sales_channels ch ON ch.id=sh.channel_id WHERE i.active AND (${!f.channel} OR ch.name=${f.channel}) AND (${!f.shop} OR sh.name=${f.shop})`,
          sql`SELECT s.*,sh.name shop,ch.name channel,s.sold_on::text sold FROM successful_sales s JOIN shops sh ON sh.id=s.shop_id JOIN sales_channels ch ON ch.id=sh.channel_id WHERE s.successful AND (${!f.channel} OR ch.name=${f.channel}) AND (${!f.shop} OR sh.name=${f.shop}) AND (${!f.from} OR s.sold_on>=${f.from ?? null}::date) AND (${!f.to} OR s.sold_on<=${f.to ?? null}::date)`,
          sql`SELECT * FROM product_components`,
          sql`SELECT * FROM return_reason_rules WHERE active`,
          sql`SELECT * FROM system_settings WHERE key IN ('return_rate_thresholds','return_approved_statuses')`,
        ]);
      const itemsByCase = new Map<string, any[]>(),
        salesByIdentity = new Map<string, any[]>();
      for (const i of items)
        (
          itemsByCase.get(i.case_id) ??
          (itemsByCase.set(i.case_id, []), itemsByCase.get(i.case_id)!)
        ).push(i);
      for (const sale of sales) {
        const key = JSON.stringify([sale.shop_id, sale.order_code, sale.sku]);
        (
          salesByIdentity.get(key) ??
          (salesByIdentity.set(key, []), salesByIdentity.get(key)!)
        ).push(sale);
      }
      const thresholds = settings.find(
        (s) => s.key === "return_rate_thresholds",
      )?.value ?? { low: 5, high: 10 };
      const approved = settings.find(
        (s) => s.key === "return_approved_statuses",
      )?.value ?? ["Approved", "Request approved", "Đã chấp thuận"];
      const inPeriod = (date: any) => {
        const day = new Intl.DateTimeFormat("en-CA", {
          timeZone: "Asia/Ho_Chi_Minh",
        }).format(new Date(date));
        return (!f.from || day >= f.from) && (!f.to || day <= f.to);
      };
      const eligible = (r: any) =>
        f.type === "received"
          ? r.received
          : f.type === "approved"
            ? platformApproved(r, approved)
            : true;
      const reasonOf = (r: any) => {
        const original =
          r.reason_original ||
          r.source_data.find(
            (x: any) => x.meta?.reason || x.raw?.["Return Reason"],
          )?.meta?.reason ||
          r.source_data.find((x: any) => x.raw?.["Return Reason"])?.raw?.[
            "Return Reason"
          ] ||
          "";
        return { original, group: classifyReason(original, reasonRules) };
      };
      const reasons = new Map<string, any>(),
        trend = new Map<string, any>();
      const requestCases = cases.filter(
        (r) =>
          eligible(r) &&
          inPeriod(r.requested_at) &&
          (!f.reason || reasonOf(r).group === f.reason),
      );
      for (const r of requestCases) {
        const reason = reasonOf(r),
          key = reason.group;
        const bucket = reasons.get(key) ?? {
          key,
          label: reasonGroups[key],
          requests: 0,
          value: 0,
          missingValue: 0,
          channels: {},
        };
        const detail = itemsByCase.get(r.id) ?? [];
        const explicit = [
          ...new Set(
            r.source_data
              .map((x: any) => x.meta?.returnValue)
              .filter((v: any) => v !== null && v !== undefined && v !== ""),
          ),
        ];
        const value =
          explicit.length === 1
            ? Number(explicit[0])
            : detail.length && detail.every((i) => i.unit_amount !== null)
              ? detail.reduce(
                  (n, i) => n + Number(i.unit_amount) * i.expected_qty,
                  0,
                )
              : null;
        bucket.requests++;
        bucket.channels[r.channel] = (bucket.channels[r.channel] ?? 0) + 1;
        if (value === null) bucket.missingValue++;
        else bucket.value += value;
        reasons.set(key, bucket);
        const day = new Intl.DateTimeFormat("en-CA", {
          timeZone: "Asia/Ho_Chi_Minh",
        }).format(new Date(r.requested_at));
        const t = trend.get(day) ?? { day };
        t[key] = (t[key] ?? 0) + 1;
        trend.set(day, t);
      }
      const products = new Map<string, any>();
      let unresolvedProducts = 0,
        unlinkedReturns = 0,
        ambiguousLinks = 0,
        uninspectedItems = 0,
        excessReturns = 0;
      const unresolvedSkus = new Set<string>();
      const rowFor = (code: string) => {
        if (!products.has(code))
          products.set(code, {
            code,
            sold: 0,
            returned: 0,
            value: 0,
            missingValue: 0,
            colors: {},
            sizes: {},
            colorsSold: {},
            sizesSold: {},
            reasons: {},
            channels: {},
            salesOrders: new Set(),
            returnRequests: new Set(),
          });
        return products.get(code)!;
      };
      const add = (row: any, key: string, name: string, n: number) => {
        row[key][name] = (row[key][name] ?? 0) + n;
      };
      const salesComponents = new Map<string, Component[]>();
      for (const sale of sales) {
        const parts = productComponents(sale.product_code || sale.sku, rules);
        if (!parts) {
          unresolvedProducts++;
          unresolvedSkus.add(sale.product_code || sale.sku);
          continue;
        }
        salesComponents.set(sale.id, parts);
        for (const p of parts) {
          const r = rowFor(p.code);
          r.sold += sale.quantity * p.quantity;
          r.salesOrders.add(sale.order_code);
          add(
            r,
            "colorsSold",
            p.color || sale.color || "Chưa có dữ liệu",
            sale.quantity * p.quantity,
          );
          add(
            r,
            "sizesSold",
            p.size || sale.size || "Chưa có dữ liệu",
            sale.quantity * p.quantity,
          );
        }
      }
      const claimsPerSale = new Map<string, number>();
      for (const record of cases.filter(eligible)) {
        const reason = reasonOf(record);
        if (f.reason && reason.group !== f.reason) continue;
        for (const item of itemsByCase.get(record.id) ?? []) {
          const source = record.source_data.find(
            (x: any) => x.itemKey === item.item_key,
          );
          const linked =
            salesByIdentity.get(
              JSON.stringify([record.shop_id, record.order_code, item.sku_id]),
            ) ?? [];
          let sale = linked.length === 1 ? linked[0] : null;
          if (linked.length > 1) {
            const exact = linked.filter(
              (s) =>
                s.color &&
                s.size &&
                s.color === source?.meta?.color &&
                s.size === source?.meta?.size,
            );
            sale = exact.length === 1 ? exact[0] : null;
            if (!sale) ambiguousLinks++;
          }
          if (!sale) {
            if (inPeriod(record.requested_at)) unlinkedReturns++;
            if (sales.length && inPeriod(record.requested_at)) {
              const potential = productComponents(
                source?.sellerSku || item.seller_sku || item.sku_id,
                rules,
              );
              for (const p of potential ?? []) {
                const row = rowFor(p.code);
                row.incomplete = true;
                row.unlinked =
                  (row.unlinked ?? 0) + item.expected_qty * p.quantity;
              }
            }
            if (sales.length || !inPeriod(record.requested_at)) continue;
          }
          const sku =
            source?.sellerSku ||
            item.seller_sku ||
            sale?.product_code ||
            item.sku_id;
          const parts = productComponents(sku, rules);
          if (!parts) {
            unresolvedProducts++;
            unresolvedSkus.add(sku || item.sku_id);
            continue;
          }
          let quantity = item.expected_qty;
          if (f.type === "received") {
            if (item.received_qty === null || record.inspection_stale) {
              uninspectedItems++;
              continue;
            }
            quantity = item.received_qty;
          }
          if (sale) {
            const key = sale.id;
            claimsPerSale.set(key, (claimsPerSale.get(key) ?? 0) + quantity);
            if (claimsPerSale.get(key)! > sale.quantity) excessReturns++;
          }
          const total =
            item.unit_amount === null
              ? null
              : Number(item.unit_amount) * quantity;
          const values = componentValues(total, parts);
          parts.forEach((p, index) => {
            const r = rowFor(p.code),
              count = quantity * p.quantity;
            const color =
                p.color ||
                source?.meta?.color ||
                sale?.color ||
                "Chưa có dữ liệu",
              size =
                p.size || source?.meta?.size || sale?.size || "Chưa có dữ liệu";
            if ((f.color && color !== f.color) || (f.size && size !== f.size))
              return;
            r.returned += count;
            r.returnRequests.add(record.id);
            if (values[index] === null) r.missingValue++;
            else r.value += values[index];
            add(r, "colors", color, count);
            add(r, "sizes", size, count);
            add(r, "reasons", reasonGroups[reason.group], count);
            add(r, "channels", record.channel, count);
          });
        }
      }
      // Colour/size filters apply to the same sale cohort used for the numerator.
      if (f.color || f.size) {
        for (const r of products.values()) r.sold = 0;
        for (const sale of sales) {
          const parts = salesComponents.get(sale.id) ?? [];
          for (const p of parts) {
            if (
              (f.color && (p.color || sale.color) !== f.color) ||
              (f.size && (p.size || sale.size) !== f.size)
            )
              continue;
            rowFor(p.code).sold += sale.quantity * p.quantity;
          }
        }
      }
      const rows = [...products.values()]
        .filter(
          (r) => (!f.product || r.code === f.product) && r.sold >= f.minSold,
        )
        .map((r) => {
          const rate =
            r.sold > 0 && !r.incomplete ? (r.returned / r.sold) * 100 : null;
          return {
            ...r,
            value: r.value === 0 && r.missingValue > 0 ? null : r.value,
            rate,
            tone:
              rate === null
                ? "unknown"
                : rate <= thresholds.low
                  ? "low"
                  : rate >= thresholds.high
                    ? "high"
                    : "attention",
            salesOrders: r.salesOrders.size,
            returnRequests: r.returnRequests.size,
          };
        });
      const metric =
        f.sort === "rate"
          ? "rate"
          : f.sort === "returned"
            ? "returned"
            : f.sort === "value"
              ? "value"
              : "sold";
      rows.sort(
        (a, b) =>
          (b[metric] ?? -1) - (a[metric] ?? -1) || a.code.localeCompare(b.code),
      );
      return {
        reasons: [...reasons.values()].map((r) => ({
          ...r,
          value: r.value === 0 && r.missingValue > 0 ? null : r.value,
          percent: requestCases.length
            ? (r.requests / requestCases.length) * 100
            : 0,
        })),
        requests: requestCases.length,
        trend: [...trend.values()].sort((a, b) => a.day.localeCompare(b.day)),
        products: rows,
        thresholds,
        source: {
          salesRows: sales.length,
          unresolvedProducts,
          unresolvedSkus: [...unresolvedSkus],
          unlinkedReturns,
          ambiguousLinks,
          uninspectedItems,
          excessReturns,
        },
        warnings: [
          ...(!sales.length
            ? [
                "Chưa có dữ liệu bán thành công trong kỳ. Tỷ lệ hiển thị Chưa đủ dữ liệu.",
              ]
            : []),
          "Tỷ lệ dùng nhóm đơn bán cùng kỳ, liên kết yêu cầu hoàn về đúng shop/đơn/SKU. Đơn chưa liên kết không được cộng vào tỷ lệ.",
          "Không thể chứng minh file bán đã đầy đủ hoặc đơn đã hết thời gian có thể hoàn. Kết quả tính trên nguồn đã nhập, có thể thay đổi khi bổ sung dữ liệu.",
          ...(excessReturns
            ? [
                "Có SKU/đơn với tổng SL yêu cầu hoàn vượt SL bán. Không tự giảm hay gộp yêu cầu; cần kiểm tra nguồn.",
              ]
            : []),
        ],
        asOf: todayVN(),
      };
    },
  );
}
