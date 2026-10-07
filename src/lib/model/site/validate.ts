// Semantic checks of site.json that the zod schema cannot express (references, geometry sanity).
import {
  distToBoundary, edgeDirection, intersectionArea, pointInPolygon, polygonArea, segmentsIntersect, signedArea, type XY,
} from "./geometry";
import { neighbourPlot, plotPolygon } from "./layout";
import { orientedRect } from "./occluders";
import type { SiteModel } from "./siteSchema";

export interface SiteIssue {
  code: string;
  message: string;
}
export interface SiteValidation {
  errors: SiteIssue[];
  warnings: SiteIssue[];
}

/** True when no two non-adjacent edges of the ring cross. */
export function isSimplePolygon(poly: readonly XY[]): boolean {
  const n = poly.length;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (j === i + 1 || (i === 0 && j === n - 1)) continue;
      if (segmentsIntersect(poly[i], poly[(i + 1) % n], poly[j], poly[(j + 1) % n])) return false;
    }
  }
  return true;
}

/** Checks of the site model on its own (no house needed). Errors make the model unusable, warnings are advice. */
export function validateSite(site: SiteModel): SiteValidation {
  const errors: SiteIssue[] = [];
  const warnings: SiteIssue[] = [];
  const err = (code: string, message: string) => errors.push({ code, message });
  const warn = (code: string, message: string) => warnings.push({ code, message });

  const raw = site.plot.polygon;
  const n = raw.length;
  if (site.plot.edges.length !== n) err("E-EDGES", `plot.edges has ${site.plot.edges.length} items, the polygon has ${n} edges`);
  if (signedArea(raw) <= 0) err("E-WINDING", "plot polygon must be counter-clockwise");
  if (!isSimplePolygon(raw)) err("E-SELFCROSS", "plot polygon crosses itself");
  if (errors.length) return { errors, warnings };
  const plot = plotPolygon(site);

  const edgeKind = (i: number) => site.plot.edges[i]?.kind;
  if (edgeKind(site.street.edge) !== "street") err("E-STREET", `street.edge ${site.street.edge} is not a street edge`);
  if (edgeKind(site.field.edge) !== "field") err("E-FIELD", `field.edge ${site.field.edge} is not a field edge`);
  for (const [name, edge] of [["street", site.street.edge], ["field", site.field.edge]] as const) {
    if (edge >= n) err("E-EDGE-RANGE", `${name} edge ${edge} out of range`);
  }
  const neighbourEdges = site.plot.edges.map((e, i) => (e.kind === "neighbour" ? i : -1)).filter((i) => i >= 0);
  for (const i of neighbourEdges) {
    if (!site.neighbours.some((nb) => nb.edge === i)) warn("W-NEIGHBOUR", `neighbour edge ${i} has no neighbour house`);
  }

  const ids = new Map<string, number>();
  for (const id of [...site.trees, ...site.shrubs, ...site.hedges, ...site.fences, ...site.beds, ...site.paved, ...site.neighbours].map((x) => x.id)) ids.set(id, (ids.get(id) ?? 0) + 1);
  for (const [id, c] of ids) if (c > 1) err("E-ID", `duplicate id ${id}`);

  const speciesOf = (id: string, want: "tree" | "shrub" | "hedge", what: string) => {
    const sp = site.species[id];
    if (!sp) err("E-SPECIES", `${what}: unknown species "${id}"`);
    else if (sp.kind !== want) err("E-SPECIES-KIND", `${what}: species "${id}" is a ${sp.kind}, not a ${want}`);
  };
  for (const t of site.trees) {
    speciesOf(t.species, "tree", `tree ${t.id}`);
    if (!pointInPolygon(t.pos, plot)) err("E-OUTSIDE", `tree ${t.id} stands outside the plot`);
    else if (distToBoundary(t.pos, plot) < t.crown / 2 - 0.5) warn("W-CROWN", `tree ${t.id}: crown reaches over the boundary by more than 0.5 m`);
  }
  for (const s of site.shrubs) {
    speciesOf(s.species, "shrub", `shrub ${s.id}`);
    if (!pointInPolygon(s.pos, plot)) err("E-OUTSIDE", `shrub ${s.id} stands outside the plot`);
  }
  for (const h of site.hedges) {
    speciesOf(h.species, "hedge", `hedge ${h.id}`);
    for (const r of [h.from, h.to]) if (r.edge >= n) err("E-EDGE-RANGE", `hedge ${h.id}: edge ${r.edge} out of range`);
  }
  for (const f of site.fences) for (const r of [f.from, f.to]) if (r.edge >= n) err("E-EDGE-RANGE", `fence ${f.id}: edge ${r.edge} out of range`);
  for (const b of [...site.beds, ...site.paved]) {
    const area = polygonArea(b.polygon);
    if (area < 0.01) err("E-DEGENERATE", `${b.id}: polygon has no area`);
    if (area > 0 && Math.abs(intersectionArea(b.polygon, plot) - area) > 0.02 * area) err("E-OUTSIDE", `${b.id}: polygon is not inside the plot`);
  }
  for (const nb of site.neighbours) {
    if (nb.edge >= n || edgeKind(nb.edge) !== "neighbour") {
      err("E-NEIGHBOUR-EDGE", `neighbour ${nb.id}: edge ${nb.edge} is not a neighbour edge`);
      continue;
    }
    const theirs = neighbourPlot(site, nb);
    const corners = orientedRect(nb.house.center, nb.house.size[0], nb.house.size[1], nb.house.rotDeg);
    if (!corners.every((p) => pointInPolygon(p, theirs))) err("E-NEIGHBOUR-PLOT", `neighbour ${nb.id}: house is not inside their plot`);
    if (intersectionArea(corners, plot) > 0) err("E-NEIGHBOUR-OVERLAP", `neighbour ${nb.id}: house overlaps our plot`);
    const along = edgeDirection(plot, nb.edge);
    if (!Number.isFinite(along[0])) err("E-NEIGHBOUR-EDGE", `neighbour ${nb.id}: degenerate edge`);
  }
  if (site.terrain.plateau.blend < 3) warn("W-BLEND", "plateau blend below 3 m gives visible slopes");
  return { errors, warnings };
}
