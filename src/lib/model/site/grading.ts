// Levels of the hard surfaces of the house: every outdoor slab has a planar top. Terrace, paving, deck and pool coping are
// flat at `outdoor[].top`; the driveway and the walkway (the strips the site extends to the street) are ramps from their top
// at the house end to the ground at the gate. The slabs then cut the terrain (createTerrain), so the ground follows the ramps
// and never covers a slab. The pipeline reads the result from derived.json (`outdoor[].grade`) and never computes levels.
import { DEFAULT_OUTDOOR_TOP } from "../catalog";
import { rectToPolygon, type Rect, type XY } from "./geometry";
import type { AccessGeometry } from "./layout";
import type { AccessKind } from "./siteSchema";
import type { OutdoorInput } from "./stats";
import { planeZ, type GroundSlab, type SlabPlane } from "./terrain";

/** At the gate the top of a ramp stands this far above the graded ground (m), a low edge towards the street. */
export const RAMP_GATE_RISE = 0.03;
/** Steepest allowed ramp (rise / run); steeper ramps are an error of validateSiteWithHouse (E-RAMP). */
export const RAMP_MAX_SLOPE = 0.08;

export interface RampGrade {
  access: AccessKind;
  /** The ramp rises along +y (towards the street): from the house end of the strip to the gate. */
  axis: "y";
  from: number;
  to: number;
  /** Slab top at the house end (= `outdoor[].top`) and at the gate (= ground at the gate + RAMP_GATE_RISE), m. */
  z0: number;
  z1: number;
  /** dz / dy (positive: rising towards the street). */
  slope: number;
  /** Centre of the crossing on the plot boundary and the graded ground there (before the slabs are cut in). */
  gate: XY;
  groundAtGate: number;
  /** The apron from the end of the strip to the plot boundary, on the same plane: polygon and the top at its vertices. */
  apron: { polygon: XY[]; z: number[] } | null;
}

export interface OutdoorGrade {
  kind: "flat" | "ramp";
  /** `outdoor[].top` resolved (the top at the house end for a ramp), m. */
  top: number;
  plane: SlabPlane;
  /** Top at the corners of the rect: [x0 y0, x1 y0, x1 y1, x0 y1] (counter-clockwise from the south-west), or at the polygon vertices. */
  corners: number[];
  ramp: RampGrade | null;
}

export interface Grading {
  /** One grade per outdoor area (same order as the input). */
  grades: OutdoorGrade[];
  /** The slabs that cut the terrain: every outdoor footprint plus the access aprons. */
  slabs: GroundSlab[];
}

const footprint = (o: OutdoorInput): XY[] => (o.polygon ? o.polygon : o.rect ? rectToPolygon(o.rect) : []);

/**
 * Grades the outdoor areas of the house. `base` is the graded ground without slabs (terrain.baseAt). With `access`, the
 * driveway and walkway strips become ramps that end RAMP_GATE_RISE above the ground at their gate; without it every area is flat.
 */
export function gradeOutdoor(outdoor: readonly OutdoorInput[], base: (x: number, y: number) => number, access?: AccessGeometry): Grading {
  const ramps = new Map<number, { kind: AccessKind; rect: Rect; gate: XY; apron: XY[] }>();
  if (access) {
    ramps.set(access.driveIndex, { kind: "driveway", rect: access.driveRect, gate: access.driveGate.center, apron: access.driveApron });
    ramps.set(access.walkIndex, { kind: "walkway", rect: access.walkRect, gate: access.walkGate.center, apron: access.walkApron });
  }
  const grades: OutdoorGrade[] = [];
  const slabs: GroundSlab[] = [];
  outdoor.forEach((o, i) => {
    const top = o.top ?? DEFAULT_OUTDOOR_TOP;
    const poly = footprint(o);
    const r = ramps.get(i);
    if (r && r.gate[1] - r.rect[1] > 1e-6) {
      const y0 = r.rect[1];
      const groundAtGate = base(r.gate[0], r.gate[1]);
      const z1 = groundAtGate + RAMP_GATE_RISE;
      const slope = (z1 - top) / (r.gate[1] - y0);
      const plane: SlabPlane = { z0: top, ox: r.rect[0], oy: y0, gx: 0, gy: slope };
      const apron = r.apron.length ? { polygon: r.apron.map((p) => [p[0], p[1]] as XY), z: r.apron.map((p) => planeZ(plane, p[0], p[1])) } : null;
      grades.push({
        kind: "ramp",
        top,
        plane,
        corners: poly.map((p) => planeZ(plane, p[0], p[1])),
        ramp: { access: r.kind, axis: "y", from: y0, to: r.gate[1], z0: top, z1, slope, gate: [r.gate[0], r.gate[1]], groundAtGate, apron },
      });
      if (poly.length >= 3) slabs.push({ polygon: poly, plane });
      if (apron) slabs.push({ polygon: apron.polygon, plane });
      return;
    }
    const plane: SlabPlane = { z0: top, ox: 0, oy: 0, gx: 0, gy: 0 };
    grades.push({ kind: "flat", top, plane, corners: poly.map(() => top), ramp: null });
    if (poly.length >= 3) slabs.push({ polygon: poly, plane });
  });
  return { grades, slabs };
}
