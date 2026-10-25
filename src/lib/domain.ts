import { z } from "zod";
export const TIMEZONE = "Asia/Ho_Chi_Minh";
export const statuses: Record<string, string> = {
  pending: "Chờ xử lý",
  awaiting_scan: "Chờ quét",
  scanned: "Đã tít đơn",
  awaiting_handover: "Chờ bàn giao",
  handed_over: "Đã bàn giao",
  cancelled: "Đơn hủy",
  blocked: "Chặn xuất kho",
  review: "Cần kiểm tra",
};
export const outcomes: Record<string, string> = {
  success: "QUÉT ĐƠN THÀNH CÔNG",
  duplicate: "ĐƠN NÀY ĐÃ ĐƯỢC QUÉT",
  unknown: "ĐÃ LƯU — CHỜ FILE ĐỐI SOÁT",
  invalid: "Mã không hợp lệ",
  cancelled: "Đơn đã hủy",
  blocked: "Đơn chưa đủ điều kiện xuất kho",
  carrier_mismatch: "Hãng vận chuyển không khớp",
  warehouse_mismatch: "Vận đơn thuộc kho khác",
};
export const filterStatuses: Record<string, string> = {
  ...statuses,
  eligible: "Vận đơn hợp lệ",
  scanned_any: "Đã tít (mọi trạng thái)",
  unscanned: "Chưa tít hợp lệ",
  waiting: "Đã tít, chờ bàn giao",
  exceptions: "Tất cả ngoại lệ",
};
export function formatTime(value: string | Date | null | undefined) {
  return value
    ? new Intl.DateTimeFormat("vi-VN", {
        timeZone: TIMEZONE,
        dateStyle: "short",
        timeStyle: "medium",
      }).format(new Date(value))
    : "—";
}
export function todayVN() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}
export function normalizeCode(raw: string) {
  let code = raw.trim();
  if (code.startsWith("{")) {
    try {
      const parsed = JSON.parse(code);
      code = String(parsed.tracking_code ?? parsed.tracking_number ?? "");
    } catch {
      return "";
    }
  }
  return code.trim().toUpperCase();
}
export const validCode = (code: string) =>
  /^[A-Z0-9][A-Z0-9._-]{3,79}$/.test(code);
export const warehouseIdSchema = z.uuid({
  error: "Chọn kho hợp lệ. Nếu chưa có kho, hãy thiết lập danh mục kho trước.",
});
export const scanSchema = z.object({
  code: z.string().min(1).max(2048),
  requestId: z.uuid(),
  shiftId: z.uuid(),
  warehouseId: warehouseIdSchema,
  carrierId: z.union([z.uuid(), z.literal("")]).optional(),
  method: z.enum(["hid", "camera", "manual"]),
});
export class AppError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export function requireRole(user: { role: string }, roles: string[]) {
  if (!roles.includes(user.role))
    throw new AppError(403, "Bạn không có quyền thực hiện thao tác này");
}
export const managerRoles = ["admin", "manager"];
