// The content of model/house.json and model/site.json against the brief of the house ("Dům pod ořechem"): invariants of the
// redesigned model that every page, the GLB and the renders rely on. Geometry is found by type, kind and role (never by id)
// and compared with independent computations; the only literals are the brief's own targets (5+kk, about a quarter of the
// plot built up, at least 55 % green, a walk gate leaf that fits the path).
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { BEDROOM_TYPES, LAYOUT_ROOM_TYPES, SEPARATE_KITCHEN_TYPE, UNHEATED_TYPES } from "../catalog";
import { ceil5 } from "../derive";
import { localized } from "../metrics";
import { validateHouse } from "../validate";
import {
  RAMP_MAX_SLOPE, RAMP_MIN_FALL, analyzeSite, createSite, distToPolygon, parseSite, pointInPolygon, polylineLength, rayChord, validateSite,
  validateSiteWithHouse, type HouseInput, type XY,
} from "../site";
import { rawHouse, repoRoot } from "./helpers";

const siteRaw = JSON.parse(fs.readFileSync(path.join(repoRoot, "model", "site.json"), "utf8")) as unknown;
const site = parseSite(siteRaw);
const res = validateHouse(rawHouse(), { site });
const house = res.house!;
const d = res.derived!;
const metrics = res.metrics!;
const bearing = house.location.houseAxisBearingDeg;
const footprint = d.outline.polygons[0].pts as XY[];
const input: HouseInput = { bearingDeg: bearing, footprint, outdoor: house.outdoor, roofs: house.roofs, openings: d.openings };
const graded = createSite(siteRaw, bearing, house.outdoor);
const withHouse = graded.withHouse(house.outdoor);
const groundAt = graded.terrain.groundAt;
const rectPoly = (r: readonly number[]): XY[] => [[r[0], r[1]], [r[2], r[1]], [r[2], r[3]], [r[0], r[3]]];

describe("validation", () => {
  it("house and site: no errors and no warnings", () => {
    expect(res.errors.map((e) => e.code)).toEqual([]);
    expect(res.warnings.map((e) => e.code)).toEqual([]);
    expect(validateSite(site)).toEqual({ errors: [], warnings: [] });
    expect(validateSiteWithHouse(site, house.outdoor, bearing)).toEqual({ errors: [], warnings: [] });
  });

  it("every plot rule passes; about a quarter of the plot is built up and at least 55 % stays green", () => {
    const a = analyzeSite(site, input);
    for (const c of a.checks) expect(c.ok, `${c.key}: ${c.actual} vs ${c.limit}`).toBe(true);
    expect(a.checks.map((c) => c.key)).toEqual(expect.arrayContaining(["boundary", "roofEdge", "garageDrive", "builtUp", "green", "treeTrunk", "treeCrown", "treePool"]));
    expect(a.stats.builtUpRatio).toBeGreaterThan(0.2);
    expect(a.stats.builtUpRatio).toBeLessThan(0.3);
    expect(a.stats.greenRatio).toBeGreaterThanOrEqual(0.55);
    // one definition of the built-up area: the kernel metric equals the plot statistics
    expect(metrics.builtUpArea).toBeCloseTo(a.stats.builtUpArea, 6);
  });
});

describe("identity and texts", () => {
  it("the idea is plain prose of at most 60 words in both languages; the region names no town", () => {
    for (const lang of ["cs", "en"] as const) {
      expect(house.idea![lang].split(/\s+/).filter(Boolean).length).toBeLessThanOrEqual(60);
      expect(house.location.region[lang]).not.toMatch(/[(),]/);
      expect(house.location.region[lang].split(/\s+/).length).toBeLessThanOrEqual(2);
    }
  });

  it("stores plain spaces: localized() adds the no-break spaces", () => {
    const text = fs.readFileSync(path.join(repoRoot, "model", "house.json"), "utf8");
    expect(text).not.toMatch(/ |\\u00a0/);
    expect(localized({ cs: "Dům v sadu", en: "x" }, "cs")).toBe("Dům v sadu");
  });
});

describe("plan", () => {
  it("layout code 5+kk, counted from the room types", () => {
    const n = house.rooms.filter((r) => LAYOUT_ROOM_TYPES.includes(r.type)).length;
    const kitchen = house.rooms.some((r) => r.type === SEPARATE_KITCHEN_TYPE);
    expect(metrics.layoutCode).toBe(`${n}+${kitchen ? 1 : "kk"}`);
    expect(metrics.layoutCode).toBe("5+kk");
    expect(metrics.bedroomCount).toBe(house.rooms.filter((r) => BEDROOM_TYPES.includes(r.type)).length);
  });

  it("every bedroom opens off the bedroom corridor, not off the entrance hall", () => {
    const corridor = house.rooms.find((r) => r.role === "night-corridor")!;
    for (const r of house.rooms.filter((x) => x.type === "bedroom" || x.type === "kids")) {
      expect(d.access.edges.some((e) => (e.a === r.id && e.b === corridor.id) || (e.b === r.id && e.a === corridor.id)), r.id).toBe(true);
      expect(d.access.depth[r.id]).toBe(d.access.depth[corridor.id] + 1);
    }
  });

  it("one lintel line: every window, slider, entry and garage door has the same head", () => {
    const heads = new Set(d.openings.filter((o) => o.exterior).map((o) => o.head));
    expect(heads.size).toBe(1);
  });

  it("blinds on every glazed window and slider of a heated room, none in an unheated room (the garage window)", () => {
    const heated = new Set(d.rooms.filter((r) => r.heated).map((r) => r.id));
    const kinds = house.shading.blinds.kinds as string[];
    for (const o of d.openings.filter((x) => x.exterior && kinds.includes(x.kind) && x.glazingArea > 0)) {
      expect(o.blind, o.id).toBe(heated.has(o.room!));
    }
    const unheatedWindows = d.openings.filter((o) => o.exterior && o.kind === "window" && UNHEATED_TYPES.includes(d.rooms.find((r) => r.id === o.room)!.type));
    expect(unheatedWindows.length).toBeGreaterThan(0);
    for (const o of unheatedWindows) expect(o.blind).toBe(false);
  });

  it("an opening onto the covered terrace is shaded by the whole terrace roof (more than 7 m)", () => {
    const covered = house.outdoor.filter((o) => o.covered && o.type === "terrace");
    let checked = 0;
    for (const o of d.openings.filter((x) => x.exterior && x.overhang)) {
      const n: XY = [Math.sin((o.azimuth! * Math.PI) / 180), Math.cos((o.azimuth! * Math.PI) / 180)];
      const face: XY = [o.cx + (n[0] * house.wall.ext) / 2, o.cy + (n[1] * house.wall.ext) / 2];
      const probe: XY = [face[0] + n[0] * 0.3, face[1] + n[1] * 0.3];
      const t = covered.find((c) => pointInPolygon(probe, rectPoly(c.rect)));
      if (!t) continue;
      // independent: from the wall face across the terrace to its far edge, plus the overhang of the roof beyond it
      const r = t.rect;
      const across = n[0] < -0.5 ? face[0] - r[0] : n[0] > 0.5 ? r[2] - face[0] : n[1] < -0.5 ? face[1] - r[1] : r[3] - face[1];
      const roof = house.roofs.find((q) => q.rect[0] <= r[0] + 1e-9 && q.rect[1] <= r[1] + 1e-9 && q.rect[2] >= r[2] - 1e-9 && q.rect[3] >= r[3] - 1e-9)!;
      expect(o.overhang!.depth).toBeCloseTo(across + (roof.overhang ?? 0), 6);
      expect(o.overhang!.depth).toBeGreaterThan(7);
      expect(o.overhang!.eaveHeight).toBe(house.clearHeight);
      checked++;
    }
    expect(checked).toBeGreaterThan(0);
  });

  it("the louvre wall closes: blades touch at ceil5(asin(thickness / pitch)) and then cover the whole wall", () => {
    const sl = house.shading.slats;
    for (const s of d.screens) {
      const closed = ceil5((Math.asin(sl.width / sl.pitch) * 180) / Math.PI);
      expect(s.closedDeg).toBe(closed);
      expect(sl.depth * Math.cos((closed * Math.PI) / 180)).toBeGreaterThan(sl.pitch); // the chord projected on the wall at the closed stop
      expect(s.restDeg).toBeGreaterThanOrEqual(s.closedDeg);
      expect(s.closedDeg).toBe(15);
    }
    expect(d.screens.length).toBeGreaterThan(0);
  });

  it("a cold attic: the insulated ceiling closes the heated volume", () => {
    expect(d.topEnvelope).toBe("ceiling");
    expect(d.assemblies.ceiling.U).toBeLessThan(d.assemblies.roof.U);
  });
});

describe("plot", () => {
  it("every slab, apron and ramp top stands at least 4 mm above the graded ground (0.25 m grid)", () => {
    let checked = 0;
    for (const sl of withHouse.grading.slabs) {
      const xs = sl.polygon.map((p) => p[0]), ys = sl.polygon.map((p) => p[1]);
      for (let x = Math.min(...xs); x <= Math.max(...xs) + 1e-9; x += 0.25) {
        for (let y = Math.min(...ys); y <= Math.max(...ys) + 1e-9; y += 0.25) {
          if (!pointInPolygon([x, y], sl.polygon) && distToPolygon([x, y], sl.polygon) > 1e-9) continue;
          const top = sl.plane.z0 + sl.plane.gx * (x - sl.plane.ox) + sl.plane.gy * (y - sl.plane.oy);
          expect(top - groundAt(x, y), `${x}, ${y}`).toBeGreaterThanOrEqual(0.004);
          checked++;
        }
      }
    }
    expect(checked).toBeGreaterThan(1000);
  });

  it("the street lies below the finished floor at the drive gate, so the drive falls away from the garage", () => {
    const gate = withHouse.access.driveGate.center;
    expect(groundAt(gate[0], gate[1])).toBeLessThan(0);
    const crown: XY = [gate[0], gate[1] + site.street.verge + site.street.carriageway / 2];
    expect(groundAt(crown[0], crown[1])).toBeLessThan(0);
    const drive = d.outdoor.find((o) => o.grade.ramp?.access === "driveway")!;
    expect(drive.grade.ramp!.z1).toBeLessThan(drive.grade.ramp!.z0);
  });

  it("the drive and the front path fall to their gates steeply enough to drain (and stay barrier-free)", () => {
    const ramps = d.outdoor.filter((o) => o.grade.ramp).map((o) => o.grade.ramp!);
    expect(new Set(ramps.map((r) => r.access))).toEqual(new Set(["driveway", "walkway"]));
    for (const r of ramps) {
      // slope is dz/dy towards the gate: negative = falling away from the house
      expect(-r.slope, r.access).toBeGreaterThanOrEqual(RAMP_MIN_FALL);
      expect(-r.slope, r.access).toBeLessThanOrEqual(RAMP_MAX_SLOPE);
      // independent: the fall over the run from the house end to the gate
      expect((r.z0 - r.z1) / (r.to - r.from)).toBeCloseTo(-r.slope, 5); // derived levels are rounded
    }
    // the lawn around the house stays below the floor on every side (the plinth shows) and the ground falls away from it
    const plateau = site.terrain.plateau;
    expect(plateau.level).toBeLessThan(0);
    const box = d.outline.bbox!;
    const ring: XY[] = [[box.x0 - 1, box.y0 - 1], [box.x1 + 1, box.y0 - 1], [box.x1 + 1, box.y1 + 1], [box.x0 - 1, box.y1 + 1]];
    for (const p of ring) expect(groundAt(p[0], p[1])).toBeLessThanOrEqual(plateau.level + 1e-9);
  });

  it("one fence closes the plot: it is cut only for the gates and the pillar, and each leaf fills its opening", () => {
    expect(site.hedges).toEqual([]);
    expect(withHouse.fences).toHaveLength(1);
    const f = withHouse.fences[0];
    expect(Math.hypot(f.path[0][0] - f.path[f.path.length - 1][0], f.path[0][1] - f.path[f.path.length - 1][1])).toBeLessThan(1e-9);
    const len = polylineLength(f.path);
    const kept = f.parts.reduce((s, p) => s + polylineLength(p), 0);
    const cut = f.gaps.reduce((s, g) => s + (g.to - g.from), 0);
    expect(kept + cut).toBeCloseTo(len, 6);
    expect(f.gaps.every((g) => g.kind === "gate" || g.kind === "pillar")).toBe(true);
    for (const g of withHouse.gates) {
      const gap = f.gaps.find((x) => x.ref === g.id)!;
      expect(gap.to - gap.from).toBeCloseTo(g.leaf + 2 * g.postSize, 9);
      const leafLen = Math.max(...g.leafPolygon.map((p) => polylineLength([g.leafPolygon[0], p])));
      expect(leafLen).toBeGreaterThanOrEqual(g.leaf - 1e-6);
    }
    for (const p of withHouse.pillars) expect(f.gaps.some((x) => x.ref === p.id && Math.abs(x.to - x.from - p.size[0]) < 1e-9)).toBe(true);
    expect(new Set(withHouse.gates.map((g) => g.access))).toEqual(new Set(["driveway", "walkway"]));
  });

  it("no camera stands inside a tree crown, a shrub or the fence (resolved heights)", () => {
    const occ = withHouse.occluders({ minShrubHeight: 0 });
    for (const c of d.cameras) {
      const p = c.position;
      const inside = occ.filter((o) => {
        const ch = rayChord(o, [p[0], p[1], p[2]], [0, 0, 1]);
        return !!ch && ch.tIn <= 0 && ch.tOut >= 0;
      });
      expect(inside.map((o) => o.id), c.id).toEqual([]);
    }
  });

  it("eye-level cameras stand about 1.6 m above the graded ground", () => {
    for (const c of d.cameras.filter((x) => x.aboveGround !== null)) {
      expect(c.position[2] - groundAt(c.position[0], c.position[1])).toBeCloseTo(c.aboveGround!, 4);
      const src = house.cameras.find((x) => x.id === c.id)!;
      expect(Math.abs(src.position[2] - c.position[2])).toBeLessThan(0.05); // the stored z is a close fallback
    }
  });
});
