export const barcodeImeHint =
  "Mã đang bị bộ gõ làm biến dạng. Chuyển UniKey/EVKey từ V sang E hoặc chọn bàn phím ENG, rồi quét lại. Chưa gửi lượt này lên máy chủ.";

export type BarcodeKey = {
  key: string;
  code: string;
  shiftKey: boolean;
  getModifierState: (key: "CapsLock") => boolean;
};

// A scanner is a keyboard: keep the actual ASCII keystrokes, including both E
// presses in GHN codes. Removing accents from final IME text cannot recover IDs.
export function barcodeKeyCharacter(event: BarcodeKey): string | null {
  if (/^[\x20-\x7e]$/.test(event.key)) return event.key;
  if (
    event.key.length !== 1 &&
    !["Process", "Unidentified", "Dead", "Spacebar"].includes(event.key)
  )
    return null;
  const letter = /^Key([A-Z])$/.exec(event.code)?.[1];
  if (letter)
    return event.shiftKey !== event.getModifierState("CapsLock")
      ? letter
      : letter.toLowerCase();
  const digit = /^Digit([0-9])$/.exec(event.code)?.[1];
  if (digit) return event.shiftKey ? ")!@#$%^&*("[Number(digit)] : digit;
  const numeric = /^Numpad([0-9])$/.exec(event.code)?.[1];
  if (numeric) return numeric;
  const punctuation: Record<string, [string, string]> = {
    Space: [" ", " "],
    Minus: ["-", "_"],
    Equal: ["=", "+"],
    BracketLeft: ["[", "{"],
    BracketRight: ["]", "}"],
    Backslash: ["\\", "|"],
    Semicolon: [";", ":"],
    Quote: ["'", '"'],
    Comma: [",", "<"],
    Period: [".", ">"],
    Slash: ["/", "?"],
    Backquote: ["`", "~"],
    NumpadDecimal: [".", "."],
    NumpadSubtract: ["-", "-"],
    NumpadAdd: ["+", "+"],
    NumpadMultiply: ["*", "*"],
    NumpadDivide: ["/", "/"],
  };
  return punctuation[event.code]?.[event.shiftKey ? 1 : 0] ?? null;
}

export function hasNonAsciiBarcode(raw: string) {
  let code = raw.trim();
  if (code.startsWith("{")) {
    try {
      const value = JSON.parse(code);
      const identifier = value.tracking_code ?? value.tracking_number;
      // Other QR fields may legitimately contain Vietnamese; only the tracking
      // identifier is checked here. Malformed QR remains server-validated.
      if (typeof identifier !== "string") return false;
      code = identifier;
    } catch {
      return false;
    }
  }
  return /[^\x20-\x7e]/.test(code);
}
