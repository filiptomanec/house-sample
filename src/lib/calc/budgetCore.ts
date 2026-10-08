// Bill of quantities and indicative budget, part 1: everything that does not need the plot model, so a client component can
// import it without pulling the site code into its bundle. `budget.ts` re-exports this module and adds `deriveQuantities`.
//
// `model/pricebook.json` says which quantity each priced line uses and at what unit price; `computeBudget` adds reserve and
// VAT and applies the visitor's edits. No three.js, no text (names are bilingual data in the price book, labels of the CSV
// are passed in), no house numbers: quantities come from the geometry, prices from the book.
//
// Contract: docs/CALC-API.md, section 8.
import pricebookJson from "@model/pricebook.json";
import type { House, LocalizedText } from "@/lib/model/types";

// ================================================================================================ quantities

/** Units of price lines. The page translates the keys (`budget.units.<key>`). */
export const UNIT_KEYS = ["m2", "m", "m3", "pcs", "set", "kwp", "kwh", "kw"] as const;
export type UnitKey = (typeof UNIT_KEYS)[number];

interface QuantityDef {
  unit: UnitKey;
  /** What it is, exactly (English, for developers; not shown to visitors). */
  doc: string;
}

/**
 * Every quantity `deriveQuantities` returns, with its unit and exact definition. A price line refers to one of these keys.
 * All values are >= 0 and finite; a quantity that does not apply to the model (no garage, no fence) is 0, never missing.
 * Heights come from the model (`clearHeight`, wall heights), never from constants. Areas are net of the stated openings.
 */
export const QUANTITY_DEFS = {
  // ---- plan and volumes
  footprintArea: { unit: "m2", doc: "Area of the building outline including the walls (derived.outline.area)." },
  footprintPerimeter: { unit: "m", doc: "Outer perimeter of the outline (derived.outline.perimeter)." },
  floorAreaHeated: { unit: "m2", doc: "Sum of the net areas of heated rooms (metrics.heated.floorArea)." },
  floorAreaUnheated: { unit: "m2", doc: "Sum of the net areas of unheated rooms (the garage)." },
  floorAreaTotal: { unit: "m2", doc: "Sum of the net areas of all rooms = heated + unheated." },
  volumeEnclosed: { unit: "m3", doc: "Enclosed volume, floor to roof surface over the outline (metrics.volume)." },
  "floorArea.oak": { unit: "m2", doc: "Net area of rooms whose floor finish is oak." },
  "floorArea.tile": { unit: "m2", doc: "Net area of rooms whose floor finish is tile." },
  "floorArea.concrete": { unit: "m2", doc: "Net area of rooms whose floor finish is concrete." },
  "floorArea.stone": { unit: "m2", doc: "Net area of rooms whose floor finish is stone." },
  // ---- walls and surfaces
  extWallLength: { unit: "m", doc: "Axis length of exterior walls." },
  extWallAreaGross: { unit: "m2", doc: "Outer face of the exterior walls: outer length (outline perimeter shared out to the walls by axis length) x wall height." },
  extWallAreaOpaque: { unit: "m2", doc: "extWallAreaGross minus every opening (window, slider, entry door, garage door, door) in an exterior wall." },
  facadeRenderArea: { unit: "m2", doc: "Insulated and rendered facade: extWallAreaOpaque minus woodCladdingArea, never negative." },
  bearingWallLength: { unit: "m", doc: "Axis length of bearing interior walls." },
  partitionWallLength: { unit: "m", doc: "Axis length of partition walls." },
  bearingWallArea: { unit: "m2", doc: "Bearing interior walls: axis length x clear height, minus interior doors; without the walls to unheated rooms when the house has assemblies.wallToUnheated (those are unheatedPartitionArea)." },
  partitionWallArea: { unit: "m2", doc: "Partition walls: axis length x clear height, minus interior doors." },
  plasterArea: { unit: "m2", doc: "Interior wall surfaces of rooms except wet rooms: net room perimeter x clear height minus openings of the room." },
  wetWallArea: { unit: "m2", doc: "Interior wall surfaces of wet rooms (bath, wc), same rule as plasterArea. Partial tiling is a factor in the price line." },
  ceilingArea: { unit: "m2", doc: "Ceiling area = floorAreaTotal." },
  ceilingAreaHeated: { unit: "m2", doc: "Insulated ceiling under a cold attic (derived.topEnvelope 'ceiling'): the heated part of the plan to the outer face (heatedRegion, the area of metrics.heatedAreaGross and of the energy balance's ceiling row); 0 under a warm roof." },
  unheatedPartitionArea: { unit: "m2", doc: "Walls between a heated and an unheated room (derived.walls[].toUnheated, the wall to the garage): axis length x clear height minus their doors (metrics.unheatedBoundary.wallArea)." },
  woodCladdingArea: { unit: "m2", doc: "Timber cladding strips (derived.accents): strip width x height of the wall they sit on." },
  // ---- openings (count and area per kind; area = width x (head - sill))
  "window.count": { unit: "pcs", doc: "Number of windows." },
  "window.area": { unit: "m2", doc: "Area of windows." },
  "door.count": { unit: "pcs", doc: "Number of interior doors (door.inside.count + door.toUnheated.count)." },
  "door.area": { unit: "m2", doc: "Area of interior doors." },
  "entry.count": { unit: "pcs", doc: "Number of entrance doors." },
  "entry.area": { unit: "m2", doc: "Area of entrance doors." },
  "garage.count": { unit: "pcs", doc: "Number of garage doors." },
  "garage.area": { unit: "m2", doc: "Area of garage doors." },
  "slider.count": { unit: "pcs", doc: "Number of sliding walls." },
  "slider.area": { unit: "m2", doc: "Area of sliding walls." },
  "door.inside.count": { unit: "pcs", doc: "Interior doors between two heated rooms or two unheated rooms: door.count minus door.toUnheated.count." },
  "door.toUnheated.count": { unit: "pcs", doc: "Interior doors in a wall between a heated and an unheated room (derived.walls[].toUnheated: the fire-rated door to the garage)." },
  windowSillLength: { unit: "m", doc: "Sum of the widths of exterior windows that have a sill height above 0 (sills inside and outside)." },
  "blind.count": { unit: "pcs", doc: "Number of openings that get an external blind (derived.openings[].blind)." },
  "blind.area": { unit: "m2", doc: "Glazing area of those openings (facings[*].blindedGlazingArea summed)." },
  "blind.boxLength": { unit: "m", doc: "Sum of the widths of those openings (length of blind boxes)." },
  // ---- roof
  roofAreaSloped: { unit: "m2", doc: "Sloped area of all roof faces including overhangs (metrics.roofArea)." },
  roofAreaPlan: { unit: "m2", doc: "Plan (horizontal) area of all roof faces including overhangs." },
  roofAreaOverFootprint: { unit: "m2", doc: "Sloped roof area over the outline only (metrics.roofAreaOverFootprint)." },
  roofInsulationArea: { unit: "m2", doc: "Insulated roof of a warm roof (derived.topEnvelope 'roof'): roofAreaOverFootprint; 0 over a cold attic (its insulation is ceilingAreaHeated)." },
  soffitArea: { unit: "m2", doc: "Soffits: plan area of the roof faces outside the outline (eaves, the covered terrace and porch) = roofAreaPlan - footprintArea." },
  eaveLength: { unit: "m", doc: "Total length of edges of kind eave (each is on one face only)." },
  ridgeLength: { unit: "m", doc: "Total length of ridges: the sum over faces of edges of kind ridge, halved (two faces share a ridge)." },
  hipLength: { unit: "m", doc: "Total length of hips: sum over faces of edges of kind hip, halved." },
  valleyLength: { unit: "m", doc: "Total length of valleys: sum over faces of edges of kind valley, halved." },
  gutterLength: { unit: "m", doc: "Length of gutters = eaveLength." },
  "downpipe.count": { unit: "pcs", doc: "Number of downpipes (house.roof.downpipes)." },
  "lightpipe.count": { unit: "pcs", doc: "Number of light pipes (derived.lightpipes)." },
  snowGuardLength: { unit: "m", doc: "Sum of the widths of exterior openings of the kinds in house.roof.snowGuards.aboveOpeningKinds." },
  // ---- equipment and fittings
  "pv.count": { unit: "pcs", doc: "PV modules: derived.pv.count, or the chosen number when `pv` is passed to deriveQuantities." },
  "pv.kwp": { unit: "kwp", doc: "Installed PV power: count x module Wp / 1000." },
  "inverter.kw": { unit: "kw", doc: "Rated power of the inverter (equipment.pv.inverter.ratedKw), 0 when there are no modules." },
  "battery.kwh": { unit: "kwh", doc: "Nominal capacity of the default battery option, or of the chosen one when `pv` is passed." },
  "heatPump.kw": { unit: "kw", doc: "Rated power of the heating source when it is a heat pump (equipment.heating.ratedPowerKw), else 0." },
  "heatPump.count": { unit: "set", doc: "1 when the heating source is a heat pump (equipment.heating.type), else 0: the heat pump is priced as a set." },
  sanitaryFixtureCount: { unit: "pcs", doc: "Furniture items of the types wc, sink, sink2, shower and bath (derived.furniture)." },
  kitchenRunLength: { unit: "m", doc: "Length of the kitchen: the long side of every furniture item of the types kitchenLine and island." },
  "kitchen.count": { unit: "set", doc: "1 when the furniture holds a kitchen (an item of the type kitchenLine), else 0: the built-in appliances are priced per kitchen." },
  // ---- outdoor areas of the house model
  terraceAreaCovered: { unit: "m2", doc: "Terraces under a roof (outdoor type terrace, covered)." },
  terraceAreaUncovered: { unit: "m2", doc: "Terraces without a roof." },
  coveredOutdoorArea: { unit: "m2", doc: "Floor of every roofed outdoor area, whatever its type (covered terrace, covered paving)." },
  pavingArea: { unit: "m2", doc: "Outdoor type paving." },
  pavingAreaUncovered: { unit: "m2", doc: "Outdoor type paving without a roof (the covered porch is in coveredOutdoorArea)." },
  driveArea: { unit: "m2", doc: "Outdoor type drive." },
  pathArea: { unit: "m2", doc: "Outdoor type path." },
  postCount: { unit: "pcs", doc: "Posts of covered outdoor areas (derived.outdoor[].posts)." },
  coveredBeamLength: { unit: "m", doc: "Beams of roofed outdoor areas with posts: the edges of their rectangles that do not lie against the outline (from post to post and from a post to the wall)." },
  screenLength: { unit: "m", doc: "Length of the louvre walls (derived.screens[].length)." },
  screenArea: { unit: "m2", doc: "Louvre walls: length x height between their rails (derived.screens[], z1 - z0)." },
  linearDrainLength: { unit: "m", doc: "Linear drains in front of exterior sliders, garage and entrance doors at grade (sill 0) that open onto an uncovered area: the sum of their widths." },
  "pool.count": { unit: "pcs", doc: "Pools (outdoor areas with pool data, derived.outdoor[].pool)." },
  "pool.waterArea": { unit: "m2", doc: "Water surface of the pools (derived.outdoor[].pool.waterArea)." },
  "pool.perimeter": { unit: "m", doc: "Perimeter of the water surface of the pools (the inner edge of the coping)." },
  "pool.volume": { unit: "m3", doc: "Water volume of the pools (derived.outdoor[].pool.waterVolume)." },
  "pool.deckArea": { unit: "m2", doc: "Outdoor type deck (the timber deck round the pool), net of the pool and its coping (derived.outdoor[].netArea)." },
  // ---- plot (from the site model, analyzeSite)
  plotArea: { unit: "m2", doc: "Area of the plot." },
  builtUpArea: { unit: "m2", doc: "Footprint plus roofed outdoor areas outside the outline (PlotStats built-up)." },
  hardSurfaceArea: { unit: "m2", doc: "Uncovered hard surfaces on the plot: outdoor terrace/paving/drive/path/deck and the pool coping, site pavings and aprons (PlotStats paved)." },
  waterArea: { unit: "m2", doc: "Water surfaces on the plot (PlotStats water: the pools)." },
  greenArea: { unit: "m2", doc: "The rest of the plot: lawn, beds, planting (PlotStats green); builtUp + hard + water + green = plot." },
  fenceLength: { unit: "m", doc: "Length of fences without the openings for gates and pillars (site.withHouse().fences[].parts)." },
  "fence.street.length": { unit: "m", doc: "Part of fenceLength along the street edge of the plot (site.json street.edge)." },
  "fence.boundary.length": { unit: "m", doc: "Part of fenceLength along the other edges (neighbours, field) = fenceLength - fence.street.length." },
  "fence.plinth.length": { unit: "m", doc: "Part of fenceLength that stands on a plinth (resolved fences with plinthHeight > 0, the slat fence)." },
  "fence.panel.length": { unit: "m", doc: "Part of fenceLength without a plinth (panels on posts only) = fenceLength - fence.plinth.length." },
  gateCount: { unit: "pcs", doc: "Gates of the plot (site.withHouse().gates): gate.drive.count + gate.walk.count." },
  "gate.drive.count": { unit: "pcs", doc: "Gates of the driveway (site.json gates with access 'driveway')." },
  "gate.drive.width": { unit: "m", doc: "Clear width of the driveway gates (their leaf)." },
  "gate.walk.count": { unit: "pcs", doc: "Gates of the walkway (site.json gates with access 'walkway')." },
  "pillar.count": { unit: "pcs", doc: "Utility pillars on the boundary (site.withHouse().pillars)." },
  "rainTank.count": { unit: "pcs", doc: "Rainwater tanks (site.json rainwater.tank): 1 or 0." },
  "site.pavedArea": { unit: "m2", doc: "The plot's own paved surfaces inside the plot (PlotStats byPavedKind: site.json paved such as the service path and the bin store, and the gate aprons up to the boundary), without the gravel ones." },
  "site.gravelArea": { unit: "m2", doc: "Gravel surfaces of the plot: site.json beds of kind gravel and paved surfaces with surface gravel." },
  hedgeLength: { unit: "m", doc: "Length of hedges." },
  treeCount: { unit: "pcs", doc: "Existing and planted trees of the site model." },
  "treeUplight.count": { unit: "pcs", doc: "Trees with a garden uplight (site.json trees[].uplight)." },
  shrubCount: { unit: "pcs", doc: "Shrubs of the site model." },
  earthworkCutVolume: { unit: "m3", doc: "Cut volume of the grading with the house's slabs (cutFillVolume of the graded terrain against the natural ground)." },
  earthworkFillVolume: { unit: "m3", doc: "Fill volume of the same grading." },
} as const satisfies Record<string, QuantityDef>;

export type QuantityKey = keyof typeof QUANTITY_DEFS;
export const QUANTITY_KEYS = Object.keys(QUANTITY_DEFS) as QuantityKey[];
export type Quantities = Record<QuantityKey, number>;

/** The quantities that depend on the visitor's PV choice and not on the geometry alone. */
export const PV_QUANTITY_KEYS = ["pv.count", "pv.kwp", "inverter.kw", "battery.kwh"] as const satisfies readonly QuantityKey[];

/** The visitor's PV choice when it differs from the model (Energy page); see `deriveQuantities`. */
export interface PvChoice {
  panelCount: number;
  kwp: number;
  batteryKwh: number;
}

const nonNeg = (v: number): number => (Number.isFinite(v) && v > 0 ? v : 0);

/**
 * The PV and battery quantities (`PV_QUANTITY_KEYS`): the model's own choice, or the visitor's `choice`. The only part of the
 * quantities that changes without the geometry changing, so a page recomputes just these after it has read the choice.
 */
export function pvQuantities(house: Pick<House, "equipment">, derivedPv: { count: number; kwp: number }, choice?: PvChoice): Pick<Quantities, (typeof PV_QUANTITY_KEYS)[number]> {
  const eq = house.equipment;
  const count = choice ? Math.round(nonNeg(choice.panelCount)) : derivedPv.count;
  const kwp = choice ? nonNeg(choice.kwp) : derivedPv.kwp;
  const defaultBattery = eq.battery.options.find((o) => o.id === eq.battery.default)?.capacityKwh ?? 0;
  return {
    "pv.count": count,
    "pv.kwp": kwp,
    "inverter.kw": count > 0 ? eq.pv.inverter.ratedKw : 0,
    "battery.kwh": choice ? nonNeg(choice.batteryKwh) : defaultBattery,
  };
}

/** All quantities set to zero (the starting point of `deriveQuantities`, and a handy empty model for tests). */
export function zeroQuantities(): Quantities {
  return Object.fromEntries(QUANTITY_KEYS.map((k) => [k, 0])) as Quantities;
}

/** A short fingerprint input of the geometry-dependent quantities: rounded to 0.01 so that float noise does not count. */
export function quantityFingerprintParts(q: Quantities): number[] {
  return QUANTITY_KEYS.map((k) => Math.round(q[k] * 100));
}

// ================================================================================================ material take-off

/** One row of the material take-off: a layer of an assembly with the area it covers and its volume. */
export interface MaterialRow {
  /** Key of the assembly in `house.assemblies`. */
  assembly: string;
  /** Layer id (label) and the model's text for it. */
  layerId: string;
  name: LocalizedText;
  role: string | null;
  /** Layer thickness, m, covered area, m2, and volume = thickness x area, m3. */
  thickness: number;
  area: number;
  volume: number;
}

/** Which quantity is the area an assembly covers (layers with the roles below may cover another one). */
const ASSEMBLY_AREA: Record<keyof House["assemblies"], QuantityKey> = {
  exteriorWall: "extWallAreaOpaque",
  bearingWall: "bearingWallArea",
  partitionWall: "partitionWallArea",
  wallToUnheated: "unheatedPartitionArea",
  ceiling: "ceilingArea",
  roof: "roofAreaSloped",
  groundFloor: "footprintArea",
};

/** Layers of the floor on the ground with these roles only cover the net floor (the slab and what is below also run under the walls). */
const NET_FLOOR_ROLES: readonly string[] = ["finish", "screed"];
/** Layers of the roof with these roles stop at the wall line (insulation and lining of a warm roof); the rest runs over the overhangs. */
const ROOF_INNER_ROLES: readonly string[] = ["insulation", "finish"];
/** Layers of the ceiling with these roles lie on the ceiling over the heated rooms only when the attic is cold. */
const CEILING_HEATED_ROLES: readonly string[] = ["insulation", "membrane"];

/** The quantity whose area a layer covers (see `materialTakeoff`). */
function layerArea(house: House, key: keyof House["assemblies"], role: string): QuantityKey {
  if (key === "groundFloor" && NET_FLOOR_ROLES.includes(role)) return "floorAreaTotal";
  if (key === "roof" && ROOF_INNER_ROLES.includes(role)) return "roofAreaOverFootprint";
  if (key === "ceiling" && house.roof.attic === "cold" && CEILING_HEATED_ROLES.includes(role)) return "ceilingAreaHeated";
  return ASSEMBLY_AREA[key];
}

/**
 * Volumes of the layers of the assemblies (`house.assemblies`) times the areas they cover: exteriorWall x extWallAreaOpaque,
 * bearingWall x bearingWallArea, partitionWall x partitionWallArea, wallToUnheated x unheatedPartitionArea (when the model has it),
 * ceiling x ceilingArea (under a cold attic its insulation and membrane x ceilingAreaHeated), roof x roofAreaSloped (it runs over
 * the overhangs; insulation and lining of a warm roof x roofAreaOverFootprint), groundFloor x footprintArea (its finish and screed
 * layers x floorAreaTotal: they stop at the walls). For cards such as "insulation m3" and for checking the price book against
 * the construction. Layers outside a ventilated layer are included (they are built, just not counted in U).
 */
export function materialTakeoff(house: House, quantities: Quantities): MaterialRow[] {
  const rows: MaterialRow[] = [];
  for (const key of Object.keys(ASSEMBLY_AREA) as (keyof House["assemblies"])[]) {
    const assembly = house.assemblies[key];
    if (!assembly) continue;
    for (const layer of assembly.layers) {
      const area = quantities[layerArea(house, key, layer.role ?? "")];
      rows.push({ assembly: key, layerId: layer.id, name: layer.name, role: layer.role ?? null, thickness: layer.t, area, volume: layer.t * area });
    }
  }
  return rows;
}

// ================================================================================================ pricebook.json

/**
 * Types of `model/pricebook.json`. The zod schema (`PricebookSchema`, `parsePricebook`) lives in ./budgetSchema.ts, which this module
 * never imports at run time: the browser bundle then carries no validator. A test checks that parsing the file changes nothing.
 */
export type { PriceGroup, PriceLine, Pricebook, QuantityRule } from "./budgetSchema";
import type { Pricebook, QuantityRule } from "./budgetSchema";

let memo: Pricebook | null = null;
/** The project's own price book (`model/pricebook.json`, imported statically as "@model/pricebook.json"), memoised. */
export function defaultPricebook(): Pricebook {
  memo ??= pricebookJson as unknown as Pricebook; // validated by the tests (budgetSchema.ts), not at run time
  return memo;
}

/** The quantity of a line from its rule: `ref x factor + offset` or the constant; never negative or NaN. */
export function ruleQuantity(rule: QuantityRule, q: Quantities): number {
  if ("value" in rule) return nonNeg(rule.value);
  return nonNeg(q[rule.ref] * (rule.factor ?? 1) + (rule.offset ?? 0));
}

/** The orientation band of the house price, CZK with VAT, for a heated floor area; null when the book has none or the area is 0. */
export function estimateBand(book: Pricebook, floorAreaHeated: number): { low: number; high: number } | null {
  const b = book.benchmark;
  if (!b || !(floorAreaHeated > 0)) return null;
  return { low: b.perM2Low * floorAreaHeated, high: b.perM2High * floorAreaHeated };
}
