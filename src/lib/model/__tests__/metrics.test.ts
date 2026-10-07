// Metrics: cross-checks with independent computations (numerical integration, closed forms).
import { describe, expect, it } from "vitest";
import { PV_EFFICIENCY_ESTIMATE, PV_ROOF_USABLE_SHARE } from "../catalog";
import { computeMetrics, roofIntegrals } from "../metrics";
import { roofSurfaceAt } from "../roofs";
import { inRect } from "../geom";
import { baseline } from "./helpers";

const { house, derived: d } = baseline();
const m = computeMetrics(house, d);
const sum = (a: number[]): number => a.reduce((s, v) => s + v, 0);

describe("metrics", () => {
  it("areas of the rooms", () => {
    expect(m.netArea).toBeCloseTo(sum(d.rooms.filter((r) => r.type !== "garage").map((r) => r.area)), 1);
    expect(m.garageArea).toBeCloseTo(sum(d.rooms.filter((r) => r.type === "garage").map((r) => r.area)), 1);
    expect(sum(Object.values(m.areaByType) as number[])).toBeCloseTo(m.netArea + m.garageArea, 1);
    expect(m.roomCount).toBe(house.rooms.length);
    expect(m.heated.floorArea).toBe(m.netArea);
  });

  it("enclosed volume equals a fine numerical integration of the roof surface over the footprint (0.2 %)", () => {
    const step = 0.05;
    const b = d.outline.bbox!;
    let vol = 0;
    for (let y = b.y0 + step / 2; y < b.y1; y += step) {
      for (let x = b.x0 + step / 2; x < b.x1; x += step) {
        if (!d.outline.rects.some((r) => inRect(r, x, y))) continue;
        vol += roofSurfaceAt(d.roofPlanes, x, y)!.z * step * step;
      }
    }
    expect(Math.abs(m.volume - vol) / vol).toBeLessThan(0.002);
  });

  it("volume = walls part + roof part; the wall part is footprint x wall top when all roofs start at the same height", () => {
    expect(m.volumeWalls + m.volumeRoof).toBeCloseTo(m.volume, 0);
    const tops = new Set(d.roofs.map((r) => r.wallTop));
    if (tops.size === 1) expect(m.volumeWalls).toBeCloseTo(m.footprintArea * [...tops][0], 0);
    expect(m.volume).toBeGreaterThan(m.footprintArea * d.defaultWallTop);
    expect(m.volume).toBeLessThan(m.footprintArea * d.bbox.z1);
  });

  it("roof areas: total = sum of the faces, by direction sums up, south area = faces facing south", () => {
    const ri = roofIntegrals(d);
    expect(ri.roofArea).toBeCloseTo(sum(d.roofPlanes.map((f) => f.area)), 9);
    expect(m.roofArea).toBeCloseTo(ri.roofArea, 1);
    expect(sum(Object.values(m.roofAreaByAzimuth))).toBeCloseTo(m.roofArea, 0);
    expect(m.roofSouthArea).toBeCloseTo(sum(d.roofPlanes.filter((f) => f.side === "S").map((f) => f.area)), 1);
    expect(m.roofAreaOverFootprint).toBeLessThan(m.roofArea);
    expect(m.roofAreaOverFootprint).toBeGreaterThan(m.footprintArea);
  });

  it("a single hip roof: the sloped area over the footprint equals the closed form", () => {
    // closed form for any hip roof: sloped area = plan area / cos(pitch); over the footprint when the footprint
    // lies inside one roof rectangle, only the part inside the walls counts
    const big = d.roofs.reduce((a, b) => (b.slopedArea > a.slopedArea ? b : a));
    const cos = Math.cos((big.pitch * Math.PI) / 180);
    expect(big.slopedArea).toBeCloseTo(big.planAreaWithOverhang / cos, 3);
  });

  it("glazing by direction adds up, A/V is envelope over volume", () => {
    expect(m.glazing.N + m.glazing.E + m.glazing.S + m.glazing.W).toBeCloseTo(m.glazing.total, 1);
    expect(m.glazingRatio).toBeCloseTo(m.glazing.total / m.netArea, 1);
    expect(m.envelopeToVolume).toBeCloseTo(m.envelopeArea / m.volume, 1);
    const perimeterWalls = d.outline.perimeter * (m.volumeWalls / m.footprintArea);
    expect(m.envelopeArea).toBeCloseTo(perimeterWalls + m.roofAreaOverFootprint + m.footprintArea, -1);
  });

  it("PV: the potential follows the rule of thumb, the layout the modules", () => {
    expect(m.pvKwp).toBeCloseTo(m.roofSouthArea * PV_EFFICIENCY_ESTIMATE * PV_ROOF_USABLE_SHARE, 1);
    expect(m.pvModuleCount).toBe(d.pv.count);
    expect(m.pvLayoutKwp).toBeCloseTo(d.pv.kwp, 2);
    expect(m.pvLayoutKwp).toBeLessThanOrEqual(m.roofSouthArea * 0.25); // physical bound: efficiency below 25 %
  });

  it("heated envelope: walls minus openings", () => {
    expect(m.heated.wallOpaque).toBeCloseTo(m.heated.wallGross - m.heated.glazing - m.heated.doors, 1);
    expect(m.heated.glazing).toBeLessThanOrEqual(m.glazing.total + 0.01);
    expect(m.uValues.windows).toBe(house.windows.Uw);
  });

  it("heated part: volume and exposed perimeter come from the heated rooms", () => {
    const heated = d.rooms.filter((r) => r.heated);
    expect(m.heated.volume).toBeCloseTo(sum(heated.map((r) => r.area)) * house.clearHeight, 0);
    expect(m.heated.perimeter).toBeCloseTo(sum(heated.map((r) => r.exteriorWallLength)), 1);
    expect(m.heated.perimeter).toBeLessThan(d.outline.perimeter);
    expect(m.heated.volume).toBeLessThan(m.volume);
  });

  it("outdoor areas", () => {
    expect(sum(Object.values(m.outdoorByType) as number[])).toBeCloseTo(sum(d.outdoor.map((o) => o.area)), 1);
    expect(m.terraceCovered + m.terraceUncovered).toBeCloseTo(sum(d.outdoor.filter((o) => o.type === "terrace").map((o) => o.area)), 1);
  });

  it("ridges report the heights above the floor", () => {
    expect(m.ridgeMax).toBeCloseTo(Math.max(...d.roofs.map((r) => r.ridgeHeight)), 1);
    expect(m.ridgeMax).toBeCloseTo(d.bbox.z1, 1);
  });
});
