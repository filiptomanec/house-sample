// Fences with their openings and posts, gates (sliding and swing), pillars, the street with its pavement and dropped kerbs,
// and the gate checks (E-BRANA). The plot of site.json with a one-system boundary built here from the fixture house, so the
// mutations do not depend on the content of site.json (the real boundary is checked in site.test.ts).
import { describe, expect, it } from "vitest";
import siteRaw from "@model/site.json";
import {
  dist, distToBoundary, distToPolygon, pointInPolygon, polygonArea, polylineLength, projectToPolyline, type XY,
} from "../geometry";
import { DEFAULT_KERB_WIDTH, accessGeometry, offsetEdgeLine, plotPolygon, resolveBoundary, resolveFences, streetGeometry, yOnLine } from "../layout";
import { parseSite, type SiteModel } from "../siteSchema";
import { validateSite, validateSiteWithHouse } from "../validate";
import { FIXTURE_BEARING_DEG, FIXTURE_HOUSE } from "./fixture";

const OUTDOOR = FIXTURE_HOUSE.outdoor;
const strip = (type: string) => OUTDOOR.find((o) => o.type === type && o.rect)!.rect!;
const driveW = strip("drive")[2] - strip("drive")[0];
const walkW = strip("path")[2] - strip("path")[0];

/** site.json with the boundary of the redesign: one slat fence once around the plot, a sliding and a swing gate, a pillar. */
function redesigned(edit?: (raw: Record<string, unknown>) => void): SiteModel {
  const raw = JSON.parse(JSON.stringify(siteRaw)) as Record<string, unknown>;
  const n = (raw.plot as { polygon: unknown[] }).polygon.length;
  raw.hedges = [];
  raw.fences = [{
    id: "FN01", kind: "slat_fence", from: { edge: 0, t: 0 }, to: { edge: n - 1, t: 1 }, inset: 0.1, height: 1.6, thickness: 0.06, gates: true,
    plinthHeight: 0.3, slat: { orient: "h", board: 0.09, gap: 0.015, depth: 0.02 }, postSize: 0.06, postSpacing: 2.5,
  }];
  raw.gates = [
    { id: "GT01", access: "driveway", kind: "sliding", leaf: driveW + 0.5, height: 1.6, postSize: 0.1, side: "-", tail: 2.0 },
    { id: "GT02", access: "walkway", kind: "swing", leaf: walkW, height: 1.6, postSize: 0.1, side: "+" },
  ];
  raw.pillars = [{ id: "PL01", access: "walkway", side: "-", size: [0.8, 0.45, 1.8], items: ["meter-box", "mailbox", "intercom", "house-number", "light"] }];
  raw.street = { ...(raw.street as object), pavement: 1.5 };
  edit?.(raw);
  return parseSite(raw);
}

const site = redesigned();
const plot = plotPolygon(site);
const access = accessGeometry(site, OUTDOOR);
const layout = resolveBoundary(site, access);

describe("schema", () => {
  it("accepts the redesigned boundary and rejects an incomplete slat fence", () => {
    expect(validateSite(site)).toEqual({ errors: [], warnings: [] });
    const raw = JSON.parse(JSON.stringify(siteRaw));
    raw.fences = [{ id: "F", kind: "slat_fence", from: { edge: 0, t: 0 }, to: { edge: 0, t: 1 }, inset: 0.1, height: 1.6, thickness: 0.06, gates: false }];
    expect(() => parseSite(raw)).toThrow();
  });
  it("the site checks with the house pass", () => {
    expect(validateSiteWithHouse(site, OUTDOOR, FIXTURE_BEARING_DEG)).toEqual({ errors: [], warnings: [] });
  });
});

describe("fences", () => {
  const fence = layout.fences[0];
  it("one fence runs once around the plot; it is closed except the openings for gates and pillars", () => {
    expect(dist(fence.path[0], fence.path[fence.path.length - 1])).toBeLessThan(1e-9);
    const total = polylineLength(fence.path);
    const kept = fence.parts.reduce((s, p) => s + polylineLength(p), 0);
    const gaps = fence.gaps.reduce((s, g) => s + (g.to - g.from), 0);
    expect(kept + gaps).toBeCloseTo(total, 6);
    expect(fence.gaps.map((g) => g.kind).sort()).toEqual(["gate", "gate", "pillar"]);
    // the pieces before and after the start point form one piece: parts = openings in a closed ring
    expect(fence.parts).toHaveLength(2);
    for (const p of fence.parts) for (const q of p) expect(distToBoundary(q, plot)).toBeCloseTo(0.1, 6);
  });
  it("each opening with a gate is the leaf plus two posts, and it is centred on its access", () => {
    for (const g of layout.gates) {
      const gap = fence.gaps.find((x) => x.ref === g.id)!;
      expect(gap.to - gap.from).toBeCloseTo(g.leaf + 2 * g.postSize, 9);
      expect(g.width).toBeCloseTo(g.leaf + 2 * g.postSize, 9);
      const centre = g.access === "driveway" ? access.driveGate.center : access.walkGate.center;
      expect(projectToPolyline(centre, fence.path).s).toBeCloseTo((gap.from + gap.to) / 2, 6);
    }
  });
  it("posts stand at most postSpacing apart along every part; parts ending at a gate or pillar have no end post", () => {
    expect(fence.posts.length).toBeGreaterThan(10);
    for (const part of fence.parts) {
      const mine = fence.posts.filter((p) => projectToPolyline(p, part).d < 1e-6).map((p) => projectToPolyline(p, part).s).sort((a, b) => a - b);
      const len = polylineLength(part);
      // the gate post or pillar at a bare end carries the panel: the first and last spans are measured from the part ends
      const stops = [0, ...mine, len];
      for (let i = 1; i < stops.length; i++) expect(stops[i] - stops[i - 1]).toBeLessThanOrEqual((fence.postSpacing as number) + 1e-6);
      // no post exactly at an end that touches an opening
      for (const end of [part[0], part[part.length - 1]]) {
        const atGap = fence.gaps.some((g) => Math.abs(projectToPolyline(end, fence.path).s - g.from) < 1e-6 || Math.abs(projectToPolyline(end, fence.path).s - g.to) < 1e-6);
        if (atGap) expect(fence.posts.some((p) => dist(p, end) < 1e-6)).toBe(false);
      }
    }
    // corners of the plot carry a post
    for (const v of fence.path.slice(1, -1)) expect(fence.posts.some((p) => dist(p, v) < 1e-6)).toBe(true);
  });
  it("resolveFences gives the same fences as resolveBoundary", () => {
    expect(resolveFences(site, access)).toEqual(layout.fences);
  });
});

describe("gates", () => {
  const sliding = layout.gates.find((g) => g.kind === "sliding")!;
  const swing = layout.gates.find((g) => g.kind === "swing")!;
  it("posts flank the leaf on the fence line; the inward normal points into the plot", () => {
    for (const g of layout.gates) {
      expect(dist(g.posts[0], g.posts[1])).toBeCloseTo(g.leaf + g.postSize, 9);
      expect(pointInPolygon([g.center[0] + g.inward[0], g.center[1] + g.inward[1]], plot)).toBe(true);
      expect(Math.hypot(...g.along)).toBeCloseTo(1, 9);
      expect(g.along[0] * g.inward[0] + g.along[1] * g.inward[1]).toBeCloseTo(0, 9);
      expect(polygonArea(g.leafPolygon)).toBeGreaterThan(0);
    }
  });
  it("a sliding leaf parks on the side given relative to the edge direction, behind the fence, leaf + tail long", () => {
    const p = sliding.park!;
    expect(dist(p.from, p.to)).toBeCloseTo(sliding.leaf + sliding.tail, 9);
    // side "-" = towards the start of the street edge
    const e = site.street.edge;
    const start = plot[e], end = plot[(e + 1) % plot.length];
    const sideOf = (q: XY) => Math.sign((q[0] - sliding.center[0]) * (end[0] - start[0]) + (q[1] - sliding.center[1]) * (end[1] - start[1]));
    expect(sideOf(p.to)).toBe(-1);
    for (const q of p.polygon) expect(pointInPolygon(q, plot)).toBe(true);
    expect(p.offset).toBeGreaterThan(0);
    // closed: the leaf covers the opening (from post to post)
    for (const post of sliding.posts) expect(distToPolygon(post, sliding.leafPolygon)).toBeLessThan(sliding.postSize);
    const flipped = resolveBoundary(redesigned((raw) => ((raw.gates as { side: string }[])[0].side = "+")), access).gates[0];
    expect(Math.sign((flipped.park!.to[0] - flipped.center[0]) * (end[0] - start[0]) + (flipped.park!.to[1] - flipped.center[1]) * (end[1] - start[1]))).toBe(1);
  });
  it("a swing leaf hinges on its side and opens into the plot by a quarter turn", () => {
    const s = swing.swing!;
    expect(dist(s.hinge, s.closedEnd)).toBeCloseTo(swing.leaf, 9);
    expect(dist(s.hinge, s.openEnd)).toBeCloseTo(swing.leaf, 9);
    for (const q of s.arc) {
      expect(dist(q, s.hinge)).toBeCloseTo(swing.leaf, 9);
      expect(pointInPolygon(q, plot) || distToBoundary(q, plot) < 0.2).toBe(true);
    }
    expect(dist(s.arc[0], s.closedEnd)).toBeLessThan(1e-9);
    expect(dist(s.arc[s.arc.length - 1], s.openEnd)).toBeLessThan(1e-9);
    expect(pointInPolygon(s.openEnd, plot)).toBe(true);
  });
  it("the pillar stands beside the gate, inside the plot, its street face flush with the fence", () => {
    const pl = layout.pillars[0];
    for (const q of pl.footprint) expect(pointInPolygon(q, plot)).toBe(true);
    const gap = layout.fences[0].gaps.find((g) => g.ref === pl.id)!;
    expect(gap.to - gap.from).toBeCloseTo(pl.size[0], 9);
    expect(pl.items).toContain("mailbox");
    for (const post of layout.gates.find((g) => g.access === pl.access)!.posts) expect(distToPolygon(post, pl.footprint)).toBeGreaterThan(0);
  });
});

describe("E-BRANA and the other checks with the house", () => {
  const codes = (s: SiteModel) => validateSiteWithHouse(s, OUTDOOR, FIXTURE_BEARING_DEG).errors.map((e) => e.code);
  it("a shrub in the park span, a leaf narrower than the drive, a too wide opening, an open leaf over the next gate", () => {
    const sliding = layout.gates.find((g) => g.kind === "sliding")!;
    const mid = sliding.park!.polygon.reduce<XY>((a, q) => [a[0] + q[0] / 4, a[1] + q[1] / 4], [0, 0]);
    expect(codes(redesigned((raw) => (raw.shrubs as unknown[]).push({ id: "SHX", species: (raw.shrubs as { species: string }[])[0].species, pos: mid, height: 1, width: 0.6 })))).toContain("E-BRANA");
    expect(codes(redesigned((raw) => ((raw.gates as { leaf: number }[])[0].leaf = driveW - 0.5)))).toContain("E-BRANA");
    expect(codes(redesigned((raw) => ((raw.gates as { postSize: number }[])[1].postSize = 0.3)))).toContain("E-BRANA");
    expect(codes(redesigned((raw) => ((raw.gates as { tail: number }[])[0].tail = 30)))).toContain("E-BRANA");
  });
  it("two gates for one access", () => {
    const two = redesigned((raw) => (raw.gates as unknown[]).push({ ...(raw.gates as object[])[1], id: "GT03" }));
    expect(validateSite(two).errors.map((e) => e.code)).toContain("E-BRANA");
  });
  it("E-RAMP: a ramp steeper than the limit; E-TANK: a tank under the paving or outside the plot", () => {
    const steep = redesigned((raw) => ((raw.terrain as { plane: { z0: number } }).plane.z0 = 3));
    expect(codes(steep)).toContain("E-RAMP");
    const drive = strip("drive");
    const tank = redesigned((raw) => (raw.rainwater = { tank: { pos: [(drive[0] + drive[2]) / 2, (drive[1] + drive[3]) / 2], volumeM3: 8, diameter: 2.4, overflow: "soakaway" } }));
    expect(codes(tank)).toContain("E-TANK");
    const out = redesigned((raw) => (raw.rainwater = { tank: { pos: [500, 500], volumeM3: 8, diameter: 2.4, overflow: "soakaway" } }));
    expect(validateSite(out).errors.map((e) => e.code)).toContain("E-TANK");
  });
  it("W-RAMP-FALL: a ramp that does not fall away from the house by RAMP_MIN_FALL warns; one that does, does not", () => {
    const warnings = (s: SiteModel) => validateSiteWithHouse(s, OUTDOOR, FIXTURE_BEARING_DEG).warnings.map((e) => e.code);
    const plateau = (site.terrain as { plateau: { level: number } }).plateau.level;
    // natural ground well above the floor: both ramps rise towards the street (water runs to the house)
    const up = redesigned((raw) => ((raw.terrain as { plane: { z0: number } }).plane.z0 = plateau + 0.6));
    expect(warnings(up).filter((c) => c === "W-RAMP-FALL")).toHaveLength(2);
    // natural ground well below the plateau: both ramps fall to their gates by more than the minimum
    const down = redesigned((raw) => ((raw.terrain as { plane: { z0: number } }).plane.z0 = plateau - 0.6));
    const levels = validateSiteWithHouse(down, OUTDOOR, FIXTURE_BEARING_DEG);
    expect(levels.errors).toEqual([]);
    expect(levels.warnings.map((e) => e.code)).not.toContain("W-RAMP-FALL");
  });
});

describe("street", () => {
  const st = streetGeometry(site);
  it("pavement and green strip split the verge", () => {
    expect(st.pavement).not.toBeNull();
    expect(polygonArea(st.pavement!) + polygonArea(st.green!)).toBeCloseTo(polygonArea(st.verge), 6);
    // the pavement is the strip along the kerb
    const kerbLine = offsetEdgeLine(plot, site.street.edge, site.street.verge);
    for (const q of st.pavement!.slice(2)) expect(q[1]).toBeCloseTo(yOnLine(kerbLine, q[0]), 6);
    const plain = JSON.parse(JSON.stringify(siteRaw)) as { street: { pavement?: number } };
    delete plain.street.pavement;
    const none = streetGeometry(parseSite(plain));
    expect(none.pavement).toBeNull();
    expect(none.green).toEqual(none.verge);
  });
  it("dropped kerbs lie on the kerb strip where the drive and the walk cross it, as wide as the crossing", () => {
    const outer = offsetEdgeLine(plot, site.street.edge, site.street.verge);
    const inner = offsetEdgeLine(plot, site.street.edge, site.street.verge - DEFAULT_KERB_WIDTH);
    for (const [kerb, verge] of [[access.driveKerb, access.driveVerge], [access.walkKerb, access.walkVerge]] as const) {
      expect(kerb).toHaveLength(4);
      expect(kerb[0][1]).toBeCloseTo(yOnLine(inner, kerb[0][0]), 9);
      expect(kerb[2][1]).toBeCloseTo(yOnLine(outer, kerb[2][0]), 9);
      // same span as the far edge of the verge crossing
      expect(Math.min(kerb[2][0], kerb[3][0])).toBeCloseTo(Math.min(verge[2][0], verge[3][0]), 9);
      expect(Math.max(kerb[2][0], kerb[3][0])).toBeCloseTo(Math.max(verge[2][0], verge[3][0]), 9);
    }
  });
});
