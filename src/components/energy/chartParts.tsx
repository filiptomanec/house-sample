"use client";

// Shared pieces of the Energy charts: the measured drawing width and the 45 degree hatch that tells the battery, the pool and
// the electric car apart from their neighbours without a new hue (DESIGN.md, section 2.1).

import type { RefObject } from "react";
import { useWidth } from "@/components/ui/useWidth";
import { roundWidth } from "./chartScale";

/**
 * Width to draw a chart at, in CSS pixels: the measured width of `ref` rounded to 8 px, or the desktop fallback before it is
 * measured (server markup). The SVG is drawn in a viewBox of exactly that width, so its 11 px text stays 11 px on every screen;
 * its height comes from the stylesheet (`.chart svg`), so nothing jumps when the measured width arrives.
 */
export function useChartWidth(ref: RefObject<Element | null>): number {
  return roundWidth(useWidth(ref));
}

/** Pattern definition of the hatch; fill a copy of a shape with `url(#id)` on top of its series colour. */
export function HatchDef({ id }: { id: string }) {
  return (
    <defs>
      <pattern id={id} width="4" height="4" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
        <rect className="chart-hatch" x="0" y="0" width="1.6" height="4" />
      </pattern>
    </defs>
  );
}
