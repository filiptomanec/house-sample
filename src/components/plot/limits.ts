// Bar geometry for "a share of the plot against its limit" (pure, tested in plot.test.ts).

/**
 * Position of the filled part and of the limit mark along a bar, both 0..1. A maximum (built-up share) gets a bar that
 * ends a little beyond the limit so the mark is not at the edge; a minimum (green share) uses the whole plot.
 */
export function limitBar(ratio: number, limit: number, rule: "min" | "max"): { value: number; mark: number; ok: boolean } {
  const top = rule === "max" ? Math.min(1, Math.max(limit * 1.35, ratio * 1.1)) : 1;
  return { value: Math.min(1, ratio / top), mark: Math.min(1, limit / top), ok: rule === "max" ? ratio <= limit : ratio >= limit };
}
