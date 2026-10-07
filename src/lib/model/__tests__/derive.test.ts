// Fields added by the kernel on top of the concept/1 geometry: orientation, zones, labels, assemblies, purity.
import { describe, expect, it } from "vitest";
import { DIR_AZIMUTH, DIRS, U_LIMITS, ZONE_KEYS } from "../catalog";
import { assemblyU, derive } from "../derive";
import { signedDistance } from "../geom";
import { baseline, cloneHouse } from "./helpers";

const { house, derived: d } = baseline();

describe("orientation", () => {
  it("facings carry house and true azimuths", () => {
    for (const dir of DIRS) {
      const f = d.facings[dir];
      expect(f.houseAzimuthDeg).toBe(DIR_AZIMUTH[dir]);
      expect(f.azimuthDeg).toBe((DIR_AZIMUTH[dir] + house.location.houseAxisBearingDeg) % 360);
    }
    expect(d.houseAxisBearingDeg).toBe(house.location.houseAxisBearingDeg);
  });

  it("rotating the house changes azimuths only, never the plan", () => {
    const rotated = cloneHouse();
    rotated.location.houseAxisBearingDeg = 100;
    const r = derive(rotated);
    expect(r.rooms.map((x) => x.area)).toEqual(d.rooms.map((x) => x.area));
    expect(r.walls.map((w) => [w.id, w.len])).toEqual(d.walls.map((w) => [w.id, w.len]));
    expect(r.outline).toEqual(d.outline);
    expect(r.facings.S.azimuthDeg).toBe((180 + 100) % 360);
    expect(r.roofPlanes[0].azimuthTrue).toBe((r.roofPlanes[0].azimuth + 100) % 360);
    // the blind rule works on true azimuth, so it can select different openings
    expect(r.openings.filter((o) => o.blind).map((o) => o.id)).not.toEqual(d.openings.filter((o) => o.blind).map((o) => o.id));
  });

  it("exterior openings know the roof above them (overhang, eave height, wall top)", () => {
    for (const o of d.openings) {
      if (!o.exterior) {
        expect(o.overhang).toBeNull();
        continue;
      }
      expect(o.overhang, o.id).not.toBeNull();
      const roof = d.roofs.find((r) => r.wallTop === o.overhang!.wallTop && r.overhang === o.overhang!.depth && r.eaveHeight === o.overhang!.eaveHeight);
      expect(roof, o.id).toBeDefined();
      // the eave is below the head of the opening only if the roof is very low: not the case for a house with a ceiling slab
      expect(o.overhang!.wallTop).toBeGreaterThan(o.head);
    }
  });

  it("the house frame is right-handed: the south roof plane descends towards -y", () => {
    const s = d.roofPlanes.find((f) => f.side === "S")!;
    const lowest = s.pts3.reduce((a, b) => (b[2] < a[2] ? b : a));
    const highest = s.pts3.reduce((a, b) => (b[2] > a[2] ? b : a));
    expect(lowest[1]).toBeLessThan(highest[1]);
  });
});

describe("rooms", () => {
  it("zones follow the zone lists, heated follows the type, roles pass through", () => {
    for (const r of d.rooms) {
      const src = house.rooms.find((x) => x.id === r.id)!;
      const zones = ZONE_KEYS.filter((z) => z !== "outdoor" && (house.zones[z].types as string[]).includes(src.type));
      expect(zones).toEqual([r.zone]);
      expect(r.heated).toBe(src.type !== "garage");
      expect(r.role).toBe(src.role);
      expect(r.name).toEqual(src.name);
    }
  });

  it("every label lies inside its room and the radius is the distance to the room boundary", () => {
    for (const r of d.rooms) {
      const inside = r.cleanRects.some((q) => r.label.x >= q[0] - 1e-9 && r.label.x <= q[2] + 1e-9 && r.label.y >= q[1] - 1e-9 && r.label.y <= q[3] + 1e-9);
      expect(inside, r.id).toBe(true);
      expect(r.label.r).toBeLessThanOrEqual(r.minWidth / 2 + 1e-6 + Math.max(0, r.mainClear.w, r.mainClear.d));
      expect(r.label.r).toBeGreaterThan(0.2);
      expect(r.outlineDistance).toBeGreaterThanOrEqual(0);
    }
    // a rectangular room: the largest circle has the radius of half the short side
    const rect = d.rooms.find((r) => r.cleanRects.length === 1)!;
    const q = rect.cleanRects[0];
    expect(rect.label.r).toBeCloseTo(Math.min(q[2] - q[0], q[3] - q[1]) / 2, 2);
    expect(signedDistance([rect.label.x, rect.label.y], [[[q[0], q[1]], [q[2], q[1]], [q[2], q[3]], [q[0], q[3]]]])).toBeGreaterThan(0);
  });

  it("exterior wall length and area come from the exterior walls of the room", () => {
    for (const r of d.rooms) {
      const ws = d.walls.filter((w) => w.ext && w.room === r.id);
      expect(r.exteriorWallLength).toBeCloseTo(ws.reduce((s, w) => s + w.len, 0), 6);
      expect(r.exteriorWallArea).toBeCloseTo(ws.reduce((s, w) => s + w.len * (w.height ?? 0), 0), 6);
    }
  });
});

describe("assemblies", () => {
  const independentU = (key: keyof typeof house.assemblies, ignoreOutside = false): number => {
    const a = house.assemblies[key];
    const vent = a.layers.findIndex((l) => l.ventilated);
    const layers = ignoreOutside && vent >= 0 ? a.layers.slice(vent + 1) : a.layers;
    const R = layers.reduce((s, l) => s + (l.lambda ? l.t / l.lambda : (l.r ?? 0)), 0);
    return 1 / (a.rsi + R + (ignoreOutside ? a.rsi : a.rse));
  };

  it("U-values follow EN ISO 6946 (layers outside a ventilated layer are ignored)", () => {
    expect(d.assemblies.exteriorWall.U).toBeCloseTo(independentU("exteriorWall"), 3);
    expect(d.assemblies.groundFloor.U).toBeCloseTo(independentU("groundFloor"), 3);
    expect(d.assemblies.roof.U).toBeCloseTo(independentU("roof", true), 3);
    // the roof without the rule would be wrong: the steel sheet and the gap would count
    expect(Math.abs(independentU("roof", false) - independentU("roof", true))).toBeGreaterThan(0);
  });

  it("the envelope meets the low-energy targets of the project", () => {
    expect(d.assemblies.exteriorWall.U).toBeLessThanOrEqual(U_LIMITS.exteriorWall);
    expect(d.assemblies.roof.U).toBeLessThanOrEqual(U_LIMITS.roof);
    expect(d.assemblies.groundFloor.U).toBeLessThanOrEqual(U_LIMITS.groundFloor);
    expect(house.windows.Uw).toBeLessThanOrEqual(1.0);
  });

  it("wall thicknesses equal the plan", () => {
    expect(d.assemblies.exteriorWall.thickness).toBeCloseTo(house.wall.ext, 9);
    expect(d.assemblies.bearingWall.thickness).toBeCloseTo(house.wall.bearing, 9);
    expect(d.assemblies.partitionWall.thickness).toBeCloseTo(house.wall.part, 9);
  });

  it("assemblyU handles a plain two-layer wall", () => {
    const a = {
      name: { cs: "a", en: "a" },
      rsi: 0.13,
      rse: 0.04,
      layers: [
        { id: "x", name: { cs: "a", en: "a" }, t: 0.2, lambda: 0.1 },
        { id: "y", name: { cs: "a", en: "a" }, t: 0.1, lambda: 0.5 },
      ],
    };
    const r = assemblyU(a);
    expect(r.thickness).toBeCloseTo(0.3, 12);
    expect(r.R).toBeCloseTo(2.2, 12);
    expect(r.U).toBeCloseTo(1 / 2.37, 4);
  });
});

describe("purity", () => {
  it("derive does not mutate its input and is deterministic", () => {
    const h = cloneHouse();
    const before = JSON.stringify(h);
    const a = derive(h);
    const b = derive(h);
    expect(JSON.stringify(h)).toBe(before);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("the input hash is stored when given", () => {
    expect(derive(cloneHouse(), { inputHash: "abc" }).inputHash).toBe("abc");
    expect(derive(cloneHouse()).inputHash).toBeNull();
    expect(derive(cloneHouse()).schemaVersion).toBe(1);
  });

  it("compatibility views for the pipeline mirror the main data", () => {
    expect(d.netRooms.map((r) => r.id)).toEqual(d.rooms.map((r) => r.id));
    for (const n of d.netRooms) expect(n.rects).toEqual(d.rooms.find((r) => r.id === n.id)!.cleanRects);
    expect(d.outer?.pts).toEqual(d.outline.polygons.filter((p) => p.area > 0)[0].pts);
  });
});

describe("outdoor, screens, light pipes", () => {
  it("outdoor areas keep their area and zone", () => {
    for (const o of d.outdoor) {
      const src = house.outdoor.find((x) => x.id === o.id)!;
      expect(o.area).toBeCloseTo((src.rect[2] - src.rect[0]) * (src.rect[3] - src.rect[1]), 9);
      expect(o.zone).toBe("outdoor");
      expect(house.zones.outdoor.types as string[]).toContain(o.type);
    }
  });
  it("screens face away from the centre of the house and keep their true azimuth", () => {
    const b = d.outline.bbox!;
    for (const s of d.screens) {
      const centre = s.orient === "v" ? (b.x0 + b.x1) / 2 : (b.y0 + b.y1) / 2;
      const outward = s.at < centre ? -1 : 1;
      const expected = s.orient === "v" ? (outward < 0 ? 270 : 90) : outward < 0 ? 180 : 0;
      expect(s.azimuth).toBe(expected);
      expect(s.azimuthTrue).toBe((expected + house.location.houseAxisBearingDeg) % 360);
      expect(s.length).toBeCloseTo(Math.abs(s.to - s.from), 9);
    }
  });
  it("every light pipe has the diameter of the roof specification", () => {
    expect(d.lightpipes).toHaveLength(house.lightpipes.length);
    for (const lp of d.lightpipes) expect(lp.diameter).toBe(house.roof.lightpipes.diameter);
  });
});

describe("cameras", () => {
  type V3 = [number, number, number];
  const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const dot = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const unit = (a: V3): V3 => {
    const l = Math.hypot(...a);
    return [a[0] / l, a[1] / l, a[2] / l];
  };
  /** Normalised device coordinates of a point seen by a perspective camera (z up), or null behind the camera. */
  function project(pos: V3, target: V3, fov: number, aspect: number, p: V3): [number, number] | null {
    const f = unit(sub(target, pos));
    const r = unit(cross(f, [0, 0, 1]));
    const u = cross(r, f);
    const v = sub(p, pos);
    const z = dot(v, f);
    if (z <= 0) return null;
    const t = Math.tan((fov * Math.PI) / 360);
    return [dot(v, r) / (z * t * aspect), dot(v, u) / (z * t)];
  }

  it("positions are finite and differ from the targets; each camera has what its kind needs", () => {
    expect(house.cameras.length).toBeGreaterThan(3);
    for (const c of house.cameras) {
      expect(c.position.every(Number.isFinite)).toBe(true);
      expect(Math.hypot(...sub(c.position as V3, c.target as V3))).toBeGreaterThan(0.5);
      if (c.kind === "perspective") expect(c.fov).toBeDefined();
      else expect(c.orthoHeight).toBeDefined();
    }
  });

  it("the cameras for the Open Graph image show the whole building (1200 x 630)", () => {
    const b = d.bbox;
    const corners: V3[] = [];
    for (const x of [b.x0, b.x1]) for (const y of [b.y0, b.y1]) for (const z of [b.z0, b.z1]) corners.push([x, y, z]);
    const og = house.cameras.filter((c) => c.use.includes("og"));
    expect(og.length).toBeGreaterThan(0);
    for (const c of og) {
      for (const p of corners) {
        const n = project(c.position as V3, c.target as V3, c.fov as number, 1200 / 630, p);
        expect(n, `${c.id} ${p}`).not.toBeNull();
        expect(Math.abs(n![0]), `${c.id} x ${p}`).toBeLessThanOrEqual(1);
        expect(Math.abs(n![1]), `${c.id} y ${p}`).toBeLessThanOrEqual(1);
      }
    }
  });

  it("the web and render cameras outside the house look at the building", () => {
    const b = d.bbox;
    for (const c of house.cameras) {
      if (c.kind !== "perspective") continue;
      const inside = c.position[0] > b.x0 && c.position[0] < b.x1 && c.position[1] > b.y0 && c.position[1] < b.y1;
      if (inside) continue; // interior views look at a room, not at the whole building
      const centre: V3 = [(b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2, b.z1 / 2];
      const n = project(c.position as V3, c.target as V3, c.fov as number, 16 / 9, centre);
      expect(n, c.id).not.toBeNull();
      expect(Math.abs(n![0]), c.id).toBeLessThan(1);
      expect(Math.abs(n![1]), c.id).toBeLessThan(1);
    }
  });
});
