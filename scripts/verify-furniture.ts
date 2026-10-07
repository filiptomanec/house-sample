// Verifies the furniture GLBs and footprints against the contract in docs/ARCHITECTURE.md and docs/PIPELINE-FURNITURE.md.
// Node only, no dependencies:  npx tsx scripts/verify-furniture.ts [--dir public/models] [--house model/house.json]
//                                                                    [--derived generated/derived.json] [--glb file.glb --lite]
// Exit code 1 when any check fails.
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const args = process.argv.slice(2);
const opt = (name: string, def?: string): string | undefined => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && i + 1 < args.length && !args[i + 1].startsWith('--') ? args[i + 1] : def;
};
const root = resolve(import.meta.dirname ?? '.', '..');
const dir = resolve(root, opt('dir', 'public/models')!);
const housePath = resolve(root, opt('house', 'model/house.json')!);
const derivedPath = resolve(root, opt('derived', 'generated/derived.json')!);

const BUDGET = {
  high: { file: 'furniture.glb', triangles: 200_000, bytes: 1_400_000 },
  lite: { file: 'furniture-lite.glb', triangles: 80_000, bytes: 600_000 },
};
const WOOD = new Set(['f_oak', 'f_oak_dark', 't_teak']);

let errors = 0;
let warnings = 0;
const fail = (m: string) => { errors++; console.error('  FAIL', m); };
const warn = (m: string) => { warnings++; console.warn('  warn', m); };
const ok = (m: string) => console.log('  ok  ', m);

function readGlb(path: string): { json: Json; bytes: number } {
  const b = readFileSync(path);
  if (b.readUInt32LE(0) !== 0x46546c67) throw new Error('not a GLB (bad magic)');
  if (b.readUInt32LE(4) !== 2) throw new Error('GLB version is not 2');
  const jl = b.readUInt32LE(12);
  if (b.readUInt32LE(16) !== 0x4e4f534a) throw new Error('first chunk is not JSON');
  return { json: JSON.parse(b.subarray(20, 20 + jl).toString('utf8')), bytes: b.length };
}

type Bounds = { min: number[]; max: number[]; inputHash?: string };

function checkGlb(path: string, kind: 'high' | 'lite'): { zones: Set<string>; bounds: Bounds } {
  const budget = BUDGET[kind];
  console.log(`${path}`);
  const { json: j, bytes } = readGlb(path);
  const nodes: Json[] = j.nodes ?? [];
  const materials: Json[] = j.materials ?? [];
  const zones = new Set<string>();

  // size and triangles
  if (bytes <= budget.bytes) ok(`size ${(bytes / 1024).toFixed(0)} kB <= ${(budget.bytes / 1024).toFixed(0)} kB`);
  else fail(`size ${bytes} B over the budget ${budget.bytes} B`);
  let tris = 0;
  for (const m of j.meshes ?? []) for (const p of m.primitives) tris += j.accessors[p.indices].count / 3;
  if (tris <= budget.triangles) ok(`${tris} triangles <= ${budget.triangles}`);
  else fail(`${tris} triangles over the budget ${budget.triangles}`);
  if ((j.extensionsUsed ?? []).includes('KHR_draco_mesh_compression')) ok('Draco geometry');
  else fail('geometry is not Draco compressed');

  // root and node names
  const rootIdx = nodes.findIndex((n) => n.name === 'furniture');
  if (rootIdx < 0) fail('missing root node "furniture"');
  else {
    const children: number[] = nodes[rootIdx].children ?? [];
    if (children.length === nodes.length - 1) ok(`root "furniture" with ${children.length} children`);
    else fail(`root has ${children.length} children but there are ${nodes.length - 1} other nodes`);
    if (j.scenes?.[0]?.nodes?.length === 1 && j.scenes[0].nodes[0] === rootIdx) ok('the scene holds only the root');
    else fail('the scene must contain only the "furniture" root node');
  }
  for (const n of nodes) {
    if (n.matrix || n.translation || n.rotation || n.scale) fail(`node ${n.name} has a transform (transforms must be baked)`);
  }
  const nameRe = /^furniture_([A-Za-z0-9_]+?)_((?:f|t)_[a-z0-9_]+)$/;
  const seen = new Set<string>();
  for (const n of nodes) {
    if (n.name === 'furniture') continue;
    const m = nameRe.exec(n.name);
    if (!m) { fail(`node name ${n.name} does not match furniture_<room>_<material>`); continue; }
    if (seen.has(n.name)) fail(`duplicate node ${n.name}`);
    seen.add(n.name);
    const [, zone, mat] = m;
    zones.add(zone);
    if (n.mesh === undefined) fail(`${n.name} has no mesh`);
    const x = n.extras ?? {};
    if (x.role !== mat) fail(`${n.name}: extras.role ${x.role} != ${mat}`);
    if (x.toggle !== 'furniture') fail(`${n.name}: extras.toggle must be "furniture"`);
    if (!x.roomId || String(x.roomId).replace(/[.\-]/g, '_') !== zone) fail(`${n.name}: extras.roomId ${x.roomId} does not match the node`);
    const isT = mat.startsWith('t_');
    if (zone === 'terrace' && !isT) fail(`${n.name}: terrace nodes use t_* materials`);
    if (zone !== 'terrace' && isT) fail(`${n.name}: room nodes use f_* materials`);
    const prim = j.meshes[n.mesh]?.primitives?.[0];
    const matName = prim !== undefined ? materials[prim.material]?.name : undefined;
    if (matName !== mat) fail(`${n.name}: material ${matName} != ${mat}`);
  }
  ok(`${seen.size} nodes named furniture_<room>_<material>`);

  // materials
  const names = new Set<string>();
  for (const m of materials) {
    if (!/^[ft]_[a-z0-9_]+$/.test(m.name)) fail(`material name ${m.name}`);
    if (names.has(m.name)) fail(`duplicate material ${m.name}`);
    names.add(m.name);
    const tex = m.pbrMetallicRoughness?.baseColorTexture;
    if (tex && !WOOD.has(m.name)) fail(`material ${m.name} has a texture (only woods may)`);
    if (!tex && WOOD.has(m.name)) warn(`wood material ${m.name} has no texture`);
    if (m.doubleSided !== true) warn(`material ${m.name} is not double sided`);
  }
  ok(`${materials.length} materials, textures only on woods`);

  // bounds of all positions (glTF Y-up: house (x, y, z) maps to (x, z, -y)); the floor is z = 0 and nothing may sink under it
  const bounds: Bounds = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
  for (const m of j.meshes ?? []) {
    for (const p of m.primitives) {
      const a = j.accessors[p.attributes.POSITION];
      for (let i = 0; i < 3; i++) {
        bounds.min[i] = Math.min(bounds.min[i], a.min[i]);
        bounds.max[i] = Math.max(bounds.max[i], a.max[i]);
      }
    }
  }
  if (bounds.min[1] >= -0.02) ok(`nothing below the floor (lowest y ${bounds.min[1].toFixed(3)} m)`);
  else fail(`geometry below the floor: y ${bounds.min[1].toFixed(3)} m`);
  if (bounds.max[1] <= 3.2) ok(`highest point ${bounds.max[1].toFixed(2)} m`);
  else fail(`geometry above 3.2 m: ${bounds.max[1].toFixed(2)} m`);
  bounds.inputHash = j.scenes?.[0]?.extras?.inputHash;
  return { zones, bounds };
}

type Rect = [number, number, number, number];

function rectInter(a: Rect, b: Rect): number {
  const w = Math.min(a[2], b[2]) - Math.max(a[0], b[0]);
  const h = Math.min(a[3], b[3]) - Math.max(a[1], b[1]);
  return w > 0 && h > 0 ? w * h : 0;
}

/** Area of box inside the union of rects (coordinate compression). */
function coveredArea(box: Rect, rects: Rect[]): number {
  const xs = [...new Set([box[0], box[2], ...rects.flatMap((r) => [r[0], r[2]]).filter((v) => v > box[0] && v < box[2])])].sort((a, b) => a - b);
  const ys = [...new Set([box[1], box[3], ...rects.flatMap((r) => [r[1], r[3]]).filter((v) => v > box[1] && v < box[3])])].sort((a, b) => a - b);
  let a = 0;
  for (let i = 0; i < xs.length - 1; i++) {
    for (let k = 0; k < ys.length - 1; k++) {
      const cx = (xs[i] + xs[i + 1]) / 2;
      const cy = (ys[k] + ys[k + 1]) / 2;
      if (rects.some((r) => cx >= r[0] && cx <= r[2] && cy >= r[1] && cy <= r[3])) a += (xs[i + 1] - xs[i]) * (ys[k + 1] - ys[k]);
    }
  }
  return a;
}

function roomRects(derived: Json): Map<string, Rect[]> {
  const out = new Map<string, Rect[]>();
  for (const r of derived.netRooms ?? derived.rooms ?? []) {
    let rects: Rect[] = [];
    if (r.cleanRects) rects = r.cleanRects;
    else if (r.rects) rects = r.rects;
    else if (r.bbox) rects = [[r.bbox.x0, r.bbox.y0, r.bbox.x1, r.bbox.y1]];
    out.set(r.id, rects);
  }
  return out;
}

function checkFootprints(path: string, zones: Set<string>, bounds?: Bounds) {
  console.log(`${path}`);
  const fp = JSON.parse(readFileSync(path, 'utf8'));
  if (fp.schema !== 'furniture-footprints/1') fail(`schema ${fp.schema}`);
  else ok('schema furniture-footprints/1');
  if (typeof fp.inputHash !== 'string' || fp.inputHash.length < 8) fail('missing inputHash');
  else if (bounds?.inputHash && bounds.inputHash !== fp.inputHash) fail(`footprints (${fp.inputHash}) and furniture.glb (${bounds.inputHash}) were built from different inputs`);
  else if (bounds?.inputHash) ok(`GLB and footprints share inputHash ${fp.inputHash}`);
  const items: Json[] = fp.items ?? [];
  if (items.length === 0) fail('no footprint boxes');
  let bad = 0;
  for (const it of items) {
    const b = it.box;
    if (!Array.isArray(b) || b.length !== 4 || !(b[2] > b[0]) || !(b[3] > b[1])) { fail(`bad box ${JSON.stringify(it)}`); bad++; continue; }
    if (!(it.h > 0) || typeof it.type !== 'string' || typeof it.room !== 'string') { fail(`item without h/type/room: ${it.id}`); bad++; }
  }
  if (!bad) ok(`${items.length} boxes with box, h, type, room`);
  if (bounds) {
    // the GLB and the footprints share the house frame: x east, y north = -z in glTF
    const fx0 = Math.min(...items.map((i) => i.box[0])), fx1 = Math.max(...items.map((i) => i.box[2]));
    const fy0 = Math.min(...items.map((i) => i.box[1])), fy1 = Math.max(...items.map((i) => i.box[3]));
    const gx0 = bounds.min[0], gx1 = bounds.max[0], gy0 = -bounds.max[2], gy1 = -bounds.min[2];
    const d = Math.max(Math.abs(gx0 - fx0), Math.abs(gx1 - fx1), Math.abs(gy0 - fy0), Math.abs(gy1 - fy1));
    if (d <= 1.5) ok(`GLB bounds agree with the footprints in the house frame (max offset ${d.toFixed(2)} m)`);
    else fail(`GLB bounds [${gx0.toFixed(1)}, ${gy0.toFixed(1)}, ${gx1.toFixed(1)}, ${gy1.toFixed(1)}] differ from the footprints [${fx0.toFixed(1)}, ${fy0.toFixed(1)}, ${fx1.toFixed(1)}, ${fy1.toFixed(1)}] (Y-up mapping?)`);
  }
  const known = new Set([...zones].map((z) => z));
  for (const it of items) if (!known.has(String(it.room).replace(/[.\-]/g, '_'))) warn(`footprint of ${it.type} in zone ${it.room} has no GLB node`);

  if (!existsSync(derivedPath) || !existsSync(housePath)) {
    warn(`skipping the inside-room check: ${!existsSync(derivedPath) ? derivedPath : housePath} not found`);
    return;
  }
  const derived = JSON.parse(readFileSync(derivedPath, 'utf8'));
  const house = JSON.parse(readFileSync(housePath, 'utf8'));
  const rooms = roomRects(derived);
  const outdoor: Rect[] = (house.outdoor ?? []).map((o: Json) => o.rect);
  let outside = 0;
  for (const it of items) {
    const b = it.box as Rect;
    const area = (b[2] - b[0]) * (b[3] - b[1]);
    const rects = it.room === 'terrace' ? outdoor : rooms.get(it.room) ?? [];
    if (!rects.length) { fail(`zone ${it.room}: no room geometry`); continue; }
    const inside = coveredArea(b, rects) / area;
    const limit = it.kind === 'furniture' ? 0.97 : 0.85;
    if (inside < limit) {
      outside++;
      (it.kind === 'furniture' ? fail : warn)(`${it.type} (${it.id}) in ${it.room}: only ${(inside * 100).toFixed(0)} % of its footprint lies in the room`);
    }
  }
  if (!outside) ok('all footprints lie inside their rooms');
  // door clear zones: no box may cover the door gap (the pipeline cuts them out)
  const openings: Json[] = derived.openings ?? [];
  let blocked = 0;
  for (const o of openings) {
    if (o.kind !== 'door' && o.kind !== 'entry') continue;
    const t = (derived.walls ?? []).find((w: Json) => w.id === o.wallId)?.t ?? 0.15;
    const h = t / 2 + 0.55 - 0.01;
    const gap: Rect = o.orient === 'h' ? [o.from + 0.02, o.axis - h, o.to - 0.02, o.axis + h] : [o.axis - h, o.from + 0.02, o.axis + h, o.to - 0.02];
    for (const it of items) if (rectInter(it.box, gap) > 1e-4) { blocked++; warn(`${it.type} (${it.id}) stands in the clear zone of door ${o.id}`); }
  }
  if (!blocked) ok('door zones are free');
}

function main() {
  const targets: Array<['high' | 'lite', string]> = [];
  const glb = opt('glb');
  if (glb) targets.push([args.includes('--lite') ? 'lite' : 'high', resolve(root, glb)]);
  else for (const k of ['high', 'lite'] as const) targets.push([k, join(dir, BUDGET[k].file)]);
  let zones = new Set<string>();
  let bounds: Bounds | undefined;
  for (const [kind, path] of targets) {
    if (!existsSync(path)) { fail(`missing ${path}`); continue; }
    try {
      const r = checkGlb(path, kind);
      zones = r.zones;
      if (kind === 'high') bounds = r.bounds;
    } catch (e) { fail(`${path}: ${(e as Error).message}`); }
  }
  const fpPath = join(dir, 'furniture-footprints.json');
  if (existsSync(fpPath)) checkFootprints(fpPath, zones, bounds);
  else fail(`missing ${fpPath}`);
  console.log(errors ? `\n${errors} failure(s), ${warnings} warning(s)` : `\nOK (${warnings} warning(s))`);
  process.exit(errors ? 1 : 0);
}

main();
