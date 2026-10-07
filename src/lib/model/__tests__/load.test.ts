import { describe, expect, it } from "vitest";
import { ModelError, analyzeHouse, deriveAll, parseHouse } from "../load";
import { pick, roomTypeName } from "../text";
import { cloneHouse, rawHouse } from "./helpers";

describe("load helpers", () => {
  it("parseHouse returns the typed model", () => {
    expect(parseHouse(rawHouse()).schema).toBe("house/1");
  });
  it("parseHouse throws a ModelError with the list of problems", () => {
    const bad = rawHouse();
    bad.rooms = [];
    try {
      parseHouse(bad);
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(ModelError);
      expect((err as ModelError).issues.length).toBeGreaterThan(0);
      expect((err as ModelError).message).toContain("E-TYP");
    }
  });
  it("analyzeHouse returns model, derived data, metrics and warnings", () => {
    const a = analyzeHouse(rawHouse(), { inputHash: "x" });
    expect(a.derived.inputHash).toBe("x");
    expect(a.metrics.netArea).toBeGreaterThan(0);
    expect(a.warnings).toEqual([]);
  });
  it("analyzeHouse refuses a model with geometry errors", () => {
    const h = cloneHouse();
    h.roofs = [];
    expect(() => analyzeHouse(h)).toThrow(ModelError);
  });
  it("deriveAll skips the design rules", () => {
    const h = cloneHouse();
    h.roofs = [];
    const { derived, metrics } = deriveAll(h);
    expect(derived.roofPlanes).toEqual([]);
    expect(metrics.roofArea).toBe(0);
    expect(derived.pv.count).toBe(0);
  });
  it("text helpers", () => {
    expect(pick({ cs: "dům", en: "house" }, "en")).toBe("house");
    expect(roomTypeName("garage", "cs")).toBe("garáž");
  });
});
