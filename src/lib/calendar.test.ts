import { describe, expect, it } from "vitest";
import { DAYS_IN_MONTH, dayMonth, dayOfYear, monthNames, weekdayNames } from "./calendar";
import { NBSP } from "./i18n/format";

describe("calendar", () => {
  it("names the months per language", () => {
    expect(monthNames("cs")).toHaveLength(12);
    expect(monthNames("cs")[2]).toBe("březen");
    expect(monthNames("en")[2]).toBe("March");
    expect(monthNames("cs", "short")[0]).toMatch(/^led/);
    expect(monthNames("en", "short")[8]).toBe("Sep");
  });
  it("writes a day and month the way a sentence needs it", () => {
    expect(dayMonth("cs", 2, 15)).toBe(`15.${NBSP}března`);
    expect(dayMonth("en", 2, 15)).toBe("15 March");
  });
  it("names the weekdays from Monday", () => {
    expect(weekdayNames("cs")[0]).toBe("pondělí");
    expect(weekdayNames("en")[6]).toBe("Sunday");
  });
  it("has 365 days and counts the day of the year", () => {
    expect(DAYS_IN_MONTH.reduce((a, b) => a + b, 0)).toBe(365);
    expect(dayOfYear(0, 1)).toBe(1);
    expect(dayOfYear(11, 31)).toBe(365);
    expect(dayOfYear(2, 1)).toBe(60);
  });
});
