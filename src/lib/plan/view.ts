// View model of the floor plan page, built on the server from the shared house: the drawing, its SVG layers and the facts the
// panels show (rooms, totals). Everything is plain serialisable data in the language of the visitor, so the client component
// ships without the model, the schema or the deriver. Pure: tests call it with the shared instance.
import type { Derived, House, Locale, Metrics, OpeningKind, Facing8, FloorKind, RoomType } from "@/lib/model/types";
import { derivedFingerprint } from "@/lib/calc/storageKeys";
import { buildPlanDrawing, type FillKey, type PlanDrawing, type PlanOptions } from "./planGeometry";
import { planLayers, type PlanLayers } from "./svg";
import type { Rect } from "@/lib/model/geom";

export interface RoomOpeningView { kind: OpeningKind; facing: Facing8; sill: number; w: number; h: number }

export interface RoomView {
  id: string;
  /** Number shown on the plan and in the table, from the id of the model. */
  number: string;
  name: string;
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
  /** Exterior openings of the room. */
  openings: RoomOpeningView[];
  /** Label point in plan space (arrow keys move to the nearest room in a direction). */
  at: [number, number];
}

export interface PlanTotals {
  /** Sum of the net floor areas of all rooms, m2, and of their glazing. */
  floorArea: number;
  glazing: number;
  /** Footprint including the walls, m2. */
  footprint: number;
  clearHeight: number;
  interiorDoors: number;
}

export interface PlanView {
  drawing: PlanDrawing;
  layers: PlanLayers;
  /** In the order of the numbers. */
  rooms: RoomView[];
  /** Fills in use, in a fixed order, for the legend. */
  legend: FillKey[];
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

/** Numbers of the rooms: the trailing digits of the model's id without leading zeros; the position when that is not unique. */
export function roomNumbers(ids: readonly string[]): string[] {
  const parsed = ids.map((id) => /(\d+)$/.exec(id)?.[1]).map((s) => (s === undefined ? null : String(Number(s))));
  return new Set(parsed).size === ids.length && !parsed.includes(null) ? (parsed as string[]) : ids.map((_, i) => String(i + 1));
}

const FILL_ORDER: readonly FillKey[] = ["day", "night", "service", "circulation", "garage", "terrace", "paving"];

export function buildPlanView(house: House, derived: Derived, metrics: Metrics, style: StyleMaterials, locale: Locale, opts: PlanOptions = {}): PlanView {
  const drawing = buildPlanDrawing(derived, opts);
  const numbers = roomNumbers(derived.rooms.map((r) => r.id));
  const rooms: RoomView[] = derived.rooms.map((r, i) => {
    const pr = drawing.rooms[i];
    const openings = derived.openings.filter((o) => o.exterior && o.room === r.id && o.facing)
      .map((o) => ({ kind: o.kind, facing: o.facing!, sill: o.sill, w: o.w, h: o.head - o.sill }));
    return {
      id: r.id, number: numbers[i], name: r.name[locale], type: r.type, fill: pr.fill, zone: house.zones[r.zone].label[locale],
      floor: r.floor ?? null, floorName: r.floor ? style.materials[`floor_${r.floor}`]?.name[locale] ?? null : null,
      heated: r.heated, area: r.area, perimeter: pr.perimeter, height: r.height, volume: r.volume,
      exteriorWallLength: r.exteriorWallLength, glazing: r.glazing.total, glazingRatio: r.area > 0 ? r.glazing.total / r.area : 0,
      doorsFromEntry: derived.access.depth[r.id] ?? null, openings, at: pr.label.at,
    };
  }).sort((a, b) => Number(a.number) - Number(b.number));
  const used = new Set<FillKey>([...drawing.rooms.map((r) => r.fill), ...drawing.outdoor.map((o) => o.fill)]);
  const v = drawing.viewBox;
  return {
    drawing, layers: planLayers(drawing), rooms, legend: FILL_ORDER.filter((k) => used.has(k)),
    totals: {
      floorArea: derived.rooms.reduce((s, r) => s + r.area, 0), glazing: derived.rooms.reduce((s, r) => s + r.glazing.total, 0),
      footprint: metrics.footprintArea, clearHeight: house.clearHeight, interiorDoors: derived.openings.filter((o) => o.kind === "door").length,
    },
    bounds: [v.x, -(v.y + v.h), v.x + v.w, -v.y],
    fingerprint: derivedFingerprint(derived),
    initialRoom: (derived.rooms.find((r) => r.role === "main-living") ?? derived.rooms[0]).id,
  };
}

