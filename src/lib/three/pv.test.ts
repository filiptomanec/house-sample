import { describe, expect, it } from "vitest";
import { getHouseContext } from "./context";
import { BATTERY_SPEC, PV_SPEC, batteryModuleKWh, batteryModules, batteryMount, defaultPvConfig, moduleFrame, readPvConfig } from "./pv";

const ctx = getHouseContext();

describe("pv configuration", () => {

  it("the default configuration draws the layout of the model and the default battery", () => {
    const cfg = defaultPvConfig(ctx);
    expect(cfg.panels).toBe(ctx.derived.pv.panels);
    expect(cfg.panels.length).toBe(ctx.derived.pv.count);
    const def = ctx.house.equipment.battery.options.find((o) => o.id === ctx.house.equipment.battery.default)!;
    expect(cfg.batteryKWh).toBe(def.capacityKwh);
  });

  it("one battery module is the smallest real option and every option is a whole number of modules", () => {
    const m = batteryModuleKWh(ctx);
    expect(m).toBeGreaterThan(0);
    for (const o of ctx.house.equipment.battery.options) {
      expect(batteryModules(ctx, o.capacityKwh) * m).toBeCloseTo(o.capacityKwh, 9);
    }
    expect(batteryModules(ctx, 0)).toBe(0);
    expect(batteryModules(ctx, -3)).toBe(0);
  });
});

describe("readPvConfig", () => {
  it("falls back to the model's own layout without saved settings (on the server, or before the energy calculation exists)", () => {
    const cfg = readPvConfig(ctx), def = defaultPvConfig(ctx);
    expect(cfg.panels.length).toBe(def.panels.length);
    expect(cfg.batteryKWh).toBe(def.batteryKWh);
  });
});

describe("moduleFrame", () => {
  const faces = new Map(ctx.derived.roofPlanes.map((f) => [f.id, f]));
  const mod = ctx.house.equipment.pv.module;

  it("has panels to check", () => {
    expect(ctx.derived.pv.panels.length).toBeGreaterThan(0);
  });

  it("puts every module on its roof face: the normal is the face normal and the corners lift by the rail height above the plane", () => {
    for (const p of ctx.derived.pv.panels) {
      const face = faces.get(p.face)!;
      const f = moduleFrame(p.corners, PV_SPEC.lift);
      face.frame.n.forEach((c, i) => expect(f.normal[i], p.id).toBeCloseTo(c, 6));
      // independent: the distance of the lifted centre from the roof plane is the lift
      const o = face.frame.origin, n = face.frame.n;
      const d = (f.centre[0] - o[0]) * n[0] + (f.centre[1] - o[1]) * n[1] + (f.centre[2] - o[2]) * n[2];
      expect(d, p.id).toBeCloseTo(PV_SPEC.lift, 6);
    }
  });

  it("has the size of the module, its long side as the long axis, in the plane of the face", () => {
    const [longSide, shortSide] = [Math.max(mod.width, mod.height), Math.min(mod.width, mod.height)];
    for (const p of ctx.derived.pv.panels) {
      const f = moduleFrame(p.corners, 0);
      expect(f.length, p.id).toBeCloseTo(longSide, 6);
      expect(f.width, p.id).toBeCloseTo(shortSide, 6);
      expect(f.long[0] * f.normal[0] + f.long[1] * f.normal[1] + f.long[2] * f.normal[2], p.id).toBeCloseTo(0, 6);
      expect(Math.hypot(...f.long)).toBeCloseTo(1, 9);
    }
  });

  it("keeps every panel inside its roof face seen from above (the lift is along the normal, a few centimetres)", () => {
    const inside = (x: number, y: number, ring: readonly (readonly [number, number])[]) => {
      let c = false;
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) if (ring[i][1] > y !== ring[j][1] > y && x < ((ring[j][0] - ring[i][0]) * (y - ring[i][1])) / (ring[j][1] - ring[i][1]) + ring[i][0]) c = !c;
      return c;
    };
    for (const p of ctx.derived.pv.panels) {
      const face = faces.get(p.face)!;
      for (const c of p.corners) expect(inside(c[0], c[1], face.pts) || face.pts.some((q) => Math.hypot(q[0] - c[0], q[1] - c[1]) < 1e-6), p.id).toBe(true);
    }
  });
});

describe("batteryMount", () => {
  const mount = batteryMount(ctx);
  const room = ctx.derived.rooms.find((r) => r.role === "plant")!;

  it("finds a stretch in the plant room", () => {
    expect(mount).not.toBeNull();
    expect(mount!.room).toBe(room.id);
    expect(ctx.derived.walls.some((w) => w.id === mount!.wallId)).toBe(true);
    expect(mount!.length).toBeGreaterThanOrEqual(BATTERY_SPEC.moduleWidth);
  });

  it("stands on the face of a wall of the room, turned into the room, along the wall", () => {
    const m = mount!;
    expect(m.along[0] * m.normal[0] + m.along[1] * m.normal[1]).toBeCloseTo(0, 12);
    expect(Math.hypot(...m.normal)).toBeCloseTo(1, 12);
    const inRoom = (x: number, y: number) => room.cleanRects.some(([x0, y0, x1, y1]) => x > x0 - 1e-6 && x < x1 + 1e-6 && y > y0 - 1e-6 && y < y1 + 1e-6);
    // the centre of the stretch is on the net outline of the room (the wall face), and a step into the room is inside it
    expect(inRoom(m.origin[0], m.origin[1])).toBe(true);
    expect(inRoom(m.origin[0] + m.normal[0] * 0.1, m.origin[1] + m.normal[1] * 0.1)).toBe(true);
    expect(inRoom(m.origin[0] - m.normal[0] * 0.1, m.origin[1] - m.normal[1] * 0.1)).toBe(false);
  });

  it("is free of openings and of furniture over its whole length and depth", () => {
    const m = mount!;
    const half = m.length / 2, depth = BATTERY_SPEC.moduleDepth;
    const rect = [
      Math.min(m.origin[0] - m.along[0] * half, m.origin[0] + m.along[0] * half + m.normal[0] * depth, m.origin[0] + m.normal[0] * depth),
      Math.min(m.origin[1] - m.along[1] * half, m.origin[1] + m.along[1] * half + m.normal[1] * depth, m.origin[1] + m.normal[1] * depth),
      Math.max(m.origin[0] - m.along[0] * half, m.origin[0] + m.along[0] * half + m.normal[0] * depth, m.origin[0] + m.normal[0] * depth),
      Math.max(m.origin[1] - m.along[1] * half, m.origin[1] + m.along[1] * half + m.normal[1] * depth, m.origin[1] + m.normal[1] * depth),
    ];
    const hit = (a: number[], b: number[]) => a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3];
    for (const f of ctx.derived.furniture.filter((x) => x.room === room.id)) expect(hit(rect, f.rect), `furniture ${f.index}`).toBe(false);
    const wall = ctx.derived.walls.find((w) => w.id === m.wallId)!;
    for (const o of ctx.derived.openings.filter((x) => x.wallId === wall.id)) {
      const lo = wall.orient === "h" ? rect[0] : rect[1], hi = wall.orient === "h" ? rect[2] : rect[3];
      expect(lo < o.to && o.from < hi, `opening ${o.id}`).toBe(false);
    }
  });

  it("returns nothing when the model has no plant room", () => {
    const none = { ...ctx, derived: { ...ctx.derived, rooms: ctx.derived.rooms.map((r) => ({ ...r, role: r.role === "plant" ? undefined : r.role })) } };
    expect(batteryMount(none)).toBeNull();
  });
});
