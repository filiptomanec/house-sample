// The GLB contract (docs/ARCHITECTURE.md section 3) checked on the committed files, without three.js: the JSON chunk of
// each GLB is read directly. The engine's runtime check (`checkHouseContract`) enforces the same rules on a loaded scene.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { GLB_TOGGLES, HOUSE_ROLES, MODEL_FILES, MODEL_MANIFEST, isGroundRole, isOccluderRole, modelFile, modelInfo, modelUrl } from "./glb";

const models = join(__dirname, "..", "..", "..", "public", "models");

interface GltfJson {
  asset: { version: string };
  extensionsUsed?: string[];
  scenes: { nodes: number[] }[];
  nodes: { name?: string; mesh?: number; children?: number[]; extras?: Record<string, unknown>; matrix?: number[]; translation?: number[]; rotation?: number[]; scale?: number[] }[];
  materials: { name?: string }[];
  meshes: { primitives: { material?: number }[] }[];
}

function readGlb(file: string): GltfJson {
  const b = readFileSync(join(models, file));
  expect(b.readUInt32LE(0)).toBe(0x46546c67); // "glTF"
  const len = b.readUInt32LE(12);
  expect(b.readUInt32LE(16)).toBe(0x4e4f534a); // "JSON" chunk
  return JSON.parse(b.subarray(20, 20 + len).toString("utf8")) as GltfJson;
}

describe("models manifest", () => {
  it("lists every file of the contract and the sizes and hashes match the files", () => {
    const names = [MODEL_FILES.house.high, MODEL_FILES.house.low, MODEL_FILES.furniture.high, MODEL_FILES.furniture.low, MODEL_FILES.footprints, MODEL_FILES.ar];
    for (const name of names) {
      const info = modelInfo(name);
      const bytes = readFileSync(join(models, name));
      expect(bytes.length, name).toBe(info.bytes);
      expect(createHash("sha256").update(bytes).digest("hex"), name).toBe(info.sha256);
    }
  });

  it("builds cache-busted URLs from the content hash", () => {
    for (const tier of ["high", "low"] as const) {
      const url = modelUrl(modelFile("house", tier));
      expect(url).toMatch(/^\/models\/house(-lite)?\.glb\?v=[0-9a-f]{12}$/);
      expect(url.endsWith(modelInfo(modelFile("house", tier)).sha256.slice(0, 12))).toBe(true);
    }
    expect(() => modelUrl("no-such-file.glb")).toThrow(/manifest/);
  });

  it("the lite files are smaller and within the budgets of the contract", () => {
    expect(modelInfo("house-lite.glb").bytes).toBeLessThan(modelInfo("house.glb").bytes);
    expect(modelInfo("house.glb").bytes).toBeLessThanOrEqual(7 * 1024 * 1024);
    expect(modelInfo("house-lite.glb").bytes).toBeLessThanOrEqual(2.5 * 1024 * 1024);
    expect(modelInfo("house-lite.glb").triangles!).toBeLessThanOrEqual(70_000);
    expect(modelInfo("furniture-lite.glb").bytes).toBeLessThanOrEqual(0.6 * 1024 * 1024);
    expect(MODEL_MANIFEST.schema).toBe("models/1");
  });
});

describe("house GLB contract", () => {
  for (const file of [MODEL_FILES.house.high, MODEL_FILES.house.low]) {
    describe(file, () => {
      const g = readGlb(file);
      const meshNodes = g.nodes.filter((n) => n.mesh !== undefined);

      it("uses glTF 2 with Draco and has no transform nodes", () => {
        expect(g.asset.version).toBe("2.0");
        expect(g.extensionsUsed).toContain("KHR_draco_mesh_compression");
        for (const n of g.nodes) {
          expect(n.matrix, n.name).toBeUndefined();
          expect(n.translation, n.name).toBeUndefined();
          expect(n.rotation, n.name).toBeUndefined();
          expect(n.scale, n.name).toBeUndefined();
        }
      });

      it("gives every mesh a known role equal to its material name, and no suffixed duplicates", () => {
        expect(meshNodes.length).toBeGreaterThan(0);
        for (const n of meshNodes) {
          const role = n.extras?.role as string;
          expect(HOUSE_ROLES as readonly string[], `${n.name}: role`).toContain(role);
          const mats = new Set(g.meshes[n.mesh!].primitives.map((p) => g.materials[p.material!].name));
          expect([...mats], `${n.name}: material`).toEqual([role]);
        }
        for (const m of g.materials) expect(m.name, "material name").not.toMatch(/\.\d+$/);
        expect(new Set(g.materials.map((m) => m.name)).size).toBe(g.materials.length);
      });

      it("marks only known toggles, and the roof parts carry the roof toggle", () => {
        for (const n of meshNodes) {
          const t = n.extras?.toggle;
          if (t !== undefined) expect(GLB_TOGGLES as readonly unknown[]).toContain(t);
        }
        const roofRoles = new Set(meshNodes.filter((n) => n.extras?.toggle === "roof").map((n) => n.extras!.role));
        for (const role of ["roof_tile", "ridge_cap", "fascia", "gutter", "ceiling"]) expect(roofRoles.has(role), role).toBe(true);
        // nothing that is not roof is toggled off with the roof
        for (const role of ["plaster", "frame", "glass", "floor_oak", "slab"]) expect(roofRoles.has(role), role).toBe(false);
      });

      it("has ground, glass and sun-blocking meshes for the roles the engine looks for", () => {
        const roles = meshNodes.map((n) => n.extras!.role as string);
        expect(roles.some(isGroundRole)).toBe(true);
        expect(roles).toContain("glass");
        expect(roles.some(isOccluderRole)).toBe(true);
      });
    });
  }

  it("high and lite files hold the same nodes", () => {
    const names = (f: string) => readGlb(f).nodes.map((n) => `${n.name}|${JSON.stringify(n.extras)}`).sort();
    expect(names("house-lite.glb")).toEqual(names("house.glb"));
  });
});

describe("furniture GLB contract", () => {
  for (const file of [MODEL_FILES.furniture.high, MODEL_FILES.furniture.low]) {
    it(`${file}: one root "furniture", every mesh toggles with furniture and has a room id`, () => {
      const g = readGlb(file);
      expect(g.scenes[0].nodes).toHaveLength(1);
      const root = g.nodes[g.scenes[0].nodes[0]];
      expect(root.name).toBe("furniture");
      const meshes = g.nodes.filter((n) => n.mesh !== undefined);
      expect(meshes.length).toBeGreaterThan(0);
      for (const n of meshes) {
        expect(n.extras?.toggle, n.name).toBe("furniture");
        expect(typeof n.extras?.roomId, n.name).toBe("string");
        expect(n.extras?.role as string, n.name).toMatch(/^[ft]_/);
      }
      for (const m of g.materials) expect(m.name).toMatch(/^[ft]_/);
    });
  }
});

// The baked web tree (docs/PIPELINE.md section 9, `TREE_MODEL_FILE` in vegetation.ts): checked once the manifest lists it.
const TREE_FILES = ["tree.glb", "tree-lite.glb"].filter((f) => f in MODEL_MANIFEST.files);
describe.skipIf(TREE_FILES.length === 0)("tree GLB contract", () => {
  for (const file of TREE_FILES) {
    it(`${file}: bark and foliage nodes with their roles, normalised to height 1 and crown 1, size and hash as listed`, () => {
      const bytes = readFileSync(join(models, file));
      expect(bytes.length).toBe(modelInfo(file).bytes);
      expect(createHash("sha256").update(bytes).digest("hex")).toBe(modelInfo(file).sha256);
      const g = readGlb(file);
      expect(g.extensionsUsed).toContain("KHR_draco_mesh_compression");
      const roles = g.nodes.filter((n) => n.mesh !== undefined).map((n) => n.extras?.role).sort();
      expect(roles).toEqual(["bark", "foliage"]);
      for (const n of g.nodes) expect(n.matrix ?? n.translation ?? n.rotation ?? n.scale).toBeUndefined();
      const extras = (g as unknown as { scenes: { extras?: Record<string, unknown> }[] }).scenes[0].extras ?? {};
      // the engine reads a normalised file by `sourceHeight`; the crown base is a share of the height
      expect(typeof extras.sourceHeight).toBe("number");
      expect(extras.crownBase as number).toBeGreaterThan(0);
      expect(extras.crownBase as number).toBeLessThan(1);
    });
  }
});
