// The louvre wall only turns (owner request): positions as the Blender builder spreads them, the closed stop where the blades
// touch, blades between the rails, angle clamped to [closedDeg, 90], no slide. The pipeline parameters are read from its file.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { getHouseContext } from "./context";
import { SCREEN_RAIL, bladeHeights, buildSlatScreens, closedAngle, slatPositions } from "./blinds";
import type { HouseScene } from "./house";
import type { Viewer } from "./viewer";

const ctx = getHouseContext();
const params = readFileSync(join(__dirname, "..", "..", "..", "pipeline", "blender", "hb", "params.py"), "utf8");
const param = (name: string) => Number(new RegExp(`"${name}":\\s*([0-9.]+)`).exec(params)?.[1]);

/** A minimal house scene: the static blades and (optionally) rails of every screen, as the GLB holds them. */
function fakeScene(withRails: boolean) {
  const building = new THREE.Group();
  const slatMat = new THREE.MeshStandardMaterial({ name: "screen_slats" });
  for (const s of ctx.derived.screens) {
    const blades = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), slatMat);
    blades.userData = { role: "screen_slats", id: s.id };
    building.add(blades);
    if (withRails) {
      const rail = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ name: "screen_rail" }));
      rail.userData = { role: "screen_rail", id: s.id };
      building.add(rail);
    }
  }
  const root = new THREE.Group();
  root.add(building);
  let renders = 0;
  const house = { ctx, building, root, materials: new Map([["screen_slats", slatMat]]), adopt: (o: THREE.Object3D) => root.add(o) } as unknown as HouseScene;
  const viewer = { requestRender: () => { renders++; } } as unknown as Viewer;
  return { house, viewer, building, renders: () => renders };
}

describe("slatPositions (the pipeline's even spacing)", () => {
  it("puts n = floor(length / pitch) blades on the effective pitch length / n, the first half a pitch from the start", () => {
    for (const [from, to, pitch] of [[0, 5, 0.1], [0.15, 5.15, 0.1], [2.7, 5.15, 0.12], [0, 1.05, 0.1]] as const) {
      const s = slatPositions(from, to, pitch);
      const n = Math.floor((to - from) / pitch + 1e-9);
      expect(s.length).toBe(n);
      const p = (to - from) / n;
      expect(p).toBeGreaterThanOrEqual(pitch - 1e-9);
      expect(s[0]).toBeCloseTo(from + p / 2, 9);
      for (let i = 1; i < s.length; i++) expect(s[i] - s[i - 1]).toBeCloseTo(p, 9);
      expect(s[s.length - 1]).toBeCloseTo(to - p / 2, 9);
    }
  });

  it("is empty for a screen shorter than one pitch", () => {
    expect(slatPositions(0, 0.05, 0.1)).toEqual([]);
  });

  it("agrees with the kernel's blade positions of every screen of the model (the ones the GLB is built from)", () => {
    for (const s of ctx.derived.screens) {
      const mine = slatPositions(s.from, s.to, ctx.house.shading.slats.pitch);
      expect(mine.length, s.id).toBe(s.blades.positions.length);
      mine.forEach((x, i) => expect(x).toBeCloseTo(s.blades.positions[i], 6));
    }
  });
});

describe("closedAngle", () => {
  it("is the angle where neighbouring blades touch, rounded up to 5 degrees, and agrees with the kernel", () => {
    for (const s of ctx.derived.screens) {
      const a = closedAngle(s.blades.pitch, s.blades.thickness);
      expect(a, s.id).toBe(s.closedDeg);
      // at the stop the blades really do not overlap: chord * sin(angle) >= thickness ... and the next 5 degrees down would
      expect(s.blades.pitch * Math.sin((a * Math.PI) / 180)).toBeGreaterThanOrEqual(s.blades.thickness - 1e-9);
      expect(a % 5).toBe(0);
      expect(a - 5 < 0 || s.blades.pitch * Math.sin(((a - 5) * Math.PI) / 180) < s.blades.thickness).toBe(true);
    }
  });

  it("closes the wall: at the stop the blades cover more than their pitch", () => {
    for (const s of ctx.derived.screens) {
      expect(s.blades.chord * Math.cos((s.closedDeg * Math.PI) / 180), s.id).toBeGreaterThan(s.blades.pitch);
    }
  });
});

describe("bladeHeights", () => {
  it("runs between the rails of the pipeline, with its air gap", () => {
    expect(SCREEN_RAIL.height).toBeCloseTo(param("rail_h"), 9);
    expect(SCREEN_RAIL.minDepth).toBeCloseTo(param("rail_d"), 9);
    for (const s of ctx.derived.screens) {
      const h = bladeHeights(s);
      expect(h.bottom).toBeGreaterThan(s.z0 + SCREEN_RAIL.height);
      expect(h.top).toBeLessThan(s.z1 - SCREEN_RAIL.height);
      expect(h.top - h.bottom).toBeGreaterThan((s.z1 - s.z0) * 0.9);
    }
  });
});

describe("buildSlatScreens (rotation only)", () => {
  it("starts at the rest angle, clamps every angle to [closedDeg, 90]", () => {
    const { house, viewer } = fakeScene(true);
    const screens = buildSlatScreens(viewer, house);
    const closed = Math.max(...ctx.derived.screens.map((s) => s.closedDeg));
    expect(screens.range).toEqual({ min: closed, max: 90, rest: ctx.derived.screens[0].restDeg });
    expect(screens.angle).toBe(screens.range.rest);
    screens.setAngle(-30);
    expect(screens.angle).toBe(closed);
    screens.setAngle(0);
    expect(screens.angle).toBe(closed);
    screens.setAngle(200);
    expect(screens.angle).toBe(90);
    screens.setAngle(Number.NaN);
    expect(screens.angle).toBe(90);
    screens.dispose();
  });

  it("hides only the static blades, keeps the rails of the file, and draws one blade per kernel position", () => {
    const { house, viewer, building } = fakeScene(true);
    const screens = buildSlatScreens(viewer, house);
    const roles = building.children.map((c) => [c.userData.role, c.visible]);
    expect(roles.filter(([r]) => r === "screen_slats").every(([, v]) => v === false)).toBe(true);
    expect(roles.filter(([r]) => r === "screen_rail").every(([, v]) => v === true)).toBe(true);
    expect(screens.counts.slats).toBe(ctx.derived.screens.reduce((n, s) => n + s.blades.positions.length, 0));
    expect(screens.group.children.filter((c) => c.name.startsWith("rail_"))).toHaveLength(0);
    expect(screens.occluders()).toHaveLength(ctx.derived.screens.length);
    screens.dispose();
  });

  it("draws the rails itself for a file that has none (built before the rails were a role of their own)", () => {
    const { house, viewer } = fakeScene(false);
    const screens = buildSlatScreens(viewer, house);
    expect(screens.group.children.filter((c) => c.name.startsWith("rail_"))).toHaveLength(2 * ctx.derived.screens.length);
    screens.dispose();
  });

  it("turns each blade about its own vertical axis: positions stay, the chord turns by the angle", () => {
    const { house, viewer } = fakeScene(true);
    const screens = buildSlatScreens(viewer, house);
    const mesh = screens.occluders()[0] as THREE.InstancedMesh;
    const s = ctx.derived.screens[0];
    const at = (deg: number) => {
      screens.setAngle(deg);
      const m = new THREE.Matrix4(), p = new THREE.Vector3(), q = new THREE.Quaternion(), sc = new THREE.Vector3();
      mesh.getMatrixAt(0, m);
      m.decompose(p, q, sc);
      // the chord is local x; in the plan (house x, y) = scene (x, -z)
      const chord = new THREE.Vector3(1, 0, 0).applyQuaternion(q);
      return { p: p.clone(), plan: [chord.x, -chord.z] as const };
    };
    const a = at(30), b = at(90);
    expect(a.p.distanceTo(b.p)).toBeLessThan(1e-9);
    // a vertical screen runs along house y: at 90 degrees the chord is square to it (along x), at 30 it is 30 degrees off the axis
    const axis = s.orient === "v" ? [0, 1] : [1, 0];
    const angle = (v: readonly [number, number]) => (Math.acos(Math.min(1, Math.abs(v[0] * axis[0] + v[1] * axis[1]))) * 180) / Math.PI;
    expect(angle(a.plan)).toBeCloseTo(30, 6);
    expect(angle(b.plan)).toBeCloseTo(90, 6);
    screens.dispose();
  });
});
