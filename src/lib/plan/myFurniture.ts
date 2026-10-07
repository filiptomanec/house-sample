// "My furniture" of the floor plan: pieces the visitor places on the drawing, and the measuring tool. Pure functions.
// Coordinates are house-frame metres (x east, y north), like the model; an item is stored by its centre. The visitor's
// pieces live in the browser (STORAGE_KEYS.furniture, versioned envelope, see calc/storageKeys.ts) and are validated on read.
import { FURNITURE, type FurnitureType } from "@/lib/model/catalog";
import type { Pt, Rect } from "@/lib/model/geom";

/** Snap grid of dragging, keys and the measuring tool, m. */
export const SNAP = 0.05;
/** Coarse step of keyboard moves (Shift), m. */
export const SNAP_COARSE = 0.5;
/** Most pieces that are kept, and the range of a custom size, m. */
export const MAX_ITEMS = 60;
export const SIZE_RANGE: readonly [number, number] = [0.1, 6];

/** The ready-made pieces offered in the panel (all from the furniture catalogue of the model). */
export const PRESET_TYPES = [
  "bed180", "bed90", "sofaL", "sofa3", "armchair", "tv", "table6", "chair", "desk", "wardrobe", "shelf", "fridge", "washer", "lounger",
] as const satisfies readonly FurnitureType[];

export type Rot = 0 | 90 | 180 | 270;
export type ItemKind = FurnitureType | "custom";

export interface MyItem {
  kind: ItemKind;
  /** Size at rot 0: width along x, depth along y, m. */
  w: number;
  d: number;
  /** Centre, m. */
  x: number;
  y: number;
  /** Counter-clockwise quarter turns as degrees. */
  rot: Rot;
}

/** Rounds to the 5 cm grid without float noise (1.45, not 1.4500000000000002). */
export const snap = (v: number, step = SNAP): number => Math.round(Math.round(v / step) * step * 1e6) / 1e6;
export const snapPt = (p: Pt): Pt => [snap(p[0]), snap(p[1])];

const clampNum = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
const quarter = (rot: number): boolean => rot === 90 || rot === 270;

/** Width (along x) and depth (along y) as drawn, after the turn. */
export function footprint(i: Pick<MyItem, "w" | "d" | "rot">): { w: number; d: number } {
  return quarter(i.rot) ? { w: i.d, d: i.w } : { w: i.w, d: i.d };
}

/** Rectangle of the item in the house frame. */
export function itemRect(i: MyItem): Rect {
  const f = footprint(i);
  return [i.x - f.w / 2, i.y - f.d / 2, i.x + f.w / 2, i.y + f.d / 2];
}

/** Quarter turn about the centre. */
export const rotateItem = (i: MyItem): MyItem => ({ ...i, rot: ((i.rot + 90) % 360) as Rot });

/** Moves the centre to a snapped position that keeps the item inside `bounds` (as far as it fits). */
export function placeItem(i: MyItem, x: number, y: number, bounds: Rect): MyItem {
  const f = footprint(i);
  const fit = (v: number, lo: number, hi: number, half: number) => (hi - lo <= 2 * half ? (lo + hi) / 2 : clampNum(v, lo + half, hi - half));
  return { ...i, x: snap(fit(x, bounds[0], bounds[2], f.w / 2)), y: snap(fit(y, bounds[1], bounds[3], f.d / 2)) };
}

export const moveItem = (i: MyItem, dx: number, dy: number, bounds: Rect): MyItem => placeItem(i, i.x + dx, i.y + dy, bounds);

/** A new piece of a catalogue type or of a custom size, centred on `at`. */
export function newItem(kind: ItemKind, size: { w: number; d: number } | null, at: Pt, bounds: Rect): MyItem {
  const base = kind === "custom" ? size ?? { w: 1, d: 0.6 } : FURNITURE[kind];
  const w = clampNum(base.w, SIZE_RANGE[0], SIZE_RANGE[1]), d = clampNum(base.d, SIZE_RANGE[0], SIZE_RANGE[1]);
  return placeItem({ kind, w, d, x: at[0], y: at[1], rot: 0 }, at[0], at[1], bounds);
}

/** Adds a piece; the list is capped at MAX_ITEMS (the oldest piece is dropped). */
export const addItem = (items: readonly MyItem[], item: MyItem): MyItem[] => [...items, item].slice(-MAX_ITEMS);

// ------------------------------------------------------------------------------------------------ storage

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** Pieces from untrusted stored data: invalid entries are dropped, sizes and positions are clamped to sane ranges. Null when `data` is no list. */
export function parseItems(data: unknown): MyItem[] | null {
  if (!isRecord(data) || !Array.isArray(data.items)) return null;
  const out: MyItem[] = [];
  for (const raw of data.items) {
    if (!isRecord(raw)) continue;
    const { kind, w, d, x, y, rot } = raw;
    if (typeof kind !== "string" || (kind !== "custom" && !Object.hasOwn(FURNITURE, kind))) continue;
    if (!finite(w) || !finite(d) || !finite(x) || !finite(y) || (rot !== 0 && rot !== 90 && rot !== 180 && rot !== 270)) continue;
    out.push({
      kind: kind as ItemKind, w: clampNum(w, SIZE_RANGE[0], SIZE_RANGE[1]), d: clampNum(d, SIZE_RANGE[0], SIZE_RANGE[1]),
      x: clampNum(x, -1000, 1000), y: clampNum(y, -1000, 1000), rot,
    });
  }
  return out.slice(-MAX_ITEMS);
}

/** What is stored: an object so that later versions can add fields. */
export const serializeItems = (items: readonly MyItem[]): { items: MyItem[] } => ({ items: [...items] });

// ------------------------------------------------------------------------------------------------ measuring

export interface Measurement {
  /** Straight distance and the components along the drawing axes, m. */
  length: number;
  dx: number;
  dy: number;
}

export function measure(a: Pt, b: Pt): Measurement {
  const dx = Math.abs(b[0] - a[0]), dy = Math.abs(b[1] - a[1]);
  return { length: Math.hypot(dx, dy), dx, dy };
}
