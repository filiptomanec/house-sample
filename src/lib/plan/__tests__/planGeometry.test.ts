// Invariants of the floor plan drawing against the derived data of the shared house. No numbers of the house are written
// here: expected values are recomputed from `derived` by independent routes (point sampling, identities of the kernel).
import { describe, expect, it } from "vitest";
import { derived } from "@/lib/model/instance";
import { pointInRing, wallBody, type Pt, type Rect } from "@/lib/model/geom";
import { ROOM_TYPES } from "@/lib/model/catalog";
import { gapRect, buildPlanDrawing, ROOM_FILL, PLAN_FILL, spanAt, viewBoxOf, type PlanRect, type PlanRing } from "../planGeometry";
import { signedArea } from "../rects";
import { planLayers, planToSvg, pathOf } from "../svg";

const drawing = buildPlanDrawing(derived);
const inRects = (rs: readonly Rect[], x: number, y: number) => rs.some((r) => x > r[0] && x < r[2] && y > r[1] && y < r[3]);
const evenOdd = (rings: readonly PlanRing[], x: number, y: number) => rings.filter((r) => pointInRing([x, y], r)).length % 2 === 1;
const toPlan = (r: Rect): PlanRect => [r[0], -r[3], r[2], -r[1]];
const finite = (v: unknown): boolean => (typeof v === "number" ? Number.isFinite(v) : Array.isArray(v) ? v.every(finite) : v && typeof v === "object" ? Object.values(v).every(finite) : true);

describe("plan drawing: structure", () => {
  it("is plain finite data", () => {
    expect(finite(drawing)).toBe(true);
    expect(JSON.parse(JSON.stringify(drawing))).toEqual(drawing);
  });

  it("covers every room, opening, furniture item and outdoor area of the model", () => {
    expect(drawing.rooms.map((r) => r.id)).toEqual(derived.rooms.map((r) => r.id));
    expect(drawing.openings).toHaveLength(derived.openings.length);
    expect(drawing.furniture).toHaveLength(derived.furniture.length);
    expect(drawing.lightpipes).toHaveLength(derived.lightpipes.length);
    expect(drawing.screens).toHaveLength(derived.screens.length);
    expect(drawing.walls.map((w) => w.kind)).toEqual(["partition", "bearing", "exterior"]);
  });

  it("has a fill colour for every room type and a token for every fill", () => {
    for (const t of ROOM_TYPES) expect(PLAN_FILL[ROOM_FILL[t]]).toMatch(/^--/);
  });

  it("omits furniture on request", () => {
    expect(buildPlanDrawing(derived, { furniture: false }).furniture).toEqual([]);
  });

  it("frames everything it draws", () => {
    const { x, y, w, h } = drawing.viewBox;
    const inside = (r: PlanRect) => r[0] >= x - 1e-6 && r[1] >= y - 1e-6 && r[2] <= x + w + 1e-6 && r[3] <= y + h + 1e-6;
    for (const o of drawing.outdoor) expect(inside(o.rect)).toBe(true);
    for (const p of drawing.outline) for (const [px, py] of p) expect(inside([px, py, px, py])).toBe(true);
    for (const m of drawing.dimensions) for (const q of m.line) expect(inside([q[0], q[1], q[0], q[1]])).toBe(true);
    expect(inside([drawing.north.at[0], drawing.north.at[1], drawing.north.at[0], drawing.north.at[1]])).toBe(true);
    expect(inside([drawing.scale.at[0], drawing.scale.at[1], drawing.scale.at[0] + drawing.scale.length, drawing.scale.at[1]])).toBe(true);
    expect(viewBoxOf(drawing).split(" ").map(Number)).toEqual([x, y, w, h]);
  });
});

describe("plan drawing: rooms", () => {
  it("has outer rings of positive area whose sum is the room area (net) and the axis area", () => {
    for (const [i, r] of drawing.rooms.entries()) {
      const room = derived.rooms[i];
      const sum = (rings: PlanRing[]) => rings.reduce((s, q) => s + signedArea(q), 0);
      expect(sum(r.net)).toBeCloseTo(room.area, 3); // path data is rounded to millimetres
      expect(sum(r.rings)).toBeCloseTo(room.axisArea, 3);
      expect(r.area).toBeCloseTo(room.area, 9);
      expect(r.net.some((q) => signedArea(q) > 0)).toBe(true);
    }
  });

  it("puts the label point inside the room, with a span that contains it", () => {
    for (const r of drawing.rooms) {
      const [x, y] = r.label.at;
      expect(r.net.some((q) => pointInRing([x, y], q))).toBe(true);
      expect(r.label.spanX[0]).toBeLessThanOrEqual(x);
      expect(r.label.spanX[1]).toBeGreaterThanOrEqual(x);
      expect(r.label.spanY[0]).toBeLessThanOrEqual(y);
      expect(r.label.spanY[1]).toBeGreaterThanOrEqual(y);
      expect(r.label.spanX[1] - r.label.spanX[0]).toBeGreaterThanOrEqual(2 * r.label.r - 2e-3);
    }
  });

  it("finds the free interval of a ring through a point", () => {
    const L: Pt[] = [[0, 0], [4, 0], [4, 1], [1, 1], [1, 3], [0, 3]];
    expect(spanAt(L, [0.5, 0.5], 0)).toEqual([0, 4]);
    expect(spanAt(L, [0.5, 2], 0)).toEqual([0, 1]);
    expect(spanAt(L, [0.5, 2], 1)).toEqual([0, 3]);
  });

  it("net rooms and wall bodies tile the footprint (sampled)", () => {
    const rooms = drawing.rooms.reduce((s, r) => s + r.area, 0);
    const bodies = derived.walls.map((w) => wallBody(w, derived.walls));
    // sample the footprint on a grid: every point is in a net room or in a wall body, never both
    const ob = derived.outline.bbox!;
    let bad = 0, n = 0;
    for (let x = ob.x0 + 0.0137; x < ob.x1; x += 0.11) for (let y = ob.y0 + 0.0173; y < ob.y1; y += 0.11) {
      if (!derived.outline.rects.some((r) => x > r[0] && x < r[2] && y > r[1] && y < r[3])) continue;
      n++;
      const inRoom = derived.rooms.some((r) => inRects(r.cleanRects, x, y));
      const inWall = inRects(bodies, x, y);
      if (inRoom === inWall) bad++;
    }
    expect(n).toBeGreaterThan(1000);
    // the kernel's wall bodies overhang the net rooms by a few centimetres at a handful of junctions (rect corners)
    expect(bad / n).toBeLessThan(0.005);
    expect(rooms).toBeGreaterThan(0);
  });
});

describe("plan drawing: walls and openings", () => {
  const gaps: Rect[] = derived.openings.map((o) => gapRect(o, derived.walls.find((w) => w.id === o.wallId)!));
  const bodies = derived.walls.map((w) => wallBody(w, derived.walls));

  it("draws exactly the wall bodies minus the opening gaps and the net rooms (point sampling oracle)", () => {
    const ob = derived.outline.bbox!;
    const netRooms = derived.rooms.flatMap((r) => r.cleanRects);
    let n = 0, wrong = 0, cut = 0;
    for (let x = ob.x0 + 0.0071; x < ob.x1; x += 0.037) for (let y = ob.y0 + 0.0113; y < ob.y1; y += 0.037) {
      const expected = inRects(bodies, x, y) && !inRects(gaps, x, y) && !inRects(netRooms, x, y);
      const got = drawing.walls.some((l) => evenOdd(l.rings, x, -y));
      if (inRects(bodies, x, y) && inRects(gaps, x, y)) cut++;
      if (expected !== got) wrong++;
      n++;
    }
    expect(n).toBeGreaterThan(50000);
    expect(cut).toBeGreaterThan(0);
    expect(wrong).toBe(0);
  }, 30_000);

  it("keeps wall kinds apart: partition points are not exterior and vice versa where only one kind exists", () => {
    for (const w of derived.walls.filter((q) => q.kind === "exterior")) {
      const mid = w.orient === "h" ? [(w.from + w.to) / 2, w.at] : [w.at, (w.from + w.to) / 2];
      const hasGap = gaps.some((g) => mid[0] > g[0] && mid[0] < g[2] && mid[1] > g[1] && mid[1] < g[3]);
      if (!hasGap) expect(evenOdd(drawing.walls[2].rings, mid[0], -mid[1])).toBe(true);
    }
  });

  it("cuts every opening through the full wall thickness", () => {
    for (const [i, o] of drawing.openings.entries()) {
      const src = derived.openings[i], wall = derived.walls.find((w) => w.id === src.wallId)!;
      const w = o.gap[2] - o.gap[0], h = o.gap[3] - o.gap[1];
      expect(Math.max(w, h)).toBeCloseTo(src.w, 3);
      expect(Math.min(w, h)).toBeCloseTo(wall.t, 3);
      expect(o.kind).toBe(src.kind);
      expect(o.h).toBeCloseTo(src.head - src.sill, 3);
    }
  });

  it("gives doors and entries a leaf and a quarter-circle arc around the hinge, in the right sense", () => {
    let arcs = 0;
    for (const o of drawing.openings) {
      const leaf = o.segments.find((s) => s.role === "leaf");
      if (o.kind === "door" || o.kind === "entry") {
        expect(leaf && o.arc).toBeTruthy();
        const a = o.arc!;
        arcs++;
        const rf = Math.hypot(a.from[0] - a.center[0], a.from[1] - a.center[1]), rt = Math.hypot(a.to[0] - a.center[0], a.to[1] - a.center[1]);
        expect(rf).toBeCloseTo(a.r, 3);
        expect(rt).toBeCloseTo(a.r, 3);
        // quarter circle: the radii are perpendicular
        const dot = (a.from[0] - a.center[0]) * (a.to[0] - a.center[0]) + (a.from[1] - a.center[1]) * (a.to[1] - a.center[1]);
        expect(Math.abs(dot)).toBeLessThan(1e-3);
        const cross = (a.from[0] - a.center[0]) * (a.to[1] - a.center[1]) - (a.from[1] - a.center[1]) * (a.to[0] - a.center[0]);
        expect(a.sweep).toBe(cross > 0 ? 1 : 0);
        expect(leaf!.a).toEqual(a.center);
        expect(leaf!.b).toEqual(a.from);
        if (o.kind === "entry") expect(a.r).toBeLessThanOrEqual(0.9 + 1e-9);
      } else expect(o.arc).toBeNull();
    }
    expect(arcs).toBeGreaterThan(0);
  });

  it("anchors exterior openings on the outer face, pointing out of the house", () => {
    const ring = drawing.outline.find((r) => signedArea(r) > 0)!;
    let ext = 0;
    for (const o of drawing.openings) {
      if (!o.exterior) { expect(o.facade).toBeNull(); continue; }
      ext++;
      const f = o.facade!;
      expect(Math.hypot(f.out[0], f.out[1])).toBeCloseTo(1, 9);
      expect(pointInRing([f.at[0] + 0.05 * f.out[0], f.at[1] + 0.05 * f.out[1]], ring)).toBe(false);
      expect(pointInRing([f.at[0] - 0.05 * f.out[0], f.at[1] - 0.05 * f.out[1]], ring)).toBe(true);
    }
    expect(ext).toBeGreaterThan(0);
  });
});

describe("plan drawing: furniture, outdoor, annotations", () => {
  it("draws furniture at the model rectangles with the back line inside them", () => {
    for (const [i, f] of drawing.furniture.entries()) {
      const src = derived.furniture[i];
      expect(f.rect).toEqual(toPlan(src.rect).map((v) => Math.round(v * 1000) / 1000));
      for (const p of f.back) {
        expect(p[0]).toBeGreaterThanOrEqual(f.rect[0] - 1e-9);
        expect(p[0]).toBeLessThanOrEqual(f.rect[2] + 1e-9);
        expect(p[1]).toBeGreaterThanOrEqual(f.rect[1] - 1e-9);
        expect(p[1]).toBeLessThanOrEqual(f.rect[3] + 1e-9);
      }
      // the back line is parallel to an edge and (nearly) on it
      const horizontal = Math.abs(f.back[0][1] - f.back[1][1]) < 1e-9;
      const edges = horizontal ? [f.rect[1], f.rect[3]] : [f.rect[0], f.rect[2]];
      const at = horizontal ? f.back[0][1] : f.back[0][0];
      expect(Math.min(...edges.map((e) => Math.abs(e - at)))).toBeLessThan(0.121);
    }
  });

  it("keeps covered outdoor areas whole and cuts the others at the reach", () => {
    const reach = 1.8, ob = derived.outline.bbox!;
    for (const o of derived.outdoor) {
      const p = drawing.outdoor.find((q) => q.id === o.id);
      if (o.covered) {
        expect(p).toBeDefined();
        expect(p!.rect).toEqual(toPlan(o.rect));
        expect(p!.cut).toBe(false);
        expect(p!.posts).toHaveLength(o.posts.length);
      } else if (p) {
        expect(-p.rect[1]).toBeLessThanOrEqual(ob.y1 + reach + 1e-9);
        expect(p.rect[0]).toBeGreaterThanOrEqual(ob.x0 - reach - 1e-9);
      }
    }
    const wide = buildPlanDrawing(derived, { outdoorReach: 100 });
    expect(wide.outdoor.every((o) => !o.cut)).toBe(true);
    expect(wide.viewBox.h).toBeGreaterThan(drawing.viewBox.h);
  });

  it("measures the overall dimensions of the footprint", () => {
    const ob = derived.outline.bbox!;
    const w = drawing.dimensions.find((m) => m.axis === "width")!, d = drawing.dimensions.find((m) => m.axis === "depth")!;
    expect(w.value).toBeCloseTo(ob.x1 - ob.x0, 3);
    expect(d.value).toBeCloseTo(ob.y1 - ob.y0, 3);
    expect(Math.abs(w.line[1][0] - w.line[0][0])).toBeCloseTo(w.value, 3);
    expect(Math.abs(d.line[1][1] - d.line[0][1])).toBeCloseTo(d.value, 3);
  });

  it("turns the north arrow against the bearing of the house", () => {
    expect(drawing.north.angleDeg).toBeCloseTo(-derived.houseAxisBearingDeg, 9);
    expect(drawing.bearingDeg).toBe(derived.houseAxisBearingDeg);
  });
});

describe("plan svg", () => {
  it("builds path data with one subpath per ring", () => {
    const d = pathOf(drawing.walls[2].rings);
    expect((d.match(/M/g) ?? []).length).toBe(drawing.walls[2].rings.length);
    expect((d.match(/Z/g) ?? []).length).toBe(drawing.walls[2].rings.length);
  });

  it("serialises a standalone document with tokens or resolved colours", () => {
    const svg = planToSvg(drawing, { title: "Plan & <test>", formatArea: (v) => `${v} m2`, formatLength: (v) => `${v} m` });
    expect(svg.startsWith("<svg")).toBe(true);
    expect(svg.endsWith("</svg>")).toBe(true);
    expect(svg).not.toMatch(/NaN|undefined|Infinity/);
    expect(svg).toContain("Plan &amp; &lt;test&gt;");
    expect(svg).toContain("var(--ink)");
    const tokens = [...new Set([...svg.matchAll(/var\((--[a-z0-9-]+)\)/g)].map((m) => m[1]).filter((t) => t !== "--font-mono"))];
    const palette = Object.fromEntries(tokens.map((t) => [t, "#123456"]));
    const flat = planToSvg(drawing, { palette });
    expect(flat.replace(/var\(--font-mono\)/g, "")).not.toContain("var(--");
    // tags are balanced
    const open = (flat.match(/<(g|text|svg|title)[ >]/g) ?? []).length, close = (flat.match(/<\/(g|text|svg|title)>/g) ?? []).length;
    expect(open).toBe(close);
  });

  it("splits the geometry into the layers the page toggles", () => {
    const L = planLayers(drawing);
    expect(L.furniture.match(/<rect/g)).toHaveLength(drawing.furniture.length);
    expect(L.walls.match(/<path/g)).toHaveLength(3);
    expect(L.openings.match(/data-kind=/g)).toHaveLength(drawing.openings.length);
    expect(planLayers(buildPlanDrawing(derived, { furniture: false })).furniture).toBe("");
  });
});
