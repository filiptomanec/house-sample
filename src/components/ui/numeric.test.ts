import { describe, expect, it } from "vitest";
import { clampNum, formatNum, parseNum, pickSegFit, roundTo, sliderValueAt, stepDigits, stepNum } from "./numeric";

const NBSP = "\u{a0}", MINUS = "\u{2212}";

describe("formatNum", () => {
  it("uses Czech separators by default", () => {
    expect(formatNum(26000)).toBe(`26${NBSP}000`);
    expect(formatNum(1234567.891, 2)).toBe(`1${NBSP}234${NBSP}567,89`);
    expect(formatNum(12.5, 0, 2)).toBe("12,5");
  });
  it("follows the locale", () => {
    expect(formatNum(1234567.891, 2, 2, "en")).toBe("1,234,567.89");
    expect(formatNum(12.5, 0, 2, "en")).toBe("12.5");
  });
  it("writes a real minus and drops the sign of a rounded zero", () => {
    expect(formatNum(-0.9, 2)).toBe(`${MINUS}0,90`);
    expect(formatNum(-5)).toBe(`${MINUS}5`);
    expect(formatNum(-0.2)).toBe("0");
    expect(formatNum(-0.001, 2)).toBe("0,00");
  });
  it("shows a dash for missing values", () => expect(formatNum(NaN)).toBe("–"));
});

describe("parseNum", () => {
  it("reads comma or point decimals and spaced thousands", () => {
    expect(parseNum("12,5")).toBe(12.5);
    expect(parseNum("12.5")).toBe(12.5);
    expect(parseNum(`26${NBSP}000`)).toBe(26000);
    expect(parseNum(" 1 000 000 ")).toBe(1e6);
    expect(parseNum("12,")).toBe(12);
    expect(parseNum(",5")).toBe(0.5);
  });
  it("reads a hyphen or a real minus", () => {
    expect(parseNum("-5")).toBe(-5);
    expect(parseNum(`${MINUS}5`)).toBe(-5);
  });
  it("returns null for empty or unreadable text instead of 0", () => {
    for (const t of ["", " ", "-", ",", "1,2,3", "abc", "12 Kč", "1e5"]) expect(parseNum(t), t).toBeNull();
  });
  it("reads English thousands", () => {
    expect(parseNum("26,000", "en")).toBe(26000);
    expect(parseNum("1,234.5", "en")).toBe(1234.5);
  });
});

describe("steps and sliders", () => {
  it("counts decimal places of a step", () => {
    expect(stepDigits(1)).toBe(0);
    expect(stepDigits(1000)).toBe(0);
    expect(stepDigits(0.1)).toBe(1);
    expect(stepDigits(0.25)).toBe(2);
    expect(stepDigits(1e-7)).toBe(7);
  });
  it("steps without floating-point drift and within limits", () => {
    expect(stepNum(0.2, 0.1, 1)).toBe(0.3);
    expect(stepNum(0, 5000, -1, 0)).toBe(0);
    expect(stepNum(26000, 1000, 1, 0, 26500)).toBe(26500);
  });
  it("rounds to the shown precision", () => {
    expect(roundTo(12.5, 0)).toBe(13);
    expect(roundTo(200.456, 2)).toBe(200.46);
    expect(roundTo(-0.4, 0) + 0).toBe(0);
  });
  it("clamps", () => {
    expect(clampNum(-100000, 0)).toBe(0);
    expect(clampNum(5, 0, 3)).toBe(3);
  });
  it("maps a tap on the track to a value, with the thumb travelling between the ends", () => {
    // 328 px wide track, 28 px thumb: the thumb centre runs from 14 to 314 px
    expect(sliderValueAt(14, 328, 28, 0, 100, 1)).toBe(0);
    expect(sliderValueAt(0, 328, 28, 0, 100, 1)).toBe(0);
    expect(sliderValueAt(164, 328, 28, 0, 100, 1)).toBe(50);
    expect(sliderValueAt(328, 328, 28, 0, 100, 1)).toBe(100);
    expect(sliderValueAt(164, 328, 28, 0.6, 3, 0.1)).toBe(1.8);
    expect(sliderValueAt(164, 328, 28, 1000, 8000, 100)).toBe(4500);
  });
});

describe("pickSegFit", () => {
  // natural widths of four labels at 14 px with 12 px side padding
  const four = [56, 74, 90, 60];
  it("keeps one row when the labels fit", () => {
    expect(pickSegFit(four, 290, 2)).toEqual({ kind: "row", cols: 4 });
  });
  it("balances four segments as 2 × 2 instead of 3 + 1", () => {
    expect(pickSegFit(four, 240, 2)).toEqual({ kind: "grid", cols: 2 });
  });
  it("stacks when even two columns do not fit", () => {
    expect(pickSegFit(four, 150, 2)).toEqual({ kind: "stack", cols: 1 });
  });
  it("never leaves a row half empty: three segments go from one row straight to a stack", () => {
    expect(pickSegFit([80, 60, 100], 245, 2)).toEqual({ kind: "row", cols: 3 });
    expect(pickSegFit([80, 60, 100], 230, 2)).toEqual({ kind: "stack", cols: 1 });
  });
  it("sizes each grid column by its widest segment", () => {
    // six segments, three columns: columns hold [0,3], [1,4], [2,5]
    expect(pickSegFit([40, 40, 40, 90, 40, 40], 180, 0)).toEqual({ kind: "grid", cols: 3 });
    expect(pickSegFit([40, 40, 40, 90, 40, 40], 160, 0)).toEqual({ kind: "grid", cols: 2 });
  });
  it("accepts sub-pixel rounding", () => {
    expect(pickSegFit([100.4, 100], 200, 0)).toEqual({ kind: "row", cols: 2 });
  });
});
