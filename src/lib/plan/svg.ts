// SVG markup of a plan drawing (see planGeometry.ts). Pure string building: no DOM, no React.
//
//  * planLayers(drawing)  the geometry as groups of markup, ready for `dangerouslySetInnerHTML` of a <g> (the floor plan page
//                         inserts them between its interactive layers and switches them with CSS classes);
//  * planToSvg(drawing)   one standalone <svg> (print, export, tests) with room numbers and the overall dimensions.
//
// Colours are tokens (`var(--ink)`); a standalone file passes `palette` to replace them by resolved colours. Stroke widths
// are screen pixels (`vector-effect: non-scaling-stroke`), so lines stay crisp at every zoom.
import type { PlanDrawing, PlanOpening, PlanRoom } from "./planGeometry";
import { PLAN_FILL, arcPath, esc, mm, pathOf, viewBoxOf, type PlanPt } from "./shared";

export { arcPath, esc, pathOf };

export interface PlanLayers {
  outdoor: string;
  furniture: string;
  fixtures: string;
  walls: string;
  openings: string;
  posts: string;
  dims: string;
  compass: string;
}

/** Marker size of a post and tick length of a dimension line, m. */
const POST = 0.16;
const TICK = 0.1;

type Paint = (token: string) => string;
const paintWith = (palette?: Record<string, string>): Paint => (token) => palette?.[token] ?? `var(${token})`;

const line = (a: PlanPt, b: PlanPt, stroke: string, w: number, extra = ""): string =>
  `<line x1="${a[0]}" y1="${a[1]}" x2="${b[0]}" y2="${b[1]}" stroke="${stroke}" stroke-width="${w}" vector-effect="non-scaling-stroke"${extra}/>`;
const rect = (r: readonly number[], attrs: string): string => `<rect x="${r[0]}" y="${r[1]}" width="${mm(r[2] - r[0])}" height="${mm(r[3] - r[1])}" ${attrs}/>`;

function openingMarkup(o: PlanOpening, c: Paint): string {
  const parts: string[] = [];
  const g = o.gap, wide = g[2] - g[0] >= g[3] - g[1]; // wall runs along x when the gap is wider than deep
  if (o.kind === "door") {
    // an interior doorway: only the two cut ends of the wall
    parts.push(wide ? line([g[0], g[1]], [g[0], g[3]], c("--ink-2"), 1) + line([g[2], g[1]], [g[2], g[3]], c("--ink-2"), 1)
      : line([g[0], g[1]], [g[2], g[1]], c("--ink-2"), 1) + line([g[0], g[3]], [g[2], g[3]], c("--ink-2"), 1));
  } else parts.push(rect(g, `fill="${c("--surface")}" stroke="${c("--ink-2")}" stroke-width="1" vector-effect="non-scaling-stroke"`));
  for (const s of o.segments) {
    if (s.role === "glass") parts.push(line(s.a, s.b, c("--plan-window"), 1.8));
    else if (s.role === "leaf") parts.push(line(s.a, s.b, c("--plan-door"), 1.5));
    else parts.push(line(s.a, s.b, c("--ink-2"), 1.2, ` stroke-dasharray="6 3"`));
  }
  if (o.arc) {
    parts.push(`<path d="${arcPath(o.arc)}" fill="none" stroke="${c("--plan-door")}" stroke-width="1" stroke-dasharray="3 2" vector-effect="non-scaling-stroke"/>`);
  }
  return `<g data-kind="${o.kind}">${parts.join("")}</g>`;
}

/** The geometry of a drawing as groups of SVG markup. Furniture is empty when the drawing was built without it. */
export function planLayers(d: PlanDrawing, palette?: Record<string, string>): PlanLayers {
  const c = paintWith(palette);
  const outdoor = d.outdoor.map((o) => rect(o.rect,
    `fill="${c(PLAN_FILL[o.fill])}" stroke="${c("--plan-fixture")}" stroke-width="1" vector-effect="non-scaling-stroke"${o.covered ? ` stroke-dasharray="5 3"` : ""}`)).join("");
  const furniture = d.furniture.map((f) => rect(f.rect, `rx="0.03" fill="none" stroke="${c("--plan-fixture")}" stroke-width="1" vector-effect="non-scaling-stroke"`)
    + line(f.back[0], f.back[1], c("--plan-fixture"), 1)).join("");
  const fixtures = d.lightpipes.map((l) => `<circle cx="${l.at[0]}" cy="${l.at[1]}" r="${l.r}" fill="none" stroke="${c("--plan-fixture")}" stroke-width="1" stroke-dasharray="3 2" vector-effect="non-scaling-stroke"/>`).join("")
    + d.screens.map((s) => line(s.a, s.b, c("--ink-3"), 3, ` stroke-dasharray="2 2"`)).join("");
  const walls = d.walls.map((w) => `<path d="${pathOf(w.rings)}" fill="${c(w.kind === "partition" ? "--ink-2" : "--ink")}" fill-rule="evenodd" data-kind="${w.kind}"/>`).join("");
  const openings = d.openings.map((o) => openingMarkup(o, c)).join("");
  const posts = d.outdoor.flatMap((o) => o.posts).map((p) => rect([p[0] - POST / 2, p[1] - POST / 2, p[0] + POST / 2, p[1] + POST / 2], `fill="${c("--ink")}"`)).join("");
  const dims = d.dimensions.map((m) => {
    const tick = (p: PlanPt) => line([p[0] - TICK, p[1] + TICK], [p[0] + TICK, p[1] - TICK], c("--plan-dim"), 1.4);
    return line(m.line[0], m.line[1], c("--plan-dim"), 1) + m.ext.map(([a, b]) => line(a, b, c("--plan-dim"), 0.8)).join("") + tick(m.line[0]) + tick(m.line[1]);
  }).join("");
  // north arrow: shaft and head of one metre, pointing up before the rotation
  const n = d.north;
  const arrow = `<g transform="translate(${n.at[0]},${n.at[1]}) rotate(${n.angleDeg})" fill="none" stroke="${c("--ink")}" stroke-width="1.6" stroke-linejoin="round" vector-effect="non-scaling-stroke">`
    + `<path d="M0,0.5V-0.5M-0.16,-0.24L0,-0.5L0.16,-0.24" vector-effect="non-scaling-stroke"/></g>`;
  const sc = d.scale, ticks = Array.from({ length: sc.length + 1 }, (_, i) => line([sc.at[0] + i, sc.at[1] - 0.1], [sc.at[0] + i, sc.at[1] + 0.1], c("--ink"), 1.2)).join("");
  const bar = line(sc.at, [sc.at[0] + sc.length, sc.at[1]], c("--ink"), 1.8) + ticks;
  return { outdoor, furniture, fixtures, walls, openings, posts, dims, compass: arrow + bar };
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
