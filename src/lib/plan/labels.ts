// Placement of the texts on the floor plan for a given on-screen scale. Pure functions in plan space (metres): the page
// measures its drawing (pixels per metre), asks for the layout and draws the texts. Font sizes are chosen so that the text
// is about the same size on screen at every scale, which means that on a phone a label can be larger than its room: the
// layout then dims or shrinks it instead of letting texts collide.
import { footprint, type MyItem } from "./myFurniture";
import type { PlanPt } from "./shared";

/** Average advance of one character in em: Geist Mono and Geist. */
export const MONO_W = 0.6;
export const SANS_W = 0.56;
/** Thickness of the halo (outline in the page colour) around a text, in em. */
export const HALO = 0.24;

export const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

/** Font sizes in metres for `s` pixels per metre: the on-screen size is held in a range, the size in metres in another. */
export function fontSizes(s: number) {
  const per = (px: number, lo: number, hi: number) => clamp(px / s, lo, hi);
  return {
    number: per(12, 0.26, 0.6), area: per(10.5, 0.22, 0.5), dims: per(10, 0.2, 0.42), furniture: per(9.5, 0.18, 0.6),
    furnitureMin: per(7.5, 0.14, 0.56), ui: per(10.5, 0.2, 0.56),
  };
}

/** A box given by its centre and half extents (plan space), used to find labels that lie under something. */
export interface Box { cx: number; cy: number; hw: number; hh: number }

export interface RoomLabelInput {
  id: string;
  /** Texts as they will be drawn (their length decides the width). */
  number: string;
  area: string;
  at: PlanPt;
  spanX: [number, number];
  spanY: [number, number];
}

export interface RoomLabel {
  id: string;
  /** "stack": number above the area, centred; "row": side by side from `x` on (text-anchor start). */
  mode: "stack" | "row";
  number: { x: number; y: number; fs: number };
  area: { x: number; y: number; fs: number };
  /** The label lies under one of the `avoid` boxes and should be drawn faint. */
  dim: boolean;
}

/** Number and area of every room: stacked when the room is tall enough at that point, else in one row, and always inside the room's span. */
export function layoutRoomLabels(rooms: readonly RoomLabelInput[], s: number, avoid: readonly Box[] = []): RoomLabel[] {
  const f = fontSizes(s);
  return rooms.map((r) => {
    const [a, b] = r.spanX, pad = (b - a) * 0.03, free = b - a - 2 * pad, spanH = r.spanY[1] - r.spanY[0];
    const wOf = (n: number, fs: number) => (n * MONO_W + HALO) * fs;
    let fsN = Math.min(f.number, free / (r.number.length * MONO_W + HALO)), fsA = Math.min(f.area, fsN * 0.85);
    const [lx, y] = r.at, at = (w: number) => clamp(lx, a + pad + w / 2, b - pad - w / 2);
    const dim = avoid.some((v) => Math.abs(lx - v.cx) < v.hw + fsN * 0.9 && y + fsA * 0.6 > v.cy - v.hh && y - fsN * 0.6 < v.cy + v.hh);
    if (fsN * 0.97 + fsA * 1.1 <= spanH * 0.9) {
      const x = at(Math.max(wOf(r.number.length, fsN), wOf(r.area.length, fsA)));
      return { id: r.id, mode: "stack", number: { x, y: y - fsN * 0.25, fs: fsN }, area: { x, y: y + fsA * 1.1, fs: fsA }, dim };
    }
    // side by side: the whole row has to fit into the free interval, otherwise both shrink
    const row = r.number.length * MONO_W * fsN + fsA * 0.5 + r.area.length * MONO_W * fsA + (HALO * (fsN + fsA)) / 2;
    if (row > free) { const k = free / row; fsN *= k; fsA *= k; }
    const wN = r.number.length * MONO_W * fsN, gap = fsA * 0.5, total = wN + gap + r.area.length * MONO_W * fsA;
    const x0 = at(total + HALO * fsN) - total / 2;
    return { id: r.id, mode: "row", number: { x: x0, y: y + fsN * 0.35, fs: fsN }, area: { x: x0 + wN + gap, y: y + fsN * 0.35, fs: fsA }, dim };
  });
}

// ------------------------------------------------------------------------------------------------ window labels

export interface WindowLabelInput {
  id: string;
  /** Text of the label ("2 100 × 1 200"). */
  text: string;
  /** Centre of the opening on the outer face and the unit vector pointing out (plan space). */
  at: PlanPt;
  out: PlanPt;
}

export interface WindowLabel {
  id: string;
  text: string;
  x: number;
  y: number;
  /** Rotation in degrees: 0 on horizontal facades, -90 on vertical ones. */
  rot: 0 | -90;
  /** Box of the label: length along the text and height. */
  len: number;
  height: number;
}

/**
 * Labels of the exterior openings, set a little before the facade and spread along it so that neighbours do not overlap.
 * `bounds` keeps them inside the drawing: [x0, y0, x1, y1].
 */
export function layoutWindowLabels(items: readonly WindowLabelInput[], fs: number, bounds: readonly [number, number, number, number]): WindowLabel[] {
  const height = fs * 1.4, gap = 0.3 + height / 2;
  const all = items.map((o) => {
    const vertical = Math.abs(o.out[0]) > Math.abs(o.out[1]);
    const len = o.text.length * MONO_W * fs + fs;
    return { o, vertical, len, x: o.at[0] + o.out[0] * gap, y: o.at[1] + o.out[1] * gap };
  });
  // spread the labels of one facade along it (a few passes of pairwise pushing)
  const rows = new Map<string, typeof all>();
  for (const l of all) {
    const k = `${Math.sign(l.o.out[0])}${Math.sign(l.o.out[1])}`;
    rows.set(k, [...(rows.get(k) ?? []), l]);
  }
  for (const row of rows.values()) {
    const key = row[0].vertical ? "y" : "x";
    row.sort((p, q) => p[key] - q[key]);
    for (let pass = 0; pass < 30; pass++) {
      for (let i = 0; i + 1 < row.length; i++) {
        const p = row[i], q = row[i + 1], over = (p.len + q.len) / 2 + 0.12 - (q[key] - p[key]);
        if (over > 0) { p[key] -= over / 2; q[key] += over / 2; }
      }
    }
  }
  return all.map((l) => {
    const hx = (l.vertical ? height : l.len) / 2, hy = (l.vertical ? l.len : height) / 2;
    return {
      id: l.o.id, text: l.o.text, rot: l.vertical ? -90 : 0, len: l.len, height,
      x: clamp(l.x, bounds[0] + hx, bounds[2] - hx), y: clamp(l.y, bounds[1] + hy, bounds[3] - hy),
    };
  });
}

// ------------------------------------------------------------------------------------------------ furniture names

export interface ItemLabel {
  lines: string[];
  fs: number;
  /** Written along the long side when that is vertical. */
  vertical: boolean;
  /** The text is larger than its rectangle: draw it with a halo. */
  over: boolean;
}

/**
 * Name of a piece of furniture: along the longer side, on one or two lines, as large as possible but inside the rectangle.
 * Where it would come out smaller than `min` (a small item on a phone) the size is `min` and the text overflows.
 */
export function itemLabel(name: string, w: number, d: number, target: number, min: number): ItemLabel {
  const vertical = d > w * 1.15, long = vertical ? d : w, short = vertical ? w : d;
  const words = name.split(/\s+/);
  const splits = [[name], ...words.slice(1).map((_, k) => [words.slice(0, k + 1).join(" "), words.slice(k + 1).join(" ")])];
  const widest = (ls: readonly string[]) => Math.max(...ls.map((l) => l.length));
  let lines = [name], fs = Math.min(target, (long * 0.88) / (name.length * SANS_W), short * 0.62);
  for (const two of splits.slice(1)) {
    const g = Math.min(target, (long * 0.88) / (widest(two) * SANS_W), (short * 0.8) / 2.3);
    if (g > fs * 1.12) { lines = two; fs = g; }
  }
  if (fs >= min) return { lines, fs, vertical, over: false };
  // overflow: the split that sticks out least at size `min`
  let best = splits[0], worst = Infinity;
  for (const ls of splits) {
    const out = Math.max(0, widest(ls) * SANS_W * min - long) + Math.max(0, (ls.length * 1.1 + 0.2) * min - short);
    if (out < worst - 0.005) { worst = out; best = ls; }
  }
  return { lines: best, fs: min, vertical, over: true };
}

/** Half extents of the box a label occupies, for the `avoid` test of room labels. */
export function itemLabelBox(label: ItemLabel, w: number, d: number): { hw: number; hh: number } {
  const tw = widestLine(label) * SANS_W * label.fs, th = label.lines.length * 1.1 * label.fs;
  const [bw, bh] = label.vertical ? [th, tw] : [tw, th];
  return { hw: Math.max(w, bw) / 2, hh: Math.max(d, bh) / 2 };
}

const widestLine = (l: ItemLabel): number => Math.max(...l.lines.map((s) => s.length));

// ------------------------------------------------------------------------------------------------ the visitor's furniture

export interface PlacedItem {
  /** Size as drawn (after the turn) and centre in plan space (y down). */
  w: number;
  d: number;
  cx: number;
  cy: number;
  label: ItemLabel;
  /** Half extents of the larger of rectangle and label (for the dimming of room labels). */
  hw: number;
  hh: number;
}

/** Rectangle, label and box of each piece of the visitor's furniture at the scale `s` (pixels per metre). `names` is parallel to `items`. */
export function placeItemLabels(items: readonly MyItem[], names: readonly string[], s: number): PlacedItem[] {
  const f = fontSizes(s);
  return items.map((it, i) => {
    const { w, d } = footprint(it), label = itemLabel(names[i], w, d, f.furniture, f.furnitureMin);
    return { w, d, cx: it.x, cy: -it.y, label, ...itemLabelBox(label, w, d) };
  });
}

/** The boxes of placed items, for `layoutRoomLabels`. */
export const boxesOf = (placed: readonly PlacedItem[]): Box[] => placed.map((p) => ({ cx: p.cx, cy: p.cy, hw: p.hw, hh: p.hh }));
