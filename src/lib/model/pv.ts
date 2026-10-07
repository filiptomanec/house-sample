// Rule-based photovoltaic layout on convex roof faces. Rows run parallel to the eave, start at the lower edge of the
// usable area (the face inset by the setbacks of each edge kind) and are centred in the free width of their strip.
import type { Dir } from "./catalog";
import type { Pt, Pt3 } from "./geom";
import { insetConvex } from "./roofs";
import type { PvLayout, PvPanel, RoofFace } from "./types";

export interface PvSpec {
  module: { wp: number; width: number; height: number };
  layout: {
    facings: Dir[];
    orientation: "portrait" | "landscape" | "auto";
    gap: number;
    setback: { eave: number; ridge: number; hip: number; valley: number; step: number };
    obstacleClearance: number;
  };
}

/** A circular roof penetration in plan coordinates (m). */
export interface Obstacle {
  x: number;
  y: number;
  radius: number;
}

interface Placed {
  uv: [number, number, number, number];
  row: number;
  col: number;
}

/** Interval of the convex polygon at height v: [uMin, uMax] or null when v is outside. */
function sliceU(poly: Pt[], v: number): [number, number] | null {
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    if ((a[1] - v) * (b[1] - v) > 0) continue;
    if (Math.abs(b[1] - a[1]) < 1e-12) {
      lo = Math.min(lo, a[0], b[0]);
      hi = Math.max(hi, a[0], b[0]);
      continue;
    }
    const t = (v - a[1]) / (b[1] - a[1]);
    const u = a[0] + t * (b[0] - a[0]);
    lo = Math.min(lo, u);
    hi = Math.max(hi, u);
  }
  return lo <= hi ? [lo, hi] : null;
}

function layoutFace(usable: Pt[], pw: number, ph: number, gap: number, blocks: { u0: number; u1: number; v0: number; v1: number }[]): Placed[] {
  const vMin = Math.min(...usable.map((p) => p[1]));
  const vMax = Math.max(...usable.map((p) => p[1]));
  const out: Placed[] = [];
  for (let row = 0; ; row++) {
    const vLo = vMin + row * (ph + gap);
    const vHi = vLo + ph;
    if (vHi > vMax + 1e-9) break;
    const a = sliceU(usable, vLo);
    const b = sliceU(usable, vHi);
    if (!a || !b) continue;
    const left = Math.max(a[0], b[0]);
    const right = Math.min(a[1], b[1]);
    // free segments of the strip after removing the obstacles that touch it
    let segs: [number, number][] = right > left ? [[left, right]] : [];
    for (const k of blocks) {
      if (k.v1 <= vLo || k.v0 >= vHi) continue;
      segs = segs.flatMap(([s0, s1]) => {
        if (k.u1 <= s0 || k.u0 >= s1) return [[s0, s1] as [number, number]];
        const parts: [number, number][] = [];
        if (k.u0 > s0) parts.push([s0, k.u0]);
        if (k.u1 < s1) parts.push([k.u1, s1]);
        return parts;
      });
    }
    let col = 0;
    for (const [s0, s1] of segs) {
      const len = s1 - s0;
      const n = Math.floor((len + gap) / (pw + gap) + 1e-9);
      if (n < 1) continue;
      const start = s0 + (len - (n * pw + (n - 1) * gap)) / 2;
      for (let c = 0; c < n; c++) {
        const u0 = start + c * (pw + gap);
        out.push({ uv: [u0, vLo, u0 + pw, vHi], row, col: col++ });
      }
    }
  }
  return out;
}

/** Lays out PV modules on the faces of the roof planes selected by `spec.layout.facings`. */
export function layoutPv(faces: RoofFace[], spec: PvSpec, obstacles: Obstacle[] = []): PvLayout {
  const panels: PvPanel[] = [];
  const byFace: PvLayout["byFace"] = [];
  const { module: mod, layout } = spec;
  let counter = 0;
  for (const face of faces) {
    if (!layout.facings.includes(face.side)) continue;
    const offsets = face.edges.map((e) => (e.kind === "seam" ? 0 : layout.setback[e.kind]));
    const usable = insetConvex(face.uv, offsets);
    if (!usable) continue;
    // obstacles in the (u, v) frame of the face
    const { origin, u, v } = face.frame;
    const blocks = obstacles.flatMap((o) => {
      const zc = faceZ(face, o.x, o.y);
      const d: Pt3 = [o.x - origin[0], o.y - origin[1], zc - origin[2]];
      const uc = d[0] * u[0] + d[1] * u[1] + d[2] * u[2];
      const vc = d[0] * v[0] + d[1] * v[1] + d[2] * v[2];
      const rho = o.radius + layout.obstacleClearance;
      return [{ u0: uc - rho, u1: uc + rho, v0: vc - rho, v1: vc + rho }];
    });
    const tryOrientation = (orientation: "portrait" | "landscape"): Placed[] => {
      const pw = orientation === "portrait" ? mod.width : mod.height;
      const ph = orientation === "portrait" ? mod.height : mod.width;
      return layoutFace(usable, pw, ph, layout.gap, blocks);
    };
    let orientation: "portrait" | "landscape" = layout.orientation === "landscape" ? "landscape" : "portrait";
    let placed = tryOrientation(orientation);
    if (layout.orientation === "auto") {
      const alt = tryOrientation("landscape");
      if (alt.length > placed.length) {
        placed = alt;
        orientation = "landscape";
      }
    }
    const rowCount = placed.length ? Math.max(...placed.map((p) => p.row)) + 1 : 0;
    const rows: number[] = Array.from({ length: rowCount }, () => 0);
    for (const p of placed) rows[p.row] += 1;
    for (const p of placed) {
      const [u0, v0, u1, v1] = p.uv;
      const at = (uu: number, vv: number): Pt3 => [
        origin[0] + uu * u[0] + vv * v[0],
        origin[1] + uu * u[1] + vv * v[1],
        origin[2] + uu * u[2] + vv * v[2],
      ];
      counter++;
      panels.push({
        id: `PV${String(counter).padStart(2, "0")}`,
        plane: face.plane,
        face: face.id,
        row: p.row,
        col: p.col,
        wp: mod.wp,
        uv: p.uv,
        center: at((u0 + u1) / 2, (v0 + v1) / 2),
        corners: [at(u0, v0), at(u1, v0), at(u1, v1), at(u0, v1)],
      });
    }
    byFace.push({ face: face.id, plane: face.plane, orientation, count: placed.length, rows });
  }
  const count = panels.length;
  return { moduleWp: mod.wp, panels, count, kwp: (count * mod.wp) / 1000, area: count * mod.width * mod.height, byFace };
}

function faceZ(face: RoofFace, x: number, y: number): number {
  const n = face.frame.n;
  const p = face.pts3[0];
  return p[2] - (n[0] * (x - p[0]) + n[1] * (y - p[1])) / n[2];
}
