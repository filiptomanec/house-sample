import { describe, expect, it } from "vitest";
import { niceMax, px, tickDecimals, ticks } from "./chartScale";

describe("niceMax", () => {
  it("never goes below the value and stays within a factor 2 of it", () => {
    for (let v = 0.013; v < 1e5; v *= 1.37) {
      const m = niceMax(v);
      expect(m).toBeGreaterThanOrEqual(v);
      expect(m).toBeLessThanOrEqual(2 * v + 1e-9);
    }
  });
  it("returns round numbers", () => {
    expect([niceMax(0.9), niceMax(1.1), niceMax(2.2), niceMax(4.4), niceMax(7), niceMax(1234)]).toEqual([1, 2, 2.5, 5, 10, 2000]);
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
    expect(ticks(10, 4)).toEqual([0, 2.5, 5, 7.5, 10]);
  });
});

describe("px", () => {
  it("makes numbers that differ in the last bits the same text", () => {
    expect(String(px(221.2118067388282))).toBe(String(px(221.21180673882822)));
    expect(px(10.96041873328474)).toBe(10.96);
    expect(px(-0.004)).toBe(-0);
  });
});
