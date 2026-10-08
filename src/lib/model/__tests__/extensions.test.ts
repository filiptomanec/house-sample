// The R2 extensions of the kernel: blinds on every facade, louvre stops, overhang depth, levels and pools, cameras with an
// eye height, display numbers, walls to unheated rooms, the new metrics and text helpers. Invariants, no magic numbers.
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  BEDROOM_TYPES,
  DEFAULT_OUTDOOR_TOP,
  GROUND_VOID_OUTDOOR,
  GUTTER_RUN_MAX,
  LAYOUT_ROOM_TYPES,
  LOUVRE_MAX_CLOSED_DEG,
  LOUVRE_OPEN_DEG,
  OUTDOOR_TYPES,
  SUN_SAMPLED_OUTDOOR,
  WATER_OUTDOOR,
} from "../catalog";
import { azimuthInRange, ceil5, derive, exitDistance, louvreClosedDeg, outdoorRole } from "../derive";
import { computeMetrics, heatedGrossArea, layoutCode, localized } from "../metrics";
import { HARD_OUTDOOR_TYPES, WATER_OUTDOOR_TYPES, createSite, parseSite, plotStats } from "../site";
import { longGutterRuns } from "../validate";
import type { Derived, House, RoomType } from "../types";
import { baseline, cloneHouse, repoRoot } from "./helpers";

const { house, derived: d } = baseline();
const siteRaw = JSON.parse(fs.readFileSync(path.join(repoRoot, "model", "site.json"), "utf8")) as unknown;
const site = parseSite(siteRaw);
const withSite = derive(house, { site });
const metrics = computeMetrics(house, withSite);

describe("blind rule: azimuth ranges", () => {
  it("0 -> 360 contains every azimuth", () => {
    for (const a of [0, 0.1, 90, 180, 270, 359.9, 360]) expect(azimuthInRange(a, 0, 360), String(a)).toBe(true);
  });
  it("350 -> 10 wraps through north", () => {
    for (const a of [350, 355, 0, 5, 10]) expect(azimuthInRange(a, 350, 10), String(a)).toBe(true);
    for (const a of [11, 20, 180, 340, 349]) expect(azimuthInRange(a, 350, 10), String(a)).toBe(false);
  });
  it("135 -> 315 is the south and west half", () => {
    for (const a of [135, 192, 282, 315]) expect(azimuthInRange(a, 135, 315), String(a)).toBe(true);
    for (const a of [12, 102, 134, 316]) expect(azimuthInRange(a, 135, 315), String(a)).toBe(false);
  });
  it("with a full range every glazed opening of a heated room gets a blind, in sections of at most the product width", () => {
    const h = cloneHouse();
    h.shading.blinds.azimuthFrom = 0;
    h.shading.blinds.azimuthTo = 360;
    const dd = derive(h);
    const heated = new Map(dd.rooms.map((r) => [r.id, r.heated]));
    for (const o of dd.openings) {
      const want = o.exterior === true && o.glazingArea > 0 && (h.shading.blinds.kinds as string[]).includes(o.kind) && heated.get(o.room as string) === true;
      expect(o.blind, o.id).toBe(want);
      if (o.blind) {
        expect(o.blindSections).toBeGreaterThanOrEqual(1);
        expect(o.w / o.blindSections).toBeLessThanOrEqual(h.shading.blinds.product.maxSectionWidth + 1e-9);
        if (o.blindSections > 1) expect(o.w / (o.blindSections - 1)).toBeGreaterThan(h.shading.blinds.product.maxSectionWidth - 1e-9);
      } else expect(o.blindSections).toBe(0);
    }
    // no blind on a window of an unheated room
    for (const o of dd.openings) if (o.room && heated.get(o.room) === false) expect(o.blind).toBe(false);
  });
});

describe("louvre wall", () => {
  it("the closed stop is the first multiple of 5 degrees where the blades no longer collide", () => {
    for (const [t, p] of [[0.025, 0.1], [0.03, 0.12], [0.02, 0.15], [0.04, 0.1]]) {
      const c = louvreClosedDeg(t, p);
      expect(c % 5).toBe(0);
      expect(p * Math.sin((c * Math.PI) / 180)).toBeGreaterThanOrEqual(t - 1e-12);
      if (c > 5) expect(p * Math.sin(((c - 5) * Math.PI) / 180)).toBeLessThan(t);
    }
    expect(ceil5(15)).toBe(15);
    expect(ceil5(14.48)).toBe(15);
    expect(louvreClosedDeg(0.2, 0.1)).toBe(LOUVRE_OPEN_DEG);
  });
  it("the model's blades close: chord over pitch, an opaque wall at the closed stop, the stop within the limit", () => {
    const sl = house.shading.slats;
    for (const s of d.screens) {
      expect(s.closedDeg).toBe(louvreClosedDeg(sl.width, sl.pitch));
      expect(s.closedDeg).toBeLessThanOrEqual(LOUVRE_MAX_CLOSED_DEG);
      expect(sl.depth).toBeGreaterThan(sl.pitch);
      // projected width of a blade at the closed stop covers its pitch
      expect(sl.depth * Math.cos((s.closedDeg * Math.PI) / 180)).toBeGreaterThanOrEqual(sl.pitch);
      expect(s.openDeg).toBe(LOUVRE_OPEN_DEG);
      expect(s.restDeg).toBeGreaterThanOrEqual(s.closedDeg);
      expect(s.restDeg).toBeLessThanOrEqual(s.openDeg);
    }
  });
  it("blades are spread evenly over the screen, from the slab to the soffit", () => {
    for (const s of d.screens) {
      const b = s.blades;
      expect(b.count).toBe(Math.max(1, Math.floor(s.length / house.shading.slats.pitch + 1e-6)));
      expect(b.positions).toHaveLength(b.count);
      expect(b.pitch * b.count).toBeCloseTo(s.length, 3);
      const lo = Math.min(s.from, s.to);
      b.positions.forEach((p, i) => expect(p).toBeCloseTo(lo + ((i + 0.5) * s.length) / b.count, 4));
      expect(b.chord).toBe(house.shading.slats.depth);
      expect(b.thickness).toBe(house.shading.slats.width);
      expect(s.z1).toBe(house.clearHeight);
      expect(s.z0).toBeLessThan(s.z1);
    }
  });
});

describe("overhang: marching out of the roof plan", () => {
  it("exitDistance follows chained rectangles in all four directions and is 0 outside", () => {
    const rects: [number, number, number, number][] = [[0, 0, 4, 2], [3, 0, 8, 1], [-5, -1, 1, 3]];
    expect(exitDistance(rects, [0.5, 0.5], [1, 0])).toBeCloseTo(7.5, 12);
    expect(exitDistance(rects, [0.5, 0.5], [-1, 0])).toBeCloseTo(5.5, 12);
    expect(exitDistance(rects, [0.5, 0.5], [0, 1])).toBeCloseTo(2.5, 12);
    expect(exitDistance(rects, [3.5, 0.5], [0, -1])).toBeCloseTo(0.5, 12);
    expect(exitDistance(rects, [10, 10], [1, 0])).toBe(0);
  });
  it("an opening onto a covered area is shaded at least to the far edge of that area", () => {
    let seen = 0;
    for (const o of d.openings) {
      if (!o.exterior || !o.overhang) continue;
      const wall = d.walls.find((w) => w.id === o.wallId)!;
      const n = [Math.round(Math.sin(((o.azimuth as number) * Math.PI) / 180)), Math.round(Math.cos(((o.azimuth as number) * Math.PI) / 180))];
      const face = [o.cx + (n[0] * wall.t) / 2, o.cy + (n[1] * wall.t) / 2];
      const near = [face[0] + n[0] * 0.1, face[1] + n[1] * 0.1];
      const area = house.outdoor.find((a) => a.covered && near[0] > a.rect[0] && near[0] < a.rect[2] && near[1] > a.rect[1] && near[1] < a.rect[3]);
      if (!area) continue;
      seen++;
      const far = n[0] > 0 ? area.rect[2] - face[0] : n[0] < 0 ? face[0] - area.rect[0] : n[1] > 0 ? area.rect[3] - face[1] : face[1] - area.rect[1];
      expect(o.overhang.depth, o.id).toBeGreaterThanOrEqual(far - 1e-6);
      expect(o.overhang.eaveHeight, o.id).toBe(house.clearHeight);
    }
    expect(seen).toBeGreaterThan(0);
  });
});

describe("levels, outdoor areas and pools", () => {
  it("every outdoor area has a resolved top, finish, role and a grade with one height per corner", () => {
    for (const o of withSite.outdoor) {
      const src = house.outdoor.find((x) => x.id === o.id)!;
      expect(o.top).toBe(src.top ?? DEFAULT_OUTDOOR_TOP);
      expect(o.role).toBe(outdoorRole(o.type, o.surface));
      expect(o.grade.corners).toHaveLength(4);
      if (o.grade.kind === "flat") for (const z of o.grade.corners) expect(z).toBe(o.top);
      expect(o.netArea).toBeCloseTo(o.area - o.holes.reduce((s, q) => s + (q[2] - q[0]) * (q[3] - q[1]), 0), 6);
    }
  });
  it("with the site the drive and the walkway are ramps from their top at the house end to the gate", () => {
    const ramps = withSite.outdoor.filter((o) => o.grade.kind === "ramp");
    expect(ramps.map((o) => o.type).sort()).toEqual([site.access.driveway.outdoorType, site.access.walkway.outdoorType].sort());
    for (const o of ramps) {
      const r = o.grade.ramp!;
      const [x0, y0, x1, y1] = o.rect;
      expect(r.from).toBe(y0);
      expect(r.z0).toBe(o.top);
      // corners lie on the plane: equal at equal y, linear in y
      expect(o.grade.corners[0]).toBeCloseTo(o.grade.corners[1], 9);
      expect(o.grade.corners[2]).toBeCloseTo(o.grade.corners[3], 9);
      expect(o.grade.corners[0]).toBeCloseTo(r.z0, 4);
      expect(o.grade.corners[2]).toBeCloseTo(r.z0 + r.slope * (y1 - y0), 4);
      expect(r.z1).toBeCloseTo(r.z0 + r.slope * (r.to - r.from), 4);
      expect(x1).toBeGreaterThan(x0);
    }
    // without the site every slab is flat
    for (const o of d.outdoor) expect(o.grade.kind).toBe("flat");
  });
  it("a pool sits in its deck: coping ring, water below the coping, floor below the water, a hole in deck and terrain", () => {
    const h = cloneHouse();
    const pav = d.outdoor.filter((o) => !o.covered && o.type === "paving").sort((a, b) => b.area - a.area)[0];
    const rect: [number, number, number, number] = [pav.rect[0] + 0.6, pav.rect[1] + 0.6, pav.rect[2] - 0.6, pav.rect[3] - 0.6];
    h.outdoor.push({ id: "PX", type: "pool", rect, depth: 1.4, waterBelowTop: 0.12, coping: 0.3 });
    const dd = derive(h);
    const pool = dd.outdoor.find((o) => o.id === "PX")!;
    const p = pool.pool!;
    expect(p.deck).toBe(pav.id);
    expect(p.outer).toEqual([rect[0] - 0.3, rect[1] - 0.3, rect[2] + 0.3, rect[3] + 0.3].map((v) => Math.round(v * 1e5) / 1e5));
    expect(p.waterZ).toBeLessThan(p.copingTop);
    expect(p.floorZ).toBeLessThan(p.waterZ);
    expect(p.waterArea).toBeCloseTo((rect[2] - rect[0]) * (rect[3] - rect[1]), 6);
    expect(p.waterVolume).toBeCloseTo(p.waterArea * (p.depth - p.waterBelowTop), 4);
    expect(pool.role).toBe("pool_coping");
    const deck = dd.outdoor.find((o) => o.id === pav.id)!;
    expect(deck.holes).toEqual([p.outer]);
    expect(deck.netArea).toBeCloseTo(deck.area - (p.outer[2] - p.outer[0]) * (p.outer[3] - p.outer[1]), 6);
    expect(dd.groundVoids).toContainEqual(p.outer);
    expect(dd.groundVoids).toHaveLength(dd.outdoor.filter((o) => o.pool).length);
    expect(p.polygons.deck?.hole).toEqual(p.polygons.copingOuter);
  });
});

describe("cameras", () => {
  it("without the site the heights are taken as given; with it aboveGround is resolved on the graded ground", () => {
    for (const c of d.cameras) {
      const src = house.cameras.find((x) => x.id === c.id)!;
      expect(c.position).toEqual(src.position);
      expect(c.ground).toBeNull();
    }
    const h = cloneHouse();
    h.cameras.forEach((c, i) => (c.aboveGround = 1.6 + i * 0.1));
    const dd = derive(h, { site });
    const terrain = createSite(siteRaw, h.location.houseAxisBearingDeg, h.outdoor).terrain;
    dd.cameras.forEach((c, i) => {
      expect(c.ground).toBeCloseTo(terrain.groundAt(c.position[0], c.position[1]), 4);
      expect(c.position[2]).toBeCloseTo((c.ground as number) + 1.6 + i * 0.1, 4);
      expect(c.target).toEqual(h.cameras[i].target);
    });
  });
  it("short names, the default and the stage classes pass through", () => {
    for (const c of withSite.cameras) {
      const src = house.cameras.find((x) => x.id === c.id)!;
      expect(c.short).toEqual(src.short ?? null);
      expect(c.default).toBe(src.default ?? false);
      expect(c.defaultFor).toEqual(src.defaultFor ?? []);
      expect(c.use).toEqual(src.use);
    }
    expect(withSite.cameras.filter((c) => c.default).length).toBeLessThanOrEqual(1);
  });
});

describe("rooms: display numbers and walls to unheated rooms", () => {
  it("numbers are unique, '1.01' style, start at the entry room and follow the walk through the doors", () => {
    const nos = d.rooms.map((r) => r.displayNo);
    expect(new Set(nos).size).toBe(nos.length);
    for (const n of nos) expect(n).toMatch(/^\d\.\d{2}$/);
    expect(d.rooms.find((r) => r.id === d.access.entryRoom)?.displayNo).toBe("1.01");
    const reachable = [...d.rooms].filter((r) => d.access.depth[r.id] !== undefined).sort((a, b) => a.displayNo.localeCompare(b.displayNo));
    for (let i = 1; i < reachable.length; i++) expect(d.access.depth[reachable[i].id]).toBeGreaterThanOrEqual(d.access.depth[reachable[i - 1].id]);
  });
  it("short names come from the model", () => {
    for (const r of d.rooms) expect(r.shortName).toEqual(house.rooms.find((x) => x.id === r.id)!.shortName ?? null);
  });
  it("exactly the interior walls between a heated and an unheated room are marked", () => {
    const heated = new Map(d.rooms.map((r) => [r.id, r.heated]));
    for (const w of d.walls) {
      const want = !w.ext && !!w.lo && !!w.hi && heated.get(w.lo) !== heated.get(w.hi);
      expect(w.toUnheated === true, w.id).toBe(want);
    }
  });
});

describe("metrics", () => {
  it("layout code counts rooms by type", () => {
    const rooms = (types: RoomType[]) => types.map((type) => ({ type }));
    expect(layoutCode(rooms(["living", "bedroom", "kids", "kids", "office", "bath", "hall"]))).toBe("5+kk");
    expect(layoutCode(rooms(["living", "kitchen", "bedroom"]))).toBe("2+1");
    const n = d.rooms.filter((r) => LAYOUT_ROOM_TYPES.includes(r.type)).length;
    expect(metrics.layoutCode.startsWith(`${n}+`)).toBe(true);
    expect(metrics.bedroomCount).toBe(d.rooms.filter((r) => BEDROOM_TYPES.includes(r.type)).length);
    expect(metrics.bedroomCount).toBeLessThanOrEqual(n);
  });
  it("built-up area = footprint + covered outdoor areas, the same number as the plot statistics", () => {
    const stats = plotStats(site.plot.polygon as [number, number][], d.outline.polygons[0].pts, house.outdoor);
    expect(metrics.builtUpArea).toBeCloseTo(stats.builtUpArea, 1);
    expect(metrics.builtUpArea).toBeGreaterThanOrEqual(metrics.footprintArea);
  });
  it("heated areas: net = heated floor area; gross heated + gross unheated = footprint", () => {
    expect(metrics.heatedArea).toBe(metrics.heated.floorArea);
    const inverted = { ...d, rooms: d.rooms.map((r) => ({ ...r, heated: !r.heated })) } as Derived;
    expect(heatedGrossArea(d) + heatedGrossArea(inverted)).toBeCloseTo(d.outline.area, 6);
    expect(metrics.heatedAreaGross).toBeGreaterThan(metrics.heatedArea);
    expect(metrics.heatedAreaGross).toBeLessThan(metrics.footprintArea);
  });
  it("the boundary to unheated rooms adds up to the marked walls", () => {
    const walls = d.walls.filter((w) => w.toUnheated);
    const gross = walls.reduce((s, w) => s + w.len * house.clearHeight, 0);
    expect(metrics.unheatedBoundary.wallArea + metrics.unheatedBoundary.doorArea).toBeCloseTo(gross, 1);
  });
  it("localized() applies the typography of the site and is idempotent", () => {
    const t = { cs: "Dům s terasou a bazénem 8 m dlouhým", en: "A house with a 8 m pool" };
    const cs = localized(t, "cs");
    expect(cs).toContain("s terasou");
    expect(cs).toContain("a bazénem");
    expect(cs).toContain("8 m");
    expect(localized({ cs, en: t.en }, "cs")).toBe(cs);
    expect(localized(t, "en")).toBe("A house with a 8 m pool");
  });
});

describe("gutters (V-SVOD-OKAP)", () => {
  const box = (w: number, dd: number): Derived => ({ ...d, roofs: [{ ...d.roofs[0], eaveRect: [0, 0, w, dd] }] }) as Derived;
  it("outlets at all corners keep every run short; two opposite corners leave two long runs", () => {
    const w = 2 * GUTTER_RUN_MAX - 2, dd = GUTTER_RUN_MAX - 2;
    expect(longGutterRuns(box(w, dd), [{ x: 0, y: 0 }, { x: w, y: 0 }, { x: w, y: dd }, { x: 0, y: dd }])).toEqual([]);
    expect(longGutterRuns(box(w, dd), [{ x: 0, y: 0 }, { x: w, y: dd }])).toHaveLength(2);
    expect(longGutterRuns(box(w, dd), [])).toHaveLength(1);
  });
  it("the model has no long run", () => {
    expect(longGutterRuns(d, house.roof.downpipes)).toEqual([]);
  });
});

describe("derived data for the pipeline", () => {
  it("carries the catalogue lists, the attic and the resolved site", () => {
    expect(withSite.catalog.groundVoidOutdoor).toEqual([...GROUND_VOID_OUTDOOR]);
    expect(withSite.catalog.sunSampledOutdoor).toEqual([...SUN_SAMPLED_OUTDOOR]);
    expect(withSite.catalog.waterOutdoor).toEqual([...WATER_OUTDOOR]);
    expect(withSite.catalog.bedroomTypes).toEqual([...BEDROOM_TYPES]);
    expect(withSite.topEnvelope).toBe(house.roof.attic === "cold" ? "ceiling" : "roof");
    expect(d.site).toBeNull();
    expect(withSite.site?.fences.length).toBe(site.fences.length);
    expect(withSite.site?.trees.length).toBe(site.trees.length);
  });
  it("the heat-pump outdoor unit gets its turned footprint and the ground under it", () => {
    const h = cloneHouse();
    const b = d.outline.bbox!;
    h.equipment.heating.outdoorUnit = { pos: [b.x0 - 1, (b.y0 + b.y1) / 2], size: [1.1, 0.45, 1.0], rot: 90 };
    const u = derive(h, { site }).outdoorUnit!;
    const xs = u.footprint.map((p) => p[0]), ys = u.footprint.map((p) => p[1]);
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(0.45, 9);
    expect(Math.max(...ys) - Math.min(...ys)).toBeCloseTo(1.1, 9);
    const terrain = createSite(siteRaw, h.location.houseAxisBearingDeg, h.outdoor).terrain;
    expect(u.z).toBeCloseTo(Math.min(...u.footprint.map((p) => terrain.groundAt(p[0], p[1]))), 4);
    expect(derive(h).outdoorUnit!.z).toBeNull();
    expect(d.outdoorUnit === null).toBe(!house.equipment.heating.outdoorUnit);
  });
  it("a cold attic moves the top of the envelope to the ceiling", () => {
    const h: House = cloneHouse();
    h.roof.attic = "cold";
    expect(derive(h).topEnvelope).toBe("ceiling");
  });
  it("catalogue lists are consistent with each other and with the site module", () => {
    for (const t of [...GROUND_VOID_OUTDOOR, ...SUN_SAMPLED_OUTDOOR, ...WATER_OUTDOOR]) expect(OUTDOOR_TYPES).toContain(t);
    expect([...WATER_OUTDOOR_TYPES]).toEqual([...WATER_OUTDOOR]);
    for (const t of OUTDOOR_TYPES) expect(HARD_OUTDOOR_TYPES).toContain(t);
    for (const t of BEDROOM_TYPES) expect(LAYOUT_ROOM_TYPES).toContain(t);
  });
});
