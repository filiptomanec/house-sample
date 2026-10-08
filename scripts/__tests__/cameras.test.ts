// Placement rules of the cameras in model/house.json against the plot (model/site.json): a camera stands on the plot or, when it
// is a high view, above the street and the plot; nothing (fence, hedge, wall, tree) stands between it and the house.
// See docs/HOUSE-FORMAT.md section 4.6 ("How cameras are chosen").
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { analyzeHouse } from "../../src/lib/model";
import { createSite, distToBoundary, pointInPolygon, rayChord, type Occluder, type XY } from "../../src/lib/model/site";

const root = path.resolve(__dirname, "..", "..");
const readJson = (rel: string): unknown => JSON.parse(fs.readFileSync(path.join(root, rel), "utf8"));
const { house, derived } = analyzeHouse(readJson("model/house.json"));
const site = createSite(readJson("model/site.json"), house.location.houseAxisBearingDeg);
const occluders: Occluder[] = site.withHouse(house.outdoor).occluders();
const footprint = derived.outline.polygons[0].pts as XY[];

type V3 = [number, number, number];
/** Cameras higher than this above the ground are aerial views (they may stand outside the plot, above the street). */
const HIGH = 8;
/** A ground-level camera is an eye-height view: between these heights above the ground, m. */
const EYE: [number, number] = [1.0, 2.6];
/** A camera keeps at least this far from the plot boundary (hedge and fence stand 0.1 to 0.5 m inside it), m. */
const BOUNDARY_CLEARANCE = 0.8;

const cameras = house.cameras.filter((c) => c.kind === "perspective" && (c.use.includes("web") || c.use.includes("render")));
const isInterior = (p: readonly number[]): boolean => pointInPolygon([p[0], p[1]], footprint) && p[2] < house.clearHeight + 0.5;
const groundAt = (p: readonly number[]): number => site.terrain.groundAt(p[0], p[1]);

/** The occluders met by the segment from `a` to `b` (chord longer than `min` metres). */
function hits(a: V3, b: V3, roles: readonly string[] | null, min = 0.05): Occluder[] {
  const d: V3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const len = Math.hypot(...d);
  const u: V3 = [d[0] / len, d[1] / len, d[2] / len];
  return occluders.filter((o) => {
    if (roles && !roles.includes(o.role)) return false;
    const c = rayChord(o, a, u);
    return !!c && Math.min(c.tOut, len) - c.tIn > min;
  });
}

describe("cameras of model/house.json", () => {
  it("has the cameras the web and the renders need", () => {
    expect(cameras.length).toBeGreaterThanOrEqual(6);
  });

  it("stands on the plot (at eye height) or is a high view (aerial)", () => {
    for (const c of cameras) {
      const p = c.position as V3;
      if (isInterior(p)) continue;
      const h = p[2] - groundAt(p);
      if (h >= HIGH) continue; // aerial: may stand anywhere above the plot and the street
      expect(pointInPolygon([p[0], p[1]], site.plot), `${c.id} is outside the plot`).toBe(true);
      expect(distToBoundary([p[0], p[1]], site.plot), `${c.id} is too close to the boundary`).toBeGreaterThanOrEqual(BOUNDARY_CLEARANCE);
      expect(h, `${c.id} eye height`).toBeGreaterThanOrEqual(EYE[0]);
      expect(h, `${c.id} eye height`).toBeLessThanOrEqual(EYE[1]);
    }
  });

  it("is not inside a tree, shrub, hedge, fence or neighbouring building", () => {
    for (const c of cameras) {
      const p = c.position as V3;
      const t = c.target as V3;
      if (isInterior(p)) continue;
      expect(hits(p, [p[0] + (t[0] - p[0]) * 1e-3, p[1] + (t[1] - p[1]) * 1e-3, p[2] + (t[2] - p[2]) * 1e-3], null, 0).map((o) => o.id), c.id).toEqual([]);
    }
  });

  it("sees the house without a hedge, fence or wall in between, and the target without a tree in the way", () => {
    const centre: V3 = [(derived.bbox.x0 + derived.bbox.x1) / 2, (derived.bbox.y0 + derived.bbox.y1) / 2, 1.5];
    for (const c of cameras) {
      const p = c.position as V3;
      if (isInterior(p)) continue;
      const t = c.target as V3;
      expect(hits(p, centre, ["hedge", "fence", "neighbour_wall", "neighbour_roof"]).map((o) => o.id), `${c.id} -> centre`).toEqual([]);
      expect(hits(p, t, null).map((o) => o.id), `${c.id} -> target`).toEqual([]);
    }
  });

  it("looks at the house from the plot or from above, not through the street fence", () => {
    // the street fence is the only boundary element a camera outside the plot could stand behind
    const outside = cameras.filter((c) => !isInterior(c.position) && !pointInPolygon([c.position[0], c.position[1]], site.plot));
    for (const c of outside) expect(c.position[2] - groundAt(c.position), `${c.id} stands outside the plot below ${HIGH} m`).toBeGreaterThanOrEqual(HIGH);
  });
});
