// View model of the floor plan page, built on the server from the shared house: the drawing, its SVG layers and the facts the
// panels show (rooms, totals). Everything is plain serialisable data in the language of the visitor, so the client component
// ships without the model, the schema or the deriver. Pure: tests call it with the shared instance.
import type { Derived, House, Locale, Metrics, OpeningKind, Facing8, FloorKind, RoomType } from "@/lib/model/types";
import { FACINGS8, OUTDOOR_TYPE_NAMES } from "@/lib/model/catalog";
import { derivedFingerprint } from "@/lib/calc/storageKeys";
import { nb } from "@/lib/i18n/format";
import { buildPlanDrawing, type FillKey, type PlanDrawing, type PlanOptions } from "./planGeometry";
import { planLayers, type PlanLayers } from "./svg";
import type { Rect } from "@/lib/model/geom";

export interface RoomOpeningView { kind: OpeningKind; facing: Facing8; sill: number; w: number; h: number }

export interface RoomView {
  id: string;
  /** Number shown on the plan and in the table: the display number of the kernel ("1.01", walking order from the entrance). */
  number: string;
  name: string;
  /** Short name of the model (the sticky phone summary), else the name. */
  shortName: string;
  type: RoomType;
  fill: FillKey;
  /** Name of the zone from the model. */
  zone: string;
  floor: FloorKind | null;
  /** Name of the floor material (style of the model). */
  floorName: string | null;
  heated: boolean;
  /** Net area, m2, net perimeter, m, clear height, m, net volume, m3. */
  area: number;
  perimeter: number;
  height: number;
  volume: number;
  exteriorWallLength: number;
  /** Window and sliding-wall area (m2) and its share of the floor area (0..1). */
  glazing: number;
  glazingRatio: number;
  /** Doors to pass from the entry, or null when the room is not reachable. */
  doorsFromEntry: number | null;
  /** Exterior openings of the room, and the directions its windows and doors face (compass order, each once). */
  openings: RoomOpeningView[];
  facings: Facing8[];
  /** Label point in plan space (arrow keys move to the nearest room in a direction). */
  at: [number, number];
}

export interface PlanTotals {
  /** Sum of the net floor areas of all rooms, m2, and of their glazing. */
  floorArea: number;
  glazing: number;
  /**
   * The shared metrics of the house (the same numbers on every page): net area of the heated rooms ("užitná plocha"), the
   * garage, and the built-up area (outline plus the roofed outdoor areas, as on the Plot page).
   */
  heatedArea: number;
  garageArea: number;
  builtUpArea: number;
  /** Footprint including the walls, m2. */
  footprint: number;
  clearHeight: number;
  interiorDoors: number;
  /** The largest room (m2): the scale of the area bars of the table. */
  largestRoom: number;
}

/**
 * Name of a named outdoor area on the drawing (terrace, pool, pool deck, drive, path), in the language of the visitor: the
 * free cell it may use inside the area and the drawn rect (plan space) for a place beside it.
 */
export interface OutdoorLabelView { id: string; name: string; at: [number, number]; w: number; h: number; rect: [number, number, number, number] }

export interface PlanView {
  drawing: PlanDrawing;
  layers: PlanLayers;
  /** In the order of the numbers. */
  rooms: RoomView[];
  /** Fills in use, in a fixed order, for the legend. */
  legend: FillKey[];
  /** Names of the outdoor areas the drawing shows (the page places the ones that fit at the current scale). */
  outdoor: OutdoorLabelView[];
  totals: PlanTotals;
  /** House-frame bounds of the drawing: furniture of the visitor stays inside. */
  bounds: Rect;
  /** Identifies the geometry that the saved furniture belongs to. */
  fingerprint: string;
  /** The room that is selected first (the main living room, else the first). */
  initialRoom: string;
}

/** Style data of the model that the plan reads (a subset of `model/style.json`). */
export interface StyleMaterials { materials: Record<string, { name: { cs: string; en: string }; color: string }> }

/**
 * Numbers of the rooms from the trailing digits of the model's ids, the position when that is not unique.
 * @deprecated The page shows `derived.rooms[].displayNo` (parity-15); kept for consumers of the old view.
 */
export function roomNumbers(ids: readonly string[]): string[] {
  const parsed = ids.map((id) => /(\d+)$/.exec(id)?.[1]).map((s) => (s === undefined ? null : String(Number(s))));
  return new Set(parsed).size === ids.length && !parsed.includes(null) ? (parsed as string[]) : ids.map((_, i) => String(i + 1));
}

const FILL_ORDER: readonly FillKey[] = ["day", "night", "service", "circulation", "garage", "terrace", "paving", "pool"];

/** Room numbers sort like "1.02" < "1.10" < "2.01" (storey, then the number); a missing number goes last. */
const byNumber = (a: string, b: string): number => a.localeCompare(b, "en", { numeric: true });

/**
 * The view of the floor plan page. The drawing shows the garden rooms (the pool and its deck) whole unless `opts.garden` is
 * false; the other options go to `buildPlanDrawing`.
 */
export function buildPlanView(house: House, derived: Derived, metrics: Metrics, style: StyleMaterials, locale: Locale, opts: PlanOptions = {}): PlanView {
  const drawing = buildPlanDrawing(derived, { garden: true, ...opts });
  const fallback = roomNumbers(derived.rooms.map((r) => r.id));
  const rooms: RoomView[] = derived.rooms.map((r, i) => {
    const pr = drawing.rooms[i];
    const openings = derived.openings.filter((o) => o.exterior && o.room === r.id && o.facing)
      .map((o) => ({ kind: o.kind, facing: o.facing!, sill: o.sill, w: o.w, h: o.head - o.sill }));
    const facing = new Set(openings.map((o) => o.facing));
    const name = nb(r.name[locale], locale);
    return {
      id: r.id, number: r.displayNo || fallback[i], name, shortName: r.shortName ? nb(r.shortName[locale], locale) : name,
      type: r.type, fill: pr.fill, zone: nb(house.zones[r.zone].label[locale], locale),
      floor: r.floor ?? null, floorName: r.floor ? nb(style.materials[`floor_${r.floor}`]?.name[locale] ?? "", locale) || null : null,
      heated: r.heated, area: r.area, perimeter: pr.perimeter, height: r.height, volume: r.volume,
      exteriorWallLength: r.exteriorWallLength, glazing: r.glazing.total, glazingRatio: r.area > 0 ? r.glazing.total / r.area : 0,
      doorsFromEntry: derived.access.depth[r.id] ?? null, openings, facings: FACINGS8.filter((d) => facing.has(d)), at: pr.label.at,
    };
  }).sort((a, b) => byNumber(a.number, b.number));
  const used = new Set<FillKey>([...drawing.rooms.map((r) => r.fill), ...drawing.outdoor.map((o) => o.fill)]);
  const v = drawing.viewBox;
  return {
    drawing, layers: planLayers(drawing), rooms, legend: FILL_ORDER.filter((k) => used.has(k)),
    // only the areas the model names: an unnamed strip of paving needs no caption
    outdoor: drawing.outdoor.filter((o) => o.name !== null)
      .map((o) => ({ id: o.id, name: nb((o.name ?? OUTDOOR_TYPE_NAMES[o.type])[locale], locale), at: o.label.at, w: o.label.w, h: o.label.h, rect: o.rect })),
    totals: {
      floorArea: derived.rooms.reduce((s, r) => s + r.area, 0), glazing: derived.rooms.reduce((s, r) => s + r.glazing.total, 0),
      heatedArea: metrics.heatedArea, garageArea: metrics.garageArea, builtUpArea: metrics.builtUpArea,
      footprint: metrics.footprintArea, clearHeight: house.clearHeight, interiorDoors: derived.openings.filter((o) => o.kind === "door").length,
      largestRoom: Math.max(0, ...derived.rooms.map((r) => r.area)),
    },
    bounds: [v.x, -(v.y + v.h), v.x + v.w, -v.y],
    fingerprint: derivedFingerprint(derived),
    initialRoom: (derived.rooms.find((r) => r.role === "main-living") ?? derived.rooms[0]).id,
  };
}

