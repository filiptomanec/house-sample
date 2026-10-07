import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import siteRaw from "@model/site.json";
import {
  azimuthOf, distToBoundary, edgeOutwardNormal, expandRect, intersectionArea, pointAtLength, pointInPolygon, polygonArea, polylineLength,
  rectToPolygon, segDist, signedArea, type XY,
} from "../geometry";
import { createSite } from "../index";
import { accessGeometry, cutGap, neighbourPlot, pathAlongPlot, plotPolygon, resolveFences, resolveHedges, streetGeometry, yOnLine, offsetEdgeLine } from "../layout";
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
    // house +y points 12 degrees east of true north; the street edge normal is within ~5 degrees of house +y,
    // so in true terms the street runs about perpendicular to bearing 12 degrees (ESE to WNW)
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
    if (!existsSync(file)) return; // the kernel agent writes it later; the fixture covers the same shapes
    type R4 = [number, number, number, number];
    const isRect = (r: unknown): r is R4 => Array.isArray(r) && r.length === 4 && r.every((v) => typeof v === "number");
    const house = JSON.parse(readFileSync(file, "utf8")) as { outdoor?: { type: string; covered?: boolean; rect?: unknown }[]; roofs?: { rect?: unknown; overhang?: number }[] };
    const outdoor = (house.outdoor ?? []).filter((o) => isRect(o.rect)).map((o) => ({ type: o.type, covered: o.covered, rect: o.rect as R4 }));
    for (const o of outdoor) for (const p of rectToPolygon(o.rect)) expect(pointInPolygon(p, plot), `outdoor ${o.type} corner`).toBe(true);
    for (const r of house.roofs ?? []) {
      if (!isRect(r.rect)) continue;
      for (const p of rectToPolygon(expandRect(r.rect, r.overhang ?? 0))) expect(distToBoundary(p, plot)).toBeGreaterThanOrEqual(site.setbackRules.minRoofEdgeToBoundary);
    }
    const types = new Set(outdoor.map((o) => o.type));
    if (types.has(site.access.driveway.outdoorType) && types.has(site.access.walkway.outdoorType)) {
      const a = accessGeometry(site, outdoor);
      expect(a.driveApron.length === 0 || a.driveApron.length === 4).toBe(true);
    }
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

  it("the walkway and the drive end at the street boundary; gates are centred on them", () => {
    expect(access.walkApron).toHaveLength(4);
    const dc = (access.driveRect[0] + access.driveRect[2]) / 2;
    expect(access.driveGate.center[0]).toBeCloseTo(dc, 12);
    expect(distToBoundary(access.driveGate.center, plot)).toBeLessThan(1e-9);
    expect(access.driveGate.width).toBeCloseTo(access.driveRect[2] - access.driveRect[0] + 2 * site.access.driveway.gateMargin, 12);
    expect(access.walkGate.width).toBeCloseTo(access.walkRect[2] - access.walkRect[0] + 2 * site.access.walkway.gateMargin, 12);
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
    const w = (polygonArea(st.carriageway) / polylineLength([st.carriageway[0], st.carriageway[1]]));
    expect(w).toBeCloseTo(site.street.carriageway, 6);
  });

  it("street fence has openings for both gates and nothing else", () => {
    const fences = resolveFences(site, access);
    const street = fences.find((f) => f.kind === "plinth_fence");
    expect(street?.parts).toHaveLength(3);
    const full = pathAlongPlot(plot, 0.1, { edge: site.street.edge, t: 0 }, { edge: site.street.edge, t: 1 });
    const total = polylineLength(full);
    const kept = (street?.parts ?? []).reduce((s, p) => s + polylineLength(p), 0);
    expect(total - kept).toBeCloseTo(access.driveGate.width + access.walkGate.width, 6);
    const east = fences.find((f) => f.kind === "wood_fence");
    expect(east?.parts).toHaveLength(1);
  });

  it("cutGap removes exactly the requested stretch", () => {
    const parts = cutGap([[0, 0], [10, 0]], [4, 1], 2);
    expect(parts).toHaveLength(2);
    expect(parts[0][parts[0].length - 1][0]).toBeCloseTo(3, 12);
    expect(parts[1][0][0]).toBeCloseTo(5, 12);
  });
});

describe("vegetation", () => {
  const dToHouse = (p: XY) => distToBoundary(p, FIXTURE_HOUSE.footprint);

  it("trees stand inside the plot with their crowns, none too near the house", () => {
    expect(site.trees.length).toBeGreaterThanOrEqual(6);
    for (const t of site.trees) {
      expect(pointInPolygon(t.pos, plot), t.id).toBe(true);
      expect(distToBoundary(t.pos, plot), t.id).toBeGreaterThanOrEqual(t.crown / 2 - 0.5);
      expect(dToHouse(t.pos), t.id).toBeGreaterThanOrEqual(site.setbackRules.minTreeTrunkToHouse);
      expect(dToHouse(t.pos) - t.crown / 2, t.id).toBeGreaterThanOrEqual(site.setbackRules.minCrownEdgeToHouse);
      expect(site.species[t.species].kind).toBe("tree");
    }
  });

  it("mixes evergreen and deciduous trees, mostly on the south and west side, and trunks do not collide", () => {
    const evergreen = site.trees.filter((t) => site.species[t.species].evergreen);
    expect(evergreen.length).toBeGreaterThanOrEqual(1);
    expect(site.trees.length - evergreen.length).toBeGreaterThanOrEqual(3);
    const southOrWest = site.trees.filter((t) => t.pos[1] < 0 || t.pos[0] < 0);
    expect(southOrWest.length).toBeGreaterThanOrEqual(site.trees.length / 2);
    for (let i = 0; i < site.trees.length; i++) for (let j = i + 1; j < site.trees.length; j++) {
      const a = site.trees[i], b = site.trees[j];
      expect(Math.hypot(a.pos[0] - b.pos[0], a.pos[1] - b.pos[1])).toBeGreaterThan(2.5);
    }
  });

  it("hedges follow the south and the west boundary at their inset; shrubs are inside the plot", () => {
    const hedges = resolveHedges(site);
    expect(hedges).toHaveLength(2);
    for (const h of hedges) {
      for (const p of h.path) expect(pointInPolygon(p, plot)).toBe(true);
      const src = site.hedges.find((x) => x.id === h.id);
      for (const p of h.path) expect(distToBoundary(p, plot)).toBeCloseTo(src?.inset ?? 0, 6);
    }
    // a hedge "runs along" an edge when its middle is exactly `inset` metres from that edge's line
    const westEdge = site.neighbours.map((n) => n.edge).find((e) => Math.abs(azimuthOf(edgeOutwardNormal(plot, e)) - 270) < 10) as number;
    const runsAlong = (edge: number) => hedges.some((h) => {
      const mid = pointAtLength(h.path, polylineLength(h.path) / 2).p;
      const a = plot[edge], b = plot[(edge + 1) % plot.length];
      const src = site.hedges.find((x) => x.id === h.id);
      return Math.abs(segDist(mid, a, b) - (src?.inset ?? 0)) < 1e-6;
    });
    expect(runsAlong(site.field.edge)).toBe(true);
    expect(runsAlong(westEdge)).toBe(true);
    for (const s of site.shrubs) expect(pointInPolygon(s.pos, plot), s.id).toBe(true);
    for (const b of [...site.beds, ...site.paved]) expect(intersectionArea(b.polygon as XY[], plot)).toBeCloseTo(polygonArea(b.polygon as XY[]), 6);
  });

  it("garden shrubs keep a distance from the walls", () => {
    for (const s of site.shrubs) expect(dToHouse(s.pos), s.id).toBeGreaterThan(0.7);
  });
});

describe("neighbours", () => {
  it("two neighbour houses, one on each side, with hip roofs, inside their own plots and clear of ours", () => {
    expect(site.neighbours).toHaveLength(2);
    const edges = site.neighbours.map((n) => n.edge).sort();
    expect(edges).toEqual([1, 3]);
    for (const nb of site.neighbours) {
      const theirs = neighbourPlot(site, nb);
      expect(signedArea(theirs)).toBeGreaterThan(0);
      expect(intersectionArea(theirs, plot)).toBeLessThan(1e-9);
      const rect = orientedRect(nb.house.center, nb.house.size[0], nb.house.size[1], nb.house.rotDeg);
      for (const p of rect) {
        expect(pointInPolygon(p, theirs)).toBe(true);
        expect(distToBoundary(p, plot)).toBeGreaterThanOrEqual(3);
      }
      expect(nb.house.roof.kind).toBe("hip");
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
  const dir = (azHouse: number, elevDeg: number): Vec3 => {
    const a = (azHouse * Math.PI) / 180, e = (elevDeg * Math.PI) / 180;
    return [Math.sin(a) * Math.cos(e), Math.cos(a) * Math.cos(e), Math.sin(e)];
  };

  it("contains neighbour walls and roofs, trees, tall shrubs, hedges and fences, all standing on the ground", () => {
    const roles = new Set(occluders.map((o) => o.role));
    for (const r of ["neighbour_wall", "neighbour_roof", "tree", "shrub", "hedge", "fence"]) expect(roles.has(r as never), r).toBe(true);
    expect(occluders.filter((o) => o.role === "tree")).toHaveLength(site.trees.length);
    expect(occluders.filter((o) => o.role === "shrub")).toHaveLength(site.shrubs.filter((s) => s.height >= 1).length);
    for (const o of occluders.filter((x) => x.role === "tree")) {
      expect(["sphere", "ellipsoid"]).toContain(o.kind);
      if (o.kind === "ellipsoid") expect(o.center[2] - o.radii[2]).toBeGreaterThan(terrain.groundAt(o.center[0], o.center[1]));
    }
  });

  it("the sky straight above the terrace and the south facade is free", () => {
    expect(rayTransmittance(occluders, [3, 2, 1.2], [0, 0, 1], 200)).toBe(1);
    expect(rayTransmittance(occluders, [10.2, -0.3, 1.2], dir(180, 60), 172)).toBe(1); // high summer sun due south
  });

  it("the west neighbour shades a low evening sun but not a high one", () => {
    const origin: Vec3 = [-0.4, 8.6, 1.2];
    expect(rayTransmittance(occluders, origin, dir(272, 4), 100)).toBe(0);
    expect(rayTransmittance(occluders, origin, dir(272, 45), 100)).toBe(1);
  });

  it("the walnut screens the south-west terrace in summer far better than in winter", () => {
    const walnut = site.trees.find((t) => site.species[t.species].latin === "Juglans regia");
    expect(walnut).toBeDefined();
    const w = walnut as (typeof site.trees)[number];
    const origin: Vec3 = [3, 2, 1.2];
    const target: Vec3 = [w.pos[0], w.pos[1], terrain.groundAt(w.pos[0], w.pos[1]) + 0.6 * w.height];
    const d = [target[0] - origin[0], target[1] - origin[1], target[2] - origin[2]] as Vec3;
    const summer = rayTransmittance(occluders, origin, d, 200);
    const winter = rayTransmittance(occluders, origin, d, 15);
    expect(summer).toBeLessThan(0.05);
    expect(winter).toBeGreaterThan(summer);
  });
});

describe("createSite", () => {
  const s = createSite(siteRaw, FIXTURE_BEARING_DEG);

  it("bundles the parsed model, terrain, domain and zones", () => {
    expect(s.validation.errors).toEqual([]);
    expect(s.bounds.x1 - s.bounds.x0).toBeGreaterThan(90);
    for (const p of s.plot) expect(p[0] >= s.bounds.x0 && p[0] <= s.bounds.x1 && p[1] >= s.bounds.y0 && p[1] <= s.bounds.y1).toBe(true);
    expect(s.zones.neighbours).toHaveLength(2);
    expect(intersectionArea(s.zones.field, plot)).toBeLessThan(1e-9);
    expect(s.terrain.groundAt(11.5, 5.9)).toBe(0);
  });

  it("derives the access, fences and occluders once the outdoor areas are known", () => {
    const w = s.withHouse(FIXTURE_HOUSE.outdoor);
    expect(w.access.driveApron).toHaveLength(4);
    expect(w.fences.length).toBe(site.fences.length);
    expect(w.occluders().length).toBe(buildOccluders(site, terrain, access).length);
    expect(w.occluders({ minShrubHeight: 0 }).length).toBeGreaterThan(w.occluders().length);
  });
});
