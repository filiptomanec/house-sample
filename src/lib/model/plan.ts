// Floor-plan derivation (port of the concept/1 deriver): walls, net rooms, outline, overlaps, holes, components.
// Rooms are rectangles between wall axes; everything else is computed on a compressed coordinate grid, so the
// results are exact. House frame: x = east, y = north.
import {
  R5,
  bboxOf,
  mergeRects,
  perpHalfAt,
  rectArea,
  uniqSorted,
  unionOf,
  type BBox,
  type Rect,
} from "./geom";
import type { Component, DerivedOutline, DerivedWall, Hole, Overlap, WallKind } from "./types";

export interface PlanInput {
  wall: { ext: number; bearing: number; part: number };
  bearingAxes: { x: number[]; y: number[] };
  rooms: { id: string; rects: Rect[] }[];
}

export interface RawRoom {
  id: string;
  rects: Rect[];
  cleanRects: Rect[];
  area: number;
  axisArea: number;
  bbox: BBox | null;
  rectsClear: { rect: Rect; w: number; d: number }[];
  minWidth: number;
  mainClear: { w: number; d: number };
}

export interface Plan {
  grid: { xs: number[]; ys: number[] };
  overlaps: Overlap[];
  holes: Hole[];
  components: Component[];
  walls: DerivedWall[];
  rooms: RawRoom[];
  outline: DerivedOutline;
}

const idxMap = (arr: number[]): Map<number, number> => new Map(arr.map((v, i) => [v, i]));

export function derivePlan(input: PlanInput): Plan {
  const W = input.wall;
  const rooms = input.rooms;
  const bx = input.bearingAxes.x;
  const by = input.bearingAxes.y;

  // --- coordinate compression
  const xs = uniqSorted(rooms.flatMap((r) => r.rects.flatMap((q) => [q[0], q[2]])));
  const ys = uniqSorted(rooms.flatMap((r) => r.rects.flatMap((q) => [q[1], q[3]])));
  const xi = idxMap(xs);
  const yi = idxMap(ys);
  const nx = Math.max(0, xs.length - 1);
  const ny = Math.max(0, ys.length - 1);
  const owners: number[][][] = Array.from({ length: ny }, () => Array.from({ length: nx }, () => [] as number[]));
  rooms.forEach((r, ri) =>
    r.rects.forEach((q) => {
      for (let j = yi.get(R5(q[1]))!; j < yi.get(R5(q[3]))!; j++) {
        for (let i = xi.get(R5(q[0]))!; i < xi.get(R5(q[2]))!; i++) owners[j][i].push(ri);
      }
    }),
  );
  const own = (i: number, j: number): number => (i < 0 || j < 0 || i >= nx || j >= ny ? -1 : (owners[j][i][0] ?? -1));

  // --- overlaps
  const ovMap = new Map<string, { a: string; b: string; area: number; cells: Rect[] }>();
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const o = owners[j][i];
      if (o.length < 2) continue;
      for (let a = 0; a < o.length; a++) {
        for (let b = a + 1; b < o.length; b++) {
          const k = `${o[a]}|${o[b]}`;
          const cell: Rect = [xs[i], ys[j], xs[i + 1], ys[j + 1]];
          if (!ovMap.has(k)) ovMap.set(k, { a: rooms[o[a]].id, b: rooms[o[b]].id, area: 0, cells: [] });
          const e = ovMap.get(k)!;
          e.area += rectArea(cell);
          e.cells.push(cell);
        }
      }
    }
  }
  const overlaps: Overlap[] = [...ovMap.values()].map((e) => ({ a: e.a, b: e.b, area: e.area, bbox: bboxOf(e.cells), same: e.a === e.b }));

  // --- holes (uncovered cells not reachable from outside) and connectivity
  const covered = (i: number, j: number): boolean => i >= 0 && j >= 0 && i < nx && j < ny && owners[j][i].length > 0;
  const seen = Array.from({ length: ny + 2 }, () => new Uint8Array(nx + 2));
  const stack: [number, number][] = [[-1, -1]];
  seen[0][0] = 1;
  const N4: [number, number][] = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  while (stack.length) {
    const [i, j] = stack.pop()!;
    for (const [di, dj] of N4) {
      const a = i + di;
      const b = j + dj;
      if (a < -1 || b < -1 || a > nx || b > ny) continue;
      if (seen[b + 1][a + 1] || covered(a, b)) continue;
      seen[b + 1][a + 1] = 1;
      stack.push([a, b]);
    }
  }
  const holeCells: [number, number][] = [];
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) if (!covered(i, j) && !seen[j + 1][i + 1]) holeCells.push([i, j]);
  const holes: Hole[] = [];
  {
    const used = new Set<string>();
    const key = (i: number, j: number): string => `${i},${j}`;
    const set = new Set(holeCells.map(([i, j]) => key(i, j)));
    for (const [i0, j0] of holeCells) {
      if (used.has(key(i0, j0))) continue;
      const comp: Rect[] = [];
      const st: [number, number][] = [[i0, j0]];
      used.add(key(i0, j0));
      while (st.length) {
        const [i, j] = st.pop()!;
        comp.push([xs[i], ys[j], xs[i + 1], ys[j + 1]]);
        for (const [di, dj] of N4) {
          const k = key(i + di, j + dj);
          if (set.has(k) && !used.has(k)) {
            used.add(k);
            st.push([i + di, j + dj]);
          }
        }
      }
      holes.push({ area: comp.reduce((s, r) => s + rectArea(r), 0), bbox: bboxOf(comp) });
    }
  }
  const components: Component[] = [];
  {
    const comp = Array.from({ length: ny }, () => new Int32Array(nx).fill(-1));
    for (let j0 = 0; j0 < ny; j0++) {
      for (let i0 = 0; i0 < nx; i0++) {
        if (!covered(i0, j0) || comp[j0][i0] >= 0) continue;
        const id = components.length;
        const rset = new Set<string>();
        let area = 0;
        const st: [number, number][] = [[i0, j0]];
        comp[j0][i0] = id;
        while (st.length) {
          const [i, j] = st.pop()!;
          rset.add(rooms[owners[j][i][0]].id);
          area += (xs[i + 1] - xs[i]) * (ys[j + 1] - ys[j]);
          for (const [di, dj] of N4) {
            const a = i + di;
            const b = j + dj;
            if (covered(a, b) && comp[b][a] < 0) {
              comp[b][a] = id;
              st.push([a, b]);
            }
          }
        }
        components.push({ rooms: [...rset], area });
      }
    }
  }

  // --- walls
  const isBearing = (orient: "h" | "v", at: number): boolean => (orient === "v" ? bx : by).some((a) => Math.abs(a - at) < 1e-4);
  const wallKind = (orient: "h" | "v", at: number, lo: number, hi: number): { kind: WallKind; t: number } => {
    if (lo < 0 || hi < 0) return { kind: "exterior", t: W.ext };
    return isBearing(orient, at) ? { kind: "bearing", t: W.bearing } : { kind: "partition", t: W.part };
  };
  const rid = (k: number): string | null => (k < 0 ? null : rooms[k].id);
  interface RawWall {
    orient: "h" | "v";
    at: number;
    from: number;
    to: number;
    lo: number;
    hi: number;
  }
  const walls: RawWall[] = [];
  for (let i = 0; i <= nx; i++) {
    let cur: RawWall | null = null;
    for (let j = 0; j < ny; j++) {
      const lo = own(i - 1, j);
      const hi = own(i, j);
      const has = lo !== hi;
      if (cur && has && cur.lo === lo && cur.hi === hi) {
        cur.to = ys[j + 1];
        continue;
      }
      if (cur) {
        walls.push(cur);
        cur = null;
      }
      if (has) cur = { orient: "v", at: xs[i], from: ys[j], to: ys[j + 1], lo, hi };
    }
    if (cur) walls.push(cur);
  }
  for (let j = 0; j <= ny; j++) {
    let cur: RawWall | null = null;
    for (let i = 0; i < nx; i++) {
      const lo = own(i, j - 1);
      const hi = own(i, j);
      const has = lo !== hi;
      if (cur && has && cur.lo === lo && cur.hi === hi) {
        cur.to = xs[i + 1];
        continue;
      }
      if (cur) {
        walls.push(cur);
        cur = null;
      }
      if (has) cur = { orient: "h", at: ys[j], from: xs[i], to: xs[i + 1], lo, hi };
    }
    if (cur) walls.push(cur);
  }
  walls.sort((a, b) => (a.orient === b.orient ? a.at - b.at || a.from - b.from : a.orient === "h" ? -1 : 1));
  const wallsOut: DerivedWall[] = walls.map((w, n) => {
    const k = wallKind(w.orient, w.at, w.lo, w.hi);
    const o: DerivedWall = {
      id: `Z${String(n + 1).padStart(2, "0")}`,
      orient: w.orient,
      at: w.at,
      from: w.from,
      to: w.to,
      len: R5(w.to - w.from),
      kind: k.kind,
      ext: k.kind === "exterior",
      t: k.t,
      lo: rid(w.lo),
      hi: rid(w.hi),
    };
    if (o.ext) {
      o.room = (o.lo ?? o.hi) as string;
      o.azimuth = w.orient === "v" ? (w.lo < 0 ? 270 : 90) : w.lo < 0 ? 180 : 0;
    }
    return o;
  });

  // --- net room areas
  const half = (orient: "h" | "v", at: number, lo: number, hi: number): number => wallKind(orient, at, lo, hi).t / 2;
  interface Cell {
    i: number;
    j: number;
    sh: { l: number; r: number; b: number; t: number };
    clean: Rect;
  }
  const cellsOf: Cell[][] = rooms.map(() => []);
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const r = own(i, j);
      if (r < 0) continue;
      const sh = { l: 0, r: 0, b: 0, t: 0 };
      let n = own(i - 1, j);
      if (n !== r) sh.l = half("v", xs[i], n, r);
      n = own(i + 1, j);
      if (n !== r) sh.r = half("v", xs[i + 1], r, n);
      n = own(i, j - 1);
      if (n !== r) sh.b = half("h", ys[j], n, r);
      n = own(i, j + 1);
      if (n !== r) sh.t = half("h", ys[j + 1], r, n);
      cellsOf[r].push({ i, j, sh, clean: [xs[i] + sh.l, ys[j] + sh.b, xs[i + 1] - sh.r, ys[j + 1] - sh.t] });
    }
  }
  const roomsOut: RawRoom[] = rooms.map((r, ri) => {
    const cells = cellsOf[ri];
    const cleanRects = mergeRects(cells.map((c) => c.clean).filter((c) => c[2] > c[0] + 1e-9 && c[3] > c[1] + 1e-9));
    const area = cleanRects.reduce((s, q) => s + rectArea(q), 0);
    const axisArea = cells.reduce((s, c) => s + (xs[c.i + 1] - xs[c.i]) * (ys[c.j + 1] - ys[c.j]), 0);
    // conservative net size of every original rectangle (largest deduction on each side)
    const rectsClear = r.rects.map((q) => {
      const i0 = xi.get(R5(q[0]))!;
      const i1 = xi.get(R5(q[2]))!;
      const j0 = yi.get(R5(q[1]))!;
      const j1 = yi.get(R5(q[3]))!;
      let sl = 0;
      let sr = 0;
      let sb = 0;
      let st = 0;
      for (const c of cells) {
        if (c.i < i0 || c.i >= i1 || c.j < j0 || c.j >= j1) continue;
        if (c.i === i0) sl = Math.max(sl, c.sh.l);
        if (c.i === i1 - 1) sr = Math.max(sr, c.sh.r);
        if (c.j === j0) sb = Math.max(sb, c.sh.b);
        if (c.j === j1 - 1) st = Math.max(st, c.sh.t);
      }
      return { rect: q.slice() as Rect, w: R5(q[2] - q[0] - sl - sr), d: R5(q[3] - q[1] - sb - st) };
    });
    const minWidth = rectsClear.length ? Math.min(...rectsClear.map((c) => Math.min(c.w, c.d))) : 0;
    const main = rectsClear.slice().sort((a, b) => b.w * b.d - a.w * a.d)[0] ?? { w: 0, d: 0 };
    return {
      id: r.id,
      rects: r.rects.map((q) => q.slice() as Rect),
      cleanRects,
      area: R5(area),
      axisArea: R5(axisArea),
      bbox: bboxOf(cleanRects),
      rectsClear,
      minWidth: R5(minWidth),
      mainClear: { w: main.w, d: main.d },
    };
  });

  // --- outline: axes plus half the exterior wall thickness on the outer sides
  const foot: Rect[] = [];
  const e = W.ext / 2;
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      if (own(i, j) < 0) continue;
      foot.push([
        xs[i] - (own(i - 1, j) < 0 ? e : 0),
        ys[j] - (own(i, j - 1) < 0 ? e : 0),
        xs[i + 1] + (own(i + 1, j) < 0 ? e : 0),
        ys[j + 1] + (own(i, j + 1) < 0 ? e : 0),
      ]);
    }
  }
  const u = unionOf(foot);
  const outline: DerivedOutline = {
    rects: u.rects,
    polygons: u.polygons.map((p) => ({ pts: p.pts, area: R5(p.area) })),
    bbox: u.bbox,
    area: R5(u.area),
    perimeter: R5(u.perimeter),
  };

  return { grid: { xs, ys }, overlaps, holes, components, walls: wallsOut, rooms: roomsOut, outline };
}

// ---------------------------------------------------------------- location of openings on walls
export const AX_TOL = 0.01;
const EPS = 1e-6;

export interface Located {
  wall: DerivedWall | null;
  problem: "no-axis" | "off-wall" | "span" | null;
}

/** Finds the wall an opening or an accent of width `w` centred at `c` along the axis `axis` sits on. */
export function locateOnWall(walls: DerivedWall[], orient: "h" | "v", axis: number, c: number, w: number): Located {
  const cands = walls.filter((q) => q.orient === orient && Math.abs(q.at - axis) <= AX_TOL);
  if (!cands.length) return { wall: null, problem: "no-axis" };
  const hit = cands.find((q) => c > q.from - EPS && c < q.to + EPS) ?? cands.find((q) => c >= q.from - EPS && c <= q.to + EPS);
  if (!hit) return { wall: null, problem: "off-wall" };
  const a = c - w / 2;
  const b = c + w / 2;
  if (a < hit.from - 1e-6 || b > hit.to + 1e-6) return { wall: hit, problem: "span" };
  return { wall: hit, problem: null };
}

/** Clear distance of the opening ends from the nearest perpendicular wall face. */
export function clearEnds(walls: DerivedWall[], wl: DerivedWall, from: number, to: number): { start: number; end: number } {
  return {
    start: R5(from - (wl.from + perpHalfAt(walls, wl.orient, wl.at, wl.from))),
    end: R5(wl.to - perpHalfAt(walls, wl.orient, wl.at, wl.to) - to),
  };
}
