// View model of the Plot page: everything the map and the panels show, computed once on the server from the house model
// (derived.json data), model/site.json and the pure site code. The result is plain JSON, so the client component never
// needs the schema validator and the page never branches on an id: elements are told apart by `type`, `kind` and `role`.
import type { Derived, House } from "@/lib/model";
import {
  analyzeSite, createSite, insetPolygon, orientedRect, polygonCentroid, rectToPolygon,
  type HouseInput, type SiteCheck, type SiteModel, type TerrainParams, type XY,
} from "@/lib/model/site";
import { poleOfInaccessibility } from "@/lib/model/polylabel";

export type Side = "N" | "E" | "S" | "W";
export const SIDES: readonly Side[] = ["N", "E", "S", "W"];
/** Corners of a polygon named by true compass direction. */
export type Corner = "NE" | "SE" | "SW" | "NW";
export const CORNERS: readonly Corner[] = ["NW", "NE", "SE", "SW"];

export interface OutdoorShape {
  /** Outdoor type of the house model (`terrace`, `paving`, `drive`, `path`). */
  type: string;
  covered: boolean;
  polygon: XY[];
  posts: XY[];
}

export interface PlotSetback {
  side: Side;
  d: number;
  from: XY;
  to: XY;
}

/** Point offered in the measuring lists. `group` and `corner` are turned into a name by the dictionary. */
export interface Preset {
  id: string;
  group: "house" | "garage" | "plot";
  corner?: Corner;
  p: XY;
}

export interface PlotView {
  bearingDeg: number;
  zeroLevelAsl: number;
  terrain: TerrainParams;
  plot: XY[];
  /** Centre of the plot (the map turns about it). */
  center: XY;
  /** Region (minimum wall distance from the boundary) in which the house may stand. */
  buildable: XY[];
  zones: {
    verge: XY[];
    carriageway: XY[];
    centreLine: [XY, XY];
    field: XY[];
    neighbours: { plot: XY[]; house: XY[] }[];
  };
  house: { outline: XY[]; garages: XY[][]; roofs: XY[][]; label: XY; area: number };
  outdoor: OutdoorShape[];
  /** Aprons and the crossing of the verge (driveway, walkway). */
  access: XY[][];
  paved: { kind: string; polygon: XY[] }[];
  beds: { kind: string; polygon: XY[] }[];
  hedges: { width: number; path: XY[] }[];
  fences: { kind: string; parts: XY[][] }[];
  trees: { pos: XY; crown: number }[];
  shrubs: { pos: XY; width: number }[];
  /** Wall set-backs by true compass side. */
  setbacks: PlotSetback[];
  /** Smallest eave (roof edge) distance from the boundary, when the house has roofs. */
  roofMin: number | null;
  /** Free run in front of the garage door towards the street, when there is one. */
  garageRun: number | null;
  checks: SiteCheck[];
  limits: { maxBuiltUpRatio: number; minGreenRatio: number; minToBoundary: number };
  stats: {
    plotArea: number; footprintArea: number; builtUpArea: number; builtUpRatio: number;
    pavedArea: number; pavedRatio: number; greenArea: number; greenRatio: number;
  };
  ground: { zMin: number; zMax: number; slopeMeanPct: number; slopeMaxPct: number; cut: number; fill: number; maxDepth: number };
  presets: Preset[];
  counts: { trees: number; shrubs: number };
}

const r2 = (v: number) => Math.round(v * 100) / 100;
const pt = (p: readonly number[]): XY => [r2(p[0]), r2(p[1])];
const poly = (p: readonly (readonly number[])[]): XY[] => p.map(pt);

/** Corner of a polygon that lies furthest towards a true compass direction (given as house-frame axis signs after rotation). */
export function cornerOf(polygon: readonly XY[], corner: Corner, bearingDeg: number): XY {
  const sx = corner.includes("E") ? 1 : -1, sy = corner.includes("N") ? 1 : -1;
  const a = (bearingDeg * Math.PI) / 180;
  let best = polygon[0], bestV = -Infinity;
  for (const p of polygon) {
    // true east / north components of the house-frame point (house +y has azimuth `bearingDeg`)
    const e = p[0] * Math.cos(a) + p[1] * Math.sin(a), n = -p[0] * Math.sin(a) + p[1] * Math.cos(a);
    const v = e * sx + n * sy;
    if (v > bestV) { bestV = v; best = p; }
  }
  return best;
}

export function buildPlotView(house: House, derived: Derived, siteRaw: unknown): PlotView {
  const bearingDeg = house.location.houseAxisBearingDeg;
  const site = createSite(siteRaw, bearingDeg);
  const model: SiteModel = site.model;
  const input: HouseInput = {
    bearingDeg,
    footprint: derived.outline.polygons[0].pts as XY[],
    outdoor: house.outdoor,
    roofs: house.roofs,
    openings: derived.openings,
  };
  const analysis = analyzeSite(model, input, site.terrain);
  const placed = site.withHouse(house.outdoor);
  const footprint = input.footprint;

  const label = poleOfInaccessibility([footprint]);
  const garages = derived.rooms.filter((r) => r.type === "garage").flatMap((r) => r.rects.map((rc) => poly(rectToPolygon(rc))));
  const setbacks: PlotSetback[] = [];
  for (const side of SIDES) {
    const s = analysis.setbacks.trueNorth[side];
    if (s) setbacks.push({ side, d: s.d, from: pt(s.from), to: pt(s.to) });
  }

  const presets: Preset[] = [
    ...CORNERS.map((c): Preset => ({ id: `house-${c}`, group: "house", corner: c, p: pt(cornerOf(footprint, c, bearingDeg)) })),
    ...garages.map((g, i): Preset => ({ id: `garage-${i}`, group: "garage", p: pt(polygonCentroid(g)) })),
    ...CORNERS.map((c): Preset => ({ id: `plot-${c}`, group: "plot", corner: c, p: pt(cornerOf(site.plot, c, bearingDeg)) })),
  ];

  const t = analysis.terrain, st = analysis.stats;
  return {
    bearingDeg,
    zeroLevelAsl: model.terrain.zeroLevelAsl,
    terrain: model.terrain as TerrainParams,
    plot: poly(site.plot),
    center: pt(polygonCentroid(site.plot)),
    buildable: poly(insetPolygon(site.plot, model.setbackRules.minToBoundary)),
    zones: {
      verge: poly(site.zones.street.verge),
      carriageway: poly(site.zones.street.carriageway),
      centreLine: [pt(site.zones.street.centreLine[0]), pt(site.zones.street.centreLine[1])],
      field: poly(site.zones.field),
      neighbours: model.neighbours.map((nb, i) => ({
        plot: poly(site.zones.neighbours[i].plot),
        house: poly(orientedRect(nb.house.center, nb.house.size[0], nb.house.size[1], nb.house.rotDeg)),
      })),
    },
    house: {
      outline: poly(footprint),
      garages,
      roofs: derived.roofs.map((r) => poly(rectToPolygon(r.eaveRect))),
      label: [r2(label.x), r2(label.y)],
      area: derived.outline.area,
    },
    outdoor: house.outdoor.map((o) => ({
      type: o.type,
      covered: !!o.covered,
      polygon: poly(rectToPolygon(o.rect)),
      posts: (o.posts ?? []).map(pt),
    })),
    access: [analysis.access.driveApron, analysis.access.driveVerge, analysis.access.walkApron, analysis.access.walkVerge].filter((p) => p.length).map(poly),
    paved: model.paved.map((p) => ({ kind: p.kind, polygon: poly(p.polygon) })),
    beds: model.beds.map((b) => ({ kind: b.kind, polygon: poly(b.polygon) })),
    hedges: site.hedges.map((h) => ({ width: h.width, path: poly(h.path) })),
    fences: placed.fences.map((f) => ({ kind: f.kind, parts: f.parts.map(poly) })),
    trees: model.trees.map((tr) => ({ pos: pt(tr.pos), crown: tr.crown })),
    shrubs: model.shrubs.map((s) => ({ pos: pt(s.pos), width: s.width })),
    setbacks,
    roofMin: analysis.roofSetbacks ? analysis.roofSetbacks.min.d : null,
    garageRun: (() => {
      const runs = analysis.garageDrives.filter((g) => g.edgeKind === "street").map((g) => g.length);
      return runs.length ? Math.min(...runs) : null;
    })(),
    checks: analysis.checks,
    limits: { maxBuiltUpRatio: model.limits.maxBuiltUpRatio, minGreenRatio: model.limits.minGreenRatio, minToBoundary: model.setbackRules.minToBoundary },
    stats: {
      plotArea: st.plotArea, footprintArea: st.footprintArea, builtUpArea: st.builtUpArea, builtUpRatio: st.builtUpRatio,
      pavedArea: st.pavedArea, pavedRatio: st.pavedRatio, greenArea: st.greenArea, greenRatio: st.greenRatio,
    },
    ground: {
      zMin: t.zMin, zMax: t.zMax, slopeMeanPct: t.slope.slopeMeanPct, slopeMaxPct: t.slope.slopeMaxPct,
      cut: t.cutFill.cut, fill: t.cutFill.fill, maxDepth: Math.max(t.cutFill.maxCut, t.cutFill.maxFill),
    },
    presets,
    counts: { trees: model.trees.length, shrubs: model.shrubs.length },
  };
}
