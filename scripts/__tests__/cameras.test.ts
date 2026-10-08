// Placement rules of every camera against the plot (model/site.json): the web and render presets of model/house.json and the
// render cameras of model/render.json (stills, the day sequence in both orientations, the compare pair, the Open Graph image and
// every orbit frame). A camera stands on the plot at eye height, or in the street at eye height looking through a gate opening,
// or is a high view; it never stands inside a crown, a shrub, a fence or a neighbouring building, and nothing on the plot stands
// between it and the house. See docs/HOUSE-FORMAT.md section 4.6 and docs/RENDER-INPUTS.md section 8.
import fs from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { analyzeHouse } from "../../src/lib/model";
import { createSite, distToBoundary, exportSiteDerived, parseSite, pointInPolygon, rayChord, type Occluder, type XY } from "../../src/lib/model/site";
import { buildRenderInputs, solarProvider } from "../build-render-inputs";
import { containing, occludersWithGates } from "../lib/render-framing";
import type { CameraOut, DayFrame, GateState, OrbitVariant, StillShot } from "../lib/render-types";

const root = path.resolve(__dirname, "..", "..");
const readJson = (rel: string): unknown => JSON.parse(fs.readFileSync(path.join(root, rel), "utf8"));
const siteJson = readJson("model/site.json");
const { house, derived } = analyzeHouse(readJson("model/house.json"), { site: parseSite(siteJson) });
// the graded terrain (drive and path ramps), the same ground as the web, walk mode and the renders
const site = createSite(siteJson, house.location.houseAxisBearingDeg, house.outdoor);
const layout = site.withHouse(house.outdoor);
const occluders: Occluder[] = layout.occluders();
// the resolved plot as the render inputs export it (gates with posts, leaves and ground heights, neighbour footprints)
const sd = exportSiteDerived(site, house.outdoor, { gridStep: 10 });
const footprint = derived.outline.polygons[0].pts as XY[];
const gateIds = new Set(layout.gates.map((g) => g.id));

type V3 = [number, number, number];
/** Cameras higher than this above the ground are aerial views (they may stand anywhere above the plot and the street). */
const HIGH = 8;
/** An eye-level camera of the web presets stands between these heights above the ground, m. */
const EYE: [number, number] = [1.0, 2.6];
/** An eye-level render camera (the photographer's eye height, PLAN 3.1) stands between these heights above the ground, m. */
const RENDER_EYE: [number, number] = [1.2, 2.6];
/** A camera on the plot keeps at least this far from the boundary (the fence stands on it), m. */
const BOUNDARY_CLEARANCE = 0.8;
/** Nothing solid within this distance of a camera (a lens inside a crown or touching a fence), m. */
const CAMERA_CLEARANCE = 0.3;

const groundAt = (p: readonly number[]): number => site.terrain.groundAt(p[0], p[1]);
const isInterior = (p: readonly number[]): boolean => pointInPolygon([p[0], p[1]], footprint) && p[2] < house.clearHeight + 0.5;
const onPlot = (p: readonly number[]): boolean => pointInPolygon([p[0], p[1]], site.plot);
const street = site.zones.street;
const inStreet = (p: readonly number[]): boolean => pointInPolygon([p[0], p[1]], street.verge) || pointInPolygon([p[0], p[1]], street.carriageway);

/** The occluders met by the segment from `a` to `b` (chord longer than `min` metres). */
function hits(occ: readonly Occluder[], a: V3, b: V3, roles: readonly string[] | null, min = 0.05): Occluder[] {
  const d: V3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const len = Math.hypot(...d);
  const u: V3 = [d[0] / len, d[1] / len, d[2] / len];
  return occ.filter((o) => {
    if (roles && !roles.includes(o.role)) return false;
    const c = rayChord(o, a, u);
    return !!c && Math.min(c.tOut, len) - c.tIn > min;
  });
}

const BOUNDARY_ROLES = ["hedge", "fence", "neighbour_wall", "neighbour_roof"];
const centre: V3 = [(derived.bbox.x0 + derived.bbox.x1) / 2, (derived.bbox.y0 + derived.bbox.y1) / 2, 1.5];

describe("cameras of model/house.json (web presets)", () => {
  const cameras = derived.cameras.filter((c) => c.kind === "perspective" && (c.use.includes("web") || c.use.includes("render")));

  it("has the cameras the web and the renders need, with eye-level heights resolved above the graded ground", () => {
    expect(cameras.length).toBeGreaterThanOrEqual(6);
    for (const c of derived.cameras) {
      if (c.aboveGround == null) continue;
      expect(c.position[2], c.id).toBeCloseTo(groundAt(c.position) + c.aboveGround, 3);
    }
  });

  it("stands on the plot at eye height, in the street at eye height, or is a high view", () => {
    for (const c of cameras) {
      const p = c.position as V3;
      if (isInterior(p)) continue;
      const h = p[2] - groundAt(p);
      if (h >= HIGH) continue; // aerial: may stand anywhere above the plot and the street
      expect(h, `${c.id} eye height`).toBeGreaterThanOrEqual(EYE[0]);
      expect(h, `${c.id} eye height`).toBeLessThanOrEqual(EYE[1]);
      if (onPlot(p)) expect(distToBoundary([p[0], p[1]], site.plot), `${c.id} is too close to the boundary`).toBeGreaterThanOrEqual(BOUNDARY_CLEARANCE);
      else expect(inStreet(p), `${c.id} stands outside the plot and outside the street below ${HIGH} m`).toBe(true);
    }
  });

  it("is not inside a tree, shrub, hedge, fence or neighbouring building", () => {
    for (const c of cameras) {
      if (isInterior(c.position)) continue;
      expect(containing(occluders, c.position as V3, CAMERA_CLEARANCE).map((o) => o.id), c.id).toEqual([]);
    }
  });

  it("sees the house and its target with no boundary element in between (a street view looks through an open gate)", () => {
    for (const c of cameras) {
      const p = c.position as V3;
      if (isInterior(p)) continue;
      // a camera in the street looks through a gate opening: the street views open the gates (render.json `gates`), so the
      // leaves are left out; the fence parts beside the opening still count
      const occ = onPlot(p) ? occluders : occluders.filter((o) => !gateIds.has(o.id));
      expect(hits(occ, p, centre, BOUNDARY_ROLES).map((o) => o.id), `${c.id} -> centre`).toEqual([]);
      expect(hits(occ, p, c.target as V3, null).map((o) => o.id), `${c.id} -> target`).toEqual([]);
    }
  });
});

// ------------------------------------------------------------------------------------------------ render cameras

interface Placed {
  name: string;
  camera: CameraOut;
  time: string;
  gates: GateState;
  aerial: boolean;
  interior: boolean;
}

let placed: Placed[] = [];
let published: Placed[] = [];
let orbit: OrbitVariant[] = [];

beforeAll(() => {
  const out = buildRenderInputs({ root, sun: solarProvider, furnitureReport: null }).data as unknown as {
    stills: StillShot[];
    day: { camera: CameraOut; portrait: { camera: CameraOut }; frames: DayFrame[] };
    compare: { before: StillShot; after: StillShot };
    og: StillShot;
    orbit: { variants: OrbitVariant[] };
  };
  const shot = (name: string, s: { camera: CameraOut; time: { local: string }; gates: GateState }, aerial = false, interior = false): Placed => ({ name, camera: s.camera, time: s.time.local, gates: s.gates, aerial, interior });
  const stills = out.stills.map((s) => shot(s.id, s, s.category === "aerial", s.category === "interior"));
  const day = out.day.frames.flatMap((f) => [
    shot(`day ${f.time.local}`, { camera: out.day.camera, time: f.time, gates: f.gates }),
    shot(`day portrait ${f.time.local}`, { camera: out.day.portrait.camera, time: f.time, gates: f.gates }),
  ]);
  const pair = [shot("compare before", out.compare.before), shot("compare after", out.compare.after), shot("og", out.og)];
  published = [...stills, ...day, ...pair];
  orbit = out.orbit.variants;
  placed = [...published, ...orbit.flatMap((v) => v.frames.map((f) => ({ name: `orbit ${v.id} ${f.index}`, camera: f.camera, time: "", gates: { driveway: 0, walkway: 0 }, aerial: true, interior: false })))];
});

describe("render cameras of model/render.json", () => {
  it("never stands inside a crown, a shrub, a fence, a gate leaf or a neighbouring building", () => {
    for (const s of placed) {
      if (s.interior) continue;
      const occ = occludersWithGates(occluders, sd.gates, s.gates, site.terrain.groundAt);
      expect(containing(occ, s.camera.position, CAMERA_CLEARANCE).map((o) => o.id), s.name).toEqual([]);
    }
  });

  it("puts every ground-level exterior camera at a photographer's eye height above the graded ground", () => {
    for (const s of published) {
      if (s.aerial || s.interior) continue;
      const h = s.camera.position[2] - groundAt(s.camera.position);
      expect(s.camera.groundZ, s.name).toBeCloseTo(groundAt(s.camera.position), 3);
      expect(s.camera.aboveGround, s.name).toBeCloseTo(h, 3);
      expect(h, `${s.name} eye height`).toBeGreaterThanOrEqual(RENDER_EYE[0]);
      expect(h, `${s.name} eye height`).toBeLessThanOrEqual(RENDER_EYE[1]);
      // a low camera is level: verticals stay vertical, the framing comes from the lens shift
      expect(s.camera.level, s.name).toBe(true);
      expect(Math.abs(s.camera.forward[2]), s.name).toBeLessThan(1e-9);
    }
  });

  it("stands on the plot, or in the street looking through the gate the shot opens", () => {
    for (const s of published) {
      const p = s.camera.position;
      if (s.aerial || s.interior || onPlot(p)) {
        if (!s.aerial && !s.interior) expect(distToBoundary([p[0], p[1]], site.plot), `${s.name} is too close to the boundary`).toBeGreaterThanOrEqual(BOUNDARY_CLEARANCE);
        continue;
      }
      expect(inStreet(p), `${s.name} stands outside the plot and outside the street`).toBe(true);
      expect(s.gates.driveway + s.gates.walkway, `${s.name} stands in the street with every gate closed`).toBeGreaterThan(0);
      const occ = occludersWithGates(occluders, sd.gates, s.gates, site.terrain.groundAt);
      expect(hits(occ, p, s.camera.target, BOUNDARY_ROLES).map((o) => o.id), `${s.name} -> target`).toEqual([]);
    }
  });

  it("sees its target with nothing on the plot in the way", () => {
    for (const s of published) {
      if (s.interior) continue;
      const occ = occludersWithGates(occluders, sd.gates, s.gates, site.terrain.groundAt);
      expect(hits(occ, s.camera.position, s.camera.target, null, 0.3).map((o) => o.id), `${s.name} -> target`).toEqual([]);
    }
  });

  it("never publishes two pictures from the same camera at the same time", () => {
    const key = (s: Placed): string => [...s.camera.position, ...s.camera.target, s.camera.focalMm, ...s.camera.shift].map((v) => v.toFixed(2)).join(",") + "@" + s.time;
    const seen = new Map<string, string>();
    for (const s of published) {
      const k = key(s);
      expect(seen.get(k), `${s.name} repeats ${seen.get(k)}`).toBeUndefined();
      seen.set(k, s.name);
    }
    // and the gallery stills are different views, not one camera at several hours
    const stills = published.filter((s) => !s.name.startsWith("day") && !s.name.startsWith("compare") && s.name !== "og");
    expect(new Set(stills.map((s) => s.camera.position.map((v) => v.toFixed(1)).join(","))).size).toBe(stills.length);
  });

  it("keeps every orbit camera at least 4 m outside every neighbouring building", () => {
    const dist = (p: readonly number[], poly: readonly XY[]): number => (pointInPolygon([p[0], p[1]], poly) ? -distToBoundary([p[0], p[1]], poly) : distToBoundary([p[0], p[1]], poly));
    const polys = derivedNeighbourFootprints();
    expect(polys.length).toBe(site.model.neighbours.length);
    for (const v of orbit) {
      for (const f of v.frames) for (const poly of polys) expect(dist(f.camera.position, poly), `${v.id} frame ${f.index}`).toBeGreaterThanOrEqual(4);
    }
  });
});

/** Footprints of the neighbouring houses (resolved plot, the same polygons the renders build). */
function derivedNeighbourFootprints(): XY[][] {
  return sd.neighbours.map((n) => n.footprint as XY[]);
}
