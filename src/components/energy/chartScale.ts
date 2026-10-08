// Axis helpers of the Energy charts: "nice" ticks (a step of 1, 2 or 5 times a power of ten), the decimals the tick labels
// need, and coordinates rounded so that server and browser write the same markup. Pure, tested.

/** A value axis: ticks from 0 to `max` every `step`. */
export interface NiceAxis {
  step: number;
  max: number;
  ticks: number[];
}

/**
 * Ticks for an axis from 0 that holds `value`: the step is 1, 2 or 5 times a power of ten (never 2.5, so never 625 / 1 250 /
 * 1 875), chosen so that the number of intervals is as close to `target` as possible; of two equally close steps the one with
 * less empty room above the value wins. `max` is the first multiple of the step that is not below the value. Zero, negative
 * and non-finite values give the axis 0..1.
 */
export function niceTicks(value: number, target = 4): NiceAxis {
  const v = value > 0 && Number.isFinite(value) ? value : 0;
  const want = Math.max(1, Math.round(target));
  if (v === 0) return { step: 1, max: 1, ticks: [0, 1] };
  const rough = v / want;
  const p = Math.floor(Math.log10(rough));
  let best: { step: number; n: number; max: number } | null = null;
  for (let e = p - 1; e <= p + 1; e++) {
    for (const m of [1, 2, 5]) {
      const step = m * 10 ** e;
      const n = Math.max(1, Math.ceil(v / step - 1e-9));
      const max = n * step;
      const better = !best || Math.abs(n - want) < Math.abs(best.n - want) || (Math.abs(n - want) === Math.abs(best.n - want) && max < best.max);
      if (better) best = { step, n, max };
    }
  }
  const { step, n } = best!;
  const ticks = Array.from({ length: n + 1 }, (_, i) => clean(i * step));
  return { step: clean(step), max: clean(n * step), ticks };
}

/** Removes the float noise of a product of a step and an index (0.30000000000000004 -> 0.3). */
const clean = (v: number): number => Number(v.toPrecision(12));

/** The smallest of 1, 2, 2.5, 5, 10 times a power of ten that is not below `value` (1 for zero or negative values). */
export function niceMax(value: number): number {
  if (!(value > 0) || !Number.isFinite(value)) return 1;
  const power = 10 ** Math.floor(Math.log10(value));
  const n = value / power;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * power;
}

/** Decimal places that make every tick label of an axis with this step the same width (0 / 0.5 / 1.0, never 0.0 / 5 / 10). */
export function tickDecimals(step: number): number {
  for (let d = 0; d < 3; d++) if (Math.abs(step * 10 ** d - Math.round(step * 10 ** d)) < 1e-6) return d;
  return 2;
}

/** `count + 1` evenly spaced tick values from 0 to `max`. Prefer niceTicks(), whose steps are always round. */
export function ticks(max: number, count: number): number[] {
  return Array.from({ length: count + 1 }, (_, i) => (i / count) * max);
}

/**
 * A drawing coordinate rounded to 0.01. Server (V8) and browser (JavaScriptCore, SpiderMonkey) may differ in the last bits of
 * trigonometric and power functions, so a raw computed number written into an attribute would not match the server's markup and
 * React would report a hydration mismatch. A rounded number is the same text everywhere.
 */
export const px = (v: number): number => Math.round(v * 100) / 100;

/** Width the charts assume before they are measured (server markup and the first paint): a desktop card. */
export const CHART_FALLBACK_WIDTH = 720;

/** Below this drawing width a chart uses its compact form (month numerals, every sixth hour). */
export const CHART_COMPACT_WIDTH = 560;

/** Measured widths are rounded to 8 px, so a scrollbar or a sub-pixel change does not redraw the chart. */
export const roundWidth = (w: number | null): number => (w === null || !(w > 0) ? CHART_FALLBACK_WIDTH : Math.max(240, Math.round(w / 8) * 8));
