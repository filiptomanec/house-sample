// site.json against invariants that hold for any valid plot of the project (no counts or coordinates of the content).
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import siteRaw from "@model/site.json";
import {
  azimuthOf, distToBoundary, edgeOutwardNormal, expandRect, intersectionArea, pointAtLength, pointInPolygon, polygonArea, polylineLength,
  projectToPolyline, rectToPolygon, segDist, signedArea, type XY,
} from "../geometry";
import { createSite } from "../index";
import { accessGeometry, cutGap, gateOf, neighbourPlot, pathAlongPlot, plotPolygon, resolveFences, resolveHedges, streetGeometry, yOnLine, offsetEdgeLine } from "../layout";
import { orientedRect, rayTransmittance, type Vec3 } from "../occluders";
import { buildOccluders } from "../shading";
import { parseSite, siteSchema } from "../siteSchema";
import { createTerrain } from "../terrain";
import { isSimplePolygon, validateSite } from "../validate";
import { FIXTURE_BEARING_DEG, FIXTURE_HOUSE } from "./fixture";

const site = parseSite(siteRaw);
const plot = plotPolygon(site);
const terrain = createTerrain(site.terrain, FIXTURE_BEARING_DEG);
const access = accessGeometry(site, FIXTURE_HOUSE.outdoor);

describe("site.json format", () => {
  it("passes the schema and the semantic validation without errors or warnings", () => {
    expect(validateSite(site)).toEqual({ errors: [], warnings: [] });
  });

  it("states that the plot is fictional and only points at house.json for the location", () => {
    expect(site.fictional).toBe(true);
    expect(site.location).toEqual({ source: "house.json#/location" });
    const text = JSON.stringify(siteRaw);
    for (const key of ['"lat"', '"lon"', '"houseAxisBearingDeg"', '"elevation"', '"region"']) expect(text).not.toContain(key);
  });

  it("the schema is strict: unknown keys and wrong references are rejected", () => {
    expect(() => parseSite({ ...siteRaw, surprise: 1 })).toThrow();
    expect(siteSchema.safeParse({ ...siteRaw, fictional: false }).success).toBe(false);
    const bad = JSON.parse(JSON.stringify(siteRaw));
    bad.trees[0].species = "no-such-species";
    expect(validateSite(parseSite(bad)).errors.map((e) => e.code)).toContain("E-SPECIES");
    const bad2 = JSON.parse(JSON.stringify(siteRaw));
    bad2.plot.edges.pop();
    expect(validateSite(parseSite(bad2)).errors.map((e) => e.code)).toContain("E-EDGES");
  });

  it("holds only parameters: the terrain is a handful of numbers, not a height table", () => {
    expect(JSON.stringify(siteRaw.terrain).length).toBeLessThan(1500);
    expect(siteRaw.terrain.waves.length).toBeGreaterThanOrEqual(2);
    expect(siteRaw.terrain.waves.length).toBeLessThanOrEqual(3);
    expect(JSON.stringify(siteRaw).length).toBeLessThan(20000);
  });
});

describe("plot shape and placement", () => {
  it("is a simple counter-clockwise quadrilateral of about 1,100 to 1,300 m2", () => {
    expect(site.plot.polygon).toHaveLength(4);
    expect(signedArea(site.plot.polygon as XY[])).toBeGreaterThan(0);
    expect(isSimplePolygon(plot)).toBe(true);
    expect(polygonArea(plot)).toBeGreaterThan(1100);
    expect(polygonArea(plot)).toBeLessThan(1300);
  });

  it("the street is on the north side, the field to the south, neighbours east and west", () => {
    const kinds = site.plot.edges.map((e) => e.kind);
    expect(kinds.filter((k) => k === "street")).toHaveLength(1);
    expect(kinds.filter((k) => k === "field")).toHaveLength(1);
    expect(kinds.filter((k) => k === "neighbour")).toHaveLength(2);
    const az = (i: number) => azimuthOf(edgeOutwardNormal(plot, i));
    const near = (a: number, b: number) => Math.min(Math.abs(a - b), 360 - Math.abs(a - b));
    expect(near(az(site.street.edge), 0)).toBeLessThan(10); // house +y: street and drive to the north
    expect(near(az(site.field.edge), 180)).toBeLessThan(10);
    for (const nb of site.neighbours) expect([90, 270].some((a) => near(az(nb.edge), a) < 10)).toBe(true);
  });

  it("is slightly rotated against the compass but follows the street rather than true north", () => {
    const trueAz = (azimuthOf(edgeOutwardNormal(plot, site.street.edge)) + FIXTURE_BEARING_DEG + 360) % 360;
    expect(trueAz).toBeGreaterThan(5);
    expect(trueAz).toBeLessThan(25);
  });

  it("contains the house, its roofs and all outdoor areas of the house model", () => {
    for (const p of FIXTURE_HOUSE.footprint) expect(pointInPolygon(p, plot)).toBe(true);
    for (const o of FIXTURE_HOUSE.outdoor) for (const p of rectToPolygon(o.rect as [number, number, number, number])) expect(pointInPolygon(p, plot)).toBe(true);
    for (const r of FIXTURE_HOUSE.roofs ?? []) for (const p of rectToPolygon(expandRect(r.rect, r.overhang ?? 0))) expect(distToBoundary(p, plot)).toBeGreaterThanOrEqual(site.setbackRules.minRoofEdgeToBoundary);
  });

  it("matches the house model's outdoor areas when model/house.json exists", () => {
    const file = path.resolve(__dirname, "../../../../../model/house.json");
    if (!existsSync(file)) return;
    type R4 = [number, number, number, number];
    const isRect = (r: unknown): r is R4 => Array.isArray(r) && r.length === 4 && r.every((v) => typeof v === "number");
    const house = JSON.parse(readFileSync(file, "utf8")) as { outdoor?: { type: string; covered?: boolean; rect?: unknown }[]; roofs?: { rect?: unknown; overhang?: number }[] };
    const outdoor = (house.outdoor ?? []).filter((o) => isRect(o.rect)).map((o) => ({ type: o.type, covered: o.covered, rect: o.rect as R4 }));
    for (const o of outdoor) for (const p of rectToPolygon(o.rect)) expect(pointInPolygon(p, plot), `outdoor ${o.type} corner`).toBe(true);
    for (const r of house.roofs ?? []) {
      if (!isRect(r.rect)) continue;
      for (const p of rectToPolygon(expandRect(r.rect, r.overhang ?? 0))) expect(distToBoundary(p, plot)).toBeGreaterThanOrEqual(site.setbackRules.minRoofEdgeToBoundary);
    }
    const a = accessGeometry(site, outdoor);
    expect(a.driveApron.length === 0 || a.driveApron.length === 4).toBe(true);
  });
});

describe("driveway, walkway and street", () => {
  it("the apron continues the house-model drive to the plot boundary at the same width", () => {
    const [x0, , x1, y1] = access.driveRect;
    expect(access.driveApron).toHaveLength(4);
    expect(access.driveApron[0]).toEqual([x0, y1]);
    expect(access.driveApron[1]).toEqual([x1, y1]);
    expect(distToBoundary(access.driveApron[2], plot)).toBeLessThan(1e-9);
    expect(distToBoundary(access.driveApron[3], plot)).toBeLessThan(1e-9);
    expect(polygonArea(access.driveApron)).toBeGreaterThan(0);
    for (const p of access.driveApron) expect(distToBoundary(p, plot) < 1e-9 || pointInPolygon(p, plot)).toBe(true);
  });

  it("the openings are centred on the strips: leaf + 2 posts with a gate, else the strip plus the margins", () => {
    expect(access.walkApron).toHaveLength(4);
    const dc = (access.driveRect[0] + access.driveRect[2]) / 2;
    expect(access.driveGate.center[0]).toBeCloseTo(dc, 12);
    expect(distToBoundary(access.driveGate.center, plot)).toBeLessThan(1e-9);
    for (const [kind, g, rect, spec] of [
      ["driveway", access.driveGate, access.driveRect, site.access.driveway],
      ["walkway", access.walkGate, access.walkRect, site.access.walkway],
    ] as const) {
      const gate = gateOf(site, kind);
      if (gate) {
        expect(g.width).toBeCloseTo(gate.leaf + 2 * gate.postSize, 12);
        expect(g.opening).toBe(gate.leaf);
      } else {
        expect(g.opening).toBeCloseTo(spec.gateWidth ?? rect[2] - rect[0] + 2 * spec.gateMargin, 12);
        expect(g.width).toBe(g.opening);
      }
    }
  });

  it("the public verge piece crosses the verge up to the carriageway edge", () => {
    const line = offsetEdgeLine(plot, site.street.edge, site.street.verge);
    const far = access.driveVerge.slice(2);
    for (const p of far) expect(p[1]).toBeCloseTo(yOnLine(line, p[0]), 9);
  });

  it("street geometry lies outside the plot, with the stated widths", () => {
    const st = streetGeometry(site);
    expect(intersectionArea(st.verge, plot)).toBeLessThan(1e-9);
    expect(intersectionArea(st.carriageway, plot)).toBeLessThan(1e-9);
    const w = polygonArea(st.carriageway) / polylineLength([st.carriageway[0], st.carriageway[1]]);
    expect(w).toBeCloseTo(site.street.carriageway, 6);
  });

  it("fences with gates have openings exactly where the accesses cross them, and nothing else is cut", () => {
    for (const f of resolveFences(site, access)) {
      const src = site.fences.find((x) => x.id === f.id)!;
      const total = polylineLength(f.path);
      const kept = f.parts.reduce((s, p) => s + polylineLength(p), 0);
      const cut = f.gaps.reduce((s, g) => s + (Math.min(total, g.to) - Math.max(0, g.from)), 0);
      expect(kept + cut).toBeCloseTo(total, 6);
      if (!src.gates) expect(f.gaps).toEqual([]);
      for (const g of f.gaps) {
        const centre = (g.access === "driveway" ? access.driveGate : access.walkGate).center;
        expect(projectToPolyline(centre, f.path).d).toBeLessThan(0.5 + src.inset);
      }
    }
  });

  it("cutGap removes exactly the requested stretch", () => {
    const parts = cutGap([[0, 0], [10, 0]], [4, 1], 2);
    expect(parts).toHaveLength(2);
    expect(parts[0][parts[0].length - 1][0]).toBeCloseTo(3, 12);
    expect(parts[1][0][0]).toBeCloseTo(5, 12);
  });

  it("a fence from the start of the first edge to the end of the last runs once around the plot", () => {
    const ring = pathAlongPlot(plot, 0.1, { edge: 0, t: 0 }, { edge: plot.length - 1, t: 1 });
    expect(ring).toHaveLength(plot.length + 1);
    expect(Math.hypot(ring[0][0] - ring[plot.length][0], ring[0][1] - ring[plot.length][1])).toBeLessThan(1e-9);
  });
});

describe("vegetation", () => {
  const dToHouse = (p: XY) => distToBoundary(p, FIXTURE_HOUSE.footprint);

  it("trees stand inside the plot with their crowns, none too near the house, trunks apart", () => {
    for (const t of site.trees) {
      expect(pointInPolygon(t.pos, plot), t.id).toBe(true);
      expect(distToBoundary(t.pos, plot), t.id).toBeGreaterThanOrEqual(t.crown / 2 - 0.5);
      expect(dToHouse(t.pos), t.id).toBeGreaterThanOrEqual(site.setbackRules.minTreeTrunkToHouse);
      expect(dToHouse(t.pos) - t.crown / 2, t.id).toBeGreaterThanOrEqual(site.setbackRules.minCrownEdgeToHouse);
      expect(site.species[t.species].kind).toBe("tree");
    }
    for (let i = 0; i < site.trees.length; i++) for (let j = i + 1; j < site.trees.length; j++) {
      const a = site.trees[i], b = site.trees[j];
      expect(Math.hypot(a.pos[0] - b.pos[0], a.pos[1] - b.pos[1])).toBeGreaterThan(2.5);
    }
  });

  it("hedges follow the boundary at their inset; shrubs, beds and paving are inside the plot", () => {
    const hedges = resolveHedges(site);
    expect(hedges).toHaveLength(site.hedges.length);
    for (const h of hedges) {
      const src = site.hedges.find((x) => x.id === h.id)!;
      for (const p of h.path) expect(pointInPolygon(p, plot)).toBe(true);
      for (const p of h.path) expect(distToBoundary(p, plot)).toBeCloseTo(src.inset, 6);
      const mid = pointAtLength(h.path, polylineLength(h.path) / 2).p;
      expect(plot.some((a, i) => Math.abs(segDist(mid, a, plot[(i + 1) % plot.length]) - src.inset) < 1e-6)).toBe(true);
    }
    for (const s of site.shrubs) expect(pointInPolygon(s.pos, plot), s.id).toBe(true);
    for (const b of [...site.beds, ...site.paved]) expect(intersectionArea(b.polygon as XY[], plot)).toBeCloseTo(polygonArea(b.polygon as XY[]), 6);
  });

  it("garden shrubs keep a distance from the walls", () => {
    for (const s of site.shrubs) expect(dToHouse(s.pos), s.id).toBeGreaterThan(0.7);
  });
});

describe("neighbours", () => {
  it("neighbour houses stand inside their own plots, clear of ours, on neighbour edges", () => {
    for (const nb of site.neighbours) {
      expect(site.plot.edges[nb.edge].kind).toBe("neighbour");
      const theirs = neighbourPlot(site, nb);
      expect(signedArea(theirs)).toBeGreaterThan(0);
      expect(intersectionArea(theirs, plot)).toBeLessThan(1e-9);
      const rect = orientedRect(nb.house.center, nb.house.size[0], nb.house.size[1], nb.house.rotDeg);
      for (const p of rect) {
        expect(pointInPolygon(p, theirs)).toBe(true);
        expect(distToBoundary(p, plot)).toBeGreaterThanOrEqual(3);
      }
    }
  });

  it("neighbour plots share exactly the boundary edge with ours", () => {
    for (const nb of site.neighbours) {
      const theirs = neighbourPlot(site, nb);
      const a = plot[nb.edge], b = plot[(nb.edge + 1) % plot.length];
      const has = (q: XY) => theirs.some((p) => Math.hypot(p[0] - q[0], p[1] - q[1]) < 1e-9);
      expect(has(a) && has(b)).toBe(true);
    }
  });
});

describe("shading geometry", () => {
  const occluders = buildOccluders(site, terrain, access);

  it("every tree, tall shrub, hedge, fence, gate, pillar and neighbour is an occluder standing on the ground", () => {
    const count = (role: string) => occluders.filter((o) => o.role === role).length;
    expect(count("tree")).toBe(site.trees.length);
    expect(count("shrub")).toBe(site.shrubs.filter((s) => s.height >= 1).length);
    expect(count("neighbour_wall")).toBe(site.neighbours.length);
    expect(count("neighbour_roof")).toBe(site.neighbours.length);
    expect(count("hedge") > 0).toBe(site.hedges.length > 0);
    expect(count("fence") > 0).toBe(site.fences.length > 0 || (site.gates?.length ?? 0) > 0);
    for (const o of occluders.filter((x) => x.role === "tree")) {
      expect(["sphere", "ellipsoid"]).toContain(o.kind);
      if (o.kind === "ellipsoid") expect(o.center[2] - o.radii[2]).toBeGreaterThan(terrain.groundAt(o.center[0], o.center[1]));
    }
  });

  it("the sky straight above the house is free", () => {
    const n = FIXTURE_HOUSE.footprint.length;
    const c = FIXTURE_HOUSE.footprint.reduce<XY>((a, p) => [a[0] + p[0] / n, a[1] + p[1] / n], [0, 0]);
    expect(rayTransmittance(occluders, [c[0], c[1], 1.2], [0, 0, 1], 200)).toBe(1);
  });

  it("a neighbour house blocks a ray aimed low at its wall, but not the sky above it", () => {
    for (const nb of site.neighbours) {
      const theirs = orientedRect(nb.house.center, nb.house.size[0], nb.house.size[1], nb.house.rotDeg);
      const z = Math.min(...theirs.map((p) => terrain.groundAt(p[0], p[1]))) + nb.house.eaveHeight / 2;
      const a = plot[nb.edge], b = plot[(nb.edge + 1) % plot.length];
      const origin: Vec3 = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, z];
      const d: Vec3 = [nb.house.center[0] - origin[0], nb.house.center[1] - origin[1], 0];
      const own = occluders.filter((o) => o.id === nb.id);
      expect(rayTransmittance(own, origin, d, 100)).toBe(0);
      expect(rayTransmittance(own, origin, [0, 0, 1], 100)).toBe(1);
    }
  });

  it("a deciduous crown screens more in summer than in winter", () => {
    const tree = site.trees.find((t) => !site.species[t.species].evergreen);
    if (!tree) return;
    const base = tree.crownBase ?? 0.3 * tree.height;
    const z = terrain.groundAt(tree.pos[0], tree.pos[1]) + base + (tree.height - base) / 2;
    const own = occluders.filter((o) => o.id === tree.id);
    const origin: Vec3 = [tree.pos[0] - tree.crown, tree.pos[1], z];
    const summer = rayTransmittance(own, origin, [1, 0, 0], 200);
    const winter = rayTransmittance(own, origin, [1, 0, 0], 15);
    expect(summer).toBeLessThan(winter);
    expect(summer).toBeLessThan(1);
  });
});

describe("createSite", () => {
  const s = createSite(siteRaw, FIXTURE_BEARING_DEG);

  it("bundles the parsed model, terrain, domain and zones", () => {
    expect(s.validation.errors).toEqual([]);
    expect(s.bounds.x1 - s.bounds.x0).toBeGreaterThan(90);
    for (const p of s.plot) expect(p[0] >= s.bounds.x0 && p[0] <= s.bounds.x1 && p[1] >= s.bounds.y0 && p[1] <= s.bounds.y1).toBe(true);
    expect(s.zones.neighbours).toHaveLength(site.neighbours.length);
    expect(intersectionArea(s.zones.field, plot)).toBeLessThan(1e-9);
    const r = site.terrain.plateau.rects[0];
    expect(s.terrain.groundAt((r[0] + r[2]) / 2, (r[1] + r[3]) / 2)).toBe(site.terrain.plateau.level);
  });

  it("derives the access, fences, gates, levels and occluders once the outdoor areas are known", () => {
    const w = s.withHouse(FIXTURE_HOUSE.outdoor);
    expect(w.access.driveApron).toHaveLength(4);
    expect(w.fences.length).toBe(site.fences.length);
    expect(w.gates.length).toBe(site.gates?.length ?? 0);
    expect(w.grading.grades).toHaveLength(FIXTURE_HOUSE.outdoor.length);
    expect(w.validation.errors).toEqual([]);
    expect(w.occluders().length).toBe(buildOccluders(site, w.terrain, access).length);
    expect(w.occluders({ minShrubHeight: 0 }).length).toBeGreaterThanOrEqual(w.occluders().length);
    expect(s.withHouse(FIXTURE_HOUSE.outdoor)).toBe(w);
  });
});
