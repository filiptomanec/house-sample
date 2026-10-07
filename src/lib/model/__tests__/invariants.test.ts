// Invariants of the model: areas add up, openings lie on walls, rooms are reachable, roof faces tile the roof,
// PV modules fit. Expected values are always computed from the model itself or by an independent method.
import { describe, expect, it } from "vitest";
import { AZ_KEYS, FURNITURE } from "../catalog";
import { azimuthInRange } from "../derive";
import { furnitureRect, inRect, ringArea, unionOf, wallBody, type Rect } from "../geom";
import { insetConvex, roofSurfaceAt } from "../roofs";
import { baseline, multiArea, pc, ring, snapRing } from "./helpers";

const { house, derived: d } = baseline();
const sum = (a: number[]): number => a.reduce((s, v) => s + v, 0);

describe("plan: areas add up", () => {
  it("rooms do not overlap, leave no holes and form one connected plan", () => {
    expect(d.overlaps).toEqual([]);
    expect(d.holes).toEqual([]);
    expect(d.components).toHaveLength(1);
  });

  it("net rooms + wall bodies cover exactly the footprint", () => {
    const bodies = d.walls.map((w) => wallBody(w, d.walls));
    const net = d.rooms.flatMap((r) => r.cleanRects);
    // the union of the net rooms and the walls is the footprint
    expect(unionOf([...net, ...bodies]).area).toBeCloseTo(d.outline.area, 6);
    // net rooms are disjoint
    expect(unionOf(net).area).toBeCloseTo(sum(d.rooms.map((r) => r.area)), 3); // room areas are rounded to 5 decimals
    // the wall bodies reach into a net room only at its reflex corners (corner artefact of at most (t/2)^2 each)
    let reflex = 0;
    for (const r of d.rooms) {
      for (const poly of unionOf(r.cleanRects).polygons) {
        poly.pts.forEach((p, i) => {
          const a = poly.pts[(i + poly.pts.length - 1) % poly.pts.length];
          const b = poly.pts[(i + 1) % poly.pts.length];
          const cross = (p[0] - a[0]) * (b[1] - p[1]) - (p[1] - a[1]) * (b[0] - p[0]);
          if ((cross < 0 && poly.area > 0) || (cross > 0 && poly.area < 0)) reflex++;
        });
      }
    }
    const overlap = unionOf(net).area + unionOf(bodies).area - unionOf([...net, ...bodies]).area;
    expect(overlap).toBeGreaterThanOrEqual(-1e-9);
    expect(overlap).toBeLessThanOrEqual(reflex * (house.wall.ext / 2) ** 2);
  });

  it("footprint = axis area + exterior wall band (half thickness outside the axes)", () => {
    // offsetting an orthogonal polygon outwards by t: A = A0 + t P0 + t^2 (convex - concave corners)
    const axis = unionOf(d.rooms.flatMap((r) => r.rects));
    const t = house.wall.ext / 2;
    let corners = 0;
    for (const poly of axis.polygons) {
      const pts = poly.pts;
      pts.forEach((p, i) => {
        const a = pts[(i + pts.length - 1) % pts.length];
        const b = pts[(i + 1) % pts.length];
        const cross = (p[0] - a[0]) * (b[1] - p[1]) - (p[1] - a[1]) * (b[0] - p[0]);
        corners += (cross > 0 ? 1 : -1) * (poly.area > 0 ? 1 : -1);
      });
    }
    expect(d.outline.area).toBeCloseTo(axis.area + t * axis.perimeter + t * t * corners, 6);
    expect(sum(d.rooms.map((r) => r.axisArea))).toBeCloseTo(axis.area, 3);
  });

  it("the outline polygon and its rectangle decomposition agree", () => {
    const outer = d.outline.polygons.filter((p) => p.area > 0);
    expect(outer).toHaveLength(1);
    expect(ringArea(outer[0].pts)).toBeCloseTo(d.outline.area, 6);
    expect(sum(d.outline.rects.map((r) => (r[2] - r[0]) * (r[3] - r[1])))).toBeCloseTo(d.outline.area, 6);
  });

  it("room volume = net area x clear height", () => {
    for (const r of d.rooms) expect(r.volume).toBeCloseTo(r.area * house.clearHeight, 3);
  });

  it("wall kinds follow the bearing axes", () => {
    for (const w of d.walls) {
      if (w.ext) {
        expect(w.kind).toBe("exterior");
        expect([w.lo, w.hi].filter((x) => x === null)).toHaveLength(1);
      } else {
        const axes = w.orient === "v" ? house.bearingAxes.x : house.bearingAxes.y;
        const onAxis = axes.some((a) => Math.abs(a - w.at) < 1e-4);
        expect(w.kind).toBe(onAxis ? "bearing" : "partition");
        expect(w.t).toBe(onAxis ? house.wall.bearing : house.wall.part);
      }
    }
  });
});

describe("openings", () => {
  it("every opening lies on a wall of the matching kind", () => {
    for (const o of d.openings) {
      expect(o.problem, o.id).toBeNull();
      const w = d.walls.find((x) => x.id === o.wallId);
      expect(w, o.id).toBeDefined();
      expect(o.from).toBeGreaterThanOrEqual(w!.from - 1e-9);
      expect(o.to).toBeLessThanOrEqual(w!.to + 1e-9);
      expect(w!.orient).toBe(o.orient);
      expect(Math.abs(w!.at - o.axis)).toBeLessThanOrEqual(0.01);
      if (o.kind === "door") expect(w!.ext).toBe(false);
      else expect(w!.ext).toBe(true);
    }
  });

  it("exterior openings carry the orientation of their wall, true azimuth includes the house bearing", () => {
    const bearing = house.location.houseAxisBearingDeg;
    for (const o of d.openings.filter((x) => x.exterior)) {
      expect(o.azimuthTrue).toBeCloseTo(((o.azimuth as number) + bearing) % 360, 9);
      expect(o.dir).toBe(AZ_KEYS[o.azimuth as number]);
    }
    for (const o of d.openings.filter((x) => !x.exterior)) {
      expect(o.azimuth).toBeNull();
      expect(o.connects).toHaveLength(2);
    }
  });

  it("room glazing adds up to the window and slider areas", () => {
    const fromRooms = sum(d.rooms.map((r) => r.glazing.total));
    const fromOpenings = sum(d.openings.filter((o) => o.exterior).map((o) => o.glazingArea));
    expect(fromRooms).toBeCloseTo(fromOpenings, 6);
    for (const r of d.rooms) expect(r.glazing.N + r.glazing.E + r.glazing.S + r.glazing.W).toBeCloseTo(r.glazing.total, 6);
  });

  it("blinds follow the shading rule", () => {
    const rule = house.shading.blinds;
    const heated = new Map(d.rooms.map((r) => [r.id, r.heated]));
    for (const o of d.openings) {
      const expected =
        o.exterior === true &&
        o.glazingArea > 0 &&
        (rule.kinds as string[]).includes(o.kind) &&
        heated.get(o.room as string) === true &&
        azimuthInRange(o.azimuthTrue as number, rule.azimuthFrom, rule.azimuthTo);
      expect(o.blind, o.id).toBe(expected);
    }
    // facings aggregate the same blinds
    expect(sum(Object.values(d.facings).map((f) => f.blindedGlazingArea))).toBeCloseTo(sum(d.openings.filter((o) => o.blind).map((o) => o.glazingArea)), 6);
  });
});

describe("access", () => {
  it("every room is reachable by doors from the main entrance (independent search)", () => {
    const adj = new Map<string, Set<string>>(d.rooms.map((r) => [r.id, new Set()]));
    for (const o of d.openings) {
      if (o.kind !== "door" || !o.connects) continue;
      const [a, b] = o.connects;
      if (a && b) {
        adj.get(a)!.add(b);
        adj.get(b)!.add(a);
      }
    }
    const entry = d.openings.find((o) => o.kind === "entry");
    expect(entry?.room).toBeTruthy();
    const seen = new Set([entry!.room as string]);
    const stack = [entry!.room as string];
    while (stack.length) {
      for (const n of adj.get(stack.pop()!)!) {
        if (seen.has(n)) continue;
        seen.add(n);
        stack.push(n);
      }
    }
    expect([...seen].sort()).toEqual(d.rooms.map((r) => r.id).sort());
    expect(d.access.unreachable).toEqual([]);
    expect(d.access.depth[d.access.entryRoom as string]).toBe(0);
    for (const e of d.access.edges) expect(Math.abs(d.access.depth[e.a] - d.access.depth[e.b])).toBeLessThanOrEqual(1);
  });
});

describe("roof faces", () => {
  const eaves = d.roofs.map((r) => r.eaveRect);
  const poly = (r: Rect): [number, number][] => ring([[r[0], r[1]], [r[2], r[1]], [r[2], r[3]], [r[0], r[3]]]);

  it("faces are convex, counter-clockwise and planar", () => {
    for (const f of d.roofPlanes) {
      expect(f.pts.length).toBeGreaterThanOrEqual(3);
      expect(ringArea(f.pts)).toBeGreaterThan(0);
      f.pts.forEach((p, i) => {
        const a = f.pts[(i + f.pts.length - 1) % f.pts.length];
        const b = f.pts[(i + 1) % f.pts.length];
        expect((p[0] - a[0]) * (b[1] - p[1]) - (p[1] - a[1]) * (b[0] - p[0]), `${f.id} vertex ${i}`).toBeGreaterThanOrEqual(-1e-9);
      });
      // all vertices lie on the plane through the first three: n . (p - p0) = 0
      const n = f.frame.n;
      for (const q of f.pts3) expect(n[0] * (q[0] - f.pts3[0][0]) + n[1] * (q[1] - f.pts3[0][1]) + n[2] * (q[2] - f.pts3[0][2])).toBeCloseTo(0, 9);
      // slope from the normal equals the pitch of the roof
      expect((Math.acos(n[2]) * 180) / Math.PI).toBeCloseTo(f.pitch, 7);
      expect(f.edges).toHaveLength(f.pts.length);
    }
  });

  it("faces do not overlap and tile the roofs: area sum = area of the union of the eave rectangles (polygon-clipping)", () => {
    const polys = eaves.map((r) => [poly(r)] as never);
    const union = pc.union(polys[0], ...polys.slice(1));
    const faceSum = sum(d.roofPlanes.map((f) => f.planArea));
    expect(faceSum).toBeCloseTo(multiArea(union), 6);
    // every pair of faces: overlap area 0
    for (let i = 0; i < d.roofPlanes.length; i++) {
      for (let j = i + 1; j < d.roofPlanes.length; j++) {
        const inter = pc.intersection([snapRing(d.roofPlanes[i].pts)] as never, [snapRing(d.roofPlanes[j].pts)] as never);
        expect(multiArea(inter), `${d.roofPlanes[i].id} x ${d.roofPlanes[j].id}`).toBeLessThan(1e-6);
      }
    }
  });

  it("the faces cover the footprint of the house", () => {
    let covered = 0;
    for (const r of d.outline.rects) {
      for (const f of d.roofPlanes) covered += multiArea(pc.intersection([poly(r)] as never, [snapRing(f.pts)] as never));
    }
    expect(covered).toBeCloseTo(d.outline.area, 6);
  });

  it("the roof surface is the maximum of the hip roofs (sampled)", () => {
    const hips = house.roofs.map((r) => ({
      r,
      o: r.overhang ?? 0,
      wt: r.wallTop ?? house.clearHeight + house.slab,
      tan: Math.tan((r.pitch * Math.PI) / 180),
    }));
    const bb = d.bbox;
    let checked = 0;
    for (let x = bb.x0 + 0.113; x < bb.x1; x += 0.377) {
      for (let y = bb.y0 + 0.131; y < bb.y1; y += 0.391) {
        let best = -Infinity;
        for (const h of hips) {
          const [x0, y0, x1, y1] = h.r.rect;
          const dd = Math.min(x - x0, x1 - x, y - y0, y1 - y);
          if (dd < -h.o) continue;
          best = Math.max(best, h.wt + h.tan * dd);
        }
        const hit = roofSurfaceAt(d.roofPlanes, x, y);
        if (best === -Infinity) expect(hit, `${x},${y}`).toBeNull();
        else {
          expect(hit, `${x},${y}`).not.toBeNull();
          expect(hit!.z).toBeCloseTo(best, 7);
          checked++;
        }
      }
    }
    expect(checked).toBeGreaterThan(100);
  });

  it("every point is covered by exactly one face (away from edges)", () => {
    const bb = d.bbox;
    for (let x = bb.x0 + 0.0713; x < bb.x1; x += 0.311) {
      for (let y = bb.y0 + 0.0937; y < bb.y1; y += 0.297) {
        const n = d.roofPlanes.filter((f) => {
          return f.pts.every((p, i) => {
            const q = f.pts[(i + 1) % f.pts.length];
            const l = Math.hypot(q[0] - p[0], q[1] - p[1]);
            return ((q[0] - p[0]) * (y - p[1]) - (q[1] - p[1]) * (x - p[0])) / l > -1e-7;
          });
        }).length;
        const inside = eaves.some((r) => inRect(r, x, y));
        if (inside) expect(n, `${x},${y}`).toBeGreaterThanOrEqual(1);
        if (n > 1) {
          // allowed only within 1e-3 of a shared edge
          const near = d.roofPlanes.some((f) => f.pts.some((p, i) => {
            const q = f.pts[(i + 1) % f.pts.length];
            const l = Math.hypot(q[0] - p[0], q[1] - p[1]);
            return Math.abs(((q[0] - p[0]) * (y - p[1]) - (q[1] - p[1]) * (x - p[0])) / l) < 1e-3;
          }));
          expect(near, `${x},${y} in ${n} faces`).toBe(true);
        }
        if (!inside) expect(n).toBe(0);
      }
    }
  });

  it("face areas are consistent with the slope and the 3D vertices", () => {
    for (const f of d.roofPlanes) {
      expect(f.area).toBeCloseTo(f.planArea / Math.cos((f.pitch * Math.PI) / 180), 9);
      // area of the planar 3D polygon by the cross-product sum
      let nx = 0;
      let ny = 0;
      let nz = 0;
      f.pts3.forEach((p, i) => {
        const q = f.pts3[(i + 1) % f.pts3.length];
        nx += p[1] * q[2] - p[2] * q[1];
        ny += p[2] * q[0] - p[0] * q[2];
        nz += p[0] * q[1] - p[1] * q[0];
      });
      expect(Math.hypot(nx, ny, nz) / 2).toBeCloseTo(f.area, 7);
      // (u, v) coordinates reproduce the 3D vertices
      f.uv.forEach(([u, v], i) => {
        for (let k = 0; k < 3; k++) expect(f.frame.origin[k] + u * f.frame.u[k] + v * f.frame.v[k]).toBeCloseTo(f.pts3[i][k], 6);
      });
      // edge lengths
      f.edges.forEach((e, i) => {
        const p = f.pts3[i];
        const q = f.pts3[(i + 1) % f.pts3.length];
        expect(e.length).toBeCloseTo(Math.hypot(q[0] - p[0], q[1] - p[1], q[2] - p[2]), 9);
      });
    }
  });

  it("orientation of the faces: downslope azimuth, true azimuth and normal agree", () => {
    for (const f of d.roofPlanes) {
      expect(f.azimuthTrue).toBeCloseTo((f.azimuth + house.location.houseAxisBearingDeg) % 360, 9);
      // horizontal part of the normal points downslope
      const nxy = Math.atan2(f.frame.n[0], f.frame.n[1]);
      const az = ((nxy * 180) / Math.PI + 360) % 360;
      expect(az).toBeCloseTo(f.azimuth, 7);
    }
  });

  it("valleys and ridges are where two surfaces meet: valley edges are shared with a face of another roof or plane", () => {
    const valleys = d.roofPlanes.flatMap((f) => f.edges.map((e, i) => ({ f, e, i }))).filter((x) => x.e.kind === "valley");
    expect(valleys.length).toBeGreaterThan(0);
    for (const { f, i } of valleys) {
      const a = f.pts3[i];
      const b = f.pts3[(i + 1) % f.pts3.length];
      const mid: [number, number, number] = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
      // another face has the same 3D point on its boundary
      const partner = d.roofPlanes.find((g) => g !== f && g.plane !== f.plane && g.pts3.some((p, k) => {
        const q = g.pts3[(k + 1) % g.pts3.length];
        const t = ((mid[0] - p[0]) * (q[0] - p[0]) + (mid[1] - p[1]) * (q[1] - p[1])) / ((q[0] - p[0]) ** 2 + (q[1] - p[1]) ** 2);
        if (t < -1e-9 || t > 1 + 1e-9) return false;
        const x = p[0] + t * (q[0] - p[0]);
        const y = p[1] + t * (q[1] - p[1]);
        const z = p[2] + t * (q[2] - p[2]);
        return Math.hypot(x - mid[0], y - mid[1], z - mid[2]) < 1e-6;
      }));
      expect(partner, `valley of ${f.id} edge ${i}`).toBeDefined();
    }
  });

  it("downpipes stand at the low ends of the valleys", () => {
    const pipes = house.roof.downpipes;
    for (const f of d.roofPlanes) {
      f.edges.forEach((e, i) => {
        if (e.kind !== "valley") return;
        const a = f.pts3[i];
        const b = f.pts3[(i + 1) % f.pts3.length];
        const low = a[2] <= b[2] ? a : b;
        expect(pipes.some((p) => Math.hypot(p.x - low[0], p.y - low[1]) < 0.15), `valley of ${f.id}`).toBe(true);
      });
    }
  });

  it("light pipes sit on the roof surface above a room", () => {
    for (const lp of d.lightpipes) {
      expect(lp.room).not.toBeNull();
      expect(lp.face).not.toBeNull();
      const hit = roofSurfaceAt(d.roofPlanes, lp.x, lp.y);
      expect(lp.z).toBeCloseTo(hit!.z, 3);
    }
  });
});

describe("photovoltaics", () => {
  const spec = house.equipment.pv;
  const faces = new Map(d.roofPlanes.map((f) => [f.id, f]));

  it("modules fit: inside the face inset by the setbacks, on the selected planes, not overlapping", () => {
    expect(d.pv.count).toBeGreaterThan(0);
    for (const p of d.pv.panels) {
      const f = faces.get(p.face)!;
      expect(spec.layout.facings).toContain(f.side);
      const offsets = f.edges.map((e) => (e.kind === "seam" ? 0 : spec.layout.setback[e.kind]));
      const usable = insetConvex(f.uv, offsets)!;
      const [u0, v0, u1, v1] = p.uv;
      for (const [u, v] of [[u0, v0], [u1, v0], [u1, v1], [u0, v1]]) {
        usable.forEach((a, i) => {
          const b = usable[(i + 1) % usable.length];
          const l = Math.hypot(b[0] - a[0], b[1] - a[1]);
          expect(((b[0] - a[0]) * (v - a[1]) - (b[1] - a[1]) * (u - a[0])) / l, `${p.id}`).toBeGreaterThanOrEqual(-1e-9);
        });
      }
      // module size in either orientation
      const w = u1 - u0;
      const h = v1 - v0;
      const m = spec.module;
      const portrait = Math.abs(w - m.width) < 1e-9 && Math.abs(h - m.height) < 1e-9;
      const landscape = Math.abs(w - m.height) < 1e-9 && Math.abs(h - m.width) < 1e-9;
      expect(portrait || landscape).toBe(true);
      // 3D corners lie on the roof plane
      for (const c of p.corners) expect(roofSurfaceAt([f], c[0], c[1])!.z).toBeCloseTo(c[2], 6);
    }
    for (let i = 0; i < d.pv.panels.length; i++) {
      for (let j = i + 1; j < d.pv.panels.length; j++) {
        const a = d.pv.panels[i];
        const b = d.pv.panels[j];
        if (a.face !== b.face) continue;
        const overlapU = Math.min(a.uv[2], b.uv[2]) - Math.max(a.uv[0], b.uv[0]);
        const overlapV = Math.min(a.uv[3], b.uv[3]) - Math.max(a.uv[1], b.uv[1]);
        expect(overlapU > 1e-9 && overlapV > 1e-9, `${a.id} x ${b.id}`).toBe(false);
      }
    }
  });

  it("modules keep the clearance around light pipes", () => {
    for (const lp of d.lightpipes) {
      for (const p of d.pv.panels) {
        const f = faces.get(p.face)!;
        const z = roofSurfaceAt([f], lp.x, lp.y)?.z;
        if (z === undefined) continue; // light pipe is not on this face
        const o = f.frame.origin;
        const dv: [number, number, number] = [lp.x - o[0], lp.y - o[1], z - o[2]];
        const uc = dv[0] * f.frame.u[0] + dv[1] * f.frame.u[1] + dv[2] * f.frame.u[2];
        const vc = dv[0] * f.frame.v[0] + dv[1] * f.frame.v[1] + dv[2] * f.frame.v[2];
        const nearestU = Math.min(Math.max(uc, p.uv[0]), p.uv[2]);
        const nearestV = Math.min(Math.max(vc, p.uv[1]), p.uv[3]);
        expect(Math.hypot(uc - nearestU, vc - nearestV)).toBeGreaterThanOrEqual(lp.diameter / 2 + spec.layout.obstacleClearance - 1e-6);
      }
    }
  });

  it("power and area follow from the module data", () => {
    expect(d.pv.kwp).toBeCloseTo((d.pv.count * spec.module.wp) / 1000, 9);
    expect(d.pv.area).toBeCloseTo(d.pv.count * spec.module.width * spec.module.height, 9);
    expect(sum(d.pv.byFace.map((b) => b.count))).toBe(d.pv.count);
    for (const b of d.pv.byFace) expect(sum(b.rows)).toBe(b.count);
  });
});

describe("aggregates", () => {
  it("facings add up to the walls, roofs and openings", () => {
    const facings = Object.values(d.facings);
    expect(sum(facings.map((f) => f.wallLength))).toBeCloseTo(sum(d.walls.filter((w) => w.ext).map((w) => w.len)), 6);
    expect(sum(facings.map((f) => f.roofArea))).toBeCloseTo(sum(d.roofPlanes.map((f) => f.area)), 3);
    expect(sum(facings.map((f) => f.glazingArea))).toBeCloseTo(sum(d.openings.filter((o) => o.exterior).map((o) => o.glazingArea)), 6);
  });

  it("furniture footprints come from the catalogue", () => {
    d.furniture.forEach((f, i) => {
      const src = house.furniture[i];
      expect(f.rect).toEqual(furnitureRect(src, FURNITURE).rect);
    });
  });

  it("bounding box contains the outline and the highest roof point", () => {
    const o = d.outline.bbox!;
    expect(d.bbox.x0).toBeLessThanOrEqual(o.x0);
    expect(d.bbox.x1).toBeGreaterThanOrEqual(o.x1);
    expect(d.bbox.z1).toBeCloseTo(Math.max(...d.roofPlanes.map((f) => f.zMax)), 3);
  });
});
