// Public API of the plot model. Pure TypeScript, no DOM, no dependency on the house schema.
import {
  plotPolygon, siteBounds, accessGeometry, resolveBoundary, resolveFences, resolveHedges, streetGeometry, fieldZone, neighbourPlot,
  type AccessGeometry, type ResolvedGate, type ResolvedPillar,
} from "./layout";
import { parseSite, type SiteModel } from "./siteSchema";
import { buildOccluders, type ShadingOptions } from "./shading";
import { createTerrain, type Terrain } from "./terrain";
import { gradeOutdoor, type Grading } from "./grading";
import type { Bbox, XY } from "./geometry";
import type { OutdoorInput } from "./stats";
import type { Occluder } from "./occluders";
import { validateSite, validateSiteWithHouse, type SiteValidation } from "./validate";

export * from "./geometry";
export * from "./terrain";
export * from "./grading";
export * from "./contours";
export * from "./profile";
export * from "./setbacks";
export * from "./stats";
export * from "./occluders";
export * from "./layout";
export * from "./shading";
export * from "./analyze";
export * from "./export";
export * from "./validate";
export * from "./siteSchema";
export type * from "./types";

/** The parts of the site that need the outdoor areas of the house. */
export interface SiteWithHouse {
  access: AccessGeometry;
  fences: ReturnType<typeof resolveFences>;
  gates: ResolvedGate[];
  pillars: ResolvedPillar[];
  /** Levels of the outdoor areas (flat slabs, drive and path ramps) and the slabs that cut the terrain. */
  grading: Grading;
  /** The terrain graded with those slabs: use it for the ground mesh, walking and the renders. */
  terrain: Terrain;
  /** validateSite plus the checks that need the house (gates, ramps, rainwater tank). */
  validation: SiteValidation;
  occluders(opts?: ShadingOptions): Occluder[];
}

/** A parsed site with its terrain and resolved layout, ready for the web app. */
export interface Site {
  model: SiteModel;
  /** Counter-clockwise plot ring. */
  plot: XY[];
  /** Terrain and zone domain (plot plus margin). */
  bounds: Bbox;
  /** The terrain; graded with the house's slabs when `createSite` got the outdoor areas, else the plateau terrain. */
  terrain: Terrain;
  validation: SiteValidation;
  /** Ground zones around the plot for rendering: street (with pavement), field and the two neighbour plots. */
  zones: {
    street: ReturnType<typeof streetGeometry>;
    field: XY[];
    neighbours: { id: string; plot: XY[] }[];
  };
  hedges: ReturnType<typeof resolveHedges>;
  /** Driveway, walkway, fences with gates and pillars, levels and the graded terrain: need the outdoor areas of the house model. */
  withHouse(outdoor: readonly OutdoorInput[]): SiteWithHouse;
}

/**
 * Parses site.json (throws on schema errors) and builds the terrain for the given house axis bearing.
 * `houseAxisBearingDeg` comes from `house.json#/location`; the site never stores it. With `outdoor` (house.json `outdoor[]`)
 * the terrain is graded with the house's slabs (the ground follows the drive and path ramps) and the validation includes
 * the checks that need the house; pass it wherever the ground is drawn.
 */
export function createSite(raw: unknown, houseAxisBearingDeg: number, outdoor?: readonly OutdoorInput[]): Site {
  const model = parseSite(raw);
  const base = createTerrain(model.terrain, houseAxisBearingDeg);
  const cache = new Map<readonly OutdoorInput[], SiteWithHouse>();
  const withHouse = (od: readonly OutdoorInput[]): SiteWithHouse => {
    const hit = cache.get(od);
    if (hit) return hit;
    const access = accessGeometry(model, od);
    const boundary = resolveBoundary(model, access);
    const grading = gradeOutdoor(od, base.baseAt, access);
    const terrain = createTerrain(model.terrain, houseAxisBearingDeg, grading.slabs);
    const own = validateSite(model), more = validateSiteWithHouse(model, od, houseAxisBearingDeg);
    const result: SiteWithHouse = {
      access, fences: boundary.fences, gates: boundary.gates, pillars: boundary.pillars, grading, terrain,
      validation: { errors: [...own.errors, ...more.errors], warnings: [...own.warnings, ...more.warnings] },
      occluders: (opts) => buildOccluders(model, terrain, access, opts),
    };
    cache.set(od, result);
    return result;
  };
  const placed = outdoor ? withHouse(outdoor) : null;
  return {
    model,
    plot: plotPolygon(model),
    bounds: siteBounds(model),
    terrain: placed ? placed.terrain : base,
    validation: placed ? placed.validation : validateSite(model),
    zones: {
      street: streetGeometry(model),
      field: fieldZone(model),
      neighbours: model.neighbours.map((nb) => ({ id: nb.id, plot: neighbourPlot(model, nb) })),
    },
    hedges: resolveHedges(model),
    withHouse,
  };
}
