import { describe, expect, it } from "vitest";
import siteRaw from "@model/site.json";
import { exportSiteDerived, exportSiteLayout } from "../export";
import { createSite } from "../index";
import { FIXTURE_BEARING_DEG, FIXTURE_HOUSE } from "./fixture";

const site = createSite(siteRaw, FIXTURE_BEARING_DEG);
const derived = exportSiteDerived(site, FIXTURE_HOUSE.outdoor);
const graded = site.withHouse(FIXTURE_HOUSE.outdoor).terrain;

describe("exportSiteDerived", () => {
  it("is plain JSON: survives a round trip and is deterministic", () => {
    expect(JSON.parse(JSON.stringify(derived))).toEqual(derived);
    expect(exportSiteDerived(createSite(siteRaw, FIXTURE_BEARING_DEG), FIXTURE_HOUSE.outdoor)).toEqual(derived);
  });

  it("terrain grid matches the terrain graded with the house's slabs (rounded to mm) and covers the domain", () => {
    const g = derived.terrain.grid;
    expect(g.z).toHaveLength(g.nx * g.ny);
    for (const [i, j] of [[0, 0], [20, 30], [g.nx - 1, g.ny - 1], [50, 60], [40, 56]]) {
      expect(g.z[j * g.nx + i]).toBeCloseTo(graded.groundAt(g.x0 + i * g.step, g.y0 + j * g.step), 3);
    }
    expect(g.x0 + (g.nx - 1) * g.step).toBeGreaterThanOrEqual(derived.bounds.x1 - g.step);
    expect(JSON.stringify(derived).length).toBeLessThan(250_000);
  });

  it("trees, shrubs, posts and gates carry their ground height, neighbours their base height and ridge", () => {
    for (const t of derived.trees) expect(t.z).toBeCloseTo(graded.groundAt(t.x, t.y), 3);
    for (const t of derived.trees) expect(typeof t.uplight).toBe("boolean");
    for (const f of derived.fences) for (const p of f.posts) expect(p.z).toBeCloseTo(graded.groundAt(p.x, p.y), 3);
    for (const g of derived.gates) expect(g.z).toBeCloseTo(graded.groundAt(g.center[0], g.center[1]), 3);
    for (const n of derived.neighbours) {
      expect(n.ridgeHeight).toBeGreaterThan(n.eaveHeight);
      expect(n.footprint).toHaveLength(4);
    }
    expect(derived.fences).toHaveLength(site.model.fences.length);
    expect(derived.gates).toHaveLength(site.model.gates?.length ?? 0);
    expect(derived.pillars).toHaveLength(site.model.pillars?.length ?? 0);
    expect(derived.paved.some((p) => p.kind === "apron")).toBe(true);
    expect(derived.plot.edgeKinds).toEqual(site.model.plot.edges.map((e) => e.kind));
    expect(derived.access.driveKerb).toHaveLength(4);
    expect(derived.access.walkKerb).toHaveLength(4);
    expect(derived.access.droppedKerbReveal).toBeGreaterThan(0);
    expect(derived.rainwater === null).toBe(!site.model.rainwater);
  });

  it("the layout is the export without the terrain grid", () => {
    const layout = exportSiteLayout(site.model, FIXTURE_HOUSE.outdoor, FIXTURE_BEARING_DEG);
    const { schema, terrain, ...rest } = derived;
    expect(schema).toBe("site-derived/1");
    expect(layout).toEqual({ ...rest, terrain: { zeroLevelAsl: terrain.zeroLevelAsl, plateau: terrain.plateau } });
  });

  it("rounds to the requested precision and honours the grid step", () => {
    const coarse = exportSiteDerived(site, FIXTURE_HOUSE.outdoor, { gridStep: 2, precision: 1 });
    expect(coarse.terrain.grid.step).toBe(2);
    expect(coarse.terrain.grid.nx).toBeLessThan(derived.terrain.grid.nx);
    for (const v of coarse.terrain.grid.z.slice(0, 50)) expect(Math.abs(v * 10 - Math.round(v * 10))).toBeLessThan(1e-9);
  });
});
