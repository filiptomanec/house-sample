// Structural inputs the site code accepts from the house model. Deliberately independent of the house schema:
// any object with these fields works (derived.json outline / roofs / openings and house.json outdoor).
import type { Rect, XY } from "./geometry";
import type { OutdoorInput } from "./stats";

export interface RoofInput {
  /** Outer wall faces covered by this roof (house frame). */
  rect: Rect;
  /** Eave overhang beyond `rect` (m); missing = 0. */
  overhang?: number;
}

export interface OpeningInput {
  /** Opening kind as in the house model (`garage`, `entry`, `window`, ...). */
  kind: string;
  /** Centre on the wall axis. */
  cx: number;
  cy: number;
  /** Width (m). */
  w: number;
  /** Azimuth of the outward wall normal in the house frame, clockwise from +y (derived.json `azimuth`, null for interior openings). */
  azimuth?: number | null;
  /** True for openings in exterior walls (null / missing is treated as exterior when an azimuth is given). */
  exterior?: boolean | null;
}

export interface HouseInput {
  /** `location.houseAxisBearingDeg` from house.json. */
  bearingDeg: number;
  /** Outer wall outline (derived.json `outline.polygons[0].pts`). */
  footprint: XY[];
  /** Outdoor areas (house.json `outdoor[]`). */
  outdoor: OutdoorInput[];
  /** Roofs, for eaves clearances (house.json `roofs[]`). */
  roofs?: RoofInput[];
  /** Openings, for the free length in front of the garage door and the entrance. */
  openings?: OpeningInput[];
}
