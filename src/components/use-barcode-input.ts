import {
  useRef,
  type ChangeEvent,
  type ClipboardEvent,
  type KeyboardEvent,
} from "react";
import {
  barcodeImeHint,
  barcodeKeyCharacter,
  hasNonAsciiBarcode,
} from "../lib/barcode-keyboard";

export function storedScanMethod(key: string): "manual" | "hid" {
  try {
    return localStorage.getItem(key) === "hid" ? "hid" : "manual";
  } catch {
    return "manual";
  }
}
export function rememberScanMethod(key: string, method: string) {
  try {
    localStorage.setItem(key, method);
  } catch {
    /* Session still works. */
  }
}

export function useBarcodeInput({
  value,
  setValue,
  method,
  onSubmit,
  onReject,
}: {
  value: string;
  setValue: (value: string) => void;
  method: string;
  onSubmit: (value: string, method: string) => void;
  onReject: (message: string) => void;
}) {
  const stream = useRef({ text: "", active: false, blocked: false, method });
  const current = () => {
    if (stream.current.method !== method)
      stream.current = { text: "", active: false, blocked: false, method };
    return stream.current;
  };
  const reset = () => {
    stream.current = { text: "", active: false, blocked: false, method };
  };
  const reject = (clear: boolean) => {
    reset();
    if (clear) setValue("");
    onReject(barcodeImeHint);
  };
  const submit = (scanMethod = method) => {
    const state = current();
    if (method === "hid" && state.blocked) {
      reject(true);
      return;
    }
    const code = method === "hid" && state.active ? state.text : value;
    reset();
    if (!code.trim()) return;
    if (hasNonAsciiBarcode(code)) {
      reject(method === "hid");
      return;
    }
    onSubmit(code, scanMethod);
  };
  return {
    reset,
    submit,
    inputProps: {
      // A read-only HID field prevents native IME edits. Keyboard events still
      // arrive; only verified ASCII keys update the controlled field below.
      readOnly: method === "hid",
      inputMode: method === "hid" ? ("none" as const) : ("text" as const),
      lang: "en",
      autoCapitalize: "off",
      autoCorrect: "off",
      spellCheck: false,
      onChange(event: ChangeEvent<HTMLInputElement>) {
        if (method !== "hid") {
          reset();
          setValue(event.target.value);
        }
      },
      onPaste(event: ClipboardEvent<HTMLInputElement>) {
        reset();
        if (method === "hid") {
          event.preventDefault();
          setValue(event.clipboardData.getData("text/plain"));
        }
      },
      onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
        if (method !== "hid") {
          if (
            event.key === "Enter" &&
            (event.nativeEvent.isComposing || event.keyCode === 229)
          )
            event.preventDefault();
          return;
        }
        const state = current();
        if (event.ctrlKey || event.metaKey || event.altKey) {
          if ((event.ctrlKey || event.metaKey) && event.code === "KeyA") {
            event.preventDefault();
            reset();
            event.currentTarget.select();
          } else if (
            ["Backspace", "Delete"].includes(event.key) ||
            ["Backspace", "Delete"].includes(event.code)
          ) {
            // Some desktop IMEs replace a composed word using Ctrl+Backspace.
            // Treat that replacement as a lost physical sequence as well.
            event.preventDefault();
            state.blocked = true;
          }
          return;
        }
        if (
          ["Enter", "Tab"].includes(event.key) ||
          ["Enter", "NumpadEnter", "Tab"].includes(event.code)
        ) {
          if (
            (event.key === "Tab" || event.code === "Tab") &&
            !state.active &&
            !state.blocked &&
            !value.trim()
          )
            return;
          event.preventDefault();
          submit();
          return;
        }
        if (event.key === "Escape" || event.code === "Escape") {
          event.preventDefault();
          reset();
          setValue("");
          return;
        }
        if (
          ["Shift", "Control", "Alt", "Meta", "CapsLock", "NumLock"].includes(
            event.key,
          ) ||
          ["CapsLock", "NumLock"].includes(event.code) ||
          /^(Shift|Control|Alt|Meta)(Left|Right)$/.test(event.code)
        )
          return;
        if (/^(Arrow|Home|End|Page)/.test(event.key)) return;
        if (
          /^F\d{1,2}$/.test(event.key) ||
          [
            "Insert",
            "Pause",
            "PrintScreen",
            "ScrollLock",
            "ContextMenu",
          ].includes(event.key)
        )
          return;
        event.preventDefault();
        // A software keyboard may inject replacement Backspace/Unicode events
        // before the browser. If raw keys are missing, block the whole attempt
        // instead of submitting an apparently valid but shortened identifier.
        if (["Backspace", "Delete"].includes(event.key)) {
          if (state.active) state.blocked = true;
          else setValue("");
          return;
        }
        const char = barcodeKeyCharacter(event);
        if (char === null || state.text.length >= 2048) {
          state.blocked = true;
          return;
        }
        if (state.blocked) return;
        state.active = true;
        state.text += char;
        setValue(state.text);
      },
    },
  };
}
