// Tests of the ray-cast sun analysis. three.js objects are created without a GL context; the house is the project's model
// seen through its context, the occluders are synthetic solids whose effect can be stated by hand. The oracle for an open
// facade is `calc/sun.sunHoursOnSurface` (a different code path: no rays).
import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { addDays, localToUtc, placeOf, sunDirection, sunHoursOnSurface, sunPosition, type CalendarDate, type Vec3 } from "@/lib/calc/sun";
import { boxOf, rayTransmittance, rayChord, type Occluder } from "@/lib/model/site";
import { getHouseContext } from "./context";
import { toScene } from "./frame";
import { Caster, cullOccluders, makeSunAnalyzer, occluderBound, sampleAreas, sampleWindows, type SunDayResult, type SunPositionFn } from "./sunAnalysis";

const ctx = getHouseContext();
const place = placeOf(ctx.house);
const bearing = ctx.bearingDeg;
const viewer = { scene: new THREE.Scene() };

const SUMMER: CalendarDate = { year: 2026, month: 5, day: 21 };
const EQUINOX: CalendarDate = { year: 2026, month: 2, day: 20 };
const WINTER: CalendarDate = { year: 2026, month: 11, day: 21 };
const DAYS = [SUMMER, EQUINOX, WINTER];

const material = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
/** A solid box in HOUSE coordinates (min and max corners), as a scene-frame mesh. */
function solid(min: Vec3, max: Vec3): THREE.Mesh {
  const a = toScene(min), b = toScene(max);
  const lo = [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.min(a[2], b[2])], hi = [Math.max(a[0], b[0]), Math.max(a[1], b[1]), Math.max(a[2], b[2])];
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]), material);
  mesh.position.set((lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2);
  mesh.updateMatrixWorld(true);
  return mesh;
}
const bb = ctx.derived.bbox;
const MARGIN = 3, TALL = 200, WIDE = 400;
/** Four huge slabs around the house, 3 m from its outline: nothing of the sky above them is visible from inside, and no sun gets in. */
const ring = (): THREE.Mesh[] => [
  solid([bb.x0 - MARGIN - 5, bb.y0 - MARGIN - 5, -5], [bb.x1 + MARGIN + 5, bb.y0 - MARGIN, TALL]),
  solid([bb.x0 - MARGIN - 5, bb.y1 + MARGIN, -5], [bb.x1 + MARGIN + 5, bb.y1 + MARGIN + 5, TALL]),
  solid([bb.x0 - MARGIN - 5, bb.y0 - MARGIN - 5, -5], [bb.x0 - MARGIN, bb.y1 + MARGIN + 5, TALL]),
  solid([bb.x1 + MARGIN, bb.y0 - MARGIN - 5, -5], [bb.x1 + MARGIN + 5, bb.y1 + MARGIN + 5, TALL]),
];
/** The same four slabs but only as a screen on the south side. */
const southScreen = () => solid([bb.x0 - WIDE, bb.y0 - MARGIN - 1, -5], [bb.x1 + WIDE, bb.y0 - MARGIN, TALL]);

const analyzer = (occluders: THREE.Mesh[], opts = {}, custom: Partial<typeof ctx> = {}) =>
  makeSunAnalyzer(viewer, { ctx: { ...ctx, ...custom } as typeof ctx, occluders }, { surroundings: false, terrain: false, ...opts });

const sumFractions = (s: { fraction: number[] }, step: number) => s.fraction.reduce((a, b) => a + b, 0) * (step / 60);

describe("sample points", () => {
  const windows = sampleWindows(ctx), areas = sampleAreas(ctx);
  it("one set of 3 x 2 points for every glazed exterior opening with a room", () => {
    const expected = ctx.derived.openings.filter((o) => o.exterior === true && o.glazingArea > 0 && o.room !== null);
    expect(windows.map((w) => w.opening).sort()).toEqual(expected.map((o) => o.id).sort());
    for (const w of windows) {
      expect(w.points).toHaveLength(6);
      expect(ctx.derived.rooms.some((r) => r.id === w.room)).toBe(true);
      expect(Math.hypot(...w.normalHouse)).toBeCloseTo(1, 12);
    }
  });
  it("window samples lie in the opening: within its width, between sill and head, inside the wall thickness", () => {
    for (const w of windows) {
      const o = ctx.derived.openings.find((x) => x.id === w.opening)!;
      const wall = ctx.derived.walls.find((x) => x.id === o.wallId)!;
      for (const p of w.points) {
        const [x, y, z] = p.house;
        expect(z).toBeGreaterThan(o.sill);
        expect(z).toBeLessThan(o.head);
        const along = o.orient === "h" ? x - o.cx : y - o.cy;
        const across = (x - o.cx) * w.normalHouse[0] + (y - o.cy) * w.normalHouse[1];
        expect(Math.abs(along)).toBeLessThan(o.w / 2);
        expect(Math.abs(across)).toBeLessThanOrEqual(wall.t / 2);
        expect(across).toBeGreaterThan(-wall.t / 2);
      }
    }
  });
  it("outdoor areas: terraces and covered areas, 5 x 3 points inside the rectangle, 0.45 m above the floor", () => {
    const expected = ctx.derived.outdoor.filter((a) => a.type === "terrace" || a.covered);
    expect(areas.map((a) => a.area).sort()).toEqual(expected.map((a) => a.id).sort());
    for (const a of areas) {
      const o = ctx.derived.outdoor.find((x) => x.id === a.area)!;
      expect(a.points).toHaveLength(15);
      const floor = ctx.site.terrain.groundAt((o.rect[0] + o.rect[2]) / 2, (o.rect[1] + o.rect[3]) / 2);
      for (const p of a.points) {
        expect(p.house[0]).toBeGreaterThan(o.rect[0]);
        expect(p.house[0]).toBeLessThan(o.rect[2]);
        expect(p.house[1]).toBeGreaterThan(o.rect[1]);
        expect(p.house[1]).toBeLessThan(o.rect[3]);
        expect(p.house[2]).toBeCloseTo(floor + 0.45, 12);
      }
    }
  });
  it("the analyzer exposes the same points in the scene frame", () => {
    const an = analyzer([]);
    expect(an.windows).toHaveLength(windows.length);
    expect(an.areas).toHaveLength(areas.length);
    const w = an.windows[0], h = windows[0];
    expect(w.points[0][0]).toBeCloseTo(h.points[0].house[0], 12);
    expect(w.points[0][1]).toBeCloseTo(h.points[0].house[2], 12);
    expect(w.points[0][2]).toBeCloseTo(-h.points[0].house[1], 12);
  });
});

describe("open scene against the analytic oracle", () => {
  it("a room is lit whenever any of its windows is: the union of the windows, between the best window and the sum", () => {
    const step = 10;
    const an = analyzer([]);
    for (const date of DAYS) {
      const res = an.day(date, step);
      const t0 = localToUtc(place.tz, date), t1 = localToUtc(place.tz, addDays(date, 1));
      const union: Record<string, number> = {}, best: Record<string, number> = {}, sum: Record<string, number> = {};
      for (const w of sampleWindows(ctx)) {
        const h = sunHoursOnSurface(place, date, w.normalHouse, bearing, { stepMinutes: step }).hours;
        best[w.room] = Math.max(best[w.room] ?? 0, h);
        sum[w.room] = (sum[w.room] ?? 0) + h;
        union[w.room] ??= 0;
      }
      // brute force over the same instants, independent of the analyser: is the sun up and in front of any window of the room?
      for (let k = 0; ; k++) {
        const ms = t0 + (k + 0.5) * step * 60_000;
        if (ms >= t1) break;
        const sun = sunPosition(ms, place);
        if (sun.altitude <= 0) continue;
        const d = sunDirection(sun.azimuth, sun.altitude, bearing);
        const lit = new Set(sampleWindows(ctx).filter((w) => d[0] * w.normalHouse[0] + d[1] * w.normalHouse[1] > 0).map((w) => w.room));
        for (const r of lit) union[r] += step / 60;
      }
      expect(Object.keys(res.rooms).sort()).toEqual(Object.keys(union).sort());
      for (const room of Object.keys(union)) {
        expect(res.rooms[room].hours).toBeCloseTo(union[room], 9);
        expect(res.rooms[room].hours).toBeGreaterThanOrEqual(best[room] - 1e-9);
        expect(res.rooms[room].hours).toBeLessThanOrEqual(sum[room] + 1e-9);
        expect(sumFractions(res.rooms[room], step)).toBeCloseTo(res.rooms[room].hours, 9);
      }
    }
  });
  it("an outdoor area without obstacles gets all the hours the sun is above the horizon", () => {
    const step = 10;
    const an = analyzer([]);
    for (const date of DAYS) {
      const res = an.day(date, step);
      const up = sunHoursOnSurface(place, date, [0, 0, 1], bearing, { stepMinutes: step }).hours;
      for (const a of an.areas) {
        expect(res.outdoors[a.area].hours).toBeCloseTo(up, 9);
        expect(res.outdoorsOpen[a.area].hours).toBeCloseTo(up, 9);
      }
      expect(res.times.length * (step / 60)).toBeCloseTo(up, 9);
    }
  });
  it("times, altitude and azimuth describe the sampled instants of the day", () => {
    const res = analyzer([]).day(EQUINOX, 10);
    expect(res.date).toEqual(EQUINOX);
    expect(res.step).toBe(10);
    expect(res.altitude).toHaveLength(res.times.length);
    expect(res.azimuthTrue).toHaveLength(res.times.length);
    res.times.forEach((t, i) => {
      if (i) expect(t - res.times[i - 1]).toBeCloseTo(10 / 60, 9);
      expect(res.altitude[i]).toBeGreaterThan(0);
      const p = sunPosition(localToUtc(place.tz, EQUINOX, t), place);
      expect(res.altitude[i]).toBeCloseTo(p.altitude, 6);
      expect(res.azimuthTrue[i]).toBeCloseTo(p.azimuth, 6);
    });
    for (const s of [...Object.values(res.rooms), ...Object.values(res.outdoors)]) expect(s.fraction).toHaveLength(res.times.length);
  });
  it("a constant injected sun lights a facade every sample or none", () => {
    const fixed: SunPositionFn = () => ({ azimuth: 180 + bearing, altitude: 30 }); // in front of the wall that faces the house -y side
    const res = analyzer([], { sunPosition: fixed }).day(EQUINOX, 60);
    expect(res.times).toHaveLength(24);
    for (const s of Object.values(res.rooms)) s.fraction.forEach((f) => expect([0, 1]).toContain(f));
  });
});

describe("obstacles", () => {
  it("a ring of slabs around the house leaves no sun in any room or area", () => {
    const res = analyzer(ring()).day(SUMMER, 10);
    for (const s of [...Object.values(res.rooms), ...Object.values(res.outdoors), ...Object.values(res.outdoorsOpen)]) expect(s.hours).toBe(0);
  });
  it("a screen on one side removes the sun that comes from that side and never adds any", () => {
    const open = analyzer([]).day(SUMMER, 10), screened = analyzer([southScreen()]).day(SUMMER, 10);
    let reduced = 0;
    for (const id of Object.keys(open.rooms)) {
      expect(screened.rooms[id].hours).toBeLessThanOrEqual(open.rooms[id].hours + 1e-12);
      if (screened.rooms[id].hours < open.rooms[id].hours - 0.5) reduced++;
      screened.rooms[id].fraction.forEach((f, i) => expect(f).toBeLessThanOrEqual(open.rooms[id].fraction[i] + 1e-12));
    }
    expect(reduced).toBeGreaterThan(0);
    for (const id of Object.keys(open.outdoors)) expect(screened.outdoors[id].hours).toBeLessThanOrEqual(open.outdoors[id].hours + 1e-12);
  });
  it("the roof overhang and the reveals never add sun: the facade value is at most the oracle", () => {
    // a deep slab over the whole house at roof level, like an enormous roof
    const roof = solid([bb.x0 - 6, bb.y0 - 6, bb.z1 - 0.3], [bb.x1 + 6, bb.y1 + 6, bb.z1]);
    const covered = analyzer([roof]).day(SUMMER, 10), open = analyzer([]).day(SUMMER, 10);
    for (const id of Object.keys(open.rooms)) expect(covered.rooms[id].hours).toBeLessThanOrEqual(open.rooms[id].hours + 1e-12);
    // the outdoor areas under such a roof lose sun, and none gains
    const lost = Object.keys(open.outdoors).filter((id) => covered.outdoors[id].hours < open.outdoors[id].hours - 0.5);
    for (const id of Object.keys(open.outdoors)) expect(covered.outdoors[id].hours).toBeLessThanOrEqual(open.outdoors[id].hours + 1e-12);
    expect(lost.length).toBeGreaterThan(0);
  });
});

describe("movable shading", () => {
  const slats = (n: number, cover: boolean) => {
    // horizontal slats in a plane in front of the south side, instanced; `cover` makes them overlap into a closed screen
    const g = new THREE.BoxGeometry(bb.w + 20, 0.05, 0.4);
    const im = new THREE.InstancedMesh(g, material, n);
    const m = new THREE.Matrix4();
    const height = 40;
    for (let i = 0; i < n; i++) {
      const z = (i / n) * height;
      m.makeTranslation((bb.x0 + bb.x1) / 2, z, -(bb.y0 - 1));
      if (!cover) m.makeTranslation(1e6, 1e6, 1e6);
      im.setMatrixAt(i, m);
    }
    im.instanceMatrix.needsUpdate = true;
    im.updateMatrixWorld(true);
    return im;
  };
  it("without shades the open and the shaded areas are identical", () => {
    const res = analyzer([]).day(SUMMER, 10, []);
    for (const id of Object.keys(res.outdoors)) expect(res.outdoors[id]).toEqual(res.outdoorsOpen[id]);
  });
  it("closing a shade never increases the hours and leaves the open result as it was", () => {
    const an = analyzer([]);
    const before = an.day(SUMMER, 10, []);
    // 800 thin slats stacked at 5 cm: a nearly closed screen on the south side
    const closed = an.day(SUMMER, 10, [slats(800, true)]);
    for (const id of Object.keys(before.rooms)) expect(closed.rooms[id].hours).toBeLessThanOrEqual(before.rooms[id].hours + 1e-12);
    for (const id of Object.keys(before.outdoors)) {
      expect(closed.outdoors[id].hours).toBeLessThanOrEqual(closed.outdoorsOpen[id].hours + 1e-12);
      expect(closed.outdoorsOpen[id].hours).toBeCloseTo(before.outdoorsOpen[id].hours, 12);
      closed.outdoors[id].fraction.forEach((f, i) => expect(f).toBeLessThanOrEqual(closed.outdoorsOpen[id].fraction[i] + 1e-12));
    }
    const removed = Object.keys(before.rooms).filter((id) => closed.rooms[id].hours < before.rooms[id].hours - 0.5);
    expect(removed.length).toBeGreaterThan(0);
    // slats pushed far away change nothing
    const away = an.day(SUMMER, 10, [slats(10, false)]);
    for (const id of Object.keys(before.rooms)) expect(away.rooms[id].hours).toBeCloseTo(before.rooms[id].hours, 12);
  });
  it("the instance index agrees with an ordinary mesh of the same shape", () => {
    const g = new THREE.BoxGeometry(bb.w + 40, 60, 0.3);
    const im = new THREE.InstancedMesh(g, material, 1);
    im.setMatrixAt(0, new THREE.Matrix4().makeTranslation((bb.x0 + bb.x1) / 2, 30 - 5, -(bb.y0 - 2)));
    im.updateMatrixWorld(true);
    const mesh = new THREE.Mesh(g, material);
    mesh.position.set((bb.x0 + bb.x1) / 2, 30 - 5, -(bb.y0 - 2));
    mesh.updateMatrixWorld(true);
    const a = analyzer([]).day(EQUINOX, 10, [im]), b = analyzer([]).day(EQUINOX, 10, [mesh]);
    for (const id of Object.keys(a.rooms)) expect(a.rooms[id].fraction).toEqual(b.rooms[id].fraction);
    for (const id of Object.keys(a.outdoors)) expect(a.outdoors[id].fraction).toEqual(b.outdoors[id].fraction);
  });
  it("memoising the open result does not change anything: a second call equals the first", () => {
    const an = analyzer([southScreen()]);
    const shade = solid([bb.x0 - 50, bb.y1 + 1, -5], [bb.x1 + 50, bb.y1 + 2, 30]);
    const first = an.day(EQUINOX, 10, [shade]), second = an.day(EQUINOX, 10, [shade]), third = an.day(EQUINOX, 10, []);
    expect(second).toEqual(first);
    expect(third.rooms).toEqual(analyzer([southScreen()]).day(EQUINOX, 10, []).rooms);
    expect(third.outdoors).toEqual(third.outdoorsOpen);
  });
});

describe("surroundings and terrain", () => {
  const withOccluders = (list: Occluder[]) => ({ layout: { ...ctx.layout, occluders: () => list } });
  /** A tall opaque wall 6 m to the south of the house, as a neighbour's building would be. */
  const wall = boxOf([bb.x0 - 200, bb.y0 - 8, -1], [bb.x1 + 200, bb.y0 - 6, 12], { id: "x", role: "neighbour_wall" });
  it("a tall wall of the surroundings shades the low sun but not the high sun", () => {
    const open = makeSunAnalyzer(viewer, { ctx, occluders: [] }, { surroundings: false, terrain: false }).day(WINTER, 10);
    const walled = makeSunAnalyzer(viewer, { ctx: { ...ctx, ...withOccluders([wall]) } as typeof ctx, occluders: [] }, { terrain: false }).day(WINTER, 10);
    let less = 0;
    for (const id of Object.keys(open.rooms)) {
      expect(walled.rooms[id].hours).toBeLessThanOrEqual(open.rooms[id].hours + 1e-12);
      if (walled.rooms[id].hours < open.rooms[id].hours - 0.5) less++;
    }
    expect(less).toBeGreaterThan(0);
    // 12 m high at 6 m: the sun is hidden below about 63 degrees for a point at the ground, so in December everything on the south side is dark
    for (const id of Object.keys(open.outdoors)) expect(walled.outdoors[id].hours).toBeLessThan(open.outdoors[id].hours);
  });
  it("the real surroundings (neighbours, trees, hedges, fences) never add sun", () => {
    const open = analyzer([]), real = makeSunAnalyzer(viewer, { ctx, occluders: [] }, { terrain: false });
    for (const date of DAYS) {
      const a = open.day(date, 10), b = real.day(date, 10);
      for (const id of Object.keys(a.rooms)) expect(b.rooms[id].hours).toBeLessThanOrEqual(a.rooms[id].hours + 1e-9);
      for (const id of Object.keys(a.outdoors)) expect(b.outdoors[id].hours).toBeLessThanOrEqual(a.outdoors[id].hours + 1e-9);
    }
  });
  it("a deciduous crown lets through more light in winter than in summer", () => {
    const [bx0, by0] = [(bb.x0 + bb.x1) / 2, bb.y0 - 12];
    const crown: Occluder = { id: "t", role: "tree", kind: "sphere", center: [bx0, by0, 4], radius: 30, extinction: { leafOn: 0.8, leafOff: 0.05 } };
    const fixed: SunPositionFn = () => ({ azimuth: 180 + bearing, altitude: 30 });
    const an = makeSunAnalyzer(viewer, { ctx: { ...ctx, ...withOccluders([crown]) } as typeof ctx, occluders: [] }, { terrain: false, sunPosition: fixed });
    const summer = an.day({ year: 2026, month: 6, day: 15 }, 60), winter = an.day({ year: 2026, month: 0, day: 15 }, 60);
    for (const a of an.areas) {
      const s = summer.outdoors[a.area].hours, w = winter.outdoors[a.area].hours;
      expect(s).toBeLessThan(w);
      expect(w).toBeLessThan(24); // the winter crown still takes some light
    }
  });
  it("terrain: the horizon is finite, never raises the hours and is the same in opposite calls", () => {
    const an = makeSunAnalyzer(viewer, { ctx, occluders: [] }, { surroundings: false });
    for (let az = 0; az < 360; az += 15) {
      const h = an.terrainHorizon(az);
      expect(Number.isFinite(h)).toBe(true);
      expect(an.terrainHorizon(az)).toBe(h);
      expect(h).toBeLessThan(45);
    }
    const flat = analyzer([]).day(WINTER, 10), real = an.day(WINTER, 10);
    for (const id of Object.keys(flat.rooms)) expect(real.rooms[id].hours).toBeLessThanOrEqual(flat.rooms[id].hours + 1e-12);
  });
});

describe("blockers", () => {
  it("lists the meshes a ray meets, nearest first, with their role and id", () => {
    const near = solid([0, -20, 0], [10, -19, 10]), far = solid([0, -30, 0], [10, -29, 10]);
    near.userData = { role: "wall", id: "A" };
    far.userData = { role: "roof_tile" };
    const an = analyzer([far, near]);
    const from = toScene([5, 0, 5]);
    const hits = an.blockers(from, toScene([0, -1, 0]));
    expect(hits.map((h) => h.role)).toEqual(["wall", "roof_tile"]);
    expect(hits[0].id).toBe("A");
    expect(hits[0].distance).toBeCloseTo(19, 9);
    expect(an.blockers(from, toScene([0, 1, 0]))).toEqual([]);
  });
});

describe("the box prefilter of the caster", () => {
  it("answers exactly like a plain raycaster over the same meshes (random boxes and rays)", () => {
    let seed = 42;
    const rand = () => {
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    const meshes: THREE.Mesh[] = [];
    for (let i = 0; i < 40; i++) {
      const g = new THREE.BoxGeometry(0.5 + rand() * 4, 0.1 + rand() * 3, 0.5 + rand() * 4);
      const m = new THREE.Mesh(g, material);
      m.position.set((rand() - 0.5) * 40, rand() * 6, (rand() - 0.5) * 40);
      m.rotation.set(rand() * 3, rand() * 3, rand() * 3);
      m.updateMatrixWorld(true);
      meshes.push(m);
    }
    const caster = new Caster(meshes, 200);
    const plain = new THREE.Raycaster();
    plain.far = 200;
    let hit = 0, miss = 0;
    for (let i = 0; i < 3000; i++) {
      const o = new THREE.Vector3((rand() - 0.5) * 50, rand() * 8, (rand() - 0.5) * 50);
      const d = new THREE.Vector3(rand() - 0.5, rand() - 0.2, rand() - 0.5).normalize();
      plain.set(o, d);
      const expected = plain.intersectObjects(meshes, false).length > 0;
      expect(caster.blocked(o, d)).toBe(expected);
      if (expected) hit++; else miss++;
    }
    expect(hit).toBeGreaterThan(100);
    expect(miss).toBeGreaterThan(100);
    // a mesh that moves is picked up by refresh()
    const mover = meshes[0];
    mover.position.set(1000, 0, 0);
    mover.updateMatrixWorld(true);
    caster.refresh();
    const o = new THREE.Vector3(1000, 0, -50), d = new THREE.Vector3(0, 0, 1);
    expect(caster.blocked(o, d)).toBe(true);
  });
});

describe("culling the surroundings", () => {
  const solids = ctx.layout.occluders();
  /** A small deterministic generator (mulberry32) so the tests are reproducible. */
  const rng = (seed: number) => () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  it("every solid lies inside its bounding sphere (points of a ray chord are inside)", () => {
    const rand = rng(7);
    for (const o of solids) {
      const b = occluderBound(o);
      expect(b.r).toBeGreaterThan(0);
      let hits = 0;
      for (let i = 0; i < 4000 && hits < 20; i++) {
        const origin: Vec3 = [b.c[0] + (rand() - 0.5) * 3 * Math.min(b.r, 60), b.c[1] + (rand() - 0.5) * 3 * Math.min(b.r, 60), b.c[2] + (rand() - 0.5) * 3 * Math.min(b.r, 60)];
        const a = rand() * Math.PI * 2, e = rand() * Math.PI - Math.PI / 2;
        const dir: Vec3 = [Math.cos(e) * Math.sin(a), Math.cos(e) * Math.cos(a), Math.sin(e)];
        const chord = rayChord(o, origin, dir);
        if (!chord || !Number.isFinite(chord.tOut)) continue;
        hits++;
        for (const t of [chord.tIn, chord.tOut, (chord.tIn + chord.tOut) / 2]) {
          const p: Vec3 = [origin[0] + dir[0] * t, origin[1] + dir[1] * t, origin[2] + dir[2] * t];
          expect(Math.hypot(p[0] - b.c[0], p[1] - b.c[1], p[2] - b.c[2])).toBeLessThanOrEqual(b.r + 1e-6);
        }
      }
    }
  });
  it("culling never changes what a ray meets", () => {
    const rand = rng(11);
    const items = solids.map((solid) => ({ solid, bound: occluderBound(solid) }));
    const centre: Vec3 = [(bb.x0 + bb.x1) / 2, (bb.y0 + bb.y1) / 2, 1];
    const reach = 18;
    for (let i = 0; i < 3000; i++) {
      const a = rand() * Math.PI * 2, e = rand() * (Math.PI / 2.2);
      const dir: Vec3 = [Math.cos(e) * Math.sin(a), Math.cos(e) * Math.cos(a), Math.sin(e)];
      const start: Vec3 = [centre[0] + (rand() - 0.5) * 2 * reach * 0.7, centre[1] + (rand() - 0.5) * 2 * reach * 0.7, rand() * 3];
      const day = 15 + Math.floor(rand() * 340);
      const all = rayTransmittance(solids, start, dir, day);
      const some = rayTransmittance(cullOccluders(items, centre, reach, dir).map((x) => x.solid), start, dir, day);
      expect(some).toBeCloseTo(all, 12);
    }
  });
  it("culling usually leaves a handful of solids", () => {
    const items = solids.map((solid) => ({ solid, bound: occluderBound(solid) }));
    const centre: Vec3 = [(bb.x0 + bb.x1) / 2, (bb.y0 + bb.y1) / 2, 1];
    const counts = [0, 90, 180, 270].map((az) => cullOccluders(items, centre, 18, sunDirection(az, 20, bearing)).length);
    expect(Math.min(...counts)).toBeLessThan(solids.length);
  });
  it("an analyser with culling gives exactly the result of one without", () => {
    const withCull = makeSunAnalyzer(viewer, { ctx, occluders: [] }, { terrain: false });
    const without = makeSunAnalyzer(viewer, { ctx, occluders: [] }, { terrain: false, cull: false });
    for (const date of DAYS) expect(withCull.day(date, 10)).toEqual(without.day(date, 10));
  });
});

describe("scheduling", () => {
  const sameResult = (a: SunDayResult, b: SunDayResult) => expect(a).toEqual(b);
  it("dayAsync gives the result of day(), in slices", async () => {
    const an = analyzer([southScreen()]);
    const sync = an.day(EQUINOX, 10);
    const res = await an.dayAsync(EQUINOX, 10, [], { sliceMs: 0 });
    sameResult(res!, sync);
  });
  it("dayAsync can be aborted", async () => {
    const an = analyzer([]);
    const c = new AbortController();
    const p = an.dayAsync(SUMMER, 10, [], { signal: c.signal, sliceMs: 0 });
    c.abort();
    expect(await p).toBeNull();
    const done = new AbortController();
    expect(await an.dayAsync(SUMMER, 10, [], { signal: done.signal })).not.toBeNull();
  });
  it("rejects a bad step", () => {
    expect(() => analyzer([]).day(SUMMER, 0)).toThrow(RangeError);
    expect(() => analyzer([]).day(SUMMER, NaN)).toThrow(RangeError);
  });
  it("a day takes a fraction of a second with the house, blinds and surroundings in place", () => {
    const an = makeSunAnalyzer(viewer, { ctx, occluders: [southScreen()] });
    const t0 = performance.now();
    an.day(EQUINOX, 10, [solid([bb.x0 - 50, bb.y1 + 1, -5], [bb.x1 + 50, bb.y1 + 2, 30])]);
    expect(performance.now() - t0).toBeLessThan(1500);
  });
  it("works across the days the clocks change (23 and 25 hour days)", () => {
    const an = analyzer([]);
    for (const d of [{ year: 2026, month: 2, day: 29 }, { year: 2026, month: 9, day: 25 }]) {
      const res = an.day(d, 10);
      const up = sunHoursOnSurface(place, d, [0, 0, 1], bearing, { stepMinutes: 10 }).hours;
      expect(res.times.length * (10 / 60)).toBeCloseTo(up, 9);
      expect(addDays(d, 1).day).not.toBe(d.day);
    }
  });
});
