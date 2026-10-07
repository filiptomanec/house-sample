import { describe, expect, it } from "vitest";
import { headingTrue, type Vec3 } from "./frame";
import { MIN_POLAR, easeInOut, fromSpherical, orbitOffset, toSpherical, zoomOffset } from "./orbit";

const len = (v: Vec3) => Math.hypot(...v);

describe("spherical coordinates", () => {
  it("round-trip any offset", () => {
    for (const v of [[3, 4, 5], [-1, 2, -7], [0.2, 9, 0.1], [5, 0, 0]] as Vec3[]) {
      const s = toSpherical(v);
      const w = fromSpherical(s.radius, s.phi, s.theta);
      v.forEach((c, i) => expect(w[i]).toBeCloseTo(c, 9));
    }
  });
});

describe("orbitOffset", () => {
  const v: Vec3 = [6, 4, 8];

  it("keeps the distance to the target", () => {
    for (const [dt, dp] of [[0.2, 0], [-1.3, 0.1], [3, -0.2]]) expect(len(orbitOffset(v, dt, dp, 1.5))).toBeCloseTo(len(v), 9);
  });

  it("turns about the vertical without changing the height", () => {
    const w = orbitOffset(v, 0.7, 0, 1.5);
    expect(w[1]).toBeCloseTo(v[1], 9);
    // a full turn comes back
    const full = orbitOffset(v, 2 * Math.PI, 0, 1.5);
    v.forEach((c, i) => expect(full[i]).toBeCloseTo(c, 9));
  });

  it("changes the true heading of the view by the angle turned, and not otherwise", () => {
    const bearing = 12;
    // the camera looks at the target: the view direction is the offset negated, in the scene frame
    const heading = (o: Vec3) => headingTrue([-o[0], -o[1], -o[2]], bearing);
    const before = heading(v);
    const after = heading(orbitOffset(v, 0.1, 0, 1.5));
    // the shortest angular difference between the two headings is the angle turned
    expect(Math.abs(((after - before + 540) % 360) - 180)).toBeCloseTo((0.1 * 180) / Math.PI, 6);
    expect(heading(orbitOffset(v, 0, 0.1, 1.5))).toBeCloseTo(before, 6);
  });

  it("never goes below the ground and never over the pole", () => {
    const max = Math.PI * 0.495;
    expect(toSpherical(orbitOffset(v, 0, 5, max)).phi).toBeCloseTo(max, 9);
    expect(toSpherical(orbitOffset(v, 0, -5, max)).phi).toBeCloseTo(MIN_POLAR, 9);
    expect(orbitOffset(v, 0, 5, max)[1]).toBeGreaterThan(0);
  });
});

describe("zoomOffset", () => {
  const v: Vec3 = [3, 4, 0];

  it("scales the distance by the factor along the same direction", () => {
    const w = zoomOffset(v, 0.9, 1, 100);
    expect(len(w)).toBeCloseTo(4.5, 9);
    expect(w[0] / len(w)).toBeCloseTo(v[0] / len(v), 9);
  });

  it("clamps to the minimum and maximum distance", () => {
    expect(len(zoomOffset(v, 0.01, 2, 50))).toBeCloseTo(2, 9);
    expect(len(zoomOffset(v, 1000, 2, 50))).toBeCloseTo(50, 9);
  });

  it("leaves a camera on its target alone", () => {
    expect(zoomOffset([0, 0, 0], 2, 1, 5)).toEqual([0, 0, 0]);
  });
});

describe("easeInOut", () => {
  it("starts and ends at rest, is monotone and symmetric", () => {
    expect(easeInOut(0)).toBe(0);
    expect(easeInOut(1)).toBe(1);
    expect(easeInOut(0.5)).toBeCloseTo(0.5, 12);
    let prev = 0;
    for (let t = 0.01; t <= 1; t += 0.01) { const e = easeInOut(t); expect(e).toBeGreaterThanOrEqual(prev); prev = e; }
    expect(easeInOut(0.3) + easeInOut(0.7)).toBeCloseTo(1, 12);
    // zero slope at both ends
    expect(easeInOut(0.001)).toBeLessThan(0.00001);
  });
});
