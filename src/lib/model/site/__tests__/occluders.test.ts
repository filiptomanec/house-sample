import { describe, expect, it } from "vitest";
import {
  boxOf, leafFactor, orientedRect, prismOf, rayChord, rayIntersect, rayTransmittance, ridgeRise, roofSolid, transmittanceThrough,
  type Occluder, type Vec3,
} from "../occluders";
import { polygonArea } from "../geometry";

const down: Vec3 = [0, 0, -1];

describe("box", () => {
  const box = boxOf([0, 0, 0], [4, 2, 3], { id: "b", role: "neighbour_wall" });

  it("hits from outside, reports the entry distance and the chord", () => {
    expect(rayIntersect(box, [-5, 1, 1], [1, 0, 0])).toBeCloseTo(5, 12);
    const c = rayChord(box, [-5, 1, 1], [1, 0, 0]);
    expect(c && c.tOut - c.tIn).toBeCloseTo(4, 12);
  });

  it("misses when pointing away, passing beside or being parallel outside", () => {
    expect(rayIntersect(box, [-5, 1, 1], [-1, 0, 0])).toBeNull();
    expect(rayIntersect(box, [-5, 5, 1], [1, 0, 0])).toBeNull();
    expect(rayIntersect(box, [2, 5, 1], [1, 0, 0])).toBeNull();
  });

  it("from inside the entry distance is zero", () => {
    expect(rayIntersect(box, [1, 1, 1], [0, 1, 0])).toBe(0);
  });
});

describe("spheres and ellipsoids", () => {
  it("chord through the centre equals the diameter", () => {
    const s: Occluder = { id: "s", role: "tree", kind: "sphere", center: [0, 0, 5], radius: 3 };
    const c = rayChord(s, [-10, 0, 5], [1, 0, 0]);
    expect(c && c.tOut - c.tIn).toBeCloseTo(6, 12);
    expect(rayChord(s, [-10, 3.01, 5], [1, 0, 0])).toBeNull();
    expect(rayChord(s, [-10, 2.99, 5], [1, 0, 0])).not.toBeNull();
  });

  it("an ellipsoid is stretched along its axes", () => {
    const e: Occluder = { id: "e", role: "tree", kind: "ellipsoid", center: [0, 0, 6], radii: [2, 2, 5] };
    const up = rayChord(e, [0, 0, -3], [0, 0, 1]);
    expect(up && up.tOut - up.tIn).toBeCloseTo(10, 12);
    const side = rayChord(e, [-9, 0, 6], [1, 0, 0]);
    expect(side && side.tOut - side.tIn).toBeCloseTo(4, 12);
  });
});

describe("prisms and roofs", () => {
  it("a rotated prism has the footprint area it was built from and the right chord", () => {
    const rect = orientedRect([10, 20], 6, 4, 30);
    expect(polygonArea(rect)).toBeCloseTo(24, 12);
    const p = prismOf(rect, 1, 4, { id: "p", role: "hedge" });
    const c = rayChord(p, [10, 20, 10], down);
    expect(c && c.tOut - c.tIn).toBeCloseTo(3, 12);
    expect(rayChord(p, [10 + 2.5, 20, 10], down)).not.toBeNull(); // inside after the 30 degree rotation
    expect(rayChord(p, [10 + 9, 20, 10], down)).toBeNull();
  });

  it("hip roof: ridge height, hip slope and the bottom plane", () => {
    const eave = 3, pitch = 30;
    const roof = roofSolid([0, 0], 12, 8, 0, eave, pitch, "hip", { id: "r", role: "neighbour_roof" });
    const topAt = (x: number, y: number) => {
      const c = rayChord(roof, [x, y, 30], down);
      return c ? 30 - c.tIn : null;
    };
    expect(topAt(0, 0)).toBeCloseTo(eave + 4 * Math.tan((pitch * Math.PI) / 180), 9); // ridge
    expect(topAt(1.5, 0)).toBeCloseTo(eave + ridgeRise(12, 8, pitch, "hip"), 9);
    expect(topAt(5, 0)).toBeCloseTo(eave + 1 * Math.tan((pitch * Math.PI) / 180), 9); // 1 m from the hip end
    expect(topAt(0, 3)).toBeCloseTo(eave + 1 * Math.tan((pitch * Math.PI) / 180), 9); // 1 m from the long eave
    expect(topAt(6.5, 0)).toBeNull();
    const c = rayChord(roof, [0, 0, 30], down) as { tIn: number; tOut: number };
    expect(30 - c.tOut).toBeCloseTo(eave, 9);
  });

  it("gable roof keeps its end walls vertical, flat roof is a slab", () => {
    const gable = roofSolid([0, 0], 12, 8, 0, 3, 30, "gable", { id: "g", role: "neighbour_roof" });
    const top = (x: number) => 30 - (rayChord(gable, [x, 0, 30], down) as { tIn: number }).tIn;
    expect(top(5.9)).toBeCloseTo(top(0), 9); // full ridge height right up to the gable wall
    expect(rayChord(gable, [6.1, 0, 30], down)).toBeNull();
    const flat = roofSolid([0, 0], 12, 8, 0, 3, 0, "flat", { id: "f", role: "neighbour_roof" });
    expect(30 - (rayChord(flat, [1, 1, 30], down) as { tIn: number }).tIn).toBeCloseTo(3.2, 9);
  });

  it("rotation turns the roof with the house", () => {
    const roof = roofSolid([0, 0], 12, 8, 90, 3, 30, "hip", { id: "r", role: "neighbour_roof" });
    expect(rayChord(roof, [0, 5.9, 30], down)).not.toBeNull(); // long side now runs along y
    expect(rayChord(roof, [5.9, 0, 30], down)).toBeNull();
  });
});

describe("transmittance", () => {
  const crown: Occluder = {
    id: "t", role: "tree", kind: "sphere", center: [0, 0, 5], radius: 3,
    extinction: { leafOn: 1.0, leafOff: 0.1 }, evergreen: false,
  };
  const wall = boxOf([-1, -1, 0], [1, 1, 3], { id: "w", role: "neighbour_wall" });
  const through: Vec3 = [1, 0, 0];

  it("leaf factor follows the seasons", () => {
    expect(leafFactor(1)).toBe(0);
    expect(leafFactor(355)).toBe(0);
    expect(leafFactor(200)).toBe(1);
    expect(leafFactor(120)).toBeGreaterThan(0);
    expect(leafFactor(120)).toBeLessThan(1);
    expect(leafFactor(1, true)).toBe(1);
    for (let d = 1; d < 366; d++) {
      const f = leafFactor(d);
      expect(f).toBeGreaterThanOrEqual(0);
      expect(f).toBeLessThanOrEqual(1);
    }
  });

  it("a crown passes exp(-k * chord) of the light, more in winter than in summer", () => {
    const summer = transmittanceThrough(crown, [-10, 0, 5], through, 200);
    const winter = transmittanceThrough(crown, [-10, 0, 5], through, 1);
    expect(summer).toBeCloseTo(Math.exp(-1.0 * 6), 12);
    expect(winter).toBeCloseTo(Math.exp(-0.1 * 6), 12);
    expect(winter).toBeGreaterThan(summer);
    expect(transmittanceThrough(crown, [-10, 8, 5], through, 200)).toBe(1);
    expect(transmittanceThrough(crown, [10, 0, 5], through, 200)).toBe(1); // behind the origin
  });

  it("a solid wall blocks completely, rays are multiplied across occluders", () => {
    expect(transmittanceThrough(wall, [-5, 0, 1], through)).toBe(0);
    expect(rayTransmittance([crown, wall], [-5, 0, 1], through, 200)).toBe(0);
    expect(rayTransmittance([crown, wall], [-5, 5, 1], through, 200)).toBe(1);
    const two: Occluder[] = [crown, { ...crown, id: "t2", center: [0, 0, 5] }];
    expect(rayTransmittance(two, [-10, 0, 5], through, 1)).toBeCloseTo(Math.exp(-0.1 * 6) ** 2, 12);
  });

  it("evergreens keep their winter density", () => {
    const pine: Occluder = { ...crown, evergreen: true, extinction: { leafOn: 0.7, leafOff: 0.7 } };
    expect(transmittanceThrough(pine, [-10, 0, 5], through, 1)).toBeCloseTo(Math.exp(-0.7 * 6), 12);
  });
});
