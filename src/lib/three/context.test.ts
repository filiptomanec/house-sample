import { describe, expect, it } from "vitest";
import { getHouseContext, sceneExtent } from "./context";
import { pointInPolygon } from "@/lib/model/site";

describe("house context", () => {
  const ctx = getHouseContext();

  it("is shared and consistent with the model", () => {
    expect(getHouseContext()).toBe(ctx);
    expect(ctx.bearingDeg).toBe(ctx.house.location.houseAxisBearingDeg);
    expect(ctx.bearingDeg).toBe(ctx.derived.houseAxisBearingDeg);
    expect(ctx.site.validation.errors ?? []).toEqual([]);
  });

  it("offers a look group for every group the style declares, each with exactly one default", () => {
    for (const g of Object.values(ctx.style.looks)) expect(g.options.filter((o) => o.default)).toHaveLength(1);
  });

  it("resolves the driveway and walkway to the street", () => {
    expect(ctx.layout.access.driveGate.width).toBeGreaterThan(0);
    expect(ctx.layout.access.walkGate.width).toBeGreaterThan(0);
  });

  it("scene extents contain what they promise", () => {
    const plot = sceneExtent(ctx, "plot");
    for (const [x, y] of ctx.site.plot) expect(Math.hypot(x - plot.center[0], y - plot.center[1])).toBeLessThanOrEqual(plot.radius + 1e-9);
    expect(pointInPolygon([plot.center[0], plot.center[1]], ctx.site.plot)).toBe(true);
    const b = ctx.derived.bbox;
    expect(plot.top).toBe(b.z1);
    // every corner of the building lies inside the "house" extent and the house lies inside the plot extent
    const house = sceneExtent(ctx, "house");
    for (const [x, y] of [[b.x0, b.y0], [b.x1, b.y0], [b.x1, b.y1], [b.x0, b.y1]]) {
      expect(Math.hypot(x - house.center[0], y - house.center[1])).toBeLessThanOrEqual(house.radius);
      expect(Math.hypot(x - plot.center[0], y - plot.center[1])).toBeLessThanOrEqual(plot.radius);
    }
  });
});
