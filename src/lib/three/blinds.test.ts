import { describe, expect, it } from "vitest";
import { getHouseContext } from "./context";
import { slatPositions } from "./blinds";

const ctx = getHouseContext();
const { pitch, width, depth } = ctx.house.shading.slats;
const broad = Math.max(width, depth);

describe("slatPositions", () => {
  it("spreads slats one pitch apart inside the screen, half a pitch from the start", () => {
    const s = slatPositions(2.7, 5.15, pitch, broad);
    expect(s.length).toBe(Math.floor((5.15 - 2.7) / pitch));
    expect(s[0].spread).toBeCloseTo(2.7 + pitch / 2, 9);
    for (let i = 1; i < s.length; i++) expect(s[i].spread - s[i - 1].spread).toBeCloseTo(pitch, 9);
    expect(s[s.length - 1].spread).toBeLessThan(5.15);
  });

  it("stacks them side by side against the `to` end, in the same order", () => {
    const s = slatPositions(0, 3, pitch, broad);
    expect(s[s.length - 1].stacked + broad / 2).toBeCloseTo(3, 9);
    for (let i = 1; i < s.length; i++) expect(s[i].stacked - s[i - 1].stacked).toBeCloseTo(broad, 9);
    // stacking only moves slats towards the `to` end
    for (const p of s) expect(p.stacked).toBeGreaterThanOrEqual(p.spread - 1e-9);
  });

  it("is empty for a screen shorter than one pitch", () => {
    expect(slatPositions(0, pitch / 2, pitch, broad)).toEqual([]);
  });

  it("draws slats for every screen of the model: the slats fit on the screen when stacked", () => {
    for (const screen of ctx.derived.screens) {
      const s = slatPositions(screen.from, screen.to, pitch, broad);
      expect(s.length, screen.id).toBeGreaterThan(0);
      expect(s[0].stacked - broad / 2).toBeGreaterThanOrEqual(screen.from - 1e-9);
    }
  });

  it("uses the dimensions of the shading style: the broad face is the larger one", () => {
    expect(broad).toBeGreaterThanOrEqual(Math.min(width, depth));
    expect(pitch).toBeGreaterThan(broad);
  });
});
