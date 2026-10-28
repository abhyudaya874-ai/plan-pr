"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";

/**
 * useResizable — drag-to-resize state for a panel along one axis.
 * `sign` maps pointer movement to size: +1 grows toward +x/+y,
 * -1 inverts (e.g. a right-docked panel grows when the pointer moves left).
 * `max` may be a function evaluated at drag time (for viewport-based caps).
 * Size persists to localStorage when `storageKey` is set; `reset()` restores
 * `initial` (wire to double-click on the handle).
 */
export function useResizable(opts: {
  axis: "x" | "y";
  initial: number;
  min: number;
  max: number | (() => number);
  sign?: 1 | -1;
  storageKey?: string;
}) {
  const { axis, initial, min, max, sign = 1, storageKey } = opts;
  const [size, setSize] = useState(initial);
  const sizeRef = useRef(initial);
  const cfgRef = useRef({ min, max, initial });
  useEffect(() => {
    cfgRef.current = { min, max, initial };
  });

  const apply = useCallback(
    (n: number) => {
      const { min: lo, max: hi } = cfgRef.current;
      const cap = typeof hi === "function" ? hi() : hi;
      const c = Math.min(Math.max(n, lo), cap);
      sizeRef.current = c;
      setSize(c);
      if (storageKey) localStorage.setItem(storageKey, String(Math.round(c)));
    },
    [storageKey],
  );

  useEffect(() => {
    if (!storageKey) return;
    const v = Number(localStorage.getItem(storageKey));
    if (Number.isFinite(v) && v > 0) apply(v);
  }, [storageKey, apply]);

  useEffect(() => {
    const onResize = () => apply(sizeRef.current);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [apply]);

  const onPointerDown = useCallback(
    (e: ReactPointerEvent<HTMLElement>) => {
      if (e.button !== 0) return;
      e.preventDefault();
      const el = e.currentTarget;
      const startPos = axis === "x" ? e.clientX : e.clientY;
      const startSize = sizeRef.current;
      el.setPointerCapture(e.pointerId);
      const prevCursor = document.body.style.cursor;
      const prevSelect = document.body.style.userSelect;
      document.body.style.cursor = axis === "x" ? "col-resize" : "row-resize";
      document.body.style.userSelect = "none";

      const move = (ev: PointerEvent) => {
        const pos = axis === "x" ? ev.clientX : ev.clientY;
        apply(startSize + sign * (pos - startPos));
      };
      const end = () => {
        el.removeEventListener("pointermove", move);
        el.removeEventListener("pointerup", end);
        el.removeEventListener("pointercancel", end);
        document.body.style.cursor = prevCursor;
        document.body.style.userSelect = prevSelect;
      };
      el.addEventListener("pointermove", move);
      el.addEventListener("pointerup", end);
      el.addEventListener("pointercancel", end);
    },
    [axis, sign, apply],
  );

  const reset = useCallback(() => apply(cfgRef.current.initial), [apply]);

  return { size, setSize: apply, onPointerDown, reset };
}

/**
 * Resizer — a slim drag handle to place between two flex siblings.
 * vertical = splits left|right (drag in x); horizontal = splits top/bottom.
 */
export function Resizer({
  orientation,
  onPointerDown,
  onDoubleClick,
  className = "",
}: {
  orientation: "vertical" | "horizontal";
  onPointerDown: (e: ReactPointerEvent<HTMLElement>) => void;
  onDoubleClick?: () => void;
  className?: string;
}) {
  const v = orientation === "vertical";
  return (
    <div
      role="separator"
      aria-orientation={v ? "vertical" : "horizontal"}
      onPointerDown={onPointerDown}
      onDoubleClick={onDoubleClick}
      title="drag to resize · double-click to reset"
      className={`group relative shrink-0 touch-none select-none ${
        v ? "w-1.5 cursor-col-resize" : "h-1.5 cursor-row-resize"
      } ${className}`}
    >
      <div
        className={`absolute ${
          v
            ? "inset-y-0 left-1/2 w-px -translate-x-1/2"
            : "inset-x-0 top-1/2 h-px -translate-y-1/2"
        } bg-zinc-800 transition group-hover:bg-[#c9854a]/70 group-active:bg-[#c9854a]`}
      />
    </div>
  );
}
