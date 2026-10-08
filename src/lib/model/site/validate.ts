// Semantic checks of site.json that the zod schema cannot express (references, geometry sanity).
import {
  dist, distToBoundary, distToPolygon, edgeDirection, intersectionArea, pointInPolygon, polygonArea, polylineLength, segmentsIntersect, signedArea, type XY,
} from "./geometry";
import { RAMP_MAX_SLOPE, gradeOutdoor } from "./grading";
import { accessGeometry, accessRect, distToGateSweep, neighbourPlot, plotPolygon, resolveBoundary } from "./layout";
import { orientedRect } from "./occluders";
import type { SiteModel } from "./siteSchema";
import { outdoorPolygon, type OutdoorInput } from "./stats";
import { createTerrain } from "./terrain";

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
  const gatesPerAccess = new Map<string, number>();
  for (const g of site.gates ?? []) gatesPerAccess.set(g.access, (gatesPerAccess.get(g.access) ?? 0) + 1);
  for (const [a, c] of gatesPerAccess) if (c > 1) err("E-BRANA", `${c} gates for the ${a}; at most one gate per access`);
  const tank = site.rainwater?.tank;
  if (tank) {
    if (!pointInPolygon(tank.pos, plot) || distToBoundary(tank.pos, plot) < tank.diameter / 2) err("E-TANK", "the rainwater tank is not inside the plot");
  }
  if (site.terrain.plateau.blend < 3) warn("W-BLEND", "plateau blend below 3 m gives visible slopes");
  return { errors, warnings };
}

/** A tree trunk is treated as a disc of this radius (m) when checking what stands in the way of a gate. */
export const TRUNK_RADIUS = 0.25;
/** Free space kept around the moving leaf of a gate (m). */
export const GATE_SWEEP_CLEARANCE = 0.1;
/** The fence opening may exceed the gate leaf by at most this much (m): the two gate posts. */
export const GATE_OPENING_SLACK = 0.25;

/**
 * Checks of the site together with the outdoor areas of the house (which give the access strips, the gates' positions and
 * the ramps): gates (E-BRANA), ramp slopes (E-RAMP) and the rainwater tank against the paved areas (E-TANK).
 */
export function validateSiteWithHouse(site: SiteModel, outdoor: readonly OutdoorInput[], bearingDeg: number): SiteValidation {
  const errors: SiteIssue[] = [];
  const warnings: SiteIssue[] = [];
  const err = (code: string, message: string) => errors.push({ code, message });
  let access;
  try {
    access = accessGeometry(site, outdoor);
  } catch (e) {
    err("E-ACCESS", (e as Error).message);
    return { errors, warnings };
  }
  const { fences, gates } = resolveBoundary(site, access);
  for (const g of gates) {
    const fence = fences.find((f) => f.id === g.fence);
    if (!fence) {
      err("E-BRANA", `gate ${g.id}: no fence with gates crosses the ${g.access}`);
      continue;
    }
    const strip = accessRect(access, g.access);
    if (strip[2] - strip[0] > g.leaf + 1e-6) err("E-BRANA", `gate ${g.id}: the ${g.access} (${(strip[2] - strip[0]).toFixed(2)} m) is wider than the leaf (${g.leaf} m)`);
    if (!(g.leaf <= g.width + 1e-9 && g.width <= g.leaf + GATE_OPENING_SLACK + 1e-9)) err("E-BRANA", `gate ${g.id}: the fence opening ${g.width.toFixed(2)} m does not fit the leaf ${g.leaf} m`);
    if (g.park) {
      const len = polylineLength(fence.path);
      const closed = fence.path.length > 2 && dist(fence.path[0], fence.path[fence.path.length - 1]) < 1e-9;
      const [a, b] = g.park.span;
      if (!closed && (a < -1e-6 || b > len + 1e-6)) err("E-BRANA", `gate ${g.id}: the open leaf runs past the end of fence ${fence.id}`);
      for (const gap of fence.gaps) {
        if (gap.ref === g.id) continue;
        const wrap = closed ? [-len, 0, len] : [0];
        if (wrap.some((k) => gap.from + k < b - 1e-6 && gap.to + k > a + 1e-6)) err("E-BRANA", `gate ${g.id}: the open leaf crosses the opening for ${gap.ref ?? gap.access}`);
      }
    }
    for (const t of site.trees) if (distToGateSweep(g, t.pos) < TRUNK_RADIUS + GATE_SWEEP_CLEARANCE) err("E-BRANA", `gate ${g.id}: tree ${t.id} stands where the leaf moves`);
    for (const sh of site.shrubs) if (distToGateSweep(g, sh.pos) < sh.width / 2 + GATE_SWEEP_CLEARANCE) err("E-BRANA", `gate ${g.id}: shrub ${sh.id} stands where the leaf moves`);
  }
  const base = createTerrain(site.terrain, bearingDeg);
  const { grades } = gradeOutdoor(outdoor, base.baseAt, access);
  for (const gr of grades) {
    if (gr.ramp && Math.abs(gr.ramp.slope) > RAMP_MAX_SLOPE + 1e-9) {
      err("E-RAMP", `the ${gr.ramp.access} ramp is ${(Math.abs(gr.ramp.slope) * 100).toFixed(1)} %, more than ${RAMP_MAX_SLOPE * 100} %`);
    }
  }
  const tank = site.rainwater?.tank;
  if (tank) {
    const hard = [...outdoor.map(outdoorPolygon), ...site.paved.map((p) => p.polygon as XY[])].filter((p) => p.length >= 3);
    if (hard.some((p) => distToPolygon(tank.pos, p) < tank.diameter / 2)) err("E-TANK", "the rainwater tank lies under a paved area");
  }
  return { errors, warnings };
}
