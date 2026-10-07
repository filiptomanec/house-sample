import { describe, expect, it } from "vitest";
import siteRaw from "@model/site.json";
import { exportSiteDerived } from "../export";
import { createSite } from "../index";
import { FIXTURE_BEARING_DEG, FIXTURE_HOUSE } from "./fixture";

const site = createSite(siteRaw, FIXTURE_BEARING_DEG);
const derived = exportSiteDerived(site, FIXTURE_HOUSE.outdoor);

describe("exportSiteDerived", () => {
  it("is plain JSON: survives a round trip and is deterministic", () => {
    expect(JSON.parse(JSON.stringify(derived))).toEqual(derived);
    expect(exportSiteDerived(createSite(siteRaw, FIXTURE_BEARING_DEG), FIXTURE_HOUSE.outdoor)).toEqual(derived);
  });

  it("terrain grid matches groundAt (rounded to mm) and covers the domain", () => {
    const g = derived.terrain.grid;
    expect(g.z).toHaveLength(g.nx * g.ny);
    for (const [i, j] of [[0, 0], [20, 30], [g.nx - 1, g.ny - 1], [50, 60]]) {
      expect(g.z[j * g.nx + i]).toBeCloseTo(site.terrain.groundAt(g.x0 + i * g.step, g.y0 + j * g.step), 3);
    }
    expect(g.x0 + (g.nx - 1) * g.step).toBeGreaterThanOrEqual(derived.bounds.x1 - g.step);
    expect(JSON.stringify(derived).length).toBeLessThan(250_000);
  });

  it("trees and shrubs carry their ground height, neighbours their base height and ridge", () => {
    for (const t of derived.trees) expect(t.z).toBeCloseTo(site.terrain.groundAt(t.x, t.y), 3);
    expect(derived.trees.some((t) => t.evergreen)).toBe(true);
    for (const n of derived.neighbours) {
      expect(n.ridgeHeight).toBeGreaterThan(n.eaveHeight);
      expect(n.footprint).toHaveLength(4);
    }
    expect(derived.fences.find((f) => f.kind === "plinth_fence")?.parts).toHaveLength(3);
    expect(derived.paved.some((p) => p.kind === "apron")).toBe(true);
    expect(derived.plot.edgeKinds).toEqual(["field", "neighbour", "street", "neighbour"]);
  });

  it("rounds to the requested precision and honours the grid step", () => {
    const coarse = exportSiteDerived(site, FIXTURE_HOUSE.outdoor, { gridStep: 2, precision: 1 });
    expect(coarse.terrain.grid.step).toBe(2);
    expect(coarse.terrain.grid.nx).toBeLessThan(derived.terrain.grid.nx);
    for (const v of coarse.terrain.grid.z.slice(0, 50)) expect(Math.abs(v * 10 - Math.round(v * 10))).toBeLessThan(1e-9);
  });
});
