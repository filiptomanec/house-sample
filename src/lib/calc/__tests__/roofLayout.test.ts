// Tests of roofLayout.ts: grouping of faces into planes, the layout against the kernel's own, geometric invariants of
// the placed panels (inside the face, setbacks, no overlap), the allocation strategies and the stored choice.
import { describe, expect, it } from "vitest";
import { derived, house } from "@/lib/model/instance";
import type { Pt } from "@/lib/model/geom";
import type { RoofFace } from "@/lib/model/types";
import {
  defaultPanelCount,
  defaultPvSelection,
  groupRoofPlanes,
  layoutPanels,
  lightpipeObstacles,
  panelCapacity,
  planeFullLayout,
  planeKey,
  resolvePvSelection,
  type PlacedPanel,
  type RoofPlane,
} from "../roofLayout";

const pv = house.equipment.pv;
const planes = groupRoofPlanes(derived.roofPlanes);
const obstacles = lightpipeObstacles(derived);
const batteryIds = house.equipment.battery.options.map((o) => o.id);
const defaults = defaultPvSelection(house, planes, derived);
const EPS = 1e-6;

const rectOf = (p: PlacedPanel): [number, number, number, number] => p.uv;
const overlap = (a: [number, number, number, number], b: [number, number, number, number]): boolean =>
  Math.min(a[2], b[2]) - Math.max(a[0], b[0]) > 1e-6 && Math.min(a[3], b[3]) - Math.max(a[1], b[1]) > 1e-6;

/** Point in a convex polygon given counter-clockwise (or clockwise), boundary counts as inside. */
function insideConvex(poly: Pt[], p: Pt): boolean {
  let sign = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    const cross = (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]);
    if (Math.abs(cross) < 1e-9) continue;
    if (sign === 0) sign = Math.sign(cross);
    else if (Math.sign(cross) !== sign) return false;
  }
  return true;
}

/** Distance of a point from the infinite line through an edge. */
function lineDistance(a: Pt, b: Pt, p: Pt): number {
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
  return Math.abs((b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0])) / len;
}

describe("groupRoofPlanes", () => {
  it("makes one plane per kernel plane id, with all its faces and its summed area", () => {
    const ids = new Set(derived.roofPlanes.map((f) => f.plane));
    expect(planes.length).toBe(ids.size);
    for (const p of planes) {
      const faces = derived.roofPlanes.filter((f) => f.plane === p.id);
      expect(p.faces.map((f) => f.id)).toEqual(faces.map((f) => f.id));
      expect(p.area).toBeCloseTo(faces.reduce((s, f) => s + f.area, 0), 9);
      for (const f of faces) expect(planeKey(f)).toBe(p.key);
    }
  });

  it("sorts by key and gives unique keys, whatever the order of the faces", () => {
    const keys = planes.map((p) => p.key);
    expect(keys).toEqual([...keys].sort());
    expect(new Set(keys).size).toBe(keys.length);
    const reversed = groupRoofPlanes([...derived.roofPlanes].reverse());
    expect(reversed.map((p) => p.key)).toEqual(keys);
  });

  it("refuses two different planes with the same key", () => {
    const f = derived.roofPlanes[0];
    const twin: RoofFace = { ...f, id: "twin", plane: "twin-plane" };
    expect(() => groupRoofPlanes([f, twin])).toThrow(/same key/);
  });
});

describe("lightpipeObstacles", () => {
  it("has one circle per light pipe with half the diameter", () => {
    expect(obstacles.length).toBe(derived.lightpipes.length);
    obstacles.forEach((o, i) => {
      expect(o).toEqual({ x: derived.lightpipes[i].x, y: derived.lightpipes[i].y, radius: derived.lightpipes[i].diameter / 2 });
    });
  });
});

describe("layoutPanels with default options", () => {
  const layout = layoutPanels(planes, pv, { obstacles });

  it("equals the model's own layout: same count, same kWp, same panels", () => {
    expect(layout.count).toBe(derived.pv.count);
    expect(layout.kwp).toBeCloseTo(derived.pv.kwp, 9);
    expect(layout.area).toBeCloseTo(derived.pv.area, 9);
    const sig = (p: { face: string; row: number; col: number; corners: number[][] }) => `${p.face}|${p.row}|${p.col}|${p.corners.map((c) => c.map((v) => v.toFixed(6)).join(",")).join(";")}`;
    expect(layout.panels.map(sig).sort()).toEqual(derived.pv.panels.map(sig).sort());
  });

  it("matches defaultPanelCount and the default selection of the model", () => {
    expect(defaultPanelCount(derived)).toBe(derived.pv.count);
    expect(defaults.panelCount).toBe(derived.pv.count);
    expect(defaults.batteryId).toBe(house.equipment.battery.default);
    const sides = new Set(planes.filter((p) => defaults.enabledPlanes.includes(p.key)).map((p) => p.side));
    expect([...sides].sort()).toEqual([...pv.layout.facings].sort());
  });

  it("counts: sum of placed = count <= capacity, kwp = count * Wp / 1000, per-side totals add up", () => {
    expect(layout.planes.reduce((s, p) => s + p.placed, 0)).toBe(layout.count);
    expect(layout.count).toBeLessThanOrEqual(layout.capacity);
    expect(layout.panels.length).toBe(layout.count);
    expect(layout.kwp).toBeCloseTo((layout.count * pv.module.wp) / 1000, 12);
    expect(Object.values(layout.countBySide).reduce((a, b) => a + b, 0)).toBe(layout.count);
    expect(Object.values(layout.kwpBySide).reduce((a, b) => a + b, 0)).toBeCloseTo(layout.kwp, 12);
    expect(layout.clamped).toBe(false);
    for (const pl of layout.planes) expect(pl.rows.reduce((a, b) => a + b, 0)).toBe(pl.capacity);
  });

  it("lists all planes, also the disabled ones, with their capacity", () => {
    expect(layout.planes.length).toBe(planes.length);
    expect(layout.planes.filter((p) => !p.enabled).every((p) => p.placed === 0)).toBe(true);
    for (const pl of layout.planes) expect(pl.capacity).toBe(planeFullLayout(planes.find((p) => p.key === pl.key) as RoofPlane, pv, obstacles).count);
  });
});

describe("geometry of the placed panels", () => {
  const layout = layoutPanels(planes, pv, { obstacles });
  const faceById = new Map(derived.roofPlanes.map((f) => [f.id, f]));

  it("keeps every corner of every panel inside its roof face", () => {
    for (const p of layout.panels) {
      const face = faceById.get(p.face) as RoofFace;
      const [u0, v0, u1, v1] = rectOf(p);
      for (const c of [[u0, v0], [u1, v0], [u1, v1], [u0, v1]] as Pt[]) expect(insideConvex(face.uv, c), `${p.id}`).toBe(true);
    }
  });

  it("respects the setback of every edge kind", () => {
    for (const p of layout.panels) {
      const face = faceById.get(p.face) as RoofFace;
      const [u0, v0, u1, v1] = rectOf(p);
      face.edges.forEach((e, i) => {
        if (e.kind === "seam") return;
        const a = face.uv[i], b = face.uv[(i + 1) % face.uv.length];
        for (const c of [[u0, v0], [u1, v0], [u1, v1], [u0, v1]] as Pt[]) {
          expect(lineDistance(a, b, c), `${p.id} edge ${e.kind}`).toBeGreaterThanOrEqual(pv.layout.setback[e.kind] - 1e-6);
        }
      });
    }
  });

  it("never overlaps two panels of the same plane", () => {
    for (const pl of planes) {
      const mine = layout.panels.filter((p) => p.planeKey === pl.key);
      for (let i = 0; i < mine.length; i++) for (let j = i + 1; j < mine.length; j++) expect(overlap(rectOf(mine[i]), rectOf(mine[j])), `${mine[i].id} ${mine[j].id}`).toBe(false);
    }
  });

  it("keeps the panels clear of the roof penetrations", () => {
    for (const p of layout.panels) {
      for (const o of obstacles) {
        // seen from above, the pipe centre is never inside the (convex) outline of a panel
        const xs = p.corners.map((c) => c[0]), ys = p.corners.map((c) => c[1]);
        const inside = o.x > Math.min(...xs) + EPS && o.x < Math.max(...xs) - EPS && o.y > Math.min(...ys) + EPS && o.y < Math.max(...ys) - EPS;
        expect(inside, `${p.id}`).toBe(false);
      }
    }
  });
});

describe("the requested count", () => {
  const capacity = panelCapacity(planes, pv, undefined, obstacles);

  it("is rounded, never negative, clamped to the capacity and flagged when clamped", () => {
    expect(layoutPanels(planes, pv, { count: -4, obstacles }).count).toBe(0);
    expect(layoutPanels(planes, pv, { count: Number.NaN, obstacles }).count).toBe(0);
    expect(layoutPanels(planes, pv, { count: 3.6, obstacles }).count).toBe(4);
    const big = layoutPanels(planes, pv, { count: capacity + 50, obstacles });
    expect(big.count).toBe(capacity);
    expect(big.requested).toBe(capacity + 50);
    expect(big.clamped).toBe(true);
    expect(layoutPanels(planes, pv, { count: Infinity, obstacles }).count).toBe(capacity);
  });

  it("is monotone: more panels requested never place fewer, and the smaller layout is a prefix of the larger", () => {
    let last: string[] = [];
    for (let n = 0; n <= capacity; n++) {
      const l = layoutPanels(planes, pv, { count: n, obstacles });
      expect(l.count).toBe(n);
      const ids = l.panels.map((p) => p.id);
      for (const id of last) expect(ids).toContain(id);
      last = ids;
    }
  });

  it("fills the plane closest to south first", () => {
    const one = layoutPanels(planes, pv, { count: 1, obstacles });
    const best = [...planes].filter((p) => defaults.enabledPlanes.includes(p.key)).sort((a, b) => Math.abs(a.aspect) - Math.abs(b.aspect))[0];
    expect(one.panels[0].planeKey).toBe(best.key);
  });

  it("takes an incomplete row from its centre outwards, so the array stays symmetric", () => {
    const plane = planes.find((p) => p.key === layoutPanels(planes, pv, { count: 1, obstacles }).panels[0].planeKey) as RoofPlane;
    const full = planeFullLayout(plane, pv, obstacles);
    const firstRow = full.panels.filter((p) => p.row === 0 && p.face === plane.faces[0].id);
    if (firstRow.length < 3) return;
    const three = layoutPanels(planes, pv, { count: 3, obstacles }).panels.filter((p) => p.planeKey === plane.key);
    const us = three.map((p) => (p.uv[0] + p.uv[2]) / 2);
    const centre = firstRow.reduce((s, p) => s + (p.uv[0] + p.uv[2]) / 2, 0) / firstRow.length;
    // the three nearest to the middle of the row
    const nearest = [...firstRow].sort((a, b) => Math.abs((a.uv[0] + a.uv[2]) / 2 - centre) - Math.abs((b.uv[0] + b.uv[2]) / 2 - centre)).slice(0, 3).map((p) => (p.uv[0] + p.uv[2]) / 2);
    expect([...us].sort((a, b) => a - b)).toEqual([...nearest].sort((a, b) => a - b));
  });
});

describe("strategy and enabled planes", () => {
  it("spread differs by at most one panel between planes of equal capacity", () => {
    const all = planes.map((p) => p.key);
    const l = layoutPanels(planes, pv, { enabledPlanes: all, count: 17, strategy: "spread", obstacles });
    const enabled = l.planes.filter((p) => p.enabled && p.capacity > 0);
    for (const a of enabled) for (const b of enabled) if (a.capacity === b.capacity) expect(Math.abs(a.placed - b.placed)).toBeLessThanOrEqual(1);
    expect(l.count).toBe(Math.min(17, l.capacity));
  });

  it("gives the same layout whatever the order of the enabled planes and of the planes themselves", () => {
    const keys = planes.map((p) => p.key);
    const a = layoutPanels(planes, pv, { enabledPlanes: keys, count: 20, obstacles });
    const b = layoutPanels([...planes].reverse(), pv, { enabledPlanes: [...keys].reverse(), count: 20, obstacles });
    expect(b.panels.map((p) => p.id)).toEqual(a.panels.map((p) => p.id));
    expect(b.planes.map((p) => p.key)).toEqual(a.planes.map((p) => p.key));
  });

  it("ignores unknown plane keys and places nothing when no plane is enabled", () => {
    const l = layoutPanels(planes, pv, { enabledPlanes: ["nope"], count: 5, obstacles });
    expect(l.count).toBe(0);
    expect(l.capacity).toBe(0);
    expect(l.clamped).toBe(true);
    expect(l.planes.every((p) => !p.enabled)).toBe(true);
  });

  it("capacity of enabling more planes never shrinks", () => {
    let last = 0;
    const keys = [...planes].sort((a, b) => Math.abs(a.aspect) - Math.abs(b.aspect)).map((p) => p.key);
    for (let i = 0; i <= keys.length; i++) {
      const c = panelCapacity(planes, pv, keys.slice(0, i), obstacles);
      expect(c).toBeGreaterThanOrEqual(last);
      last = c;
    }
  });

  it("a larger gap between modules never raises the capacity", () => {
    let last = Infinity;
    for (const gap of [0, 0.02, 0.05, 0.1, 0.2]) {
      const c = panelCapacity(planes, { ...pv, layout: { ...pv.layout, gap } }, undefined, obstacles);
      expect(c).toBeLessThanOrEqual(last);
      last = c;
    }
  });

  it("does not let a caller change the cached layout", () => {
    const a = layoutPanels(planes, pv, { count: 2, obstacles });
    a.panels[0].corners[0][0] += 100;
    a.panels[0].uv[0] += 100;
    const b = layoutPanels(planes, pv, { count: 2, obstacles });
    expect(b.panels[0].corners[0][0]).not.toBe(a.panels[0].corners[0][0]);
    expect(b.panels[0].uv[0]).not.toBe(a.panels[0].uv[0]);
  });
});

describe("resolvePvSelection", () => {
  const keys = planes.map((p) => p.key);
  const resolve = (stored: Parameters<typeof resolvePvSelection>[0]) => resolvePvSelection(stored, defaults, planes, batteryIds);

  it("falls back on the defaults for null and for empty stored fields", () => {
    expect(resolve(null)).toEqual(defaults);
    expect(resolve({ panelCount: null, enabledPlanes: null, batteryId: null })).toEqual(defaults);
  });

  it("keeps valid values and ignores the order of the stored planes", () => {
    const a = resolve({ panelCount: 7, enabledPlanes: [keys[1], keys[0]], batteryId: batteryIds[batteryIds.length - 1] });
    const b = resolve({ panelCount: 7, enabledPlanes: [keys[0], keys[1]], batteryId: batteryIds[batteryIds.length - 1] });
    expect(a).toEqual(b);
    expect(a.panelCount).toBe(7);
    expect(a.enabledPlanes).toEqual([keys[0], keys[1]]);
    expect(a.batteryId).toBe(batteryIds[batteryIds.length - 1]);
  });

  it("drops unknown plane keys, and uses the default planes when none of the stored ones exists", () => {
    expect(resolve({ panelCount: 3, enabledPlanes: [keys[0], "S999.1@0,0"], batteryId: null }).enabledPlanes).toEqual([keys[0]]);
    expect(resolve({ panelCount: 3, enabledPlanes: ["S999.1@0,0"], batteryId: null }).enabledPlanes).toEqual(defaults.enabledPlanes);
  });

  it("keeps an empty list that the visitor chose, and a count above the capacity", () => {
    expect(resolve({ panelCount: 3, enabledPlanes: [], batteryId: null }).enabledPlanes).toEqual([]);
    expect(resolve({ panelCount: 10_000, enabledPlanes: null, batteryId: null }).panelCount).toBe(10_000);
  });

  it("gives the default for a count that is not a finite number >= 0 and for an unknown battery", () => {
    for (const bad of [-1, Number.NaN, Infinity, "5" as unknown as number]) {
      expect(resolve({ panelCount: bad, enabledPlanes: null, batteryId: null }).panelCount).toBe(defaults.panelCount);
    }
    expect(resolve({ panelCount: 4, enabledPlanes: null, batteryId: "no-such-battery" }).batteryId).toBe(defaults.batteryId);
  });

  it("never throws on garbage", () => {
    const garbage = [{ panelCount: {}, enabledPlanes: "x", batteryId: 5 }, { enabledPlanes: [1, null, {}] }, {}] as unknown as Parameters<typeof resolvePvSelection>[0][];
    for (const g of garbage) expect(() => resolve(g)).not.toThrow();
  });
});
