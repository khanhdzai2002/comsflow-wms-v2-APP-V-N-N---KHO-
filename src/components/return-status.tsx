import { returnInspection, returnProcessing } from "@/lib/return-domain";
export function ReturnStatus({
  kind = "processing",
  value,
}: {
  kind?: "processing" | "warehouse";
  value: string;
}) {
  const warehouse: Record<string, string> = {
    unreceived: "Chưa nhận kiện",
    received: "Đã nhận kiện",
    no_physical: "Không yêu cầu trả hàng",
    stale: "Nguồn đổi · cần kiểm lại",
    ...returnInspection,
  };
  const tones: Record<string, string> = {
    unreceived: "neutral",
    no_physical: "neutral",
    pending: kind === "warehouse" ? "info" : "neutral",
    received: "success",
    full: "complete",
    short: "attention",
    damaged: "danger",
    wrong: "danger",
    empty: "danger",
    stale: "attention",
    checking: "info",
    claim_open: "attention",
    claim_submitted: "waiting",
    claim_won: "success",
    claim_lost: "danger",
    suspected_lost: "risk",
    lost: "danger-strong",
    compensated: "success",
    completed: "complete",
    closed_unsuccessful: "danger",
  };
  return (
    <span className={"return-status " + (tones[value] ?? "neutral")}>
      {(kind === "warehouse" ? warehouse : returnProcessing)[value] ?? value}
    </span>
  );
}
export function warehouseState(r: any) {
  return r.no_physical_return
    ? "no_physical"
    : r.inspection_stale
      ? "stale"
      : r.received === 0 || (!r.received && r.inspection_status === "pending")
        ? "unreceived"
        : r.inspection_status;
}
