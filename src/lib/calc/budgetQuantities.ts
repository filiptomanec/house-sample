// Bill of quantities from the model: turns the house (geometry, derived data) and the plot into the named quantities of
// `QUANTITY_DEFS`. The only part of the budget that needs the plot model; the page runs it on the server and hands the
// numbers to the client. Contract: docs/CALC-API.md, section 8.1.
import type { FloorKind, OpeningKind, Metrics, Derived, House, RoomType } from "@/lib/model/types";
import { unionOf } from "@/lib/model/geom";
import { roofIntegrals } from "@/lib/model/metrics";
import { analyzeSite, pathAlongPlot, polylineLength, projectToPolyline, type HouseInput, type Site, type XY } from "@/lib/model/site";
import { pvQuantities, zeroQuantities, type PvChoice, type Quantities, type QuantityKey } from "./budgetCore";

const sum = (xs: readonly number[]): number => xs.reduce((a, b) => a + b, 0);

/** Room types whose walls are tiled (bath, wc): they are counted in `wetWallArea` instead of `plasterArea`. */
const WET_ROOM_TYPES: readonly RoomType[] = ["bath", "wc"];
/** Furniture types that are sanitary fixtures, and the types that make up the kitchen. Types of the furniture catalogue, never ids. */
const FIXTURE_TYPES: readonly string[] = ["wc", "sink", "sink2", "shower", "bath"];
const KITCHEN_TYPES: readonly string[] = ["kitchenLine", "island"];
/** A gate cuts a fence when the fence passes this close to the gate centre (the rule of `resolveFences` in the site module). */
const GATE_REACH = 0.5;

const opKey = (kind: OpeningKind, field: "count" | "area"): QuantityKey => `${kind}.${field}`;
const floorKey = (finish: FloorKind): QuantityKey => `floorArea.${finish}`;

/**
 * All quantities of the model, keyed by `QUANTITY_KEYS`. Pure and deterministic. Guaranteed (tested):
 *  - `floorAreaHeated + floorAreaUnheated = floorAreaTotal`; `Σ floorArea.<finish> <= floorAreaTotal`; `footprintArea >= floorAreaTotal`;
 *  - `extWallAreaGross - extWallAreaOpaque` = the area of the openings in exterior walls;
 *  - the roof edge lengths agree with an independent walk over `derived.roofPlanes` (eave once, ridge/hip/valley halved);
 *  - `roofAreaSloped` = Σ face areas, `roofAreaSloped >= roofAreaPlan`;
 *  - `builtUpArea + hardSurfaceArea + greenArea = plotArea`;
 *  - every value is finite and >= 0; counts are integers.
 * `pv` replaces the model's own PV count and battery (pass the choice read from storage; `kwp` = panels x module Wp / 1000).
 * `metrics`, when given, supplies the (rounded) roof integrals and the enclosed volume; otherwise they are integrated here.
 */
export function deriveQuantities(house: House, derived: Derived, site: Site, opts: { metrics?: Metrics; pv?: PvChoice } = {}): Quantities {
  const q = zeroQuantities();
  const m = opts.metrics;
  const ri = m ? { roofArea: m.roofArea, roofAreaOverFootprint: m.roofAreaOverFootprint, volume: m.volume } : roofIntegrals(derived);
  const clear = house.clearHeight;

  // ---- plan and volumes
  q.footprintArea = derived.outline.area;
  q.footprintPerimeter = derived.outline.perimeter;
  q.volumeEnclosed = ri.volume;
  q.floorAreaHeated = sum(derived.rooms.filter((r) => r.heated).map((r) => r.area));
  q.floorAreaUnheated = sum(derived.rooms.filter((r) => !r.heated).map((r) => r.area));
  q.floorAreaTotal = q.floorAreaHeated + q.floorAreaUnheated;
  q.ceilingArea = q.floorAreaTotal;
  for (const r of derived.rooms) if (r.floor) q[floorKey(r.floor)] += r.area;

  // ---- walls
  const openingArea = new Map(derived.openings.map((o) => [o.id, o.area]));
  const exteriorOpenings = derived.openings.filter((o) => o.exterior === true);
  const ext = derived.walls.filter((w) => w.ext);
  q.extWallLength = sum(ext.map((w) => w.len));
  // the outline perimeter is the outer face; it is shared out to the walls in proportion to their axis length
  q.extWallAreaGross = q.extWallLength > 0 ? sum(ext.map((w) => (w.len / q.extWallLength) * q.footprintPerimeter * (w.height ?? derived.defaultWallTop))) : 0;
  q.extWallAreaOpaque = Math.max(0, q.extWallAreaGross - sum(exteriorOpenings.map((o) => o.area)));

  const wallById = new Map(derived.walls.map((w) => [w.id, w]));
  const wallHeight = (id: string): number => wallById.get(id)?.height ?? derived.defaultWallTop;
  let woodOnFacade = 0;
  for (const a of derived.accents) {
    if (a.wallId === null) continue;
    const area = a.w * wallHeight(a.wallId);
    q.woodCladdingArea += area;
    if (a.exterior === true) woodOnFacade += area;
  }
  q.facadeRenderArea = Math.max(0, q.extWallAreaOpaque - woodOnFacade);

  for (const [kind, lengthKey, areaKey] of [
    ["bearing", "bearingWallLength", "bearingWallArea"],
    ["partition", "partitionWallLength", "partitionWallArea"],
  ] as const) {
    q[lengthKey] = sum(derived.walls.filter((w) => !w.ext && w.kind === kind).map((w) => w.len));
    const doors = sum(derived.openings.filter((o) => o.exterior === false && o.wallKind === kind).map((o) => o.area));
    q[areaKey] = Math.max(0, q[lengthKey] * clear - doors);
  }

  // surfaces of the rooms: net perimeter of the room x clear height minus its openings
  for (const r of derived.rooms) {
    const wall = Math.max(0, unionOf(r.cleanRects).perimeter * r.height - sum(r.openings.map((id) => openingArea.get(id) ?? 0)));
    q[WET_ROOM_TYPES.includes(r.type) ? "wetWallArea" : "plasterArea"] += wall;
  }

  // ---- openings
  for (const o of derived.openings) {
    q[opKey(o.kind, "count")] += 1;
    q[opKey(o.kind, "area")] += o.area;
    if (o.kind === "window" && o.exterior === true && o.sill > 0) q.windowSillLength += o.w;
    if (o.blind) {
      q["blind.count"] += 1;
      q["blind.area"] += o.glazingArea;
      q["blind.boxLength"] += o.w;
    }
  }

  // ---- roof (an edge shared by two faces is on both, so ridges, hips and valleys are halved)
  q.roofAreaSloped = ri.roofArea;
  q.roofAreaPlan = sum(derived.roofPlanes.map((f) => f.planArea));
  q.roofAreaOverFootprint = ri.roofAreaOverFootprint;
  const edge = (kind: string): number => sum(derived.roofPlanes.flatMap((f) => f.edges.filter((e) => e.kind === kind).map((e) => e.length)));
  q.eaveLength = edge("eave");
  q.ridgeLength = edge("ridge") / 2;
  q.hipLength = edge("hip") / 2;
  q.valleyLength = edge("valley") / 2;
  q.gutterLength = q.eaveLength;
  q["downpipe.count"] = house.roof.downpipes.length;
  q["lightpipe.count"] = derived.lightpipes.length;
  const guarded = house.roof.snowGuards.aboveOpeningKinds as readonly string[];
  q.snowGuardLength = sum(exteriorOpenings.filter((o) => guarded.includes(o.kind)).map((o) => o.w));

  // ---- equipment and fittings
  Object.assign(q, pvQuantities(house, derived.pv, opts.pv));
  const heating = house.equipment.heating;
  q["heatPump.kw"] = heating.type.endsWith("heat-pump") ? heating.ratedPowerKw : 0;
  q.sanitaryFixtureCount = derived.furniture.filter((f) => FIXTURE_TYPES.includes(f.type)).length;
  q.kitchenRunLength = sum(derived.furniture.filter((f) => KITCHEN_TYPES.includes(f.type)).map((f) => Math.max(f.w, f.d)));

  // ---- outdoor areas of the house model
  for (const o of derived.outdoor) {
    if (o.type === "terrace") q[o.covered ? "terraceAreaCovered" : "terraceAreaUncovered"] += o.area;
    if (o.covered) q.coveredOutdoorArea += o.area;
    if (o.type === "paving") q.pavingArea += o.area;
    if (o.type === "drive") q.driveArea += o.area;
    if (o.type === "path") q.pathArea += o.area;
    q.postCount += o.posts.length;
  }
  q.screenLength = sum(derived.screens.map((s) => s.length));

  Object.assign(q, plotQuantities(house, derived, site));

  for (const k of Object.keys(q) as QuantityKey[]) if (!Number.isFinite(q[k]) || q[k] < 0) q[k] = 0;
  return q;
}

type PlotKeys = "plotArea" | "builtUpArea" | "hardSurfaceArea" | "greenArea" | "fenceLength" | "gateCount" | "hedgeLength" | "treeCount" | "shrubCount" | "earthworkCutVolume" | "earthworkFillVolume";

/** The plot part of the quantities: areas by use, fences and gates, planting and the grading volumes. */
function plotQuantities(house: House, derived: Derived, site: Site): Pick<Quantities, PlotKeys> {
  const footprint = derived.outline.polygons[0]?.pts;
  const none = { plotArea: 0, builtUpArea: 0, hardSurfaceArea: 0, greenArea: 0, fenceLength: 0, gateCount: 0, hedgeLength: 0, treeCount: 0, shrubCount: 0, earthworkCutVolume: 0, earthworkFillVolume: 0 };
  if (!footprint) return none;
  const input: HouseInput = {
    bearingDeg: house.location.houseAxisBearingDeg,
    footprint: footprint as XY[],
    outdoor: house.outdoor,
    roofs: house.roofs,
    openings: derived.openings,
  };
  const a = analyzeSite(site.model, input, site.terrain);
  const placed = site.withHouse(house.outdoor);
  const gates = [placed.access.driveGate, placed.access.walkGate];
  const cut = new Set<number>();
  for (const f of site.model.fences) {
    if (!f.gates) continue;
    const path = pathAlongPlot(site.plot, f.inset, f.from, f.to);
    gates.forEach((g, i) => {
      if (projectToPolyline(g.center, path).d < GATE_REACH + f.inset) cut.add(i);
    });
  }
  return {
    plotArea: a.stats.plotArea,
    builtUpArea: a.stats.builtUpArea,
    hardSurfaceArea: a.stats.pavedArea,
    greenArea: a.stats.greenArea,
    fenceLength: sum(placed.fences.flatMap((f) => f.parts.map((p) => polylineLength(p)))),
    gateCount: cut.size,
    hedgeLength: sum(site.hedges.map((h) => polylineLength(h.path))),
    treeCount: site.model.trees.length,
    shrubCount: site.model.shrubs.length,
    earthworkCutVolume: a.terrain.cutFill.cut,
    earthworkFillVolume: a.terrain.cutFill.fill,
  };
}
