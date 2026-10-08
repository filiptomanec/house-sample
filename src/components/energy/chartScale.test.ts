import { describe, expect, it } from "vitest";
import { CHART_FALLBACK_WIDTH, niceMax, niceTicks, px, roundWidth, tickDecimals, ticks } from "./chartScale";
import { monthSpan, narrowMonths, shortMonths } from "./months";

/** A step is nice when it is 1, 2 or 5 times a power of ten. */
const isNiceStep = (step: number): boolean => {
  const m = step / 10 ** Math.floor(Math.log10(step) + 1e-9);
  return [1, 2, 5].some((k) => Math.abs(m - k) < 1e-6);
};

describe("niceTicks", () => {
  it("uses steps of 1, 2 or 5 times a power of ten and covers the value with at most one step of room", () => {
    for (let v = 0.013; v < 1e6; v *= 1.29) {
      for (const target of [2, 3, 4, 5]) {
        const a = niceTicks(v, target);
        expect(isNiceStep(a.step), `${v} / ${target}: step ${a.step}`).toBe(true);
        expect(a.max).toBeGreaterThanOrEqual(v * (1 - 1e-9));
        expect(a.max - v).toBeLessThan(a.step + 1e-9);
        expect(a.ticks[0]).toBe(0);
        expect(a.ticks.at(-1)).toBe(a.max);
        // evenly spaced
        for (let i = 1; i < a.ticks.length; i++) expect(a.ticks[i] - a.ticks[i - 1]).toBeCloseTo(a.step, 9);
      }
    }
  });

  it("never produces quarter steps such as 625 / 1 250 / 1 875", () => {
    for (let v = 1; v < 1e5; v *= 1.11) {
      for (const t of niceTicks(v).ticks) {
        if (t === 0) continue;
        const digits = String(t).replace(/^0\.0*|\./g, "").replace(/0+$/, "");
        expect(digits.length, `${v}: tick ${t}`).toBeLessThanOrEqual(2);
      }
    }
  });

  it("keeps the number of intervals near the target", () => {
    for (let v = 0.7; v < 1e5; v *= 1.37) {
      for (const target of [3, 4, 5]) expect(Math.abs(niceTicks(v, target).ticks.length - 1 - target)).toBeLessThanOrEqual(2);
    }
  });

  it("prints ticks without float noise", () => {
    for (let v = 0.011; v < 10; v *= 1.21) for (const t of niceTicks(v).ticks) expect(String(t).length).toBeLessThan(8);
  });

  it("gives the axis 0..1 for zero, negative and non-finite values", () => {
    for (const v of [0, -5, Number.NaN, Infinity]) expect(niceTicks(v)).toEqual({ step: 1, max: 1, ticks: [0, 1] });
  });
});

describe("niceMax", () => {
  it("never goes below the value and stays within a factor 2 of it", () => {
    for (let v = 0.013; v < 1e5; v *= 1.37) {
      const m = niceMax(v);
      expect(m).toBeGreaterThanOrEqual(v);
      expect(m).toBeLessThanOrEqual(2 * v + 1e-9);
    }
  });
  it("is 1 for zero, negative and non-finite values", () => {
    for (const v of [0, -5, Number.NaN, Infinity]) expect(niceMax(v)).toBe(1);
  });
});

describe("tickDecimals and ticks", () => {
  it("uses just enough decimals for the step", () => {
    expect(tickDecimals(1)).toBe(0);
    expect(tickDecimals(0.5)).toBe(1);
    expect(tickDecimals(0.25)).toBe(2);
    expect(tickDecimals(250)).toBe(0);
  });
  it("spreads ticks evenly from 0 to the maximum", () => {
    const t = ticks(10, 4);
    expect(t).toHaveLength(5);
    expect(t[0]).toBe(0);
    expect(t.at(-1)).toBe(10);
  });
});

describe("px and roundWidth", () => {
  it("makes numbers that differ in the last bits the same text", () => {
    expect(String(px(221.2118067388282))).toBe(String(px(221.21180673882822)));
    expect(px(-0.004)).toBe(-0);
  });
  it("assumes the fallback width until measured and rounds measured widths to 8 px", () => {
    expect(roundWidth(null)).toBe(CHART_FALLBACK_WIDTH);
    expect(roundWidth(0)).toBe(CHART_FALLBACK_WIDTH);
    for (const w of [301.4, 333.3, 871.9]) {
      expect(roundWidth(w) % 8).toBe(0);
      expect(Math.abs(roundWidth(w) - w)).toBeLessThanOrEqual(4);
    }
  });
});

describe("month labels", () => {
  it("has twelve distinct labels in both languages, short enough for a narrow axis", () => {
    for (const locale of ["cs", "en"] as const) {
      for (const list of [shortMonths(locale), narrowMonths(locale)]) {
        expect(list).toHaveLength(12);
        expect(new Set(list).size).toBe(12);
      }
      expect(Math.max(...narrowMonths(locale).map((m) => m.length))).toBeLessThanOrEqual(4);
    }
  });
  it("writes a season as a range of long month names", () => {
    expect(monthSpan("en", [4, 5, 6, 7, 8])).toBe("May\u{2013}September");
    expect(monthSpan("en", [6])).toBe("July");
    expect(monthSpan("cs", [])).toBe("");
  });
});
