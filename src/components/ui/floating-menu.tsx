// ─────────────────────────────────────────────────────────────────────────────
// FloatingMenu — a dropdown panel that is never clipped.
//
// Hand-built dropdowns used `position: absolute` inside their trigger's
// container. Inside a table (`overflow-x-auto`), a scrolling modal or an
// `overflow-hidden` card, the browser cuts them off at the container edge.
// FloatingMenu renders the panel in a fixed layer on document.body instead,
// positioned against its trigger, so it always shows on top of everything:
//
//   • anchors to `anchorRef`, or by default to the element written just before
//     it (the trigger button), falling back to its parent element;
//   • opens below the trigger and flips above when there is not enough room,
//     limiting its height (with scrolling) only when neither side fits;
//   • stays inside the viewport horizontally and follows scroll and resize;
//   • closes on an outside press or Escape when `onClose` is given.
//
// The root carries the `dropdown-container` class, so existing outside-click
// handlers that test `.closest(".dropdown-container")` treat it as inside.
// ─────────────────────────────────────────────────────────────────────────────
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type * as React from "react";
import { createPortal } from "react-dom";
import { motion } from "motion/react";

/** Above every modal layer in the app (the highest is z-[130]). */
export const FLOATING_MENU_Z_INDEX = 9999;

const VIEWPORT_MARGIN = 8;
const MIN_HEIGHT = 120;

export interface FloatingMenuProps {
  open: boolean;
  children: React.ReactNode;
  /** Element to position against. Defaults to the element just before the menu. */
  anchorRef?: React.RefObject<HTMLElement | null>;
  /** Which trigger edge the menu lines up with. */
  align?: "left" | "right";
  /** Preferred side; the menu flips when that side has less room. */
  side?: "bottom" | "top";
  /** Make the menu exactly as wide as its trigger (default true). */
  matchWidth?: boolean;
  /** Fixed menu width in px when `matchWidth` is false. Otherwise it fits its content. */
  menuWidth?: number;
  /** Height used before the menu has been measured. */
  estimatedHeight?: number;
  /** Gap between trigger and menu in px. */
  offset?: number;
  /** Called on a press outside the menu and its trigger, or on Escape. */
  onClose?: () => void;
  className?: string;
}

interface Position {
  top: number;
  left: number;
  width?: number;
  maxHeight?: number;
}

function samePosition(a: Position | null, b: Position): boolean {
  return (
    !!a &&
    a.top === b.top &&
    a.left === b.left &&
    a.width === b.width &&
    a.maxHeight === b.maxHeight
  );
}

export function FloatingMenu({
  open,
  children,
  anchorRef,
  align = "left",
  side = "bottom",
  matchWidth = true,
  menuWidth,
  estimatedHeight = 240,
  offset = 6,
  onClose,
  className,
}: FloatingMenuProps) {
  const markerRef = useRef<HTMLSpanElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState<Position | null>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  const getAnchor = useCallback((): HTMLElement | null => {
    if (anchorRef?.current) return anchorRef.current;
    const marker = markerRef.current;
    if (!marker) return null;
    return (marker.previousElementSibling as HTMLElement | null) ?? marker.parentElement;
  }, [anchorRef]);

  const compute = useCallback(() => {
    const anchor = getAnchor();
    if (!anchor) return;
    const r = anchor.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const menu = menuRef.current;

    const width = matchWidth ? Math.round(r.width) : menuWidth;
    const w = width ?? menu?.offsetWidth ?? 0;
    // scrollHeight is the natural height even while a maxHeight is applied.
    const h = (menu ? menu.scrollHeight : 0) || estimatedHeight;

    const below = vh - r.bottom - offset - VIEWPORT_MARGIN;
    const above = r.top - offset - VIEWPORT_MARGIN;
    let placement = side;
    if (side === "bottom" && h > below && above > below) placement = "top";
    if (side === "top" && h > above && below > above) placement = "bottom";

    const room = placement === "bottom" ? below : above;
    const maxHeight = h > room ? Math.max(MIN_HEIGHT, Math.floor(room)) : undefined;
    const shown = maxHeight ?? h;
    const top = placement === "bottom" ? r.bottom + offset : r.top - offset - shown;

    let left = align === "right" ? r.right - w : r.left;
    left = Math.min(left, vw - VIEWPORT_MARGIN - w);
    left = Math.max(VIEWPORT_MARGIN, left);

    const next: Position = {
      top: Math.round(top),
      left: Math.round(left),
      width: width ?? undefined,
      maxHeight,
    };
    setPos((prev) => (samePosition(prev, next) ? prev : next));
  }, [getAnchor, matchWidth, menuWidth, estimatedHeight, offset, side, align]);

  // Position before paint, then keep following the trigger.
  useLayoutEffect(() => {
    if (!open) {
      setPos(null);
      return;
    }
    compute();
    window.addEventListener("resize", compute);
    window.addEventListener("scroll", compute, true);
    let observer: ResizeObserver | null = null;
    if (typeof ResizeObserver !== "undefined") {
      observer = new ResizeObserver(() => compute());
      if (menuRef.current) observer.observe(menuRef.current);
      const anchor = getAnchor();
      if (anchor) observer.observe(anchor);
    }
    return () => {
      window.removeEventListener("resize", compute);
      window.removeEventListener("scroll", compute, true);
      observer?.disconnect();
    };
  }, [open, compute, getAnchor]);

  // Outside press / Escape.
  useEffect(() => {
    if (!open || !onClose) return;
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Node | null;
      if (!target) return;
      if (menuRef.current?.contains(target)) return;
      if (getAnchor()?.contains(target)) return; // the trigger toggles itself
      onCloseRef.current?.();
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCloseRef.current?.();
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open, onClose, getAnchor]);

  if (!open || typeof document === "undefined") return null;

  const style: React.CSSProperties = {
    position: "fixed",
    zIndex: FLOATING_MENU_Z_INDEX,
    top: pos?.top ?? 0,
    left: pos?.left ?? 0,
    // Hidden until measured, so it never flashes in the wrong place.
    visibility: pos ? "visible" : "hidden",
    ...(pos?.width != null ? { width: pos.width } : {}),
    ...(pos?.maxHeight != null ? { maxHeight: pos.maxHeight, overflowY: "auto" } : {}),
  };

  return (
    <>
      <span ref={markerRef} hidden aria-hidden="true" />
      {createPortal(
        <motion.div
          ref={menuRef}
          data-floating-menu=""
          className={className ? `dropdown-container ${className}` : "dropdown-container"}
          style={style}
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 4 }}
          transition={{ duration: 0.12 }}
        >
          {children}
        </motion.div>,
        document.body,
      )}
    </>
  );
}

export default FloatingMenu;
