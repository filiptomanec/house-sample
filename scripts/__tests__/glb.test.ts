// Tests of the GLB verifier and the models manifest. The tests on the real files in public/models are skipped when the
// GLBs have not been built (pipeline/build_model.sh); the logic tests on synthetic GLBs always run.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { analyzeGlb, glazedOpenings, parseGlb, verifyGlb, webpSize, type DerivedLike, type Gltf } from "../verify-glb";
import { buildManifest, type ModelsManifest } from "../build-models-manifest";

const root = path.resolve(__dirname, "..", "..");
const modelsDir = path.join(root, "public", "models");
const derivedPath = path.join(root, "generated", "derived.json");
const houseGlb = path.join(modelsDir, "house.glb");
const liteGlb = path.join(modelsDir, "house-lite.glb");
const usdz = path.join(modelsDir, "house.usdz");
const derived: DerivedLike | undefined = fs.existsSync(derivedPath) ? (JSON.parse(fs.readFileSync(derivedPath, "utf8")) as DerivedLike) : undefined;

/** Minimal GLB container around a JSON document (no BIN chunk). */
function makeGlb(json: unknown): Buffer {
  let text = JSON.stringify(json);
  while (Buffer.byteLength(text) % 4) text += " ";
  const body = Buffer.from(text);
  const head = Buffer.alloc(20);
  head.writeUInt32LE(0x46546c67, 0);
  head.writeUInt32LE(2, 4);
  head.writeUInt32LE(20 + body.length, 8);
  head.writeUInt32LE(body.length, 12);
  head.writeUInt32LE(0x4e4f534a, 16);
  return Buffer.concat([head, body]);
}

/** A glTF with one mesh node; `over` patches the node or the document. */
function tiny(node: Record<string, unknown> = {}, doc: Partial<Gltf> = {}): Gltf {
  return {
    asset: { version: "2.0" },
    extensionsUsed: ["KHR_draco_mesh_compression", "EXT_texture_webp"],
    extensionsRequired: ["KHR_draco_mesh_compression", "EXT_texture_webp"],
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ name: "plaster", mesh: 0, extras: { role: "plaster" }, ...node }],
    meshes: [{ name: "plaster", primitives: [{ attributes: { POSITION: 0, TEXCOORD_0: 1 }, indices: 2, material: 0, mode: 4, extensions: { KHR_draco_mesh_compression: {} } }] }],
    materials: [{ name: "plaster" }],
    accessors: [
      { count: 4, type: "VEC3", min: [0, 0, -1], max: [2, 3, 0] },
      { count: 4, type: "VEC2" },
      { count: 6, type: "SCALAR" },
    ],
    ...doc,
  };
}

describe("GLB container", () => {
  it("rejects data that is not a GLB", () => {
    expect(() => parseGlb(Buffer.from("not a glb file at all, really"))).toThrow();
    const bad = makeGlb({});
    bad.writeUInt32LE(3, 4);
    expect(() => parseGlb(bad)).toThrow(/version/);
  });

  it("reads triangles and a bounding box in the house frame (glTF Y-up -> x east, y north, z up)", () => {
    const a = analyzeGlb(parseGlb(makeGlb(tiny())));
    expect(a.triangles).toBe(2);
    expect(a.bbox.min).toEqual([0, 0, 0]); // gltf z in [-1, 0] -> house y in [0, 1]; gltf y in [0, 3] -> house z
    expect(a.bbox.max).toEqual([2, 1, 3]);
  });

  it("reads the size of a WebP image", () => {
    const b = Buffer.alloc(40);
    b.write("RIFF", 0, "ascii");
    b.write("WEBP", 8, "ascii");
    b.write("VP8X", 12, "ascii");
    b.writeUIntLE(1023, 24, 3);
    b.writeUIntLE(511, 27, 3);
    expect(webpSize(b)).toEqual({ w: 1024, h: 512 });
    expect(webpSize(Buffer.alloc(40))).toBeNull();
  });
});

describe("verifyGlb rules", () => {
  const errors = (j: Gltf, o = {}): string[] => verifyGlb(makeGlb(j), o).errors;

  it("accepts a conforming node", () => {
    expect(errors(tiny())).toEqual([]);
  });

  it("flags transforms, hierarchy and a missing role", () => {
    expect(errors(tiny({ translation: [0, 1, 0] })).join("\n")).toMatch(/transform/);
    expect(errors(tiny({ children: [1] })).join("\n")).toMatch(/children/);
    expect(errors(tiny({ extras: {} })).join("\n")).toMatch(/extras\.role/);
  });

  it("checks the material against the role and the node name", () => {
    expect(errors(tiny({}, { materials: [{ name: "plaster.001" }] })).join("\n")).toMatch(/suffix|differs/);
    expect(errors(tiny({ name: "wall" })).join("\n")).toMatch(/name should be/);
  });

  it("requires the roof toggle on roof roles and forbids it elsewhere", () => {
    const roof = tiny({ name: "fascia", extras: { role: "fascia" } }, { materials: [{ name: "fascia" }] });
    expect(errors(roof).join("\n")).toMatch(/toggle "roof"/);
    expect(errors(tiny({ extras: { role: "plaster", toggle: "roof" } })).join("\n")).toMatch(/must not have toggle/);
  });

  it("checks the triangle budget of the lite variant", () => {
    const j = tiny();
    j.accessors![2].count = 3 * 80_000;
    expect(errors(j, { variant: "lite" }).join("\n")).toMatch(/triangles exceed/);
  });

  it("compares glass nodes with the glazed openings", () => {
    const d: DerivedLike = { openings: [{ id: "W1", kind: "window", exterior: true }, { id: "D1", kind: "door", exterior: false }, { id: "G1", kind: "garage", exterior: true }] };
    expect(glazedOpenings(d)).toEqual(["W1"]);
    expect(errors(tiny(), { derived: d }).join("\n")).toMatch(/glass nodes/);
  });
});

describe.skipIf(!fs.existsSync(houseGlb))("house.glb", () => {
  const buf = fs.existsSync(houseGlb) ? fs.readFileSync(houseGlb) : Buffer.alloc(0);

  it("follows the GLB contract and matches derived.json", () => {
    const r = verifyGlb(buf, { variant: "high", derived });
    expect(r.errors).toEqual([]);
  });

  it("is within the size budget and has a node per room floor and per glazed opening", () => {
    const r = verifyGlb(buf, { variant: "high", derived });
    expect(r.analysis.size).toBeLessThanOrEqual(7_000_000);
    if (derived) {
      expect(r.analysis.nodes.filter((n) => n.role === "glass").length).toBe(glazedOpenings(derived).length);
    }
  });
});

describe.skipIf(!fs.existsSync(liteGlb))("house-lite.glb", () => {
  const buf = fs.existsSync(liteGlb) ? fs.readFileSync(liteGlb) : Buffer.alloc(0);

  it("follows the contract within the phone budgets (2.5 MB, 70 000 triangles, 512 px)", () => {
    const r = verifyGlb(buf, { variant: "lite", derived });
    expect(r.errors).toEqual([]);
    expect(r.analysis.size).toBeLessThanOrEqual(2_500_000);
    expect(r.analysis.triangles).toBeLessThanOrEqual(70_000);
  });

  it("is built from the same model as the desktop file (same roles and nodes)", () => {
    if (!fs.existsSync(houseGlb)) return;
    const hi = analyzeGlb(parseGlb(fs.readFileSync(houseGlb)));
    const lo = analyzeGlb(parseGlb(buf));
    expect(Object.keys(lo.roles).sort()).toEqual(Object.keys(hi.roles).sort());
    expect(lo.triangles).toBeLessThanOrEqual(hi.triangles);
  });
});

describe.skipIf(!fs.existsSync(path.join(modelsDir, "manifest.json")))("manifest.json", () => {
  // The whole directory (furniture files of other tools included) is checked by `build-models-manifest.ts --check` in CI;
  // here only the house files are compared, so a rebuild of another file does not break this test.
  const read = (): ModelsManifest => JSON.parse(fs.readFileSync(path.join(modelsDir, "manifest.json"), "utf8")) as ModelsManifest;

  it("lists the house files with their real hashes and sizes", () => {
    const m = read();
    const houseFiles = fs.readdirSync(modelsDir).filter((n) => n.startsWith("house") && n !== "manifest.json");
    for (const name of houseFiles) {
      const buf = fs.readFileSync(path.join(modelsDir, name));
      expect(m.files[name], `${name} is not in the manifest`).toBeDefined();
      expect(m.files[name].sha256, name).toBe(crypto.createHash("sha256").update(buf).digest("hex"));
      expect(m.files[name].bytes, name).toBe(buf.length);
    }
  });

  it("matches the model it was built from", () => {
    const m = read();
    if (derived?.inputHash) expect(m.inputHash).toBe(derived.inputHash);
    expect(m.hash).toMatch(/^[0-9a-f]{64}$/);
    const fresh = buildManifest(modelsDir, m.inputHash);
    for (const name of Object.keys(fresh.files).filter((n) => n.startsWith("house"))) expect(m.files[name]).toEqual(fresh.files[name]);
  });
});

describe.skipIf(!fs.existsSync(usdz))("house.usdz", () => {
  it("is a zip archive of at most 6 MB", () => {
    const b = fs.readFileSync(usdz);
    expect(b.readUInt32LE(0)).toBe(0x04034b50); // local file header of a zip
    expect(b.length).toBeLessThanOrEqual(6_000_000);
  });
});
