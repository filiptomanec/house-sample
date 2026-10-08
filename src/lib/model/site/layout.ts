// Resolves the declarative parts of site.json into coordinates: plot-relative paths, fences with their openings and posts,
// gates and pillars, hedges, street (with pavement and dropped kerbs), field and neighbour plots, driveway apron and walkway.
import {
  bboxOf, dist, distToPolygon, edgeDirection, edgeOutwardNormal, ensureCcw, expandBbox, insetPolygon, lerp2,
  pointAtLength, polylineLength, projectToPolyline, subPolyline, type Bbox, type Rect, type XY,
} from "./geometry";
import type { AccessKind, BoundaryRef, FenceModel, GateModel, HedgeModel, NeighbourModel, PillarModel, SiteModel } from "./siteSchema";
import type { OutdoorInput } from "./stats";

export const plotPolygon = (site: SiteModel): XY[] => ensureCcw(site.plot.polygon);

/** Bounding box of the terrain and zone domain: the plot plus the margin. */
export const siteBounds = (site: SiteModel): Bbox => expandBbox(bboxOf(site.plot.polygon), site.domain.margin);

const dedupe = (pts: XY[]): XY[] => pts.filter((p, i) => i === 0 || dist(p, pts[i - 1]) > 1e-9);

/**
 * Path along the boundary (moved `inset` metres into the plot) from one boundary reference to another,
 * walking in the polygon's vertex order and passing the vertices of the inset outline in between.
 * From {edge 0, t 0} to {edge n-1, t 1} the path runs once around the whole plot.
 */
export function pathAlongPlot(plot: readonly XY[], inset: number, from: BoundaryRef, to: BoundaryRef): XY[] {
  const ring = inset === 0 ? [...plot] : insetPolygon(plot, inset);
  const n = ring.length;
  const at = (r: BoundaryRef): XY => lerp2(ring[r.edge % n], ring[(r.edge + 1) % n], r.t);
  const out: XY[] = [at(from)];
  const sameEdgeForward = from.edge === to.edge && to.t >= from.t;
  if (!sameEdgeForward) {
    let e = from.edge % n;
    do {
      out.push(ring[(e + 1) % n]);
      e = (e + 1) % n;
    } while (e !== to.edge % n);
  }
  out.push(at(to));
  return dedupe(out);
}

/** Point on the offset of plot edge `edge` by `d` metres (outward positive), as a line [p, q]. */
export function offsetEdgeLine(plot: readonly XY[], edge: number, d: number): [XY, XY] {
  const n = edgeOutwardNormal(plot, edge);
  const a = plot[edge], b = plot[(edge + 1) % plot.length];
  return [[a[0] + n[0] * d, a[1] + n[1] * d], [b[0] + n[0] * d, b[1] + n[1] * d]];
}

/** y on the (non-vertical) line p-q at abscissa x. */
export const yOnLine = (line: readonly [XY, XY], x: number): number => {
  const [p, q] = line;
  return p[1] + ((q[1] - p[1]) * (x - p[0])) / (q[0] - p[0]);
};

const add = (a: XY, b: XY, k = 1): XY => [a[0] + b[0] * k, a[1] + b[1] * k];
const sideSign = (side: "+" | "-"): 1 | -1 => (side === "+" ? 1 : -1);

// ---------------------------------------------------------------------------------------------
// Access: driveway and walkway extended from the house model to the street

/** Width of the kerb stones when site.json does not give `street.kerbWidth` (m). */
export const DEFAULT_KERB_WIDTH = 0.15;
/** Reveal of a dropped kerb at a drive or walk crossing (m): a car rolls over it. */
export const DROPPED_KERB_REVEAL = 0.02;

export interface GateGeometry {
  /** Centre of the crossing on the plot boundary (at the centre of the paved strip). */
  center: XY;
  /** Width of the opening cut into the fence: leaf + 2 posts with a gate, else the clear opening. */
  width: number;
  /** Clear passage: the gate leaf, else `access.*.gateWidth` or the strip width + 2 x gateMargin. */
  opening: number;
}

export interface AccessGeometry {
  /** Paved strip from the end of the house-model area to the plot boundary (inside the plot). */
  driveApron: XY[];
  /** Continuation across the public verge to the carriageway edge (outside the plot). */
  driveVerge: XY[];
  driveGate: GateGeometry;
  walkApron: XY[];
  walkVerge: XY[];
  walkGate: GateGeometry;
  /** Rectangles of the outdoor areas the access was derived from, and their index in the outdoor list. */
  driveRect: Rect;
  walkRect: Rect;
  driveIndex: number;
  walkIndex: number;
  /** Dropped kerbs: the kerb strip along the carriageway edge where the drive and the walk verge cross it. */
  driveKerb: XY[];
  walkKerb: XY[];
}

function pickStrip(outdoor: readonly OutdoorInput[], type: string, streetLine: readonly [XY, XY]): { rect: Rect; index: number } {
  const cands = outdoor.map((o, index) => ({ o, index })).filter(({ o }) => o.type === type && o.rect);
  if (!cands.length) throw new Error(`access: no outdoor area of type "${type}" with a rect`);
  // The strip that reaches furthest towards the street.
  const score = (r: Rect) => r[3] - yOnLine(streetLine, (r[0] + r[2]) / 2);
  const best = cands.map(({ o, index }) => ({ rect: o.rect as Rect, index })).sort((a, b) => score(b.rect) - score(a.rect))[0];
  return best;
}

/** The gate of an access (at most one; validateSiteWithHouse reports more). */
export const gateOf = (site: SiteModel, access: AccessKind): GateModel | undefined => (site.gates ?? []).find((g) => g.access === access);

/** Extends the driveway and walkway strips of the house model to the street boundary and across the verge. */
export function accessGeometry(site: SiteModel, outdoor: readonly OutdoorInput[]): AccessGeometry {
  const plot = plotPolygon(site);
  const e = site.street.edge;
  const boundary = offsetEdgeLine(plot, e, 0);
  const carriage = offsetEdgeLine(plot, e, site.street.verge);
  const kerbInner = offsetEdgeLine(plot, e, site.street.verge - (site.street.kerbWidth ?? DEFAULT_KERB_WIDTH));
  const build = (rect: Rect, flare: number, margin: number, gateWidth: number | undefined, gate: GateModel | undefined) => {
    const [x0, , x1, y1] = rect;
    const yb0 = yOnLine(boundary, x0), yb1 = yOnLine(boundary, x1);
    const xa = x0 - flare, xb = x1 + flare;
    const yc0 = yOnLine(carriage, xa), yc1 = yOnLine(carriage, xb);
    const apron: XY[] = y1 < Math.max(yb0, yb1) ? [[x0, y1], [x1, y1], [x1, yb1], [x0, yb0]] : [];
    const verge: XY[] = [[x0, yb0], [x1, yb1], [xb, yc1], [xa, yc0]];
    const kerb: XY[] = [[xa, yOnLine(kerbInner, xa)], [xb, yOnLine(kerbInner, xb)], [xb, yc1], [xa, yc0]];
    const cx = (x0 + x1) / 2;
    const opening = gate ? gate.leaf : (gateWidth ?? x1 - x0 + 2 * margin);
    const width = gate ? gate.leaf + 2 * gate.postSize : opening;
    return { apron, verge, kerb, gate: { center: [cx, yOnLine(boundary, cx)] as XY, width, opening } };
  };
  const dw = site.access.driveway, ww = site.access.walkway;
  const drive = pickStrip(outdoor, dw.outdoorType, boundary);
  const walk = pickStrip(outdoor, ww.outdoorType, boundary);
  const d = build(drive.rect, dw.flare, dw.gateMargin, dw.gateWidth, gateOf(site, "driveway"));
  const w = build(walk.rect, 0, ww.gateMargin, ww.gateWidth, gateOf(site, "walkway"));
  return {
    driveApron: d.apron, driveVerge: d.verge, driveGate: d.gate, walkApron: w.apron, walkVerge: w.verge, walkGate: w.gate,
    driveRect: drive.rect, walkRect: walk.rect, driveIndex: drive.index, walkIndex: walk.index, driveKerb: d.kerb, walkKerb: w.kerb,
  };
}

/** Gate geometry of an access. */
export const accessGate = (access: AccessGeometry, kind: AccessKind): GateGeometry => (kind === "driveway" ? access.driveGate : access.walkGate);
/** Paved strip of an access. */
export const accessRect = (access: AccessGeometry, kind: AccessKind): Rect => (kind === "driveway" ? access.driveRect : access.walkRect);

// ---------------------------------------------------------------------------------------------
// Fences, gates, pillars, hedges

/** Depth of a gate leaf frame when the gate does not give `thickness` (m). */
export const DEFAULT_GATE_THICKNESS = 0.06;
/** Air between the fence and a sliding leaf running behind it (m). */
export const GATE_RUN_CLEARANCE = 0.03;

/** An opening cut into a fence path, in arc length along the uncut path. */
export interface FenceGap {
  from: number;
  to: number;
  /** What stands in it: a gate (posts and leaf), a pillar, or nothing (an opening without a gate). */
  kind: "gate" | "pillar" | "opening";
  access: AccessKind;
  /** Id of the gate or pillar, null for a plain opening. */
  ref: string | null;
}

export interface ResolvedFence {
  id: string;
  kind: FenceModel["kind"];
  height: number;
  thickness: number;
  /** Polyline pieces after cutting the openings for gates and pillars. */
  parts: XY[][];
  /** The uncut path along the boundary and the openings in it (arc lengths along `path`, sorted). */
  path: XY[];
  gaps: FenceGap[];
  /** slat_fence data (null for the other kinds). */
  plinthHeight: number | null;
  slat: FenceModel["slat"] | null;
  postSize: number | null;
  postSpacing: number | null;
  /**
   * Posts of a slat_fence (empty for the other kinds): at every corner of a part and evenly between, at most `postSpacing`
   * apart. A part that ends at a gate or a pillar has no post there (the gate post or the pillar carries the panel).
   */
  posts: XY[];
}

/** Where a crossing meets the fences: the fence it cuts, the arc length, the point, the direction of the edge and the inward normal. */
interface Placement {
  fence: number | null;
  s: number;
  p: XY;
  along: XY;
  inward: XY;
}

function placements(site: SiteModel, access: AccessGeometry): Record<AccessKind, Placement> {
  const plot = plotPolygon(site);
  const paths = site.fences.map((f) => pathAlongPlot(plot, f.inset, f.from, f.to));
  const place = (kind: AccessKind): Placement => {
    const g = accessGate(access, kind);
    for (let i = 0; i < site.fences.length; i++) {
      const f = site.fences[i];
      if (!f.gates) continue;
      const pr = projectToPolyline(g.center, paths[i]);
      if (pr.d >= 0.5 + f.inset) continue;
      const { p, tangent } = pointAtLength(paths[i], pr.s);
      return { fence: i, s: pr.s, p, along: tangent, inward: [-tangent[1], tangent[0]] };
    }
    // no fence: the gate stands on the street boundary itself
    const along = edgeDirection(plot, site.street.edge);
    return { fence: null, s: 0, p: g.center, along, inward: [-along[1], along[0]] };
  };
  return { driveway: place("driveway"), walkway: place("walkway") };
}

/** Arc-length span [from, to] of a pillar beside the opening of its access. */
function pillarSpan(pl: PillarModel, at: Placement, gate: GateGeometry): [number, number] {
  const k = sideSign(pl.side);
  const a = at.s + k * (gate.width / 2), b = at.s + k * (gate.width / 2 + pl.size[0]);
  return [Math.min(a, b), Math.max(a, b)];
}

/** Posts of one fence part: corners and even subdivisions; `bareStart` / `bareEnd` drop the end posts. */
function partPosts(part: readonly XY[], spacing: number, bareStart: boolean, bareEnd: boolean): XY[] {
  const out: XY[] = [];
  for (let i = 0; i + 1 < part.length; i++) {
    const a = part[i], b = part[i + 1];
    const n = Math.max(1, Math.ceil(dist(a, b) / spacing - 1e-9));
    for (let k = i === 0 ? 0 : 1; k <= n; k++) out.push(lerp2(a, b, k / n));
  }
  if (bareStart) out.shift();
  if (bareEnd) out.pop();
  return out;
}

function fencesWithGaps(site: SiteModel, access: AccessGeometry, at: Record<AccessKind, Placement>): ResolvedFence[] {
  const plot = plotPolygon(site);
  return site.fences.map((f, fi) => {
    const path = pathAlongPlot(plot, f.inset, f.from, f.to);
    const len = polylineLength(path);
    const closed = dist(path[0], path[path.length - 1]) < 1e-9;
    const gaps: FenceGap[] = [];
    if (f.gates) {
      for (const kind of ["driveway", "walkway"] as const) {
        const pl = at[kind];
        if (pl.fence !== fi) continue;
        const g = accessGate(access, kind);
        const gate = gateOf(site, kind);
        gaps.push({ from: pl.s - g.width / 2, to: pl.s + g.width / 2, kind: gate ? "gate" : "opening", access: kind, ref: gate?.id ?? null });
        for (const p of (site.pillars ?? []).filter((x) => x.access === kind)) {
          const [a, b] = pillarSpan(p, pl, g);
          gaps.push({ from: a, to: b, kind: "pillar", access: kind, ref: p.id });
        }
      }
    }
    gaps.sort((a, b) => a.from - b.from);
    // keep the complement of the gaps (clamped to the path)
    const spans: [number, number][] = [];
    let s = 0;
    for (const g of gaps) {
      const a = Math.max(0, g.from), b = Math.min(len, g.to);
      if (a > s + 1e-6) spans.push([s, a]);
      s = Math.max(s, b);
    }
    if (len > s + 1e-6) spans.push([s, len]);
    // pieces with their ends: an end at a gap is bare (the gate post or the pillar carries the panel)
    let pieces = spans.map(([a, b]) => ({ pts: subPolyline(path, a, b), bareStart: a > 1e-6, bareEnd: b < len - 1e-6 }));
    // a closed fence (once around the plot) with openings: the pieces before and after the start point are one piece
    if (closed && pieces.length > 1 && !pieces[0].bareStart && !pieces[pieces.length - 1].bareEnd) {
      const last = pieces[pieces.length - 1], first = pieces[0];
      pieces = [{ pts: dedupe([...last.pts, ...first.pts]), bareStart: last.bareStart, bareEnd: first.bareEnd }, ...pieces.slice(1, -1)];
    }
    pieces = pieces.filter((p) => p.pts.length >= 2);
    const parts = pieces.map((p) => p.pts);
    const spacing = f.kind === "slat_fence" && f.postSpacing ? f.postSpacing : null;
    let posts: XY[] = [];
    if (spacing) {
      for (const p of pieces) posts.push(...partPosts(p.pts, spacing, p.bareStart, p.bareEnd));
      // a closed fence without openings starts and ends at the same post
      if (closed && posts.length > 1 && dist(posts[0], posts[posts.length - 1]) < 1e-9) posts = posts.slice(0, -1);
    }
    return {
      id: f.id, kind: f.kind, height: f.height, thickness: f.thickness, parts, path, gaps,
      plinthHeight: f.plinthHeight ?? null, slat: f.slat ?? null, postSize: f.postSize ?? null, postSpacing: f.postSpacing ?? null, posts,
    };
  });
}

/** Removes the stretch of width `width` centred on the projection of `center` from a polyline. */
export function cutGap(path: readonly XY[], center: XY, width: number): XY[][] {
  const len = polylineLength(path);
  const { s } = projectToPolyline(center, path);
  const a = Math.max(0, s - width / 2), b = Math.min(len, s + width / 2);
  const out: XY[][] = [];
  if (a > 1e-6) out.push(subPolyline(path, 0, a));
  if (b < len - 1e-6) out.push(subPolyline(path, b, len));
  return out;
}

/** Fences with the openings for the driveway and walkway (gates and pillars stand in them) and their posts. */
export function resolveFences(site: SiteModel, access: AccessGeometry): ResolvedFence[] {
  return fencesWithGaps(site, access, placements(site, access));
}

/** A rectangle along a direction: from arc position a to b around `origin` (positions along `along`), offset and thickness across. */
function band(origin: XY, along: XY, inward: XY, a: number, b: number, offset: number, thickness: number): XY[] {
  const lo = offset - thickness / 2, hi = offset + thickness / 2;
  const at = (s: number, o: number): XY => add(add(origin, along, s), inward, o);
  return [at(a, lo), at(b, lo), at(b, hi), at(a, hi)];
}

export interface ResolvedGate {
  id: string;
  access: AccessKind;
  kind: GateModel["kind"];
  leaf: number;
  height: number;
  postSize: number;
  /** Depth of the leaf frame and the counterbalance tail of a sliding leaf (m). */
  thickness: number;
  tail: number;
  side: GateModel["side"];
  /** Fence the gate stands in (null: no fence crosses the access, the gate stands on the boundary) and its arc length. */
  fence: string | null;
  s: number;
  /** Centre of the opening on the fence line, unit vector along the fence (edge direction) and into the plot. */
  center: XY;
  along: XY;
  inward: XY;
  /** Clear opening between the posts (= leaf) and the opening cut into the fence (leaf + 2 posts). */
  opening: number;
  width: number;
  /** Centres of the two square posts, on the "-" and the "+" side. */
  posts: [XY, XY];
  /**
   * The moving part in the closed position. Swing: the leaf in the fence line. Sliding: leaf + tail on the plot side of the
   * fence (offset `park.offset`), the tail behind the post on the park side.
   */
  leafPolygon: XY[];
  /** Sliding: the moving part in the open position and its span along the fence (arc lengths on the fence path). */
  park: { from: XY; to: XY; offset: number; span: [number, number]; polygon: XY[] } | null;
  /** Swing: hinge, radius and the swept quarter circle (the leaf opens into the plot). */
  swing: { hinge: XY; radius: number; closedEnd: XY; openEnd: XY; arc: XY[] } | null;
}

export interface ResolvedPillar {
  id: string;
  access: AccessKind;
  side: PillarModel["side"];
  /** Width along the fence, depth across, height (m). */
  size: [number, number, number];
  items: PillarModel["items"];
  fence: string | null;
  /** Plan centre, unit vector along the fence, unit vector into the plot (the street face looks the other way). */
  center: XY;
  along: XY;
  inward: XY;
  footprint: XY[];
}

export interface BoundaryLayout {
  fences: ResolvedFence[];
  gates: ResolvedGate[];
  pillars: ResolvedPillar[];
}

/** Fences with their openings, the gates (posts, leaf, park span or swing arc) and the pillars, in one consistent layout. */
export function resolveBoundary(site: SiteModel, access: AccessGeometry): BoundaryLayout {
  const at = placements(site, access);
  const fences = fencesWithGaps(site, access, at);
  const fenceT = (pl: Placement): number => (pl.fence === null ? 0 : site.fences[pl.fence].thickness);
  const gates: ResolvedGate[] = (site.gates ?? []).map((g) => {
    const pl = at[g.access];
    const k = sideSign(g.side);
    const thickness = g.thickness ?? DEFAULT_GATE_THICKNESS;
    const tail = g.kind === "sliding" ? (g.tail ?? 0) : 0;
    const width = g.leaf + 2 * g.postSize;
    const posts: [XY, XY] = [add(pl.p, pl.along, -(g.leaf + g.postSize) / 2), add(pl.p, pl.along, (g.leaf + g.postSize) / 2)];
    let leafPolygon: XY[];
    let park: ResolvedGate["park"] = null;
    let swing: ResolvedGate["swing"] = null;
    if (g.kind === "sliding") {
      const offset = fenceT(pl) / 2 + thickness / 2 + GATE_RUN_CLEARANCE;
      const closedA = -k * (g.leaf / 2), closedB = k * (g.leaf / 2 + tail);
      leafPolygon = band(pl.p, pl.along, pl.inward, Math.min(closedA, closedB), Math.max(closedA, closedB), offset, thickness);
      const openA = k * (g.leaf / 2), openB = k * (g.leaf / 2 + g.leaf + tail);
      const lo = Math.min(openA, openB), hi = Math.max(openA, openB);
      park = {
        from: add(pl.p, pl.along, openA),
        to: add(pl.p, pl.along, openB),
        offset,
        span: [pl.s + lo, pl.s + hi],
        polygon: band(pl.p, pl.along, pl.inward, lo, hi, offset, thickness),
      };
    } else {
      leafPolygon = band(pl.p, pl.along, pl.inward, -g.leaf / 2, g.leaf / 2, 0, thickness);
      const hinge = add(pl.p, pl.along, k * (g.leaf / 2));
      const closedEnd = add(pl.p, pl.along, -k * (g.leaf / 2));
      const openEnd = add(hinge, pl.inward, g.leaf);
      const arc: XY[] = [];
      for (let i = 0; i <= 12; i++) {
        const t = ((Math.PI / 2) * i) / 12;
        // from the closed direction (-k along) towards the inward normal
        const dir: XY = [-k * pl.along[0] * Math.cos(t) + pl.inward[0] * Math.sin(t), -k * pl.along[1] * Math.cos(t) + pl.inward[1] * Math.sin(t)];
        arc.push(add(hinge, dir, g.leaf));
      }
      swing = { hinge, radius: g.leaf, closedEnd, openEnd, arc };
    }
    return {
      id: g.id, access: g.access, kind: g.kind, leaf: g.leaf, height: g.height, postSize: g.postSize, thickness, tail, side: g.side,
      fence: pl.fence === null ? null : site.fences[pl.fence].id, s: pl.s, center: pl.p, along: pl.along, inward: pl.inward,
      opening: g.leaf, width, posts, leafPolygon, park, swing,
    };
  });
  const pillars: ResolvedPillar[] = (site.pillars ?? []).map((p) => {
    const pl = at[p.access];
    const g = accessGate(access, p.access);
    const [a, b] = pillarSpan(p, pl, g);
    const [w, d] = p.size;
    // the street face of the pillar is flush with the street face of the fence
    const offset = d / 2 - fenceT(pl) / 2;
    const mid = (a + b) / 2 - pl.s;
    const center = add(add(pl.p, pl.along, mid), pl.inward, offset);
    return {
      id: p.id, access: p.access, side: p.side, size: [...p.size] as [number, number, number], items: [...p.items],
      fence: pl.fence === null ? null : site.fences[pl.fence].id, center, along: pl.along, inward: pl.inward,
      footprint: band(center, pl.along, pl.inward, -w / 2, w / 2, 0, d),
    };
  });
  return { fences, gates, pillars };
}

/** Gates with posts, leaf, park span (sliding) or swing arc (swing). */
export const resolveGates = (site: SiteModel, access: AccessGeometry): ResolvedGate[] => resolveBoundary(site, access).gates;
/** Pillars beside the gates. */
export const resolvePillars = (site: SiteModel, access: AccessGeometry): ResolvedPillar[] => resolveBoundary(site, access).pillars;

/** Distance from a point to a gate's moving area (park band or swing sector), 0 inside. */
export function distToGateSweep(g: ResolvedGate, q: XY): number {
  if (g.park) return distToPolygon(q, g.park.polygon);
  if (g.swing) {
    const sector: XY[] = [g.swing.hinge, ...g.swing.arc];
    return distToPolygon(q, sector);
  }
  return Infinity;
}

export interface ResolvedHedge {
  id: string;
  species: string;
  height: number;
  width: number;
  path: XY[];
}

export const resolveHedges = (site: SiteModel): ResolvedHedge[] => {
  const plot = plotPolygon(site);
  return site.hedges.map((h: HedgeModel) => ({ id: h.id, species: h.species, height: h.height, width: h.width, path: pathAlongPlot(plot, h.inset, h.from, h.to) }));
};

// ---------------------------------------------------------------------------------------------
// Street, field, neighbour plots

export interface StreetGeometry {
  /** Public strip between the plot boundary and the carriageway (pavement and green strip). */
  verge: XY[];
  /** The pavement along the kerb (null when `street.pavement` is 0) and the green rest of the verge (null when none is left). */
  pavement: XY[] | null;
  green: XY[] | null;
  carriageway: XY[];
  /** Centre line of the carriageway. */
  centreLine: [XY, XY];
}

export function streetGeometry(site: SiteModel): StreetGeometry {
  const plot = plotPolygon(site);
  const e = site.street.edge;
  const ext = site.domain.margin + 30;
  const d = edgeDirection(plot, e), n = edgeOutwardNormal(plot, e);
  const a = plot[e], b = plot[(e + 1) % plot.length];
  const a0: XY = [a[0] - d[0] * ext, a[1] - d[1] * ext], b0: XY = [b[0] + d[0] * ext, b[1] + d[1] * ext];
  const shift = (p: XY, k: number): XY => [p[0] + n[0] * k, p[1] + n[1] * k];
  const v = site.street.verge, c = site.street.carriageway;
  const pw = Math.min(v, site.street.pavement ?? 0);
  const strip = (k0: number, k1: number): XY[] => [shift(a0, k0), shift(b0, k0), shift(b0, k1), shift(a0, k1)];
  return {
    verge: strip(0, v),
    pavement: pw > 0 ? strip(v - pw, v) : null,
    green: v - pw > 1e-9 ? strip(0, v - pw) : null,
    carriageway: [shift(a0, v), shift(b0, v), shift(b0, v + c), shift(a0, v + c)],
    centreLine: [shift(a0, v + c / 2), shift(b0, v + c / 2)],
  };
}

/** Open field beyond the field edge, wide enough to cover the whole domain. */
export function fieldZone(site: SiteModel): XY[] {
  const plot = plotPolygon(site);
  const e = site.field.edge;
  const ext = site.domain.margin + 30;
  const d = edgeDirection(plot, e), n = edgeOutwardNormal(plot, e);
  const a = plot[e], b = plot[(e + 1) % plot.length];
  const a0: XY = [a[0] - d[0] * ext, a[1] - d[1] * ext], b0: XY = [b[0] + d[0] * ext, b[1] + d[1] * ext];
  const k = site.field.depth;
  return [a0, b0, [b0[0] + n[0] * k, b0[1] + n[1] * k], [a0[0] + n[0] * k, a0[1] + n[1] * k]];
}

/** Plot of a neighbour: the shared edge plus `plotWidth` along the neighbouring edges (their lines are continued). */
export function neighbourPlot(site: SiteModel, nb: NeighbourModel): XY[] {
  const plot = plotPolygon(site);
  const n = plot.length;
  const e = nb.edge;
  const next = edgeDirection(plot, (e + 1) % n), prev = edgeDirection(plot, (e + n - 1) % n);
  const w = nb.plotWidth;
  const v0 = plot[e], v1 = plot[(e + 1) % n];
  return ensureCcw([v0, v1, [v1[0] - next[0] * w, v1[1] - next[1] * w], [v0[0] + prev[0] * w, v0[1] + prev[1] * w]]);
}
