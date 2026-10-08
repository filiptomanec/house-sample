"use client";
// Element size hooks shared by the charts and drawings (moved here from components/plot, which keeps a copy until its
// package switches its imports). Draw an SVG at its measured width with fixed-size text instead of scaling a viewBox.
import { useEffect, useState, type RefObject } from "react";

/**
 * Width in CSS pixels of an element, kept up to date with a ResizeObserver. Null until the element has been measured
 * (during server rendering and the first paint), so callers assume a desktop width until then.
 */
export function useWidth(ref: RefObject<Element | null>): number | null {
  const [w, setW] = useState<number | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // the observer reports the initial size right after observe()
    const ro = new ResizeObserver(() => {
      const width = el.getBoundingClientRect().width;
      if (width > 0) setW((old) => (old !== null && Math.abs(old - width) < 0.5 ? old : width));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return w;
}

/** Width and height in CSS pixels of an element (null until measured). */
export function useSize(ref: RefObject<Element | null>): { w: number; h: number } | null {
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) setSize((o) => (o && Math.abs(o.w - r.width) < 0.5 && Math.abs(o.h - r.height) < 0.5 ? o : { w: r.width, h: r.height }));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return size;
}
