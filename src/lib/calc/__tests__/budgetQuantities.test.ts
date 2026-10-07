// Quantities of the model. The oracles read the raw house.json rectangles and the roof polygons directly (shoelace formulas),
// not the derived areas, so a mistake in the derivation or in the budget cannot cancel out. The invariants hold for any house.
import { describe, expect, it } from "vitest";
import { derive } from "@/lib/model/derive";
import { HouseSchema } from "@/lib/model/schema";
import { rawHouse, pc } from "@/lib/model/__tests__/helpers";
import { OPENING_KINDS } from "@/lib/model/catalog";
import { pathAlongPlot, polylineLength } from "@/lib/model/site";
import type { Polygon } from "polygon-clipping";
import { deriveQuantities, materialTakeoff, QUANTITY_KEYS, pvQuantities } from "../budget";
import { derived, house, modelQuantities, site } from "./budgetFixtures";

const q = modelQuantities();
const sum = (xs: readonly number[]) => xs.reduce((a, b) => a + b, 0);
const near = (a: number, b: number, tol = 1e-6) => Math.abs(a - b) <= tol * Math.max(1, Math.abs(b));

type Ring = [number, number][];
const ringArea = (r: Ring) => Math.abs(sum(r.map((p, i) => p[0] * r[(i + 1) % r.length][1] - r[(i + 1) % r.length][0] * p[1]))) / 2;
const ringLength = (r: Ring) => sum(r.map((p, i) => Math.hypot(r[(i + 1) % r.length][0] - p[0], r[(i + 1) % r.length][1] - p[1])));

describe("deriveQuantities: the table", () => {
  it("returns every key, finite and not negative, counts as integers", () => {
    for (const k of QUANTITY_KEYS) {
      expect(Number.isFinite(q[k]), k).toBe(true);
      expect(q[k], k).toBeGreaterThanOrEqual(0);
      if (k.endsWith(".count") || k.endsWith("Count")) expect(Number.isInteger(q[k]), k).toBe(true);
    }
    expect(Object.keys(q).sort()).toEqual([...QUANTITY_KEYS].sort());
  });

  it("is deterministic", () => {
    expect(deriveQuantities(house, derived, site)).toEqual(q);
  });
});

describe("floor, footprint and volumes", () => {
  it("floor areas add up and fit in the footprint", () => {
    expect(q.floorAreaHeated + q.floorAreaUnheated).toBeCloseTo(q.floorAreaTotal, 9);
    expect(q.floorAreaTotal).toBeLessThanOrEqual(q.footprintArea);
    expect(q["floorArea.oak"] + q["floorArea.tile"] + q["floorArea.concrete"] + q["floorArea.stone"]).toBeLessThanOrEqual(q.floorAreaTotal + 1e-9);
    expect(q.ceilingArea).toBe(q.floorAreaTotal);
  });

  it("matches the sum of the net room rectangles (shoelace of the rectangles, not the stored room area)", () => {
    // the derived room areas are rounded to 1e-5 m2 per room, the rectangles are not
    const rectsArea = (r: [number, number, number, number][]) => sum(r.map(([x0, y0, x1, y1]) => ringArea([[x0, y0], [x1, y0], [x1, y1], [x0, y1]])));
    expect(q.floorAreaHeated).toBeCloseTo(sum(derived.rooms.filter((r) => r.heated).map((r) => rectsArea(r.cleanRects))), 3);
    expect(q.floorAreaUnheated).toBeCloseTo(sum(derived.rooms.filter((r) => !r.heated).map((r) => rectsArea(r.cleanRects))), 3);
    for (const finish of ["oak", "tile", "concrete", "stone"] as const) {
      const expected = sum(derived.rooms.filter((r) => r.floor === finish).map((r) => rectsArea(r.cleanRects)));
      expect(q[`floorArea.${finish}`], finish).toBeCloseTo(expected, 3);
    }
  });

  it("footprint area and perimeter equal the union of the axis rectangles grown by half the wall (polygon clipping)", () => {
    const grown = house.rooms.flatMap((r) => r.rects).map(([x0, y0, x1, y1]): [number, number][] => {
      const h = house.wall.ext / 2;
      return [[x0 - h, y0 - h], [x1 + h, y0 - h], [x1 + h, y1 + h], [x0 - h, y1 + h], [x0 - h, y0 - h]];
    });
    const polys = grown.map((r) => [r] as Polygon);
    const union = pc.union(polys[0], ...polys.slice(1));
    const rings = union.flatMap((poly) => poly.map((r) => r.slice(0, -1) as Ring));
    const outer = union.map((poly) => ringArea(poly[0].slice(0, -1) as Ring));
    const holes = union.flatMap((poly) => poly.slice(1).map((r) => ringArea(r.slice(0, -1) as Ring)));
    expect(q.footprintArea).toBeCloseTo(sum(outer) - sum(holes), 4);
    expect(q.footprintPerimeter).toBeCloseTo(sum(rings.map(ringLength)), 4);
  });

  it("the enclosed volume is between the footprint x wall top and footprint x ridge", () => {
    expect(q.volumeEnclosed).toBeGreaterThan(q.footprintArea * derived.defaultWallTop * 0.9);
    expect(q.volumeEnclosed).toBeLessThan(q.footprintArea * derived.bbox.z1);
  });
});

describe("walls and surfaces", () => {
  it("gross minus opaque exterior wall is exactly the area of the openings in exterior walls", () => {
    const outside = sum(derived.openings.filter((o) => o.exterior === true).map((o) => (o.head - o.sill) * o.w));
    expect(q.extWallAreaGross - q.extWallAreaOpaque).toBeCloseTo(outside, 6);
  });

  it("the outer length of the exterior walls adds up to the outline perimeter (gross area = perimeter x mean wall height)", () => {
    const ext = derived.walls.filter((w) => w.ext);
    const tops = ext.map((w) => w.height ?? derived.defaultWallTop);
    expect(q.extWallAreaGross).toBeGreaterThan(q.footprintPerimeter * Math.min(...tops) - 1e-9);
    expect(q.extWallAreaGross).toBeLessThan(q.footprintPerimeter * Math.max(...tops) + 1e-9);
  });

  it("interior walls: area = axis length x clear height minus the doors in them", () => {
    const clear = house.clearHeight;
    const doors = sum(derived.openings.filter((o) => o.exterior === false).map((o) => o.area));
    expect(q.bearingWallArea + q.partitionWallArea + doors).toBeCloseTo((q.bearingWallLength + q.partitionWallLength) * clear, 6);
    expect(q.extWallLength + q.bearingWallLength + q.partitionWallLength).toBeCloseTo(sum(derived.walls.map((w) => w.len)), 6);
  });

  it("room surfaces agree with the wall lengths (two independent derivations, within the junction allowance)", () => {
    // Every interior wall has two faces, every exterior wall one; the faces are shorter than the axes by the wall thickness at the
    // junctions, which is why the comparison has a tolerance (a few percent of a house with ~15 rooms).
    const clear = house.clearHeight;
    const faces = (2 * (q.bearingWallLength + q.partitionWallLength) + q.extWallLength) * clear;
    const opening = sum(derived.openings.filter((o) => o.exterior === true).map((o) => o.area)) + 2 * sum(derived.openings.filter((o) => o.exterior === false).map((o) => o.area));
    const expected = faces - opening;
    const got = q.plasterArea + q.wetWallArea;
    expect(Math.abs(got - expected) / expected).toBeLessThan(0.12);
    expect(q.wetWallArea).toBeGreaterThan(0);
    expect(q.plasterArea).toBeGreaterThan(q.wetWallArea);
  });

  it("wood cladding is the strip width times the height of the wall, and the render area is what is left", () => {
    const expected = sum(derived.accents.filter((a) => a.wallId).map((a) => a.w * (derived.walls.find((w) => w.id === a.wallId)?.height ?? derived.defaultWallTop)));
    expect(q.woodCladdingArea).toBeCloseTo(expected, 6);
    expect(q.facadeRenderArea).toBeCloseTo(q.extWallAreaOpaque - q.woodCladdingArea, 6);
  });
});

describe("openings (oracle: the raw openings of house.json)", () => {
  for (const kind of OPENING_KINDS) {
    it(`${kind}: count and area`, () => {
      const raw = house.openings.filter((o) => o.kind === kind);
      expect(q[`${kind}.count`]).toBe(raw.length);
      expect(q[`${kind}.area`]).toBeCloseTo(sum(raw.map((o) => o.w * (o.head - o.sill))), 9);
    });
  }

  it("sills, blinds and snow guards follow the model's flags", () => {
    expect(q.windowSillLength).toBeCloseTo(sum(derived.openings.filter((o) => o.kind === "window" && o.exterior && o.sill > 0).map((o) => o.w)), 9);
    expect(q["blind.count"]).toBe(derived.openings.filter((o) => o.blind).length);
    expect(q["blind.area"]).toBeCloseTo(sum(Object.values(derived.facings).map((f) => f.blindedGlazingArea)), 6);
    const kinds = house.roof.snowGuards.aboveOpeningKinds as string[];
    expect(q.snowGuardLength).toBeCloseTo(sum(derived.openings.filter((o) => o.exterior && kinds.includes(o.kind)).map((o) => o.w)), 9);
  });
});

describe("roof (oracle: the polygons of the roof planes)", () => {
  const area3 = (p: [number, number, number][]) => {
    // vector area of a planar polygon: half the length of the sum of cross products
    let cx = 0, cy = 0, cz = 0;
    for (let i = 0; i < p.length; i++) {
      const a = p[i], b = p[(i + 1) % p.length];
      cx += a[1] * b[2] - a[2] * b[1];
      cy += a[2] * b[0] - a[0] * b[2];
      cz += a[0] * b[1] - a[1] * b[0];
    }
    return Math.hypot(cx, cy, cz) / 2;
  };

  it("the sloped and the plan area are the sums over the faces", () => {
    expect(q.roofAreaSloped).toBeCloseTo(sum(derived.roofPlanes.map((f) => area3(f.pts3))), 4);
    expect(q.roofAreaPlan).toBeCloseTo(sum(derived.roofPlanes.map((f) => ringArea(f.pts))), 4);
    expect(q.roofAreaSloped).toBeGreaterThanOrEqual(q.roofAreaPlan);
    expect(q.roofAreaOverFootprint).toBeLessThanOrEqual(q.roofAreaSloped);
    expect(q.roofAreaOverFootprint).toBeGreaterThanOrEqual(q.footprintArea);
  });

  it("edge lengths come from the vertices; ridges, hips and valleys are shared by two faces and counted once", () => {
    const len: Record<string, number> = {};
    for (const f of derived.roofPlanes) {
      f.edges.forEach((e, i) => {
        const a = f.pts3[i], b = f.pts3[(i + 1) % f.pts3.length];
        len[e.kind] = (len[e.kind] ?? 0) + Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
      });
    }
    expect(q.eaveLength).toBeCloseTo(len.eave, 6);
    expect(q.ridgeLength).toBeCloseTo((len.ridge ?? 0) / 2, 6);
    expect(q.hipLength).toBeCloseTo((len.hip ?? 0) / 2, 6);
    expect(q.valleyLength).toBeCloseTo((len.valley ?? 0) / 2, 6);
    expect(q.gutterLength).toBe(q.eaveLength);
  });

  it("downpipes and light pipes are counted from the model", () => {
    expect(q["downpipe.count"]).toBe(house.roof.downpipes.length);
    expect(q["lightpipe.count"]).toBe(house.lightpipes.length);
  });
});

describe("equipment", () => {
  it("takes the model's own PV and battery by default", () => {
    expect(q["pv.count"]).toBe(derived.pv.count);
    expect(q["pv.kwp"]).toBeCloseTo((derived.pv.count * house.equipment.pv.module.wp) / 1000, 9);
    expect(q["inverter.kw"]).toBe(house.equipment.pv.inverter.ratedKw);
    expect(q["battery.kwh"]).toBe(house.equipment.battery.options.find((o) => o.id === house.equipment.battery.default)?.capacityKwh);
    expect(q["heatPump.kw"]).toBe(house.equipment.heating.ratedPowerKw);
  });

  it("replaces them with the visitor's choice, and has no inverter without modules", () => {
    const chosen = deriveQuantities(house, derived, site, { pv: { panelCount: 12, kwp: 5.16, batteryKwh: 5 } });
    expect(chosen["pv.count"]).toBe(12);
    expect(chosen["pv.kwp"]).toBe(5.16);
    expect(chosen["battery.kwh"]).toBe(5);
    expect(chosen["inverter.kw"]).toBe(house.equipment.pv.inverter.ratedKw);
    const none = pvQuantities(house, derived.pv, { panelCount: 0, kwp: 0, batteryKwh: 0 });
    expect(none).toEqual({ "pv.count": 0, "pv.kwp": 0, "inverter.kw": 0, "battery.kwh": 0 });
    // nothing else moves
    const { "pv.count": a, "pv.kwp": b, "inverter.kw": c, "battery.kwh": d, ...rest } = chosen;
    const { "pv.count": a0, "pv.kwp": b0, "inverter.kw": c0, "battery.kwh": d0, ...rest0 } = q;
    expect([a, b, c, d]).not.toEqual([a0, b0, c0, d0]);
    expect(rest).toEqual(rest0);
  });

  it("repairs bad choices instead of producing NaN or negative numbers", () => {
    const bad = pvQuantities(house, derived.pv, { panelCount: Number.NaN, kwp: -3, batteryKwh: Number.POSITIVE_INFINITY });
    expect(bad).toEqual({ "pv.count": 0, "pv.kwp": 0, "inverter.kw": 0, "battery.kwh": 0 });
  });

  it("counts fixtures and the kitchen from the furniture types", () => {
    const fixtures = derived.furniture.filter((f) => ["wc", "sink", "sink2", "shower", "bath"].includes(f.type)).length;
    expect(q.sanitaryFixtureCount).toBe(fixtures);
    expect(q.kitchenRunLength).toBeGreaterThan(0);
  });
});

describe("outdoor areas and the plot", () => {
  it("terraces, paving and posts come from the outdoor areas", () => {
    const area = (f: (o: (typeof derived.outdoor)[number]) => boolean) => sum(derived.outdoor.filter(f).map((o) => o.area));
    expect(q.terraceAreaCovered).toBeCloseTo(area((o) => o.type === "terrace" && o.covered), 9);
    expect(q.terraceAreaUncovered).toBeCloseTo(area((o) => o.type === "terrace" && !o.covered), 9);
    expect(q.coveredOutdoorArea).toBeCloseTo(area((o) => o.covered), 9);
    expect(q.pavingArea + q.driveArea + q.pathArea + q.terraceAreaCovered + q.terraceAreaUncovered).toBeCloseTo(area(() => true), 9);
    expect(q.postCount).toBe(sum(derived.outdoor.map((o) => o.posts.length)));
    expect(q.screenLength).toBeCloseTo(sum(house.screens.map((s) => (s.orient === "v" ? Math.abs(s.y1 - s.y0) : Math.abs(s.x1 - s.x0)))), 9);
  });

  it("built-up, hard and green area fill the plot exactly", () => {
    expect(q.builtUpArea + q.hardSurfaceArea + q.greenArea).toBeCloseTo(q.plotArea, 6);
    expect(q.builtUpArea).toBeGreaterThanOrEqual(q.footprintArea - 1e-6);
    expect(q.plotArea).toBeGreaterThan(q.footprintArea);
  });

  it("fences lose exactly the width of the gates they hold", () => {
    const placed = site.withHouse(house.outdoor);
    const gates = [placed.access.driveGate, placed.access.walkGate];
    const full = sum(site.model.fences.filter((f) => f.gates).map((f) => polylineLength(placedPath(f))));
    const cutWidth = full - sum(placed.fences.filter((_, i) => site.model.fences[i].gates).flatMap((f) => f.parts.map((p) => polylineLength(p))));
    expect(q.gateCount).toBeLessThanOrEqual(gates.length);
    // each gate that the quantities count removed its width, none other did
    const widths = gates.map((g) => g.width).sort((a, b) => a - b);
    const candidates = [0, ...widths, widths.reduce((s, w) => s + w, 0)];
    expect(candidates.some((c) => near(c, cutWidth, 1e-3))).toBe(true);
    expect(q.gateCount > 0).toBe(cutWidth > 1e-6);
  });

  it("planting and grading come from the site model", () => {
    expect(q.treeCount).toBe(site.model.trees.length);
    expect(q.shrubCount).toBe(site.model.shrubs.length);
    expect(q.hedgeLength).toBeCloseTo(sum(site.hedges.map((h) => polylineLength(h.path))), 9);
    expect(q.earthworkCutVolume).toBeGreaterThanOrEqual(0);
    expect(q.earthworkFillVolume).toBeGreaterThanOrEqual(0);
  });
});

function placedPath(f: (typeof site.model.fences)[number]) {
  return pathAlongPlot(site.plot, f.inset, f.from, f.to);
}

describe("the quantities do not depend on ids or on the order of the lists", () => {
  const variant = (change: (h: Record<string, unknown[]> & Record<string, unknown>) => void) => {
    const raw = rawHouse();
    change(raw as never);
    const h = HouseSchema.parse(raw);
    return deriveQuantities(h, derive(h), site);
  };
  const expectSame = (other: ReturnType<typeof deriveQuantities>) => {
    for (const k of QUANTITY_KEYS) expect(near(other[k], q[k], 1e-9), `${k}: ${other[k]} vs ${q[k]}`).toBe(true);
  };

  it("renaming every id changes nothing", () => {
    expectSame(variant((h) => {
      for (const list of ["rooms", "openings", "accents", "roofs", "outdoor", "screens"]) for (const item of h[list] as { id: string }[]) item.id = `zz-${item.id}-zz`;
    }));
  });

  it("reversing the lists changes nothing", () => {
    expectSame(variant((h) => {
      for (const list of ["rooms", "openings", "accents", "outdoor", "furniture", "screens"]) (h[list] as unknown[]).reverse();
    }));
  });
});

describe("the quantities follow the model", () => {
  it("a wider window adds window area and takes the same area off the exterior wall", () => {
    const raw = rawHouse();
    const windows = (raw.openings as { kind: string; w: number; cx: number }[]).filter((o) => o.kind === "window");
    windows[0].w += 0.1; // grows around its centre, still inside its wall
    const h = HouseSchema.parse(raw);
    const wider = deriveQuantities(h, derive(h), site);
    expect(wider["window.area"]).toBeGreaterThan(q["window.area"]);
    expect(wider.extWallAreaOpaque).toBeLessThan(q.extWallAreaOpaque);
    expect(wider["window.count"]).toBe(q["window.count"]);
  });
});

describe("materialTakeoff", () => {
  const rows = materialTakeoff(house, q);

  it("has one row per layer of every assembly, volume = thickness x area", () => {
    const layers = sum(Object.values(house.assemblies).map((a) => a.layers.length));
    expect(rows).toHaveLength(layers);
    for (const r of rows) expect(r.volume, `${r.assembly}/${r.layerId}`).toBeCloseTo(r.thickness * r.area, 12);
  });

  it("covers the areas of the assemblies", () => {
    const area = (assembly: string, layerId: string) => rows.find((r) => r.assembly === assembly && r.layerId === layerId)?.area;
    expect(area("exteriorWall", house.assemblies.exteriorWall.layers[0].id)).toBe(q.extWallAreaOpaque);
    expect(area("bearingWall", house.assemblies.bearingWall.layers[0].id)).toBe(q.bearingWallArea);
    const roofLayer = (role: string) => house.assemblies.roof.layers.find((l) => l.role === role)!.id;
    expect(area("roof", roofLayer("insulation"))).toBe(q.roofAreaOverFootprint);
    expect(area("roof", roofLayer("cladding"))).toBe(q.roofAreaSloped); // the covering runs over the overhangs
    expect(area("ceiling", house.assemblies.ceiling.layers[0].id)).toBe(q.ceilingArea);
  });

  it("lets the slab run under the walls but stops the screed and the finish at them", () => {
    for (const layer of house.assemblies.groundFloor.layers) {
      const r = rows.find((x) => x.assembly === "groundFloor" && x.layerId === layer.id)!;
      expect(r.area, layer.id).toBe(layer.role === "finish" || layer.role === "screed" ? q.floorAreaTotal : q.footprintArea);
    }
  });

  it("volume of the exterior wall = total thickness x opaque area", () => {
    const total = sum(rows.filter((r) => r.assembly === "exteriorWall").map((r) => r.volume));
    expect(total).toBeCloseTo(derived.assemblies.exteriorWall.thickness * q.extWallAreaOpaque, 9);
  });
});
