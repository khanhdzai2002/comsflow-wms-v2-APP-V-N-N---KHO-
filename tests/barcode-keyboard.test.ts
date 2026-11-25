import { describe, expect, it } from "vitest";
import {
  barcodeKeyCharacter,
  hasNonAsciiBarcode,
  type BarcodeKey,
} from "../src/lib/barcode-keyboard";
const key = (
  value: string,
  code = "",
  shift = false,
  caps = false,
): BarcodeKey => ({
  key: value,
  code,
  shiftKey: shift,
  getModifierState: () => caps,
});
describe("Scanner ASCII keys and IME safeguards", () => {
  it("keeps every original key, including repeated E, when native IME reports Process", () => {
    const source = "GYEET001";
    const decoded = [...source]
      .map((c) =>
        barcodeKeyCharacter(
          key(
            "Process",
            /[A-Z]/.test(c) ? "Key" + c : "Digit" + c,
            /[A-Z]/.test(c),
          ),
        ),
      )
      .join("");
    expect(decoded).toBe(source);
  });
  it.each([
    ["g", "KeyG", false, false, "g"],
    ["G", "KeyG", true, false, "G"],
    ["Process", "KeyE", false, true, "E"],
    ["Process", "KeyE", true, true, "e"],
    ["Ê", "KeyE", true, false, "E"],
    ["Process", "Digit0", false, false, "0"],
    ["Process", "Digit1", true, false, "!"],
    ["Process", "Numpad8", false, false, "8"],
    ["Process", "Minus", true, false, "_"],
    ["Process", "Quote", true, false, '"'],
  ])(
    "preserves physical stroke %s/%s",
    (value, code, shift, caps, expected) => {
      expect(
        barcodeKeyCharacter(
          key(String(value), String(code), Boolean(shift), Boolean(caps)),
        ),
      ).toBe(expected);
    },
  );
  it("does not invent a key when the OS has suppressed the original stroke", () => {
    expect(barcodeKeyCharacter(key("Ê", "Unidentified"))).toBeNull();
    expect(barcodeKeyCharacter(key("Process", ""))).toBeNull();
    expect(barcodeKeyCharacter(key("F5", "F5"))).toBeNull();
    expect(barcodeKeyCharacter(key("Home", "Numpad7"))).toBeNull();
  });
  it.each(["GNG88Ê", "GNUFNỆ", "GYEÊT001", "GYEET001\u0302"])(
    "flags corrupted final text %s instead of stripping accents",
    (value) => {
      expect(hasNonAsciiBarcode(value)).toBe(true);
    },
  );
  it.each([
    "GYEET001",
    "0000862000000001",
    "SPXVN00000000001A",
    "TTVN12345678",
    "AbC-001",
    "862000000001",
  ])("leaves exact string %s accepted", (value) => {
    expect(hasNonAsciiBarcode(value)).toBe(false);
  });
  it("checks only the QR tracking identifier; legitimate Vietnamese metadata is preserved", () => {
    expect(
      hasNonAsciiBarcode(
        JSON.stringify({ tracking_code: "GYEET001", note: "Hàng hoàn đã về" }),
      ),
    ).toBe(false);
    expect(
      hasNonAsciiBarcode(JSON.stringify({ tracking_number: "GNG88Ê" })),
    ).toBe(true);
  });
});
