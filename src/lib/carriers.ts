import { db, type Tx } from "./db";
import { normalizeCode } from "./domain";
import { carrierFormats } from "./carrier-formats";
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
    sql`SELECT r.*,c.name carrier,sc.name channel FROM carrier_matching_rules r JOIN shipping_carriers c ON c.id=r.carrier_id LEFT JOIN sales_channels sc ON sc.id=r.channel_id ORDER BY length(r.prefix) DESC,r.prefix`,
    sql`SELECT * FROM carrier_aliases`,
  ]);
  return {
    carriers,
    rules: rules.filter((r) => r.active),
    disabledRules: rules.filter((r) => !r.active),
    aliases,
  };
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
  const rule = catalog.rules.find((r) =>
    normalized.startsWith(r.prefix.toUpperCase()),
  );
  const disabled = catalog.disabledRules.some((r) =>
    normalized.startsWith(r.prefix.toUpperCase()),
  );
  const format =
    !rule && !disabled
      ? carrierFormats.find((f) => f.pattern.test(normalized))
      : undefined;
  const canonical = format
    ? catalog.carriers.find(
        (c) => carrierKey(c.name) === carrierKey(format.name),
      )
    : undefined;
  const formatIds = format
    ? new Set(
        catalog.aliases
          .filter((a) => (format.keys as readonly string[]).includes(a.alias))
          .map((a) => a.carrier_id),
      )
    : new Set();
  const fromFormat =
    canonical ??
    (formatIds.size === 1
      ? catalog.carriers.find((c) => formatIds.has(c.id))
      : format
        ? catalog.carriers.find((c) =>
            (format.keys as readonly string[]).includes(carrierKey(c.name)),
          )
        : undefined);
  const key = carrierKey(sourceName);
  const alias = catalog.aliases.find((a) => a.alias === key);
  const fromFile = catalog.carriers.find(
    (c) => carrierKey(c.name) === key || c.id === alias?.carrier_id,
  );
  const known = catalog.carriers.find((c) => c.id === knownId);
  const fromRule = catalog.carriers.find((c) => c.id === rule?.carrier_id);
  const hintCarrier = fromRule ?? fromFormat;
  const chosen = known ?? fromFile ?? fromRule ?? fromFormat;
  return {
    carrierId: chosen?.id ?? null,
    carrier: chosen?.name ?? "Chưa nhận diện hãng",
    origin: known
      ? "verified"
      : fromFile
        ? "file"
        : fromRule
          ? "prefix"
          : fromFormat
            ? "format"
            : "unknown",
    conflict: !!(
      (fromFile && hintCarrier && fromFile.id !== hintCarrier.id) ||
      (known && fromFile && known.id !== fromFile.id) ||
      (known && hintCarrier && known.id !== hintCarrier.id)
    ),
    sourceName,
    hint:
      rule ??
      (fromFormat && format
        ? {
            prefix: format.description,
            carrier_id: fromFormat.id,
            carrier: fromFormat.name,
            channel: null,
            source: "format",
          }
        : null),
    format: format?.description ?? null,
    missingCatalog: format && !fromFormat ? format.name : null,
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
