// Fast proxy preview of every render camera: a headless three.js scene (Chromium, software WebGL) built from the same inputs as
// the Blender renders (generated in memory by scripts/build-render-inputs.ts): the house (house.glb when it was built from the
// current model, else a proxy from generated/derived.json: walls with openings, roof planes, slabs, pool, posts, louvres,
// furniture boxes), the graded terrain with the street and the neighbour plots, the slat fence, gates (at each shot's open
// fraction), the pillar, trees with crowns, shrubs, beds and paved areas, neighbours, PV, blinds and the sun of each shot.
// Each tile carries the framing guides and the numbers of the acceptance tests (scripts/lib/render-framing.ts).
//
//   node scripts/render-preview.mjs --all                    contact sheets of the stills, the day sequence and the orbit
//   node scripts/render-preview.mjs --sheet stills,day        only these sheets (stills | day | orbit)
//   node scripts/render-preview.mjs --only day,garden-walnut  single large frames (ids of stills, day, day-portrait, og,
//                                                             compare-before, compare-after, orbit-<frame>)
//   options: --out <dir> (default pipeline/out/preview), --width <px> (tile width), --house auto|glb|proxy,
//            --render-json <file> (another render.json, for camera experiments)
//
// Needs the Playwright Chromium of the dev dependencies and ImageMagick (`magick`) for the contact sheets. Writes PNG files only.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { tsImport } from "tsx/esm/api";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const args = process.argv.slice(2);
const opt = (k, d) => (args.includes(k) ? args[args.indexOf(k) + 1] : d);
const outDir = path.resolve(opt("--out", path.join(root, "pipeline", "out", "preview")));
const sheets = args.includes("--all") ? ["stills", "day", "orbit"] : (opt("--sheet", "") || "").split(",").filter(Boolean);
const only = (opt("--only", "") || "").split(",").filter(Boolean);
const houseMode = opt("--house", "auto");
// --render-json <file>: try another render.json (camera experiments) without touching model/render.json
const renderJsonFile = opt("--render-json", null);
if (!sheets.length && !only.length) {
  console.error("usage: node scripts/render-preview.mjs --all | --sheet stills,day,orbit | --only <ids> [--out dir] [--width px] [--house auto|glb|proxy]");
  process.exit(2);
}

// ------------------------------------------------------------------------------------------------ inputs (in memory)

// the repository is CommonJS for tsx: re-exported names (`export *`) are only on the default export
const imp = async (rel) => {
  const m = await tsImport(pathToFileURL(path.join(root, rel)).href, import.meta.url);
  return { ...(m.default ?? {}), ...m };
};
const B = await imp("scripts/build-render-inputs.ts");
const F = await imp("scripts/lib/render-framing.ts");
const C = await imp("scripts/lib/render-camera.ts");
const FE = await imp("scripts/lib/render-features.ts");
const M = await imp("src/lib/model/index.ts");
const S = await imp("src/lib/model/site/index.ts");

const res = B.buildRenderInputs({ root, sun: await B.resolveSunProvider(), furnitureReport: null, renderJson: renderJsonFile ? JSON.parse(fs.readFileSync(renderJsonFile, "utf8")) : undefined });
for (const w of res.warnings) console.warn(`warning: ${w}`);
const inp = res.data;
const readJson = (rel) => JSON.parse(fs.readFileSync(path.join(root, rel), "utf8"));
const derived = readJson("generated/derived.json");
const style = readJson("model/style.json");
const houseJson = readJson("model/house.json");
const siteJson = readJson("model/site.json");
const { house } = M.analyzeHouse(houseJson, { site: S.parseSite(siteJson) });
const site = S.createSite(siteJson, house.location.houseAxisBearingDeg, house.outdoor);
const occluders = site.withHouse(house.outdoor).occluders({ minShrubHeight: 0.9 });
const shape = F.houseShape(derived);
const silhouette = F.houseSilhouette(shape);
const houseSamples = F.houseSamples(shape, 1.5);
const crowns = occluders.filter((o) => o.role === "tree");

let glbFresh = false;
try {
  const man = readJson("public/models/manifest.json");
  glbFresh = man.inputHash === derived.inputHash && fs.existsSync(path.join(root, "public/models/house.glb"));
} catch { /* no manifest */ }
const useGlb = houseMode === "glb" || (houseMode === "auto" && glbFresh);
console.log(`house: ${useGlb ? "public/models/house.glb" : "proxy from generated/derived.json"}${!useGlb && houseMode === "auto" ? " (the GLB was built from another model)" : ""}`);

// ------------------------------------------------------------------------------------------------ framing numbers per view

const pct = (v) => `${Math.round(v * 100)}`;
const frac = (x) => ((x + 1) / 2).toFixed(2);
const walnut = derived.site.trees.find((t) => t.species === "walnut");
const TITLE_ZONE = { x0: -1, x1: -0.1, y0: 0.3, y1: 1 };

function framing(view) {
  const cam = view.camera, size = view.size;
  const occ = F.occludersWithGates(occluders, derived.site.gates, view.gates ?? { driveway: 0, walkway: 0 }, site.terrain.groundAt);
  const interior = F.insideHouse(shape, cam.position);
  const lines = [];
  if (!interior) lines.push(`house ${pct(F.widthShare(cam, size, silhouette))} % of the width, eye ${cam.aboveGround.toFixed(2)} m`);
  else lines.push(`eye ${cam.aboveGround.toFixed(2)} m, ${cam.focalMm} mm`);
  const subj = [];
  for (const w of view.subjects ?? []) {
    const f = FE.resolveFeature(w, derived, derived.site, cam.position);
    if (!f) { subj.push(`${w}: none`); continue; }
    const ps = f.points.map((p) => C.project(cam, size, p)).filter(Boolean);
    const inFrame = ps.filter((p) => Math.abs(p.x) <= 1 && Math.abs(p.y) <= 1).length / f.points.length;
    const hid = F.hiddenShare(cam.position, f.points, occ, { house: f.interior ? undefined : shape, ignore: f.selfId });
    const xs = ps.map((p) => p.x);
    subj.push(`${w} ${xs.length ? `x ${frac(Math.min(...xs))}-${frac(Math.max(...xs))}` : "behind"}${inFrame < 1 ? ` in ${pct(inFrame)}%` : ""}${hid > 0 ? ` hidden ${pct(hid)}%` : ""}`);
  }
  if (subj.length) lines.push(subj.join(" · "));
  if (view.guides === "hero") {
    const wc = walnut ? F.crownOnImage(cam, size, walnut) : null;
    const tz = F.zoneSkyOrRoof(cam, size, TITLE_ZONE, shape, occ, cam.groundZ);
    lines.push(`walnut ${wc ? `from x ${frac(wc.xMin)}` : "out of frame"} · title zone ${pct(tz.share)} % sky/roof`);
  }
  if (view.guides === "orbit") lines.push(`trees hide ${pct(F.occludedHouseShare(cam.position, houseSamples, shape, crowns))} % of the house`);
  const inside = F.containing(occluders, cam.position, 0.3).map((o) => o.role);
  if (inside.length) lines.push(`CAMERA INSIDE ${[...new Set(inside)].join(", ")}`);
  return lines;
}

// ------------------------------------------------------------------------------------------------ views

const day = inp.day;
const stillFrame = day.frames.find((f) => f.time.local === day.stillTime);
const stateOf = (s) => ({ sun: s.sun, lights: s.lights, blinds: s.blinds, screens: s.screens, gates: s.gates, garageDoor: s.garageDoor });
const viewsAll = new Map();
const add = (v) => viewsAll.set(v.name, v);
add({ name: "day", title: `day ${stillFrame.time.local}`, size: day.size, camera: day.camera, ...stateOf(stillFrame), subjects: day.subjects, guides: "hero" });
add({ name: "day-portrait", title: `day portrait ${stillFrame.time.local}`, size: day.portrait.size, camera: day.portrait.camera, ...stateOf(stillFrame), subjects: day.subjects, guides: "portrait" });
add({ name: "og", title: `og ${inp.og.time.local}`, size: inp.og.size, camera: inp.og.camera, ...stateOf(inp.og), subjects: inp.og.subjects, guides: "og" });
for (const side of ["before", "after"]) {
  const s = inp.compare[side];
  add({ name: `compare-${side}`, title: `compare ${side} ${s.time.local}`, size: s.size, camera: s.camera, ...stateOf(s), subjects: s.subjects, guides: "thirds" });
}
for (const s of inp.stills) add({ name: s.id, title: `${s.id} ${s.time.local} ${s.camera.focalMm} mm`, size: s.size, camera: s.camera, ...stateOf(s), subjects: s.subjects, guides: "thirds" });
const orbitState = stateOf(inp.orbit);
const captionAt = (i) => inp.orbit.captions.filter((c) => c.frames.includes(i)).map((c) => c.feature);
for (const v of inp.orbit.variants) {
  for (const f of v.frames) {
    add({ name: `orbit-${v.id}-${f.index}`, title: `orbit ${v.id} ${f.index} (${Math.round(f.angleDeg)}°)`, size: v.size, camera: f.camera, ...orbitState, subjects: captionAt(f.index), guides: "orbit", orbitIndex: f.index });
  }
}
for (const f of day.frames) {
  add({ name: `day-${f.id}`, title: `day ${f.time.local}`, size: day.size, camera: day.camera, ...stateOf(f), subjects: [], guides: "hero-light" });
  add({ name: `day-portrait-${f.id}`, title: `portrait ${f.time.local}`, size: day.portrait.size, camera: day.portrait.camera, ...stateOf(f), subjects: [], guides: "portrait-light" });
}

const sheetViews = {
  stills: ["day", "day-portrait", "og", "compare-before", "compare-after", ...inp.stills.map((s) => s.id)],
  day: [...day.frames.map((f) => `day-${f.id}`), ...day.frames.filter((_, i) => i % 3 === 0).map((f) => `day-portrait-${f.id}`)],
  orbit: [
    ...inp.orbit.variants.find((v) => v.frameSelection === "all").frames.filter((f) => f.index % 8 === 0).map((f) => `orbit-landscape-${f.index}`),
    ...(inp.orbit.variants.find((v) => v.frameSelection === "scroll")?.frames ?? []).filter((_, k) => k % 3 === 0).map((f) => `orbit-portrait-${f.index}`),
  ],
};
const tileWidth = { stills: 640, day: 400, orbit: 400 };

// ------------------------------------------------------------------------------------------------ scene payload

const color = (role, fallback) => style.materials[role]?.color ?? style.generated?.[role]?.color ?? fallback;
const gen = (key, fallback) => style.generated?.[key]?.color ?? fallback;
const payload = {
  useGlb,
  inputs: { terrain: inp.terrain, site: inp.site, vegetation: inp.vegetation, neighbours: inp.neighbours, pv: inp.pv, blinds: inp.blinds, screens: inp.screens, lights: inp.lights, house: inp.house },
  derived: {
    walls: derived.walls, openings: derived.openings, rooms: derived.rooms.map((r) => ({ id: r.id, rects: r.rects, cleanRects: r.cleanRects, floor: r.floor, height: r.height })),
    outline: derived.outline, roofs: derived.roofs, roofPlanes: derived.roofPlanes, outdoor: derived.outdoor, furniture: derived.furniture,
    outdoorUnit: derived.outdoorUnit, bbox: derived.bbox, clearHeight: house.clearHeight, wallExt: derived.wall.ext,
  },
  colors: {
    plaster: color("plaster", "#efece2"), wood: color("wood_cladding", "#cfc2a4"), frame: color("frame", "#2b2e31"), glass: color("glass", "#bcd2d6"),
    roof: color("roof_tile", "#34383c"), soffit: color("soffit", "#eeeade"), fascia: color("fascia", "#2d3033"), slab: color("slab", "#34383c"),
    deck: color("deck", "#c8bea8"), paving: color("terrace_paving", "#b9b5aa"), drive: color("drive_paving", "#9a9890"), path: color("path", "#b3ada0"),
    coping: color("pool_coping", "#d9d6cc"), liner: color("pool_liner", "#c5d3d1"), water: color("water", "#7fcfc4"), post: color("post", "#2b2e31"),
    oak: color("floor_oak", "#c9b28c"), tile: color("floor_tile", "#d7d4cc"), ceiling: color("ceiling", "#f4f2ea"), door: color("door_leaf", "#f6f4ee"),
    garageDoor: color("garage_door", "#cfc2a4"), equipment: color("equipment", "#34383c"),
    lawn: color("lawn", "#5f7f45"), field: gen("field", "#9c9566"), neighbour: gen("neighbour", "#6c8752"),
    verge: gen("verge", "#6f8a4f"), pavement: gen("pavement", "#b8b6ae"), carriageway: gen("carriageway", "#5c6064"),
    kerb: gen("kerb", "#a9a7a0"), bark: gen("bark", "#5b4a3a"), neighbourWall: gen("neighbour_wall", "#d9d5cb"),
    neighbourRoof: gen("neighbour_roof", "#565b60"), fenceWood: gen("fence_wood", "#cfc2a4"), fencePost: gen("fence_post", "#2b2e31"),
    fencePlinth: gen("fence_plinth", "#34383c"), mulch: "#5a4b3c", gravel: "#bdb7aa",
  },
};

// ------------------------------------------------------------------------------------------------ the page

const PAGE = String.raw`<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;background:#111}canvas{display:block}</style>
<script type="importmap">{"imports":{"three":"/three/build/three.module.js","three/addons/":"/three/examples/jsm/"}}</script></head><body>
<script type="module">
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/addons/loaders/DRACOLoader.js";
const P = await (await fetch("/payload.json")).json();
const I = P.inputs, D = P.derived, K = P.colors;
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.AgXToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.outputColorSpace = THREE.SRGBColorSpace;
document.body.appendChild(renderer.domElement);
const scene = new THREE.Scene();
const mats = new Map();
const mat = (hex, o = {}) => {
  const key = hex + JSON.stringify(o);
  if (!mats.has(key)) mats.set(key, new THREE.MeshStandardMaterial({ color: new THREE.Color(hex), roughness: 0.85, metalness: 0, side: THREE.DoubleSide, ...o }));
  return mats.get(key);
};
const add = (geo, m, cast = true, recv = true) => { const me = new THREE.Mesh(geo, m); me.castShadow = cast; me.receiveShadow = recv; scene.add(me); return me; };
const box = (x0, y0, z0, x1, y1, z1, m, cast = true) => { const g = new THREE.BoxGeometry(Math.max(1e-3, x1 - x0), Math.max(1e-3, y1 - y0), Math.max(1e-3, z1 - z0)); g.translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2); return add(g, m, cast); };
// oriented box: centre, along-vector (unit, horizontal), length, depth, z range
const obox = (cx, cy, ax, ay, len, dep, z0, z1, m, cast = true) => {
  const g = new THREE.BoxGeometry(len, dep, z1 - z0);
  g.rotateZ(Math.atan2(ay, ax)); g.translate(cx, cy, (z0 + z1) / 2); return add(g, m, cast);
};
// terrain sampling (bilinear on the grid of the render inputs)
const G = I.terrain.grid;
const hAt = (x, y) => {
  const fx = Math.min(G.nx - 1.001, Math.max(0, (x - G.x0) / G.step)), fy = Math.min(G.ny - 1.001, Math.max(0, (y - G.y0) / G.step));
  const i = Math.floor(fx), j = Math.floor(fy), tx = fx - i, ty = fy - j, h = (a, b) => G.heightsMm[(j + b) * G.nx + i + a] / 1000;
  return h(0, 0) * (1 - tx) * (1 - ty) + h(1, 0) * tx * (1 - ty) + h(0, 1) * (1 - tx) * ty + h(1, 1) * tx * ty;
};
const inPoly = (x, y, poly) => { let c = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const [xi, yi] = poly[i], [xj, yj] = poly[j]; if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c; } return c; };
// a polygon draped on the terrain (subdivided so it follows the slope)
const drape = (poly, hex, lift = 0.012, holes = []) => {
  const shape = new THREE.Shape(poly.map(([x, y]) => new THREE.Vector2(x, y)));
  for (const h of holes) shape.holes.push(new THREE.Path(h.map(([x, y]) => new THREE.Vector2(x, y))));
  const g = new THREE.ShapeGeometry(shape);
  const pos = g.attributes.position;
  for (let k = 0; k < pos.count; k++) pos.setZ(k, hAt(pos.getX(k), pos.getY(k)) + lift);
  g.computeVertexNormals();
  return add(g, mat(hex), false, true);
};
// ---- terrain with zone colours and the pool voids
{
  const zones = I.site.zones, plot = I.site.plot.polygon;
  const col = new THREE.Color(), cLawn = new THREE.Color(K.lawn), cField = new THREE.Color(K.field), cNb = new THREE.Color(K.neighbour);
  const cVerge = new THREE.Color(K.verge), cPave = new THREE.Color(K.pavement), cCar = new THREE.Color(K.carriageway);
  const pos = [], cols = [], idx = [];
  for (let j = 0; j < G.ny; j++) for (let i = 0; i < G.nx; i++) {
    const x = G.x0 + i * G.step, y = G.y0 + j * G.step;
    pos.push(x, y, G.heightsMm[j * G.nx + i] / 1000);
    if (inPoly(x, y, plot)) col.copy(cLawn);
    else if (inPoly(x, y, zones.street.carriageway)) col.copy(cCar);
    else if (zones.street.pavement && inPoly(x, y, zones.street.pavement)) col.copy(cPave);
    else if (inPoly(x, y, zones.street.verge)) col.copy(cVerge);
    else if (zones.neighbourPlots.some((n) => inPoly(x, y, n.polygon))) col.copy(cNb);
    else col.copy(cField);
    const n = Math.sin(x * 1.7) * Math.sin(y * 1.3) * 0.03;
    cols.push(col.r * (1 + n), col.g * (1 + n), col.b * (1 + n));
  }
  const voids = I.terrain.voids ?? [];
  for (let j = 0; j < G.ny - 1; j++) for (let i = 0; i < G.nx - 1; i++) {
    const cx = G.x0 + (i + 0.5) * G.step, cy = G.y0 + (j + 0.5) * G.step;
    if (voids.some((v) => cx > v[0] && cx < v[2] && cy > v[1] && cy < v[3])) continue;
    const a = j * G.nx + i, b = a + 1, c = a + G.nx, d = c + 1;
    idx.push(a, b, d, a, d, c);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("color", new THREE.Float32BufferAttribute(cols, 3));
  g.setIndex(idx); g.computeVertexNormals();
  add(g, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1 }), false, true);
  // a far ground ring so the horizon is not the edge of the grid
  const ring = new THREE.CircleGeometry(900, 48); ring.translate((G.x0 + G.x0 + (G.nx - 1) * G.step) / 2, (G.y0 + G.y0 + (G.ny - 1) * G.step) / 2, -0.6);
  add(ring, mat(K.field), false, true);
}
// ---- surfaces of the site (paved areas, beds, aprons) that are not slabs of the house model
for (const s of I.site.surfaces) {
  if (s.inGlb) continue;
  const hex = { drive_paving: K.drive, path: K.path, gravel: K.gravel, mulch: K.mulch, terrace_paving: K.paving }[s.role] ?? K.paving;
  drape(s.polygon, hex, s.role === "mulch" ? 0.008 : 0.015);
}
for (const k of [I.site.access.driveKerb, I.site.access.walkKerb]) if (k?.length) drape(k, K.kerb, 0.03);
// ---- fences, gates, pillars
const fenceGroups = [];
for (const f of I.site.fences) {
  const plinth = f.plinthHeight ?? 0;
  for (const part of f.parts) for (let k = 0; k + 1 < part.length; k++) {
    const [ax, ay] = part[k], [bx, by] = part[k + 1];
    const len = Math.hypot(bx - ax, by - ay); if (len < 1e-3) continue;
    const ux = (bx - ax) / len, uy = (by - ay) / len, n = Math.max(1, Math.ceil(len / 2.5));
    for (let s = 0; s < n; s++) {
      const x0 = ax + ux * (len * s / n), y0 = ay + uy * (len * s / n), x1 = ax + ux * (len * (s + 1) / n), y1 = ay + uy * (len * (s + 1) / n);
      const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, z = hAt(cx, cy), l = len / n;
      if (plinth > 0) obox(cx, cy, ux, uy, l, f.thickness * 1.6, z - 0.05, z + plinth, mat(K.fencePlinth));
      // horizontal slats with gaps
      const board = f.slat?.board ?? 0.09, gap = f.slat?.gap ?? 0.015;
      for (let zz = z + plinth + gap; zz + board <= z + f.height + 1e-6; zz += board + gap) obox(cx, cy, ux, uy, l, f.slat?.depth ?? 0.02, zz, zz + board, mat(K.fenceWood));
    }
  }
  for (const p of f.posts ?? []) box(p.x - 0.03, p.y - 0.03, p.z - 0.05, p.x + 0.03, p.y + 0.03, p.z + f.height + 0.02, mat(K.fencePost));
}
const gateMeshes = [];
for (const g of I.site.gates) {
  for (const p of g.posts) box(p.x - g.postSize / 2, p.y - g.postSize / 2, p.z - 0.05, p.x + g.postSize / 2, p.y + g.postSize / 2, p.z + g.height + 0.05, mat(K.fencePost));
  const grp = new THREE.Group();
  const [a, b] = [g.leafPolygon[0], g.leafPolygon[1]];
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]), ux = (b[0] - a[0]) / len, uy = (b[1] - a[1]) / len;
  const cx = g.leafPolygon.reduce((s, p) => s + p[0], 0) / g.leafPolygon.length, cy = g.leafPolygon.reduce((s, p) => s + p[1], 0) / g.leafPolygon.length;
  const z = g.z;
  for (let zz = z + 0.05; zz + 0.09 <= z + g.height; zz += 0.105) {
    const gg = new THREE.BoxGeometry(len, g.thickness * 0.5, 0.09); gg.rotateZ(Math.atan2(uy, ux)); gg.translate(cx, cy, zz + 0.045);
    const m = new THREE.Mesh(gg, mat(K.fenceWood)); m.castShadow = true; grp.add(m);
  }
  const fr = new THREE.BoxGeometry(len, g.thickness, 0.04); fr.rotateZ(Math.atan2(uy, ux)); fr.translate(cx, cy, z + g.height);
  grp.add(new THREE.Mesh(fr, mat(K.fencePost)));
  scene.add(grp);
  gateMeshes.push({ g, grp });
}
for (const p of I.site.pillars) {
  const [a, b] = [p.footprint[0], p.footprint[1]];
  const ux = (b[0] - a[0]) / Math.hypot(b[0] - a[0], b[1] - a[1]), uy = (b[1] - a[1]) / Math.hypot(b[0] - a[0], b[1] - a[1]);
  obox(p.center[0], p.center[1], ux, uy, p.size[0], p.size[1], p.z - 0.05, p.z + p.size[2], mat(K.fencePost));
}
// ---- trees and shrubs
const leafMat = (hex) => mat(hex, { roughness: 0.95 });
for (const t of I.vegetation.trees) {
  const rb = 0.04 + t.height * 0.015;
  const trunk = new THREE.CylinderGeometry(rb * 0.7, rb, t.crownBase + 0.6, 10);
  trunk.rotateX(Math.PI / 2); trunk.translate(t.x, t.y, t.z + (t.crownBase + 0.6) / 2);
  add(trunk, mat(K.bark));
  const crown = new THREE.SphereGeometry(1, 20, 14); crown.scale(t.crown / 2, t.crown / 2, (t.height - t.crownBase) / 2);
  crown.translate(t.x, t.y, t.z + t.crownBase + (t.height - t.crownBase) / 2);
  add(crown, leafMat(t.leaf));
}
for (const s of I.vegetation.shrubs) {
  const g = new THREE.SphereGeometry(1, 14, 10); g.scale(s.width / 2, s.width / 2, s.height / 2); g.translate(s.x, s.y, s.z + s.height / 2);
  add(g, leafMat(s.flower && s.height < 0.8 ? s.flower : s.leaf));
}
// ---- neighbours (walls and a hip or gable roof)
for (const n of I.neighbours) {
  const shape = new THREE.Shape(n.footprint.map(([x, y]) => new THREE.Vector2(x, y)));
  const g = new THREE.ExtrudeGeometry(shape, { depth: n.eaveHeight, bevelEnabled: false }); g.translate(0, 0, n.baseZ);
  add(g, mat(K.neighbourWall));
  const [c, sz, rot] = [n.center, n.size, n.rotDeg * Math.PI / 180], ov = n.roof.overhang;
  const w = sz[0] + 2 * ov, d = sz[1] + 2 * ov, rise = n.ridgeHeight - n.eaveHeight, z0 = n.baseZ + n.eaveHeight;
  const along = w >= d, half = Math.abs(w - d) / 2;
  const loc = [[-w / 2, -d / 2], [w / 2, -d / 2], [w / 2, d / 2], [-w / 2, d / 2]];
  const ridge = along ? [[-half, 0], [half, 0]] : [[0, -half], [0, half]];
  const tr = ([x, y], z) => [c[0] + x * Math.cos(rot) - y * Math.sin(rot), c[1] + x * Math.sin(rot) + y * Math.cos(rot), z];
  const v = [...loc.map((p) => tr(p, z0)), ...ridge.map((p) => tr(p, z0 + rise))];
  const faces = along ? [[0, 1, 5, 4], [1, 2, 5], [2, 3, 4, 5], [3, 0, 4]] : [[0, 1, 4], [1, 2, 5, 4], [2, 3, 5], [3, 0, 4, 5]];
  const pos = []; for (const f of faces) for (let k = 1; k + 1 < f.length; k++) pos.push(...v[f[0]], ...v[f[k]], ...v[f[k + 1]]);
  const rg = new THREE.BufferGeometry(); rg.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3)); rg.computeVertexNormals();
  add(rg, mat(K.neighbourRoof));
}
// ---- PV modules
for (const p of I.pv.panels) {
  const n = p.normal, s = I.pv.standoff;
  const v = p.corners.map((c) => [c[0] + n[0] * s, c[1] + n[1] * s, c[2] + n[2] * s]);
  const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.Float32BufferAttribute([...v[0], ...v[1], ...v[2], ...v[0], ...v[2], ...v[3]], 3)); g.computeVertexNormals();
  add(g, mat("#111418", { roughness: 0.25, metalness: 0.3 }), true, false);
}
// ---- the house
const glassMats = [];
const garageDoors = [];
const louvreMeshes = [];
const glassMat = () => { const m = new THREE.MeshStandardMaterial({ color: new THREE.Color("#5f7782"), roughness: 0.08, metalness: 0.2, transparent: true, opacity: 0.55, side: THREE.DoubleSide, emissive: new THREE.Color("#ffc887"), emissiveIntensity: 0 }); glassMats.push(m); return m; };
const gm = glassMat();
if (P.useGlb) {
  const draco = new DRACOLoader(); draco.setDecoderPath("/draco/");
  const loader = new GLTFLoader(); loader.setDRACOLoader(draco);
  const gltf = await loader.loadAsync("/models/house.glb");
  const root = gltf.scene; root.rotation.x = Math.PI / 2;
  root.traverse((o) => {
    if (!o.isMesh) return;
    o.castShadow = true; o.receiveShadow = true;
    const role = o.userData?.role;
    if (role === "screen_slats") o.visible = false;
    if (role === "glass") o.material = gm;
    if (role === "garage_door") garageDoors.push(o);
    if (o.material) o.material.side = THREE.DoubleSide;
  });
  scene.add(root);
} else {
  const ext = D.wallExt;
  // walls with holes for the openings
  for (const w of D.walls) {
    const ops = D.openings.filter((o) => o.wallId === w.id);
    const h = w.ext ? D.roofs[0].eaveHeight : (w.height ?? D.clearHeight);
    const base = w.ext ? -0.15 : 0;
    const segs = [];
    const cuts = ops.map((o) => [o.from, o.to, o.sill, o.head]).sort((a, b) => a[0] - b[0]);
    let s = w.from;
    for (const [a, b, sill, head] of cuts) { if (a > s) segs.push([s, a, base, h]); if (sill > 0) segs.push([a, b, base, sill]); segs.push([a, b, head, h]); s = Math.max(s, b); }
    if (w.to > s) segs.push([s, w.to, base, h]);
    for (const [a, b, z0, z1] of segs) {
      if (z1 - z0 < 1e-3 || b - a < 1e-3) continue;
      const m = mat(w.ext ? K.plaster : K.plaster);
      if (w.orient === "h") box(a, w.at - w.t / 2, z0, b, w.at + w.t / 2, z1, m);
      else box(w.at - w.t / 2, a, z0, w.at + w.t / 2, b, z1, m);
      if (w.ext && z0 < 0.3 && z1 > 0.3) { // plinth band 0.30 m on the outer face
        if (w.orient === "h") box(a, w.at - w.t / 2 - 0.005, -0.15, b, w.at + w.t / 2 + 0.005, 0.15, mat(K.slab));
        else box(w.at - w.t / 2 - 0.005, a, -0.15, w.at + w.t / 2 + 0.005, b, 0.15, mat(K.slab));
      }
    }
    for (const o of ops) {
      if (o.kind === "door" || o.kind === "entry") {
        if (o.kind === "entry") { if (w.orient === "h") box(o.from, w.at - 0.03, 0, o.to, w.at + 0.03, o.head, mat(K.wood)); else box(w.at - 0.03, o.from, 0, w.at + 0.03, o.to, o.head, mat(K.wood)); }
        continue;
      }
      if (o.kind === "garage") {
        const m = w.orient === "h" ? box(o.from, w.at - 0.03, 0, o.to, w.at + 0.03, o.head, mat(K.garageDoor)) : box(w.at - 0.03, o.from, 0, w.at + 0.03, o.to, o.head, mat(K.garageDoor));
        garageDoors.push(m); continue;
      }
      // frame and glass
      const fz0 = o.sill, fz1 = o.head;
      if (w.orient === "h") { box(o.from, w.at - 0.02, fz0, o.to, w.at + 0.02, fz1, gm, false); box(o.from, w.at - 0.04, fz1 - 0.06, o.to, w.at + 0.04, fz1, mat(K.frame)); box(o.from, w.at - 0.04, fz0, o.to, w.at + 0.04, fz0 + 0.05, mat(K.frame)); }
      else { box(w.at - 0.02, o.from, fz0, w.at + 0.02, o.to, fz1, gm, false); box(w.at - 0.04, o.from, fz1 - 0.06, w.at + 0.04, o.to, fz1, mat(K.frame)); box(w.at - 0.04, o.from, fz0, w.at + 0.04, o.to, fz0 + 0.05, mat(K.frame)); }
      if (o.w > 1.3) for (let k = 1; k < Math.round(o.w / 1.2); k++) {
        const t = o.from + (o.to - o.from) * k / Math.round(o.w / 1.2);
        if (w.orient === "h") box(t - 0.03, w.at - 0.04, fz0, t + 0.03, w.at + 0.04, fz1, mat(K.frame)); else box(w.at - 0.04, t - 0.03, fz0, w.at + 0.04, t + 0.03, fz1, mat(K.frame));
      }
    }
  }
  // floors and ceilings of the rooms
  for (const r of D.rooms) for (const q of r.rects) {
    box(q[0], q[1], -0.15, q[2], q[3], 0, mat(r.floor === "oak" ? K.oak : r.floor === "tile" ? K.tile : "#bdbab2"), false);
    box(q[0], q[1], r.height, q[2], q[3], r.height + 0.05, mat(K.ceiling), true);
  }
  // roof planes, fascia, soffits of covered outdoor areas
  for (const p of D.roofPlanes) {
    const pts = p.pts3;
    const shape2 = pts.map(([x, y]) => new THREE.Vector2(x, y));
    const tris = THREE.ShapeUtils.triangulateShape(shape2, []);
    const pos = []; for (const t of tris) for (const k of t) pos.push(...pts[k]);
    const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3)); g.computeVertexNormals();
    add(g, mat(K.roof, { roughness: 0.5, metalness: 0.1 }));
  }
  for (const r of D.roofs) {
    const [x0, y0, x1, y1] = r.eaveRect, z = r.eaveHeight;
    box(x0, y0, z - 0.2, x1, y0 + 0.04, z + 0.02, mat(K.fascia)); box(x0, y1 - 0.04, z - 0.2, x1, y1, z + 0.02, mat(K.fascia));
    box(x0, y0, z - 0.2, x0 + 0.04, y1, z + 0.02, mat(K.fascia)); box(x1 - 0.04, y0, z - 0.2, x1, y1, z + 0.02, mat(K.fascia));
    // overhang soffit: the eave ring outside the walls
    const ring = new THREE.Shape([[x0, y0], [x1, y0], [x1, y1], [x0, y1]].map(([x, y]) => new THREE.Vector2(x, y)));
    ring.holes.push(new THREE.Path(D.outline.polygons[0].pts.map(([x, y]) => new THREE.Vector2(x, y))));
    const sg = new THREE.ShapeGeometry(ring); sg.translate(0, 0, z - 0.2); add(sg, mat(K.soffit), false, true);
  }
  // slabs of the outdoor areas (graded corners), pools, posts
  for (const o of D.outdoor) {
    const [x0, y0, x1, y1] = o.rect, c = o.grade?.corners ?? [o.top, o.top, o.top, o.top];
    const hex = { deck: K.deck, terrace_paving: K.paving, drive_paving: K.drive, path: K.path, pool_coping: K.coping }[o.role] ?? K.paving;
    const shape = new THREE.Shape([[x0, y0], [x1, y0], [x1, y1], [x0, y1]].map(([x, y]) => new THREE.Vector2(x, y)));
    for (const h of o.holes ?? []) shape.holes.push(new THREE.Path([[h[0], h[1]], [h[2], h[1]], [h[2], h[3]], [h[0], h[3]]].map(([x, y]) => new THREE.Vector2(x, y))));
    if (o.pool) { const q = o.pool.water; shape.holes.push(new THREE.Path([[q[0], q[1]], [q[2], q[1]], [q[2], q[3]], [q[0], q[3]]].map(([x, y]) => new THREE.Vector2(x, y)))); }
    const g = new THREE.ShapeGeometry(shape);
    const pos = g.attributes.position;
    const zAt = (x, y) => { const u = (x - x0) / (x1 - x0), v = (y - y0) / (y1 - y0); return c[0] * (1 - u) * (1 - v) + c[1] * u * (1 - v) + c[2] * u * v + c[3] * (1 - u) * v; };
    for (let k = 0; k < pos.count; k++) pos.setZ(k, zAt(pos.getX(k), pos.getY(k)));
    g.computeVertexNormals(); add(g, mat(hex), false, true);
    box(x0, y0, Math.min(...c) - 0.2, x1, y0 + 0.02, Math.min(...c), mat(K.slab), false); box(x0, y1 - 0.02, Math.min(...c) - 0.2, x1, y1, Math.min(...c), mat(K.slab), false);
    box(x0, y0, Math.min(...c) - 0.2, x0 + 0.02, y1, Math.min(...c), mat(K.slab), false); box(x1 - 0.02, y0, Math.min(...c) - 0.2, x1, y1, Math.min(...c), mat(K.slab), false);
    if (o.pool) {
      const [a, b, cc, d] = o.pool.water, wz = o.pool.waterZ, fz = o.pool.floorZ;
      box(a, b, fz - 0.05, cc, d, fz, mat(K.liner), false);
      box(a - 0.02, b, fz, a, d, o.pool.copingTop, mat(K.liner), false); box(cc, b, fz, cc + 0.02, d, o.pool.copingTop, mat(K.liner), false);
      box(a, b - 0.02, fz, cc, b, o.pool.copingTop, mat(K.liner), false); box(a, d, fz, cc, d + 0.02, o.pool.copingTop, mat(K.liner), false);
      const wg = new THREE.PlaneGeometry(cc - a, d - b); wg.translate((a + cc) / 2, (b + d) / 2, wz);
      add(wg, new THREE.MeshStandardMaterial({ color: new THREE.Color(K.water), roughness: 0.05, metalness: 0.1, transparent: true, opacity: 0.8 }), false, true);
    }
    for (const [px, py] of o.posts ?? []) { const s2 = (o.postSize ?? 0.2) / 2; box(px - s2, py - s2, o.top, px + s2, py + s2, D.clearHeight, mat(K.post)); }
    if (o.covered) box(x0, y0, D.clearHeight, x1, y1, D.clearHeight + 0.05, mat(K.soffit), true);
  }
  if (D.outdoorUnit) { const u = D.outdoorUnit, fp = u.footprint; box(Math.min(...fp.map((p) => p[0])), Math.min(...fp.map((p) => p[1])), u.z, Math.max(...fp.map((p) => p[0])), Math.max(...fp.map((p) => p[1])), u.z + u.size[2], mat(K.equipment)); }
  // furniture as boxes (heights of typical pieces; the furniture GLB is used by the Blender renders)
  const FH = { car: 1.45, chair: 0.85, table6: 0.75, table8: 0.75, sofaL: 0.8, sofa3: 0.8, armchair: 0.8, coffeeTable: 0.4, tv: 1.2, fridge: 1.85, kitchenLine: 0.92, island: 0.92, desk: 0.75, shelf: 1.8, wardrobe: 2.2, bed90: 0.55, bed180: 0.55, bath: 0.6, shower: 2.0, wc: 0.42, sink: 0.85, sink2: 0.85, washer: 0.85, bench: 0.45, lounger: 0.35, grill: 1.0 };
  const FC = { car: "#3d4247", sofaL: "#9aa0a3", sofa3: "#9aa0a3", armchair: "#9aa0a3", bed90: "#e9e6dd", bed180: "#e9e6dd", tv: "#1e2124", fridge: "#d9d9d6", shower: "#a9c2c8", bath: "#f4f4f2", wc: "#f4f4f2", sink: "#f4f4f2", sink2: "#f4f4f2", lounger: "#e9e6dd", grill: "#2b2e31" };
  for (const f of D.furniture) {
    const [x0, y0, x1, y1] = f.rect;
    const z0 = f.outdoor ? (D.outdoor.find((o) => o.id === f.outdoor)?.top ?? 0) : 0;
    box(x0, y0, z0, x1, y1, z0 + (FH[f.type] ?? 0.8), mat(FC[f.type] ?? "#d2c7ae", f.type === "shower" ? { transparent: true, opacity: 0.35 } : {}));
  }
}
// louvre blades (both modes): rotated per shot
for (const sc of I.screens) {
  for (const s of sc.blades.positions) {
    const g = new THREE.BoxGeometry(sc.blades.chord, sc.blades.thickness, sc.height);
    const m = new THREE.Mesh(g, mat(K.wood)); m.castShadow = true; m.receiveShadow = true;
    const p = sc.orient === "v" ? [sc.from[0], s] : [s, sc.from[1]];
    m.position.set(p[0], p[1], sc.baseZ + sc.height / 2);
    scene.add(m); louvreMeshes.push({ m, sc });
  }
}
// blinds: one panel per item, sized per shot
const blindMeshes = I.blinds.items.map((b) => {
  const g = new THREE.PlaneGeometry(1, 1);
  const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: new THREE.Color("#383e42"), roughness: 0.4, metalness: 0.5, side: THREE.DoubleSide, transparent: true, opacity: 0.9 }));
  m.castShadow = true; scene.add(m); return { m, b };
});
// lamps as small glowing dots (exterior group) for dusk frames
const lampDots = I.lights.items.filter((l) => l.group === "exterior").map((l) => {
  const g = new THREE.SphereGeometry(l.kind === "pool" ? 0.12 : 0.05, 8, 6); g.translate(...l.pos);
  const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: new THREE.Color(l.kind === "pool" ? "#cfe9ff" : "#ffd9a0") })); scene.add(m); return m;
});
// ---- sky and light
const skyGeo = new THREE.SphereGeometry(2000, 32, 16);
const skyMat = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, depthWrite: false, fog: false });
const sky = new THREE.Mesh(skyGeo, skyMat); scene.add(sky);
skyGeo.setAttribute("color", new THREE.Float32BufferAttribute(new Float32Array(skyGeo.attributes.position.count * 3), 3));
const sunLight = new THREE.DirectionalLight(0xffffff, 3);
sunLight.castShadow = true; sunLight.shadow.mapSize.set(4096, 4096);
const sc0 = sunLight.shadow.camera; sc0.left = -48; sc0.right = 48; sc0.top = 48; sc0.bottom = -48; sc0.near = 1; sc0.far = 400;
sunLight.shadow.bias = -0.0004; sunLight.shadow.normalBias = 0.03;
const centre = new THREE.Vector3((D.bbox.x0 + D.bbox.x1) / 2, (D.bbox.y0 + D.bbox.y1) / 2, 0);
scene.add(sunLight); scene.add(sunLight.target); sunLight.target.position.copy(centre);
const hemi = new THREE.HemisphereLight(0xbfd6ff, 0x8a8678, 1); hemi.up.set(0, 0, 1); hemi.position.set(0, 0, 1); scene.add(hemi);
const lerp = (a, b, t) => a + (b - a) * t, clamp01 = (v) => Math.min(1, Math.max(0, v));
const mix = (c1, c2, t) => new THREE.Color(c1).lerp(new THREE.Color(c2), clamp01(t));
function skyColours(el) {
  // zenith and horizon by sun elevation (night -> dusk -> golden -> day)
  if (el > 12) return [new THREE.Color("#5f93c9"), new THREE.Color("#cfe0ee")];
  if (el > 0) return [mix("#6f8fb8", "#5f93c9", el / 12), mix("#f3dcc0", "#cfe0ee", el / 12)];
  if (el > -6) return [mix("#1d2f52", "#6f8fb8", (el + 6) / 6), mix("#8a7f8f", "#f3dcc0", (el + 6) / 6)];
  return [new THREE.Color("#0b1222"), new THREE.Color("#2a3348")];
}
function setSun(sun, lights) {
  const el = sun.elevationDeg, [zen, hor] = skyColours(el);
  const pos = skyGeo.attributes.position, colA = skyGeo.attributes.color;
  for (let k = 0; k < pos.count; k++) { const t = clamp01(pos.getZ(k) / 2000 * 2.5); const c = hor.clone().lerp(zen, Math.sqrt(t)); colA.setXYZ(k, c.r, c.g, c.b); }
  colA.needsUpdate = true;
  sky.position.copy(camera.position);
  const d = sun.direction;
  sunLight.position.set(centre.x + d[0] * 150, centre.y + d[1] * 150, d[2] * 150);
  sunLight.intensity = el > 0 ? 3.2 * clamp01(el / 6) : 0;
  sunLight.color = el < 12 ? mix("#ffd2a0", "#ffffff", el / 12) : new THREE.Color("#ffffff");
  hemi.color = zen.clone().lerp(hor, 0.5); hemi.groundColor = new THREE.Color("#8a8678");
  hemi.intensity = el > 0 ? 1.1 : lerp(0.08, 1.1, clamp01((el + 8) / 8));
  for (const m of glassMats) m.emissiveIntensity = (lights?.interior ?? 0) * 0.9;
  for (const dot of lampDots) dot.visible = (lights?.exterior ?? 0) > 0.05;
  scene.fog = new THREE.Fog(hor, 120, 1400);
}
const camera = new THREE.PerspectiveCamera(50, 16 / 9, 0.1, 4000);
function setCamera(c, size) {
  const [w, h] = size, L = Math.max(w, h), longTan = c.sensorWidthMm / (2 * c.focalMm), near = 0.1, far = 4000;
  camera.position.set(...c.position); camera.up.set(0, 0, 1);
  camera.lookAt(c.position[0] + c.forward[0], c.position[1] + c.forward[1], c.position[2] + c.forward[2]);
  if (c.roll) camera.rotateZ(c.roll * Math.PI / 180);
  camera.updateMatrixWorld(true);
  const sx = c.shift[0], sy = c.shift[1];
  camera.projectionMatrix.makePerspective(near * longTan * (-w / L + 2 * sx), near * longTan * (w / L + 2 * sx), near * longTan * (h / L + 2 * sy), near * longTan * (-h / L + 2 * sy), near, far);
  camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
}
function setState(v) {
  for (const { m, sc } of louvreMeshes) {
    const a = (v.screens?.items?.[I.screens.indexOf(sc)]?.angleDeg ?? sc.restDeg) * Math.PI / 180;
    m.rotation.set(0, 0, Math.atan2(sc.axis[1], sc.axis[0]) + a);
  }
  blindMeshes.forEach(({ m, b }, i) => {
    const s = v.blinds?.[i]; const drop = s?.drop ?? 0;
    m.visible = drop > 0.01;
    if (!m.visible) return;
    const hgt = b.height * drop, z1 = b.head, z0 = z1 - hgt;
    m.scale.set(b.width, hgt, 1);
    m.position.set(b.planeCenter[0] + b.normal[0] * 0.01, b.planeCenter[1] + b.normal[1] * 0.01, (z0 + z1) / 2);
    m.rotation.set(Math.PI / 2, 0, Math.atan2(b.along[1], b.along[0]));
    m.material.opacity = 0.55 + 0.45 * Math.sin(Math.min(90, (s?.slatAngleDeg ?? 0) + 30) * Math.PI / 180);
  });
  for (const { g, grp } of gateMeshes) {
    const t = g.access === "driveway" ? (v.gates?.driveway ?? 0) : (v.gates?.walkway ?? 0);
    grp.position.set(0, 0, 0); grp.rotation.set(0, 0, 0);
    if (t > 0 && g.park) { const dx = g.park.to[0] - g.park.from[0], dy = g.park.to[1] - g.park.from[1], l = Math.hypot(dx, dy); grp.position.set(dx / l * g.leaf * t, dy / l * g.leaf * t, 0); }
    else if (t > 0 && g.swing) {
      const [hx, hy] = g.swing.hinge, a0 = Math.atan2(g.swing.closedEnd[1] - hy, g.swing.closedEnd[0] - hx), a1 = Math.atan2(g.swing.openEnd[1] - hy, g.swing.openEnd[0] - hx);
      let da = a1 - a0; while (da > Math.PI) da -= 2 * Math.PI; while (da < -Math.PI) da += 2 * Math.PI;
      const rot = da * t; grp.rotation.z = rot;
      const c = Math.cos(rot), s = Math.sin(rot); grp.position.set(hx - (hx * c - hy * s), hy - (hx * s + hy * c), 0);
    }
  }
  for (const m of garageDoors) m.visible = (v.garageDoor ?? 0) < 0.5;
}
// overlay: guides and text
function overlay(ctx, v, w, h) {
  ctx.lineWidth = Math.max(1, w / 640);
  const X = (x) => (x + 1) / 2 * w, Y = (y) => (1 - y) / 2 * h;
  ctx.strokeStyle = "rgba(255,255,255,0.45)";
  if (v.guides === "hero" || v.guides === "og") {
    ctx.setLineDash([6, 4]); ctx.strokeRect(X(-0.8), Y(0.8), X(0.8) - X(-0.8), Y(-0.8) - Y(0.8));
    ctx.strokeStyle = "rgba(95,214,174,0.9)"; ctx.strokeRect(X(-1) + 1, Y(1) + 1, X(-0.1) - X(-1), Y(0.3) - Y(1));
    ctx.strokeStyle = "rgba(255,255,255,0.45)"; ctx.beginPath(); ctx.moveTo(X(0.5), 0); ctx.lineTo(X(0.5), h); ctx.stroke(); ctx.setLineDash([]);
  }
  if (v.guides === "portrait" || v.guides === "portrait-light") {
    ctx.setLineDash([6, 4]); ctx.beginPath(); for (const y of [1 / 3, -1 / 3]) { ctx.moveTo(0, Y(y)); ctx.lineTo(w, Y(y)); } ctx.stroke();
    ctx.strokeStyle = "rgba(95,214,174,0.8)"; ctx.strokeRect(X(-0.69), 1, X(0.69) - X(-0.69), h - 2); ctx.setLineDash([]);
  }
  if (v.guides === "thirds" || v.guides === "orbit") {
    ctx.beginPath(); for (const f of [1 / 3, 2 / 3]) { ctx.moveTo(w * f, 0); ctx.lineTo(w * f, h); ctx.moveTo(0, h * f); ctx.lineTo(w, h * f); } ctx.stroke();
  }
  const lines = [v.title, ...(v.lines ?? [])];
  const fs = Math.max(11, Math.round(w / 52));
  ctx.font = fs + "px ui-monospace, Menlo, monospace";
  const pad = 6, lh = fs + 4;
  ctx.fillStyle = "rgba(15,17,19,0.62)"; ctx.fillRect(0, h - lines.length * lh - pad * 2, w, lines.length * lh + pad * 2);
  ctx.fillStyle = "#f4f1e8"; lines.forEach((t, i) => ctx.fillText(t, pad, h - (lines.length - i - 1) * lh - pad - 4));
}
window.renderView = async (v, width) => {
  const [W, H] = v.size, w = width, h = Math.round(width * H / W);
  renderer.setPixelRatio(1); renderer.setSize(w, h, false);
  setCamera(v.camera, v.size); setState(v); setSun(v.sun, v.lights);
  renderer.render(scene, camera);
  const c2 = document.createElement("canvas"); c2.width = w; c2.height = h;
  const ctx = c2.getContext("2d"); ctx.drawImage(renderer.domElement, 0, 0, w, h);
  overlay(ctx, v, w, h);
  return c2.toDataURL("image/png");
};
document.title = "ready";
</script></body></html>`;

// ------------------------------------------------------------------------------------------------ render

const { chromium } = await import("@playwright/test");
fs.mkdirSync(outDir, { recursive: true });
const tilesDir = path.join(outDir, "tiles");
fs.mkdirSync(tilesDir, { recursive: true });
const browser = await chromium.launch({ args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
page.on("pageerror", (e) => console.error("page error:", String(e).slice(0, 400)));
page.on("console", (m) => { if (m.type() === "error") console.error("console:", m.text().slice(0, 300)); });
const types = { ".js": "text/javascript", ".html": "text/html", ".json": "application/json", ".glb": "model/gltf-binary", ".wasm": "application/wasm" };
const payloadText = JSON.stringify(payload);
await page.route("http://preview.invalid/**", async (route) => {
  const p = decodeURIComponent(new URL(route.request().url()).pathname);
  if (p === "/" || p === "/index.html") return route.fulfill({ status: 200, body: PAGE, headers: { "content-type": "text/html" } });
  if (p === "/payload.json") return route.fulfill({ status: 200, body: payloadText, headers: { "content-type": "application/json" } });
  let f = null;
  if (p.startsWith("/three/")) f = path.join(root, "node_modules", p);
  else if (p.startsWith("/draco/") || p.startsWith("/models/")) f = path.join(root, "public", p);
  if (!f || !fs.existsSync(f)) return route.fulfill({ status: 404, body: "not found" });
  return route.fulfill({ status: 200, body: fs.readFileSync(f), headers: { "content-type": types[path.extname(f)] ?? "application/octet-stream" } });
});
await page.goto("http://preview.invalid/index.html");
await page.waitForFunction(() => document.title === "ready", null, { timeout: 180000 });

async function renderTile(name, width) {
  const v = viewsAll.get(name);
  if (!v) throw new Error(`unknown view ${name}`);
  const lines = framing(v);
  const url = await page.evaluate(([vv, ww]) => window.renderView(vv, ww), [{ ...v, lines }, width]);
  const file = path.join(tilesDir, `${name}.png`);
  fs.writeFileSync(file, Buffer.from(url.split(",")[1], "base64"));
  return { file, lines };
}

const t0 = Date.now();
const report = [];
for (const sheet of sheets) {
  const names = sheetViews[sheet];
  if (!names) throw new Error(`unknown sheet ${sheet}`);
  const width = Number(opt("--width", tileWidth[sheet]));
  const files = [];
  for (const n of names) {
    const r = await renderTile(n, viewsAll.get(n).size[0] < viewsAll.get(n).size[1] ? Math.round(width * 0.5625) : width);
    files.push(r.file);
    report.push(`${n}: ${r.lines.join(" | ")}`);
  }
  const out = path.join(outDir, `sheet-${sheet}.png`);
  const cols = sheet === "stills" ? 4 : 6;
  const m = spawnSync("magick", ["montage", ...files, "-tile", `${cols}x`, "-geometry", "+6+6", "-background", "#1b1e21", out], { encoding: "utf8" });
  if (m.status !== 0) console.error(`magick montage failed: ${m.stderr}`);
  else console.log(`wrote ${path.relative(process.cwd(), out)} (${files.length} tiles)`);
}
for (const n of only) {
  const r = await renderTile(n, Number(opt("--width", viewsAll.get(n)?.size[0] < viewsAll.get(n)?.size[1] ? 720 : 1280)));
  const out = path.join(outDir, `${n}.png`);
  fs.copyFileSync(r.file, out);
  console.log(`wrote ${path.relative(process.cwd(), out)}`);
  report.push(`${n}: ${r.lines.join(" | ")}`);
}
await browser.close();
fs.writeFileSync(path.join(outDir, "framing.txt"), report.join("\n") + "\n");
console.log(`${report.length} views in ${((Date.now() - t0) / 1000).toFixed(0)} s; framing numbers in ${path.relative(process.cwd(), path.join(outDir, "framing.txt"))}`);
