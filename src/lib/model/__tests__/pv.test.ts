// PV layout rules on synthetic roofs (independent of the house numbers).
import { describe, expect, it } from "vitest";
import { layoutPv, type PvSpec } from "../pv";
import { buildRoofFaces } from "../roofs";

const spec = (over: Partial<PvSpec["layout"]> = {}): PvSpec => ({
  module: { wp: 400, width: 1, height: 2 },
  layout: { facings: ["S"], orientation: "portrait", gap: 0, setback: { eave: 0, ridge: 0, hip: 0, valley: 0, step: 0 }, obstacleClearance: 0, ...over },
});
// A gable-like roof: a very long hip roof, so that the south plane is almost a rectangle
const faces = buildRoofFaces([{ id: "A", rect: [0, 0, 60, 8], pitch: 30, overhang: 0, wallTop: 3 }], 0);
const south = faces.find((f) => f.side === "S")!;

describe("layoutPv", () => {
  it("fills the usable area row by row (portrait: 2 m up the slope)", () => {
    const L = layoutPv(faces, spec());
    expect(L.count).toBeGreaterThan(0);
    // slope length of the south plane is 4 / cos 30 = 4.62 m: two rows of 2 m modules
    expect(L.byFace[0].rows).toHaveLength(2);
    // the first row spans the trapezoid at the height of the top edge of the row
    const rowTop = 2; // v of the top edge of row 0
    const widthAt = (v: number): number => {
      // plan distance from the eave = v cos 30; hips are at 45 degrees
      const w = 60 - 2 * v * Math.cos((30 * Math.PI) / 180);
      return w;
    };
    expect(L.byFace[0].rows[0]).toBe(Math.floor(widthAt(rowTop) + 1e-9));
    expect(L.kwp).toBeCloseTo((L.count * 400) / 1000, 12);
    expect(south.area).toBeGreaterThan(L.area);
  });

  it("setbacks and gaps reduce the count monotonically", () => {
    const a = layoutPv(faces, spec()).count;
    const b = layoutPv(faces, spec({ setback: { eave: 0.5, ridge: 0, hip: 0, valley: 0, step: 0 } })).count;
    const c = layoutPv(faces, spec({ setback: { eave: 0.5, ridge: 0.5, hip: 1, valley: 0, step: 0 } })).count;
    const d = layoutPv(faces, spec({ gap: 0.1, setback: { eave: 0.5, ridge: 0.5, hip: 1, valley: 0, step: 0 } })).count;
    expect(a).toBeGreaterThanOrEqual(b);
    expect(b).toBeGreaterThan(c);
    expect(c).toBeGreaterThanOrEqual(d);
  });

  it("only the selected facings carry modules", () => {
    const s = layoutPv(faces, spec({ facings: ["S"] }));
    const n = layoutPv(faces, spec({ facings: ["N"] }));
    const both = layoutPv(faces, spec({ facings: ["S", "N"] }));
    expect(s.panels.every((p) => p.plane.endsWith(".S"))).toBe(true);
    expect(n.panels.every((p) => p.plane.endsWith(".N"))).toBe(true);
    expect(both.count).toBe(s.count + n.count);
    expect(layoutPv(faces, spec({ facings: ["W"] })).count).toBeGreaterThanOrEqual(0);
  });

  it("an obstacle removes modules and keeps its clearance", () => {
    const free = layoutPv(faces, spec());
    const cx = 30;
    const cy = 2;
    const blocked = layoutPv(faces, spec({ obstacleClearance: 0.2 }), [{ x: cx, y: cy, radius: 0.2 }]);
    expect(blocked.count).toBeLessThan(free.count);
    for (const p of blocked.panels) {
      const mid = p.center;
      // plan distance of the module rectangle from the obstacle axis is at least radius + clearance
      const xs = p.corners.map((c) => c[0]);
      const ys = p.corners.map((c) => c[1]);
      const nx = Math.min(Math.max(cx, Math.min(...xs)), Math.max(...xs));
      const ny = Math.min(Math.max(cy, Math.min(...ys)), Math.max(...ys));
      const dist = Math.hypot(nx - cx, ny - cy);
      // in the plan the module is foreshortened along y, so allow for the slope factor
      expect(dist, `${mid}`).toBeGreaterThanOrEqual(0.4 * Math.cos((30 * Math.PI) / 180) - 1e-6);
    }
  });

  it("'auto' is never worse than portrait, landscape swaps the module sides", () => {
    const portrait = layoutPv(faces, spec());
    const land = layoutPv(faces, spec({ orientation: "landscape" }));
    const auto = layoutPv(faces, spec({ orientation: "auto" }));
    expect(auto.count).toBeGreaterThanOrEqual(Math.max(portrait.count, land.count));
    const p = land.panels[0];
    expect(p.uv[2] - p.uv[0]).toBeCloseTo(2, 12);
    expect(p.uv[3] - p.uv[1]).toBeCloseTo(1, 12);
  });

  it("a module larger than the plane gives an empty layout", () => {
    const L = layoutPv(faces, { module: { wp: 400, width: 100, height: 100 }, layout: spec().layout });
    expect(L.count).toBe(0);
    expect(L.kwp).toBe(0);
  });

  it("modules are centred in their row", () => {
    const L = layoutPv(faces, spec());
    const row0 = L.panels.filter((p) => p.row === 0);
    const left = Math.min(...row0.map((p) => p.uv[0]));
    const right = Math.max(...row0.map((p) => p.uv[2]));
    const mid = (left + right) / 2;
    // the middle of the plane in u is the middle of the ridge
    const us = south.uv.map((p) => p[0]);
    expect(mid).toBeCloseTo((Math.min(...us) + Math.max(...us)) / 2, 9);
  });
});
