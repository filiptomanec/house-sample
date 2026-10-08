// Tests of generated/render-inputs.json and model/render.json (what the Blender scripts read). The output is built in memory
// from the model files, so the tests do not depend on the git-ignored generated/render-inputs.json. Counts come from the
// config, framing from the model: a model change that hides the house from a camera fails here before any render.
// Placement rules of the cameras (eye height, inside a crown, duplicates, neighbours) are in cameras.test.ts.
import fs from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { hashModelFiles, isHashedModelFile, localized, type Derived } from "../../src/lib/model";
import { analyzeHouse } from "../../src/lib/model";
import { createSite, distToBoundary, exportSiteDerived, parseSite, pointInPolygon, type Occluder, type XY } from "../../src/lib/model/site";
import { nb } from "../../src/lib/i18n/format";
import { buildRenderInputs, contentHash, resolveSunProvider, solarProvider, stableJson, type BuildResult } from "../build-render-inputs";
import { fieldOfView, insideFrame, project, type ResolvedCamera } from "../lib/render-camera";
import { bladesBlock, cutoffTilt, screenCutoff, type ScreenItem } from "../lib/render-equipment";
import { resolveFeature, type Feature } from "../lib/render-features";
import {
  crownOnImage, hiddenShare, houseSamples, houseShape, houseSilhouette, occludedHouseShare, occludersWithGates, widthShare, zoneSkyOrRoof,
} from "../lib/render-framing";
import { parseRenderConfig, type RenderConfig } from "../lib/render-schema";
import { expandRanges, orbitAngle, orbitElevation, roofBlocks } from "../lib/render-shots";
import type { BlindState, DayFrame, GateState, OrbitCaption, OrbitVariant, ScreenState, Shot, StillShot } from "../lib/render-types";
import { overhangShadedFraction } from "../../src/lib/calc/sun";
import { dayEvents, localToUtc, solarPosition } from "../lib/solar";

const root = path.resolve(__dirname, "..", "..");
const readJson = (rel: string): unknown => JSON.parse(fs.readFileSync(path.join(root, rel), "utf8"));
const renderJson = readJson("model/render.json") as Record<string, unknown>;
const houseJson = readJson("model/house.json");
const siteJson = readJson("model/site.json");
const RAD = Math.PI / 180;
const DEG = 180 / Math.PI;

type Vec3 = [number, number, number];
type Text = { cs: string; en: string };
interface CompareShot extends Shot { label: Text; title: Text; alt: Text; gallery: boolean }
interface BlindItemOut {
  openingId: string;
  azimuthTrueDeg: number;
  sill: number;
  head: number;
  width: number;
  overhang: { depth: number; eaveHeight: number } | null;
  sections: { width: number }[];
  box: { hidden: boolean };
}
interface Out {
  schema: string;
  hash: string;
  modelHash: string;
  inputs: { sunSource: string; glb: Record<string, string>; furnitureReport: string | null };
  location: { lat: number; lon: number; houseAxisBearingDeg: number; tz: string };
  date: string;
  daylight: { sunrise: string; sunset: string; solarNoon: string; noonElevationDeg: number };
  sky: Record<string, unknown>;
  terrain: { grid: { x0: number; y0: number; step: number; nx: number; ny: number; heightsMm: number[] }; plateau: { level: number; rects: number[][] }; voids: number[][] };
  house: { footprint: [number, number][] };
  vegetation: { trees: { x: number; y: number; z: number; height: number; crown: number; uplight?: boolean }[]; shrubs: { x: number; y: number; z: number }[] };
  pv: { count: number; kwp: number; panels: { corners: Vec3[]; center: Vec3; normal: Vec3 }[] };
  blinds: { items: BlindItemOut[]; rule: { closeAboveIrradiance: number }; details: Record<string, number | string> };
  screens: ScreenItem[];
  lights: { items: { group: string; kind: string; space: string; pos: Vec3; spot: { direction: Vec3 } | null }[] };
  stills: StillShot[];
  day: { size: [number, number]; portrait: { size: [number, number]; camera: ResolvedCamera }; stillTime: string; frames: DayFrame[]; camera: ResolvedCamera; subjects: string[] };
  orbit: {
    frameCount: number; fps: number; durationSec: number; scrollStep: number; scrollCount: number; target: Vec3; sun: Shot["sun"];
    startAzimuthDeg: number; direction: string; captionHalfWindowDeg: number; captions: OrbitCaption[]; variants: OrbitVariant[];
    blinds: BlindState[]; screens: ScreenState; gates: GateState; garageDoor: number;
  };
  compare: { before: CompareShot; after: CompareShot };
  og: StillShot;
}

let res: BuildResult;
let out: Out;
let cfg: RenderConfig;
const { house, derived } = analyzeHouse(houseJson, { site: parseSite(siteJson) }) as { house: ReturnType<typeof analyzeHouse>["house"]; derived: Derived };
// the graded terrain and the occluders of the plot (trees, shrubs, fences, gates, pillars, neighbours): the same as the web
const site = createSite(siteJson, house.location.houseAxisBearingDeg, house.outdoor);
const layout = site.withHouse(house.outdoor);
// the resolved plot as the render inputs export it (trees, gates with posts and leaves, pillars, with ground heights)
const sd = exportSiteDerived(site, house.outdoor, { gridStep: 10 });
const occluders: Occluder[] = layout.occluders();
const crowns = occluders.filter((o) => o.role === "tree");
const shape = houseShape(derived);
const silhouette = houseSilhouette(shape);
const feature = (word: string, near?: Vec3): Feature | null => resolveFeature(word, derived, sd, near);

beforeAll(() => {
  res = buildRenderInputs({ root, sun: solarProvider, furnitureReport: null });
  out = res.data as unknown as Out;
  cfg = res.config;
});

// independent low-precision solar position (Astronomical Almanac), accurate to about 0.05 degree
function almanacSun(utcMs: number, lat: number, lon: number): { az: number; el: number } {
  const n = utcMs / 86400000 + 2440587.5 - 2451545.0;
  const L = (280.46 + 0.9856474 * n) % 360;
  const g = ((357.528 + 0.9856003 * n) % 360) * RAD;
  const lambda = (L + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * RAD;
  const eps = (23.439 - 0.0000004 * n) * RAD;
  const ra = Math.atan2(Math.cos(eps) * Math.sin(lambda), Math.cos(lambda));
  const dec = Math.asin(Math.sin(eps) * Math.sin(lambda));
  const gmst = (18.697374558 + 24.06570982441908 * n) % 24;
  const lst = (((gmst * 15 + lon) % 360) + 360) % 360;
  const ha = ((lst * RAD - ra + Math.PI * 3) % (2 * Math.PI)) - Math.PI;
  const phi = lat * RAD;
  const sinEl = Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec) * Math.cos(ha);
  const el = Math.asin(sinEl);
  const az = Math.atan2(-Math.sin(ha), Math.tan(dec) * Math.cos(phi) - Math.sin(phi) * Math.cos(ha));
  return { az: (((az * DEG) % 360) + 360) % 360, el: el * DEG };
}

const angleDiff = (a: number, b: number): number => Math.abs(((a - b + 540) % 360) - 180);
const pointInPoly = (x: number, y: number, poly: readonly (readonly number[])[]): boolean => pointInPolygon([x, y], poly as XY[]);
const mulberry32 = (seed: number): (() => number) => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const shots = (): Shot[] => [...out.stills, out.og, out.compare.before, out.compare.after];
/** Every picture with its own camera, size and state (day frames counted once per camera). */
const views = (): { name: string; camera: ResolvedCamera; size: [number, number]; gates: GateState; subjects: string[]; interior: boolean }[] => [
  ...out.stills.map((s) => ({ name: s.id, camera: s.camera, size: s.size, gates: s.gates, subjects: s.subjects, interior: s.category === "interior" })),
  ...[out.og, out.compare.before, out.compare.after].map((s) => ({ name: s.id, camera: s.camera, size: s.size, gates: s.gates, subjects: s.subjects, interior: false })),
  { name: "day", camera: out.day.camera, size: out.day.size, gates: out.day.frames[0].gates, subjects: out.day.subjects, interior: false },
  { name: "day portrait", camera: out.day.portrait.camera, size: out.day.portrait.size, gates: out.day.frames[0].gates, subjects: out.day.subjects, interior: false },
];
/** Share of a feature's sample points that project inside the frame. */
const inFrameShare = (cam: ResolvedCamera, size: readonly [number, number], f: Feature): number => f.points.filter((p) => insideFrame(project(cam, size, p))).length / f.points.length;
/** The feature faces the camera (always true for an area, a tree or furniture). */
const faces = (f: Feature, from: readonly number[]): boolean => !f.normal || (from[0] - f.center[0]) * f.normal[0] + (from[1] - f.center[1]) * f.normal[1] + (from[2] - f.center[2]) * f.normal[2] > 0;
const walnut = (): { x: number; y: number; z: number; height: number; crown: number; crownBase: number } => {
  const t = sd.trees.find((x) => x.species === "walnut");
  if (!t) throw new Error("the garden has no walnut");
  return t;
};
const allTexts = (c: RenderConfig): [string, Text][] => [
  ...c.stills.flatMap((s) => [[`${s.id}.label`, s.label], [`${s.id}.alt`, s.alt]] as [string, Text][]),
  ["compare.alt", c.compare.alt],
  ...(["before", "after"] as const).flatMap((k) => [[`compare.${k}.label`, c.compare[k].label], [`compare.${k}.title`, c.compare[k].title], [`compare.${k}.alt`, c.compare[k].alt]] as [string, Text][]),
  ["og.alt", c.og.alt],
];

describe("model/render.json", () => {
  it("passes the strict schema with unique still ids", () => {
    const c = parseRenderConfig(renderJson);
    expect(c.fictional).toBe(true);
    expect(new Set(c.stills.map((s) => s.id)).size).toBe(c.stills.length);
  });

  it("rejects unknown keys, bad clock times, bad sizes and an eye height without a ground position", () => {
    expect(() => parseRenderConfig({ ...renderJson, extra: 1 })).toThrow();
    const stills = renderJson.stills as Record<string, unknown>[];
    expect(() => parseRenderConfig({ ...renderJson, stills: [{ ...stills[0], time: "25:00" }, ...stills.slice(1)] })).toThrow();
    expect(() => parseRenderConfig({ ...renderJson, stills: [{ ...stills[0], size: [10, 10] }, ...stills.slice(1)] })).toThrow();
    const cam = stills[0].camera as Record<string, unknown>;
    expect(() => parseRenderConfig({ ...renderJson, stills: [{ ...stills[0], camera: { ...cam, position: [1, 2, 3], aboveGround: 1.6 } }, ...stills.slice(1)] })).toThrow();
  });

  it("covers the four gallery categories and has Czech and English texts for every still", () => {
    const c = parseRenderConfig(renderJson);
    expect(new Set(c.stills.map((s) => s.category))).toEqual(new Set(["exterior", "interior", "evening", "aerial"]));
    expect(c.stills.filter((s) => s.category === "aerial")).toHaveLength(1);
    for (const s of c.stills) for (const t of [s.label, s.alt]) expect(t.cs.length > 3 && t.en.length > 3).toBe(true);
  });

  it("writes its texts without digits, with Czech typography, and names the house in the share image's alt text", () => {
    const c = parseRenderConfig(renderJson);
    for (const [k, t] of allTexts(c)) {
      // numbers of the model belong to the pages, never to a picture's text (they would go stale)
      expect(t.cs, k).not.toMatch(/\d/);
      expect(t.en, k).not.toMatch(/\d/);
      expect(t.cs, `${k}: non-breaking spaces`).toBe(nb(t.cs, "cs"));
      expect(t.en, k).toBe(nb(t.en, "en"));
      expect(t.cs, `${k}: "ve zlatém"`).not.toMatch(/(^|\s)v\s+zlat/i);
    }
    expect(nb(c.og.alt.cs, "cs")).toContain(localized(house.name, "cs"));
    expect(nb(c.og.alt.en, "en")).toContain(localized(house.name, "en"));
  });

  it("gives each half of the compare pair its own title and alt text and keeps the first half out of the gallery", () => {
    const c = parseRenderConfig(renderJson);
    expect(c.compare.before.title.cs).not.toBe(c.compare.after.title.cs);
    expect(c.compare.before.alt.en).not.toBe(c.compare.after.alt.en);
    expect(c.compare.before.gallery).toBe(false);
    expect(c.compare.after.gallery ?? true).toBe(true);
  });
});

describe("counts and structure", () => {
  it("has the schema, a sha-256 hash that matches the content", () => {
    expect(out.schema).toBe("render-inputs/1");
    expect(out.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(contentHash(out as unknown as Record<string, unknown>)).toBe(out.hash);
    expect(out.modelHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("has one still per render.json entry with unique files, and the Open Graph shot at its size", () => {
    expect(out.stills.map((s) => s.id)).toEqual(cfg.stills.map((s) => s.id));
    for (const [i, s] of out.stills.entries()) expect(s.size).toEqual(cfg.stills[i].size);
    expect(new Set(out.stills.map((s) => s.file)).size).toBe(out.stills.length);
    expect(out.og.size).toEqual(cfg.og.size);
    expect(out.compare.before.gallery).toBe(cfg.compare.before.gallery ?? true);
    expect(out.compare.after.title).toEqual(cfg.compare.after.title);
  });

  it("has one day frame per time of the ranges, the still time among them", () => {
    const times = out.day.frames.map((f) => f.time.local);
    expect(times).toEqual(expandRanges(cfg.day.ranges));
    expect(expandRanges([{ from: "08:00", to: "09:00", stepMin: 30 }, { from: "09:00", to: "09:10", stepMin: 10 }])).toEqual(["08:00", "08:30", "09:00", "09:10"]);
    expect(out.day.frames.map((f) => f.index)).toEqual(times.map((_, i) => i));
    expect(times).toContain(out.day.stillTime);
    for (let i = 1; i < times.length; i++) expect(times[i] > times[i - 1]).toBe(true);
  });

  it("renders the phone version of the day with its own camera and size (not a crop of the landscape frames)", () => {
    const { size, camera } = out.day.portrait;
    expect(size).toEqual(cfg.day.portrait.size);
    expect(size[1]).toBeGreaterThan(size[0]);
    expect(camera.position).not.toEqual(out.day.camera.position);
    expect(camera.fov.verticalDeg).toBeGreaterThan(camera.fov.horizontalDeg);
    const files = out.day.frames.map((f) => f.portrait.file);
    expect(new Set(files).size).toBe(files.length);
    for (const f of out.day.frames) expect(f.portrait.file).not.toBe(f.file);
  });

  it("has the orbit frames, scroll frames and variants of the config", () => {
    const o = out.orbit;
    const n = cfg.orbit.frameCount;
    expect([o.frameCount, o.fps, o.scrollStep]).toEqual([n, cfg.orbit.fps, cfg.orbit.scrollStep]);
    expect(o.durationSec).toBeCloseTo(n / cfg.orbit.fps, 9);
    expect(o.scrollCount).toBe(Math.ceil(n / cfg.orbit.scrollStep));
    expect(o.variants.map((v) => v.id)).toEqual(cfg.orbit.variants.map((v) => v.id));
    for (const [i, v] of o.variants.entries()) {
      const c = cfg.orbit.variants[i];
      expect(v.size).toEqual(c.size);
      expect(v.focalMm).toBe(c.focalMm ?? cfg.orbit.focalMm);
      expect(v.elevationDeg).toBe(c.elevationDeg ?? cfg.orbit.elevationDeg);
      expect(v.fitMargin).toBe(c.fitMargin ?? cfg.orbit.fitMargin);
      const want = c.frameSelection === "all" ? n : o.scrollCount;
      expect(v.frames, v.id).toHaveLength(want);
      expect(v.frames.filter((f) => f.scrollIndex !== null).map((f) => f.scrollIndex)).toEqual(Array.from({ length: o.scrollCount }, (_, k) => k));
      if (c.frameSelection === "scroll") expect(v.frames.every((f) => f.index % o.scrollStep === 0)).toBe(true);
      expect(v.frames[v.frames.length - 1].file).toBe(`orbit/${v.id}/${String(v.frames[v.frames.length - 1].index).padStart(4, "0")}`);
    }
  });

  it("has the PV modules of the kernel and one blind per opening that has one, in every shot", () => {
    expect(out.pv.count).toBe(derived.pv.count);
    expect(out.pv.panels).toHaveLength(derived.pv.panels.length);
    expect(out.blinds.items.map((b) => b.openingId)).toEqual(derived.openings.filter((o) => o.blind).map((o) => o.id));
    for (const s of [...shots(), ...out.day.frames]) expect(s.blinds).toHaveLength(out.blinds.items.length);
    expect(out.orbit.blinds).toHaveLength(out.blinds.items.length);
  });

  it("puts every PV module in its roof plane, facing up and outwards", () => {
    for (const p of out.pv.panels) {
      expect(p.corners).toHaveLength(4);
      expect(p.normal[2]).toBeGreaterThan(0.2);
      const n = p.normal;
      for (const c of p.corners) expect(Math.abs((c[0] - p.center[0]) * n[0] + (c[1] - p.center[1]) * n[1] + (c[2] - p.center[2]) * n[2])).toBeLessThan(0.01);
    }
  });

  it("lists the trees and shrubs of the site with the graded ground height under them", () => {
    expect(out.vegetation.trees.length).toBe(sd.trees.length);
    for (const t of out.vegetation.trees) {
      expect(t.height).toBeGreaterThan(2);
      expect(t.crown).toBeGreaterThan(1);
      expect(Math.abs(t.z - site.terrain.groundAt(t.x, t.y))).toBeLessThan(0.002);
    }
  });

  it("passes the cloud sky through to the render scripts", () => {
    expect(out.sky.clouds).toEqual(cfg.sky.clouds);
    const clouds = cfg.sky.clouds;
    if (clouds) {
      expect(path.isAbsolute(clouds.hdri)).toBe(false);
      expect(clouds.hdri.startsWith("assets/")).toBe(true);
      expect(clouds.visibleTo).toContain("camera");
    }
  });
});

describe("lamps", () => {
  it("has interior and exterior lamps, and the garden lights of the site under the C3 kinds", () => {
    const items = out.lights.items;
    expect(new Set(items.map((l) => l.group))).toEqual(new Set(["interior", "exterior"]));
    expect(items.some((l) => l.kind === "downlight")).toBe(true);
    for (const l of items.filter((x) => ["pool", "garden", "pillar"].includes(x.kind))) expect(l.group).toBe("exterior");
    const pools = derived.outdoor.filter((o) => o.pool);
    const pl = items.filter((l) => l.kind === "pool");
    expect(pl.length > 0).toBe(pools.length > 0);
    for (const l of pl) {
      const inside = pools.some((o) => {
        const [x0, y0, x1, y1] = o.pool!.water;
        return l.pos[0] >= x0 - 1e-6 && l.pos[0] <= x1 + 1e-6 && l.pos[1] >= y0 - 1e-6 && l.pos[1] <= y1 + 1e-6 && l.pos[2] < o.pool!.waterZ && l.pos[2] > o.pool!.floorZ;
      });
      expect(inside, "a pool light sits under the water in a basin wall").toBe(true);
    }
    const lit = sd.trees.filter((t) => t.uplight);
    const up = items.filter((l) => l.kind === "garden" && l.space === "tree_uplight");
    expect(up).toHaveLength(lit.length);
    for (const l of up) {
      expect(lit.some((t) => Math.hypot(t.x - l.pos[0], t.y - l.pos[1]) < 1.5), "an uplight stands at a tree marked uplight").toBe(true);
      expect(l.spot?.direction[2]).toBeGreaterThan(0.3);
      expect(l.pos[2] - site.terrain.groundAt(l.pos[0], l.pos[1])).toBeLessThan(0.2);
    }
    const pillars = sd.pillars.filter((p) => p.items.includes("light"));
    expect(items.filter((l) => l.kind === "pillar")).toHaveLength(pillars.length);
  });
});

describe("sun", () => {
  it("agrees with an independent almanac formula within 0.3 degree for every shot", () => {
    for (const s of [...shots(), ...out.day.frames]) {
      const utcMs = Date.parse(s.time.utc);
      const ref = almanacSun(utcMs, out.location.lat, out.location.lon);
      expect(Math.abs(s.sun.elevationGeomDeg - ref.el), `${s.id} elevation`).toBeLessThan(0.3);
      if (ref.el > 0) expect(angleDiff(s.sun.azimuthTrueDeg, ref.az), `${s.id} azimuth`).toBeLessThan(0.3);
    }
  });

  it("agrees with the web sun module within 0.1 degree once it is implemented", async () => {
    const web = await resolveSunProvider();
    if (web === solarProvider) return; // src/lib/calc/sun.ts is still a stub: the local NOAA implementation is in use
    for (const f of out.day.frames) {
      const p = web.position(Date.parse(f.time.utc), out.location.lat, out.location.lon);
      expect(angleDiff(p.azimuthDeg, f.sun.azimuthTrueDeg)).toBeLessThan(0.1);
      expect(Math.abs(p.elevationDeg - f.sun.elevationDeg)).toBeLessThan(0.1);
    }
  });

  it("has the physical limits: noon elevation 90 - lat + declination, below the horizon after sunset", () => {
    const decl = 23.44; // summer solstice
    expect(out.daylight.noonElevationDeg).toBeGreaterThan(90 - out.location.lat + decl - 0.3);
    expect(out.daylight.noonElevationDeg).toBeLessThan(90 - out.location.lat + decl + 0.3);
    const noon = solarPosition(localToUtc(out.date, out.daylight.solarNoon, out.location.tz).utcMs, out.location.lat, out.location.lon);
    expect(noon.elevationGeomDeg).toBeCloseTo(90 - out.location.lat + decl, 0);
    expect(angleDiff(noon.azimuthDeg, 180)).toBeLessThan(1);
    const sunsetMin = Number(out.daylight.sunset.slice(0, 2)) * 60 + Number(out.daylight.sunset.slice(3));
    for (const f of out.day.frames) {
      const min = Number(f.time.local.slice(0, 2)) * 60 + Number(f.time.local.slice(3));
      if (min > sunsetMin + 15) expect(f.sun.elevationGeomDeg, f.time.local).toBeLessThan(-0.5);
      if (min > 8 * 60 && min < sunsetMin - 60) expect(f.sun.elevationDeg, f.time.local).toBeGreaterThan(5);
    }
  });

  it("moves east to south to west and rises then falls over the day", () => {
    const az = out.day.frames.map((f) => f.sun.azimuthTrueDeg);
    for (let i = 1; i < az.length; i++) expect(az[i]).toBeGreaterThan(az[i - 1]);
    const el = out.day.frames.map((f) => f.sun.elevationDeg);
    const peak = el.indexOf(Math.max(...el));
    for (let i = 1; i <= peak; i++) expect(el[i]).toBeGreaterThan(el[i - 1]);
    for (let i = peak + 1; i < el.length; i++) expect(el[i]).toBeLessThan(el[i - 1]);
    expect(angleDiff(az[peak], 180)).toBeLessThan(30);
  });

  it("gives a unit direction vector consistent with the angles, in the house frame", () => {
    for (const f of out.day.frames) {
      const [x, y, z] = f.sun.direction;
      expect(Math.hypot(x, y, z)).toBeCloseTo(1, 5);
      expect(Math.asin(z) * DEG).toBeCloseTo(f.sun.elevationDeg, 2);
      expect(angleDiff(((Math.atan2(x, y) * DEG) + 360) % 360, f.sun.azimuthHouseDeg)).toBeLessThan(0.01);
      expect(angleDiff(f.sun.azimuthTrueDeg, f.sun.azimuthHouseDeg + out.location.houseAxisBearingDeg)).toBeLessThan(0.01);
    }
  });

  it("turns the lamps on after sunset and off in daylight, and the compare pair goes from dark to lit", () => {
    const first = out.day.frames[0], last = out.day.frames[out.day.frames.length - 1];
    expect(first.lights.interior).toBe(0);
    expect(last.lights.interior).toBe(1);
    expect(last.lights.exterior).toBe(1);
    const lv = out.day.frames.map((f) => f.lights.interior);
    for (let i = 1; i < lv.length; i++) expect(lv[i]).toBeGreaterThanOrEqual(lv[i - 1] - 1e-9);
    expect(out.compare.before.lights.interior).toBe(0);
    expect(out.compare.after.lights.interior).toBe(1);
    expect(out.compare.after.sun.elevationDeg).toBeLessThan(0);
    expect(out.compare.before.sun.elevationDeg).toBeGreaterThan(10);
  });

  it("finds sunrise and sunset in the expected window for the summer solstice at this latitude", () => {
    const ev = dayEvents(out.date, out.location.tz, out.location.lat, out.location.lon, (t, la, lo) => solarProvider.position(t, la, lo).elevationGeomDeg);
    expect(ev).toEqual(out.daylight as unknown as typeof ev);
    expect(out.daylight.sunrise >= "04:30" && out.daylight.sunrise <= "05:10").toBe(true);
    expect(out.daylight.sunset >= "20:45" && out.daylight.sunset <= "21:20").toBe(true);
  });
});

describe("roof occlusion of the sun", () => {
  const roofs = [{ eaveRect: [0, 0, 10, 10] as [number, number, number, number], eaveHeight: 3 }];
  const dir = (el: number, az = 90): Vec3 => [Math.sin(az * RAD) * Math.cos(el * RAD), Math.cos(az * RAD) * Math.cos(el * RAD), Math.sin(el * RAD)];
  it("blocks a high sun under the roof and lets a low one out below the eave", () => {
    // 5 m from the east eave edge at 1.5 m: a ray gains 1.5 m at 16.7 degrees
    expect(roofBlocks(roofs, [5, 5, 1.5], dir(30))).toBe(true);
    expect(roofBlocks(roofs, [5, 5, 1.5], dir(10))).toBe(false);
  });
  it("never blocks a camera that is outside the roof outline or above the eave", () => {
    expect(roofBlocks(roofs, [-2, 5, 1.5], dir(80))).toBe(false);
    expect(roofBlocks(roofs, [5, 5, 3.5], dir(80))).toBe(false);
  });
});

describe("blinds", () => {
  const product = () => house.shading.blinds.product;

  it("uses the one product of house.json, with the box hidden and sections no wider than the product allows", () => {
    const d = out.blinds.details;
    for (const k of ["slatWidth", "slatPitch", "slatThickness", "railWidth", "railDepth", "boxDepth", "reveal", "maxSectionWidth"] as const) expect(d[k], k).toBe(product()[k]);
    expect(d.tilt).toBe("outer-edge-down");
    for (const b of out.blinds.items) {
      expect(b.box.hidden).toBe(true);
      expect(b.sections.reduce((s, x) => s + x.width, 0)).toBeCloseTo(b.width, 3);
      for (const s of b.sections) expect(s.width).toBeLessThanOrEqual(product().maxSectionWidth + 1e-9);
    }
  });

  it("tilts the slats (outer edge down) just far enough to stop a ray at the profile angle", () => {
    const { slatPitch: p, slatWidth: w } = product();
    // independent: the smallest tilt at which a ray grazing the outer edge of the upper slat meets the lower slat
    const blocked = (alpha: number, beta: number): boolean => {
      const a = alpha * RAD, b = beta * RAD;
      return p - w * Math.sin(b) - w * Math.cos(b) * Math.tan(a) <= 1e-12;
    };
    for (const alpha of [5, 15, 25, 35, 45, 55, 65, 75]) {
      let beta = 0;
      while (!blocked(alpha, beta) && beta < 90) beta += 0.01;
      expect(cutoffTilt(alpha, p, w), `profile ${alpha}`).toBeCloseTo(beta, 1);
    }
    expect(cutoffTilt(80, p, w)).toBe(0); // a steep sun is stopped by horizontal slats
  });

  it("follows the auto rule: down to autoDrop at the cut-off tilt only on sunlit glazing above the threshold", () => {
    const threshold = out.blinds.rule.closeAboveIrradiance;
    for (const f of out.day.frames) {
      for (const [i, s] of f.blinds.entries()) {
        if (s.irradiance > threshold) {
          expect(s.drop, `${f.id} ${out.blinds.items[i].openingId}`).toBe(cfg.blinds.autoDrop);
          expect(s.slatAngleDeg).toBeGreaterThanOrEqual(0);
          expect(s.slatAngleDeg).toBeLessThanOrEqual(cfg.blinds.closedSlatAngleDeg);
        } else expect(s.drop).toBe(0);
      }
    }
  });

  it("keeps a blind up while the roof edge above it shades its glazing (overhang-aware rule)", () => {
    let shadedFrames = 0;
    for (const f of out.day.frames) {
      for (const [i, b] of out.blinds.items.entries()) {
        const shaded = overhangShadedFraction({ azimuthTrue: b.azimuthTrueDeg, sill: b.sill, head: b.head, overhang: b.overhang }, { azimuth: f.sun.azimuthTrueDeg, altitude: f.sun.elevationDeg });
        if (shaded >= 1) {
          shadedFrames++;
          expect(f.blinds[i].drop, `${f.id} ${b.openingId}`).toBe(0);
        }
      }
    }
    expect(shadedFrames).toBeGreaterThan(0);
    // a midsummer noon sun is kept off the south glazing by the eaves: no south blind comes down
    const noon = out.day.frames.reduce((a, f) => (f.sun.elevationDeg > a.sun.elevationDeg ? f : a));
    for (const [i, b] of out.blinds.items.entries()) {
      if (angleDiff(b.azimuthTrueDeg - out.location.houseAxisBearingDeg, 180) < 30) expect(noon.blinds[i].drop, b.openingId).toBe(0);
    }
  });

  it("applies the explicit requests of a shot", () => {
    const req = (s: StillShot) => cfg.stills.find((c) => c.id === s.id)!.blinds;
    for (const s of out.stills) {
      const r = req(s);
      if (r === "open") for (const b of s.blinds) expect(b.drop).toBe(0);
      if (r === "closed") for (const b of s.blinds) expect([b.drop, b.slatAngleDeg]).toEqual([cfg.blinds.maxDrop, cfg.blinds.closedSlatAngleDeg]);
      if (typeof r === "object") for (const b of s.blinds) expect([b.drop, b.slatAngleDeg]).toEqual([r.drop, r.slatAngleDeg]);
    }
  });
});

describe("louvres, gates and garage door", () => {
  it("turns the louvres within their stops: the shot's angle, or the cut-off rule", () => {
    expect(out.screens.length).toBe(derived.screens.length);
    for (const sc of out.screens) expect(sc.closedDeg).toBe(derived.screens.find((d) => d.id === sc.id)!.closedDeg);
    const all = [...shots(), ...out.day.frames];
    for (const s of all) {
      expect(s.screens.items).toHaveLength(out.screens.length);
      for (const [i, it] of s.screens.items.entries()) {
        expect(it.angleDeg).toBeGreaterThanOrEqual(out.screens[i].closedDeg);
        expect(it.angleDeg).toBeLessThanOrEqual(out.screens[i].openDeg);
        if (s.screens.mode === "auto") expect(it.angleDeg).toBe(screenCutoff(out.screens[i], s.sun));
      }
    }
    for (const c of cfg.stills) {
      if (typeof c.screens !== "object") continue;
      const s = out.stills.find((x) => x.id === c.id)!;
      expect(s.screens.angleDeg).toBe(Math.min(out.screens[0].openDeg, Math.max(out.screens[0].closedDeg, c.screens.angleDeg)));
    }
  });

  it("finds a cut-off angle at which the blades stop the sun and one degree more lets it through", () => {
    const sc = out.screens[0];
    for (const f of out.day.frames) {
      const a = screenCutoff(sc, f.sun);
      const s: [number, number] = [f.sun.direction[0], f.sun.direction[1]];
      const l = Math.hypot(...s);
      if (a === sc.openDeg || a === sc.closedDeg || l < 1e-9) continue;
      expect(bladesBlock(sc, a, [s[0] / l, s[1] / l]), f.id).toBe(true);
      expect(bladesBlock(sc, a + 1, [s[0] / l, s[1] / l]), f.id).toBe(false);
    }
  });

  it("carries the gates and the garage door of every shot (closed unless the shot opens them)", () => {
    for (const c of cfg.stills) {
      const s = out.stills.find((x) => x.id === c.id)!;
      expect(s.gates).toEqual({ driveway: c.gates?.driveway ?? 0, walkway: c.gates?.walkway ?? 0 });
      expect(s.garageDoor).toBe(c.garageDoor ?? 0);
    }
    for (const s of [...shots(), ...out.day.frames]) {
      for (const v of [s.gates.driveway, s.gates.walkway, s.garageDoor]) expect(v >= 0 && v <= 1).toBe(true);
    }
  });
});

describe("terrain", () => {
  it("matches the graded TypeScript terrain at the nodes and between them, with holes under the pools", () => {
    const { x0, y0, step, nx, ny, heightsMm } = out.terrain.grid;
    expect(heightsMm).toHaveLength(nx * ny);
    expect(step).toBe(cfg.terrain.stepM);
    expect((nx - 1) * step).toBeCloseTo(cfg.terrain.extentM, 6);
    const rnd = mulberry32(7);
    for (let k = 0; k < 300; k++) {
      const i = Math.floor(rnd() * nx), j = Math.floor(rnd() * ny);
      expect(Math.abs(heightsMm[j * nx + i] / 1000 - site.terrain.groundAt(x0 + i * step, y0 + j * step))).toBeLessThan(0.0006);
    }
    for (let k = 0; k < 200; k++) {
      const fx = rnd() * (nx - 1.001), fy = rnd() * (ny - 1.001);
      const i = Math.floor(fx), j = Math.floor(fy), tx = fx - i, ty = fy - j;
      const h = (a: number, b: number): number => heightsMm[(j + b) * nx + i + a] / 1000;
      const bil = h(0, 0) * (1 - tx) * (1 - ty) + h(1, 0) * tx * (1 - ty) + h(0, 1) * (1 - tx) * ty + h(1, 1) * tx * ty;
      expect(Math.abs(bil - site.terrain.groundAt(x0 + fx * step, y0 + fy * step))).toBeLessThan(0.08);
    }
    expect(out.terrain.voids).toEqual(derived.groundVoids.map((v) => [...v]));
  });

  it("covers the extent of the config around the house", () => {
    const { x0, y0, step, nx, ny } = out.terrain.grid;
    const cx = x0 + ((nx - 1) * step) / 2, cy = y0 + ((ny - 1) * step) / 2;
    expect(Math.abs(cx - (derived.bbox.x0 + derived.bbox.x1) / 2)).toBeLessThanOrEqual(step);
    expect(Math.abs(cy - (derived.bbox.y0 + derived.bbox.y1) / 2)).toBeLessThanOrEqual(step);
    for (const [x, y] of out.house.footprint) expect(x > x0 && x < x0 + (nx - 1) * step && y > y0 && y < y0 + (ny - 1) * step).toBe(true);
  });
});

describe("cameras", () => {
  const roomBoxes = () => derived.rooms.flatMap((r) => (r.bbox ? [r.bbox] : []));

  it("keeps the cameras of exterior, evening and aerial stills outside the walls", () => {
    for (const s of out.stills.filter((x) => x.category !== "interior")) {
      const [x, y] = s.camera.position;
      expect(pointInPoly(x, y, out.house.footprint), `${s.id} is inside the walls`).toBe(false);
    }
  });

  it("keeps the cameras of interior stills inside a room, 0.2 m from its walls, and the target inside the building", () => {
    for (const s of out.stills.filter((x) => x.category === "interior")) {
      const [x, y, z] = s.camera.position;
      const room = roomBoxes().find((b) => x > b.x0 + 0.2 && x < b.x1 - 0.2 && y > b.y0 + 0.2 && y < b.y1 - 0.2);
      expect(room, `${s.id} is not inside a room`).toBeDefined();
      expect(z).toBeGreaterThan(1);
      expect(z).toBeLessThan(house.clearHeight - 0.4);
      expect(pointInPoly(s.camera.target[0], s.camera.target[1], out.house.footprint)).toBe(true);
    }
  });

  it("has focal lengths that give the stated field of view and unit forward vectors", () => {
    for (const s of [...shots(), { ...out.day, id: "day" }, { id: "day portrait", ...out.day.portrait }]) {
      const f = fieldOfView(s.camera.focalMm, cfg.sensorWidthMm, s.size);
      expect(s.camera.fov.horizontalDeg).toBeCloseTo(f.horizontalDeg, 6);
      expect(s.camera.fov.verticalDeg).toBeCloseTo(f.verticalDeg, 6);
      expect(Math.hypot(...s.camera.forward)).toBeCloseTo(1, 5);
      expect(Math.max(s.camera.fov.horizontalDeg, s.camera.fov.verticalDeg), s.id).toBeGreaterThan(30);
      expect(Math.max(s.camera.fov.horizontalDeg, s.camera.fov.verticalDeg), s.id).toBeLessThan(110);
    }
  });

  it("puts the target near the centre of every frame (a level camera keeps it in place with the lens shift)", () => {
    for (const v of views()) {
      const p = project(v.camera, v.size, v.camera.target);
      expect(p, v.name).not.toBeNull();
      expect(Math.abs(p!.x), v.name).toBeLessThan(0.25);
      expect(Math.abs(p!.y), v.name).toBeLessThan(0.3);
    }
  });

  it("shows what the alt text names: every subject inside the frame, facing the camera and not hidden behind the plot", () => {
    for (const v of views()) {
      const occ = occludersWithGates(occluders, sd.gates, v.gates, site.terrain.groundAt);
      for (const w of v.subjects) {
        const f = feature(w, v.camera.position);
        expect(f, `${v.name}: the model has no ${w}`).not.toBeNull();
        const tree = sd.trees.find((t) => t.id === f!.selfId);
        if (tree) expect(crownOnImage(v.camera, v.size, tree), `${v.name}: ${w} out of frame`).not.toBeNull();
        else expect(inFrameShare(v.camera, v.size, f!), `${v.name}: ${w} in frame`).toBeGreaterThanOrEqual(0.5);
        expect(faces(f!, v.camera.position), `${v.name}: ${w} faces away`).toBe(true);
        expect(hiddenShare(v.camera.position, f!.points, occ, { ignore: f!.selfId }), `${v.name}: ${w} hidden`).toBeLessThanOrEqual(0.5);
      }
    }
  });
});

describe("day sequence framing (the hero)", () => {
  const TITLE_ZONE = { x0: -1, x1: -0.1, y0: 0.3, y1: 1 }; // the top-left 45 % x 35 % of the frame
  const central = (cam: ResolvedCamera, size: readonly [number, number], f: Feature): boolean =>
    f.points.every((p) => {
      const q = project(cam, size, p);
      return !!q && Math.abs(q.x) <= 0.8 && Math.abs(q.y) <= 1;
    });

  it("stands on the plot in the garden, at eye height, looking at the house", () => {
    for (const cam of [out.day.camera, out.day.portrait.camera]) {
      const p = cam.position;
      expect(pointInPolygon([p[0], p[1]], site.plot)).toBe(true);
      expect(distToBoundary([p[0], p[1]], site.plot)).toBeGreaterThanOrEqual(0.8);
      expect(pointInPoly(p[0], p[1], out.house.footprint)).toBe(false);
      expect(roofBlocks(derived.roofs.map((r) => ({ eaveRect: r.eaveRect as [number, number, number, number], eaveHeight: r.eaveHeight })), p, [0, 0, 1])).toBe(false);
      expect(cam.aboveGround).toBeGreaterThanOrEqual(1.2);
      expect(cam.aboveGround).toBeLessThanOrEqual(2.6);
      expect(cam.level).toBe(true);
    }
  });

  it("fills at least 60 % of the landscape width with the house, the terrace corner and the main glazing in the central 80 %", () => {
    const cam = out.day.camera, size = out.day.size;
    expect(widthShare(cam, size, silhouette)).toBeGreaterThanOrEqual(0.6);
    for (const w of ["terrace-corner", "slider"]) expect(central(cam, size, feature(w)!), w).toBe(true);
  });

  it("frames the right edge with the walnut and keeps the title zone over sky or roof", () => {
    const cam = out.day.camera, size = out.day.size;
    const c = crownOnImage(cam, size, walnut());
    expect(c, "the walnut is in the frame").not.toBeNull();
    expect(c!.xMin, "the walnut crown stays in the right quarter").toBeGreaterThanOrEqual(0.5);
    const zone = zoneSkyOrRoof(cam, size, TITLE_ZONE, shape, occluders, cam.groundZ);
    expect(zone.share, JSON.stringify(zone.hits)).toBeGreaterThanOrEqual(0.9);
  });

  it("composes the phone frame: house at least 45 % of the width, roofline in the top third, lawn in the lower third", () => {
    const cam = out.day.portrait.camera, size = out.day.portrait.size;
    expect(widthShare(cam, size, silhouette)).toBeGreaterThanOrEqual(0.45);
    for (const w of ["terrace-corner", "slider"]) expect(central(cam, size, feature(w)!), w).toBe(true);
    const ys = (pts: Vec3[]) => pts.map((p) => project(cam, size, p)).filter((p) => p !== null && Math.abs(p.x) <= 1).map((p) => p!.y);
    // the roofline rises into the top third (sky above it for the title), the house stands in the middle third and the lower
    // third, under the clock and the sun arc, is lawn
    expect(Math.max(...ys(shape.roofPlanes.flat())), "the roofline reaches the top third").toBeGreaterThanOrEqual(1 / 3);
    const eaves = derived.roofs.flatMap((r) => {
      const [x0, y0, x1, y1] = r.eaveRect;
      return [[x0, y0], [x1, y0], [x1, y1], [x0, y1]].map(([x, y]) => [x, y, r.eaveHeight] as Vec3);
    });
    expect(Math.max(...ys(eaves)), "the eave stays above the middle of the frame").toBeGreaterThan(0);
    const base = shape.outline.map(([x, y]) => [x, y, site.terrain.groundAt(x, y)] as Vec3);
    expect(Math.min(...ys(base)), "the lower third is free of the house").toBeGreaterThanOrEqual(-1 / 3);
  });

  it("uses the hero camera family for the Open Graph image at dusk, and the opposite diagonal for the compare pair", () => {
    expect(out.og.camera.position.slice(0, 2)).toEqual(out.day.camera.position.slice(0, 2));
    expect(out.og.sun.elevationDeg).toBeLessThan(0);
    expect(out.og.lights.interior).toBeGreaterThan(0.5);
    const az = (c: ResolvedCamera): number => Math.atan2(c.forward[0], c.forward[1]) * DEG;
    expect(angleDiff(az(out.compare.before.camera), az(out.day.camera))).toBeGreaterThanOrEqual(45);
    expect(out.compare.before.camera).toEqual(out.compare.after.camera);
  });
});

describe("orbit", () => {
  const variants = () => out.orbit.variants;
  const captionFrames = (): Set<number> => new Set(out.orbit.captions.flatMap((c) => c.frames));

  it("keeps the whole house in the frame (with the variant's fit margin) at every frame", () => {
    for (const v of variants()) {
      for (const f of v.frames) {
        for (const c of silhouette) expect(insideFrame(project(f.camera, v.size, c), v.fitMargin - 1e-6), `${v.id} frame ${f.index}`).toBe(true);
      }
    }
  });

  it("closes the loop: equal angle steps, smooth position and distance, the elevation of the config", () => {
    const o = cfg.orbit;
    for (const v of variants()) {
      const n = v.frames.length;
      const step = (360 * (v.frames[1].index - v.frames[0].index)) / out.orbit.frameCount;
      for (let i = 0; i < n; i++) {
        const a = v.frames[i], b = v.frames[(i + 1) % n];
        expect(a.angleDeg).toBeCloseTo(orbitAngle(o, a.index), 2);
        expect(angleDiff(b.angleDeg, a.angleDeg), `step ${i}`).toBeCloseTo(step, 2);
        expect(a.elevationDeg).toBeCloseTo(orbitElevation(o, v.elevationDeg, a.angleDeg), 2);
        const pa = a.camera.position, pb = b.camera.position;
        expect(Math.hypot(pb[0] - pa[0], pb[1] - pa[1], pb[2] - pa[2]), `${v.id} jump ${i}`).toBeLessThan(1.2 * (b.index - a.index + (b.index < a.index ? out.orbit.frameCount : 0)));
        expect(Math.abs(b.radius - a.radius)).toBeLessThan(0.3 * Math.max(1, v.frames[1].index - v.frames[0].index));
        const horiz = Math.hypot(pa[0] - out.orbit.target[0], pa[1] - out.orbit.target[1]);
        expect(horiz).toBeCloseTo(a.radius, 2);
        expect(pa[2]).toBeCloseTo(out.orbit.target[2] + a.radius * Math.tan(a.elevationDeg * RAD), 2);
      }
    }
    expect(variants()[0].frames[0].angleDeg).toBeCloseTo(o.startAzimuthDeg, 6);
  });

  it("is a low orbit around the house in afternoon light that reads on the facades", () => {
    for (const v of variants()) {
      expect(v.radiusMin).toBeGreaterThan(Math.max(derived.bbox.w, derived.bbox.d) / 2);
      expect(v.radiusMax).toBeLessThan(60);
      for (const f of v.frames) expect(f.elevationDeg).toBeLessThan(35);
    }
    expect(out.orbit.sun.phase).toBe("day");
    expect(out.orbit.sun.elevationDeg).toBeGreaterThan(25);
    expect(out.orbit.sun.elevationDeg).toBeLessThan(45);
  });

  it("lets the trees hide more than 30 % of the house in at most 20 frames, never in a caption window or frame 0", () => {
    const samples = houseSamples(shape, 1.5);
    const caps = captionFrames();
    for (const v of variants()) {
      const bad = v.frames.filter((f) => occludedHouseShare(f.camera.position, samples, shape, crowns) > 0.3).map((f) => f.index);
      const limit = Math.ceil((20 * v.frames.length) / out.orbit.frameCount);
      expect(bad.length, `${v.id}: frames ${bad.join(", ")}`).toBeLessThanOrEqual(limit);
      expect(bad.filter((i) => caps.has(i) || i === 0), `${v.id}: occluded caption frames`).toEqual([]);
    }
  });

  it("shows each caption while its feature faces the camera, inside the frame and not behind a tree", () => {
    expect(out.orbit.captions.map((c) => c.feature).sort()).toEqual([...cfg.orbit.captions.features].sort());
    for (const c of out.orbit.captions) {
      expect(c.frames.length, c.feature).toBeGreaterThan(0);
      for (const v of variants()) {
        for (const fr of v.frames.filter((x) => c.frames.includes(x.index))) {
          const f = feature(c.feature, fr.camera.position)!;
          expect(faces(f, fr.camera.position), `${c.feature} faces away in ${v.id} ${fr.index}`).toBe(true);
          expect(inFrameShare(fr.camera, v.size, f), `${c.feature} in ${v.id} ${fr.index}`).toBeGreaterThanOrEqual(0.5);
          expect(hiddenShare(fr.camera.position, f.points, occluders, { ignore: f.selfId }), `${c.feature} hidden in ${v.id} ${fr.index}`).toBeLessThanOrEqual(0.5);
        }
      }
      // the window is centred on the feature's azimuth and no wider than the config allows
      for (const i of c.frames) expect(angleDiff(orbitAngle(cfg.orbit, i), c.azimuthDeg)).toBeLessThanOrEqual(cfg.orbit.captions.halfWindowDeg + 1e-6);
    }
  });

  it("opens on the terrace, the pool and the PV roof (the poster and the reduced-motion frame)", () => {
    for (const v of variants()) {
      const f0 = v.frames[0];
      for (const w of ["terrace", "pool", "pv"]) {
        const f = feature(w, f0.camera.position)!;
        expect(f, w).not.toBeNull();
        expect(inFrameShare(f0.camera, v.size, f), `${v.id} ${w}`).toBeGreaterThanOrEqual(0.5);
        expect(faces(f, f0.camera.position), `${v.id} ${w}`).toBe(true);
        expect(hiddenShare(f0.camera.position, f.points, occluders), `${v.id} ${w}`).toBeLessThanOrEqual(0.5);
      }
    }
  });
});

describe("determinism and privacy", () => {
  it("is byte-identical when built twice", () => {
    const again = buildRenderInputs({ root, sun: solarProvider, furnitureReport: null });
    expect(again.text).toBe(res.text);
    expect(again.data.hash).toBe(res.data.hash);
  });

  it("changes the hash when a camera changes, and only then", () => {
    const stills = (renderJson.stills as Record<string, unknown>[]).map((s, i) => {
      if (i !== 0) return s;
      const cam = s.camera as { position: number[] };
      return { ...s, camera: { ...cam, position: [cam.position[0] + 0.1, ...cam.position.slice(1)] } };
    });
    const changed = buildRenderInputs({ root, sun: solarProvider, furnitureReport: null, renderJson: { ...renderJson, stills } });
    expect(changed.data.hash).not.toBe(res.data.hash);
    expect(changed.data.modelHash).not.toBe(res.data.modelHash);
    const copy = (): BuildResult => buildRenderInputs({ root, sun: solarProvider, furnitureReport: null, renderJson: JSON.parse(JSON.stringify(renderJson)) });
    expect(copy().data.hash).toBe(copy().data.hash);
    // the hash of the model files is the project-wide one (byte exact), the same one that docs/HOUSE-FORMAT.md describes
    const files = fs.readdirSync(path.join(root, "model")).filter(isHashedModelFile).map((name) => ({ name, content: fs.readFileSync(path.join(root, "model", name), "utf8") }));
    expect(res.data.modelHash).toBe(hashModelFiles(files));
  });

  it("writes stable numbers: no NaN, no negative zero, at most 6 decimals", () => {
    expect(res.text).not.toMatch(/NaN|Infinity|-0[,\s\]]/);
    expect(res.text).not.toMatch(/\d\.\d{7,}/);
    expect(stableJson({ a: [1, 2.5, -0], b: "x", c: null })).toBe('{\n  "a": [1, 2.5, 0],\n  "b": "x",\n  "c": null\n}');
  });

  it("contains no private strings", () => {
    const bad = ["lut" + "yn", "dol" + "ni", "/Us" + "ers/", "Down" + "loads", "toma" + "nec", "wilc" + "zek", "24" + "87"];
    const text = res.text + JSON.stringify(renderJson);
    for (const s of bad) {
      // a bare number could appear by chance in a long list of coordinates, so it is only looked for in the hand-written file
      if (s === "24" + "87") expect(JSON.stringify(renderJson)).not.toContain(s);
      else expect(text.toLowerCase(), s).not.toContain(s.toLowerCase());
    }
  });

  it("links the inputs by repo-relative paths", () => {
    for (const p of Object.values(out.inputs.glb)) {
      expect(p.startsWith("public/models/")).toBe(true);
      expect(path.isAbsolute(p)).toBe(false);
    }
    expect(res.text).not.toMatch(/"\/(Users|home|private|tmp)\//);
  });
});
