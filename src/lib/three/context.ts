// The data a 3D scene is built from, assembled once from the model files. Everything the engine knows about the house
// and the plot comes through this object; nothing else is read (docs/THREE-API.md section 2).
import siteJson from "../../../model/site.json";
import styleJson from "../../../model/style.json";
import { derived as sharedDerived, house as sharedHouse } from "@/lib/model/instance";
import type { Derived, House } from "@/lib/model";
import { createSite, type Site } from "@/lib/model/site";
import type { StyleModel } from "./style";
import type { SceneExtent } from "./views";

export interface HouseContext {
  readonly house: House;
  readonly derived: Derived;
  /**
   * The plot: boundary, zones, trees, hedges (model/site.json, processed by src/lib/model/site) and the terrain graded with the
   * house's slabs (`createSite(raw, bearing, house.outdoor)`): the ground follows the drive and path ramps and never covers a slab.
   */
  readonly site: Site;
  /** Driveway, walkway, fences with gate openings, analytic occluders: need the outdoor areas of the house. */
  readonly layout: ReturnType<Site["withHouse"]>;
  readonly style: StyleModel;
  /** `derived.houseAxisBearingDeg`: true azimuth of the house +y axis. */
  readonly bearingDeg: number;
}

export interface HouseContextParts {
  house: House;
  derived: Derived;
  /** Raw site.json (parsed here with `createSite`). */
  site: unknown;
  /** Raw style.json. */
  style: unknown;
}

/** Builds a context from explicit parts (tests with a changed model use this). */
export function createHouseContext(parts: HouseContextParts): HouseContext {
  const bearingDeg = parts.derived.houseAxisBearingDeg;
  // with the outdoor areas the terrain is graded (drive and path ramps, slabs cut in); the layout below is the same cached object
  const site = createSite(parts.site, bearingDeg, parts.house.outdoor);
  return {
    house: parts.house,
    derived: parts.derived,
    site,
    layout: site.withHouse(parts.house.outdoor),
    style: parts.style as StyleModel,
    bearingDeg,
  };
}

let shared: HouseContext | null = null;

/** The context of the project's house, built on first use and shared (read-only). */
export function getHouseContext(): HouseContext {
  shared ??= createHouseContext({ house: sharedHouse, derived: sharedDerived, site: siteJson, style: styleJson });
  return shared;
}

/**
 * The part of the world the camera may look at.
 * `"plot"`: the whole plot (Model page); `"house"`: the building with a margin of its own height (Sun page close-ups).
 */
export function sceneExtent(ctx: HouseContext, mode: "plot" | "house" = "plot"): SceneExtent {
  const top = ctx.derived.bbox.z1;
  if (mode === "house") {
    const b = ctx.derived.bbox;
    const center: [number, number, number] = [(b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2, 0];
    return { center, radius: Math.hypot(b.w, b.d) / 2 + top, top };
  }
  const ring = ctx.site.plot;
  const xs = ring.map((p) => p[0]), ys = ring.map((p) => p[1]);
  const center: [number, number, number] = [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2, 0];
  return { center, radius: Math.max(...ring.map((p) => Math.hypot(p[0] - center[0], p[1] - center[1]))), top };
}
