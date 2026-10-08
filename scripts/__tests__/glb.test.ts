// Tests of the GLB verifier and the models manifest. The tests on the real files in public/models are skipped when the
// GLBs have not been built (pipeline/build_model.sh); the logic tests on synthetic GLBs always run. The geometry tests
// decode the Draco geometry (public/draco) and compare it with derived.json and with the kernel's graded terrain.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createSite } from "@/lib/model/site";
import {
  analyzeGlb, bladeDepth, glazedOpenings, HOUSE_ROLES, loadDraco, nodePositions, parseGlb, slabTopAt, slabVertices, verifyGeometry,
  verifyGlb, webpSize, type DerivedLike, type Gltf,
} from "../verify-glb";
import { buildManifest, type ModelsManifest } from "../build-models-manifest";

const root = path.resolve(__dirname, "..", "..");
const modelsDir = path.join(root, "public", "models");
const derivedPath = path.join(root, "generated", "derived.json");
const houseGlb = path.join(modelsDir, "house.glb");
const liteGlb = path.join(modelsDir, "house-lite.glb");
const usdz = path.join(modelsDir, "house.usdz");
const treeGlb = path.join(modelsDir, "tree.glb");
const treeLiteGlb = path.join(modelsDir, "tree-lite.glb");
const decoder = path.join(root, "public", "draco", "draco_decoder.js");
const derived: DerivedLike | undefined = fs.existsSync(derivedPath) ? (JSON.parse(fs.readFileSync(derivedPath, "utf8")) as DerivedLike) : undefined;
/** Files of the model pipeline (the house builder and the tree bake); other files in public/models belong to other tools. */
const ownFile = (n: string): boolean => n.startsWith("house") || n.startsWith("tree");

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

  it("derives slab tops from the grade plane and blade depths from the rest angle", () => {
    const ramp = { type: "drive", grade: { corners: [0, 0, -0.2, -0.2], plane: { z0: 0, ox: 1, oy: 2, gx: 0, gy: -0.02 } } };
    expect(slabTopAt(ramp, 5, 12)).toBeCloseTo(-0.2, 9);
    expect(slabTopAt({ type: "pool", pool: { copingTop: -0.02, waterZ: -0.14, floorZ: -1.5 } }, 0, 0)).toBe(-0.02);
    expect(bladeDepth(0.12, 0.025, 0)).toBeCloseTo(0.025, 9); // closed flat in the wall plane: only the thickness
    expect(bladeDepth(0.12, 0.025, 90)).toBeCloseTo(0.12, 9); // open: the chord stands square to the wall
    expect(bladeDepth(0.12, 0.025, 60)).toBeGreaterThan(bladeDepth(0.12, 0.025, 30));
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

// Geometry of the built files, decoded: what the web and the renders actually draw.
for (const [file, variant] of [[houseGlb, "high"], [liteGlb, "lite"]] as const) {
  describe.skipIf(!fs.existsSync(file) || !derived)(`${path.basename(file)} geometry`, () => {
    const glb = () => parseGlb(fs.readFileSync(file));

    it("passes the decoded geometry checks (slab tops on the derived grade, blades on their pivots)", async () => {
      const draco = await loadDraco(decoder);
      expect(verifyGeometry(glb(), derived!, draco)).toEqual([]);
    });

    it("never puts a slab below the graded terrain of the kernel", async () => {
      const draco = await loadDraco(decoder);
      const house = JSON.parse(fs.readFileSync(path.join(root, "model", "house.json"), "utf8"));
      const site = createSite(JSON.parse(fs.readFileSync(path.join(root, "model", "site.json"), "utf8")), house.location.houseAxisBearingDeg, house.outdoor);
      const slabs = slabVertices(draco, glb(), derived!);
      // every outdoor area of the model has its slab, and its top face stands on (never under) the ground
      expect(slabs.map((s) => s.id).sort()).toEqual((derived!.outdoor ?? []).map((o) => o.id).sort());
      for (const s of slabs) {
        expect(s.top.length, s.id).toBeGreaterThan(2);
        const worst = Math.min(...s.top.map((v) => v[2] - site.terrain.groundAt(v[0], v[1])));
        expect(worst, `${s.id} (${variant})`).toBeGreaterThanOrEqual(-0.003); // Draco quantisation
      }
    });

    it("builds a sloped drive and path: the top follows the ramp from the house to the gate", async () => {
      const draco = await loadDraco(decoder);
      const ramps = (derived!.outdoor ?? []).filter((o) => o.grade?.plane && (o.grade.plane.gx !== 0 || o.grade.plane.gy !== 0));
      for (const s of slabVertices(draco, glb(), derived!).filter((q) => ramps.some((o) => o.id === q.id))) {
        const o = ramps.find((q) => q.id === s.id)!;
        const zs = s.top.map((v) => v[2]);
        expect(Math.max(...zs) - Math.min(...zs), s.id).toBeCloseTo(Math.max(...o.grade!.corners!) - Math.min(...o.grade!.corners!), 2);
      }
    });

    it("cuts the water out of the pool deck and puts it below the coping", async () => {
      const draco = await loadDraco(decoder);
      const g = glb();
      const index = new Map((g.json.nodes ?? []).map((n, i) => [n.name ?? "", i]));
      for (const o of (derived!.outdoor ?? []).filter((q) => q.pool)) {
        const pool = o.pool as unknown as { water: number[]; deck?: string; copingTop: number; waterZ: number };
        const [x0, y0, x1, y1] = pool.water;
        const inside = (v: number[]): boolean => v[0] > x0 + 0.01 && v[0] < x1 - 0.01 && v[1] > y0 + 0.01 && v[1] < y1 - 0.01;
        const deck = (derived!.outdoor ?? []).find((q) => q.id === pool.deck);
        if (deck) {
          const i = index.get(`deck_${deck.id}`);
          expect(i, `deck node of ${deck.id}`).toBeDefined();
          const near = nodePositions(draco, g, i!).filter((v) => inside(v) && v[2] > slabTopAt(deck, v[0], v[1]) - 0.2);
          expect(near, "deck boards over the water").toEqual([]);
        }
        const water = nodePositions(draco, g, index.get(`water_${o.id}`)!);
        expect(water.every((v) => Math.abs(v[2] - pool.waterZ) < 0.003 && v[2] < pool.copingTop)).toBe(true);
      }
    });

    it("stands the louvre blades at the rest angle of the model", () => {
      const a = analyzeGlb(glb());
      for (const sc of derived!.screens ?? []) {
        if (!sc.blades || sc.restDeg === undefined) continue;
        const node = a.nodes.find((n) => n.name === `screen_slats_${sc.id}`);
        expect(node, sc.id).toBeDefined();
        const across = sc.orient === "v" ? node!.box.max[0] - node!.box.min[0] : node!.box.max[1] - node!.box.min[1];
        expect(across).toBeCloseTo(bladeDepth(sc.blades.chord, sc.blades.thickness, sc.restDeg), 2);
      }
    });

    it("uses only roles of the contract, each the data needs", () => {
      const a = analyzeGlb(glb());
      for (const r of Object.keys(a.roles)) expect(HOUSE_ROLES as readonly string[]).toContain(r);
    });
  });
}

describe.skipIf(!fs.existsSync(treeGlb))("tree.glb", () => {
  const read = (f: string) => parseGlb(fs.readFileSync(f));

  it("is a light, normalised tree for instancing: bark and foliage nodes, Draco, a small WebP leaf atlas", () => {
    for (const [f, maxTri, maxPx] of [[treeGlb, 6000, 512], [treeLiteGlb, 6000, 256]] as const) {
      if (!fs.existsSync(f)) continue;
      const g = read(f);
      const a = analyzeGlb(g);
      expect(a.triangles, f).toBeLessThanOrEqual(maxTri);
      expect(a.nodes.map((n) => n.role).sort()).toEqual(["bark", "foliage"]);
      expect(g.json.extensionsRequired).toEqual(expect.arrayContaining(["KHR_draco_mesh_compression", "EXT_texture_webp"]));
      expect(a.imageSizes.length).toBe(1);
      expect(Math.max(a.imageSizes[0].w, a.imageSizes[0].h)).toBeLessThanOrEqual(maxPx);
      // unit height and crown, trunk base at the origin (the web scales each instance by crown and height)
      expect(a.bbox.min[2]).toBeCloseTo(0, 2);
      expect(a.bbox.max[2]).toBeGreaterThan(0.9);
      expect(a.bbox.max[2]).toBeLessThan(1.15);
      const crown = Math.max(a.bbox.max[0] - a.bbox.min[0], a.bbox.max[1] - a.bbox.min[1]);
      expect(crown).toBeGreaterThan(0.85);
      expect(crown).toBeLessThan(1.3);
      const extras = (g.json.scenes?.[0] as { extras?: Record<string, unknown> } | undefined)?.extras ?? {};
      expect(extras.crownBase as number).toBeGreaterThan(0);
      expect(extras.crownBase as number).toBeLessThan(1);
    }
  });

  it("has a lighter phone variant", () => {
    if (!fs.existsSync(treeLiteGlb)) return;
    expect(analyzeGlb(read(treeLiteGlb)).triangles).toBeLessThan(analyzeGlb(read(treeGlb)).triangles);
  });
});

describe.skipIf(!fs.existsSync(path.join(modelsDir, "manifest.json")))("manifest.json", () => {
  // The whole directory (furniture files of other tools included) is checked by `build-models-manifest.ts --check` in CI;
  // here only the house and tree files are compared, so a rebuild of another file does not break this test.
  const read = (): ModelsManifest => JSON.parse(fs.readFileSync(path.join(modelsDir, "manifest.json"), "utf8")) as ModelsManifest;

  it("lists the house and tree files with their real hashes and sizes", () => {
    const m = read();
    const houseFiles = fs.readdirSync(modelsDir).filter((n) => ownFile(n) && n !== "manifest.json");
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
    for (const name of Object.keys(fresh.files).filter(ownFile)) expect(m.files[name]).toEqual(fresh.files[name]);
  });
});

describe.skipIf(!fs.existsSync(usdz))("house.usdz", () => {
  it("is a zip archive of at most 6 MB", () => {
    const b = fs.readFileSync(usdz);
    expect(b.readUInt32LE(0)).toBe(0x04034b50); // local file header of a zip
    expect(b.length).toBeLessThanOrEqual(6_000_000);
  });
});
