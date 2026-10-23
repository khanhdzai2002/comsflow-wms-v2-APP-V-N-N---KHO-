import { db, type Tx } from "./db";
import { normalizeCode } from "./domain";
type SQL = ReturnType<typeof db> | Tx;
export const carrierKey = (name: string) =>
  name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/đ/g, "d")
    .replace(/[^a-z0-9]/g, "");
export async function carrierCatalog(sql: SQL) {
  const [carriers, rules, aliases] = await Promise.all([
    sql`SELECT id,name FROM shipping_carriers`,
    sql`SELECT r.*,c.name carrier,sc.name channel FROM carrier_matching_rules r JOIN shipping_carriers c ON c.id=r.carrier_id LEFT JOIN sales_channels sc ON sc.id=r.channel_id WHERE r.active ORDER BY length(r.prefix) DESC,r.prefix`,
    sql`SELECT * FROM carrier_aliases`,
  ]);
  return { carriers, rules, aliases };
}
export type CarrierCatalog = Awaited<ReturnType<typeof carrierCatalog>>;
export function identifyCarrier(
  catalog: CarrierCatalog,
  code: string,
  sourceName = "",
  knownId: string | null = null,
) {
  const normalized = normalizeCode(code);
  // Prefixes are configured hints; a known source record always takes priority.
  const rule = catalog.rules.find((r) => normalized.startsWith(r.prefix));
  const key = carrierKey(sourceName);
  const alias = catalog.aliases.find((a) => a.alias === key);
  const fromFile = catalog.carriers.find(
    (c) => carrierKey(c.name) === key || c.id === alias?.carrier_id,
  );
  const known = catalog.carriers.find((c) => c.id === knownId);
  const chosen =
    known ??
    fromFile ??
    catalog.carriers.find((c) => c.id === rule?.carrier_id);
  return {
    carrierId: chosen?.id ?? null,
    carrier: chosen?.name ?? "Chưa xác định",
    origin: known
      ? "verified"
      : fromFile
        ? "file"
        : rule
          ? "prefix"
          : "unknown",
    conflict: !!(
      (fromFile && rule && fromFile.id !== rule.carrier_id) ||
      (known && fromFile && known.id !== fromFile.id)
    ),
    sourceName,
    hint: rule ?? null,
    unrecognizedName: !!sourceName && !fromFile,
  };
}
export async function detectCarrier(
  sql: SQL,
  code: string,
  sourceName = "",
  knownId: string | null = null,
) {
  return identifyCarrier(await carrierCatalog(sql), code, sourceName, knownId);
}
