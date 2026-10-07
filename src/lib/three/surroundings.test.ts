import { describe, expect, it } from "vitest";
import { getHouseContext } from "./context";
import { fromScene } from "./frame";
import { SURROUNDINGS, neighbourMeshes, ridgeRise, rotatedRect, splitPolyline } from "./surroundings";

const ctx = getHouseContext();

const area = (ring: [number, number][]) => ring.reduce((s, p, i) => { const q = ring[(i + 1) % ring.length]; return s + (p[0] * q[1] - q[0] * p[1]) / 2; }, 0);

describe("rotatedRect", () => {
  it("is a counter-clockwise rectangle of the given size about the centre, whatever the angle", () => {
    for (const rot of [0, 2, 37, 90, 181, -15]) {
      const ring = rotatedRect([5, -3], [10, 4], rot);
      expect(area(ring)).toBeCloseTo(40, 9);
      const cx = ring.reduce((s, p) => s + p[0], 0) / 4, cy = ring.reduce((s, p) => s + p[1], 0) / 4;
      expect(cx).toBeCloseTo(5, 9);
      expect(cy).toBeCloseTo(-3, 9);
      expect(Math.hypot(ring[1][0] - ring[0][0], ring[1][1] - ring[0][1])).toBeCloseTo(10, 9);
    }
  });

  it("grows by the same amount on every side", () => {
    expect(area(rotatedRect([0, 0], [10, 4], 30, 0.5))).toBeCloseTo(11 * 5, 9);
  });
});

describe("splitPolyline", () => {
  it("cuts a path into pieces that are no longer than the step and join end to start", () => {
    const path: [number, number][] = [[0, 0], [7, 0], [7, 5]];
    const pieces = splitPolyline(path, 2);
    for (const [a, b] of pieces) expect(Math.hypot(b[0] - a[0], b[1] - a[1])).toBeLessThanOrEqual(2 + 1e-9);
    for (let i = 1; i < pieces.length; i++) expect(pieces[i][0]).toEqual(pieces[i - 1][1]);
    const total = pieces.reduce((s, [a, b]) => s + Math.hypot(b[0] - a[0], b[1] - a[1]), 0);
    expect(total).toBeCloseTo(12, 9);
  });
});

describe("neighbour houses", () => {
  const { walls, roofs } = neighbourMeshes(ctx);
  const heights = (mb: typeof walls) => {
    const p = mb.positions;
    const ys: number[] = [];
    for (let i = 1; i < p.length; i += 3) ys.push(p[i]);
    return ys;
  };
  const houses = ctx.site.model.neighbours;

  it("builds walls and a roof for every neighbour", () => {
    expect(houses.length).toBeGreaterThan(0);
    expect(walls.triangleCount).toBeGreaterThan(houses.length * 8);
    expect(roofs.triangleCount).toBeGreaterThan(houses.length * 4);
  });

  it("has the wall tops at the eave height above the ground of the house and the roof above them", () => {
    for (const nb of houses) {
      const h = nb.house;
      const top = ctx.site.terrain.groundAt(h.center[0], h.center[1]) + h.eaveHeight;
      // wall tops of this house are among the wall vertices at that height
      expect(heights(walls).some((y) => Math.abs(y - top) < 1e-6)).toBe(true);
    }
    const maxRoof = Math.max(...heights(roofs)), maxWall = Math.max(...heights(walls));
    expect(maxRoof).toBeGreaterThan(maxWall - 1e-9);
  });

  it("keeps the eave below the wall top by the overhang times the slope, and the ridge above it by the shorter half-span times the slope", () => {
    for (const nb of houses) {
      const { size, roof, eaveHeight, center } = nb.house;
      const top = ctx.site.terrain.groundAt(center[0], center[1]) + eaveHeight;
      if (roof.kind === "flat") continue;
      const t = Math.tan((roof.pitchDeg * Math.PI) / 180);
      expect(ridgeRise(roof.pitchDeg, size[0] / 2, size[1] / 2)).toBeCloseTo((Math.min(size[0], size[1]) / 2) * t, 9);
      const ys = heights(roofs);
      expect(ys.some((y) => Math.abs(y - (top - roof.overhang * t)) < 1e-6), nb.id).toBe(true);
      expect(ys.some((y) => Math.abs(y - (top + ridgeRise(roof.pitchDeg, size[0] / 2, size[1] / 2))) < 1e-6), nb.id).toBe(true);
    }
  });

  it("stays on its own plot: every vertex of the walls is inside the neighbour's plot", () => {
    const p = walls.positions;
    const plots = ctx.site.zones.neighbours.map((z) => z.plot);
    const inside = (x: number, y: number, ring: [number, number][]) => {
      let c = false;
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) if (ring[i][1] > y !== ring[j][1] > y && x < ((ring[j][0] - ring[i][0]) * (y - ring[i][1])) / (ring[j][1] - ring[i][1]) + ring[i][0]) c = !c;
      return c;
    };
    for (let i = 0; i < p.length; i += 3) {
      const [x, y] = fromScene([p[i], p[i + 1], p[i + 2]]);
      expect(plots.some((ring) => inside(x, y, ring)), `vertex ${i / 3}`).toBe(true);
    }
  });

  it("sinks the walls below the ground at the house", () => {
    expect(Math.min(...heights(walls))).toBeLessThan(ctx.site.terrain.groundAt(houses[0].house.center[0], houses[0].house.center[1]));
    expect(SURROUNDINGS.wallSink).toBeGreaterThan(0);
  });
});
