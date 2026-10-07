// Resolves the declarative parts of site.json into coordinates: plot-relative paths, fences with gates, hedges,
// street, field and neighbour plots, driveway apron and walkway.
import {
  bboxOf, dist, edgeDirection, edgeOutwardNormal, ensureCcw, expandBbox, insetPolygon, lerp2,
  polylineLength, projectToPolyline, subPolyline, type Bbox, type Rect, type XY,
} from "./geometry";
import type { BoundaryRef, FenceModel, HedgeModel, NeighbourModel, SiteModel } from "./siteSchema";
import type { OutdoorInput } from "./stats";

export const plotPolygon = (site: SiteModel): XY[] => ensureCcw(site.plot.polygon);

/** Bounding box of the terrain and zone domain: the plot plus the margin. */
export const siteBounds = (site: SiteModel): Bbox => expandBbox(bboxOf(site.plot.polygon), site.domain.margin);

const dedupe = (pts: XY[]): XY[] => pts.filter((p, i) => i === 0 || dist(p, pts[i - 1]) > 1e-9);

/**
 * Path along the boundary (moved `inset` metres into the plot) from one boundary reference to another,
 * walking in the polygon's vertex order and passing the vertices of the inset outline in between.
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

// ---------------------------------------------------------------------------------------------
// Access: driveway and walkway extended from the house model to the street

export interface GateGeometry {
  /** Opening in the street fence (centre on the boundary, along-fence width in metres). */
  center: XY;
  width: number;
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
  /** Rectangles of the outdoor areas the access was derived from. */
  driveRect: Rect;
  walkRect: Rect;
}

function pickStrip(outdoor: readonly OutdoorInput[], type: string, streetLine: readonly [XY, XY]): Rect {
  const cands = outdoor.filter((o) => o.type === type && o.rect);
  if (!cands.length) throw new Error(`access: no outdoor area of type "${type}" with a rect`);
  // The strip that reaches furthest towards the street.
  const score = (r: Rect) => r[3] - yOnLine(streetLine, (r[0] + r[2]) / 2);
  return cands.map((o) => o.rect as Rect).sort((a, b) => score(b) - score(a))[0];
}

/** Extends the driveway and walkway strips of the house model to the street boundary and across the verge. */
export function accessGeometry(site: SiteModel, outdoor: readonly OutdoorInput[]): AccessGeometry {
  const plot = plotPolygon(site);
  const e = site.street.edge;
  const boundary = offsetEdgeLine(plot, e, 0);
  const carriage = offsetEdgeLine(plot, e, site.street.verge);
  const build = (rect: Rect, flare: number, margin: number) => {
    const [x0, , x1, y1] = rect;
    const yb0 = yOnLine(boundary, x0), yb1 = yOnLine(boundary, x1);
    const yc0 = yOnLine(carriage, x0 - flare), yc1 = yOnLine(carriage, x1 + flare);
    const apron: XY[] = y1 < Math.max(yb0, yb1) ? [[x0, y1], [x1, y1], [x1, yb1], [x0, yb0]] : [];
    const verge: XY[] = [[x0, yb0], [x1, yb1], [x1 + flare, yc1], [x0 - flare, yc0]];
    const cx = (x0 + x1) / 2;
    const gate: GateGeometry = { center: [cx, yOnLine(boundary, cx)], width: x1 - x0 + 2 * margin };
    return { apron, verge, gate };
  };
  const driveRect = pickStrip(outdoor, site.access.driveway.outdoorType, boundary);
  const walkRect = pickStrip(outdoor, site.access.walkway.outdoorType, boundary);
  const d = build(driveRect, site.access.driveway.flare, site.access.driveway.gateMargin);
  const w = build(walkRect, 0, site.access.walkway.gateMargin);
  return { driveApron: d.apron, driveVerge: d.verge, driveGate: d.gate, walkApron: w.apron, walkVerge: w.verge, walkGate: w.gate, driveRect, walkRect };
}

// ---------------------------------------------------------------------------------------------
// Fences, hedges

export interface ResolvedFence {
  id: string;
  kind: FenceModel["kind"];
  height: number;
  thickness: number;
  /** Polyline pieces after cutting the gate openings. */
  parts: XY[][];
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

export function resolveFences(site: SiteModel, access: AccessGeometry): ResolvedFence[] {
  const plot = plotPolygon(site);
  const gates = [access.driveGate, access.walkGate];
  return site.fences.map((f) => {
    let parts: XY[][] = [pathAlongPlot(plot, f.inset, f.from, f.to)];
    if (f.gates) {
      for (const g of gates) {
        parts = parts.flatMap((p) => (projectToPolyline(g.center, p).d < 0.5 + f.inset ? cutGap(p, g.center, g.width) : [p]));
      }
    }
    return { id: f.id, kind: f.kind, height: f.height, thickness: f.thickness, parts: parts.filter((p) => p.length >= 2) };
  });
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
  /** Public strip between the plot boundary and the carriageway (verge, pavement). */
  verge: XY[];
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
  return {
    verge: [a0, b0, shift(b0, v), shift(a0, v)],
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
