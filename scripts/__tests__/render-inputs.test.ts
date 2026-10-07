// Tests of generated/render-inputs.json and model/render.json (what the Blender scripts read). The output is built in memory
// from the model files, so the tests do not depend on the git-ignored generated/render-inputs.json.
import fs from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { analyzeHouse, hashModelFiles, isHashedModelFile, type Derived } from "../../src/lib/model";
import { createSite } from "../../src/lib/model/site";
import { buildRenderInputs, contentHash, resolveSunProvider, solarProvider, stableJson, type BuildResult } from "../build-render-inputs";
import { boxCorners, fieldOfView, insideFrame, project, resolveCamera } from "../lib/render-camera";
import { parseRenderConfig } from "../lib/render-schema";
import { expandRanges, roofBlocks } from "../lib/render-shots";
import type { DayFrame, OrbitFrame, OrbitVariant, StillShot } from "../lib/render-types";
import { dayEvents, localToUtc, solarPosition } from "../lib/solar";

const root = path.resolve(__dirname, "..", "..");
const readJson = (rel: string): unknown => JSON.parse(fs.readFileSync(path.join(root, rel), "utf8"));
const renderJson = readJson("model/render.json") as Record<string, unknown>;
const houseJson = readJson("model/house.json");
const siteJson = readJson("model/site.json");
const RAD = Math.PI / 180;
const DEG = 180 / Math.PI;

type Vec3 = [number, number, number];
interface Out {
  schema: string;
  hash: string;
  modelHash: string;
  inputs: { sunSource: string; glb: Record<string, string>; furnitureReport: string | null };
  location: { lat: number; lon: number; houseAxisBearingDeg: number; tz: string };
  date: string;
  daylight: { sunrise: string; sunset: string; solarNoon: string; noonElevationDeg: number };
  terrain: { grid: { x0: number; y0: number; step: number; nx: number; ny: number; heightsMm: number[] }; plateau: { level: number; rects: number[][] } };
  vegetation: { trees: { x: number; y: number; z: number; height: number; crown: number }[]; shrubs: { x: number; y: number; z: number }[] };
  pv: { count: number; kwp: number; panels: { corners: Vec3[]; center: Vec3; normal: Vec3 }[] };
  blinds: { items: { openingId: string }[] };
  lights: { items: { group: string; kind: string; pos: Vec3 }[] };
  stills: StillShot[];
  day: { size: [number, number]; portrait: { size: [number, number]; crop: { x: number; y: number; width: number; height: number } }; stillTime: string; frames: DayFrame[]; camera: StillShot["camera"] };
  orbit: { frameCount: number; fps: number; durationSec: number; scrollStep: number; scrollCount: number; target: Vec3; sun: StillShot["sun"]; variants: OrbitVariant[] };
  compare: { before: StillShot; after: StillShot };
  og: StillShot;
}

let res: BuildResult;
let out: Out;
let derived: Derived;

beforeAll(() => {
  res = buildRenderInputs({ root, sun: solarProvider, furnitureReport: null });
  out = res.data as unknown as Out;
  derived = analyzeHouse(houseJson).derived;
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
const pointInPoly = (x: number, y: number, poly: readonly (readonly number[])[]): boolean => {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
};
const mulberry32 = (seed: number): (() => number) => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

describe("model/render.json", () => {
  it("passes the strict schema", () => {
    const cfg = parseRenderConfig(renderJson);
    expect(cfg.fictional).toBe(true);
    expect(cfg.stills.length).toBeGreaterThanOrEqual(8);
    expect(cfg.stills.length).toBeLessThanOrEqual(10);
    expect(new Set(cfg.stills.map((s) => s.id)).size).toBe(cfg.stills.length);
  });

  it("rejects unknown keys, bad clock times and bad sizes", () => {
    expect(() => parseRenderConfig({ ...renderJson, extra: 1 })).toThrow();
    const stills = renderJson.stills as Record<string, unknown>[];
    expect(() => parseRenderConfig({ ...renderJson, stills: [{ ...stills[0], time: "25:00" }, ...stills.slice(1)] })).toThrow();
    expect(() => parseRenderConfig({ ...renderJson, stills: [{ ...stills[0], size: [10, 10] }, ...stills.slice(1)] })).toThrow();
  });

  it("covers the four gallery categories and has Czech and English texts for every still", () => {
    const cfg = parseRenderConfig(renderJson);
    expect(new Set(cfg.stills.map((s) => s.category))).toEqual(new Set(["exterior", "interior", "evening", "aerial"]));
    for (const s of cfg.stills) for (const t of [s.label, s.alt]) expect(t.cs.length > 3 && t.en.length > 3).toBe(true);
  });
});

describe("counts and structure", () => {
  it("has the schema, a sha-256 hash that matches the content", () => {
    expect(out.schema).toBe("render-inputs/1");
    expect(out.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(contentHash(out as unknown as Record<string, unknown>)).toBe(out.hash);
    expect(out.modelHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("has 9 stills of 1920 x 1080 and one Open Graph shot of 1200 x 630", () => {
    expect(out.stills).toHaveLength(9);
    for (const s of out.stills) expect(s.size).toEqual([1920, 1080]);
    expect(out.og.size).toEqual([1200, 630]);
    expect(new Set(out.stills.map((s) => s.file)).size).toBe(9);
  });

  it("has 30 day frames with the required time steps", () => {
    const times = out.day.frames.map((f) => f.time.local);
    expect(times).toHaveLength(30);
    expect(times.slice(0, 8)).toEqual(["08:00", "09:00", "10:00", "11:00", "12:00", "13:00", "14:00", "15:00"]);
    expect(times.slice(8, 20)).toEqual(["16:00", "16:20", "16:40", "17:00", "17:20", "17:40", "18:00", "18:20", "18:40", "19:00", "19:20", "19:40"]);
    expect(times.slice(20)).toEqual(["20:00", "20:10", "20:20", "20:30", "20:40", "20:50", "21:00", "21:10", "21:20", "21:30"]);
    expect(expandRanges([{ from: "08:00", to: "09:00", stepMin: 30 }])).toEqual(["08:00", "08:30", "09:00"]);
    expect(out.day.frames.map((f) => f.index)).toEqual(Array.from({ length: 30 }, (_, i) => i));
    expect(times).toContain(out.day.stillTime);
  });

  it("has a 2:3 portrait crop inside the landscape frame", () => {
    const { crop, size } = out.day.portrait;
    expect(crop.width / crop.height).toBeCloseTo(2 / 3, 2);
    expect(size).toEqual([crop.width, crop.height]);
    expect(crop.x).toBeGreaterThanOrEqual(0);
    expect(crop.x + crop.width).toBeLessThanOrEqual(out.day.size[0]);
    expect(crop.height).toBeLessThanOrEqual(out.day.size[1]);
  });

  it("has 300 orbit frames at 24 fps (12.5 s) and 60 scroll frames", () => {
    const o = out.orbit;
    expect([o.frameCount, o.fps, o.durationSec, o.scrollStep, o.scrollCount]).toEqual([300, 24, 12.5, 5, 60]);
    const land = o.variants.find((v) => v.id === "landscape");
    const port = o.variants.find((v) => v.id === "portrait");
    expect(land?.frames).toHaveLength(300);
    expect(port?.frames).toHaveLength(60);
    expect(land?.frames.filter((f) => f.scrollIndex !== null)).toHaveLength(60);
    expect(port?.frames.map((f) => f.scrollIndex)).toEqual(Array.from({ length: 60 }, (_, i) => i));
    expect(port?.frames.every((f) => f.index % 5 === 0)).toBe(true);
    expect(land?.size).toEqual([1920, 1080]);
    expect(port && port.size[1] / port.size[0]).toBeCloseTo(1.5, 5);
  });

  it("has the 36 PV modules of the kernel and one blind per opening that has one", () => {
    expect(out.pv.count).toBe(36);
    expect(out.pv.panels).toHaveLength(36);
    expect(out.pv.panels.length).toBe(derived.pv.panels.length);
    expect(out.blinds.items.map((b) => b.openingId)).toEqual(derived.openings.filter((o) => o.blind).map((o) => o.id));
    for (const s of [...out.stills, out.og, out.compare.before, out.compare.after, ...out.day.frames]) expect(s.blinds).toHaveLength(out.blinds.items.length);
  });

  it("puts every PV module in its roof plane, facing up and outwards", () => {
    for (const p of out.pv.panels) {
      expect(p.corners).toHaveLength(4);
      expect(p.normal[2]).toBeGreaterThan(0.2);
      const n = p.normal;
      for (const c of p.corners) expect(Math.abs((c[0] - p.center[0]) * n[0] + (c[1] - p.center[1]) * n[1] + (c[2] - p.center[2]) * n[2])).toBeLessThan(0.01);
    }
  });

  it("has interior and exterior lamps", () => {
    const groups = new Set(out.lights.items.map((l) => l.group));
    expect(groups).toEqual(new Set(["interior", "exterior"]));
    expect(out.lights.items.some((l) => l.kind === "downlight")).toBe(true);
  });

  it("lists the trees and shrubs of the site with the ground height under them", () => {
    expect(out.vegetation.trees.length).toBeGreaterThan(3);
    const site = createSite(siteJson, out.location.houseAxisBearingDeg);
    for (const t of out.vegetation.trees) {
      expect(t.height).toBeGreaterThan(2);
      expect(t.crown).toBeGreaterThan(1);
      expect(Math.abs(t.z - site.terrain.groundAt(t.x, t.y))).toBeLessThan(0.002);
    }
  });
});

describe("sun", () => {
  it("agrees with an independent almanac formula within 0.3 degree for every shot", () => {
    const shots = [...out.stills, out.og, out.compare.before, out.compare.after, ...out.day.frames];
    for (const s of shots) {
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
    expect(az[0]).toBeLessThan(120);
    expect(az[az.length - 1]).toBeGreaterThan(300);
    const el = out.day.frames.map((f) => f.sun.elevationDeg);
    const peak = el.indexOf(Math.max(...el));
    expect(out.day.frames[peak].time.local).toBe("13:00");
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

  it("turns the lamps on after sunset and off in daylight", () => {
    const first = out.day.frames[0], last = out.day.frames[out.day.frames.length - 1];
    expect(first.lights.interior).toBe(0);
    expect(last.lights.interior).toBe(1);
    expect(last.lights.exterior).toBe(1);
    const lv = out.day.frames.map((f) => f.lights.interior);
    for (let i = 1; i < lv.length; i++) expect(lv[i]).toBeGreaterThanOrEqual(lv[i - 1] - 1e-9);
    expect(out.compare.before.lights.interior).toBe(0);
    expect(out.compare.after.lights.interior).toBe(1);
  });

  it("lets the sun and the sky show in the day sequence: the sun disc is visible in the evening frames", () => {
    const visible = out.day.frames.filter((f) => f.sunScreen?.visible);
    expect(visible.length).toBeGreaterThanOrEqual(8);
    expect(Math.max(...visible.map((f) => f.index))).toBeGreaterThan(20);
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

describe("terrain", () => {
  it("matches the TypeScript terrain at the nodes and between them", () => {
    const site = createSite(siteJson, out.location.houseAxisBearingDeg);
    const { x0, y0, step, nx, ny, heightsMm } = out.terrain.grid;
    expect(heightsMm).toHaveLength(nx * ny);
    expect(nx).toBe(181);
    expect(step).toBe(0.5);
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
  });

  it("is flat on the plateau and covers 90 x 90 m around the house", () => {
    const { x0, y0, step, nx, heightsMm } = out.terrain.grid;
    const [px0, py0, px1, py1] = out.terrain.plateau.rects[0];
    let checked = 0;
    for (let j = 0; j < nx; j++) {
      for (let i = 0; i < nx; i++) {
        const x = x0 + i * step, y = y0 + j * step;
        if (x > px0 + 0.5 && x < px1 - 0.5 && y > py0 + 0.5 && y < py1 - 0.5) {
          expect(heightsMm[j * nx + i]).toBe(out.terrain.plateau.level * 1000);
          checked++;
        }
      }
    }
    expect(checked).toBeGreaterThan(500);
    expect(x0).toBeLessThan(-30);
    expect(x0 + (nx - 1) * step).toBeGreaterThan(55);
    const cx = (x0 + (x0 + (nx - 1) * step)) / 2;
    expect(Math.abs(cx - (derived.bbox.x0 + derived.bbox.x1) / 2)).toBeLessThan(0.5);
  });
});

describe("cameras", () => {
  const cfg = () => parseRenderConfig(renderJson);
  const roomBoxes = () => derived.rooms.flatMap((r) => (r.bbox ? [r.bbox] : []));
  const footprint = () => out.stills[0] && (res.data as unknown as { house: { footprint: [number, number][] } }).house.footprint;

  it("keeps the cameras of exterior, evening and aerial stills outside the building and above the ground", () => {
    const fp = footprint();
    for (const s of out.stills.filter((x) => x.category !== "interior")) {
      const [x, y, z] = s.camera.position;
      expect(pointInPoly(x, y, fp), `${s.id} is inside the walls`).toBe(false);
      expect(z).toBeGreaterThan(1);
    }
  });

  it("keeps the cameras of interior stills inside a room, 0.2 m from its walls, and the target inside the building", () => {
    const fp = footprint();
    for (const s of out.stills.filter((x) => x.category === "interior")) {
      const [x, y, z] = s.camera.position;
      const room = roomBoxes().find((b) => x > b.x0 + 0.2 && x < b.x1 - 0.2 && y > b.y0 + 0.2 && y < b.y1 - 0.2);
      expect(room, `${s.id} is not inside a room`).toBeDefined();
      expect(z).toBeGreaterThan(1);
      expect(z).toBeLessThan(2.2);
      expect(pointInPoly(s.camera.target[0], s.camera.target[1], fp)).toBe(true);
    }
  });

  it("keeps the day camera on the covered terrace, under the roof, at eye height", () => {
    const terrace = derived.outdoor.find((o) => o.type === "terrace" && o.covered);
    expect(terrace).toBeDefined();
    const [tx0, ty0, tx1, ty1] = terrace!.rect;
    const [x, y, z] = out.day.camera.position;
    expect(x > tx0 && x < tx1 && y > ty0 && y < ty1).toBe(true);
    expect(z).toBeGreaterThan(1.2);
    expect(z).toBeLessThan(1.8);
    expect(roofBlocks([{ eaveRect: derived.roofs[0].eaveRect as [number, number, number, number], eaveHeight: derived.roofs[0].eaveHeight }], out.day.camera.position, [0, 0, 1])).toBe(true);
  });

  it("uses the same camera for the day / evening pair", () => {
    expect(out.compare.before.camera).toEqual(out.compare.after.camera);
    expect(out.compare.after.sun.elevationDeg).toBeLessThan(out.compare.before.sun.elevationDeg);
  });

  it("has focal lengths that give the stated field of view and unit forward vectors", () => {
    for (const s of [...out.stills, out.og, out.compare.before]) {
      const f = fieldOfView(s.camera.focalMm, 36, s.size);
      expect(s.camera.fov.horizontalDeg).toBeCloseTo(f.horizontalDeg, 6);
      expect(Math.hypot(...s.camera.forward)).toBeCloseTo(1, 5);
      expect(s.camera.fov.horizontalDeg).toBeGreaterThan(30);
      expect(s.camera.fov.horizontalDeg).toBeLessThan(110);
    }
    expect(cfg().sensorWidthMm).toBe(36);
  });

  it("looks at the building from the stills: the target is in the frame centre", () => {
    for (const s of out.stills) {
      const cam = resolveCamera({ position: s.camera.position, target: s.camera.target, focalMm: s.camera.focalMm, shift: s.camera.shift }, s.size, { sensorWidthMm: 36, near: 0.1, far: 600 });
      const p = project(cam, s.size, s.camera.target);
      expect(p && Math.abs(p.x) < 0.2 + 2 * Math.abs(s.camera.shift[0]) && Math.abs(p.y) < 0.2 + 2 * Math.abs(s.camera.shift[1])).toBe(true);
    }
  });
});

describe("orbit", () => {
  const variants = () => out.orbit.variants;

  it("keeps the whole building box in the frame at every frame of every variant", () => {
    const b = derived.bbox;
    for (const v of variants()) {
      for (const f of v.frames) {
        const cam = resolveCamera({ position: f.camera.position, target: out.orbit.target, focalMm: f.camera.focalMm }, v.size, { sensorWidthMm: 36, near: 0.1, far: 600 });
        for (const c of boxCorners(b.x0, b.y0, b.z0, b.x1, b.y1, b.z1)) {
          expect(insideFrame(project(cam, v.size, c), v.fitMargin - 1e-6), `${v.id} frame ${f.index}`).toBe(true);
        }
      }
    }
  });

  it("closes the loop: equal angle steps, and the last frame continues smoothly into the first", () => {
    const land = variants().find((v) => v.id === "landscape")!;
    const n = land.frames.length;
    const step = 360 / n;
    for (let i = 0; i < n; i++) {
      const a = land.frames[i], b = land.frames[(i + 1) % n];
      const d = (((b.angleDeg - a.angleDeg) % 360) + 360) % 360;
      // direction is counterclockwise (-1) or clockwise (+1): the step is +-360/n modulo 360
      expect(Math.min(Math.abs(d - step), Math.abs(d - (360 - step))), `step ${i}`).toBeLessThan(0.01);
      const pa = a.camera.position, pb = b.camera.position;
      expect(Math.hypot(pb[0] - pa[0], pb[1] - pa[1], pb[2] - pa[2]), `jump ${i}`).toBeLessThan(1.2);
      expect(Math.abs(b.radius - a.radius)).toBeLessThan(0.3);
    }
    expect(land.frames[0].file).toBe("orbit/landscape/0000");
    expect(land.frames[n - 1].file).toBe("orbit/landscape/0299");
  });

  it("derives radius and height from the bounding box, with the sun fixed at golden hour", () => {
    const land = variants().find((v) => v.id === "landscape")!;
    expect(land.radiusMin).toBeGreaterThan(Math.max(derived.bbox.w, derived.bbox.d) / 2);
    expect(land.radiusMax).toBeLessThan(120);
    for (const f of land.frames) {
      const horiz = Math.hypot(f.camera.position[0] - out.orbit.target[0], f.camera.position[1] - out.orbit.target[1]);
      expect(horiz).toBeCloseTo(f.radius, 2);
    }
    expect(out.orbit.sun.phase).toBe("golden");
    expect(out.orbit.sun.elevationDeg).toBeGreaterThan(3);
    expect(out.orbit.sun.elevationDeg).toBeLessThan(15);
    const first: OrbitFrame = land.frames[0];
    expect(first.camera.position[2]).toBeGreaterThan(out.orbit.target[2]);
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
      return { ...s, camera: { ...cam, position: [cam.position[0] + 0.1, cam.position[1], cam.position[2]] } };
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

  it("links the GLB inputs by repo-relative paths", () => {
    for (const p of Object.values(out.inputs.glb)) {
      expect(p.startsWith("public/models/")).toBe(true);
      expect(path.isAbsolute(p)).toBe(false);
    }
  });
});
