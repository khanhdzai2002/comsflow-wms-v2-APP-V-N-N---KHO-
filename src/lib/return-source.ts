export { reasonGroups } from "./return-domain";
import type { ReturnRow } from "./return-import";
import { createHash } from "node:crypto";
// Empty cells are absence, never an instruction to remove stored source data.
const present = (x: unknown) => x !== "" && x !== null && x !== undefined;
export function mergeReturnSource(
  previous: ReturnRow[],
  incoming: ReturnRow[],
) {
  const rows = new Map(previous.map((r) => [r.itemKey, r]));
  for (const row of incoming) {
    const old = rows.get(row.itemKey);
    if (!old) {
      rows.set(row.itemKey, row);
      continue;
    }
    const merged = {
      ...old,
      ...Object.fromEntries(Object.entries(row).filter(([, v]) => present(v))),
      raw: { ...old.raw },
      meta: { ...old.meta },
    } as ReturnRow;
    for (const [k, v] of Object.entries(row.raw))
      if (present(v)) merged.raw[k] = v;
    for (const [k, v] of Object.entries(row.meta ?? {}))
      if (present(v)) merged.meta![k] = v;
    rows.set(row.itemKey, merged);
  }
  // Platform status is case-level; use the incoming first row consistently.
  const first = incoming[0];
  return [...rows.values()].map((r) => ({
    ...r,
    status: first.status || r.status,
    substatus: first.substatus || r.substatus,
    type: first.type || r.type,
  }));
}
export function sourceDigest(rows: ReturnRow[]) {
  return createHash("sha256")
    .update(
      JSON.stringify(
        [...rows]
          .sort((a, b) => a.itemKey.localeCompare(b.itemKey))
          .map((r) => ({ ...r, row: 0 })),
      ),
    )
    .digest("hex");
}
export function sourceChanges(before: ReturnRow[], after: ReturnRow[]) {
  const changes: {
    field: string;
    before: any;
    after: any;
    financial: boolean;
  }[] = [];
  const previous = new Map(before.map((r) => [r.itemKey, r]));
  for (const r of after) {
    const old = previous.get(r.itemKey);
    for (const k of [
      "status",
      "substatus",
      "type",
      "tracking",
      "sourceCarrier",
      "sellerSku",
      "quantity",
      "unitAmount",
      "orderAmount",
      "name",
      "variant",
    ]) {
      const a = (old as any)?.[k] ?? null,
        b = (r as any)[k] ?? null;
      if (JSON.stringify(a) !== JSON.stringify(b))
        changes.push({
          field: r.sku + ":" + k,
          before: a,
          after: b,
          financial: ["unitAmount", "orderAmount"].includes(k),
        });
    }
    for (const [k, b] of Object.entries(r.raw)) {
      const a = old?.raw?.[k] ?? null;
      if (present(b) && a !== b)
        changes.push({
          field: r.sku + ":raw." + k,
          before: a,
          after: b,
          financial: false,
        });
    }
    for (const [k, b] of Object.entries(r.meta ?? {})) {
      const a = old?.meta?.[k] ?? null;
      if (present(b) && a !== b)
        changes.push({
          field: r.sku + ":" + k,
          before: a,
          after: b,
          financial: [
            "refundAmount",
            "platformCompensation",
            "returnValue",
            "sellerReturnFee",
            "otherReturnFee",
          ].includes(k),
        });
    }
  }
  return changes;
}
export function classifyReason(original: string, rules: any[]) {
  const value = original.normalize("NFC").toLocaleLowerCase("vi").trim();
  const matched = rules.filter(
    (r) => r.active && value.includes(r.phrase.toLocaleLowerCase("vi").trim()),
  );
  const groups = new Set(matched.map((r) => r.group_key));
  return groups.size === 1 ? (matched[0].group_key as string) : "other";
}
