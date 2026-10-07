// Axis helpers of the Energy charts: a "nice" upper limit and the decimals the tick labels need. Pure, tested.

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

/** `count + 1` evenly spaced tick values from 0 to `max`. */
export function ticks(max: number, count: number): number[] {
  return Array.from({ length: count + 1 }, (_, i) => (i / count) * max);
}

/**
 * A drawing coordinate rounded to 0.01. Server (V8) and browser (JavaScriptCore, SpiderMonkey) may differ in the last bits of
 * trigonometric and power functions, so a raw computed number written into an attribute would not match the server's markup and
 * React would report a hydration mismatch. A rounded number is the same text everywhere.
 */
export const px = (v: number): number => Math.round(v * 100) / 100;
