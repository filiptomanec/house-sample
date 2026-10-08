// GLB assets of the house: file names per tier, cache-busted URLs from the manifest, the node contract and the loaders.
// Contract: docs/ARCHITECTURE.md section 3. The files are written by the Blender pipeline into public/models/.
import type * as THREE from "three";
import type { GLTF, GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import type { DRACOLoader } from "three/addons/loaders/DRACOLoader.js";
import manifestJson from "../../../public/models/manifest.json";
import { shortHash } from "@/lib/model/hash";
import { TIER_SETTINGS, detectTier, type Tier } from "./tier";
import type { Vec3 } from "./frame";

// ------------------------------------------------------------------------------------------------ manifest

export interface ModelFileInfo {
  sha256: string;
  bytes: number;
  triangles?: number;
  nodes?: number;
  /** Bounding box in the HOUSE frame (x east, y north, z up), as written by the pipeline; convert with `toScene` for the scene. */
  bbox?: { min: Vec3; max: Vec3 };
}

/** `public/models/manifest.json` (schema "models/1"). */
export interface ModelManifest {
  schema: "models/1";
  frame: string;
  /** Hash of model/*.json the files were built from. */
  inputHash: string;
  hash: string;
  files: Record<string, ModelFileInfo>;
}

/** The manifest of the build, bundled with the code (so URLs and files always belong together; no extra request). */
export const MODEL_MANIFEST = manifestJson as unknown as ModelManifest;

/** Where the shared Draco decoder lives (public/draco/). */
export const DRACO_PATH = "/draco/";

/** The files of the contract, by purpose and tier. */
export const MODEL_FILES = {
  house: { high: "house.glb", low: "house-lite.glb" },
  furniture: { high: "furniture.glb", low: "furniture-lite.glb" },
  footprints: "furniture-footprints.json",
  ar: "house.usdz",
} as const;

/** File name of the house or furniture GLB for a tier. */
export const modelFile = (kind: "house" | "furniture", tier: Tier): string => MODEL_FILES[kind][tier];

export type GlbErrorKind = "network" | "parse" | "contract" | "aborted";

/** Every failure of the asset layer; the UI shows one message and a retry button whatever the kind. */
export class GlbError extends Error {
  constructor(message: string, readonly file: string, readonly kind: GlbErrorKind, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "GlbError";
  }
}

/** Manifest entry of a file; throws a `contract` GlbError when the manifest does not know it. */
export function modelInfo(file: string, manifest: ModelManifest = MODEL_MANIFEST): ModelFileInfo {
  const info = manifest.files[file];
  if (!info) throw new GlbError(`"${file}" is not in the models manifest`, file, "contract");
  return info;
}

/** URL of a model file with the content hash as cache-buster: `/models/house.glb?v=1a2b3c4d5e6f`. Immutable per hash. */
export function modelUrl(file: string, manifest: ModelManifest = MODEL_MANIFEST): string {
  return `/models/${file}?v=${shortHash(modelInfo(file, manifest).sha256)}`;
}

// ------------------------------------------------------------------------------------------------ node contract

export const GLB_TOGGLES = ["roof", "furniture"] as const;
export type GlbToggle = (typeof GLB_TOGGLES)[number];

/**
 * `userData` of every mesh node (glTF `extras`, which three.js copies to `object.userData`). House nodes carry
 * `role` (equals the material name), optional `toggle` and optional `id` (id of the room, opening, outdoor area or
 * cladding strip the mesh belongs to: a join key into `derived`, never a condition). Furniture nodes carry `role`
 * (the material), `toggle: "furniture"` and `roomId` (`terrace` for the terrace set).
 */
export interface GlbNodeExtras {
  role: string;
  toggle?: GlbToggle;
  id?: string;
  roomId?: string;
}

/**
 * Material roles of house.glb (docs/ARCHITECTURE.md section 3, contract C2). `lawn` and `mulch` are generated in JS, not in
 * the GLB. Since R2: `deck`, `pool_coping`, `pool_liner`, `water` (the web swaps in its own material), `garage_door`,
 * `screen_rail` (the louvre rails; only `screen_slats` is replaced by the movable blades) and `equipment`.
 */
export const HOUSE_ROLES = [
  "plaster", "wood_cladding", "frame", "glass", "sill", "soffit", "fascia", "gutter", "roof_tile", "ridge_cap", "ceiling", "plaster_in",
  "door_leaf", "slab", "floor_oak", "floor_tile", "floor_stone", "floor_concrete", "terrace_paving", "drive_paving", "path", "gravel", "post", "screen_slats",
  "deck", "pool_coping", "pool_liner", "water", "garage_door", "screen_rail", "equipment",
] as const;
export type HouseRole = (typeof HOUSE_ROLES)[number];

const GROUND_EXTRA = new Set<string>(["slab", "terrace_paving", "drive_paving", "path", "gravel", "deck", "pool_coping"]);
/** Roles a person can stand on: floors, paving, path, gravel, the slab, the deck and the pool coping. Used by the walk and for planting. */
export const isGroundRole = (role: string): boolean => role.startsWith("floor_") || GROUND_EXTRA.has(role);

const NO_OCCLUSION = new Set<string>(["glass", "water", "screen_slats"]);
/** Roles that block direct sun in the analysis: everything except glass and water (the louvre blades are handled by their own module). */
export const isOccluderRole = (role: string): boolean => !NO_OCCLUSION.has(role);

/** Roles the Roof switch hides are marked by `toggle: "roof"` in the file, not listed here. */
export const roleOf = (node: THREE.Object3D): string | undefined => (node.userData as Partial<GlbNodeExtras>).role;

// ------------------------------------------------------------------------------------------------ loading

export interface LoadProgress {
  file: string;
  loaded: number;
  /** Size from the manifest (the server may not report a length for compressed responses). */
  total: number;
  /** 0..1. */
  fraction: number;
}

export interface LoadOptions {
  onProgress?: (p: LoadProgress) => void;
  signal?: AbortSignal;
  /** Sets the number of Draco workers when the decoder is created (default: `detectTier()`). */
  tier?: Tier;
}

// One Draco decoder serves every GLB (house, furniture, plants): the decoder files are fetched and compiled once and loads
// that follow each other share its workers. When nothing has been loading for `idleDecoderMs` the workers go (phones need
// the memory); a later load starts a new decoder. This is the only module-level state of the engine.
interface Decoder {
  gltf: GLTFLoader;
  draco: DRACOLoader;
}
let decoder: Promise<Decoder> | null = null;
let decoderBusy = 0;
let decoderIdle: ReturnType<typeof setTimeout> | undefined;

function createDecoder(tier: Tier): Promise<Decoder> {
  return Promise.all([import("three/addons/loaders/GLTFLoader.js"), import("three/addons/loaders/DRACOLoader.js")]).then(([g, d]) => {
    const draco = new d.DRACOLoader();
    draco.setDecoderPath(DRACO_PATH);
    draco.setWorkerLimit(TIER_SETTINGS[tier].dracoWorkers);
    return { gltf: new g.GLTFLoader().setDRACOLoader(draco), draco };
  });
}

/** Releases the Draco workers now (otherwise after the idle time). */
export const releaseDecoder = (): void => {
  clearTimeout(decoderIdle);
  const d = decoder;
  decoder = null;
  d?.then((x) => x.draco.dispose()).catch(() => undefined);
};

async function withDecoder<T>(tier: Tier, run: (d: Decoder) => Promise<T>): Promise<T> {
  clearTimeout(decoderIdle);
  decoderBusy++;
  try {
    decoder ??= createDecoder(tier);
    return await run(await decoder);
  } finally {
    if (--decoderBusy === 0) decoderIdle = setTimeout(releaseDecoder, TIER_SETTINGS[tier].idleDecoderMs);
  }
}

const isAbort = (e: unknown): boolean => e instanceof DOMException && e.name === "AbortError";

function abortedError(file: string): GlbError {
  return new GlbError(`loading "${file}" was aborted`, file, "aborted");
}

/** Fetches a file of the models folder and reports bytes against the manifest size. */
async function fetchBytes(file: string, opts: LoadOptions): Promise<ArrayBuffer> {
  const url = modelUrl(file);
  const total = modelInfo(file).bytes;
  const report = (loaded: number) => opts.onProgress?.({ file, loaded, total, fraction: total > 0 ? Math.min(1, loaded / total) : 1 });
  try {
    const res = await fetch(url, { signal: opts.signal });
    if (!res.ok) throw new GlbError(`"${file}" could not be loaded (HTTP ${res.status})`, file, "network");
    if (!res.body) {
      const buf = await res.arrayBuffer();
      report(buf.byteLength);
      return buf;
    }
    const reader = res.body.getReader();
    const chunks: Uint8Array[] = [];
    let loaded = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      loaded += value.byteLength;
      report(loaded);
    }
    const out = new Uint8Array(loaded);
    let at = 0;
    for (const c of chunks) { out.set(c, at); at += c.byteLength; }
    return out.buffer;
  } catch (e) {
    if (e instanceof GlbError) throw e;
    if (isAbort(e) || opts.signal?.aborted) throw abortedError(file);
    throw new GlbError(`"${file}" could not be loaded`, file, "network", { cause: e });
  }
}

/**
 * Fetches and parses a GLB of the models folder with the shared Draco decoder (`DRACO_PATH`). One decoder serves all
 * loads; its workers are released `TIER_SETTINGS.idleDecoderMs` after the last load (phones need the memory).
 * Parsed scenes are NOT cached (a scene is owned by exactly one HouseScene and disposed with it); the HTTP cache serves the
 * bytes (immutable URL per content hash). Rejects with a GlbError.
 */
export async function loadGltf(file: string, opts: LoadOptions = {}): Promise<GLTF> {
  if (opts.signal?.aborted) throw abortedError(file);
  const bytes = await fetchBytes(file, opts);
  if (opts.signal?.aborted) throw abortedError(file);
  const gltf = await withDecoder(opts.tier ?? detectTier(), (d) => d.gltf.parseAsync(bytes, "/models/")).catch((e: unknown) => {
    throw new GlbError(`"${file}" could not be parsed`, file, "parse", { cause: e });
  });
  if (opts.signal?.aborted) throw abortedError(file);
  return gltf;
}

export const loadHouseGltf = (tier: Tier, opts: LoadOptions = {}): Promise<GLTF> => loadGltf(modelFile("house", tier), { tier, ...opts });
export const loadFurnitureGltf = (tier: Tier, opts: LoadOptions = {}): Promise<GLTF> => loadGltf(modelFile("furniture", tier), { tier, ...opts });

/** `public/models/furniture-footprints.json`: collision boxes of floor-standing furniture (walk mode). */
export interface FurnitureFootprint {
  id: string;
  type: string;
  kind: string;
  room: string;
  /** [x0, y0, x1, y1], house frame, metres. */
  box: [number, number, number, number];
  /** Height of the highest part in the body zone, m. */
  h: number;
}
export interface FurnitureFootprints {
  schema: "furniture-footprints/1";
  /** Hash of the furniture, rooms and openings the boxes were computed from (not of the whole data model). */
  inputHash: string;
  units: "m";
  items: FurnitureFootprint[];
}
export async function loadFootprints(opts: LoadOptions = {}): Promise<FurnitureFootprints> {
  const file = MODEL_FILES.footprints;
  if (opts.signal?.aborted) throw abortedError(file);
  try {
    const res = await fetch(modelUrl(file), { signal: opts.signal });
    if (!res.ok) throw new GlbError(`"${file}" could not be loaded (HTTP ${res.status})`, file, "network");
    const json = (await res.json()) as FurnitureFootprints;
    if (json.schema !== "furniture-footprints/1" || !Array.isArray(json.items)) throw new GlbError(`"${file}" has an unknown format`, file, "contract");
    return json;
  } catch (e) {
    if (e instanceof GlbError) throw e;
    if (isAbort(e) || opts.signal?.aborted) throw abortedError(file);
    throw new GlbError(`"${file}" could not be loaded`, file, "network", { cause: e });
  }
}

/** Result of checking a loaded house scene against the node contract. */
export interface ContractReport {
  ok: boolean;
  /** Human-readable problems (English; for the console and tests). */
  problems: string[];
  /** Number of meshes per role. */
  roles: Record<string, number>;
}

/** `userData` of a node or, for meshes without their own, of the nearest ancestor that has any (a multi-primitive node becomes a group). */
export function extrasOf(node: THREE.Object3D): Partial<GlbNodeExtras> {
  for (let o: THREE.Object3D | null = node; o; o = o.parent) {
    const u = o.userData as Partial<GlbNodeExtras>;
    if (u.role !== undefined || u.toggle !== undefined || u.id !== undefined || u.roomId !== undefined) return u;
  }
  return {};
}

/**
 * Checks that every mesh has `userData.role` equal to its material name, that roles are known, that no material name has a
 * numeric suffix and that every `toggle` is one of `GLB_TOGGLES`. The engine runs it after loading (warns in production,
 * throws a `contract` GlbError in development and in tests).
 */
export function checkHouseContract(root: THREE.Object3D): ContractReport {
  const problems: string[] = [];
  const roles: Record<string, number> = {};
  const known = new Set<string>(HOUSE_ROLES);
  const toggles = new Set<string>(GLB_TOGGLES);
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const label = o.name || "(unnamed mesh)";
    const x = extrasOf(o);
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    if (!x.role) { problems.push(`${label}: no role in extras`); return; }
    roles[x.role] = (roles[x.role] ?? 0) + 1;
    if (!known.has(x.role)) problems.push(`${label}: unknown role "${x.role}"`);
    if (x.toggle !== undefined && !toggles.has(x.toggle)) problems.push(`${label}: unknown toggle "${String(x.toggle)}"`);
    for (const m of mats) {
      if (/\.\d+$/.test(m.name)) problems.push(`${label}: material "${m.name}" has a numeric suffix`);
      if (m.name !== x.role) problems.push(`${label}: material "${m.name}" differs from role "${x.role}"`);
    }
  });
  if (!Object.keys(roles).length) problems.push("the scene has no meshes with a role");
  return { ok: problems.length === 0, problems, roles };
}

/** Collects the progress of several loads into one 0..1 value, weighted by bytes. */
export interface ProgressGroup {
  /** Returns the `onProgress` callback for one file of the group. */
  track(file: string): (p: LoadProgress) => void;
  /** Total fraction 0..1. */
  readonly fraction: number;
}
export function createProgressGroup(files: readonly string[], onChange: (fraction: number) => void): ProgressGroup {
  const weight = new Map<string, number>(files.map((f) => [f, MODEL_MANIFEST.files[f]?.bytes ?? 1]));
  const done = new Map<string, number>(files.map((f) => [f, 0]));
  const sum = [...weight.values()].reduce((a, b) => a + b, 0) || 1;
  const value = () => [...weight].reduce((a, [f, w]) => a + w * (done.get(f) ?? 0), 0) / sum;
  return {
    track(file) {
      return (p) => {
        if (!weight.has(file)) return;
        done.set(file, Math.max(0, Math.min(1, p.fraction)));
        onChange(value());
      };
    },
    get fraction() { return value(); },
  };
}
