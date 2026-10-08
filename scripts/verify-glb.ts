// Verifies a house GLB against the GLB contract of docs/ARCHITECTURE.md (section 3) and against generated/derived.json.
// Node only, no dependencies: parses the GLB container and its JSON chunk (accessor counts and min/max are in the JSON, so
// triangle counts and bounding boxes need no decoding). The geometry checks (slab tops on the derived grade, louvre blades
// on their pivots at the rest angle) decode the Draco geometry with the decoder shipped for the web (public/draco).
//
//   npx tsx scripts/verify-glb.ts public/models/house.glb [--lite] [--derived generated/derived.json] [--no-geometry]
//
// Exit codes: 0 ok (warnings are fine), 1 the model violates the contract, 2 input problem.
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

export const HOUSE_ROLES = [
  "plaster", "wood_cladding", "frame", "glass", "sill", "soffit", "fascia", "gutter", "roof_tile", "ridge_cap", "ceiling",
  "plaster_in", "door_leaf", "slab", "floor_oak", "floor_tile", "floor_stone", "floor_concrete", "terrace_paving",
  "drive_paving", "path", "gravel", "post", "screen_slats",
  // since R2 (docs/ARCHITECTURE.md section 3, contract C2)
  "deck", "pool_coping", "pool_liner", "water", "garage_door", "screen_rail", "equipment",
] as const;
/** Legacy mapping of an outdoor type to its slab role, for derived data without `outdoor[].role`. */
const LEGACY_OUTDOOR_ROLE: Record<string, string> = { drive: "drive_paving", path: "path", deck: "deck", pool: "pool_coping" };
/** Roles that the web "Roof" switch hides (toggle "roof"). */
export const ROOF_TOGGLE_ROLES = ["roof_tile", "ridge_cap", "fascia", "gutter", "soffit", "ceiling"] as const;
/** Roles that must carry toggle "roof" in every node (the contract names them explicitly). */
const ROOF_REQUIRED = ["roof_tile", "ridge_cap", "fascia", "gutter", "ceiling"];
const TOGGLES = ["roof", "furniture"];

export const BUDGETS = {
  high: { bytes: 7_000_000, triangles: Infinity, texturePx: 1024 },
  lite: { bytes: 2_500_000, triangles: 70_000, texturePx: 512 },
} as const;

export interface GltfNode {
  name?: string;
  mesh?: number;
  children?: number[];
  matrix?: number[];
  translation?: number[];
  rotation?: number[];
  scale?: number[];
  extras?: { role?: unknown; toggle?: unknown; id?: unknown };
}
interface GltfAccessor { count: number; type: string; min?: number[]; max?: number[] }
interface GltfPrimitive { attributes: Record<string, number>; indices?: number; material?: number; mode?: number; extensions?: Record<string, unknown> }
interface GltfImage { bufferView?: number; uri?: string; mimeType?: string; name?: string }
export interface Gltf {
  asset?: { version?: string };
  extensionsUsed?: string[];
  extensionsRequired?: string[];
  scene?: number;
  scenes?: { nodes?: number[] }[];
  nodes?: GltfNode[];
  meshes?: { name?: string; primitives: GltfPrimitive[] }[];
  materials?: { name?: string; doubleSided?: boolean }[];
  accessors?: GltfAccessor[];
  bufferViews?: { buffer: number; byteOffset?: number; byteLength: number }[];
  images?: GltfImage[];
  textures?: unknown[];
}

export interface Glb { json: Gltf; bin: Buffer | null; size: number }

export function parseGlb(buf: Buffer): Glb {
  if (buf.length < 20) throw new Error("file too short for a GLB");
  if (buf.readUInt32LE(0) !== 0x46546c67) throw new Error("not a GLB (magic is not 'glTF')");
  if (buf.readUInt32LE(4) !== 2) throw new Error("GLB version is not 2");
  if (buf.readUInt32LE(8) !== buf.length) throw new Error(`GLB length field ${buf.readUInt32LE(8)} differs from the file size ${buf.length}`);
  let off = 12;
  let json: Gltf | null = null;
  let bin: Buffer | null = null;
  while (off + 8 <= buf.length) {
    const len = buf.readUInt32LE(off);
    const type = buf.readUInt32LE(off + 4);
    const data = buf.subarray(off + 8, off + 8 + len);
    if (type === 0x4e4f534a) json = JSON.parse(data.toString("utf8")) as Gltf;
    else if (type === 0x004e4942) bin = data;
    off += 8 + len;
  }
  if (!json) throw new Error("GLB has no JSON chunk");
  return { json, bin, size: buf.length };
}

/** Width and height of a WebP image (VP8, VP8L, VP8X), or null if the bytes are not a WebP. */
export function webpSize(b: Buffer): { w: number; h: number } | null {
  if (b.length < 30 || b.toString("ascii", 0, 4) !== "RIFF" || b.toString("ascii", 8, 12) !== "WEBP") return null;
  const tag = b.toString("ascii", 12, 16);
  if (tag === "VP8X") return { w: 1 + b.readUIntLE(24, 3), h: 1 + b.readUIntLE(27, 3) };
  if (tag === "VP8L") {
    const v = b.readUInt32LE(21);
    return { w: 1 + (v & 0x3fff), h: 1 + ((v >> 14) & 0x3fff) };
  }
  if (tag === "VP8 ") return { w: b.readUInt16LE(26) & 0x3fff, h: b.readUInt16LE(28) & 0x3fff };
  return null;
}

export type Vec3 = [number, number, number];
export interface BBox { min: Vec3; max: Vec3 }

function emptyBox(): BBox {
  return { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
}
function grow(b: BBox, lo: Vec3, hi: Vec3): void {
  for (let i = 0; i < 3; i++) {
    b.min[i] = Math.min(b.min[i], lo[i]);
    b.max[i] = Math.max(b.max[i], hi[i]);
  }
}
/** glTF (x, y, z) Y-up -> house frame (x east, y north, z up): (x, -z, y). */
function toHouse(lo: number[], hi: number[]): [Vec3, Vec3] {
  return [[lo[0], 0 - hi[2], lo[1]], [hi[0], 0 - lo[2], hi[1]]]; // 0 - z avoids -0
}

export interface NodeInfo { index: number; name: string; role: string; id?: string; toggle?: string; triangles: number; box: BBox }
export interface Analysis {
  size: number;
  nodes: NodeInfo[];
  triangles: number;
  bbox: BBox;                         // house frame
  roles: Record<string, { nodes: number; triangles: number }>;
  imageSizes: { name: string; w: number; h: number }[];
}

/** Statistics of a GLB: per-node triangles and bounding boxes in the house frame. Never throws on contract violations. */
export function analyzeGlb(glb: Glb): Analysis {
  const j = glb.json;
  const nodes: NodeInfo[] = [];
  const total = emptyBox();
  const roles: Analysis["roles"] = {};
  let triangles = 0;
  (j.nodes ?? []).forEach((n, index) => {
    if (n.mesh === undefined) return;
    const mesh = j.meshes?.[n.mesh];
    let tri = 0;
    const box = emptyBox();
    for (const p of mesh?.primitives ?? []) {
      if ((p.mode ?? 4) === 4 && p.indices !== undefined) tri += Math.floor((j.accessors?.[p.indices]?.count ?? 0) / 3);
      const pos = j.accessors?.[p.attributes.POSITION];
      if (pos?.min && pos.max) {
        const [lo, hi] = toHouse(pos.min, pos.max);
        grow(box, lo, hi);
        grow(total, lo, hi);
      }
    }
    const role = typeof n.extras?.role === "string" ? n.extras.role : "?";
    const info: NodeInfo = {
      index,
      name: n.name ?? "",
      role,
      id: typeof n.extras?.id === "string" ? n.extras.id : undefined,
      toggle: typeof n.extras?.toggle === "string" ? n.extras.toggle : undefined,
      triangles: tri,
      box,
    };
    nodes.push(info);
    triangles += tri;
    const r = (roles[role] ??= { nodes: 0, triangles: 0 });
    r.nodes++;
    r.triangles += tri;
  });
  const imageSizes: Analysis["imageSizes"] = [];
  for (const im of j.images ?? []) {
    if (im.bufferView === undefined || !glb.bin) continue;
    const bv = j.bufferViews?.[im.bufferView];
    if (!bv) continue;
    const s = webpSize(glb.bin.subarray(bv.byteOffset ?? 0, (bv.byteOffset ?? 0) + bv.byteLength));
    if (s) imageSizes.push({ name: im.name ?? String(im.bufferView), w: s.w, h: s.h });
  }
  return { size: glb.size, nodes, triangles, bbox: total, roles, imageSizes };
}

// ---------------------------------------------------------------------------------------------------------------------
export interface DerivedLike {
  inputHash?: string;
  outline?: { bbox?: { x0: number; y0: number; x1: number; y1: number } };
  bbox?: { x0: number; y0: number; x1: number; y1: number; z1: number };
  rooms?: { floor?: string; type?: string }[];
  netRooms?: { id: string; floor?: string }[];
  openings?: { id: string; kind: string; exterior?: boolean }[];
  accents?: unknown[];
  outdoor?: {
    id?: string;
    type: string;
    role?: string;
    posts?: unknown[];
    grade?: { corners?: number[]; plane?: { z0: number; ox: number; oy: number; gx: number; gy: number } } | null;
    pool?: { waterZ: number; floorZ: number; copingTop: number } | null;
  }[];
  screens?: {
    id?: string;
    orient?: "h" | "v";
    at?: number;
    z0?: number;
    z1?: number;
    restDeg?: number;
    blades?: { count: number; chord: number; thickness: number; positions: number[] } | null;
  }[];
  outdoorUnit?: unknown;
  lightpipes?: unknown[];
  roofs?: { overhang?: number; ridgeHeight?: number }[];
}

export interface VerifyOptions {
  variant?: "high" | "lite";
  derived?: DerivedLike;
  tol?: number;
}
export interface VerifyResult { errors: string[]; warnings: string[]; analysis: Analysis }

/** Openings that get a glass node: exterior openings except garage doors (they have glazing or a side light). */
export function glazedOpenings(d: DerivedLike): string[] {
  return (d.openings ?? []).filter((o) => o.exterior && o.kind !== "garage").map((o) => o.id);
}

/** GLB role of the slab of an outdoor area: `derived.outdoor[].role`, or the legacy mapping of its type. */
export function slabRole(o: { type: string; role?: string }): string {
  return o.role ?? LEGACY_OUTDOOR_ROLE[o.type] ?? "terrace_paving";
}

export function verifyGlb(buf: Buffer, opts: VerifyOptions = {}): VerifyResult {
  const variant = opts.variant ?? "high";
  const tol = opts.tol ?? 0.02;
  const errors: string[] = [];
  const warnings: string[] = [];
  const glb = parseGlb(buf);
  const j = glb.json;
  const an = analyzeGlb(glb);
  const err = (m: string): void => void errors.push(m);

  // extensions
  for (const ext of ["KHR_draco_mesh_compression", "EXT_texture_webp"]) {
    if (!j.extensionsUsed?.includes(ext)) err(`extension ${ext} is not used`);
    if (!j.extensionsRequired?.includes(ext)) err(`extension ${ext} is not required`);
  }
  // nodes: extras, no transforms, no hierarchy
  const roleSet = new Set<string>(HOUSE_ROLES);
  const names = new Set<string>();
  const sceneNodes = new Set(j.scenes?.[j.scene ?? 0]?.nodes ?? []);
  (j.nodes ?? []).forEach((n, i) => {
    const label = `node ${i} (${n.name ?? "?"})`;
    if (n.matrix || n.translation || n.rotation || n.scale) err(`${label}: has a transform (transforms must be baked)`);
    if (n.children?.length) err(`${label}: has children (the house is a flat list of mesh nodes)`);
    if (n.mesh === undefined) return err(`${label}: no mesh`);
    if (!sceneNodes.has(i)) err(`${label}: not a root of the scene`);
    const ex = n.extras;
    if (!ex || typeof ex.role !== "string") return err(`${label}: extras.role is missing`);
    if (!roleSet.has(ex.role)) err(`${label}: unknown role "${ex.role}"`);
    if (ex.toggle !== undefined && (typeof ex.toggle !== "string" || !TOGGLES.includes(ex.toggle))) err(`${label}: bad extras.toggle`);
    if (ex.id !== undefined && typeof ex.id !== "string") err(`${label}: extras.id must be a string`);
    if (ROOF_REQUIRED.includes(ex.role) && ex.toggle !== "roof") err(`${label}: role ${ex.role} must have toggle "roof"`);
    if (ex.toggle === "roof" && !(ROOF_TOGGLE_ROLES as readonly string[]).includes(ex.role)) err(`${label}: role ${ex.role} must not have toggle "roof"`);
    const expect = ex.id === undefined ? ex.role : `${ex.role}_${String(ex.id)}`;
    if (n.name !== expect) err(`${label}: name should be "${expect}"`);
    if (n.name && names.has(n.name)) err(`${label}: duplicate node name`);
    if (n.name) names.add(n.name);
    // material = role
    const mesh = j.meshes?.[n.mesh];
    for (const p of mesh?.primitives ?? []) {
      const mat = p.material === undefined ? undefined : j.materials?.[p.material];
      if (!mat) err(`${label}: primitive without a material`);
      else if (mat.name !== ex.role) err(`${label}: material "${mat.name}" differs from the role "${ex.role}"`);
      if (!p.extensions?.KHR_draco_mesh_compression) err(`${label}: primitive is not Draco compressed`);
      const pos = j.accessors?.[p.attributes.POSITION];
      if (!pos?.min || !pos.max) err(`${label}: POSITION accessor has no min/max`);
      if (p.attributes.TEXCOORD_0 === undefined) err(`${label}: no UV set`);
    }
  });
  // materials: one per role, no ".001" suffixes
  const matNames = (j.materials ?? []).map((m) => m.name ?? "");
  if (new Set(matNames).size !== matNames.length) err("duplicate material names (one material per role)");
  for (const m of matNames) {
    if (/\.\d{3}$/.test(m)) err(`material "${m}" has a numeric suffix`);
    if (!roleSet.has(m)) err(`material "${m}" is not a house role`);
  }

  // budgets
  const b = BUDGETS[variant];
  if (an.size > b.bytes) err(`file size ${an.size} B exceeds the ${variant} budget ${b.bytes} B`);
  if (an.triangles > b.triangles) err(`${an.triangles} triangles exceed the ${variant} budget ${b.triangles}`);
  for (const im of an.imageSizes) {
    if (Math.max(im.w, im.h) > b.texturePx) err(`texture ${im.name} is ${im.w}x${im.h}, above ${b.texturePx}`);
  }
  if ((j.images ?? []).some((im) => im.mimeType !== "image/webp")) err("every texture must be WebP");

  // data checks
  const d = opts.derived;
  if (d) {
    const have = (r: string): boolean => (an.roles[r]?.nodes ?? 0) > 0;
    const need: string[] = ["plaster", "plaster_in", "slab", "frame", "glass", "ceiling", "roof_tile", "ridge_cap", "fascia", "gutter", "soffit"];
    const floors = new Set((d.netRooms ?? d.rooms ?? []).map((r) => r.floor).filter((f): f is string => !!f));
    for (const f of floors) need.push(`floor_${f}`);
    // interior doors are "door_leaf" (light); the entrance leaf is built in the dark "frame" role (always required above)
    if ((d.openings ?? []).some((o) => o.kind === "door")) need.push("door_leaf");
    const garages = (d.openings ?? []).filter((o) => o.kind === "garage");
    if (garages.length) need.push("frame", "garage_door");
    if ((d.accents ?? []).length) need.push("wood_cladding");
    if ((d.screens ?? []).length) need.push("screen_slats", "screen_rail");
    if (d.outdoorUnit) need.push("equipment");
    for (const o of d.outdoor ?? []) {
      need.push(slabRole(o));
      if (o.posts?.length) need.push("post");
      if (o.pool) need.push("pool_coping", "pool_liner", "water");
    }
    for (const r of new Set(need)) if (!have(r)) err(`no node with role ${r}`);

    // node ids: the garage door leaf per garage opening (the web opens it), one slab node per outdoor area
    const byName = new Map(an.nodes.map((n) => [n.name, n]));
    for (const g of garages) if (!byName.has(`garage_door_${g.id}`)) err(`no garage_door node for opening ${g.id}`);
    for (const o of d.outdoor ?? []) {
      if (!o.id) continue;
      const node = byName.get(`${slabRole(o)}_${o.id}`);
      if (!node) {
        err(`no ${slabRole(o)} node for outdoor area ${o.id}`);
        continue;
      }
      // slab tops come from the derived grade (never a constant of the builder): the highest point is the highest corner
      if (o.pool) {
        const water = byName.get(`water_${o.id}`);
        const liner = byName.get(`pool_liner_${o.id}`);
        if (Math.abs(node.box.max[2] - o.pool.copingTop) > tol) err(`coping of ${o.id} tops out at ${node.box.max[2].toFixed(3)}, derived copingTop ${o.pool.copingTop}`);
        if (!water || Math.abs(water.box.min[2] - o.pool.waterZ) > tol || Math.abs(water.box.max[2] - o.pool.waterZ) > tol) err(`water of ${o.id} is not at waterZ ${o.pool.waterZ}`);
        if (!liner || Math.abs(liner.box.min[2] - o.pool.floorZ) > tol) err(`pool floor of ${o.id} is not at floorZ ${o.pool.floorZ}`);
      } else if (o.grade?.corners?.length) {
        const top = Math.max(...o.grade.corners);
        if (Math.abs(node.box.max[2] - top) > tol) err(`slab ${o.id} tops out at ${node.box.max[2].toFixed(3)}, its derived grade at ${top}`);
      }
    }
    for (const sc of d.screens ?? []) {
      const rail = sc.id ? byName.get(`screen_rail_${sc.id}`) : undefined;
      if (!rail) {
        err(`no screen_rail node for screen ${sc.id ?? "?"}`);
        continue;
      }
      if (sc.z0 !== undefined && Math.abs(rail.box.min[2] - sc.z0) > tol) err(`louvre rails of ${sc.id} start at ${rail.box.min[2].toFixed(3)}, derived z0 ${sc.z0}`);
      if (sc.z1 !== undefined && Math.abs(rail.box.max[2] - sc.z1) > tol) err(`louvre rails of ${sc.id} end at ${rail.box.max[2].toFixed(3)}, derived z1 ${sc.z1}`);
    }
    for (const r of Object.keys(an.roles)) if (r.startsWith("floor_") && !floors.has(r.slice(6))) err(`floor role ${r} is not used by any room`);

    // glazing: one glass node per glazed opening
    const want = glazedOpenings(d);
    const glass = an.nodes.filter((n) => n.role === "glass");
    if (glass.length !== want.length) err(`${glass.length} glass nodes for ${want.length} glazed openings`);
    const ids = new Set(glass.map((n) => n.id));
    for (const id of want) if (!ids.has(id)) err(`no glass node for opening ${id}`);
    if (ids.size !== glass.length) err("two glass nodes share an id");

    // size: exterior walls = outline box; roof covering = eave box; ridge height
    const ob = d.outline?.bbox;
    if (ob) {
      const pl = an.nodes.filter((n) => n.role === "plaster");
      const box = emptyBox();
      for (const n of pl) grow(box, n.box.min, n.box.max);
      const got = [box.min[0], box.min[1], box.max[0], box.max[1]];
      const exp = [ob.x0, ob.y0, ob.x1, ob.y1];
      if (got.some((v, i) => Math.abs(v - exp[i]) > tol)) err(`plaster box [${got.map((v) => v.toFixed(3))}] differs from the outline [${exp}]`);
    }
    const bb = d.bbox;
    if (bb) {
      const rt = an.nodes.filter((n) => n.role === "roof_tile");
      const box = emptyBox();
      for (const n of rt) grow(box, n.box.min, n.box.max);
      const got = [box.min[0], box.min[1], box.max[0], box.max[1], box.max[2]];
      const exp = [bb.x0, bb.y0, bb.x1, bb.y1, bb.z1];
      const names5 = ["x0", "y0", "x1", "y1", "ridge height"];
      got.forEach((v, i) => {
        if (Math.abs(v - exp[i]) > tol) err(`roof covering ${names5[i]} is ${v.toFixed(3)}, derived says ${exp[i].toFixed(3)}`);
      });
    }
    const ridge = Math.max(...(d.roofs ?? []).map((r) => r.ridgeHeight ?? 0));
    if (ridge > 0 && bb && Math.abs(ridge - bb.z1) > tol) warnings.push(`derived ridge height ${ridge} differs from bbox.z1 ${bb.z1}`);
  } else {
    warnings.push("no derived.json given: data checks skipped");
  }
  return { errors, warnings, analysis: an };
}

// ---------------------------------------------------------------------------------------------------------------------
// Decoded geometry
interface DracoArray { GetValue(i: number): number }
interface DracoMesh { num_points(): number }
interface DracoDecoder {
  DecodeBufferToMesh(buf: unknown, mesh: DracoMesh): { ok(): boolean; error_msg(): string };
  GetAttributeByUniqueId(mesh: DracoMesh, id: number): unknown;
  GetAttributeFloatForAllPoints(mesh: DracoMesh, att: unknown, out: DracoArray): boolean;
}
export interface DracoModule {
  Decoder: new () => DracoDecoder;
  DecoderBuffer: new () => { Init(data: Int8Array, size: number): void };
  Mesh: new () => DracoMesh;
  DracoFloat32Array: new () => DracoArray;
  destroy(o: unknown): void;
}
const dracoCache = new Map<string, Promise<DracoModule>>();

/** The Draco decoder of the web (`public/draco/draco_decoder.js`, the plain JS build), loaded once per path. */
export function loadDraco(decoderPath: string): Promise<DracoModule> {
  let hit = dracoCache.get(decoderPath);
  if (!hit) {
    const factory = createRequire(decoderPath)(decoderPath) as (o: object) => Promise<DracoModule>;
    hit = factory({});
    dracoCache.set(decoderPath, hit);
  }
  return hit;
}

/** Vertex positions of a mesh node in the house frame (x east, y north, z up), over all its primitives. */
export function nodePositions(draco: DracoModule, glb: Glb, nodeIndex: number): Vec3[] {
  const j = glb.json;
  const node = j.nodes?.[nodeIndex];
  const mesh = node?.mesh === undefined ? undefined : j.meshes?.[node.mesh];
  const out: Vec3[] = [];
  for (const p of mesh?.primitives ?? []) {
    const ext = p.extensions?.KHR_draco_mesh_compression as { bufferView: number; attributes: Record<string, number> } | undefined;
    if (!ext || !glb.bin) throw new Error(`node ${nodeIndex}: not a Draco primitive`);
    const bv = j.bufferViews?.[ext.bufferView];
    if (!bv) throw new Error(`node ${nodeIndex}: missing buffer view`);
    const data = glb.bin.subarray(bv.byteOffset ?? 0, (bv.byteOffset ?? 0) + bv.byteLength);
    const dec = new draco.Decoder();
    const buf = new draco.DecoderBuffer();
    const dm = new draco.Mesh();
    const arr = new draco.DracoFloat32Array();
    try {
      buf.Init(new Int8Array(data.buffer, data.byteOffset, data.byteLength), data.byteLength);
      const st = dec.DecodeBufferToMesh(buf, dm);
      if (!st.ok()) throw new Error(`node ${nodeIndex}: ${st.error_msg()}`);
      dec.GetAttributeFloatForAllPoints(dm, dec.GetAttributeByUniqueId(dm, ext.attributes.POSITION), arr);
      const n = dm.num_points();
      for (let i = 0; i < n; i++) out.push([arr.GetValue(3 * i), 0 - arr.GetValue(3 * i + 2), arr.GetValue(3 * i + 1)]);
    } finally {
      for (const o of [arr, dm, buf, dec]) draco.destroy(o);
    }
  }
  return out;
}

type OutdoorLike = NonNullable<DerivedLike["outdoor"]>[number];
/** Height of the derived slab top of an outdoor area at a plan point (the coping top for a pool). */
export function slabTopAt(o: OutdoorLike, x: number, y: number): number {
  if (o.pool) return o.pool.copingTop;
  const pl = o.grade?.plane;
  if (!pl) return Math.max(...(o.grade?.corners ?? [0]));
  return pl.z0 + pl.gx * (x - pl.ox) + pl.gy * (y - pl.oy);
}

/** The decoded slab node of every outdoor area: all its vertices and the ones on the derived top. */
export function slabVertices(draco: DracoModule, glb: Glb, d: DerivedLike, tol = 0.003): { id: string; role: string; all: Vec3[]; top: Vec3[] }[] {
  const index = new Map((glb.json.nodes ?? []).map((n, i) => [n.name ?? "", i]));
  const out: { id: string; role: string; all: Vec3[]; top: Vec3[] }[] = [];
  for (const o of d.outdoor ?? []) {
    if (!o.id) continue;
    const i = index.get(`${slabRole(o)}_${o.id}`);
    if (i === undefined) continue;
    const all = nodePositions(draco, glb, i);
    out.push({ id: o.id, role: slabRole(o), all, top: all.filter((v) => Math.abs(v[2] - slabTopAt(o, v[0], v[1])) <= tol) });
  }
  return out;
}

/** Plan extent of a blade across its wall at a rotation `deg` from the wall plane. */
export function bladeDepth(chord: number, thickness: number, deg: number): number {
  const a = (deg * Math.PI) / 180;
  return chord * Math.abs(Math.sin(a)) + thickness * Math.abs(Math.cos(a));
}

/**
 * Checks of the decoded geometry against derived.json: every slab top lies on its derived grade (nothing of the slab
 * node rises above it), and the louvre blades stand on their pivots (`screens[].blades.positions`, `at`) at the rest angle.
 */
export function verifyGeometry(glb: Glb, d: DerivedLike, draco: DracoModule, tol = 0.003): string[] {
  const errors: string[] = [];
  for (const s of slabVertices(draco, glb, d, tol)) {
    const o = (d.outdoor ?? []).find((q) => q.id === s.id)!;
    const above = s.all.filter((v) => v[2] > slabTopAt(o, v[0], v[1]) + tol);
    if (above.length) errors.push(`slab ${s.id}: ${above.length} vertices above its derived top`);
    if (s.top.length < 3) errors.push(`slab ${s.id}: no face on its derived top`);
  }
  const index = new Map((glb.json.nodes ?? []).map((n, i) => [n.name ?? "", i]));
  for (const sc of d.screens ?? []) {
    const bl = sc.blades;
    const i = sc.id ? index.get(`screen_slats_${sc.id}`) : undefined;
    if (!bl || i === undefined || sc.at === undefined || sc.restDeg === undefined) continue;
    const v = nodePositions(draco, glb, i);
    const along = (p: Vec3): number => (sc.orient === "v" ? p[1] : p[0]);
    const across = (p: Vec3): number => (sc.orient === "v" ? p[0] : p[1]);
    const groups = new Map<number, Vec3[]>();
    for (const p of v) {
      let best = 0;
      for (let k = 1; k < bl.positions.length; k++) if (Math.abs(along(p) - bl.positions[k]) < Math.abs(along(p) - bl.positions[best])) best = k;
      const g = groups.get(best) ?? [];
      g.push(p);
      groups.set(best, g);
    }
    if (groups.size !== bl.positions.length) errors.push(`louvres ${sc.id}: ${groups.size} blades for ${bl.positions.length} pivots`);
    const depth = bladeDepth(bl.chord, bl.thickness, sc.restDeg);
    for (const [k, g] of groups) {
      const lo = Math.min(...g.map(across)), hi = Math.max(...g.map(across));
      const ca = g.reduce((s, p) => s + along(p), 0) / g.length;
      const cx = (lo + hi) / 2;
      if (Math.abs(ca - bl.positions[k]) > tol || Math.abs(cx - sc.at) > tol) {
        errors.push(`louvres ${sc.id}: blade ${k} is not on its pivot (${bl.positions[k]}, ${sc.at})`);
        break;
      }
      if (Math.abs(hi - lo - depth) > tol) {
        errors.push(`louvres ${sc.id}: blade ${k} is ${(hi - lo).toFixed(3)} m deep across the wall, ${depth.toFixed(3)} at the rest angle ${sc.restDeg} deg`);
        break;
      }
    }
  }
  return errors;
}

// ---------------------------------------------------------------------------------------------------------------------
async function main(): Promise<number> {
  const args = process.argv.slice(2);
  const file = args.find((a) => !a.startsWith("--") && args[args.indexOf(a) - 1] !== "--derived");
  if (!file) {
    console.error("usage: tsx scripts/verify-glb.ts <file.glb> [--lite] [--derived generated/derived.json]");
    return 2;
  }
  const di = args.indexOf("--derived");
  const root = path.resolve(path.dirname(process.argv[1] ?? "."), "..");
  const derivedPath = di >= 0 ? args[di + 1] : path.join(root, "generated", "derived.json");
  let buf: Buffer;
  try {
    buf = fs.readFileSync(file);
  } catch (e) {
    console.error(`cannot read ${file}: ${(e as Error).message}`);
    return 2;
  }
  const derived = fs.existsSync(derivedPath) ? (JSON.parse(fs.readFileSync(derivedPath, "utf8")) as DerivedLike) : undefined;
  const variant = args.includes("--lite") ? "lite" : "high";
  let res: VerifyResult;
  try {
    res = verifyGlb(buf, { variant, derived });
  } catch (e) {
    console.error(`${file}: ${(e as Error).message}`);
    return 1;
  }
  if (derived && !args.includes("--no-geometry")) {
    try {
      const draco = await loadDraco(path.join(root, "public", "draco", "draco_decoder.js"));
      res.errors.push(...verifyGeometry(parseGlb(buf), derived, draco));
    } catch (e) {
      res.errors.push(`geometry checks failed: ${(e as Error).message}`);
    }
  }
  const a = res.analysis;
  console.log(`${path.basename(file)} (${variant}): ${a.size} B, ${a.nodes.length} nodes, ${a.triangles} triangles`);
  for (const w of res.warnings) console.log(`  warning: ${w}`);
  for (const e of res.errors) console.log(`  ERROR: ${e}`);
  console.log(res.errors.length ? `FAILED (${res.errors.length} errors)` : "OK");
  return res.errors.length ? 1 : 0;
}

if (process.argv[1] && /verify-glb\.[cm]?[jt]s$/.test(process.argv[1])) void main().then((code) => process.exit(code));
