export type PdfBatchPreview = {
  hash: string;
  labels: {
    trackingCode: string;
    orderId: string;
    carrier: string;
    channel: string;
  }[];
  errors: { page?: number; trackingCode?: string; message: string }[];
  conflicts: { page?: number; trackingCode?: string; message: string }[];
  carrierUnresolved?: boolean;
  existingManifestArchived?: boolean;
};

// Browser preflight only. The server validates stored identities and current
// warehouse/order/carrier conflicts again in the authoritative commit transaction.
export function summarizePdfBatch(
  records: { preview?: PdfBatchPreview; error?: string }[],
) {
  const candidates: number[] = [];
  const crossErrors: Record<number, string[]> = {};
  const codes = new Map<string, { signature: string; indexes: number[] }>();
  records.forEach((record, index) => {
    const p = record.preview;
    if (
      record.error ||
      !p?.labels.length ||
      p.errors.length ||
      p.conflicts.length ||
      p.carrierUnresolved ||
      p.existingManifestArchived
    )
      return;
    candidates.push(index);
    for (const l of p.labels) {
      const signature = JSON.stringify([l.orderId, l.carrier, l.channel]);
      const previous = codes.get(l.trackingCode);
      if (previous) {
        if (previous.signature !== signature) {
          for (const i of [...previous.indexes, index])
            crossErrors[i] = [
              ...new Set([...(crossErrors[i] ?? []), l.trackingCode]),
            ];
        }
        previous.indexes.push(index);
      } else codes.set(l.trackingCode, { signature, indexes: [index] });
    }
  });
  // A third file matching the first still conflicts with the second: block the entire code group.
  for (const [code, group] of codes)
    if (group.indexes.some((i) => crossErrors[i]?.includes(code)))
      for (const i of group.indexes)
        crossErrors[i] = [...new Set([...(crossErrors[i] ?? []), code])];
  const hashes = new Set<string>(),
    duplicateIndexes: number[] = [],
    readyIndexes: number[] = [];
  const uniqueCodes = new Set<string>(),
    orders = new Set<string>();
  let totalCodes = 0;
  for (const index of candidates) {
    const p = records[index].preview!;
    if (crossErrors[index]?.length) continue;
    if (hashes.has(p.hash)) {
      duplicateIndexes.push(index);
      continue;
    }
    hashes.add(p.hash);
    readyIndexes.push(index);
    for (const label of p.labels) {
      uniqueCodes.add(label.trackingCode);
      orders.add(JSON.stringify([label.channel, label.orderId]));
      totalCodes++;
    }
  }
  return {
    readyIndexes,
    duplicateIndexes,
    crossErrors,
    uniqueShipments: uniqueCodes.size,
    orders: orders.size,
    overlapShipments: totalCodes - uniqueCodes.size,
  };
}
