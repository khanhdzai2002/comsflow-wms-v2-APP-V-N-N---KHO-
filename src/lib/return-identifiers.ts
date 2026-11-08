import { AppError, normalizeCode } from "./domain";
export function exactReturnIdentifier(value: unknown, required = false) {
  if (typeof value !== "string")
    throw new Error(
      "Mã định danh phải là chuỗi văn bản, không nhận số JavaScript",
    );
  const s = value.trim();
  if (!s && !required) return "";
  if (
    !s ||
    s.length > 100 ||
    !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(s) ||
    /^\d+(?:[.,]\d+)?e[+-]?\d+$/i.test(s)
  )
    throw new Error(
      "Mã thiếu/sai hoặc ở dạng số khoa học. Dùng dữ liệu gốc đầy đủ; không tự phục hồi chữ số",
    );
  return s;
}
export function exactReturnScanCode(raw: string, preserve = true) {
  if (!preserve) return normalizeCode(raw);
  let code = raw.trim();
  if (code.startsWith("{")) {
    try {
      const qr = JSON.parse(code);
      const value = qr.tracking_code ?? qr.tracking_number;
      if (typeof value !== "string") throw new Error();
      code = value.trim();
    } catch {
      throw new AppError(
        400,
        "QR phải chứa mã vận đơn dạng chuỗi đầy đủ, không nhận mã dạng số",
      );
    }
  }
  try {
    code = exactReturnIdentifier(code, true);
  } catch {
    throw new AppError(
      400,
      "Mã vận đơn không hợp lệ; dùng mã gốc đầy đủ dạng văn bản",
    );
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{3,79}$/.test(code))
    throw new AppError(400, "Mã vận đơn phải có 4–80 ký tự hợp lệ");
  return code;
}
