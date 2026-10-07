// Bill of quantities and indicative budget, part 1: everything that does not need the plot model, so a client component can
// import it without pulling the site code into its bundle. `budget.ts` re-exports this module and adds `deriveQuantities`.
//
// `model/pricebook.json` says which quantity each priced line uses and at what unit price; `computeBudget` adds reserve and
// VAT and applies the visitor's edits. No three.js, no text (names are bilingual data in the price book, labels of the CSV
// are passed in), no house numbers: quantities come from the geometry, prices from the book.
//
// Contract: docs/CALC-API.md, section 8.
import { z } from "zod";
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
  bearingWallArea: { unit: "m2", doc: "Bearing interior walls: axis length x clear height, minus interior doors." },
  partitionWallArea: { unit: "m2", doc: "Partition walls: axis length x clear height, minus interior doors." },
  plasterArea: { unit: "m2", doc: "Interior wall surfaces of rooms except wet rooms: net room perimeter x clear height minus openings of the room." },
  wetWallArea: { unit: "m2", doc: "Interior wall surfaces of wet rooms (bath, wc), same rule as plasterArea. Partial tiling is a factor in the price line." },
  ceilingArea: { unit: "m2", doc: "Ceiling area = floorAreaTotal." },
  woodCladdingArea: { unit: "m2", doc: "Timber cladding strips (derived.accents): strip width x height of the wall they sit on." },
  // ---- openings (count and area per kind; area = width x (head - sill))
  "window.count": { unit: "pcs", doc: "Number of windows." },
  "window.area": { unit: "m2", doc: "Area of windows." },
  "door.count": { unit: "pcs", doc: "Number of interior doors." },
  "door.area": { unit: "m2", doc: "Area of interior doors." },
  "entry.count": { unit: "pcs", doc: "Number of entrance doors." },
  "entry.area": { unit: "m2", doc: "Area of entrance doors." },
  "garage.count": { unit: "pcs", doc: "Number of garage doors." },
  "garage.area": { unit: "m2", doc: "Area of garage doors." },
  "slider.count": { unit: "pcs", doc: "Number of sliding walls." },
  "slider.area": { unit: "m2", doc: "Area of sliding walls." },
  windowSillLength: { unit: "m", doc: "Sum of the widths of exterior windows that have a sill height above 0 (sills inside and outside)." },
  "blind.count": { unit: "pcs", doc: "Number of openings that get an external blind (derived.openings[].blind)." },
  "blind.area": { unit: "m2", doc: "Glazing area of those openings (facings[*].blindedGlazingArea summed)." },
  "blind.boxLength": { unit: "m", doc: "Sum of the widths of those openings (length of blind boxes)." },
  // ---- roof
  roofAreaSloped: { unit: "m2", doc: "Sloped area of all roof faces including overhangs (metrics.roofArea)." },
  roofAreaPlan: { unit: "m2", doc: "Plan (horizontal) area of all roof faces including overhangs." },
  roofAreaOverFootprint: { unit: "m2", doc: "Sloped roof area over the outline only (metrics.roofAreaOverFootprint)." },
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
  sanitaryFixtureCount: { unit: "pcs", doc: "Furniture items of the types wc, sink, sink2, shower and bath (derived.furniture)." },
  kitchenRunLength: { unit: "m", doc: "Length of the kitchen: the long side of every furniture item of the types kitchenLine and island." },
  // ---- outdoor areas of the house model
  terraceAreaCovered: { unit: "m2", doc: "Terraces under a roof (outdoor type terrace, covered)." },
  terraceAreaUncovered: { unit: "m2", doc: "Terraces without a roof." },
  coveredOutdoorArea: { unit: "m2", doc: "Floor of every roofed outdoor area, whatever its type (covered terrace, covered paving)." },
  pavingArea: { unit: "m2", doc: "Outdoor type paving." },
  driveArea: { unit: "m2", doc: "Outdoor type drive." },
  pathArea: { unit: "m2", doc: "Outdoor type path." },
  postCount: { unit: "pcs", doc: "Posts of covered outdoor areas (derived.outdoor[].posts)." },
  screenLength: { unit: "m", doc: "Length of free-standing slat screens (derived.screens[].length)." },
  // ---- plot (from the site model, analyzeSite)
  plotArea: { unit: "m2", doc: "Area of the plot." },
  builtUpArea: { unit: "m2", doc: "Footprint plus roofed outdoor areas outside the outline (PlotStats built-up)." },
  hardSurfaceArea: { unit: "m2", doc: "Uncovered hard surfaces on the plot: outdoor terrace/paving/drive/path, site pavings and aprons (PlotStats paved)." },
  greenArea: { unit: "m2", doc: "The rest of the plot: lawn, beds, planting (PlotStats green)." },
  fenceLength: { unit: "m", doc: "Length of fences without the gate openings (site.withHouse().fences)." },
  gateCount: { unit: "pcs", doc: "Gates in the fences (vehicle and pedestrian): the access gates that cut a gap into a fence." },
  hedgeLength: { unit: "m", doc: "Length of hedges." },
  treeCount: { unit: "pcs", doc: "Existing and planted trees of the site model." },
  shrubCount: { unit: "pcs", doc: "Shrubs of the site model." },
  earthworkCutVolume: { unit: "m3", doc: "Cut volume of the grading (cutFillVolume)." },
  earthworkFillVolume: { unit: "m3", doc: "Fill volume of the grading." },
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

/** Which quantity is the area an assembly covers. */
const ASSEMBLY_AREA: Record<keyof House["assemblies"], QuantityKey> = {
  exteriorWall: "extWallAreaOpaque",
  bearingWall: "bearingWallArea",
  partitionWall: "partitionWallArea",
  ceiling: "ceilingArea",
  roof: "roofAreaOverFootprint",
  groundFloor: "footprintArea",
};

/** Layers of the floor on the ground with these roles only cover the net floor (the slab and what is below also run under the walls). */
const NET_FLOOR_ROLES: readonly string[] = ["finish", "screed"];

/**
 * Volumes of the layers of the assemblies (`house.assemblies`) times the areas they cover: exteriorWall x extWallAreaOpaque,
 * bearingWall x bearingWallArea, partitionWall x partitionWallArea, ceiling x ceilingArea, roof x roofAreaOverFootprint,
 * groundFloor x footprintArea (its finish and screed layers x floorAreaTotal: they stop at the walls). The covering of the roof
 * (role cladding) x roofAreaSloped: it also runs over the overhangs. For cards such as
 * "insulation m3" and for checking the price book against the construction. Layers outside a ventilated layer are included
 * (they are built, just not counted in U).
 */
export function materialTakeoff(house: House, quantities: Quantities): MaterialRow[] {
  const rows: MaterialRow[] = [];
  for (const key of Object.keys(ASSEMBLY_AREA) as (keyof House["assemblies"])[]) {
    for (const layer of house.assemblies[key].layers) {
      const net = key === "groundFloor" && NET_FLOOR_ROLES.includes(layer.role ?? "");
      // the roof covering also runs over the overhangs, which the insulation under it does not
      const sloped = key === "roof" && layer.role === "cladding";
      const area = quantities[net ? "floorAreaTotal" : sloped ? "roofAreaSloped" : ASSEMBLY_AREA[key]];
      rows.push({ assembly: key, layerId: layer.id, name: layer.name, role: layer.role ?? null, thickness: layer.t, area, volume: layer.t * area });
    }
  }
  return rows;
}

// ================================================================================================ pricebook.json

const share = z.number().min(0).max(1);
const text = z.strictObject({ cs: z.string().min(1), en: z.string().min(1) });
const id = z.string().min(1);

/** Where the quantity of a line comes from: a model quantity (`ref`, scaled by `factor` and shifted by `offset`) or a constant. */
export const QuantityRuleSchema = z.union([
  z.strictObject({ ref: z.enum(QUANTITY_KEYS as [QuantityKey, ...QuantityKey[]]), factor: z.number().min(0).optional(), offset: z.number().optional() }),
  z.strictObject({ value: z.number().min(0) }),
]);
export type QuantityRule = z.infer<typeof QuantityRuleSchema>;

export const PriceLineSchema = z.strictObject({
  /** Stable id; the key of the visitor's edits. A label, never logic. */
  id,
  name: text,
  unit: z.enum(UNIT_KEYS),
  quantity: QuantityRuleSchema,
  /** Unit price in CZK without VAT, >= 0. */
  price: z.number().min(0),
  /**
   * Allowance for offcuts and breakage when the material is ordered (0.1 = 10 %), for the "how much material" cards. The unit
   * price already includes it, so it never changes the amount. A line without `waste` is not listed as a material.
   */
  waste: share.optional(),
  note: text.optional(),
});
export type PriceLine = z.infer<typeof PriceLineSchema>;

export const PriceGroupSchema = z.strictObject({
  id,
  name: text,
  note: text.optional(),
  /** Optional groups can be switched off by the visitor and are not part of the house price (and of the price per m2). */
  optional: z.boolean(),
  /** Initial state of an optional group; must be true for a group that is not optional. */
  defaultOn: z.boolean(),
  /** Key of `vat.classes`. */
  vat: id,
  /** Do the lines of this group form the basis of the site-overhead line (construction work, not design and fees)? */
  siteOverheadBasis: z.boolean(),
  lines: z.array(PriceLineSchema).min(1),
});
export type PriceGroup = z.infer<typeof PriceGroupSchema>;

/**
 * Schema of `model/pricebook.json` (format `pricebook/1`). Prices are the book's data: nothing else in the code carries a price.
 * `meta.status` says whether the numbers were reviewed against the cited sources.
 */
export const PricebookSchema = z
  .strictObject({
    schema: z.literal("pricebook/1"),
    meta: z.strictObject({
      status: z.enum(["starter", "reviewed"]),
      region: z.string().min(1),
      currency: z.literal("CZK"),
      priceYear: z.int(),
      sources: z.array(z.string().min(1)),
    }),
    /** VAT classes as shares (0.12 = 12 %) and the class of groups that name none. */
    vat: z.strictObject({ default: id, classes: z.record(id, share) }),
    /** Contingency on the net sum: default and the range of the slider. */
    reserve: z.strictObject({ default: share, min: share, max: share, step: z.number().positive() }),
    /**
     * Site facilities and ancillary costs as a share of the construction work (the groups with `siteOverheadBasis`), rounded to
     * `roundTo` CZK. It is a computed line of group `groupId` (id, name, unit "set", quantity 1); null = none.
     */
    siteOverhead: z
      .strictObject({ id, name: text, groupId: id, share: z.number().min(0).max(0.2), roundTo: z.number().positive() })
      .nullable(),
    /**
     * A typical range of the finished house price per m2 of heated floor, CZK with VAT: the orientation band the page compares
     * the house price with. Not a quote and not derived from the lines (so it is an independent check); omit for no band.
     */
    benchmark: z.strictObject({ perM2Low: z.number().positive(), perM2High: z.number().positive() }).refine((b) => b.perM2Low < b.perM2High, { message: "low < high" }).optional(),
    groups: z.array(PriceGroupSchema).min(1),
  })
  .superRefine((b, ctx) => {
    const seen = new Set<string>();
    const dup = (v: string, path: (string | number)[]) => {
      if (seen.has(v)) ctx.addIssue({ code: "custom", path, message: `duplicate id "${v}"` });
      seen.add(v);
    };
    b.groups.forEach((g, gi) => {
      dup(g.id, ["groups", gi, "id"]);
      if (!(g.vat in b.vat.classes)) ctx.addIssue({ code: "custom", path: ["groups", gi, "vat"], message: `unknown VAT class "${g.vat}"` });
      if (!g.optional && !g.defaultOn) ctx.addIssue({ code: "custom", path: ["groups", gi, "defaultOn"], message: "a group that is not optional is always on" });
      g.lines.forEach((l, li) => dup(l.id, ["groups", gi, "lines", li, "id"]));
    });
    if (!(b.vat.default in b.vat.classes)) ctx.addIssue({ code: "custom", path: ["vat", "default"], message: "unknown default VAT class" });
    if (!(b.reserve.min <= b.reserve.default && b.reserve.default <= b.reserve.max)) ctx.addIssue({ code: "custom", path: ["reserve"], message: "min <= default <= max" });
    const oh = b.siteOverhead;
    if (oh) {
      dup(oh.id, ["siteOverhead", "id"]);
      const g = b.groups.find((x) => x.id === oh.groupId);
      if (!g) ctx.addIssue({ code: "custom", path: ["siteOverhead", "groupId"], message: "unknown group" });
      else if (g.optional) ctx.addIssue({ code: "custom", path: ["siteOverhead", "groupId"], message: "the overhead line belongs to a group that is not optional" });
    }
  });
export type Pricebook = z.infer<typeof PricebookSchema>;

/** Parses and validates `model/pricebook.json`; throws a ZodError with a readable path on a bad file. */
export function parsePricebook(json: unknown): Pricebook {
  return PricebookSchema.parse(json);
}

let memo: Pricebook | null = null;
/** The project's own price book (`model/pricebook.json`, imported statically as "@model/pricebook.json"), parsed once and memoised. */
export function defaultPricebook(): Pricebook {
  memo ??= parsePricebook(pricebookJson);
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
