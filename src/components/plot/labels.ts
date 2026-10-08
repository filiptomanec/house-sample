// Map geometry and label placement for the plot map (pure functions, no DOM).
//
// Drawing units: 1 m = K units, y points down (SVG). The map group is turned by `rot` degrees clockwise about the centre of
// the plot (rot = bearing for "true north up", 0 for "drawing north up"). Texts are NOT turned with the map: they are drawn in
// an upright layer at positions computed here, so all collision tests happen in the final, rotated frame.
import type { ContourLabel } from "@/lib/model/site/contours";
import type { XY } from "@/lib/model/site/geometry";
import { pointInPolygon } from "@/lib/model/site/geometry";

/** SVG units per metre (large enough that font sizes in units stay far from browsers' tiny-font limits). */
export const K = 10;

export interface Frame { x: number; y: number; w: number; h: number }
/** Centre (x, y) and size of a rectangle, in drawing units. */
export interface Box { x: number; y: number; w: number; h: number }

const round2 = (v: number): number => Math.round(v * 100) / 100;
export const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

/** House-frame metres to drawing units (before turning the map). */
export const toUnits = ([x, y]: readonly number[]): XY => [x * K, -y * K];

/**
 * Drawing units after turning by `deg` clockwise about `c`. The result is rounded to 1/1000 unit: sin and cos differ in the
 * last bits between Node and the browser, and the server-rendered markup must equal what the client computes (hydration).
 */
export function turn(p: XY, deg: number, c: XY): XY {
  const a = (deg * Math.PI) / 180, dx = p[0] - c[0], dy = p[1] - c[1];
  const r = (v: number) => Math.round(v * 1000) / 1000;
  return [r(c[0] + dx * Math.cos(a) - dy * Math.sin(a)), r(c[1] + dx * Math.sin(a) + dy * Math.cos(a))];
}

/** House-frame point (m) to its position on screen (drawing units), the map being turned by `rot` about the unit point `c`. */
export const toScreen = (p: readonly number[], rot: number, c: XY): XY => turn(toUnits(p), rot, c);

/** Inverse of `toScreen`. */
export function fromScreen(p: XY, rot: number, c: XY): XY {
  const [x, y] = turn(p, -rot, c);
  return [x / K, -y / K];
}

/** Visible frame: bounding box of the (turned) plot plus `pad` metres on every side. */
export function frameFor(plot: readonly XY[], rot: number, c: XY, pad: number): Frame {
  const pts = plot.map((p) => toScreen(p, rot, c));
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  const x0 = Math.min(...xs) - pad * K, y0 = Math.min(...ys) - pad * K;
  return { x: x0, y: y0, w: Math.max(...xs) + pad * K - x0, h: Math.max(...ys) + pad * K - y0 };
}

/** Length (m) of a scale bar for a map `metres` wide: roughly a fifth of the width, from a short list of round values. */
export function scaleLength(metres: number): number {
  const want = metres * 0.2;
  return [2, 5, 10, 20, 50, 100].reduce((best, v) => (Math.abs(v - want) < Math.abs(best - want) ? v : best), 10);
}

// ------------------------------------------------------------------------------------------------ corner widgets

/**
 * Where the north arrows (top right) and the scale bar (bottom left) stand, in drawing units, for a map drawn at `s` pixels per
 * unit. The widgets are designed in pixels (a group scaled by 1/s), so their size in units follows from `s`. `boxes` are the
 * areas labels must keep free.
 */
export function cornerWidgets(frame: Frame, s: number, barMetres: number): { north: XY; scale: XY; boxes: Box[] } {
  const px = (v: number) => v / s;
  const north: XY = [frame.x + frame.w - px(30), frame.y + px(64)];
  const scale: XY = [frame.x + px(16), frame.y + frame.h - px(30)];
  return {
    north, scale,
    boxes: [
      { x: north[0] - px(26), y: north[1] - px(16), w: px(112), h: px(84) },
      { x: scale[0] + (barMetres * K) / 2, y: scale[1] + px(8), w: barMetres * K + px(20), h: px(34) },
    ],
  };
}

// ------------------------------------------------------------------------------------------------ boxes

export const boxesHit = (a: Box, b: Box, pad = 0): boolean =>
  Math.abs(a.x - b.x) < (a.w + b.w) / 2 + pad && Math.abs(a.y - b.y) < (a.h + b.h) / 2 + pad;

/** Distance from a point to the box (0 inside). */
export const boxGap = (b: Box, [px, py]: XY): number =>
  Math.hypot(Math.max(Math.abs(px - b.x) - b.w / 2, 0), Math.max(Math.abs(py - b.y) - b.h / 2, 0));

/** Does the box lie entirely inside the frame, keeping `margin` units from its edges? */
export const boxInFrame = (b: Box, f: Frame, margin: number): boolean =>
  b.x - b.w / 2 >= f.x + margin && b.x + b.w / 2 <= f.x + f.w - margin && b.y - b.h / 2 >= f.y + margin && b.y + b.h / 2 <= f.y + f.h - margin;

/** Is any of the corners or the centre of the box inside the polygon (drawing units)? */
export const boxTouchesPoly = (b: Box, poly: readonly XY[]): boolean =>
  [[-1, -1], [1, -1], [1, 1], [-1, 1], [0, 0]].some(([i, j]) => pointInPolygon([b.x + (i * b.w) / 2, b.y + (j * b.h) / 2], poly));

/** Smallest distance of a box from the segment a-c, sampled every `step` units (error at most step / 2). */
export function boxSegmentGap(b: Box, a: XY, c: XY, step: number): number {
  const n = Math.max(1, Math.ceil(Math.hypot(c[0] - a[0], c[1] - a[1]) / step));
  let g = Infinity;
  for (let k = 0; k <= n; k++) g = Math.min(g, boxGap(b, [a[0] + ((c[0] - a[0]) * k) / n, a[1] + ((c[1] - a[1]) * k) / n]));
  return g;
}

/** Axis-aligned box of a text of `chars` characters, turned by `angleDeg`. Monospace metrics (0.62 em per character). */
export function textBox(x: number, y: number, chars: number, fs: number, angleDeg = 0): Box {
  const w = chars * 0.62 * fs, h = fs * 1.05, a = (angleDeg * Math.PI) / 180;
  return { x, y, w: Math.abs(w * Math.cos(a)) + Math.abs(h * Math.sin(a)), h: Math.abs(w * Math.sin(a)) + Math.abs(h * Math.cos(a)) };
}

// ------------------------------------------------------------------------------------------------ set-back labels

export interface SetbackLine { from: XY; to: XY }
export interface Obstacles {
  /** Polygons (screen units) that labels should not cover: the house, its outdoor areas. */
  polys: readonly (readonly XY[])[];
  /** Boxes already taken. */
  boxes: readonly Box[];
}

/**
 * Places one label per set-back line, beside the middle of the line on the side where nothing is in the way
 * (other lines, the house, labels placed before). Lines are in screen units. Deterministic.
 */
export function placeSetbackLabels(lines: readonly SetbackLine[], chars: readonly number[], fs: number, house: readonly XY[], plot: readonly XY[], taken: readonly Box[] = []): Box[] {
  const placed: Box[] = [];
  lines.forEach((ln, i) => {
    const F = ln.from, T = ln.to, L = Math.hypot(T[0] - F[0], T[1] - F[1]) || 1;
    const u = [(T[0] - F[0]) / L, (T[1] - F[1]) / L], n = [-u[1], u[0]];
    let best: Box | null = null, bestScore = -Infinity;
    for (const t of [0.5, 0.38, 0.62, 0.28, 0.72]) {
      for (const side of [1, -1]) {
        const w = chars[i] * 0.62 * fs, h = fs * 1.05;
        const off = Math.abs(n[0]) * (w / 2) + Math.abs(n[1]) * (h / 2) + fs * 0.35;
        // rounded: the markup rendered on the server must equal what the browser computes (sqrt and trig differ in the last bits)
        const b: Box = { x: round2(F[0] + (T[0] - F[0]) * t + n[0] * side * off), y: round2(F[1] + (T[1] - F[1]) * t + n[1] * side * off), w, h };
        let clear = 40;
        for (const o of [...taken, ...placed]) if (boxesHit(b, o, 4)) clear = -20;
        lines.forEach((other, j) => { if (j !== i) clear = Math.min(clear, boxSegmentGap(b, other.from, other.to, fs * 0.5) - 2); });
        const bad = boxTouchesPoly(b, house) || !boxTouchesPoly(b, plot);
        const score = Math.min(clear, 12) - (bad ? 30 : 0) - Math.abs(t - 0.5) * 20;
        if (score > bestScore) { bestScore = score; best = b; }
      }
    }
    // a degenerate input (NaN scores) still gets a box: the middle of the line
    placed.push(best ?? { x: round2((F[0] + T[0]) / 2), y: round2((F[1] + T[1]) / 2), w: chars[i] * 0.62 * fs, h: fs * 1.05 });
  });
  return placed;
}

// ------------------------------------------------------------------------------------------------ contour labels

export interface PlacedContourLabel { x: number; y: number; angle: number; text: string; major: boolean; level: number }

/** Text angle on screen (degrees clockwise, in (-90, 90]) of a label that runs `angleDeg` counter-clockwise in the house frame. */
export function screenAngle(angleDeg: number, rot: number): number {
  let a = -angleDeg + rot;
  a = ((a % 180) + 180) % 180;
  return Math.round((a > 90 ? a - 180 : a) * 10) / 10;
}

/**
 * Keeps the contour labels that fit: inside the frame, not on the house or on other labels, not touching set-back lines.
 * `labels` are in house-frame metres (from `contourLabels`, text already formatted). Two labels of the same level keep at
 * least `minGap` units apart, so a long line is not labelled over and over.
 */
export function placeContourLabels(
  labels: readonly ContourLabel[], fs: number, rot: number, c: XY, frame: Frame,
  avoid: { polys: readonly (readonly XY[])[]; boxes: readonly Box[]; lines: readonly SetbackLine[] },
  minGap = 0,
): PlacedContourLabel[] {
  const out: PlacedContourLabel[] = [];
  const taken: Box[] = [...avoid.boxes];
  // coarse lines first, as the library orders them; a label that clashes is dropped, never moved off its line
  for (const l of [...labels].sort((a, b) => Number(b.major) - Number(a.major))) {
    const [x, y] = toScreen([l.x, l.y], rot, c);
    const angle = screenAngle(l.angleDeg, rot);
    const b = textBox(x, y, l.text.length, fs, angle);
    if (!boxInFrame(b, frame, fs * 0.6)) continue;
    if (taken.some((o) => boxesHit(b, o, fs * 0.4))) continue;
    if (avoid.polys.some((p) => boxTouchesPoly(b, p))) continue;
    if (avoid.lines.some((ln) => boxSegmentGap(b, ln.from, ln.to, fs * 0.4) < fs * 0.6)) continue;
    if (out.some((o) => o.level === l.level && Math.hypot(o.x - x, o.y - y) < minGap)) continue;
    taken.push(b);
    out.push({ x, y, angle, text: l.text, major: l.major, level: l.level });
  }
  return out;
}

// ------------------------------------------------------------------------------------------------ height grid

/** Points of a regular grid (house frame, `spacing` m, aligned to multiples of the spacing) that lie inside `plot`. */
export function gridPoints(plot: readonly XY[], spacing: number): XY[] {
  const xs = plot.map((p) => p[0]), ys = plot.map((p) => p[1]);
  const out: XY[] = [];
  for (let y = Math.ceil(Math.min(...ys) / spacing) * spacing; y <= Math.max(...ys); y += spacing) {
    for (let x = Math.ceil(Math.min(...xs) / spacing) * spacing; x <= Math.max(...xs); x += spacing) {
      if (pointInPolygon([x, y], plot)) out.push([x, y]);
    }
  }
  return out;
}

/** Spacing (m) of the height grid for a map drawn at `pxPerMetre`: wide enough that two neighbouring texts of `labelPx` do not meet. */
export function gridSpacing(pxPerMetre: number, labelPx: number): number {
  return [5, 10, 20].find((s) => s * pxPerMetre >= labelPx * 1.5) ?? 20;
}
