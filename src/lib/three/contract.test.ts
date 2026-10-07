import { readFileSync } from "node:fs";
import { join } from "node:path";
import * as THREE from "three";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GlbError, MODEL_FILES, MODEL_MANIFEST, checkHouseContract, createProgressGroup, extrasOf, loadFootprints, loadGltf } from "./glb";

const models = join(__dirname, "..", "..", "..", "public", "models");

interface GltfJson {
  nodes: { name?: string; mesh?: number; extras?: Record<string, unknown> }[];
  materials: { name?: string }[];
  meshes: { primitives: { material?: number }[] }[];
}
function readGlb(file: string): GltfJson {
  const b = readFileSync(join(models, file));
  const len = b.readUInt32LE(12);
  return JSON.parse(b.subarray(20, 20 + len).toString("utf8")) as GltfJson;
}

/** A scene of empty meshes with the extras and material names of a GLB (what GLTFLoader makes of it, without the geometry). */
function sceneOf(json: GltfJson): THREE.Group {
  const root = new THREE.Group();
  const materials = new Map<number, THREE.MeshStandardMaterial>();
  for (const n of json.nodes) {
    if (n.mesh === undefined) continue;
    const mi = json.meshes[n.mesh].primitives[0].material!;
    if (!materials.has(mi)) materials.set(mi, new THREE.MeshStandardMaterial({ name: json.materials[mi].name }));
    const mesh = new THREE.Mesh(new THREE.BufferGeometry(), materials.get(mi));
    mesh.name = n.name ?? "";
    mesh.userData = { ...n.extras };
    root.add(mesh);
  }
  return root;
}
const meshOf = (role: string | undefined, material: string, extras: Record<string, unknown> = {}) => {
  const m = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshStandardMaterial({ name: material }));
  m.name = `${role}-${material}`;
  m.userData = role === undefined ? { ...extras } : { role, ...extras };
  return m;
};

describe("checkHouseContract", () => {
  for (const file of [MODEL_FILES.house.high, MODEL_FILES.house.low]) {
    it(`accepts the committed ${file} as the loader would present it`, () => {
      const report = checkHouseContract(sceneOf(readGlb(file)));
      expect(report.problems).toEqual([]);
      expect(report.ok).toBe(true);
      expect(Object.keys(report.roles).length).toBeGreaterThan(10);
      expect(report.roles.glass).toBeGreaterThan(0);
    });
  }

  it("reports a mesh without a role", () => {
    const g = new THREE.Group();
    g.add(meshOf(undefined, "plaster"));
    expect(checkHouseContract(g).problems.join()).toMatch(/no role/);
  });

  it("reports a role the contract does not know", () => {
    const g = new THREE.Group();
    g.add(meshOf("marble", "marble"));
    const r = checkHouseContract(g);
    expect(r.ok).toBe(false);
    expect(r.problems.join()).toMatch(/unknown role "marble"/);
  });

  it("reports a material whose name differs from the role, and one with a numeric suffix", () => {
    const g = new THREE.Group();
    g.add(meshOf("plaster", "frame"));
    g.add(meshOf("frame", "frame.001"));
    const text = checkHouseContract(g).problems.join("\n");
    expect(text).toMatch(/differs from role/);
    expect(text).toMatch(/numeric suffix/);
  });

  it("reports an unknown toggle and accepts the known ones", () => {
    const bad = new THREE.Group();
    bad.add(meshOf("plaster", "plaster", { toggle: "walls" }));
    expect(checkHouseContract(bad).problems.join()).toMatch(/unknown toggle "walls"/);
    const good = new THREE.Group();
    good.add(meshOf("roof_tile", "roof_tile", { toggle: "roof" }));
    expect(checkHouseContract(good).ok).toBe(true);
  });

  it("fails an empty scene", () => {
    expect(checkHouseContract(new THREE.Group()).ok).toBe(false);
  });

  it("finds the extras of a mesh on its parent when a node with several primitives became a group", () => {
    const parent = new THREE.Group();
    parent.userData = { role: "plaster", id: "A1" };
    const child = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshStandardMaterial({ name: "plaster" }));
    parent.add(child);
    expect(extrasOf(child)).toEqual({ role: "plaster", id: "A1" });
    const root = new THREE.Group();
    root.add(parent);
    expect(checkHouseContract(root).ok).toBe(true);
  });
});

describe("createProgressGroup", () => {
  const [a, b] = [MODEL_FILES.house.low, MODEL_FILES.furniture.low];
  const wa = MODEL_MANIFEST.files[a].bytes, wb = MODEL_MANIFEST.files[b].bytes;
  const p = (file: string, fraction: number) => ({ file, loaded: 0, total: 0, fraction });

  it("weights the files by their size in the manifest and reports through the callback", () => {
    const seen: number[] = [];
    const g = createProgressGroup([a, b], (f) => seen.push(f));
    g.track(a)(p(a, 1));
    expect(g.fraction).toBeCloseTo(wa / (wa + wb), 12);
    g.track(b)(p(b, 0.5));
    expect(g.fraction).toBeCloseTo((wa + wb * 0.5) / (wa + wb), 12);
    g.track(b)(p(b, 1));
    expect(g.fraction).toBeCloseTo(1, 12);
    expect(seen).toHaveLength(3);
    for (let i = 1; i < seen.length; i++) expect(seen[i]).toBeGreaterThanOrEqual(seen[i - 1]);
  });

  it("clamps garbage and ignores files that are not in the group", () => {
    const g = createProgressGroup([a], () => undefined);
    g.track(a)(p(a, 7));
    expect(g.fraction).toBe(1);
    g.track(a)(p(a, -3));
    expect(g.fraction).toBe(0);
    g.track(b)(p(b, 1));
    expect(g.fraction).toBe(0);
  });
});

describe("loading failures are GlbErrors", () => {
  afterEach(() => vi.unstubAllGlobals());
  const failure = async (promise: Promise<unknown>): Promise<GlbError> => {
    try { await promise; } catch (e) { return e as GlbError; }
    throw new Error("expected a rejection");
  };

  it("an HTTP error is a network error that names the file", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("nope", { status: 404 })));
    const e = await failure(loadGltf(MODEL_FILES.house.low));
    expect(e).toBeInstanceOf(GlbError);
    expect(e.kind).toBe("network");
    expect(e.file).toBe(MODEL_FILES.house.low);
  });

  it("a rejected fetch is a network error, an aborted one is of kind aborted", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("failed to fetch"); }));
    expect((await failure(loadGltf(MODEL_FILES.house.low))).kind).toBe("network");
    const ctl = new AbortController();
    ctl.abort();
    expect((await failure(loadGltf(MODEL_FILES.house.low, { signal: ctl.signal }))).kind).toBe("aborted");
  });

  it("a file the manifest does not list is a contract error before any request is made", async () => {
    const f = vi.fn();
    vi.stubGlobal("fetch", f);
    const e = await failure(loadGltf("ghost.glb"));
    expect(e.kind).toBe("contract");
    expect(f).not.toHaveBeenCalled();
  });

  it("loads the furniture footprints and rejects a document of another format", async () => {
    const real = readFileSync(join(models, MODEL_FILES.footprints), "utf8");
    vi.stubGlobal("fetch", vi.fn(async () => new Response(real)));
    const fp = await loadFootprints();
    expect(fp.schema).toBe("furniture-footprints/1");
    expect(fp.items.length).toBeGreaterThan(0);
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ schema: "other/9" }))));
    expect((await failure(loadFootprints())).kind).toBe("contract");
  });
});
