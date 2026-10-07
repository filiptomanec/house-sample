// The code examples of docs/KERNEL-API.md, executed. If you change an example in the document, change it here too.
import { describe, expect, it } from "vitest";
import { derived, house, metrics } from "../instance";
import { wallBody } from "../geom";
import type { Derived, House, Locale, Metrics } from "../types";

// ---- Example 1: floor plan as SVG (page "Floor plan")
function planSvg(d: Derived, locale: Locale): string {
  const b = d.bbox;
  const flip = (y: number): number => b.y1 - y; // SVG y points down, house y points north
  const rect = (r: [number, number, number, number], cls: string): string =>
    `<rect class="${cls}" x="${r[0]}" y="${flip(r[3])}" width="${r[2] - r[0]}" height="${r[3] - r[1]}"/>`;
  const parts: string[] = [];
  for (const r of d.rooms) for (const q of r.cleanRects) parts.push(rect(q, `room zone-${r.zone}`));
  for (const w of d.walls) parts.push(rect(wallBody(w, d.walls), `wall wall-${w.kind}`));
  for (const o of d.openings) {
    const half = o.w / 2;
    const [x0, x1, y0, y1] = o.orient === "h" ? [o.cx - half, o.cx + half, o.cy, o.cy] : [o.cx, o.cx, o.cy - half, o.cy + half];
    parts.push(`<line class="opening ${o.kind}" x1="${x0}" y1="${flip(y0)}" x2="${x1}" y2="${flip(y1)}"/>`);
  }
  for (const r of d.rooms) parts.push(`<text x="${r.label.x}" y="${flip(r.label.y)}" text-anchor="middle">${r.name[locale]}</text>`);
  return `<svg viewBox="${b.x0} 0 ${b.w} ${b.d}" xmlns="http://www.w3.org/2000/svg">${parts.join("")}</svg>`;
}

// ---- Example 2: roof faces as triangles for three.js (page "Model"); glTF is Y-up: (x, y, z) -> (x, z, -y)
function roofTriangles(d: Derived): Float32Array {
  const out: number[] = [];
  for (const f of d.roofPlanes) {
    const p = f.pts3.map(([x, y, z]) => [x, z, -y]);
    for (let i = 1; i < p.length - 1; i++) out.push(...p[0], ...p[i], ...p[i + 1]); // fan: faces are convex
  }
  return new Float32Array(out);
}

// ---- Example 3: direct sun on the roof faces and the openings (page "Sun")
/** Unit vector towards the sun in the house frame, from true azimuth and elevation in degrees. */
function sunVector(azTrue: number, elev: number, bearing: number): [number, number, number] {
  const a = ((azTrue - bearing) * Math.PI) / 180; // house azimuth
  const e = (elev * Math.PI) / 180;
  return [Math.sin(a) * Math.cos(e), Math.cos(a) * Math.cos(e), Math.sin(e)];
}
function cosIncidence(d: Derived, azTrue: number, elev: number): Record<string, number> {
  const s = sunVector(azTrue, elev, d.houseAxisBearingDeg);
  return Object.fromEntries(d.roofPlanes.map((f) => [f.id, Math.max(0, f.frame.n[0] * s[0] + f.frame.n[1] * s[1] + f.frame.n[2] * s[2])]));
}

// ---- Example 4: transmission heat loss coefficient of the heated envelope (page "Energy")
function transmissionUA(h: House, d: Derived, m: Metrics): { walls: number; windows: number; doors: number; roof: number; floor: number } {
  const windows = d.openings.filter((o) => o.exterior && o.glazingArea > 0 && d.rooms.find((r) => r.id === o.room)?.heated);
  const uOf = (kind: string): number => (kind === "slider" && h.windows.slider ? h.windows.slider.Uw : h.windows.Uw);
  return {
    walls: m.heated.wallOpaque * d.assemblies.exteriorWall.U,
    windows: windows.reduce((s, o) => s + o.glazingArea * uOf(o.kind), 0),
    doors: m.heated.doors * h.windows.Ud,
    roof: m.roofAreaOverFootprint * d.assemblies.roof.U,
    floor: m.heated.floorArea * d.assemblies.groundFloor.U,
  };
}

// ---- Example 5: quantities for the budget (page "Budget")
function quantities(d: Derived, m: Metrics): Record<string, number> {
  const windowsByKind: Record<string, number> = {};
  for (const o of d.openings) windowsByKind[o.kind] = (windowsByKind[o.kind] ?? 0) + 1;
  return {
    footprint: m.footprintArea,
    roofSloped: m.roofArea,
    exteriorWallGross: d.walls.filter((w) => w.ext).reduce((s, w) => s + w.len * (w.height ?? 0), 0),
    interiorWallLength: d.walls.filter((w) => !w.ext).reduce((s, w) => s + w.len, 0),
    pvModules: d.pv.count,
    ...Object.fromEntries(Object.entries(windowsByKind).map(([k, v]) => [`count_${k}`, v])),
  };
}

describe("KERNEL-API examples", () => {
  it("the shared instance is the parsed and derived model", () => {
    expect(house.schema).toBe("house/1");
    expect(derived.rooms.length).toBe(house.rooms.length);
    expect(metrics.netArea).toBeGreaterThan(0);
  });

  it("planSvg draws every room, wall and opening", () => {
    const svg = planSvg(derived, "en");
    expect(svg.startsWith("<svg")).toBe(true);
    expect((svg.match(/class="room /g) ?? []).length).toBe(derived.rooms.reduce((s, r) => s + r.cleanRects.length, 0));
    expect((svg.match(/class="wall /g) ?? []).length).toBe(derived.walls.length);
    expect((svg.match(/class="opening /g) ?? []).length).toBe(derived.openings.length);
    expect(svg).toContain(house.rooms[0].name.en);
    expect(planSvg(derived, "cs")).toContain(house.rooms[0].name.cs);
  });

  it("roofTriangles gives (n - 2) triangles per face and the right total area", () => {
    const t = roofTriangles(derived);
    expect(t.length / 9).toBe(derived.roofPlanes.reduce((s, f) => s + f.pts.length - 2, 0));
    // area of all triangles = roof area
    let area = 0;
    for (let i = 0; i < t.length; i += 9) {
      const a = [t[i + 3] - t[i], t[i + 4] - t[i + 1], t[i + 5] - t[i + 2]];
      const b = [t[i + 6] - t[i], t[i + 7] - t[i + 1], t[i + 8] - t[i + 2]];
      area += Math.hypot(a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]) / 2;
    }
    expect(area).toBeCloseTo(metrics.roofArea, 0);
    // glTF is Y-up: the highest y equals the highest roof point
    expect(Math.max(...Array.from(t).filter((_, i) => i % 3 === 1))).toBeCloseTo(derived.bbox.z1, 3);
  });

  it("cosIncidence: the sun in the direction a plane faces lights it best", () => {
    const south = derived.roofPlanes.find((f) => f.side === "S")!;
    const lit = cosIncidence(derived, south.azimuthTrue, 90 - south.pitch);
    expect(lit[south.id]).toBeCloseTo(1, 9); // the sun stands on the normal of the plane
    const north = derived.roofPlanes.find((f) => f.side === "N")!;
    // the opposite plane is tilted by twice the pitch away from the sun: cos(2 x pitch)
    expect(lit[north.id]).toBeCloseTo(Math.max(0, Math.cos((2 * south.pitch * Math.PI) / 180)), 9);
    // a low sun in the north is behind the south plane
    expect(cosIncidence(derived, north.azimuthTrue, 5)[south.id]).toBe(0);
    // the sun vector is a unit vector
    const v = sunVector(100, 30, derived.houseAxisBearingDeg);
    expect(Math.hypot(...v)).toBeCloseTo(1, 12);
    // true south-west sun, low: the west-facing openings see it
    const sw = sunVector(225, 10, derived.houseAxisBearingDeg);
    expect(sw[2]).toBeGreaterThan(0);
  });

  it("transmissionUA gives positive, plausible components", () => {
    const ua = transmissionUA(house, derived, metrics);
    for (const v of Object.values(ua)) expect(v).toBeGreaterThan(0);
    const total = Object.values(ua).reduce((s, v) => s + v, 0);
    // average U of the envelope is between the best layer build-up and the worst one
    const area = metrics.heated.wallOpaque + metrics.heated.glazing + metrics.heated.doors + metrics.roofAreaOverFootprint + metrics.heated.floorArea;
    expect(total / area).toBeGreaterThan(0.1);
    expect(total / area).toBeLessThan(0.5);
  });

  it("quantities", () => {
    const q = quantities(derived, metrics);
    expect(q.footprint).toBe(metrics.footprintArea);
    expect(q.count_window).toBe(derived.openings.filter((o) => o.kind === "window").length);
    expect(q.exteriorWallGross).toBeGreaterThan(q.interiorWallLength);
  });
});
