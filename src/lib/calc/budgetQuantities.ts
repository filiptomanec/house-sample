// Bill of quantities from the model: turns the house (geometry, derived data) and the plot into the named quantities of
// `QUANTITY_DEFS`. The only part of the budget that needs the plot model; the page runs it on the server and hands the
// numbers to the client. Contract: docs/CALC-API.md, section 8.1.
import type { FloorKind, OpeningKind, Metrics, Derived, House, RoomType } from "@/lib/model/types";
import { DIR_AZIMUTH } from "@/lib/model/catalog";
import { inRect, unionOf, type Rect } from "@/lib/model/geom";
import { roofIntegrals } from "@/lib/model/metrics";
import { analyzeSite, dist, nearestOnSegment, polygonArea, polylineLength, type HouseInput, type Site, type XY } from "@/lib/model/site";
import { pvQuantities, zeroQuantities, type PvChoice, type Quantities, type QuantityKey } from "./budgetCore";
import { heatedRegion } from "./heatedRegion";

const sum = (xs: readonly number[]): number => xs.reduce((a, b) => a + b, 0);

/** Room types whose walls are tiled (bath, wc): they are counted in `wetWallArea` instead of `plasterArea`. */
const WET_ROOM_TYPES: readonly RoomType[] = ["bath", "wc"];
/** Furniture types that are sanitary fixtures, and the types that make up the kitchen. Types of the furniture catalogue, never ids. */
const FIXTURE_TYPES: readonly string[] = ["wc", "sink", "sink2", "shower", "bath"];
const KITCHEN_TYPES: readonly string[] = ["kitchenLine", "island"];
/** The furniture type that makes a kitchen (the built-in appliances are priced once per kitchen). */
const KITCHEN_RUN_TYPE = "kitchenLine";
/** Opening kinds that get a linear drain when they open at grade onto an uncovered area. */
const DRAIN_OPENING_KINDS: readonly OpeningKind[] = ["slider", "garage", "entry"];
/** How far outside the wall axis the ground in front of an opening is probed for a roof over it, m (beyond half a wall). */
const DRAIN_PROBE = 0.35;
/** Step of the sampling along the edges of covered outdoor areas (beams), m. */
const BEAM_STEP = 0.05;

const opKey = (kind: OpeningKind, field: "count" | "area"): QuantityKey => `${kind}.${field}`;
const floorKey = (finish: FloorKind): QuantityKey => `floorArea.${finish}`;

/**
 * All quantities of the model, keyed by `QUANTITY_KEYS`. Pure and deterministic. Guaranteed (tested):
 *  - `floorAreaHeated + floorAreaUnheated = floorAreaTotal`; `Σ floorArea.<finish> <= floorAreaTotal`; `footprintArea >= floorAreaTotal`;
 *  - `extWallAreaGross - extWallAreaOpaque` = the area of the openings in exterior walls;
 *  - the roof edge lengths agree with an independent walk over `derived.roofPlanes` (eave once, ridge/hip/valley halved);
 *  - `roofAreaSloped` = Σ face areas, `roofAreaSloped >= roofAreaPlan`;
 *  - `builtUpArea + hardSurfaceArea + waterArea + greenArea = plotArea`; `fence.street.length + fence.boundary.length = fenceLength`
 *    = `fence.plinth.length + fence.panel.length`; `door.inside.count + door.toUnheated.count = door.count`;
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
  // the insulated ceiling under a cold attic covers the heated region to the outer face, as the ceiling row of the energy balance
  q.ceilingAreaHeated = derived.topEnvelope === "ceiling" ? heatedRegion(derived).area : 0;
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

  // walls to unheated rooms get their own assembly (and quantity) when the model has one
  const ownAssembly = house.assemblies.wallToUnheated !== undefined;
  const boundary = derived.walls.filter((w) => w.toUnheated === true);
  const doorsIn = (walls: readonly { id: string }[]): number => sum(derived.openings.filter((o) => o.exterior === false && walls.some((w) => w.id === o.wallId)).map((o) => o.area));
  q.unheatedPartitionArea = Math.max(0, sum(boundary.map((w) => w.len)) * clear - doorsIn(boundary));
  const boundaryIds = new Set(boundary.map((w) => w.id));
  q["door.toUnheated.count"] = derived.openings.filter((o) => o.kind === "door" && o.exterior === false && o.wallId !== null && boundaryIds.has(o.wallId)).length;
  for (const [kind, lengthKey, areaKey] of [
    ["bearing", "bearingWallLength", "bearingWallArea"],
    ["partition", "partitionWallLength", "partitionWallArea"],
  ] as const) {
    const walls = derived.walls.filter((w) => !w.ext && w.kind === kind);
    q[lengthKey] = sum(walls.map((w) => w.len));
    const own = ownAssembly ? walls.filter((w) => w.toUnheated !== true) : walls;
    q[areaKey] = Math.max(0, sum(own.map((w) => w.len)) * clear - doorsIn(own));
  }

  // surfaces of the rooms: net perimeter of the room x clear height minus its openings
  for (const r of derived.rooms) {
    const wall = Math.max(0, unionOf(r.cleanRects).perimeter * r.height - sum(r.openings.map((id) => openingArea.get(id) ?? 0)));
    q[WET_ROOM_TYPES.includes(r.type) ? "wetWallArea" : "plasterArea"] += wall;
  }

  // ---- openings
  for (const o of derived.openings) {
    q[opKey(o.kind, "count")] += 1;
    if (o.kind === "door" && !(o.exterior === false && o.wallId !== null && boundaryIds.has(o.wallId))) q["door.inside.count"] += 1;
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
  q.roofInsulationArea = derived.topEnvelope === "roof" ? ri.roofAreaOverFootprint : 0;
  q.soffitArea = Math.max(0, q.roofAreaPlan - q.footprintArea);
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
  q["heatPump.count"] = heating.type.endsWith("heat-pump") ? 1 : 0;
  q.sanitaryFixtureCount = derived.furniture.filter((f) => FIXTURE_TYPES.includes(f.type)).length;
  q.kitchenRunLength = sum(derived.furniture.filter((f) => KITCHEN_TYPES.includes(f.type)).map((f) => Math.max(f.w, f.d)));
  q["kitchen.count"] = derived.furniture.some((f) => f.type === KITCHEN_RUN_TYPE) ? 1 : 0;

  // ---- outdoor areas of the house model
  const outline = derived.outline.rects as Rect[];
  for (const o of derived.outdoor) {
    if (o.type === "terrace") q[o.covered ? "terraceAreaCovered" : "terraceAreaUncovered"] += o.area;
    if (o.covered) q.coveredOutdoorArea += o.area;
    if (o.type === "paving") q.pavingArea += o.area;
    if (o.type === "paving" && !o.covered) q.pavingAreaUncovered += o.area;
    if (o.type === "drive") q.driveArea += o.area;
    if (o.type === "path") q.pathArea += o.area;
    if (o.type === "deck") q["pool.deckArea"] += o.netArea;
    q.postCount += o.posts.length;
    if (o.covered && o.posts.length > 0) q.coveredBeamLength += openEdgeLength(o.rect as Rect, outline);
    if (o.pool) {
      const [x0, y0, x1, y1] = o.pool.water;
      q["pool.count"] += 1;
      q["pool.waterArea"] += o.pool.waterArea;
      q["pool.perimeter"] += 2 * (x1 - x0 + (y1 - y0));
      q["pool.volume"] += o.pool.waterVolume;
    }
  }
  q.screenLength = sum(derived.screens.map((s) => s.length));
  q.screenArea = sum(derived.screens.map((s) => s.length * Math.max(0, s.z1 - s.z0)));
  // linear drains: at-grade doors and sliders whose threshold is not under a roofed outdoor area
  const covered = derived.outdoor.filter((o) => o.covered).map((o) => o.rect as Rect);
  for (const o of exteriorOpenings) {
    if (!DRAIN_OPENING_KINDS.includes(o.kind) || o.sill > 0 || o.dir === null) continue;
    const az = (DIR_AZIMUTH[o.dir] * Math.PI) / 180;
    const probe = house.wall.ext / 2 + DRAIN_PROBE;
    const x = o.cx + Math.sin(az) * probe, y = o.cy + Math.cos(az) * probe;
    if (!covered.some((r) => inRect(r, x, y))) q.linearDrainLength += o.w;
  }

  Object.assign(q, plotQuantities(house, derived, site));

  for (const k of Object.keys(q) as QuantityKey[]) if (!Number.isFinite(q[k]) || q[k] < 0) q[k] = 0;
  return q;
}

const PLOT_KEYS = [
  "plotArea", "builtUpArea", "hardSurfaceArea", "waterArea", "greenArea", "fenceLength", "fence.street.length", "fence.boundary.length",
  "fence.plinth.length", "fence.panel.length", "gateCount",
  "gate.drive.count", "gate.drive.width", "gate.walk.count", "pillar.count", "rainTank.count", "site.pavedArea", "site.gravelArea", "hedgeLength",
  "treeCount", "treeUplight.count", "shrubCount", "earthworkCutVolume", "earthworkFillVolume",
] as const satisfies readonly QuantityKey[];
type PlotKeys = (typeof PLOT_KEYS)[number];

/**
 * Length of the edges of a rectangle that do not lie against the outline: sampled along each edge, a sample counts when the point
 * just outside the rectangle there is not inside the outline. For a covered outdoor area, the beams of its roof edge.
 */
function openEdgeLength(rect: Rect, outline: readonly Rect[]): number {
  const [x0, y0, x1, y1] = rect;
  const edges: { a: XY; b: XY; out: XY }[] = [
    { a: [x0, y0], b: [x1, y0], out: [0, -1] },
    { a: [x1, y0], b: [x1, y1], out: [1, 0] },
    { a: [x1, y1], b: [x0, y1], out: [0, 1] },
    { a: [x0, y1], b: [x0, y0], out: [-1, 0] },
  ];
  let open = 0;
  for (const e of edges) {
    const len = dist(e.a, e.b);
    const n = Math.max(1, Math.round(len / BEAM_STEP));
    for (let i = 0; i < n; i++) {
      const t = (i + 0.5) / n;
      const x = e.a[0] + (e.b[0] - e.a[0]) * t + e.out[0] * BEAM_STEP, y = e.a[1] + (e.b[1] - e.a[1]) * t + e.out[1] * BEAM_STEP;
      if (!outline.some((r) => inRect(r, x, y))) open += len / n;
    }
  }
  return open;
}

/** Index of the plot edge nearest to a point (edge i runs from vertex i to vertex i + 1). */
function nearestEdge(plot: readonly XY[], p: XY): number {
  let best = 0, bestD = Infinity;
  for (let i = 0; i < plot.length; i++) {
    const d = dist(p, nearestOnSegment(p, plot[i], plot[(i + 1) % plot.length]));
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

/** The plot part of the quantities: areas by use, fences, gates and the pillar, the tank, planting and the grading volumes. */
function plotQuantities(house: House, derived: Derived, site: Site): Pick<Quantities, PlotKeys> {
  const footprint = derived.outline.polygons[0]?.pts;
  const none = Object.fromEntries(PLOT_KEYS.map((k) => [k, 0])) as Pick<Quantities, PlotKeys>;
  if (!footprint) return none;
  const input: HouseInput = {
    bearingDeg: house.location.houseAxisBearingDeg,
    footprint: footprint as XY[],
    outdoor: house.outdoor,
    roofs: house.roofs,
    openings: derived.openings,
  };
  // the plot graded with the house's slabs, whatever terrain the caller built the site with (the earthworks are the grading)
  const placed = site.withHouse(house.outdoor);
  const a = analyzeSite(site.model, input, placed.terrain);
  const streetEdge = site.model.street.edge;
  let fence = 0, street = 0, plinth = 0;
  for (const f of placed.fences) {
    const onPlinth = (f.plinthHeight ?? 0) > 0;
    for (const part of f.parts) {
      for (let i = 0; i + 1 < part.length; i++) {
        const len = dist(part[i], part[i + 1]);
        const mid: XY = [(part[i][0] + part[i + 1][0]) / 2, (part[i][1] + part[i + 1][1]) / 2];
        fence += len;
        if (onPlinth) plinth += len;
        if (nearestEdge(site.plot, mid) === streetEdge) street += len;
      }
    }
  }
  const drive = placed.gates.filter((g) => g.access === "driveway");
  const walk = placed.gates.filter((g) => g.access === "walkway");
  const gravelBeds = sum(site.model.beds.filter((b) => b.kind === "gravel").map((b) => polygonArea(b.polygon as XY[])));
  const gravelPaved = sum(site.model.paved.filter((p) => p.surface === "gravel").map((p) => polygonArea(p.polygon as XY[])));
  return {
    plotArea: a.stats.plotArea,
    builtUpArea: a.stats.builtUpArea,
    hardSurfaceArea: a.stats.pavedArea,
    waterArea: a.stats.waterArea,
    greenArea: a.stats.greenArea,
    fenceLength: fence,
    "fence.street.length": street,
    "fence.boundary.length": fence - street,
    "fence.plinth.length": plinth,
    "fence.panel.length": fence - plinth,
    gateCount: drive.length + walk.length,
    "gate.drive.count": drive.length,
    "gate.drive.width": sum(drive.map((g) => g.leaf)),
    "gate.walk.count": walk.length,
    "pillar.count": placed.pillars.length,
    "rainTank.count": site.model.rainwater?.tank ? 1 : 0,
    "site.pavedArea": Math.max(0, sum(Object.values(a.stats.byPavedKind)) - gravelPaved),
    "site.gravelArea": gravelBeds + gravelPaved,
    hedgeLength: sum(site.hedges.map((h) => polylineLength(h.path))),
    treeCount: site.model.trees.length,
    "treeUplight.count": site.model.trees.filter((t) => t.uplight === true).length,
    shrubCount: site.model.shrubs.length,
    earthworkCutVolume: a.terrain.cutFill.cut,
    earthworkFillVolume: a.terrain.cutFill.fill,
  };
}
