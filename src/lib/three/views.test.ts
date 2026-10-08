import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { house, derived } from "@/lib/model/instance";
import { pointInPolygon } from "@/lib/model/site";
import { getHouseContext } from "./context";
import {
  DESIGN_ASPECT, FIT_ASPECTS, FOV_MAX, ORTHO_APPROX_FOV, SHADOW_MARGIN, SHADOW_OCCLUDER_MARGIN, TOP_VIEW_FOV, camerasFor, defaultView, distanceForVisibleHeight,
  fitContextOf, fitView, isElevated, orbitLimitsFor, pageExtent, pageLimits, pageViews, refitLens, resolveView, shadowRangeFor, webViews, type ResolvedView,
} from "./views";

describe("camera views", () => {
  it("resolves every web camera of the model into the scene frame", () => {
    const views = webViews(house.cameras);
    expect(views.length).toBe(camerasFor(house.cameras, "web").length);
    expect(views.length).toBeGreaterThan(0);
    for (const cam of camerasFor(house.cameras, "web")) {
      const v = views.find((x) => x.id === cam.id)!;
      // house (x, y, z) -> scene (x, z, -y)
      expect(v.target).toEqual([cam.target[0], cam.target[2], -cam.target[1]]);
      expect(v.fov).toBeGreaterThan(0);
    }
  });

  it("keeps perspective cameras unchanged apart from the frame", () => {
    const cam = house.cameras.find((c) => c.kind === "perspective")!;
    const v = resolveView(cam);
    expect(v.ortho).toBe(false);
    expect(v.position).toEqual([cam.position[0], cam.position[2], -cam.position[1]]);
    expect(v.fov).toBe(cam.fov);
  });

  it("replaces an orthographic camera by a long lens that sees the same height at the target", () => {
    const ortho = house.cameras.find((c) => c.kind === "orthographic");
    expect(ortho).toBeTruthy();
    const v = resolveView(ortho!);
    expect(v.ortho).toBe(true);
    expect(v.fov).toBe(ORTHO_APPROX_FOV);
    const d = Math.hypot(v.position[0] - v.target[0], v.position[1] - v.target[1], v.position[2] - v.target[2]);
    // oracle: visible height = 2 d tan(fov / 2)
    expect(2 * d * Math.tan((v.fov * Math.PI) / 360)).toBeCloseTo(ortho!.orthoHeight!, 9);
    expect(distanceForVisibleHeight(ortho!.orthoHeight!, v.fov)).toBeCloseTo(d, 9);
    // same viewing direction as the model's camera
    const m = [ortho!.position[0] - ortho!.target[0], ortho!.position[2] - ortho!.target[2], -(ortho!.position[1] - ortho!.target[1])];
    const ml = Math.hypot(...m);
    expect((v.position[0] - v.target[0]) / d).toBeCloseTo(m[0] / ml, 9);
    expect((v.position[1] - v.target[1]) / d).toBeCloseTo(m[1] / ml, 9);
    expect((v.position[2] - v.target[2]) / d).toBeCloseTo(m[2] / ml, 9);
  });

  it("derives orbit limits from the extent", () => {
    const b = derived.bbox;
    const extent = { center: [(b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2, 0] as [number, number, number], radius: 40, top: b.z1 };
    const l = orbitLimitsFor(extent);
    expect(l.maxDistance).toBeGreaterThan(extent.radius);
    expect(l.targetMin[1]).toBe(0);
    expect(l.targetMax[1]).toBe(b.z1);
    expect(l.targetMin[0]).toBeLessThan(l.targetMax[0]);
    expect(l.targetMin[2]).toBeLessThan(l.targetMax[2]);
    expect(l.maxPolarAngle).toBeLessThan(Math.PI / 2);
  });

  it("covers the extent with the shadow frustum", () => {
    expect(shadowRangeFor({ center: [0, 0, 0], radius: 30, top: 6 })).toBeCloseTo(30 * SHADOW_MARGIN, 12);
    expect(SHADOW_MARGIN).toBeGreaterThan(1);
  });
});

const ctx = getHouseContext();
const fc = fitContextOf(ctx);
const dist = (v: Pick<ResolvedView, "position" | "target">) => Math.hypot(v.position[0] - v.target[0], v.position[1] - v.target[1], v.position[2] - v.target[2]);
/** Largest |NDC| of the corners of the house bounding box seen by a view at an aspect (<= 1: all inside the frustum). */
function bboxReach(v: Pick<ResolvedView, "position" | "target" | "fov">, aspect: number): number {
  const b = ctx.derived.bbox;
  const cam = new THREE.PerspectiveCamera(v.fov, aspect, 0.1, 3000);
  cam.position.set(...v.position);
  cam.lookAt(...v.target);
  cam.updateMatrixWorld();
  let worst = 0;
  for (const x of [b.x0, b.x1]) for (const y of [b.y0, b.y1]) for (const z of [b.z0, b.z1]) {
    const p = new THREE.Vector3(x, z, -y).project(cam);
    worst = Math.max(worst, Math.abs(p.x), Math.abs(p.y), p.z > 1 || p.z < -1 ? 9 : 0);
  }
  return worst;
}

describe("the presets of the two pages", () => {
  it("come from derived.cameras by use, the top view refitted to TOP_VIEW_FOV, z resolved above the ground", () => {
    for (const page of ["model", "sun"] as const) {
      const views = pageViews(ctx, page);
      const cams = camerasFor(ctx.derived.cameras, page === "sun" ? "sun" : "web");
      expect(views.map((v) => v.id)).toEqual(cams.map((c) => c.id));
      for (const v of views) {
        const c = cams.find((x) => x.id === v.id)!;
        expect(v.position[1]).toBeCloseTo(v.ortho ? v.position[1] : c.position[2], 9);
        if (v.ortho) expect(v.fov).toBe(TOP_VIEW_FOV);
      }
    }
  });

  it("open on the default camera, and on narrow stages on the one marked for them", () => {
    const views = pageViews(ctx, "model");
    expect(defaultView(views)?.default).toBe(true);
    const narrow = defaultView(views, true)!;
    expect(narrow.defaultFor?.includes("narrow") || narrow.default).toBe(true);
    expect(defaultView([])).toBeUndefined();
  });

  it("are all reachable within the page's orbit limits, fitted at every supported aspect", () => {
    for (const page of ["model", "sun"] as const) {
      const limits = pageLimits(ctx, page);
      for (const v of pageViews(ctx, page)) for (const a of [DESIGN_ASPECT, ...FIT_ASPECTS]) {
        expect(dist(fitView(v, a, fc)), `${page} ${v.id} ${a}`).toBeLessThanOrEqual(limits.maxDistance + 1e-9);
      }
    }
  });
});

describe("refitLens", () => {
  it("keeps the visible height at the target and the direction", () => {
    const v = resolveView(ctx.derived.cameras.find((c) => c.kind === "orthographic")!);
    const r = refitLens(v, 25);
    expect(2 * dist(r) * Math.tan((25 * Math.PI) / 360)).toBeCloseTo(2 * dist(v) * Math.tan((v.fov * Math.PI) / 360), 9);
    expect(r.target).toEqual(v.target);
  });
});

describe("fitView (aspect-aware fitting)", () => {
  const views = [...pageViews(ctx, "model"), ...pageViews(ctx, "sun")];

  it("leaves a view alone on a stage at least as wide as the design", () => {
    for (const v of views) for (const a of [DESIGN_ASPECT, 2.2]) {
      const f = fitView(v, a, fc);
      expect(f.position).toEqual(v.position);
      expect(f.fov).toBe(v.fov);
      expect(f.dolly).toBe(1);
    }
  });

  it("keeps the design's horizontal coverage on narrower stages: wider lens first (up to FOV_MAX), then back, as far as it may", () => {
    for (const v of views) for (const a of FIT_ASPECTS) {
      const f = fitView(v, a, fc);
      expect(f.fov).toBeLessThanOrEqual(Math.max(FOV_MAX, v.fov) + 1e-9);
      expect(f.fov).toBeGreaterThanOrEqual(v.fov - 1e-9);
      expect(f.target).toEqual(v.target);
      // coverage = distance x horizontal half-tangent, against the design
      const want = Math.tan((v.fov * Math.PI) / 360) * DESIGN_ASPECT * dist(v);
      const got = Math.tan((f.fov * Math.PI) / 360) * a * dist(f);
      if (f.fov < FOV_MAX - 1e-9 || v.ortho) expect(got, `${v.id} ${a}`).toBeCloseTo(want, 6);
      else expect(got).toBeLessThanOrEqual(want + 1e-6);
      if (got < want - 1e-6) expect(f.dolly).toBeGreaterThanOrEqual(1);
    }
  });

  it("moves an eye-level camera back only on its own side of the plot boundary and never into the building; never moves one without the plot", () => {
    for (const v of views) for (const a of FIT_ASPECTS) {
      const f = fitView(v, a, fc);
      if (!isElevated(v, fc)) {
        const p0: [number, number] = [v.position[0], -v.position[2]], p1: [number, number] = [f.position[0], -f.position[2]];
        expect(pointInPolygon(p1, fc.plot), v.id).toBe(pointInPolygon(p0, fc.plot));
        expect(pointInPolygon(p1, fc.footprint) && !pointInPolygon(p0, fc.footprint)).toBe(false);
      }
      const bare = fitView(v, a);
      expect(bare.dolly).toBe(1);
    }
  });

  it("keeps the whole house in the frame at aspects 0.75, 1 and 1.45 for every view that shows it at the design aspect (or the lens is at FOV_MAX and the way back is blocked)", () => {
    let checked = 0;
    for (const v of views) {
      if (bboxReach(v, DESIGN_ASPECT) > 1) continue;
      checked++;
      for (const a of FIT_ASPECTS) {
        const f = fitView(v, a, fc);
        const reach = bboxReach(f, a);
        const limited = f.fov >= FOV_MAX - 1e-9 && Math.tan((f.fov * Math.PI) / 360) * a * dist(f) < Math.tan((v.fov * Math.PI) / 360) * DESIGN_ASPECT * dist(v) - 1e-6;
        expect(reach <= 1 + 1e-6 || limited, `${v.id} at ${a}: ${reach.toFixed(3)}`).toBe(true);
      }
    }
    expect(checked).toBeGreaterThanOrEqual(2); // at least the whole-plot view and the top view
  });
});

describe("shadow range", () => {
  it("reaches every site occluder the sun analysis counts, plus the margin, and never less than the extent", () => {
    for (const page of ["model", "sun"] as const) {
      const ext = pageExtent(ctx, page);
      const r = shadowRangeFor(ext, ctx);
      expect(r).toBeGreaterThanOrEqual(ext.radius * SHADOW_MARGIN - 1e-9);
      const c = ext.center;
      for (const t of ctx.site.model.trees) expect(Math.hypot(t.pos[0] - c[0], t.pos[1] - c[1]) + t.crown / 2 + SHADOW_OCCLUDER_MARGIN, t.id).toBeLessThanOrEqual(r + 1e-6);
      for (const n of ctx.site.model.neighbours) expect(Math.hypot(n.house.center[0] - c[0], n.house.center[1] - c[1]), n.id).toBeLessThan(r);
    }
  });
});
