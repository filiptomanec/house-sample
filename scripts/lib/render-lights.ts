// Lamps for the renders: a ceiling grid in the rooms, downlights of covered outdoor areas, wall lights at the entrance and the
// garage door, bollards along paths, the garden lights of the site (tree uplights, deck step lights, underwater pool lights,
// the pillar light) and (optional) the lamps of the furniture decor from the furniture report.
// Positions come from the derived model and the resolved site; the numbers (spacing, lumens, colour) are data in model/render.json.
import type { RenderConfig, Vec3 } from "./render-schema";
import { facadeVectors, type WorldContext } from "./render-world";

export interface LightItem {
  kind: string;
  group: "interior" | "exterior";
  pos: Vec3;
  room: string | null;
  space: string;
  lumens: number;
  /** Starting value for a Blender point light (about lumens / 10). */
  watts: number;
  kelvin: number;
  radius: number;
  spot: { direction: Vec3; coneDeg: number; blend: number } | null;
}

/** The part of pipeline/out/furniture-report.json that is used. */
export interface FurnitureReport {
  modelHash?: string;
  decor?: { placed?: { item: string; zone: string; at: [number, number, number] }[] };
}

const DOWN: Vec3 = [0, 0, -1];
const wattsOf = (lumens: number): number => Math.round(lumens / 10);
const r3 = (v: number): number => Math.round(v * 1000) / 1000 + 0;
const unit = (v: Vec3): Vec3 => {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [Math.round((v[0] / l) * 1e6) / 1e6 + 0, Math.round((v[1] / l) * 1e6) / 1e6 + 0, Math.round((v[2] / l) * 1e6) / 1e6 + 0];
};
/** Point in polygon, or within `margin` of it (house outline: `margin` keeps lamps off the walls). */
function inPolygon(x: number, y: number, poly: readonly (readonly number[])[], margin = 0): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  if (inside || margin <= 0) return inside;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [ax, ay] = poly[j], [bx, by] = poly[i];
    const l2 = (bx - ax) ** 2 + (by - ay) ** 2 || 1;
    const t = Math.max(0, Math.min(1, ((x - ax) * (bx - ax) + (y - ay) * (by - ay)) / l2));
    if (Math.hypot(x - ax - t * (bx - ax), y - ay - t * (by - ay)) < margin) return true;
  }
  return false;
}

/** Cell-centred points over a rectangle: n = round(extent / spacing) (at least 1) per axis. */
export function gridPoints([x0, y0, x1, y1]: readonly number[], spacing: number): [number, number][] {
  const nx = Math.max(1, Math.round((x1 - x0) / spacing));
  const ny = Math.max(1, Math.round((y1 - y0) / spacing));
  const out: [number, number][] = [];
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) out.push([x0 + ((x1 - x0) * (i + 0.5)) / nx, y0 + ((y1 - y0) * (j + 0.5)) / ny]);
  return out;
}

export function buildLights(ctx: WorldContext, report: FurnitureReport | null) {
  const { derived, house, cfg } = ctx;
  const items: LightItem[] = [];
  const L = cfg.lights;
  const push = (it: Omit<LightItem, "watts">): void => {
    items.push({ ...it, watts: wattsOf(it.lumens) });
  };

  // 1. ceiling grid of every room (the garage included), recessed downlights just below the ceiling
  for (const room of derived.rooms) {
    const accepted: [number, number][] = [];
    for (const rect of room.cleanRects) {
      for (const p of gridPoints(rect, L.ceiling.spacingM)) {
        if (accepted.some((q) => Math.hypot(q[0] - p[0], q[1] - p[1]) < 0.7 * L.ceiling.spacingM)) continue;
        accepted.push(p);
        push({
          kind: "downlight", group: "interior", pos: [p[0], p[1], room.height - 0.02], room: room.id, space: room.type,
          lumens: L.ceiling.lumens, kelvin: L.ceiling.kelvin, radius: L.ceiling.radiusM,
          spot: { direction: DOWN, coneDeg: L.ceiling.coneDeg, blend: L.ceiling.blend },
        });
      }
    }
  }

  // 2. covered outdoor areas (terrace, porch): downlights in the soffit
  for (const o of derived.outdoor) {
    if (!o.covered) continue;
    const inner: [number, number, number, number] = [o.rect[0], o.rect[1], o.rect[2], o.rect[3]];
    for (const p of gridPoints(inner, L.terrace.spacingM)) {
      push({
        kind: "terrace_downlight", group: "exterior", pos: [p[0], p[1], house.clearHeight - 0.02], room: null, space: o.type,
        lumens: L.terrace.lumens, kelvin: L.terrace.kelvin, radius: L.terrace.radiusM,
        spot: { direction: DOWN, coneDeg: L.terrace.coneDeg, blend: L.terrace.blend },
      });
    }
  }

  // 3. wall lights beside the entrance and the garage door (sides per opening kind from the config)
  for (const o of derived.openings) {
    const sides = L.wall.kinds[o.kind];
    if (!sides || !o.exterior || o.azimuth == null || o.center == null) continue;
    const wall = derived.walls.find((w) => w.id === o.wallId);
    const t = wall?.t ?? derived.wall.ext;
    const { normal, along } = facadeVectors(o.azimuth);
    const out = t / 2 + L.wall.offsetM;
    for (const sgn of sides === 1 ? [1] : [-1, 1]) {
      const off = sgn * (o.w / 2 + L.wall.sideOffsetM);
      push({
        kind: "wall_light", group: "exterior",
        pos: [o.center[0] + normal[0] * out + along[0] * off, o.center[1] + normal[1] * out + along[1] * off, L.wall.height],
        room: null, space: o.kind, lumens: L.wall.lumens, kelvin: L.wall.kelvin, radius: L.wall.radiusM,
        spot: { direction: DOWN, coneDeg: L.wall.coneDeg, blend: L.wall.blend },
      });
    }
  }

  // 4. bollards along the long sides of path areas
  for (const o of derived.outdoor) {
    if (!L.bollard.outdoorTypes.includes(o.type)) continue;
    const [x0, y0, x1, y1] = o.rect;
    const alongX = x1 - x0 > y1 - y0;
    const len = alongX ? x1 - x0 : y1 - y0;
    const n = Math.max(1, Math.floor(len / L.bollard.spacingM));
    for (let k = 0; k < n; k++) {
      const s = ((k + 0.5) / n) * len;
      const side = k % 2 === 0 ? -1 : 1;
      const pos: Vec3 = alongX
        ? [x0 + s, side < 0 ? y0 - L.bollard.sideOffsetM : y1 + L.bollard.sideOffsetM, L.bollard.height]
        : [side < 0 ? x0 - L.bollard.sideOffsetM : x1 + L.bollard.sideOffsetM, y0 + s, L.bollard.height];
      push({ kind: "bollard", group: "exterior", pos, room: null, space: o.type, lumens: L.bollard.lumens, kelvin: L.bollard.kelvin, radius: L.bollard.radiusM, spot: null });
    }
  }

  // 5. garden: uplights beside the trees marked `uplight`, on the side that faces the house, aimed into the crown
  const centre: [number, number] = [(derived.bbox.x0 + derived.bbox.x1) / 2, (derived.bbox.y0 + derived.bbox.y1) / 2];
  for (const t of ctx.siteDerived.trees) {
    if (!t.uplight) continue;
    const dx = centre[0] - t.x, dy = centre[1] - t.y, dl = Math.hypot(dx, dy) || 1;
    const pos: Vec3 = [r3(t.x + (dx / dl) * L.uplight.offsetM), r3(t.y + (dy / dl) * L.uplight.offsetM), r3(t.z + 0.05)];
    const aim: Vec3 = [t.x, t.y, t.z + t.crownBase + (t.height - t.crownBase) * L.uplight.aimHeightFraction];
    push({
      kind: "garden", group: "exterior", pos, room: null, space: "tree_uplight", lumens: L.uplight.lumens, kelvin: L.uplight.kelvin, radius: L.uplight.radiusM,
      spot: { direction: unit([aim[0] - pos[0], aim[1] - pos[1], aim[2] - pos[2]]), coneDeg: L.uplight.coneDeg, blend: L.uplight.blend },
    });
  }

  // 6. step lights in the edges of raised deck areas where they meet the ground (not along the house or another slab)
  const others = derived.outdoor.map((o) => o.rect);
  const outline = derived.outline.polygons[0]?.pts ?? [];
  const onSlabOrHouse = (x: number, y: number, self: readonly number[]): boolean =>
    others.some((r) => r !== self && x > r[0] - 0.05 && x < r[2] + 0.05 && y > r[1] - 0.05 && y < r[3] + 0.05) || inPolygon(x, y, outline, 0.3);
  for (const o of derived.outdoor) {
    if (!L.step.outdoorTypes.includes(o.type) || o.covered) continue;
    const [x0, y0, x1, y1] = o.rect;
    const edges: { a: [number, number]; b: [number, number]; out: [number, number] }[] = [
      { a: [x0, y0], b: [x1, y0], out: [0, -1] },
      { a: [x1, y0], b: [x1, y1], out: [1, 0] },
      { a: [x1, y1], b: [x0, y1], out: [0, 1] },
      { a: [x0, y1], b: [x0, y0], out: [-1, 0] },
    ];
    for (const e of edges) {
      const len = Math.hypot(e.b[0] - e.a[0], e.b[1] - e.a[1]);
      const n = Math.max(1, Math.round(len / L.step.spacingM));
      for (let k = 0; k < n; k++) {
        const f = (k + 0.5) / n;
        const x = e.a[0] + (e.b[0] - e.a[0]) * f, y = e.a[1] + (e.b[1] - e.a[1]) * f;
        if (onSlabOrHouse(x + e.out[0] * 0.2, y + e.out[1] * 0.2, o.rect)) continue;
        push({
          kind: "garden", group: "exterior", pos: [r3(x + e.out[0] * 0.01), r3(y + e.out[1] * 0.01), r3(o.top - L.step.height)], room: null, space: "deck_step",
          lumens: L.step.lumens, kelvin: L.step.kelvin, radius: L.step.radiusM, spot: { direction: unit([e.out[0], e.out[1], -0.6]), coneDeg: 110, blend: 0.8 },
        });
      }
    }
  }

  // 7. underwater lights in the long walls of every pool, aimed across the basin
  for (const o of derived.outdoor) {
    if (!o.pool) continue;
    const [x0, y0, x1, y1] = o.pool.water;
    const alongX = x1 - x0 >= y1 - y0;
    const len = alongX ? x1 - x0 : y1 - y0;
    const n = Math.max(1, Math.round(len / L.pool.spacingM));
    const z = r3(o.pool.waterZ - L.pool.depthM);
    for (const side of [-1, 1]) {
      for (let k = 0; k < n; k++) {
        const s = ((k + 0.5) / n) * len;
        const pos: Vec3 = alongX ? [r3(x0 + s), side < 0 ? y0 : y1, z] : [side < 0 ? x0 : x1, r3(y0 + s), z];
        const dir: Vec3 = alongX ? [0, -side, 0] : [-side, 0, 0];
        push({ kind: "pool", group: "exterior", pos, room: null, space: o.type, lumens: L.pool.lumens, kelvin: L.pool.kelvin, radius: L.pool.radiusM, spot: { direction: dir, coneDeg: L.pool.coneDeg, blend: L.pool.blend } });
      }
    }
  }

  // 8. the light of a technical pillar (site pillars with the item "light"), on the street face near the top
  for (const p of ctx.siteDerived.pillars) {
    if (!p.items.includes("light")) continue;
    const out: [number, number] = [-p.inward[0], -p.inward[1]];
    const pos: Vec3 = [r3(p.center[0] + out[0] * (p.size[1] / 2 + 0.01)), r3(p.center[1] + out[1] * (p.size[1] / 2 + 0.01)), r3(p.z + p.size[2] - L.pillar.insetM)];
    push({ kind: "pillar", group: "exterior", pos, room: null, space: "pillar", lumens: L.pillar.lumens, kelvin: L.pillar.kelvin, radius: L.pillar.radiusM, spot: null });
  }

  // 9. lamps of the furniture decor (pendants, floor / table / desk lamps, lanterns), when the report belongs to this model
  let usedReport = false;
  if (report?.decor?.placed) {
    for (const d of report.decor.placed) {
      const spec = L.decor[d.item];
      if (!spec) continue;
      usedReport = true;
      push({
        kind: d.item, group: spec.group, pos: [d.at[0], d.at[1], d.at[2] + (spec.lift ?? 0)],
        room: derived.rooms.some((r) => r.id === d.zone) ? d.zone : null, space: d.zone,
        lumens: spec.lumens, kelvin: spec.kelvin, radius: spec.radiusM, spot: null,
      });
    }
  }
  return { sources: { rooms: true, furnitureReport: usedReport }, schedule: L.schedule, items };
}

const smooth = (t: number): number => {
  const c = Math.min(1, Math.max(0, t));
  return c * c * (3 - 2 * c);
};

/** Level 0..1 of a lamp group for an apparent sun elevation: 0 above `offAbove`, 1 below `fullBelow`, smooth in between. */
export function scheduleLevel(s: { offAboveElevationDeg: number; fullBelowElevationDeg: number }, elevationDeg: number): number {
  return smooth((s.offAboveElevationDeg - elevationDeg) / (s.offAboveElevationDeg - s.fullBelowElevationDeg));
}

export type { RenderConfig };
