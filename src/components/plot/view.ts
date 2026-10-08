// View model of the Plot page: everything the map and the panels show, computed once on the server from the house model
// (derived.json data), model/site.json and the pure site code. The result is plain JSON, so the client component never
// needs the schema validator and the page never branches on an id: elements are told apart by `type`, `kind` and `role`.
import type { Derived, House } from "@/lib/model";
import type { LocalizedText } from "@/lib/model/types";
import {
  analyzeSite, createSite, insetPolygon, orientedRect, polygonCentroid, rectToPolygon,
  type GroundSlab, type HouseInput, type SiteCheck, type SiteModel, type TerrainParams, type XY,
} from "@/lib/model/site";
import { poleOfInaccessibility } from "@/lib/model/polylabel";

export type Side = "N" | "E" | "S" | "W";
export const SIDES: readonly Side[] = ["N", "E", "S", "W"];
/** Corners of a polygon named by true compass direction. */
export type Corner = "NE" | "SE" | "SW" | "NW";
export const CORNERS: readonly Corner[] = ["NW", "NE", "SE", "SW"];

export interface OutdoorShape {
  /** Outdoor type of the house model (`terrace`, `paving`, `drive`, `path`, `deck`, `pool`). */
  type: string;
  /** Finish of the slab (`deck`, `terrace_paving`, `drive_paving`, `path`, `pool_coping`): the map colours by it. */
  role: string;
  covered: boolean;
  polygon: XY[];
  posts: XY[];
  /** Side of the square posts, m (from the model), or null when the area has none. */
  postSize: number | null;
  /** A pool: the water surface (the polygon is the outer edge of the coping). */
  water: XY[] | null;
}

/** A gate of the plot (from the resolved site): the closed leaf, where a sliding leaf parks, the arc of a swing leaf. */
export interface GateShape {
  kind: "sliding" | "swing";
  leaf: XY[];
  posts: XY[];
  postSize: number;
  park: XY[] | null;
  /** The parked leaf as a line along the fence (sliding gates): where it ends up when the gate is open. */
  parkLine: [XY, XY] | null;
  /** Unit vector from the fence line into the plot (the side the leaf parks and the swing gate opens to). */
  inward: XY;
  swing: { hinge: XY; open: XY; arc: XY[] } | null;
}

export interface PlotSetback {
  side: Side;
  d: number;
  from: XY;
  to: XY;
}

/** Point offered in the measuring lists. `group`, `corner` and `index` are turned into a name by the dictionary. */
export interface Preset {
  id: string;
  group: "house" | "garage" | "plot";
  corner?: Corner;
  /** Position within its group, 0-based (the second garage is "Garáž 2"; ids are never parsed for display). */
  index: number;
  p: XY;
}

export interface PlotView {
  bearingDeg: number;
  zeroLevelAsl: number;
  terrain: TerrainParams;
  /** The house's slabs: the client grades the ground with them (createTerrain(terrain, bearingDeg, slabs)), as the 3D does. */
  slabs: GroundSlab[];
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
  /** Outline, garage rooms, roof eaves and the lines of the roof seen from above (hips, ridges, valleys). */
  house: { outline: XY[]; garages: XY[][]; roofs: XY[][]; roofLines: [XY, XY][]; label: XY; area: number };
  outdoor: OutdoorShape[];
  /** Aprons and the crossing of the verge (driveway, walkway). */
  access: XY[][];
  paved: { kind: string; polygon: XY[] }[];
  beds: { kind: string; polygon: XY[] }[];
  hedges: { width: number; path: XY[] }[];
  fences: { kind: string; parts: XY[][]; posts: XY[]; postSize: number | null }[];
  gates: GateShape[];
  pillars: { footprint: XY[] }[];
  /** Rainwater tank under the lawn (the lid is drawn), or null. */
  tank: { pos: XY; diameter: number } | null;
  /** `feature`: the largest tree (the walnut of the house's name), named on the map by its species. */
  trees: { pos: XY; crown: number; feature: boolean; name: LocalizedText }[];
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
    pavedArea: number; pavedRatio: number; waterArea: number; waterRatio: number; greenArea: number; greenRatio: number;
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
  // graded with the house's slabs: the same ground as the 3D scene, the renders and the plot statistics
  const site = createSite(siteRaw, bearingDeg, house.outdoor);
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
    ...CORNERS.map((c, i): Preset => ({ id: `house-${c}`, group: "house", corner: c, index: i, p: pt(cornerOf(footprint, c, bearingDeg)) })),
    ...garages.map((g, i): Preset => ({ id: `garage-${i}`, group: "garage", index: i, p: pt(polygonCentroid(g)) })),
    ...CORNERS.map((c, i): Preset => ({ id: `plot-${c}`, group: "plot", corner: c, index: i, p: pt(cornerOf(site.plot, c, bearingDeg)) })),
  ];
  // roof lines seen from above: every hip, ridge and valley edge of the roof faces, each once
  const lineKey = (a: XY, b: XY) => [a, b].map((q) => `${r2(q[0])},${r2(q[1])}`).sort().join("|");
  const roofLines = new Map<string, [XY, XY]>();
  for (const face of derived.roofPlanes) {
    face.edges.forEach((e, i) => {
      if (e.kind === "eave") return;
      const a = pt(face.pts[i]), b = pt(face.pts[(i + 1) % face.pts.length]);
      if (Math.hypot(b[0] - a[0], b[1] - a[1]) > 0.05) roofLines.set(lineKey(a, b), [a, b]);
    });
  }
  const tallest = Math.max(0, ...model.trees.map((tr) => tr.height));
  const pools = new Map(derived.outdoor.filter((o) => o.pool).map((o) => [o.id, o.pool!]));

  const t = analysis.terrain, st = analysis.stats;
  return {
    bearingDeg,
    zeroLevelAsl: model.terrain.zeroLevelAsl,
    terrain: model.terrain as TerrainParams,
    slabs: placed.grading.slabs.map((sl) => ({ polygon: poly(sl.polygon), plane: sl.plane })),
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
      roofLines: [...roofLines.values()],
      label: [r2(label.x), r2(label.y)],
      area: derived.outline.area,
    },
    outdoor: derived.outdoor.map((o) => {
      const pool = pools.get(o.id);
      return {
        type: o.type,
        role: o.role,
        covered: o.covered,
        polygon: poly(rectToPolygon(pool ? pool.outer : o.rect)),
        posts: o.posts.map(pt),
        postSize: o.postSize,
        water: pool ? poly(rectToPolygon(pool.water)) : null,
      };
    }),
    access: [analysis.access.driveApron, analysis.access.driveVerge, analysis.access.walkApron, analysis.access.walkVerge].filter((p) => p.length).map(poly),
    paved: model.paved.map((p) => ({ kind: p.kind, polygon: poly(p.polygon) })),
    beds: model.beds.map((b) => ({ kind: b.kind, polygon: poly(b.polygon) })),
    hedges: site.hedges.map((h) => ({ width: h.width, path: poly(h.path) })),
    fences: placed.fences.map((f) => ({ kind: f.kind, parts: f.parts.map(poly), posts: f.posts.map(pt), postSize: f.postSize ?? null })),
    gates: placed.gates.map((g) => ({
      kind: g.kind, leaf: poly(g.leafPolygon), posts: g.posts.map(pt), postSize: g.postSize,
      park: g.park ? poly(g.park.polygon) : null,
      parkLine: g.park ? [pt(g.park.from), pt(g.park.to)] : null,
      inward: [Math.round(g.inward[0] * 1e4) / 1e4, Math.round(g.inward[1] * 1e4) / 1e4],
      swing: g.swing ? { hinge: pt(g.swing.hinge), open: pt(g.swing.openEnd), arc: poly(g.swing.arc) } : null,
    })),
    pillars: placed.pillars.map((p) => ({ footprint: poly(p.footprint) })),
    tank: model.rainwater ? { pos: pt(model.rainwater.tank.pos), diameter: model.rainwater.tank.diameter } : null,
    trees: model.trees.map((tr) => ({ pos: pt(tr.pos), crown: tr.crown, feature: tr.height === tallest, name: model.species[tr.species].name })),
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
      pavedArea: st.pavedArea, pavedRatio: st.pavedRatio, waterArea: st.waterArea, waterRatio: st.waterRatio, greenArea: st.greenArea, greenRatio: st.greenRatio,
    },
    ground: {
      zMin: t.zMin, zMax: t.zMax, slopeMeanPct: t.slope.slopeMeanPct, slopeMaxPct: t.slope.slopeMaxPct,
      cut: t.cutFill.cut, fill: t.cutFill.fill, maxDepth: Math.max(t.cutFill.maxCut, t.cutFill.maxFill),
    },
    presets,
    counts: { trees: model.trees.length, shrubs: model.shrubs.length },
  };
}
