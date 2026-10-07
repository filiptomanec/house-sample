// Pure helpers behind the shared form controls (no React, no DOM), so they can be unit-tested.
// Locale-aware formatting and parsing live in lib/i18n/format.ts; they are re-exported here for the controls.

import type { Locale } from "@/lib/i18n/config";
import { formatNum as formatLocaleNum, parseNum as parseLocaleNum } from "@/lib/i18n/format";

/** Locale number (Czech: spaces as thousands separator, decimal comma; real minus sign; "–" for NaN). */
export const formatNum = (v: number, minDigits = 0, maxDigits = minDigits, locale: Locale = "cs"): string => formatLocaleNum(v, minDigits, maxDigits, locale);

/** Reads a typed number; null for empty or unreadable text, so callers can tell it apart from 0. See lib/i18n/format.ts. */
export const parseNum = (text: string, locale: Locale = "cs"): number | null => parseLocaleNum(text, locale);

export const clampNum = (v: number, min = -Infinity, max = Infinity) => Math.min(max, Math.max(min, v));

/** Rounds to `digits` decimal places. */
export const roundTo = (v: number, digits: number) => { const f = 10 ** digits; return Math.round(v * f) / f; };

/** Decimal places of a step such as 0.1 or 0.25 (0 for whole numbers). */
export function stepDigits(step: number): number {
  if (!Number.isFinite(step) || Number.isInteger(step)) return 0;
  const s = String(step);
  const e = s.match(/e-(\d+)$/);
  return e ? +e[1] : (s.split(".")[1]?.length ?? 0);
}

/** Adds `dir` steps and rounds to the step's precision, so 0.1 + 0.2 stays 0.3. */
export function stepNum(v: number, step: number, dir: 1 | -1, min = -Infinity, max = Infinity): number {
  const d = stepDigits(step);
  return clampNum(+(v + dir * step).toFixed(d), min, max);
}

/** Value under a pointer on a horizontal slider whose thumb (width `thumb`) travels between the two ends. */
export function sliderValueAt(x: number, width: number, thumb: number, min: number, max: number, step: number): number {
  const f = clampNum((x - thumb / 2) / Math.max(1, width - thumb), 0, 1);
  const v = min + Math.round((f * (max - min)) / step) * step;
  return clampNum(+v.toFixed(stepDigits(step)), min, max);
}

/** Layout of a segmented control: all segments in one row, a balanced grid of `cols` columns, or one per line. */
export type SegFit = { kind: "row"; cols: number } | { kind: "grid"; cols: number } | { kind: "stack"; cols: 1 };

/**
 * Picks the layout from the natural (one-line) widths of the segments and the room available for them.
 * Grids only use column counts that divide the segment count, so no row is left half empty (4 → 2 × 2, 6 → 3 × 2).
 * A column is as wide as its widest segment; `gap` is the space between neighbouring segments.
 */
export function pickSegFit(widths: number[], room: number, gap = 0): SegFit {
  const n = widths.length;
  const need = (cols: number) => {
    let sum = (cols - 1) * gap;
    for (let c = 0; c < cols; c++) {
      let w = 0;
      for (let i = c; i < n; i += cols) w = Math.max(w, widths[i]);
      sum += w;
    }
    return sum;
  };
  const tolerance = 0.5; // sub-pixel rounding of measured text
  if (n <= 1 || need(n) <= room + tolerance) return { kind: "row", cols: Math.max(1, n) };
  for (let cols = n - 1; cols >= 2; cols--) if (n % cols === 0 && need(cols) <= room + tolerance) return { kind: "grid", cols };
  return { kind: "stack", cols: 1 };
}
