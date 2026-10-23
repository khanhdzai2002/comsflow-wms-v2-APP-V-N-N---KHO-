import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { Info } from "lucide-react";

export function MetricHelp({
  label,
  children,
}: {
  label: string;
  children: string;
}) {
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const tooltip = useRef<HTMLDivElement>(null);
  const closing = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const focused = useRef(false);
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<{
    left: number;
    top: number;
  } | null>(null);
  const cancelClose = () => clearTimeout(closing.current);
  function show() {
    cancelClose();
    setOpen(true);
  }
  function leave() {
    cancelClose();
    closing.current = setTimeout(() => {
      if (!focused.current) setOpen(false);
    }, 150);
  }
  useEffect(() => () => clearTimeout(closing.current), []);
  const place = useCallback(() => {
    if (!trigger.current || !tooltip.current) return;
    const anchor = trigger.current.getBoundingClientRect();
    const box = tooltip.current.getBoundingClientRect();
    if (anchor.bottom < 0 || anchor.top > window.innerHeight) {
      setOpen(false);
      return;
    }
    setPosition({
      left: Math.max(
        12,
        Math.min(
          anchor.left + anchor.width / 2 - box.width / 2,
          window.innerWidth - box.width - 12,
        ),
      ),
      top:
        anchor.bottom + 8 + box.height <= window.innerHeight - 12
          ? anchor.bottom + 8
          : Math.max(12, anchor.top - box.height - 8),
    });
  }, []);
  useLayoutEffect(() => {
    if (open) place();
    else setPosition(null);
  }, [open, place]);
  useEffect(() => {
    if (!open) return;
    const dismiss = () => {
      cancelClose();
      setOpen(false);
    };
    const outside = (event: PointerEvent) => {
      if (
        !trigger.current?.contains(event.target as Node) &&
        !tooltip.current?.contains(event.target as Node)
      )
        dismiss();
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") dismiss();
    };
    const scroll = () => {
      if (focused.current && document.activeElement === trigger.current)
        place();
      else dismiss();
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    window.addEventListener("scroll", scroll, true);
    window.addEventListener("resize", dismiss);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape);
      window.removeEventListener("scroll", scroll, true);
      window.removeEventListener("resize", dismiss);
    };
  }, [open, place]);
  return (
    <>
      <button
        ref={trigger}
        type="button"
        className="metric-help"
        aria-label={"Giải thích: " + label}
        aria-describedby={open ? id : undefined}
        onMouseEnter={show}
        onMouseLeave={leave}
        onFocus={() => {
          focused.current = true;
          show();
        }}
        onBlur={() => {
          focused.current = false;
          leave();
        }}
        onClick={(event) => {
          event.stopPropagation();
          show();
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.stopPropagation();
            cancelClose();
            setOpen(false);
          }
        }}
      >
        <Info size={14} aria-hidden="true" />
      </button>
      {open &&
        createPortal(
          <div
            ref={tooltip}
            id={id}
            role="tooltip"
            className="metric-tooltip"
            style={{
              left: position?.left ?? 0,
              top: position?.top ?? 0,
              visibility: position ? "visible" : "hidden",
            }}
            onMouseEnter={cancelClose}
            onMouseLeave={leave}
          >
            {children}
          </div>,
          document.body,
        )}
    </>
  );
}
