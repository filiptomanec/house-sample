// The scale of the estimate band: where the typical range and the house price sit on one axis, with round ticks in millions.
const MILLION = 1e6;
const STEPS_M = [1, 2, 5, 10, 20, 50, 100];

export interface BandScale {
  min: number;
  max: number;
  /** Tick values, whole millions, from `min` to `max`. */
  ticks: number[];
  /** Position of a value on the axis, 0..1 (clamped). */
  at: (value: number) => number;
  /** Where the value lies against the typical range; the ends belong to "within". */
  where: "below" | "within" | "above";
}

/** An axis that holds the range `low`..`high` and the `value` with some room around, ticks every 1, 2, 5, 10... million. */
export function bandScale(low: number, high: number, value: number): BandScale {
  const lo = Math.min(low, value);
  const hi = Math.max(high, value);
  const pad = Math.max(0.5 * MILLION, (hi - lo) * 0.25);
  const rawStep = (hi - lo + 2 * pad) / 5;
  const step = (STEPS_M.find((m) => m * MILLION >= rawStep) ?? STEPS_M[STEPS_M.length - 1]) * MILLION;
  const min = Math.max(0, Math.floor((lo - pad) / step) * step);
  const max = Math.ceil((hi + pad) / step) * step;
  const ticks: number[] = [];
  for (let v = min; v <= max + 1e-6; v += step) ticks.push(Math.round(v));
  return {
    min, max, ticks,
    at: (v) => Math.min(1, Math.max(0, (v - min) / (max - min))),
    where: value < low ? "below" : value > high ? "above" : "within",
  };
}
