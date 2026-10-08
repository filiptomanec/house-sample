import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { getHouseContext } from "./context";
import type { FurnitureFootprints } from "./glb";
import { PASSABLE_KINDS, WALK, buildWalkColliders, collidersAt, move, walkStart, type Seg } from "./walkCollision";

const ctx = getHouseContext();
const footprints = JSON.parse(readFileSync(join(__dirname, "..", "..", "..", "public", "models", "furniture-footprints.json"), "utf8")) as FurnitureFootprints;
const R = WALK.radius;

const distToSeg = (p: [number, number], [a, b]: Seg) => {
  const dx = b[0] - a[0], dy = b[1] - a[1], L = dx * dx + dy * dy;
  const t = L ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L)) : 0;
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
};

/** Do two segments cross properly (not just touch)? */
function cross(p: [number, number], q: [number, number], [a, b]: Seg): boolean {
  const o = (u: [number, number], v: [number, number], w: [number, number]) => (v[0] - u[0]) * (w[1] - u[1]) - (v[1] - u[1]) * (w[0] - u[0]);
  const d1 = o(p, q, a), d2 = o(p, q, b), d3 = o(a, b, p), d4 = o(a, b, q);
  return d1 * d2 < 0 && d3 * d4 < 0;
}

/** Cells the walker's centre can stand on: every cell farther than the radius from all segments. */
function freeGrid(segs: Seg[], step: number) {
  const b = ctx.derived.bbox;
  const x0 = b.x0 - 1, y0 = b.y0 - 1, nx = Math.ceil((b.w + 2) / step), ny = Math.ceil((b.d + 2) / step);
  const blocked = new Uint8Array(nx * ny);
  const r = R - 1e-9;
  for (const s of segs) {
    const [a, c] = s;
    const i0 = Math.max(0, Math.floor((Math.min(a[0], c[0]) - r - x0) / step)), i1 = Math.min(nx - 1, Math.ceil((Math.max(a[0], c[0]) + r - x0) / step));
    const j0 = Math.max(0, Math.floor((Math.min(a[1], c[1]) - r - y0) / step)), j1 = Math.min(ny - 1, Math.ceil((Math.max(a[1], c[1]) + r - y0) / step));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) if (distToSeg([x0 + i * step, y0 + j * step], s) < r) blocked[j * nx + i] = 1;
  }
  const at = (p: [number, number]) => [Math.round((p[0] - x0) / step), Math.round((p[1] - y0) / step)] as const;
  return { nx, ny, blocked, at, x0, y0, step };
}

/** Cells reachable from `start` by 4-neighbour steps through free cells. */
function reach(grid: ReturnType<typeof freeGrid>, start: [number, number]): Uint8Array {
  const seen = new Uint8Array(grid.nx * grid.ny);
  const [si, sj] = grid.at(start);
  const stack = [sj * grid.nx + si];
  seen[stack[0]] = 1;
  while (stack.length) {
    const k = stack.pop()!;
    const i = k % grid.nx, j = Math.floor(k / grid.nx);
    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const ni = i + di, nj = j + dj;
      if (ni < 0 || nj < 0 || ni >= grid.nx || nj >= grid.ny) continue;
      const nk = nj * grid.nx + ni;
      if (!seen[nk] && !grid.blocked[nk]) { seen[nk] = 1; stack.push(nk); }
    }
  }
  return seen;
}

describe("walk colliders", () => {
  const bare = buildWalkColliders(ctx);
  const full = buildWalkColliders(ctx, footprints);
  const walls = bare.walls;

  it("have one box of furniture per footprint, with four sides each, and are the same walls with or without furniture", () => {
    expect(bare.furniture).toHaveLength(0);
    expect(full.furniture).toHaveLength(footprints.items.length);
    expect(full.furniture[0].segs).toHaveLength(4);
    expect(full.walls).toEqual(bare.walls);
  });

  it("leave a gap in the wall at every passable opening: no collider runs through the open part of a door", () => {
    const openings = ctx.derived.openings.filter((o) => (PASSABLE_KINDS as readonly string[]).includes(o.kind));
    expect(openings.length).toBeGreaterThan(0);
    for (const o of openings) {
      const wall = ctx.derived.walls.find((w) => w.id === o.wallId)!;
      const lo = o.from + 0.002, hi = o.to - 0.002, half = wall.t / 2 - 0.002;
      // a point on a collider inside the gap's rectangle would block the door
      for (const [a, b] of walls) {
        for (const k of [0, 0.25, 0.5, 0.75, 1]) {
          const x = a[0] + (b[0] - a[0]) * k, y = a[1] + (b[1] - a[1]) * k;
          const along = wall.orient === "h" ? x : y, across = wall.orient === "h" ? y : x;
          expect(along > lo && along < hi && Math.abs(across - wall.at) < half, `${o.id} at ${x.toFixed(2)},${y.toFixed(2)}`).toBe(false);
        }
      }
    }
  });

  /** Walks from one side of an opening to the other along the wall normal. */
  function crossing(o: (typeof ctx.derived.openings)[number], colliders: typeof bare): [number, number] {
    const wall = ctx.derived.walls.find((w) => w.id === o.wallId)!;
    const reachM = wall.t / 2 + R + 0.15;
    const from: [number, number] = wall.orient === "h" ? [o.c, wall.at - reachM] : [wall.at - reachM, o.c];
    const to: [number, number] = wall.orient === "h" ? [o.c, wall.at + reachM] : [wall.at + reachM, o.c];
    const d: [number, number] = [to[0] - from[0], to[1] - from[1]];
    let p = from;
    for (let i = 0; i < 4; i++) p = move(p, [d[0] / 4, d[1] / 4], () => collidersAt(colliders, false, p));
    return Math.hypot(p[0] - to[0], p[1] - to[1]) < 0.05 ? to : p;
  }

  it("lets the walker through doors, entries and sliders, and holds it back at windows and garage doors", () => {
    let passed = 0, held = 0;
    for (const o of ctx.derived.openings) {
      if (o.wallId === null) continue;
      const wall = ctx.derived.walls.find((w) => w.id === o.wallId)!;
      const end = crossing(o, bare);
      const side = (p: [number, number]) => Math.sign((wall.orient === "h" ? p[1] : p[0]) - wall.at);
      if ((PASSABLE_KINDS as readonly string[]).includes(o.kind)) {
        // the gap is wider than the walker, so the whole walk goes through
        expect(o.w, o.id).toBeGreaterThan(2 * R);
        expect(side(end), `${o.id} (${o.kind}) should be passable`).toBe(1);
        passed++;
      } else {
        expect(side(end), `${o.id} (${o.kind}) should be solid`).toBe(-1);
        held++;
      }
    }
    expect(passed).toBeGreaterThan(0);
    expect(held).toBeGreaterThan(0);
  });

  it("do not let a fast walker through a wall at 5 frames a second, from any angle", () => {
    // the longest step: running at 5 fps is 0.64 m, more than twice the radius
    const step = WALK.run / 5;
    let seed = 11;
    const rnd = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 0x100000000);
    let crossings = 0, steps = 0;
    for (let n = 0; n < 40; n++) {
      // start at a free point of the plan inside the building
      let p: [number, number] = [ctx.derived.bbox.x0 + rnd() * ctx.derived.bbox.w, ctx.derived.bbox.y0 + rnd() * ctx.derived.bbox.d];
      if (walls.some((s) => distToSeg(p, s) < R)) continue;
      const heading = rnd() * Math.PI * 2;
      let h = heading;
      for (let i = 0; i < 40; i++) {
        h += (rnd() - 0.5) * 0.8;
        const d: [number, number] = [Math.cos(h) * step, Math.sin(h) * step];
        const q = move(p, d, () => walls);
        // the straight path of a whole frame must not cross a wall outline (the sub-steps are what keeps it out)
        if (walls.some((s) => cross(p, q, s))) crossings++;
        steps++;
        p = q;
      }
    }
    expect(steps).toBeGreaterThan(300);
    expect(crossings).toBe(0);
  });

  it("make every room and the covered terrace reachable, with and without the furniture, from the start", () => {
    const start = walkStart(ctx).position;
    for (const [name, colliders] of [["without", bare], ["with", full]] as const) {
      const segs = [...colliders.walls, ...colliders.furniture.flatMap((f) => f.segs)];
      const grid = freeGrid(segs, 0.03);
      const seen = reach(grid, start);
      const ok = (p: [number, number]) => { const [i, j] = grid.at(p); return seen[j * grid.nx + i] === 1; };
      expect(ok(start), `${name} furniture: the start`).toBe(true);
      // a room is reachable when the walker can stand somewhere in it (the middle of a room may be covered by a table or a car)
      const somewhere = ([x0, y0, x1, y1]: readonly number[]) => {
        for (let y = y0; y <= y1; y += 0.03) for (let x = x0; x <= x1; x += 0.03) if (ok([x, y])) return true;
        return false;
      };
      for (const r of ctx.derived.rooms) expect(r.cleanRects.some(somewhere), `${name} furniture: ${r.name.en}`).toBe(true);
      for (const o of ctx.derived.outdoor.filter((x) => x.type === "terrace")) expect(somewhere(o.rect), `${name} furniture: terrace`).toBe(true);
    }
  });

  it("keep the furniture solid: a piece cannot be walked through, and one the walker stands in can be left", () => {
    const all = [...full.walls, ...full.furniture.flatMap((f) => f.segs)];
    let tried = 0;
    for (const f of footprints.items) {
      const [x0, y0, x1, y1] = f.box;
      if (x1 - x0 < 0.2 || y1 - y0 < 0.2) continue;
      // from the west of the piece towards its middle; only from a free spot (not inside or next to something else)
      let p: [number, number] = [x0 - R - 0.1, (y0 + y1) / 2];
      if (all.some((s) => distToSeg(p, s) < R + 1e-6)) continue;
      tried++;
      for (let i = 0; i < 6; i++) p = move(p, [(x1 - x0 + 2 * R + 0.2) / 6, 0], (q) => collidersAt(full, true, q));
      expect(p[0] > x0 + 1e-6 && p[0] < x1 - 1e-6 && p[1] > y0 + 1e-6 && p[1] < y1 - 1e-6, `piece ${f.id}`).toBe(false);
    }
    expect(tried).toBeGreaterThan(5);
    // standing inside a box: its sides are not colliders (the walker may step out), the walls still are
    const f = footprints.items[0];
    const inside: [number, number] = [(f.box[0] + f.box[2]) / 2, (f.box[1] + f.box[3]) / 2];
    expect(collidersAt(full, true, inside)).toBe(full.walls);
    expect(collidersAt(full, false, inside)).toBe(full.walls);
  });
});

describe("walkStart", () => {
  const start = walkStart(ctx);
  const living = ctx.derived.rooms.find((r) => r.role === "main-living")!;
  const glazing = ctx.derived.openings.filter((o) => o.room === living.id && o.exterior === true && o.glazingArea > 0).sort((a, b) => b.glazingArea - a.glazingArea)[0];

  it("is in the main living room, inside the outline, clear of the furniture", () => {
    expect(living.cleanRects.some(([x0, y0, x1, y1]) => start.position[0] > x0 && start.position[0] < x1 && start.position[1] > y0 && start.position[1] < y1)).toBe(true);
    for (const f of ctx.derived.furniture) {
      if (!f.rect) continue;
      const [x0, y0, x1, y1] = f.rect;
      const inside = start.position[0] > x0 - R && start.position[0] < x1 + R && start.position[1] > y0 - R && start.position[1] < y1 + R;
      expect(inside, `furniture ${f.type}`).toBe(false);
    }
  });

  it("looks out of the room's largest glazed opening (house azimuth: clockwise from +y), towards the garden", () => {
    expect(glazing).toBeDefined();
    expect(start.yawDeg).toBeCloseTo(glazing.azimuth!, 9);
    expect(start.yawDeg).toBeGreaterThanOrEqual(0);
    expect(start.yawDeg).toBeLessThan(360);
    // the opening is ahead: the vector from the start to its centre points along the view
    const a = (start.yawDeg * Math.PI) / 180;
    const dx = glazing.cx - start.position[0], dy = glazing.cy - start.position[1];
    expect((Math.sin(a) * dx + Math.cos(a) * dy) / Math.hypot(dx, dy)).toBeGreaterThan(0.9);
  });

  it("has a free sight line of several metres to the glass: no wall in between", () => {
    const { walls } = buildWalkColliders(ctx);
    const a = (start.yawDeg * Math.PI) / 180;
    const d = Math.abs((glazing.cx - start.position[0]) * Math.sin(a) + (glazing.cy - start.position[1]) * Math.cos(a));
    expect(d).toBeGreaterThan(3);
    // walk the line up to just before the opening: never closer than the radius to a wall
    for (let t = 0; t < d - 0.5; t += 0.1) {
      const p: [number, number] = [start.position[0] + Math.sin(a) * t, start.position[1] + Math.cos(a) * t];
      for (const sg of walls) expect(distToSeg(p, sg)).toBeGreaterThan(R * 0.5);
    }
  });

  it("starts at a free point: nothing closer than the radius", () => {
    const { walls } = buildWalkColliders(ctx);
    for (const s of walls) expect(distToSeg(start.position, s)).toBeGreaterThanOrEqual(R - 1e-9);
  });
});

describe("pool collider", () => {
  it("makes the water of every pool solid: the walker cannot step into the basin from the coping", () => {
    const { walls } = buildWalkColliders(ctx);
    const pools = ctx.derived.outdoor.filter((o) => o.pool);
    expect(pools.length).toBeGreaterThan(0);
    for (const o of pools) {
      const [x0, y0, x1, y1] = o.pool!.water;
      const cy = (y0 + y1) / 2;
      // from the coping beside the water, walk straight across it
      const end = move([x0 - 0.5, cy], [x1 - x0 + 1, 0], (q) => collidersAt({ walls, furniture: [] }, false, q));
      expect(end[0]).toBeLessThan(x0);
    }
  });
});
