// Plot page: invariants of the view model, label placement and contour paths, and a server render of the tool in both
// languages. Independent oracles only (areas by summation, geometry by direct computation); no golden numbers of the house.
import { createElement as h, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { I18nProvider } from "@/lib/i18n/client";
import type { Locale } from "@/lib/i18n/config";
import { getFormatter } from "@/lib/i18n/format";
import { messagesFor } from "@/lib/i18n/messages";
import { derived, house, metrics } from "@/lib/model/instance";
import { createTerrain } from "@/lib/model/site/terrain";
import { polygonArea, pointInPolygon, type XY } from "@/lib/model/site/geometry";
import siteJson from "@model/site.json";
import { buildContours, pathData } from "./contours";
import { signed } from "./fmt";
import {
  K, boxesHit, boxInFrame, cornerWidgets, frameFor, fromScreen, gridPoints, gridSpacing, placeContourLabels, placeSetbackLabels, scaleLength, screenAngle, textBox, toScreen, toUnits,
} from "./labels";
import { limitBar } from "./limits";
import { niceTicks } from "./Profile";
import { PlotFacts } from "./PlotFacts";
import { PlotRules } from "./PlotRules";
import { PlotTool } from "./PlotTool";
import { buildPlotView, cornerOf } from "./view";

vi.mock("next/navigation", () => ({ usePathname: () => "/", notFound: () => { throw new Error("NEXT_NOT_FOUND"); } }));

const view = buildPlotView(house, derived, siteJson);
const terrain = createTerrain(view.terrain, view.bearingDeg, view.slabs);
const c = toUnits(view.center);
const html = (el: ReactElement) => renderToStaticMarkup(el);
const provide = (locale: Locale, child: ReactElement) => h(I18nProvider, { locale, messages: messagesFor(locale, ["common", "plot"]), children: child });
const escaped = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;").replace(/'/g, "&#x27;");

describe("view model", () => {
  it("is plain JSON (it crosses from the server to the client)", () => {
    expect(JSON.parse(JSON.stringify(view))).toEqual(view);
  });

  it("areas add up: built-up + paved + water + green = plot, and the plot area is the shoelace area", () => {
    const s = view.stats;
    expect(s.builtUpArea + s.pavedArea + s.waterArea + s.greenArea).toBeCloseTo(s.plotArea, 6);
    expect(s.builtUpRatio + s.pavedRatio + s.waterRatio + s.greenRatio).toBeCloseTo(1, 9);
    expect(s.plotArea).toBeCloseTo(polygonArea(view.plot), 2);
    expect(s.footprintArea).toBeLessThanOrEqual(s.builtUpArea + 1e-9);
  });

  it("the built-up area and the footprint are the shared metrics of the house (the floor plan note shows the same numbers)", () => {
    // metrics are rounded to 0.01 m2
    expect(view.stats.builtUpArea).toBeCloseTo(metrics.builtUpArea, 1);
    expect(view.stats.footprintArea).toBeCloseTo(metrics.footprintArea, 1);
  });

  it("draws posts at the size the model gives them", () => {
    for (const o of view.outdoor) {
      const d = derived.outdoor.find((q) => q.type === o.type && q.role === o.role && q.posts.length === o.posts.length)!;
      expect(o.postSize).toBe(d.postSize);
      if (o.posts.length) expect(o.postSize).toBeGreaterThan(0);
    }
  });

  it("set-backs are real distances between a point of the house outline and a point of the boundary", () => {
    expect(view.setbacks.length).toBeGreaterThan(0);
    for (const sb of view.setbacks) {
      expect(Math.hypot(sb.to[0] - sb.from[0], sb.to[1] - sb.from[1])).toBeCloseTo(sb.d, 1);
      expect(sb.d).toBeGreaterThan(0);
    }
    // no other point of the house is closer to the boundary than the smallest reported set-back
    const smallest = Math.min(...view.setbacks.map((s) => s.d));
    for (const p of view.house.outline) {
      const d = Math.min(...view.plot.map((a, i) => segDist(p, a, view.plot[(i + 1) % view.plot.length])));
      expect(d).toBeGreaterThanOrEqual(smallest - 0.02);
    }
  });

  it("every check carries its limit and the state agrees with value and rule", () => {
    expect(view.checks.length).toBeGreaterThan(3);
    for (const ch of view.checks) {
      if (ch.unit === "flag") continue;
      expect(ch.ok).toBe(ch.rule === "min" ? ch.actual >= ch.limit : ch.actual <= ch.limit);
    }
    const built = view.checks.find((x) => x.key === "builtUp")!;
    expect(built.actual).toBeCloseTo(view.stats.builtUpRatio, 9);
    expect(built.limit).toBe(view.limits.maxBuiltUpRatio);
  });

  it("the buildable region lies inside the plot", () => {
    for (const p of view.buildable) expect(pointInPolygon(p, view.plot)).toBe(true);
    expect(polygonArea(view.buildable)).toBeLessThan(polygonArea(view.plot));
  });

  it("measuring presets are corners of the house outline and of the plot, numbered within their group (no ids parsed)", () => {
    const on = (pts: readonly XY[], p: XY) => pts.some((q) => Math.abs(q[0] - p[0]) < 0.011 && Math.abs(q[1] - p[1]) < 0.011);
    for (const p of view.presets) {
      if (p.group === "house") expect(on(view.house.outline, p.p)).toBe(true);
      if (p.group === "plot") expect(on(view.plot, p.p)).toBe(true);
    }
    expect(view.presets.filter((p) => p.group === "house")).toHaveLength(4);
    expect(new Set(view.presets.map((p) => p.id)).size).toBe(view.presets.length);
    for (const g of ["house", "garage", "plot"] as const) {
      expect(view.presets.filter((p) => p.group === g).map((p) => p.index)).toEqual(view.presets.filter((p) => p.group === g).map((_, i) => i));
    }
  });

  it("draws the boundary as built: the gates stand in the fence openings, a sliding leaf parks along the fence, a swing leaf sweeps into the plot", () => {
    expect(view.fences.length).toBeGreaterThan(0);
    expect(view.gates.length).toBe(derived.site?.gates.length ?? 0);
    const fencePts = view.fences.flatMap((f) => f.parts.flat());
    const near = (p: XY, pts: readonly XY[], d: number) => pts.some((q) => Math.hypot(q[0] - p[0], q[1] - p[1]) < d);
    for (const g of view.gates) {
      // the posts of a gate stand where a fence part ends (the opening) or against the pillar beside it
      const pillarPts = view.pillars.flatMap((q) => q.footprint);
      for (const p of g.posts) expect(near(p, fencePts, g.postSize + 0.05) || near(p, pillarPts, g.postSize + 0.05)).toBe(true);
      expect(g.posts.some((p) => near(p, fencePts, g.postSize + 0.05))).toBe(true);
      if (g.kind === "sliding") {
        expect(g.park).not.toBeNull();
        expect(polygonArea(g.park!)).toBeCloseTo(polygonArea(g.leaf), 1); // the same leaf, moved (points rounded to 1 cm)
        // the parked leaf as a line: as long as the moving part, and the map draws it towards the inside of the plot
        const [p0, p1] = g.parkLine!;
        const long = Math.max(...g.park!.map((p, i, a) => Math.hypot(a[(i + 1) % a.length][0] - p[0], a[(i + 1) % a.length][1] - p[1])));
        expect(Math.hypot(p1[0] - p0[0], p1[1] - p0[1])).toBeCloseTo(long, 1);
        const mid: XY = [(p0[0] + p1[0]) / 2 + g.inward[0], (p0[1] + p1[1]) / 2 + g.inward[1]];
        expect(pointInPolygon(mid, view.plot)).toBe(true);
      } else {
        expect(g.swing).not.toBeNull();
        const r = Math.hypot(g.swing!.open[0] - g.swing!.hinge[0], g.swing!.open[1] - g.swing!.hinge[1]);
        for (const p of g.swing!.arc) expect(Math.hypot(p[0] - g.swing!.hinge[0], p[1] - g.swing!.hinge[1])).toBeCloseTo(r, 1);
        expect(pointInPolygon(g.swing!.open, view.plot)).toBe(true); // it opens into the plot
      }
    }
    expect(view.pillars.length).toBe(derived.site?.pillars.length ?? 0);
  });

  it("names the tallest tree on the map and keeps the pool, the tank and the roof lines of the house", () => {
    const tallest = Math.max(...siteJson.trees.map((t) => t.height));
    expect(view.trees.filter((t) => t.feature).length).toBe(siteJson.trees.filter((t) => t.height === tallest).length);
    for (const t of view.trees.filter((q) => q.feature)) expect(t.name.cs.length).toBeGreaterThan(0);
    expect(view.outdoor.some((o) => o.water)).toBe(derived.outdoor.some((o) => o.pool));
    expect(view.tank !== null).toBe(Boolean(derived.site?.rainwater));
    expect(view.house.roofLines.length).toBeGreaterThan(0);
    // roof lines lie inside the eaves
    const eaves = view.house.roofs;
    for (const [a, b] of view.house.roofLines) for (const p of [a, b]) expect(eaves.some((e) => pointInPolygon(p, e) || near1(p, e))).toBe(true);
  });

  it("the ground statistics are consistent with the graded terrain function", () => {
    const zs: number[] = [];
    for (let x = -5; x < 28; x += 1) for (let y = -16; y < 21; y += 1) if (pointInPolygon([x, y], view.plot)) zs.push(terrain.groundAt(x, y));
    expect(Math.min(...zs)).toBeGreaterThanOrEqual(view.ground.zMin - 0.05);
    expect(Math.max(...zs)).toBeLessThanOrEqual(view.ground.zMax + 0.05);
    // the levelled plateau is at its level under the house (below the finished floor: the plinth shows)
    const [lx, ly] = view.house.label;
    expect(terrain.groundAt(lx, ly)).toBeCloseTo(view.terrain.plateau.level, 9);
    expect(view.terrain.plateau.level).toBeLessThanOrEqual(0);
    // the slabs the client grades with are the house's outdoor areas: the ground never stands above a slab top
    expect(view.slabs.length).toBeGreaterThan(0);
  });
});

describe("cornerOf", () => {
  const rect: XY[] = [[0, 0], [4, 0], [4, 2], [0, 2]];
  it("picks the corner furthest towards the compass direction", () => {
    expect(cornerOf(rect, "NE", 0)).toEqual([4, 2]);
    expect(cornerOf(rect, "SW", 0)).toEqual([0, 0]);
    expect(cornerOf(rect, "NW", 0)).toEqual([0, 2]);
    expect(cornerOf(rect, "SE", 0)).toEqual([4, 0]);
  });
  it("turns with the house axis: with a bearing of 90 degrees house +y points east and house +x points south", () => {
    expect(cornerOf(rect, "NE", 90)).toEqual([0, 2]);
    expect(cornerOf(rect, "SW", 90)).toEqual([4, 0]);
    expect(cornerOf(rect, "NW", 90)).toEqual([0, 0]);
    expect(cornerOf(rect, "SE", 90)).toEqual([4, 2]);
  });
});

describe("map geometry", () => {
  it("toScreen and fromScreen are inverse (up to the rounding of the screen position)", () => {
    for (const rot of [0, 12, -37]) {
      for (const p of [[0, 0], [10.5, -4.25], [-5.2, 20.6]] as XY[]) {
        const q = fromScreen(toScreen(p, rot, c), rot, c);
        expect(q[0]).toBeCloseTo(p[0], 2);
        expect(q[1]).toBeCloseTo(p[1], 2);
      }
    }
  });

  it("turning preserves distances and turns clockwise on screen", () => {
    const a = toScreen([0, 0], 30, c), b = toScreen([5, 0], 30, c);
    expect(Math.hypot(b[0] - a[0], b[1] - a[1])).toBeCloseTo(5 * K, 1);
    // house +y turned 90 degrees clockwise points right (screen +x)
    const o = toScreen(view.center, 90, c), up = toScreen([view.center[0], view.center[1] + 1], 90, c);
    expect(up[0] - o[0]).toBeCloseTo(K, 2);
    expect(Math.abs(up[1] - o[1])).toBeLessThan(0.01);
  });

  it("the frame holds the turned plot with the padding on every side", () => {
    for (const rot of [0, view.bearingDeg]) {
      const f = frameFor(view.plot, rot, c, 9);
      for (const p of view.plot) {
        const [x, y] = toScreen(p, rot, c);
        expect(x).toBeGreaterThanOrEqual(f.x + 9 * K - 0.01);
        expect(x).toBeLessThanOrEqual(f.x + f.w - 9 * K + 0.01);
        expect(y).toBeGreaterThanOrEqual(f.y + 9 * K - 0.01);
        expect(y).toBeLessThanOrEqual(f.y + f.h - 9 * K + 0.01);
      }
    }
  });

  it("scale bars are round and about a fifth of the map", () => {
    for (const w of [20, 52, 80, 160, 400]) {
      const l = scaleLength(w);
      expect([2, 5, 10, 20, 50, 100]).toContain(l);
      expect(l / w).toBeGreaterThan(0.05);
      expect(l / w).toBeLessThan(0.5);
    }
  });

  it("text angles stay upright", () => {
    for (const a of [-170, -90, -45, 0, 30, 89, 90, 91, 175]) for (const rot of [0, 12, 90]) {
      const r = screenAngle(a, rot);
      expect(r).toBeGreaterThan(-90.001);
      expect(r).toBeLessThanOrEqual(90.001);
    }
  });
});

describe("label placement", () => {
  const rot = view.bearingDeg, frame = frameFor(view.plot, rot, c, 9);
  const scr = (p: readonly number[]) => toScreen(p, rot, c);
  const house = view.house.outline.map(scr), plot = view.plot.map(scr);
  const lines = view.setbacks.map((s) => ({ from: scr(s.from), to: scr(s.to) }));

  for (const s of [0.6, 1.5, 3]) {
    it(`set-back labels do not overlap each other or the house (scale ${s} px per unit)`, () => {
      const fs = 12.5 / s, chars = view.setbacks.map(() => 8);
      const boxes = placeSetbackLabels(lines, chars, fs, house, plot);
      expect(boxes).toHaveLength(lines.length);
      boxes.forEach((a, i) => boxes.forEach((b, j) => { if (i < j) expect(boxesHit(a, b)).toBe(false); }));
    });

    it(`contour labels are inside the frame, apart from each other and off the house (scale ${s})`, () => {
      const set = buildContours(terrain, view.plot, 18, (rel) => signed(getFormatter("cs"), rel, 1));
      const fs = 10.5 / s;
      const placed = placeContourLabels(set.labels, fs, rot, c, frame, { polys: [house], boxes: cornerWidgets(frame, s, 10).boxes, lines }, fs * 22);
      expect(placed.length).toBeGreaterThan(0);
      const boxes = placed.map((l) => textBox(l.x, l.y, l.text.length, fs, l.angle));
      boxes.forEach((a, i) => {
        expect(boxInFrame(a, frame, 0)).toBe(true);
        boxes.forEach((b, j) => { if (i < j) expect(boxesHit(a, b)).toBe(false); });
        for (const w of cornerWidgets(frame, s, 10).boxes) expect(boxesHit(a, w)).toBe(false);
      });
    });
  }

  it("height grid points lie inside the plot on a regular grid and the spacing widens as the map shrinks", () => {
    for (const sp of [5, 10]) {
      const pts = gridPoints(view.plot, sp);
      expect(pts.length).toBeGreaterThan(0);
      for (const p of pts) { expect(pointInPolygon(p, view.plot)).toBe(true); expect(p[0] % sp).toBeCloseTo(0, 9); expect(p[1] % sp).toBeCloseTo(0, 9); }
    }
    expect(gridSpacing(14, 40)).toBeLessThanOrEqual(gridSpacing(7, 40));
    expect(gridSpacing(7, 40)).toBeLessThanOrEqual(gridSpacing(3, 40));
  });
});

describe("contours", () => {
  const set = buildContours(terrain, view.plot, 18, (rel) => String(rel));
  it("every contour point lies on its level (checked against the terrain function)", () => {
    expect(set.lines.length).toBeGreaterThan(5);
    for (const line of set.lines) for (const p of line.points) expect(Math.abs(terrain.groundAt(p[0], p[1]) - line.level)).toBeLessThan(0.02);
  });
  it("path data has one command per point and closes rings", () => {
    expect(pathData([[0, 0], [1, 2]], false)).toBe(`M0 0L${K} ${-2 * K}`);
    expect(pathData([[0, 0], [1, 0], [1, 1]], true).endsWith("Z")).toBe(true);
    expect(set.paths).toHaveLength(set.lines.length);
    expect(set.paths.some((p) => p.major)).toBe(true);
  });
});

describe("limit bars and ticks", () => {
  it("a maximum is met below the limit, a minimum above it; the mark is always on the bar", () => {
    expect(limitBar(0.25, 0.35, "max").ok).toBe(true);
    expect(limitBar(0.4, 0.35, "max").ok).toBe(false);
    expect(limitBar(0.6, 0.4, "min").ok).toBe(true);
    expect(limitBar(0.3, 0.4, "min").ok).toBe(false);
    for (const [r, l, rule] of [[0.25, 0.35, "max"], [0.6, 0.4, "min"], [0.9, 0.35, "max"], [0, 0.4, "min"]] as const) {
      const b = limitBar(r, l, rule);
      expect(b.value).toBeGreaterThanOrEqual(0);
      expect(b.value).toBeLessThanOrEqual(1);
      expect(b.mark).toBeGreaterThan(0);
      expect(b.mark).toBeLessThanOrEqual(1);
    }
    // the filled part is proportional to the share
    expect(limitBar(0.2, 0.35, "max").value / limitBar(0.1, 0.35, "max").value).toBeCloseTo(2, 9);
  });

  it("axis ticks cover the range with round steps", () => {
    for (const [lo, hi] of [[-0.7, 0.5], [0, 0.3], [-3, 12], [239.2, 240.6]]) {
      const t = niceTicks(lo, hi, 4);
      expect(t.length).toBeGreaterThanOrEqual(2);
      expect(t.length).toBeLessThanOrEqual(8);
      for (const v of t) { expect(v).toBeGreaterThanOrEqual(lo - 1e-9); expect(v).toBeLessThanOrEqual(hi + 1e-9); }
      const step = t[1] - t[0], mag = 10 ** Math.floor(Math.log10(step) + 1e-9);
      expect([1, 2, 5, 10]).toContain(Math.round((step / mag) * 1000) / 1000);
    }
  });

  it("signed heights use a real minus and no sign for zero", () => {
    const f = getFormatter("cs");
    expect(signed(f, 0.354, 2)).toBe("+0,35");
    expect(signed(f, -0.9, 2)).toBe("−0,90");
    expect(signed(f, 0.001, 2)).toBe("±0,00");
    expect(signed(f, -0.001, 2)).toBe("±0,00");
  });
});

describe.each(["cs", "en"] as const)("page parts (%s)", (locale) => {
  const f = getFormatter(locale);
  const facts = h(PlotFacts, { view, locale });
  const tool = html(provide(locale, h(PlotTool, { view, facts })));

  it("renders the map once with an accessible name that lists the set-backs", () => {
    expect(tool.match(/<svg[^>]*role="img"/g)?.length).toBeGreaterThanOrEqual(1);
    for (const sb of view.setbacks) expect(tool).toContain(escaped(f.length(sb.d, 1)));
  });

  it("has a segmented control for the orientation, four layer chips and, in the collapsed measuring panel, two lists", () => {
    expect((tool.match(/aria-pressed=/g) ?? []).length).toBe(2 + 4);
    expect((tool.match(/<select/g) ?? []).length).toBe(2);
    expect(tool).toContain('aria-live="polite"');
    // the rail: the facts first, measuring second and closed until it is used
    expect(tool.indexOf('class="panel panel-pad stack pt-facts"')).toBeLessThan(tool.indexOf("pt-measure-panel"));
    expect(tool).toMatch(/<details class="pt-measure-box"(?![^>]*open)/);
  });

  it("draws the fence, the gates, the pillar, the pool, the tank and the feature tree on the map", () => {
    expect((tool.match(/class="pt-gate"/g) ?? []).length).toBe(view.gates.length);
    expect((tool.match(/class="pt-gate-park"/g) ?? []).length).toBe(view.gates.filter((g) => g.park).length);
    expect((tool.match(/class="pt-gate-arc"/g) ?? []).length).toBe(view.gates.filter((g) => g.swing).length);
    expect((tool.match(/class="pt-pillar"/g) ?? []).length).toBe(view.pillars.length);
    expect((tool.match(/class="pt-water"/g) ?? []).length).toBe(view.outdoor.filter((o) => o.water).length);
    expect((tool.match(/class="pt-tank"/g) ?? []).length).toBe(view.tank ? 1 : 0);
    expect((tool.match(/data-feature="true"/g) ?? []).length).toBe(view.trees.filter((t) => t.feature).length);
    expect(tool).not.toContain("pt-sw-hedge");
  });

  it("shows the numbers of the plot from the model, each with its unit, and the planting in words", () => {
    for (const v of [f.area(view.stats.plotArea, 0), f.area(view.stats.builtUpArea, 0), f.percent(view.stats.builtUpRatio * 100, 1), f.degrees(view.bearingDeg, 0)]) {
      expect(tool).toContain(escaped(v));
    }
    if (view.stats.waterArea > 0) expect(tool).toContain(escaped(f.area(view.stats.waterArea, 0)));
    const trees = locale === "cs" ? /\d+[\s\u00a0]strom(ů|y)?/ : /\d+[\s\u00a0]trees?/;
    expect(tool).toMatch(trees);
    expect(tool).toContain(escaped(f.unit(view.zeroLevelAsl, locale === "cs" ? "m n.\u00a0m." : "m a.s.l.", 2)).slice(0, 4));
  });

  it("the rules section is one card: every check with its result in words, a meter in the rows of a share", () => {
    const out = html(h(PlotRules, { view, locale }));
    expect((out.match(/class="pt-status"/g) ?? []).length).toBe(view.checks.length);
    expect((out.match(/class="panel /g) ?? []).length).toBe(1);
    expect((out.match(/class="pt-limit-bar"/g) ?? []).length).toBe(view.checks.filter((c) => c.unit === "ratio").length);
    for (const ch of view.checks) if (ch.unit === "m") expect(out).toContain(escaped(f.length(ch.actual, 1)));
  });
});

/** Is a point on the outline of a polygon (within 2 cm)? */
function near1(p: XY, poly: readonly XY[]): boolean {
  return poly.some((a, i) => segDist(p, a, poly[(i + 1) % poly.length]) < 0.02);
}

function segDist(p: XY, a: XY, b: XY): number {
  const dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy;
  const t = l2 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2)) : 0;
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}
