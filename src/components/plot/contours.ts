// Contour lines of the plot map: marching squares on the analytic terrain, converted to SVG path data in drawing units.
// Pure; the terrain is a function of the site parameters, so the client rebuilds the lines instead of receiving them.
import { contourLabels, contourLines, type Contour, type ContourLabel } from "@/lib/model/site/contours";
import { bboxOf, expandBbox, type XY } from "@/lib/model/site/geometry";
import type { Terrain } from "@/lib/model/site/terrain";
import { K } from "./labels";

export interface ContourPath { level: number; major: boolean; d: string }

/** Path data ("M x y L ...") in drawing units with one decimal (1 cm). */
export function pathData(points: readonly XY[], closed: boolean): string {
  const f = (v: number) => (Math.round(v * K * 10) / 10).toString();
  return points.map((p, i) => `${i ? "L" : "M"}${f(p[0])} ${f(-p[1])}`).join("") + (closed ? "Z" : "");
}

export interface ContourSet {
  lines: Contour[];
  paths: ContourPath[];
  /** Candidate labels (house-frame metres), several per long line; the map keeps the ones that fit. */
  labels: ContourLabel[];
}

/**
 * Contours every `minor` metres (0.2) with every fifth one marked major, over the plot and `reach` metres around it.
 * `format` turns a relative level into text (localised, signed).
 */
export function buildContours(terrain: Terrain, plot: readonly XY[], reach: number, format: (relativeLevel: number) => string, step = 0.5): ContourSet {
  const grid = terrain.grid(expandBbox(bboxOf(plot), reach), step);
  const lines = contourLines(grid, { minor: 0.2, major: 1 });
  return {
    lines,
    paths: lines.map((c) => ({ level: c.level, major: c.major, d: pathData(c.points, c.closed) })),
    labels: contourLabels(lines, { majorSpacing: 22, minorSpacing: 22, minSeparation: 5, minLength: 6, format: (rel) => format(rel) }),
  };
}
