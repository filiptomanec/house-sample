import { describe, expect, it } from "vitest";
import siteJson from "@model/site.json";
import { derived } from "@/lib/model/instance";
import { createSite } from "@/lib/model/site";
import type { Derived } from "@/lib/model/types";
import {
  PRINT_DEFAULTS, PRINT_SCALE_RANGE, STL_HEADER_PREFIX, buildPrintMesh, buildStl, checkBedFit, fittingScale, normalizeScale, printReport,
  reportOfMesh, stlBytes, toBinaryStl, wallTopOf, type PrintMesh, type PrintOptions,
} from "../printModel";

const site = createSite(siteJson, derived.houseAxisBearingDeg);

// ---------------------------------------------------------------------------------------------- oracles

type V = [number, number, number];
const vertex = (m: Pick<PrintMesh, "positions">, t: number, v: number): V => [m.positions[t * 9 + v * 3], m.positions[t * 9 + v * 3 + 1], m.positions[t * 9 + v * 3 + 2]];
const key = (p: V) => p.join(",");

/** Closed oriented 2-manifold: every directed edge occurs once and so does its reverse; no degenerate triangle. Returns the volume. */
function shellVolume(mesh: PrintMesh, first: number, count: number): number {
  const edges = new Map<string, number>();
  let volume = 0;
  const o = vertex(mesh, first, 0);
  for (let t = first; t < first + count; t++) {
    const v = [0, 1, 2].map((i) => vertex(mesh, t, i));
    const a = v[0].map((x, i) => v[1][i] - x) as V, b = v[0].map((x, i) => v[2][i] - x) as V;
    const n = [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
    expect(Math.hypot(...n)).toBeGreaterThan(0); // no degenerate triangle
    for (let i = 0; i < 3; i++) {
      const k = `${key(v[i])}>${key(v[(i + 1) % 3])}`;
      edges.set(k, (edges.get(k) ?? 0) + 1);
    }
    const p = v.map((q) => q.map((x, i) => x - o[i]) as V);
    volume += (p[0][0] * (p[1][1] * p[2][2] - p[1][2] * p[2][1]) - p[0][1] * (p[1][0] * p[2][2] - p[1][2] * p[2][0]) + p[0][2] * (p[1][0] * p[2][1] - p[1][1] * p[2][0])) / 6;
  }
  for (const [k, n] of edges) {
    expect(n).toBe(1);
    const [a, b] = k.split(">");
    expect(edges.get(`${b}>${a}`)).toBe(1);
  }
  return volume;
}

const volumeOf = (mesh: PrintMesh, part: string) => mesh.shells.filter((s) => s.part === part).reduce((s, sh) => s + shellVolume(mesh, sh.first, sh.count), 0);

/** Plan box of everything printed, from the roofs' eave rectangles, the outline bounds and the outdoor rectangles (not from the roof faces). */
function expectedBox(d: Derived, outdoor: boolean) {
  const rects = [...d.roofs.map((r) => r.eaveRect), ...(d.outline.bbox ? [[d.outline.bbox.x0, d.outline.bbox.y0, d.outline.bbox.x1, d.outline.bbox.y1]] : []), ...(outdoor ? d.outdoor.map((o) => o.rect) : [])];
  return { x0: Math.min(...rects.map((r) => r[0])), y0: Math.min(...rects.map((r) => r[1])), x1: Math.max(...rects.map((r) => r[2])), y1: Math.max(...rects.map((r) => r[3])) };
}

const GROUNDS = ["none", "plate", "terrain"] as const;

// ---------------------------------------------------------------------------------------------- tests

describe("buildPrintMesh: closed shells", () => {
  for (const ground of GROUNDS) {
    for (const outdoor of [true, false]) {
      it(`every shell is a closed, outward-oriented manifold with positive volume (ground ${ground}, outdoor ${outdoor})`, () => {
        const mesh = buildPrintMesh(derived, site, { ground, outdoor });
        expect(mesh.shells.length).toBeGreaterThan(0);
        expect(mesh.shells.reduce((s, sh) => s + sh.count, 0)).toBe(mesh.triangleCount);
        for (const sh of mesh.shells) expect(shellVolume(mesh, sh.first, sh.count)).toBeGreaterThan(0);
      });
    }
  }

  it("has the parts that were asked for, in contiguous triangle ranges", () => {
    const names = (o: PrintOptions) => buildPrintMesh(derived, site, o).parts.map((p) => p.name);
    expect(names({ ground: "none", outdoor: false })).toEqual(["walls", "roof"]);
    expect(names({ ground: "plate", outdoor: true })).toEqual(["plate", "walls", "roof", "outdoor"]);
    expect(names({ ground: "terrain", outdoor: true })).toEqual(["terrain", "walls", "roof", "outdoor"]);
    const mesh = buildPrintMesh(derived, site);
    let next = 0;
    for (const p of mesh.parts) { expect(p.first).toBe(next); next += p.count; }
    expect(next).toBe(mesh.triangleCount);
  });

  it("is deterministic: two builds are byte-identical", () => {
    for (const ground of GROUNDS) {
      const a = new Uint8Array(buildStl(derived, site, { ground })), b = new Uint8Array(buildStl(derived, site, { ground }));
      expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true);
    }
  });

  it("needs a site only for the terrain", () => {
    expect(() => buildPrintMesh(derived, null, { ground: "terrain" })).toThrow(TypeError);
    expect(buildPrintMesh(derived, null, { ground: "plate" }).triangleCount).toBeGreaterThan(0);
  });
});

describe("buildPrintMesh: dimensions", () => {
  it("the wall block has the volume of the outline area times its height (oracle: the outline rectangles)", () => {
    const area = derived.outline.rects.reduce((s, r) => s + (r[2] - r[0]) * (r[3] - r[1]), 0);
    const top = Math.max(...derived.roofs.map((r) => r.wallTop));
    expect(wallTopOf(derived)).toBe(top);
    const none = buildPrintMesh(derived, null, { ground: "none", outdoor: false });
    expect(volumeOf(none, "walls")).toBeCloseTo(area * top, 3);
    const plate = buildPrintMesh(derived, null, { ground: "plate", outdoor: false });
    expect(volumeOf(plate, "walls")).toBeCloseTo(area * (top + PRINT_DEFAULTS.overlapM), 3);
  });

  it("the roof reaches the ridge and has a fascia: its lowest point is the flat bottom below the eave", () => {
    const mesh = buildPrintMesh(derived, null, { ground: "none", outdoor: false });
    const roofTris = mesh.parts.find((p) => p.name === "roof")!;
    let zMax = -Infinity, zMin = Infinity;
    for (let t = roofTris.first; t < roofTris.first + roofTris.count; t++) for (let v = 0; v < 3; v++) { const z = vertex(mesh, t, v)[2]; zMax = Math.max(zMax, z); zMin = Math.min(zMin, z); }
    expect(zMax).toBeCloseTo(derived.bbox.z1, 3); // the model rounds heights to 0.1 mm, the mesh is float32
    const lowestEave = Math.min(...derived.roofs.map((r) => r.eaveHeight));
    expect(zMin).toBeCloseTo(Math.min(lowestEave - PRINT_DEFAULTS.roofEdgeThicknessM, wallTopOf(derived) - PRINT_DEFAULTS.overlapM), 3);
  });

  it("the plate reaches the margin around everything printed, and sits below the floor level", () => {
    for (const outdoor of [true, false]) {
      const mesh = buildPrintMesh(derived, null, { ground: "plate", outdoor });
      const plate = mesh.parts.find((p) => p.name === "plate")!;
      const box = expectedBox(derived, outdoor), m = PRINT_DEFAULTS.plateMarginM;
      const lo: V = [Infinity, Infinity, Infinity], hi: V = [-Infinity, -Infinity, -Infinity];
      for (let t = plate.first; t < plate.first + plate.count; t++) for (let v = 0; v < 3; v++) vertex(mesh, t, v).forEach((x, i) => { lo[i] = Math.min(lo[i], x); hi[i] = Math.max(hi[i], x); });
      expect(lo[0]).toBeCloseTo(box.x0 - m, 5);
      expect(lo[1]).toBeCloseTo(box.y0 - m, 5);
      expect(hi[0]).toBeCloseTo(box.x1 + m, 5);
      expect(hi[1]).toBeCloseTo(box.y1 + m, 5);
      expect(lo[2]).toBeCloseTo(-PRINT_DEFAULTS.plateThicknessM, 5);
      expect(hi[2]).toBeCloseTo(0, 5);
      // and the whole model lies over that plate
      expect(mesh.bounds.min[0]).toBeCloseTo(lo[0], 5);
      expect(mesh.bounds.max[1]).toBeCloseTo(hi[1], 5);
    }
  });

  it("outdoor slabs and posts: one slab per area, one post per post of a covered area, posts reach into the roof", () => {
    const mesh = buildPrintMesh(derived, null, { ground: "none" });
    const posts = derived.outdoor.filter((o) => o.covered).reduce((s, o) => s + o.posts.length, 0);
    expect(mesh.shells.filter((s) => s.part === "outdoor")).toHaveLength(derived.outdoor.length + posts);
    const roofBottom = Math.min(...derived.roofPlanes.map((f) => f.zMin)) - PRINT_DEFAULTS.roofEdgeThicknessM;
    let tall = 0;
    for (const sh of mesh.shells.filter((s) => s.part === "outdoor")) {
      let zMax = -Infinity;
      for (let t = sh.first; t < sh.first + sh.count; t++) for (let v = 0; v < 3; v++) zMax = Math.max(zMax, vertex(mesh, t, v)[2]);
      if (zMax > PRINT_DEFAULTS.slabHeightM + 1e-6) { tall++; expect(zMax).toBeGreaterThan(roofBottom); }
    }
    expect(tall).toBe(posts);
  });

  it("the terrain top follows the site's ground at every node, the slab reaches the margin, buildings stand in it", () => {
    const mesh = buildPrintMesh(derived, site, { ground: "terrain" });
    const part = mesh.parts.find((p) => p.name === "terrain")!;
    const box = expectedBox(derived, true), m = PRINT_DEFAULTS.terrainMarginM;
    let bottom = Infinity, lo = Infinity, hi = -Infinity;
    for (let t = part.first; t < part.first + part.count; t++) for (let v = 0; v < 3; v++) bottom = Math.min(bottom, vertex(mesh, t, v)[2]);
    let tops = 0;
    for (let t = part.first; t < part.first + part.count; t++) {
      for (let v = 0; v < 3; v++) {
        const [x, y, z] = vertex(mesh, t, v);
        lo = Math.min(lo, x); hi = Math.max(hi, y);
        if (z > bottom + 1e-6) { tops++; expect(z).toBeCloseTo(site.terrain.groundAt(x, y), 4); }
      }
    }
    expect(tops).toBeGreaterThan(0);
    expect(lo).toBeCloseTo(box.x0 - m, 5);
    expect(hi).toBeCloseTo(box.y1 + m, 5);
    // the walls start below every terrain vertex of the cells under the building
    const walls = mesh.shells.filter((s) => s.part === "walls");
    let wallMin = Infinity, terrainUnder = Infinity;
    for (const sh of walls) for (let t = sh.first; t < sh.first + sh.count; t++) for (let v = 0; v < 3; v++) wallMin = Math.min(wallMin, vertex(mesh, t, v)[2]);
    const o = derived.outline.bbox!;
    for (let t = part.first; t < part.first + part.count; t++) for (let v = 0; v < 3; v++) {
      const [x, y, z] = vertex(mesh, t, v);
      if (z > bottom + 1e-6 && x >= o.x0 && x <= o.x1 && y >= o.y0 && y <= o.y1) terrainUnder = Math.min(terrainUnder, z);
    }
    expect(wallMin).toBeLessThanOrEqual(terrainUnder - PRINT_DEFAULTS.overlapM + 1e-6);
  });

  it("a courtyard in the outline is cut out of the walls (synthetic model: outer ring minus a hole, no roofs)", () => {
    const outer: [number, number][] = [[0, 0], [12, 0], [12, 9], [0, 9]];
    const hole: [number, number][] = [[4, 3], [4, 6], [8, 6], [8, 3]]; // clockwise, as the kernel writes holes
    const fake = {
      ...derived, roofs: [], roofPlanes: [], outdoor: [],
      outline: { ...derived.outline, polygons: [{ pts: outer, area: 108 }, { pts: hole, area: -12 }], bbox: { x0: 0, y0: 0, x1: 12, y1: 9, w: 12, d: 9 } },
    } as unknown as Derived;
    const mesh = buildPrintMesh(fake, null, { ground: "none" });
    expect(mesh.shells).toHaveLength(1);
    expect(volumeOf(mesh, "walls")).toBeCloseTo((108 - 12) * fake.defaultWallTop, 3); // float32 vertices
  });
});

describe("scale, bed and report", () => {
  const mesh = buildPrintMesh(derived, site, { ground: "plate" });

  it("clamps and rounds the scale", () => {
    expect(normalizeScale(50)).toBe(PRINT_SCALE_RANGE.min);
    expect(normalizeScale(1000)).toBe(PRINT_SCALE_RANGE.max);
    expect(normalizeScale(Number.NaN)).toBe(PRINT_SCALE_RANGE.max);
    expect(normalizeScale(undefined)).toBe(PRINT_SCALE_RANGE.max);
    expect(normalizeScale(149.6)).toBe(150);
  });

  it("size on the bed is the size in metres times 1000 over the scale", () => {
    for (const s of [100, 150, 200]) {
      const fit = checkBedFit(mesh, s);
      mesh.bounds.size.forEach((v, i) => expect(fit.sizeMm[i]).toBeCloseTo((v * 1000) / s, 9));
      expect(fit.fits).toBe(Math.max(fit.sizeMm[0], fit.sizeMm[1]) <= PRINT_DEFAULTS.bedMm);
    }
  });

  it("fittingScale is the smallest denominator at or above the preferred one that fits", () => {
    const side = Math.max(mesh.bounds.size[0], mesh.bounds.size[1]);
    for (const bed of [90, 120, 160, 200, 250]) {
      for (const preferred of [100, 130, 180]) {
        const s = fittingScale(mesh, preferred, bed);
        if (s === null) { expect(checkBedFit(mesh, PRINT_SCALE_RANGE.max, bed).fits).toBe(false); continue; }
        expect(s).toBeGreaterThanOrEqual(preferred);
        expect(checkBedFit(mesh, s, bed).fits).toBe(true);
        if (s > preferred) expect(checkBedFit(mesh, s - 1, bed).fits).toBe(false);
      }
    }
    expect(fittingScale(mesh, 100, (side * 1000) / 120 - 0.01)).toBe(121); // just too small for 1:120
    expect(fittingScale(mesh, 100, 5)).toBeNull(); // nothing fits a 5 mm bed
  });

  it("autoFit raises the denominator only when needed; without a solution it stays at the range maximum", () => {
    const side = Math.max(mesh.bounds.size[0], mesh.bounds.size[1]) * 1000;
    const bed = side / 140; // fits from 1:140 on
    expect(reportOfMesh(mesh, { scale: 100, bedMm: bed, autoFit: true }).scale).toBe(140);
    expect(reportOfMesh(mesh, { scale: 100, bedMm: bed }).scale).toBe(100);
    expect(reportOfMesh(mesh, { scale: 100, bedMm: bed }).fits).toBe(false);
    expect(reportOfMesh(mesh, { scale: 170, bedMm: bed, autoFit: true }).scale).toBe(170);
    const hopeless = reportOfMesh(mesh, { scale: 100, bedMm: 3, autoFit: true });
    expect(hopeless.scale).toBe(PRINT_SCALE_RANGE.max);
    expect(hopeless.fits).toBe(false);
  });

  it("printReport agrees with the file buildStl produces", () => {
    for (const o of [{ scale: 150 }, { scale: 100, autoFit: true, bedMm: 150 }, { ground: "none", outdoor: false }] satisfies PrintOptions[]) {
      const r = printReport(derived, site, o), stl = buildStl(derived, site, o);
      expect(stl.byteLength).toBe(r.bytes);
      expect(r.bytes).toBe(stlBytes(r.triangles));
      expect(new DataView(stl).getUint32(80, true)).toBe(r.triangles);
      expect(new TextDecoder().decode(new Uint8Array(stl, 0, 80))).toContain(`1:${r.scale}`);
    }
  });
});

describe("binary STL", () => {
  const mesh = buildPrintMesh(derived, site, { ground: "plate" });

  it("has the documented layout: 80-byte ASCII header, count, 50 bytes per triangle", () => {
    const buf = toBinaryStl(mesh, 200);
    expect(buf.byteLength).toBe(84 + 50 * mesh.triangleCount);
    const header = new Uint8Array(buf, 0, 80);
    expect(header.every((b) => b >= 0x20 && b < 0x7f)).toBe(true);
    const text = new TextDecoder().decode(header);
    expect(text.startsWith(`${STL_HEADER_PREFIX} 1:200`)).toBe(true);
    expect(text.trim()).toBe(`${STL_HEADER_PREFIX} 1:200`);
    expect(text.startsWith("solid")).toBe(false); // a header starting with "solid" makes some tools read the file as text
    expect(new DataView(buf).getUint32(80, true)).toBe(mesh.triangleCount);
  });

  it("holds millimetres at the scale, normals of unit length pointing out of the solid, attribute bytes zero", () => {
    const dv = (b: ArrayBuffer) => new DataView(b);
    const a = dv(toBinaryStl(mesh, 200)), b = dv(toBinaryStl(mesh, 100));
    for (const t of [0, 1, 17, mesh.triangleCount - 1]) {
      const o = 84 + 50 * t;
      expect(Math.hypot(a.getFloat32(o, true), a.getFloat32(o + 4, true), a.getFloat32(o + 8, true))).toBeCloseTo(1, 5);
      for (let v = 0; v < 3; v++) for (let c = 0; c < 3; c++) {
        const metres = mesh.positions[t * 9 + v * 3 + c];
        expect(a.getFloat32(o + 12 + v * 12 + c * 4, true)).toBeCloseTo((metres * 1000) / 200, 3);
        expect(b.getFloat32(o + 12 + v * 12 + c * 4, true)).toBeCloseTo((metres * 1000) / 100, 3);
      }
      expect(a.getUint16(o + 48, true)).toBe(0);
    }
    // the base plate's top face looks up and its bottom face looks down
    const plate = mesh.parts.find((p) => p.name === "plate")!;
    const nz = Array.from({ length: plate.count }, (_, i) => a.getFloat32(84 + 50 * (plate.first + i) + 8, true));
    expect(nz.some((z) => z > 0.99)).toBe(true);
    expect(nz.some((z) => z < -0.99)).toBe(true);
  });

  it("gives degenerate triangles the zero normal", () => {
    const flat = toBinaryStl({ positions: new Float32Array([0, 0, 0, 1, 1, 1, 2, 2, 2]), triangleCount: 1 }, 100);
    const v = new DataView(flat);
    expect([v.getFloat32(84, true), v.getFloat32(88, true), v.getFloat32(92, true)]).toEqual([0, 0, 0]);
  });
});
