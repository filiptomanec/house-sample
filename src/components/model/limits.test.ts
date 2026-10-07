import { describe, expect, it } from "vitest";
import { house } from "@/lib/model/instance";
import { getHouseContext, sceneExtent } from "@/lib/three/context";
import { orbitLimitsFor, webViews } from "@/lib/three/views";
import { TOP_VIEW_FOV, VIEW_REACH_MARGIN, limitsForViews, refitLens } from "./limits";

const dist = (v: { position: readonly number[]; target: readonly number[] }) => Math.hypot(v.position[0] - v.target[0], v.position[1] - v.target[1], v.position[2] - v.target[2]);

describe("limitsForViews", () => {
  const base = orbitLimitsFor(sceneExtent(getHouseContext(), "plot"));
  const views = webViews(house.cameras);

  it("every preset view lies within the widened maximum distance", () => {
    const wide = limitsForViews(base, views);
    for (const v of views) expect(dist(v)).toBeLessThan(wide.maxDistance);
  });

  it("never narrows the limits and changes nothing else", () => {
    const wide = limitsForViews(base, views);
    expect(wide.maxDistance).toBeGreaterThanOrEqual(base.maxDistance);
    expect({ ...wide, maxDistance: 0 }).toEqual({ ...base, maxDistance: 0 });
    expect(limitsForViews(base, [])).toEqual(base);
  });

  it("widens exactly as far as the farthest view needs, by the margin", () => {
    const far: { position: [number, number, number]; target: [number, number, number] } = { position: [0, 0, base.maxDistance * 3], target: [0, 0, 0] };
    expect(limitsForViews(base, [far]).maxDistance).toBeCloseTo(base.maxDistance * 3 * VIEW_REACH_MARGIN, 9);
  });
});

describe("refitLens", () => {
  const views = webViews(house.cameras);
  const visibleHeight = (v: { position: readonly number[]; target: readonly number[]; fov: number }) => 2 * dist(v) * Math.tan((v.fov * Math.PI) / 360);

  it("keeps the framing: the height visible at the target and the direction of the view are unchanged", () => {
    for (const v of views) {
      const r = refitLens(v, TOP_VIEW_FOV);
      expect(r.fov).toBe(TOP_VIEW_FOV);
      expect(visibleHeight(r)).toBeCloseTo(visibleHeight(v), 6);
      const a = v.position.map((x, i) => x - v.target[i]), b = r.position.map((x, i) => x - r.target[i]);
      const cos = (a[0] * b[0] + a[1] * b[1] + a[2] * b[2]) / (Math.hypot(...a) * Math.hypot(...b));
      expect(cos).toBeCloseTo(1, 9);
      expect(r.target).toEqual(v.target);
    }
  });

  it("brings the long lens of the top view inside the default orbit limits", () => {
    const base = orbitLimitsFor(sceneExtent(getHouseContext(), "plot"));
    for (const v of views.filter((x) => x.ortho)) {
      expect(dist(v)).toBeGreaterThan(base.maxDistance); // the premise: the engine's 6 degree lens stands too far away
      expect(dist(refitLens(v, TOP_VIEW_FOV))).toBeLessThan(base.maxDistance);
    }
  });

  it("does nothing for a degenerate view", () => {
    const v = { position: [1, 2, 3] as [number, number, number], target: [1, 2, 3] as [number, number, number], fov: 30 };
    expect(refitLens(v, 20)).toBe(v);
  });
});
