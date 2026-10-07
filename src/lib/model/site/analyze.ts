// Plot analysis: areas, set-backs, rule checks and terrain statistics for the Plot page and the tests.
import {
  bboxOf, distToBoundary, expandRect, polygonArea, polygonCentroid, polygonPerimeter, rayToBoundary, rectToPolygon, vectorOfAzimuth, type Bbox, type XY,
} from "./geometry";
import { accessGeometry, plotPolygon, type AccessGeometry } from "./layout";
import { houseSetbacks, type SetbackSet } from "./setbacks";
import { cutFillVolume, plotStats, slopeStats, type CutFill, type PavedInput, type PlotStats, type SlopeStats } from "./stats";
import type { SiteModel } from "./siteSchema";
import { createTerrain, type Terrain } from "./terrain";
import type { HouseInput } from "./types";

export interface SiteCheck {
  /** Stable key for tests and the UI dictionary (never a house id). */
  key: "boundary" | "roofEdge" | "garageDrive" | "builtUp" | "green" | "treeTrunk" | "treeCrown" | "houseInside";
  ok: boolean;
  /** Measured value and its limit; `rule` says whether the value must be at least or at most the limit. */
  actual: number;
  limit: number;
  rule: "min" | "max";
  unit: "m" | "ratio" | "flag";
}

export interface SiteAnalysis {
  plot: { polygon: XY[]; area: number; perimeter: number; centroid: XY; bbox: Bbox };
  stats: PlotStats;
  /** Wall set-backs. */
  setbacks: SetbackSet;
  /** Eave (roof edge) set-backs; undefined without roofs. */
  roofSetbacks?: SetbackSet;
  /** Free run from each exterior garage door to the plot boundary. */
  garageDrives: { length: number; from: XY; to: XY; edge: number; edgeKind?: string }[];
  checks: SiteCheck[];
  ok: boolean;
  terrain: { slope: SlopeStats; cutFill: CutFill; zMin: number; zMax: number };
  access: AccessGeometry;
  /** Hard surfaces of the site model (including the derived aprons) as passed to `plotStats`. */
  paved: PavedInput[];
}

/** Site-level hard surfaces: declared ones plus the aprons derived from the driveway and walkway. */
export function sitePaved(site: SiteModel, access: AccessGeometry): PavedInput[] {
  const out: PavedInput[] = site.paved.map((p) => ({ kind: p.kind, polygon: p.polygon as XY[] }));
  if (access.driveApron.length) out.push({ kind: "apron", polygon: access.driveApron });
  if (access.walkApron.length) out.push({ kind: "apron", polygon: access.walkApron });
  return out;
}

const roofPolygons = (house: HouseInput): XY[][] => (house.roofs ?? []).map((r) => rectToPolygon(expandRect(r.rect, r.overhang ?? 0)));

/** Distance from every garage door (exterior, with an azimuth) to the plot boundary along its outward normal. */
export function garageDriveLengths(site: SiteModel, house: HouseInput): SiteAnalysis["garageDrives"] {
  const plot = plotPolygon(site);
  const out: SiteAnalysis["garageDrives"] = [];
  for (const o of house.openings ?? []) {
    if (o.kind !== "garage" || o.azimuth == null || o.exterior === false) continue;
    const origin: XY = [o.cx, o.cy];
    const hit = rayToBoundary(origin, o.azimuth, plot);
    if (!hit) continue;
    const wall = rayToBoundary(origin, o.azimuth, house.footprint); // exit through the outer wall face
    const dir = vectorOfAzimuth(o.azimuth);
    const d0 = wall?.d ?? 0;
    out.push({
      length: hit.d - d0,
      from: [origin[0] + dir[0] * d0, origin[1] + dir[1] * d0],
      to: hit.point,
      edge: hit.edge,
      edgeKind: site.plot.edges[hit.edge]?.kind,
    });
  }
  return out;
}

export function analyzeSite(site: SiteModel, house: HouseInput, terrain?: Terrain): SiteAnalysis {
  const plot = plotPolygon(site);
  const t = terrain ?? createTerrain(site.terrain, house.bearingDeg);
  const access = accessGeometry(site, house.outdoor);
  const paved = sitePaved(site, access);
  const stats = plotStats(plot, house.footprint, house.outdoor, paved);
  const edgeKinds = site.plot.edges.map((e) => e.kind);
  const setbacks = houseSetbacks(house.footprint, plot, { bearingDeg: house.bearingDeg, edgeKinds });
  const roofPolys = roofPolygons(house);
  const roofSetbacks = roofPolys.length
    ? roofPolys.map((p) => houseSetbacks(p, plot, { bearingDeg: house.bearingDeg, edgeKinds })).reduce((a, b) => (b.min.d < a.min.d ? b : a))
    : undefined;
  const garageDrives = garageDriveLengths(site, house);
  const r = site.setbackRules, lim = site.limits;

  const checks: SiteCheck[] = [
    { key: "houseInside", ok: setbacks.inside, actual: setbacks.inside ? 1 : 0, limit: 1, rule: "min", unit: "flag" },
    { key: "boundary", ok: setbacks.min.d >= r.minToBoundary, actual: setbacks.min.d, limit: r.minToBoundary, rule: "min", unit: "m" },
  ];
  if (roofSetbacks) checks.push({ key: "roofEdge", ok: roofSetbacks.min.d >= r.minRoofEdgeToBoundary, actual: roofSetbacks.min.d, limit: r.minRoofEdgeToBoundary, rule: "min", unit: "m" });
  const streetDrives = garageDrives.filter((g) => g.edgeKind === "street");
  if (streetDrives.length) {
    const shortest = Math.min(...streetDrives.map((g) => g.length));
    checks.push({ key: "garageDrive", ok: shortest >= r.minToStreetAtDriveway, actual: shortest, limit: r.minToStreetAtDriveway, rule: "min", unit: "m" });
  }
  checks.push(
    { key: "builtUp", ok: stats.builtUpRatio <= lim.maxBuiltUpRatio, actual: stats.builtUpRatio, limit: lim.maxBuiltUpRatio, rule: "max", unit: "ratio" },
    { key: "green", ok: stats.greenRatio >= lim.minGreenRatio, actual: stats.greenRatio, limit: lim.minGreenRatio, rule: "min", unit: "ratio" },
  );
  if (site.trees.length) {
    const trunk = Math.min(...site.trees.map((tr) => distToHouse(tr.pos, house.footprint)));
    const crownEdge = Math.min(...site.trees.map((tr) => distToHouse(tr.pos, house.footprint) - tr.crown / 2));
    checks.push(
      { key: "treeTrunk", ok: trunk >= r.minTreeTrunkToHouse, actual: trunk, limit: r.minTreeTrunkToHouse, rule: "min", unit: "m" },
      { key: "treeCrown", ok: crownEdge >= r.minCrownEdgeToHouse, actual: crownEdge, limit: r.minCrownEdgeToHouse, rule: "min", unit: "m" },
    );
  }

  const slope = slopeStats(t, plot);
  return {
    plot: { polygon: plot, area: polygonArea(plot), perimeter: polygonPerimeter(plot), centroid: polygonCentroid(plot), bbox: bboxOf(plot) },
    stats, setbacks, roofSetbacks, garageDrives, checks,
    ok: checks.every((c) => c.ok),
    terrain: { slope, cutFill: cutFillVolume(t, plot), zMin: slope.zMin, zMax: slope.zMax },
    access, paved,
  };
}

/** Distance from a point to the house outline (0 inside). */
export const distToHouse = (p: XY, footprint: readonly XY[]): number => distToBoundary(p, footprint);
