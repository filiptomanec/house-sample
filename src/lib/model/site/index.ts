// Public API of the plot model. Pure TypeScript, no DOM, no dependency on the house schema.
import { plotPolygon, siteBounds, accessGeometry, resolveFences, resolveHedges, streetGeometry, fieldZone, neighbourPlot, type AccessGeometry } from "./layout";
import { parseSite, type SiteModel } from "./siteSchema";
import { buildOccluders, type ShadingOptions } from "./shading";
import { createTerrain, type Terrain } from "./terrain";
import type { Bbox, XY } from "./geometry";
import type { OutdoorInput } from "./stats";
import type { Occluder } from "./occluders";
import { validateSite, type SiteValidation } from "./validate";

export * from "./geometry";
export * from "./terrain";
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

/** A parsed site with its terrain and resolved layout, ready for the web app. */
export interface Site {
  model: SiteModel;
  /** Counter-clockwise plot ring. */
  plot: XY[];
  /** Terrain and zone domain (plot plus margin). */
  bounds: Bbox;
  terrain: Terrain;
  validation: SiteValidation;
  /** Ground zones around the plot for rendering: street, field and the two neighbour plots. */
  zones: {
    street: ReturnType<typeof streetGeometry>;
    field: XY[];
    neighbours: { id: string; plot: XY[] }[];
  };
  hedges: ReturnType<typeof resolveHedges>;
  /** Driveway, walkway, fences with gate openings: need the outdoor areas of the house model. */
  withHouse(outdoor: readonly OutdoorInput[]): { access: AccessGeometry; fences: ReturnType<typeof resolveFences>; occluders(opts?: ShadingOptions): Occluder[] };
}

/**
 * Parses site.json (throws on schema errors) and builds the terrain for the given house axis bearing.
 * `houseAxisBearingDeg` comes from `house.json#/location`; the site never stores it.
 */
export function createSite(raw: unknown, houseAxisBearingDeg: number): Site {
  const model = parseSite(raw);
  const terrain = createTerrain(model.terrain, houseAxisBearingDeg);
  return {
    model,
    plot: plotPolygon(model),
    bounds: siteBounds(model),
    terrain,
    validation: validateSite(model),
    zones: {
      street: streetGeometry(model),
      field: fieldZone(model),
      neighbours: model.neighbours.map((nb) => ({ id: nb.id, plot: neighbourPlot(model, nb) })),
    },
    hedges: resolveHedges(model),
    withHouse(outdoor) {
      const access = accessGeometry(model, outdoor);
      return { access, fences: resolveFences(model, access), occluders: (opts) => buildOccluders(model, terrain, access, opts) };
    },
  };
}
