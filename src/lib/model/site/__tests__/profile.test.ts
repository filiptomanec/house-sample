import { describe, expect, it } from "vitest";
import siteRaw from "@model/site.json";
import { sampleProfile, measureBetween } from "../profile";
import { createTerrain } from "../terrain";
import { parseSite } from "../siteSchema";
import { FIXTURE_BEARING_DEG } from "./fixture";

const site = parseSite(siteRaw);
const terrain = createTerrain(site.terrain, FIXTURE_BEARING_DEG);
const plane = (x: number, y: number) => 0.04 * y - 0.01 * x + 2;

describe("sampleProfile", () => {
  it("starts and ends exactly at the given points with the given spacing", () => {
    const p = sampleProfile(terrain.groundAt, [-4, -14], [20, 18], { step: 0.5 });
    expect(p.points[0].x).toBe(-4);
    expect(p.points[0].y).toBe(-14);
    expect(p.points[p.points.length - 1].x).toBeCloseTo(20, 12);
    expect(p.points[p.points.length - 1].y).toBeCloseTo(18, 12);
    expect(p.length).toBeCloseTo(Math.hypot(24, 32), 12);
    expect(p.points[p.points.length - 1].s).toBeCloseTo(p.length, 12);
    for (const q of p.points) expect(q.z).toBe(terrain.groundAt(q.x, q.y));
    expect(p.points.length).toBe(Math.ceil(p.length / 0.5) + 1);
  });

  it("count option and degenerate (zero length) profiles", () => {
    expect(sampleProfile(plane, [0, 0], [10, 0], { count: 11 }).points).toHaveLength(11);
    const z = sampleProfile(plane, [3, 3], [3, 3]);
    expect(z.length).toBe(0);
    expect(z.rise).toBe(0);
    expect(z.meanSlopePct).toBe(0);
  });

  it("on a plane the rise and slope are exact", () => {
    const p = sampleProfile(plane, [0, 0], [0, 25], { step: 1 });
    expect(p.rise).toBeCloseTo(1, 12);
    expect(p.ascent).toBeCloseTo(1, 12);
    expect(p.descent).toBe(0);
    expect(p.maxSlopePct).toBeCloseTo(4, 9);
    expect(p.meanSlopePct).toBeCloseTo(4, 9);
    const d = sampleProfile(plane, [20, 0], [0, 0], { step: 1 });
    expect(d.rise).toBeCloseTo(0.2, 12);
  });

  it("ascent minus descent equals the rise on the real terrain, extremes bound every sample", () => {
    const p = sampleProfile(terrain.groundAt, [-4, -15], [27, 21], { step: 0.25 });
    expect(p.ascent - p.descent).toBeCloseTo(p.rise, 9);
    for (const q of p.points) {
      expect(q.z).toBeGreaterThanOrEqual(p.zMin);
      expect(q.z).toBeLessThanOrEqual(p.zMax);
    }
    expect(p.zMax).toBeGreaterThan(p.zMin);
  });

  it("a profile through the levelled house is flat there", () => {
    const p = sampleProfile(terrain.groundAt, [0, 2], [22, 2], { step: 0.5 });
    for (const q of p.points) expect(q.z).toBe(0);
    expect(p.maxSlopePct).toBe(0);
  });
});

describe("measureBetween", () => {
  it("distance, height difference and slope", () => {
    const m = measureBetween(plane, [0, 0], [0, 10], 12);
    expect(m.distance).toBeCloseTo(10, 12);
    expect(m.dz).toBeCloseTo(0.4, 12);
    expect(m.slopePct).toBeCloseTo(4, 9);
    expect(m.slopeDeg).toBeCloseTo((Math.atan(0.04) * 180) / Math.PI, 9);
    expect(m.distance3d).toBeCloseTo(Math.hypot(10, 0.4), 12);
    expect(m.houseAzimuth).toBeCloseTo(0, 9);
    expect(m.trueAzimuth).toBeCloseTo(12, 9);
    const back = measureBetween(plane, [0, 10], [0, 0], 12);
    expect(back.dz).toBeCloseTo(-0.4, 12);
    expect(back.slopePct).toBeCloseTo(-4, 9);
    expect(back.houseAzimuth).toBeCloseTo(180, 9);
    expect(back.trueAzimuth).toBeCloseTo(192, 9);
  });

  it("azimuths in the house and the true frame differ by the axis bearing", () => {
    const m = measureBetween(terrain.groundAt, [0, 0], [10, 10], FIXTURE_BEARING_DEG);
    expect(m.houseAzimuth).toBeCloseTo(45, 9);
    expect(m.trueAzimuth).toBeCloseTo(57, 9);
  });

  it("is consistent with the terrain heights and the profile", () => {
    const a: [number, number] = [-2, -12], b: [number, number] = [24, 19];
    const m = measureBetween(terrain.groundAt, a, b, FIXTURE_BEARING_DEG);
    expect(m.zFrom).toBe(terrain.groundAt(...a));
    expect(m.zTo).toBe(terrain.groundAt(...b));
    expect(m.dz).toBeCloseTo(m.zTo - m.zFrom, 12);
    expect(m.maxSlopePct).toBeGreaterThanOrEqual(Math.abs(m.slopePct) - 1e-9);
    expect(measureBetween(terrain.groundAt, a, a, 0).slopePct).toBe(0);
  });

  it("reproduces the fall of the ground between the street and the south boundary", () => {
    const m = measureBetween(terrain.groundAt, [3.3, 20.9], [3.3, -15], FIXTURE_BEARING_DEG);
    expect(m.dz).toBeLessThan(-0.5); // the ground falls to the south
    expect(m.slopePct).toBeLessThan(-0.5); // negative: the ground falls towards the end point
    expect(m.slopePct).toBeGreaterThan(-6);
  });
});
