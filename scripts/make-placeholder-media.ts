// Generates PLACEHOLDER media for the site: small flat-shaded renders of the house model (walls, openings and roof faces from
// `derived`, cameras from `house.cameras`), so the scroll sequences, the slider and the gallery work before the Blender renders
// exist. The pipeline's real renders replace public/media/* and rewrite manifest.json (docs/ARCHITECTURE.md section 4).
//
//   npx tsx scripts/make-placeholder-media.ts        (uses sharp, which ships with Next.js)
//
// Everything about the house is read from the model; nothing here describes a real place. The sun is a plain astronomical
// formula for the latitude in the model, good enough to colour a placeholder (the site itself uses src/lib/calc/sun.ts).

import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";
import { derived, house } from "../src/lib/model/instance";

const OUT = join(process.cwd(), "public/media");
const QUALITY = 56;

type V3 = [number, number, number];
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a: V3, k: number): V3 => [a[0] * k, a[1] * k, a[2] * k];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a: V3): V3 => mul(a, 1 / (Math.hypot(...a) || 1));
const rad = (d: number) => (d * Math.PI) / 180;
const clamp = (v: number, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, v));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

// ------------------------------------------------------------------------------------------------ colours
type RGB = [number, number, number];
const hex = (c: string): RGB => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16)) as RGB;
const css = (c: RGB) => `rgb(${c.map((v) => Math.round(clamp(v, 0, 255))).join(",")})`;
const mix = (a: RGB, b: RGB, t: number): RGB => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
const scale = (a: RGB, k: number): RGB => [a[0] * k, a[1] * k, a[2] * k];

const PAL = {
  plaster: hex("#e9e4d6"), roof: hex("#4a5157"), glass: hex("#5d7388"), wood: hex("#9c9484"), lawn: hex("#8aa08a"), paving: hex("#b9b8b0"),
  door: hex("#6d7a72"), garage: hex("#c9c6bb"), glow: hex("#f4efdc"),
};
const SKY: { alt: number; top: RGB; bottom: RGB }[] = [
  { alt: -14, top: hex("#0e1424"), bottom: hex("#1d2842") },
  { alt: -6, top: hex("#2a3558"), bottom: hex("#7a76a0") },
  { alt: 2, top: hex("#5278ab"), bottom: hex("#d6c4cf") },
  { alt: 12, top: hex("#6f9ccc"), bottom: hex("#d3e1ea") },
  { alt: 40, top: hex("#5f93c8"), bottom: hex("#cfe0ea") },
];
function skyAt(alt: number): { top: RGB; bottom: RGB } {
  if (alt <= SKY[0].alt) return SKY[0];
  for (let i = 1; i < SKY.length; i++) {
    if (alt <= SKY[i].alt) {
      const t = (alt - SKY[i - 1].alt) / (SKY[i].alt - SKY[i - 1].alt);
      return { top: mix(SKY[i - 1].top, SKY[i].top, t), bottom: mix(SKY[i - 1].bottom, SKY[i].bottom, t) };
    }
  }
  return SKY[SKY.length - 1];
}

// ------------------------------------------------------------------------------------------------ sun
function dayOfYear(iso: string): number {
  const d = new Date(`${iso}T00:00:00Z`);
  return Math.round((d.getTime() - Date.UTC(d.getUTCFullYear(), 0, 0)) / 86400000);
}
/** Altitude and true azimuth (degrees) from the textbook formula; solar time approximated by the longitude of the model. */
function sunAt(iso: string, time: string): { alt: number; az: number } {
  const [h, m] = time.split(":").map(Number);
  const decl = rad(23.44 * Math.sin(rad((360 / 365) * (dayOfYear(iso) - 81))));
  const lat = rad(house.location.lat);
  const offsetH = 1 + (/-0[4-9]-|-0[5-9]-/.test(iso.slice(4)) ? 1 : 0); // CET, CEST in the summer half (placeholder precision)
  const solar = h + m / 60 - offsetH + house.location.lon / 15;
  const ha = rad((solar - 12) * 15);
  const sinAlt = Math.sin(lat) * Math.sin(decl) + Math.cos(lat) * Math.cos(decl) * Math.cos(ha);
  const alt = Math.asin(sinAlt);
  const az = Math.atan2(Math.sin(ha), Math.cos(ha) * Math.sin(lat) - Math.tan(decl) * Math.cos(lat)) + Math.PI;
  return { alt: (alt * 180) / Math.PI, az: ((az * 180) / Math.PI + 360) % 360 };
}
/** Direction towards the sun in the house frame (x east, y north, z up). */
function sunVector(iso: string, time: string): { dir: V3; alt: number } {
  const { alt, az } = sunAt(iso, time);
  const azHouse = rad(az - house.location.houseAxisBearingDeg);
  return { dir: [Math.cos(rad(alt)) * Math.sin(azHouse), Math.cos(rad(alt)) * Math.cos(azHouse), Math.sin(rad(alt))], alt };
}

// ------------------------------------------------------------------------------------------------ scene
type Face = { pts: V3[]; base: RGB; glow?: boolean; shadowless?: boolean };

function box(x0: number, y0: number, x1: number, y1: number, z0: number, z1: number, base: RGB): Face[] {
  const p = (x: number, y: number, z: number): V3 => [x, y, z];
  return [
    { pts: [p(x0, y0, z0), p(x1, y0, z0), p(x1, y0, z1), p(x0, y0, z1)], base },
    { pts: [p(x1, y0, z0), p(x1, y1, z0), p(x1, y1, z1), p(x1, y0, z1)], base },
    { pts: [p(x1, y1, z0), p(x0, y1, z0), p(x0, y1, z1), p(x1, y1, z1)], base },
    { pts: [p(x0, y1, z0), p(x0, y0, z0), p(x0, y0, z1), p(x0, y1, z1)], base },
    { pts: [p(x0, y0, z1), p(x1, y0, z1), p(x1, y1, z1), p(x0, y1, z1)], base },
  ];
}
const rectFlat = (r: [number, number, number, number], z: number, base: RGB): Face => ({
  pts: [[r[0], r[1], z], [r[2], r[1], z], [r[2], r[3], z], [r[0], r[3], z]], base, shadowless: true,
});

const wallHeight = (w: { height?: number | null }) => w.height ?? derived.defaultWallTop;

function buildScene(daylight: number): { faces: Face[]; roofs: Face[] } {
  const faces: Face[] = [];
  const roofs: Face[] = [];
  const glowing = daylight < 0.35;
  for (const o of derived.outdoor) {
    faces.push(rectFlat(o.rect, o.type === "terrace" ? 0.02 : 0.015, o.type === "terrace" ? PAL.wood : PAL.paving));
  }
  for (const w of derived.walls) {
    if (!w.ext) continue;
    const half = w.t / 2;
    if (w.orient === "h") faces.push(...box(w.from - half, w.at - half, w.to + half, w.at + half, 0, wallHeight(w), PAL.plaster));
    else faces.push(...box(w.at - half, w.from - half, w.at + half, w.to + half, 0, wallHeight(w), PAL.plaster));
  }
  for (const o of derived.openings) {
    if (!o.exterior || o.azimuth === null) continue;
    const az = rad(o.azimuth);
    const out: V3 = [Math.sin(az), Math.cos(az), 0];
    const tan: V3 = o.orient === "h" ? [1, 0, 0] : [0, 1, 0];
    const c: V3 = [o.cx, o.cy, 0];
    const centre = add(c, mul(out, derived.wall.ext / 2 + 0.03));
    const a = add(centre, mul(tan, -o.w / 2));
    const b = add(centre, mul(tan, o.w / 2));
    const lo = o.sill, hi = o.head;
    const door = o.kind === "entry" || o.kind === "garage";
    const base = o.kind === "garage" ? PAL.garage : o.kind === "entry" ? PAL.door : PAL.glass;
    faces.push({ pts: [[a[0], a[1], lo], [b[0], b[1], lo], [b[0], b[1], hi], [a[0], a[1], hi]], base, glow: glowing && !door, shadowless: true });
  }
  for (const f of derived.roofPlanes) roofs.push({ pts: f.pts3 as V3[], base: PAL.roof });
  return { faces: [...faces, ...roofs], roofs };
}

// ------------------------------------------------------------------------------------------------ camera and rasteriser (SVG)
type Cam = { pos: V3; target: V3; fovV: number };
function makeProjector(cam: Cam, w: number, h: number, keepHorizontalFov: number | null) {
  const f = norm(sub(cam.target, cam.pos));
  const r = norm(cross(f, [0, 0, 1]));
  const u = cross(r, f);
  const focal = keepHorizontalFov !== null ? w / 2 / Math.tan(rad(keepHorizontalFov) / 2) : h / 2 / Math.tan(rad(cam.fovV) / 2);
  const near = 0.15;
  const toCam = (p: V3): V3 => { const d = sub(p, cam.pos); return [dot(d, r), dot(d, u), dot(d, f)]; };
  const toScreen = (c: V3): [number, number] => [w / 2 + (c[0] / c[2]) * focal, h / 2 - (c[1] / c[2]) * focal];
  /** Projects a polygon (clipped to the near plane); null when it is entirely behind the camera. */
  function polygon(pts: V3[]): [number, number][] | null {
    const cs = pts.map(toCam);
    const out: V3[] = [];
    for (let i = 0; i < cs.length; i++) {
      const a = cs[i], b = cs[(i + 1) % cs.length];
      const ain = a[2] >= near, bin = b[2] >= near;
      if (ain) out.push(a);
      if (ain !== bin) { const t = (near - a[2]) / (b[2] - a[2]); out.push([lerp(a[0], b[0], t), lerp(a[1], b[1], t), near]); }
    }
    return out.length >= 3 ? out.map(toScreen) : null;
  }
  const depth = (p: V3) => toCam(p)[2];
  return { polygon, depth, camPos: cam.pos };
}

function renderSvg(cam: Cam, w: number, h: number, iso: string, time: string, keepHorizontalFov: number | null): string {
  const { dir, alt } = sunVector(iso, time);
  const sky = skyAt(alt);
  const daylight = clamp((alt + 5) / 25);
  const proj = makeProjector(cam, w, h, keepHorizontalFov);
  const { faces, roofs } = buildScene(daylight);
  const groundCol = scale(mix(PAL.lawn, hex("#26302b"), 1 - daylight), 0.55 + 0.45 * daylight);
  const ground: V3[] = [[-90, -90, 0], [110, -90, 0], [110, 110, 0], [-90, 110, 0]];

  const parts: string[] = [];
  parts.push(`<defs><linearGradient id="s" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${css(sky.top)}"/><stop offset="1" stop-color="${css(sky.bottom)}"/></linearGradient>`
    + `<linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${css(mix(groundCol, sky.bottom, 0.45))}"/><stop offset="0.35" stop-color="${css(groundCol)}"/><stop offset="1" stop-color="${css(scale(groundCol, 0.85))}"/></linearGradient></defs>`);
  parts.push(`<rect width="${w}" height="${h}" fill="url(#s)"/>`);
  const gp = proj.polygon(ground);
  if (gp) parts.push(`<polygon points="${gp.map((p) => p.map((v) => v.toFixed(1)).join(",")).join(" ")}" fill="url(#g)"/>`);

  // shadow of the roof on the ground
  if (dir[2] > 0.06) {
    for (const r of roofs) {
      const sh = r.pts.map((p): V3 => [p[0] - (dir[0] / dir[2]) * p[2], p[1] - (dir[1] / dir[2]) * p[2], 0]);
      const pp = proj.polygon(sh);
      if (pp) parts.push(`<polygon points="${pp.map((p) => p.map((v) => v.toFixed(1)).join(",")).join(" ")}" fill="#0b1210" fill-opacity="${(0.22 * daylight).toFixed(2)}"/>`);
    }
  }

  // painter's order: ground slabs, then walls and their openings, then the roof; each layer far to near by centroid
  const layerOf = (f: Face) => (roofs.includes(f) ? 2 : f.shadowless && f.pts.every((p) => p[2] < 0.1) ? 0 : 1);
  const centroidDepth = (f: Face) => f.pts.reduce((s, p) => s + proj.depth(p), 0) / f.pts.length - (f.shadowless && layerOf(f) === 1 ? 0.6 : 0);
  const sorted = faces.map((f) => ({ f, l: layerOf(f), d: centroidDepth(f) })).sort((a, b) => (a.l - b.l) || b.d - a.d);
  for (const { f } of sorted) {
    const pp = proj.polygon(f.pts);
    if (!pp) continue;
    let n = norm(cross(sub(f.pts[1], f.pts[0]), sub(f.pts[2], f.pts[1])));
    const centre = mul(f.pts.reduce((s, p) => add(s, p), [0, 0, 0] as V3), 1 / f.pts.length);
    if (dot(n, sub(proj.camPos, centre)) < 0) n = mul(n, -1);
    const diffuse = Math.max(0, dot(n, dir));
    const light = 0.34 + 0.2 * daylight + 0.62 * diffuse * daylight;
    const col = f.glow ? mix(PAL.glass, PAL.glow, 0.85) : mix(scale(f.base, light), sky.bottom, 0.06 * (1 - daylight));
    parts.push(`<polygon points="${pp.map((p) => p.map((v) => v.toFixed(1)).join(",")).join(" ")}" fill="${css(col)}"/>`);
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${parts.join("")}</svg>`;
}

async function writeJpg(svg: string, file: string) {
  await sharp(Buffer.from(svg)).jpeg({ quality: QUALITY, chromaSubsampling: "4:2:0", mozjpeg: true }).toFile(file);
}

// ------------------------------------------------------------------------------------------------ plan of the media set
const cameraById = (id: string): Cam => {
  const c = house.cameras.find((x) => x.id === id);
  if (!c || c.kind !== "perspective") throw new Error(`camera ${id} missing`);
  return { pos: c.position as V3, target: c.target as V3, fovV: c.fov ?? 32 };
};
const dir = (...p: string[]) => { const d = join(OUT, ...p); mkdirSync(d, { recursive: true }); return d; };
const hashFiles = (files: string[]) => { const h = createHash("sha1"); for (const f of files) h.update(readFileSync(f)); return h.digest("hex").slice(0, 10); };

const DAY_DATE = "2026-06-21";
const DAY_TIMES = [
  ...[8, 9, 10, 11, 12, 13, 14, 15].map((h) => `${String(h).padStart(2, "0")}:00`),
  ...[16, 17, 18, 19].flatMap((h) => ["00", "20", "40"].map((m) => `${h}:${m}`)),
  "20:00", "20:15", "20:30", "20:45", "21:00", "21:15", "21:30", "21:45", "22:00", "22:15",
];
const STILL_TIME = "17:40";
const L = { w: 1024, h: 576 }, P = { w: 480, h: 720 };
const ORBIT_FRAMES = 60;

async function sequence(kind: "day" | "orbit", name: (i: number) => string, make: (i: number, v: "l" | "p") => string): Promise<{ hash: string; files: Record<"l" | "p", string[]> }> {
  const tmp = dir(`.tmp-${kind}`);
  const files: Record<"l" | "p", string[]> = { l: [], p: [] };
  const count = kind === "day" ? DAY_TIMES.length : ORBIT_FRAMES;
  for (const v of ["l", "p"] as const) {
    for (let i = 0; i < count; i++) {
      const f = join(tmp, `${v}-${name(i)}.jpg`);
      await writeJpg(make(i, v), f);
      files[v].push(f);
    }
  }
  const hash = hashFiles([...files.l, ...files.p]);
  return { hash, files };
}

async function main() {
  for (const d of readdirSync(OUT, { withFileTypes: true })) if (d.isDirectory() || d.name !== ".gitkeep") rmSync(join(OUT, d.name), { recursive: true, force: true });
  const hFovGarden = (2 * Math.atan(Math.tan(rad(cameraById("garden").fovV) / 2) * (L.w / L.h)) * 180) / Math.PI;

  // day: a fixed camera, only the light changes
  const dayCam = cameraById("garden");
  const day = await sequence("day", (i) => DAY_TIMES[i].replace(":", ""), (i, v) =>
    v === "l" ? renderSvg(dayCam, L.w, L.h, DAY_DATE, DAY_TIMES[i], null) : renderSvg(dayCam, P.w, P.h, DAY_DATE, DAY_TIMES[i], hFovGarden * 0.62));
  for (const v of ["l", "p"] as const) {
    const d = dir("day", v);
    day.files[v].forEach((f, i) => renameSync(f, join(d, `${DAY_TIMES[i].replace(":", "")}.${day.hash}.jpg`)));
  }

  // orbit: a camera on a circle around the house, evening light
  const bb = derived.bbox;
  const centre: V3 = [(bb.x0 + bb.x1) / 2, (bb.y0 + bb.y1) / 2, 1.6];
  const radius = Math.hypot(bb.w, bb.d) * 0.92;
  const degPerFrame = 360 / ORBIT_FRAMES;
  const orbitCam = (i: number): Cam => {
    const a = rad(-90 + i * degPerFrame);
    return { pos: [centre[0] + Math.cos(a) * radius, centre[1] + Math.sin(a) * radius, 7.5], target: centre, fovV: 30 };
  };
  const orbit = await sequence("orbit", (i) => String(i).padStart(3, "0"), (i, v) =>
    v === "l" ? renderSvg(orbitCam(i), L.w, L.h, DAY_DATE, "18:30", null) : renderSvg(orbitCam(i), P.w, P.h, DAY_DATE, "18:30", 38));
  for (const v of ["l", "p"] as const) {
    const d = dir("orbit", v);
    orbit.files[v].forEach((f, i) => renameSync(f, join(d, `${String(i).padStart(3, "0")}.${orbit.hash}.jpg`)));
  }
  rmSync(join(OUT, ".tmp-day"), { recursive: true, force: true });
  rmSync(join(OUT, ".tmp-orbit"), { recursive: true, force: true });

  // stills
  type StillPlan = { id: string; cam: string; date: string; time: string; category: "exterior" | "aerial" | "detail" };
  const plans: StillPlan[] = [
    { id: "garden-afternoon", cam: "garden", date: DAY_DATE, time: "17:30", category: "exterior" },
    { id: "garden-dusk", cam: "garden", date: DAY_DATE, time: "21:10", category: "exterior" },
    { id: "street-morning", cam: "street", date: "2026-05-15", time: "09:30", category: "exterior" },
    { id: "entry-morning", cam: "entry", date: "2026-05-15", time: "10:00", category: "exterior" },
    { id: "terrace-summer", cam: "terrace", date: "2026-07-15", time: "16:30", category: "detail" },
    { id: "aerial-south-west", cam: "aerial-sw", date: "2026-09-23", time: "14:00", category: "aerial" },
    { id: "aerial-south-east", cam: "aerial-se", date: "2026-09-23", time: "16:30", category: "aerial" },
    { id: "street-dusk", cam: "street", date: DAY_DATE, time: "21:15", category: "exterior" },
  ];
  const stillsDir = dir("stills");
  const stills = [];
  for (const p of plans) {
    const tmp = join(stillsDir, `${p.id}.tmp.jpg`);
    await writeJpg(renderSvg(cameraById(p.cam), L.w, L.h, p.date, p.time, null), tmp);
    const hash = hashFiles([tmp]);
    const file = `media/stills/${p.id}.${hash}.jpg`;
    renameSync(tmp, join(process.cwd(), "public", file));
    const cam = house.cameras.find((c) => c.id === p.cam)!;
    stills.push({ id: p.id, file, width: L.w, height: L.h, date: p.date, time: p.time, category: p.category, title: cam.name, alt: { cs: `${cam.name.cs} (zástupný render)`, en: `${cam.name.en} (placeholder render)` } });
  }

  // Open Graph image
  const ogTmp = join(OUT, "og.tmp.jpg");
  await writeJpg(renderSvg(cameraById("street"), 1200, 630, DAY_DATE, "19:30", null), ogTmp);
  const ogHash = hashFiles([ogTmp]);
  const ogFile = `media/og.${ogHash}.jpg`;
  renameSync(ogTmp, join(process.cwd(), "public", ogFile));

  const manifest = {
    schema: "media/1",
    day: {
      date: DAY_DATE, times: DAY_TIMES, stillTime: STILL_TIME, hash: day.hash,
      landscape: { pattern: "media/day/l/{time}.{hash}.jpg", width: L.w, height: L.h },
      portrait: { pattern: "media/day/p/{time}.{hash}.jpg", width: P.w, height: P.h },
    },
    orbit: {
      frames: ORBIT_FRAMES, degPerFrame, hash: orbit.hash,
      landscape: { pattern: "media/orbit/l/{i}.{hash}.jpg", width: L.w, height: L.h },
      portrait: { pattern: "media/orbit/p/{i}.{hash}.jpg", width: P.w, height: P.h },
    },
    stills,
    compare: { a: "garden-afternoon", b: "garden-dusk" },
    og: { file: ogFile, width: 1200, height: 630 },
  };
  writeFileSync(join(OUT, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`placeholder media written to public/media (day ${DAY_TIMES.length}, orbit ${ORBIT_FRAMES}, stills ${stills.length})`);
}

main().catch((e) => { console.error(e); process.exit(1); });
