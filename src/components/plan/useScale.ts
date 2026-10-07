"use client";
import { useEffect, useState, type RefObject } from "react";

/**
 * Pixels on screen per metre of the drawing (changes with the window width and with the zoom chip).
 * Null until the SVG has been measured, i.e. during server rendering; callers then assume a desktop width.
 */
export function useScale(ref: RefObject<SVGSVGElement | null>, metres: number): number | null {
  const [s, setS] = useState<number | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // a ResizeObserver reports the initial size right after observe()
    const ro = new ResizeObserver(() => {
      const w = el.getBoundingClientRect().width;
      if (w > 0) setS(w / metres);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref, metres]);
  return s;
}
