// Plain JSON snapshot of the site for generated/derived.json (read by the Blender pipeline, which never re-derives
// geometry). Everything is resolved: terrain grid, trees with ground heights, fences with gate openings, aprons.
import type { Bbox, XY } from "./geometry";
import type { Site } from "./index";
import { orientedRect, ridgeRise } from "./occluders";
import { sitePaved } from "./analyze";
import { plotPolygon } from "./layout";
import type { OutdoorInput } from "./stats";

export interface SiteDerived {
  schema: "site-derived/1";
  /** All numbers rounded to `precision` decimals (millimetres by default). */
  bounds: Bbox;
  plot: { polygon: XY[]; edgeKinds: string[] };
  terrain: {
    zeroLevelAsl: number;
    plateau: { level: number; rects: number[][]; blend: number };
    grid: { x0: number; y0: number; step: number; nx: number; ny: number; z: number[] };
  };
  zones: { street: { verge: XY[]; carriageway: XY[]; centreLine: XY[] }; field: XY[]; neighbourPlots: { id: string; polygon: XY[] }[] };
  access: { driveApron: XY[]; driveVerge: XY[]; walkApron: XY[]; walkVerge: XY[]; driveGate: { center: XY; width: number }; walkGate: { center: XY; width: number } };
  fences: { id: string; kind: string; height: number; thickness: number; parts: XY[][] }[];
  hedges: { id: string; species: string; evergreen: boolean; height: number; width: number; path: XY[] }[];
  trees: { id: string; species: string; latin: string; evergreen: boolean; x: number; y: number; z: number; height: number; crown: number; crownBase: number }[];
  shrubs: { id: string; species: string; latin: string; evergreen: boolean; x: number; y: number; z: number; height: number; width: number }[];
  beds: { id: string; kind: string; polygon: XY[] }[];
  paved: { kind: string; polygon: XY[] }[];
  neighbours: { id: string; footprint: XY[]; baseZ: number; eaveHeight: number; ridgeHeight: number; roof: { kind: string; pitchDeg: number; overhang: number } }[];
}

export interface ExportOptions {
  /** Terrain grid spacing (m). Default 1. */
  gridStep?: number;
  /** Decimals kept in all coordinates. Default 3. */
  precision?: number;
}

export function exportSiteDerived(site: Site, outdoor: readonly OutdoorInput[], opts: ExportOptions = {}): SiteDerived {
  const step = opts.gridStep ?? 1;
  const k = 10 ** (opts.precision ?? 3);
  const r = (v: number) => Math.round(v * k) / k + 0; // + 0 turns -0 into 0 so JSON round trips are exact
  const pt = (p: readonly number[]): XY => [r(p[0]), r(p[1])];
  const poly = (p: readonly (readonly number[])[]): XY[] => p.map(pt);
  const model = site.model;
  const { access, fences } = site.withHouse(outdoor);
  const g = site.terrain.grid(site.bounds, step);
  const ground = site.terrain.groundAt;
  const plot = plotPolygon(model);
  return {
    schema: "site-derived/1",
    bounds: { x0: r(site.bounds.x0), y0: r(site.bounds.y0), x1: r(site.bounds.x1), y1: r(site.bounds.y1) },
    plot: { polygon: poly(plot), edgeKinds: model.plot.edges.map((e) => e.kind) },
    terrain: {
      zeroLevelAsl: model.terrain.zeroLevelAsl,
      plateau: { level: model.terrain.plateau.level, rects: model.terrain.plateau.rects.map((q) => q.map(r)), blend: model.terrain.plateau.blend },
      grid: { x0: r(g.x0), y0: r(g.y0), step, nx: g.nx, ny: g.ny, z: Array.from(g.z, r) },
    },
    zones: {
      street: { verge: poly(site.zones.street.verge), carriageway: poly(site.zones.street.carriageway), centreLine: poly(site.zones.street.centreLine) },
      field: poly(site.zones.field),
      neighbourPlots: site.zones.neighbours.map((n) => ({ id: n.id, polygon: poly(n.plot) })),
    },
    access: {
      driveApron: poly(access.driveApron), driveVerge: poly(access.driveVerge), walkApron: poly(access.walkApron), walkVerge: poly(access.walkVerge),
      driveGate: { center: pt(access.driveGate.center), width: r(access.driveGate.width) },
      walkGate: { center: pt(access.walkGate.center), width: r(access.walkGate.width) },
    },
    fences: fences.map((f) => ({ id: f.id, kind: f.kind, height: f.height, thickness: f.thickness, parts: f.parts.map(poly) })),
    hedges: site.hedges.map((h) => ({ id: h.id, species: h.species, evergreen: model.species[h.species].evergreen, height: h.height, width: h.width, path: poly(h.path) })),
    trees: model.trees.map((t) => ({
      id: t.id, species: t.species, latin: model.species[t.species].latin, evergreen: model.species[t.species].evergreen,
      x: r(t.pos[0]), y: r(t.pos[1]), z: r(ground(t.pos[0], t.pos[1])), height: t.height, crown: t.crown, crownBase: r(t.crownBase ?? 0.3 * t.height),
    })),
    shrubs: model.shrubs.map((s) => ({
      id: s.id, species: s.species, latin: model.species[s.species].latin, evergreen: model.species[s.species].evergreen,
      x: r(s.pos[0]), y: r(s.pos[1]), z: r(ground(s.pos[0], s.pos[1])), height: s.height, width: s.width,
    })),
    beds: model.beds.map((b) => ({ id: b.id, kind: b.kind, polygon: poly(b.polygon) })),
    paved: sitePaved(model, access).map((p) => ({ kind: p.kind, polygon: poly(p.polygon) })),
    neighbours: model.neighbours.map((nb) => {
      const h = nb.house;
      const footprint = orientedRect(h.center, h.size[0], h.size[1], h.rotDeg);
      const baseZ = Math.min(...footprint.map((p) => ground(p[0], p[1])));
      return {
        id: nb.id, footprint: poly(footprint), baseZ: r(baseZ), eaveHeight: h.eaveHeight,
        ridgeHeight: r(h.eaveHeight + ridgeRise(h.size[0] + 2 * h.roof.overhang, h.size[1] + 2 * h.roof.overhang, h.roof.pitchDeg, h.roof.kind)),
        roof: { kind: h.roof.kind, pitchDeg: h.roof.pitchDeg, overhang: h.roof.overhang },
      };
    }),
  };
}
