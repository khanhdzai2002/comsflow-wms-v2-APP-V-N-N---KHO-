export const CLEANUP_BATCH_LIMIT = 500;
export const CLEANUP_CONFIRMATION = "XOA DU LIEU CU";
export const cleanupKinds = {
  scans: "Nhật ký quét xuất kho",
  returns: "Hồ sơ đơn hoàn đã kết thúc",
} as const;
export type CleanupKind = keyof typeof cleanupKinds;
export function formatBytes(value: number) {
  if (value >= 1024 ** 3) return (value / 1024 ** 3).toFixed(2) + " GB";
  if (value >= 1024 ** 2) return (value / 1024 ** 2).toFixed(2) + " MB";
  if (value >= 1024) return (value / 1024).toFixed(1) + " KB";
  return value + " B";
}
