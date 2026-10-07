import { describe, expect, it } from "vitest";
import { house, derived } from "@/lib/model/instance";
import { ORTHO_APPROX_FOV, SHADOW_MARGIN, camerasFor, distanceForVisibleHeight, orbitLimitsFor, resolveView, shadowRangeFor, webViews } from "./views";

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
