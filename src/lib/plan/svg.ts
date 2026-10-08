// SVG markup of a plan drawing (see planGeometry.ts). Pure string building: no DOM, no React.
//
//  * planLayers(drawing)  the geometry as groups of markup, ready for `dangerouslySetInnerHTML` of a <g> (the floor plan page
//                         inserts them between its interactive layers and switches them with CSS classes);
//  * planToSvg(drawing)   one standalone <svg> (print, export, tests) with room numbers and the overall dimensions.
//
// Colours are tokens (`var(--ink)`); a standalone file passes `palette` to replace them by resolved colours. Stroke widths
// are screen pixels (`vector-effect: non-scaling-stroke`), so lines stay crisp at every zoom.
import type { PlanDrawing, PlanOpening, PlanOutdoor, PlanRoom } from "./planGeometry";
import { PLAN_FILL, arcPath, esc, mm, pathOf, viewBoxOf, type PlanPt, type PlanRect } from "./shared";

export { arcPath, esc, pathOf };

export interface PlanLayers {
  outdoor: string;
  furniture: string;
  fixtures: string;
  walls: string;
  openings: string;
  posts: string;
  dims: string;
  /** North symbol and scale bar together (kept for consumers that place both as one layer). */
  compass: string;
  /** The north symbol alone (in metres, at `drawing.north`) and the scale bar alone. */
  north: string;
  scale: string;
}

/** Tick length of a dimension line, m. Posts are drawn at the size the model gives them. */
const TICK = 0.1;
/** Radius of the north symbol of a standalone drawing, m (the page draws its own at a fixed size on screen). */
const NORTH_R = 0.4;

type Paint = (token: string) => string;
const paintWith = (palette?: Record<string, string>): Paint => (token) => palette?.[token] ?? `var(${token})`;

const line = (a: PlanPt, b: PlanPt, stroke: string, w: number, extra = ""): string =>
  `<line x1="${a[0]}" y1="${a[1]}" x2="${b[0]}" y2="${b[1]}" stroke="${stroke}" stroke-width="${w}" vector-effect="non-scaling-stroke"${extra}/>`;
const rect = (r: readonly number[], attrs: string): string => `<rect x="${r[0]}" y="${r[1]}" width="${mm(r[2] - r[0])}" height="${mm(r[3] - r[1])}" ${attrs}/>`;

/** Window glass: two thin lines inside the wall, a sixth of the wall thickness either side of the axis. */
function doubleGlass(a: PlanPt, b: PlanPt, gap: PlanRect, wide: boolean, c: Paint): string {
  const off = (wide ? gap[3] - gap[1] : gap[2] - gap[0]) / 6;
  const shift = (p: PlanPt, k: number): PlanPt => (wide ? [p[0], mm(p[1] + k)] : [mm(p[0] + k), p[1]]);
  return line(shift(a, -off), shift(b, -off), c("--plan-window"), 0.9) + line(shift(a, off), shift(b, off), c("--plan-window"), 0.9);
}

function openingMarkup(o: PlanOpening, c: Paint): string {
  const parts: string[] = [];
  const g = o.gap, wide = g[2] - g[0] >= g[3] - g[1]; // wall runs along x when the gap is wider than deep
  if (o.kind === "door") {
    // an interior doorway: only the two cut ends of the wall
    parts.push(wide ? line([g[0], g[1]], [g[0], g[3]], c("--ink-2"), 1) + line([g[2], g[1]], [g[2], g[3]], c("--ink-2"), 1)
      : line([g[0], g[1]], [g[2], g[1]], c("--ink-2"), 1) + line([g[0], g[3]], [g[2], g[3]], c("--ink-2"), 1));
  } else parts.push(rect(g, `fill="${c("--surface")}" stroke="${c("--ink-2")}" stroke-width="0.75" vector-effect="non-scaling-stroke"`));
  for (const s of o.segments) {
    // a window gets the double line; the two panes of a sliding wall are single lines, already offset
    if (s.role === "glass") parts.push(o.kind === "slider" ? line(s.a, s.b, c("--plan-window"), 1) : doubleGlass(s.a, s.b, g, wide, c));
    else if (s.role === "leaf") parts.push(line(s.a, s.b, c("--plan-door"), 1.2));
    else parts.push(line(s.a, s.b, c("--ink-2"), 1.2, ` stroke-dasharray="6 3"`));
  }
  if (o.arc) {
    parts.push(`<path d="${arcPath(o.arc)}" fill="none" stroke="${c("--plan-door")}" stroke-width="0.75" vector-effect="non-scaling-stroke"/>`);
  }
  return `<g data-kind="${o.kind}">${parts.join("")}</g>`;
}

/** Spacing of the deck boards and size of the paving tiles, m (aligned to the plan origin, so neighbouring areas match). */
const BOARD = 0.2;
const TILE = 0.5;

/** Horizontal lines every `step` inside `r`, interrupted by `holes` (plan rects). */
function boardLines(r: PlanRect, holes: readonly PlanRect[], step: number, stroke: string): string {
  let out = "";
  for (let y = Math.ceil((r[1] + 1e-6) / step) * step; y < r[3] - 1e-6; y += step) {
    const yy = mm(y);
    let runs: [number, number][] = [[r[0], r[2]]];
    for (const h of holes) {
      if (yy <= h[1] || yy >= h[3]) continue;
      runs = runs.flatMap(([a, b]) => {
        const keep: [number, number][] = h[2] <= a || h[0] >= b ? [[a, b]] : [[a, Math.min(b, h[0])], [Math.max(a, h[2]), b]];
        return keep.filter(([p, q]) => q - p > 1e-6);
      });
    }
    for (const [a, b] of runs) out += line([a, yy], [b, yy], stroke, 1);
  }
  return out;
}

/** A square grid of `step` inside `r` (the joints of a tiled surface). */
function tileGrid(r: PlanRect, step: number, stroke: string): string {
  let out = "";
  for (let x = Math.ceil((r[0] + 1e-6) / step) * step; x < r[2] - 1e-6; x += step) out += line([mm(x), r[1]], [mm(x), r[3]], stroke, 0.75);
  for (let y = Math.ceil((r[1] + 1e-6) / step) * step; y < r[3] - 1e-6; y += step) out += line([r[0], mm(y)], [r[2], mm(y)], stroke, 0.75);
  return out;
}

/** One outdoor area: fill, its surface pattern (tiles, deck boards or water), outline; covered areas get a dashed edge (the roof above). */
function outdoorMarkup(o: PlanOutdoor, c: Paint): string {
  const edge = `stroke="${c("--plan-fixture")}" stroke-width="1" vector-effect="non-scaling-stroke"${o.covered ? ` stroke-dasharray="5 3"` : ""}`;
  if (o.pool) {
    // coping ring (light stone) and the water inside it
    return `<g class="pl-od" data-fill="pool">${rect(o.pool.outer, `class="pl-coping" fill="${c("--surface-2")}" ${edge}`)}`
      + rect(o.pool.water, `class="pl-water" fill="${c(PLAN_FILL.pool)}" stroke="${c("--plan-window")}" stroke-width="0.75" vector-effect="non-scaling-stroke"`) + `</g>`;
  }
  const pattern = o.fill === "terrace" ? boardLines(o.rect, o.holes, BOARD, c("--plan-hatch"))
    : `<g stroke-opacity="0.08">${tileGrid(o.rect, TILE, c("--ink"))}</g>`;
  return `<g class="pl-od" data-fill="${o.fill}">${rect(o.rect, `class="pl-od-fill" fill="${c(PLAN_FILL[o.fill])}" stroke="none"`)}${pattern}${rect(o.rect, `fill="none" ${edge}`)}</g>`;
}

/** North symbol of `r` metres: a circle and a half-filled arrow through it, pointing up before the rotation. */
export function northSymbol(r: number, ink: string, paper: string): string {
  const tip = mm(-r * 1.5), tail = mm(r * 0.75), wing = mm(r * 0.45), notch = mm(r * 0.3);
  return `<circle r="${r}" fill="none" stroke="${ink}" stroke-width="1" vector-effect="non-scaling-stroke"/>`
    + `<path d="M0,${tip}L${-wing},${tail}L0,${notch}Z" fill="${ink}"/>`
    + `<path d="M0,${tip}L${wing},${tail}L0,${notch}Z" fill="${paper}" stroke="${ink}" stroke-width="1" stroke-linejoin="round" vector-effect="non-scaling-stroke"/>`;
}

/** The geometry of a drawing as groups of SVG markup. Furniture is empty when the drawing was built without it. */
export function planLayers(d: PlanDrawing, palette?: Record<string, string>): PlanLayers {
  const c = paintWith(palette);
  const outdoor = d.outdoor.map((o) => outdoorMarkup(o, c)).join("");
  const furniture = d.furniture.map((f) => rect(f.rect, `rx="0.03" fill="none" stroke="${c("--plan-fixture")}" stroke-width="1" vector-effect="non-scaling-stroke"`)
    + line(f.back[0], f.back[1], c("--plan-fixture"), 1)).join("");
  const fixtures = d.lightpipes.map((l) => `<circle cx="${l.at[0]}" cy="${l.at[1]}" r="${l.r}" fill="none" stroke="${c("--plan-fixture")}" stroke-width="1" stroke-dasharray="3 2" vector-effect="non-scaling-stroke"/>`).join("")
    + d.screens.map((s) => line(s.a, s.b, c("--ink-3"), 3, ` stroke-dasharray="2 2"`)).join("");
  const walls = d.walls.map((w) => `<path d="${pathOf(w.rings)}" fill="${c(w.kind === "partition" ? "--ink-2" : "--ink")}" fill-rule="evenodd" data-kind="${w.kind}"/>`).join("");
  const openings = d.openings.map((o) => openingMarkup(o, c)).join("");
  const posts = d.outdoor.flatMap((o) => o.posts.map((p) => {
    const h = (o.postSize ?? 0) / 2;
    return h > 0 ? rect([mm(p[0] - h), mm(p[1] - h), mm(p[0] + h), mm(p[1] + h)], `fill="${c("--ink")}"`) : "";
  })).join("");
  const dims = d.dimensions.map((m) => {
    const tick = (p: PlanPt) => line([p[0] - TICK, p[1] + TICK], [p[0] + TICK, p[1] - TICK], c("--plan-dim"), 1.4);
    return line(m.line[0], m.line[1], c("--plan-dim"), 1) + m.ext.map(([a, b]) => line(a, b, c("--plan-dim"), 0.8)).join("") + tick(m.line[0]) + tick(m.line[1]);
  }).join("");
  // north symbol (a circle of NORTH_R metres with a half-filled arrow), turned against the bearing of the house
  const n = d.north;
  const north = `<g transform="translate(${n.at[0]},${n.at[1]}) rotate(${n.angleDeg})">${northSymbol(NORTH_R, c("--ink"), c("--surface"))}</g>`;
  const sc = d.scale, ticks = Array.from({ length: sc.length + 1 }, (_, i) => {
    const h = i === 0 || i === sc.length ? 0.14 : 0.08;
    return line([sc.at[0] + i, sc.at[1] - h], [sc.at[0] + i, sc.at[1] + h], c("--ink"), 1);
  }).join("");
  const bar = line(sc.at, [sc.at[0] + sc.length, sc.at[1]], c("--ink"), 1.4) + ticks;
  return { outdoor, furniture, fixtures, walls, openings, posts, dims, compass: north + bar, north, scale: bar };
}

export interface PlanSvgOptions {
  furniture?: boolean;
  /** Fill the rooms by their zone colour (default true). */
  zones?: boolean;
  /** Overall dimensions with their values (default true). */
  dims?: boolean;
  /** Replaces `var(--token)` by resolved colours, (token name to colour string) for a file that has no stylesheet. */
  palette?: Record<string, string>;
  /** Text of room labels (default: the id) and number formats; without `formatArea` only the label is printed. */
  roomLabel?: (r: PlanRoom) => string;
  formatArea?: (m2: number) => string;
  formatLength?: (m: number) => string;
  /** Accessible name of the drawing. */
  title?: string;
}

/** A standalone SVG document of the drawing. The font size scales with the drawing so that the file prints legibly. */
export function planToSvg(d: PlanDrawing, o: PlanSvgOptions = {}): string {
  const { furniture = true, zones = true, dims = true, palette, roomLabel = (r) => r.id, formatArea, formatLength } = o;
  const c = paintWith(palette), L = planLayers(d, palette);
  const fs = mm(d.viewBox.w / 90);
  const txt = (p: PlanPt, s: string, size: number, extra = "") => `<text x="${p[0]}" y="${p[1]}" font-size="${size}" fill="${c("--ink")}" font-family="var(--font-mono), monospace" text-anchor="middle"${extra}>${esc(s)}</text>`;
  const rooms = zones ? d.rooms.map((r) => `<path d="${pathOf(r.rings)}" fill="${c(PLAN_FILL[r.fill])}" fill-rule="evenodd"/>`).join("") : "";
  const labels = d.rooms.map((r) => {
    const [x, y] = r.label.at;
    return txt([x, y - (formatArea ? fs * 0.2 : -fs * 0.35)], roomLabel(r), fs, ` font-weight="600"`) + (formatArea ? txt([x, y + fs * 1.15], formatArea(r.area), fs * 0.85) : "");
  }).join("");
  const dimText = dims && formatLength ? d.dimensions.map((m) => {
    const vertical = m.axis === "depth";
    const at: PlanPt = vertical ? [m.text[0] + fs * 0.9, m.text[1]] : [m.text[0], m.text[1] + fs * 1.5];
    return txt(vertical ? [0, 0] : at, formatLength(m.value), fs * 0.9, vertical ? ` transform="translate(${at[0]},${at[1]}) rotate(-90)"` : "");
  }).join("") : "";
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBoxOf(d)}" role="img"${o.title ? ` aria-label="${esc(o.title)}"` : ""}>`
    + (o.title ? `<title>${esc(o.title)}</title>` : "")
    + L.outdoor + rooms + (furniture ? L.furniture : "") + L.fixtures + L.walls + L.openings + L.posts + (dims ? L.dims : "") + L.compass + labels + dimText + `</svg>`;
}
