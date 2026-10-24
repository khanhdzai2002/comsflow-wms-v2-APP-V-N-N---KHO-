export const returnCarrierGroups = {
  unknown: "Chưa nhận diện hãng",
  no_tracking: "Chưa có mã vận đơn hoàn",
  mixed: "Nhiều hãng / cần đối chiếu",
} as const;

export function groupReturnCarriers(
  entries: {
    caseId: string;
    hasTracking: boolean;
    carrierId: string | null;
    carrier: string;
  }[],
) {
  const groups = new Map<string, Map<string, string>>();
  for (const entry of entries) {
    const ids = groups.get(entry.caseId) ?? new Map<string, string>();
    if (entry.hasTracking)
      ids.set(
        entry.carrierId ?? "unknown",
        entry.carrierId ? entry.carrier : returnCarrierGroups.unknown,
      );
    groups.set(entry.caseId, ids);
  }
  return [...groups].map(([case_id, ids]) => {
    const carrier_id = !ids.size
      ? "no_tracking"
      : ids.size > 1
        ? "mixed"
        : ids.keys().next().value!;
    const carrier =
      carrier_id in returnCarrierGroups
        ? returnCarrierGroups[carrier_id as keyof typeof returnCarrierGroups]
        : ids.get(carrier_id)!;
    return { case_id, carrier_id, carrier };
  });
}
