// Plain JSON snapshots of the site for the pipeline (which never re-derives geometry). Everything is resolved: ground heights,
// fences with their openings and posts, gates, pillars, aprons, dropped kerbs, the street with its pavement.
// `exportSiteLayout` (no terrain grid) is embedded in generated/derived.json as `site`; `exportSiteDerived` adds the terrain
// grid and goes into generated/render-inputs.json.
import type { Bbox, XY } from "./geometry";
import { gradeOutdoor } from "./grading";
import type { Site } from "./index";
import { DEFAULT_KERB_WIDTH, DROPPED_KERB_REVEAL, accessGeometry, fieldZone, neighbourPlot, plotPolygon, resolveBoundary, resolveHedges, siteBounds, streetGeometry } from "./layout";
import { orientedRect, ridgeRise } from "./occluders";
import { sitePaved } from "./analyze";
import type { SiteModel } from "./siteSchema";
import type { OutdoorInput } from "./stats";
import { createTerrain, type Terrain } from "./terrain";

type Gate3 = {
  id: string; access: string; kind: string; leaf: number; height: number; postSize: number; thickness: number; tail: number; side: string;
  fence: string | null; center: XY; along: XY; inward: XY; opening: number; width: number;
  /** Ground at the centre of the opening (m). */
  z: number;
  posts: { x: number; y: number; z: number }[];
  leafPolygon: XY[];
  park: { from: XY; to: XY; offset: number; polygon: XY[] } | null;
  swing: { hinge: XY; radius: number; closedEnd: XY; openEnd: XY; arc: XY[] } | null;
};

export interface SiteLayout {
  /** All numbers rounded to `precision` decimals (millimetres by default). */
  bounds: Bbox;
  plot: { polygon: XY[]; edgeKinds: string[] };
  terrain: { zeroLevelAsl: number; plateau: { level: number; rects: number[][]; blend: number } };
  zones: {
    street: { verge: XY[]; pavement: XY[] | null; green: XY[] | null; carriageway: XY[]; centreLine: XY[]; kerbHeight: number; kerbWidth: number };
    field: XY[];
    neighbourPlots: { id: string; polygon: XY[] }[];
  };
  access: {
    driveApron: XY[]; driveVerge: XY[]; walkApron: XY[]; walkVerge: XY[];
    driveGate: { center: XY; width: number; opening: number }; walkGate: { center: XY; width: number; opening: number };
    /** Dropped kerbs at the crossings (kerb strip polygons) and their reveal above the carriageway (m). */
    driveKerb: XY[]; walkKerb: XY[]; droppedKerbReveal: number;
  };
  fences: {
    id: string; kind: string; height: number; thickness: number; parts: XY[][];
    plinthHeight: number | null; slat: { orient: string; board: number; gap: number; depth: number } | null;
    postSize: number | null; postSpacing: number | null;
    /** Posts with the ground height at their foot. */
    posts: { x: number; y: number; z: number }[];
  }[];
  gates: Gate3[];
  pillars: { id: string; access: string; side: string; size: [number, number, number]; items: string[]; center: XY; along: XY; inward: XY; footprint: XY[]; z: number }[];
  hedges: { id: string; species: string; evergreen: boolean; height: number; width: number; path: XY[] }[];
  trees: { id: string; species: string; latin: string; evergreen: boolean; x: number; y: number; z: number; height: number; crown: number; crownBase: number; uplight: boolean }[];
  shrubs: { id: string; species: string; latin: string; evergreen: boolean; x: number; y: number; z: number; height: number; width: number }[];
  beds: { id: string; kind: string; polygon: XY[] }[];
  paved: { kind: string; polygon: XY[] }[];
  neighbours: { id: string; footprint: XY[]; baseZ: number; eaveHeight: number; ridgeHeight: number; roof: { kind: string; pitchDeg: number; overhang: number } }[];
  rainwater: { tank: { x: number; y: number; z: number; volumeM3: number; diameter: number; overflow: string } } | null;
}

export interface SiteDerived extends Omit<SiteLayout, "terrain"> {
  schema: "site-derived/1";
  terrain: SiteLayout["terrain"] & { grid: { x0: number; y0: number; step: number; nx: number; ny: number; z: number[] } };
}

export interface ExportOptions {
  /** Terrain grid spacing (m). Default 1. */
  gridStep?: number;
  /** Decimals kept in all coordinates. Default 3. */
  precision?: number;
}

/** The terrain graded with the outdoor slabs of the house. */
function graded(model: SiteModel, outdoor: readonly OutdoorInput[], bearingDeg: number): Terrain {
  const base = createTerrain(model.terrain, bearingDeg);
  return createTerrain(model.terrain, bearingDeg, gradeOutdoor(outdoor, base.baseAt, accessGeometry(model, outdoor)).slabs);
}

/** Everything about the site except the terrain grid, resolved for the given outdoor areas of the house. */
export function exportSiteLayout(model: SiteModel, outdoor: readonly OutdoorInput[], bearingDeg: number, opts: { precision?: number; terrain?: Terrain } = {}): SiteLayout {
  const k = 10 ** (opts.precision ?? 3);
  const r = (v: number) => Math.round(v * k) / k + 0; // + 0 turns -0 into 0 so JSON round trips are exact
  const pt = (p: readonly number[]): XY => [r(p[0]), r(p[1])];
  const poly = (p: readonly (readonly number[])[]): XY[] => p.map(pt);
  const unit = (v: XY): XY => [Math.round(v[0] * 1e6) / 1e6 + 0, Math.round(v[1] * 1e6) / 1e6 + 0];
  const terrain = opts.terrain ?? graded(model, outdoor, bearingDeg);
  const ground = terrain.groundAt;
  const access = accessGeometry(model, outdoor);
  const { fences, gates, pillars } = resolveBoundary(model, access);
  const street = streetGeometry(model);
  const bounds = siteBounds(model);
  const plot = plotPolygon(model);
  const at = (p: XY) => ({ x: r(p[0]), y: r(p[1]), z: r(ground(p[0], p[1])) });
  return {
    bounds: { x0: r(bounds.x0), y0: r(bounds.y0), x1: r(bounds.x1), y1: r(bounds.y1) },
    plot: { polygon: poly(plot), edgeKinds: model.plot.edges.map((e) => e.kind) },
    terrain: {
      zeroLevelAsl: model.terrain.zeroLevelAsl,
      plateau: { level: model.terrain.plateau.level, rects: model.terrain.plateau.rects.map((q) => q.map(r)), blend: model.terrain.plateau.blend },
    },
    zones: {
      street: {
        verge: poly(street.verge), pavement: street.pavement ? poly(street.pavement) : null, green: street.green ? poly(street.green) : null,
        carriageway: poly(street.carriageway), centreLine: poly(street.centreLine),
        kerbHeight: model.street.kerbHeight, kerbWidth: model.street.kerbWidth ?? DEFAULT_KERB_WIDTH,
      },
      field: poly(fieldZone(model)),
      neighbourPlots: model.neighbours.map((nb) => ({ id: nb.id, polygon: poly(neighbourPlot(model, nb)) })),
    },
    access: {
      driveApron: poly(access.driveApron), driveVerge: poly(access.driveVerge), walkApron: poly(access.walkApron), walkVerge: poly(access.walkVerge),
      driveGate: { center: pt(access.driveGate.center), width: r(access.driveGate.width), opening: r(access.driveGate.opening) },
      walkGate: { center: pt(access.walkGate.center), width: r(access.walkGate.width), opening: r(access.walkGate.opening) },
      driveKerb: poly(access.driveKerb), walkKerb: poly(access.walkKerb), droppedKerbReveal: DROPPED_KERB_REVEAL,
    },
    fences: fences.map((f) => ({
      id: f.id, kind: f.kind, height: f.height, thickness: f.thickness, parts: f.parts.map(poly),
      plinthHeight: f.plinthHeight, slat: f.slat ? { ...f.slat } : null, postSize: f.postSize, postSpacing: f.postSpacing,
      posts: f.posts.map(at),
    })),
    gates: gates.map((g) => ({
      id: g.id, access: g.access, kind: g.kind, leaf: g.leaf, height: g.height, postSize: g.postSize, thickness: r(g.thickness), tail: r(g.tail), side: g.side,
      fence: g.fence, center: pt(g.center), along: unit(g.along), inward: unit(g.inward),
      opening: r(g.opening), width: r(g.width), z: r(ground(g.center[0], g.center[1])),
      posts: g.posts.map(at), leafPolygon: poly(g.leafPolygon),
      park: g.park ? { from: pt(g.park.from), to: pt(g.park.to), offset: r(g.park.offset), polygon: poly(g.park.polygon) } : null,
      swing: g.swing ? { hinge: pt(g.swing.hinge), radius: g.swing.radius, closedEnd: pt(g.swing.closedEnd), openEnd: pt(g.swing.openEnd), arc: poly(g.swing.arc) } : null,
    })),
    pillars: pillars.map((p) => ({
      id: p.id, access: p.access, side: p.side, size: p.size, items: [...p.items], center: pt(p.center),
      along: unit(p.along), inward: unit(p.inward),
      footprint: poly(p.footprint), z: r(Math.min(...p.footprint.map((q) => ground(q[0], q[1])))),
    })),
    hedges: resolveHedges(model).map((h) => ({ id: h.id, species: h.species, evergreen: model.species[h.species].evergreen, height: h.height, width: h.width, path: poly(h.path) })),
    trees: model.trees.map((t) => ({
      id: t.id, species: t.species, latin: model.species[t.species].latin, evergreen: model.species[t.species].evergreen,
      x: r(t.pos[0]), y: r(t.pos[1]), z: r(ground(t.pos[0], t.pos[1])), height: t.height, crown: t.crown, crownBase: r(t.crownBase ?? 0.3 * t.height),
      uplight: t.uplight ?? false,
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
    rainwater: model.rainwater
      ? { tank: { ...at(model.rainwater.tank.pos as XY), volumeM3: model.rainwater.tank.volumeM3, diameter: model.rainwater.tank.diameter, overflow: model.rainwater.tank.overflow } }
      : null,
  };
}

/** The site layout plus the terrain grid (graded with the house's slabs), for generated/render-inputs.json. */
export function exportSiteDerived(site: Site, outdoor: readonly OutdoorInput[], opts: ExportOptions = {}): SiteDerived {
  const step = opts.gridStep ?? 1;
  const k = 10 ** (opts.precision ?? 3);
  const r = (v: number) => Math.round(v * k) / k + 0;
  const terrain = site.withHouse(outdoor).terrain;
  const layout = exportSiteLayout(site.model, outdoor, site.terrain.bearingDeg, { precision: opts.precision, terrain });
  const g = terrain.grid(site.bounds, step);
  return {
    schema: "site-derived/1",
    ...layout,
    terrain: { ...layout.terrain, grid: { x0: r(g.x0), y0: r(g.y0), step, nx: g.nx, ny: g.ny, z: Array.from(g.z, r) } },
  };
}
