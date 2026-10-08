// PV modules, external blinds (geometry and the state rule), the turning louvre walls (geometry and the angle rule) for the
// render inputs. Inputs are the kernel's derived data (derive(house, { site })); nothing here re-derives geometry.
import { overhangShadedFraction } from "../../src/lib/calc/sun";
import { clearSkyDni, sunVector } from "./solar";
import { facadeVectors, type WorldContext } from "./render-world";
import type { BlindsRequest, RenderConfig, ScreensRequest, Vec3 } from "./render-schema";
import type { BlindState, ScreenState, SunInfo } from "./render-types";

const DEG = 180 / Math.PI;
const RAD = Math.PI / 180;
const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
const round1 = (v: number): number => Math.round(v * 10) / 10;
const r4 = (v: number): number => Math.round(v * 1e4) / 1e4 + 0;
const r4v = (v: readonly number[]): Vec3 => [r4(v[0]), r4(v[1]), r4(v[2])];

export function buildPv({ house, derived, cfg }: WorldContext) {
  const m = house.equipment.pv.module;
  return {
    moduleWp: derived.pv.moduleWp,
    width: m.width,
    height: m.height,
    thickness: cfg.pv.thicknessM,
    frame: cfg.pv.frameM,
    standoff: cfg.pv.standoffM,
    count: derived.pv.count,
    kwp: derived.pv.kwp,
    panels: derived.pv.panels.map((p) => {
      const face = derived.roofPlanes.find((f) => f.id === p.face);
      if (!face) throw new Error(`PV panel ${p.id} refers to unknown roof face ${p.face}`);
      return { plane: p.plane, face: p.face, wp: p.wp, corners: p.corners, center: p.center, normal: face.frame.n as Vec3 };
    }),
  };
}

// ------------------------------------------------------------------------------------------------ external blinds

export interface BlindItem {
  openingId: string;
  kind: string;
  room: string | null;
  dir: string | null;
  azimuthHouseDeg: number;
  azimuthTrueDeg: number;
  /** Outward unit normal and the unit vector along the facade (to the right seen from outside). */
  normal: Vec3;
  along: Vec3;
  width: number;
  sill: number;
  head: number;
  height: number;
  /** Middle of the opening on the outer wall face at mid height. */
  faceCenter: Vec3;
  /** Middle of the blind plane: `product.reveal` behind the outer face, at mid height. */
  planeCenter: Vec3;
  /** Sections side by side (`derived.openings[].blindSections`, at most `product.maxSectionWidth` wide), with shared middle rails. */
  sections: { center: Vec3; width: number }[];
  /** The headrail box, hidden in the wall above the head (only a dark slot shows under the lintel). */
  box: { center: Vec3; size: Vec3; hidden: true };
  /** The roof edge above the opening (`derived.openings[].overhang`): horizontal depth beyond the face and its height. */
  overhang: { depth: number; eaveHeight: number } | null;
}

export function buildBlinds({ house, derived, cfg }: WorldContext) {
  const rule = house.shading.blinds;
  const product = rule.product;
  const items: BlindItem[] = [];
  for (const o of derived.openings) {
    if (!o.blind || o.azimuth == null || o.center == null) continue;
    const wall = derived.walls.find((w) => w.id === o.wallId);
    const t = wall?.t ?? derived.wall.ext;
    const { normal, along } = facadeVectors(o.azimuth);
    const face: Vec3 = [o.center[0] + normal[0] * (t / 2), o.center[1] + normal[1] * (t / 2), o.center[2]];
    const plane: Vec3 = [face[0] - normal[0] * product.reveal, face[1] - normal[1] * product.reveal, face[2]];
    const n = Math.max(1, o.blindSections || 1);
    const sw = o.w / n;
    const sections = Array.from({ length: n }, (_, i) => {
      const off = -o.w / 2 + sw * (i + 0.5);
      return { center: r4v([plane[0] + along[0] * off, plane[1] + along[1] * off, plane[2]]), width: r4(sw) };
    });
    const boxIn = product.boxDepth / 2;
    items.push({
      openingId: o.id,
      kind: o.kind,
      room: o.room,
      dir: o.dir,
      azimuthHouseDeg: o.azimuth,
      azimuthTrueDeg: o.azimuthTrue ?? (o.azimuth + derived.houseAxisBearingDeg) % 360,
      normal,
      along,
      width: o.w,
      sill: o.sill,
      head: o.head,
      height: r4(o.head - o.sill),
      faceCenter: r4v(face),
      planeCenter: r4v(plane),
      sections,
      box: { center: r4v([face[0] - normal[0] * boxIn, face[1] - normal[1] * boxIn, o.head + rule.boxHeight / 2]), size: [r4(o.w + 2 * product.railWidth), product.boxDepth, rule.boxHeight], hidden: true },
      overhang: o.overhang ? { depth: o.overhang.depth, eaveHeight: o.overhang.eaveHeight } : null,
    });
  }
  return {
    rule: {
      kinds: rule.kinds,
      azimuthFrom: rule.azimuthFrom,
      azimuthTo: rule.azimuthTo,
      boxHeight: rule.boxHeight,
      closedFactor: rule.closedFactor,
      closeAboveIrradiance: rule.closeAboveIrradiance,
    },
    /** The one product of house.json plus the state rule of render.json (the old key names are kept). */
    details: {
      boxDepth: product.boxDepth,
      railWidth: product.railWidth,
      railDepth: product.railDepth,
      slatPitch: product.slatPitch,
      slatWidth: product.slatWidth,
      slatThickness: product.slatThickness,
      reveal: product.reveal,
      maxSectionWidth: product.maxSectionWidth,
      autoDrop: cfg.blinds.autoDrop,
      maxDrop: cfg.blinds.maxDrop,
      cutoffMarginDeg: cfg.blinds.cutoffMarginDeg,
      closedSlatAngleDeg: cfg.blinds.closedSlatAngleDeg,
      tilt: "outer-edge-down" as const,
    },
    items,
  };
}

export type BlindDetails = ReturnType<typeof buildBlinds>["details"];

/**
 * Profile angle of the sun on a facade (degrees above the horizontal, measured in the vertical plane of the facade normal).
 * Null when the sun is behind the facade or below the horizon.
 */
export function profileAngle(normal: Vec3, sun: Pick<SunInfo, "azimuthHouseDeg" | "elevationDeg">): number | null {
  if (sun.elevationDeg <= 0) return null;
  const s = sunVector(sun.azimuthHouseDeg, 0);
  const cosGamma = normal[0] * s[0] + normal[1] * s[1];
  if (cosGamma <= 1e-6) return null;
  return Math.atan(Math.tan(sun.elevationDeg * RAD) / cosGamma) * DEG;
}

/**
 * Slat tilt (degrees from horizontal, the outer edge DOWN) at which slats of `width` at `pitch` just cut off direct sun with
 * the profile angle `alpha`: beta = asin(pitch * cos(alpha) / width) - alpha, never below 0 (horizontal slats).
 */
export function cutoffTilt(alphaDeg: number, pitch: number, width: number): number {
  const a = alphaDeg * RAD;
  return Math.max(0, Math.asin(Math.min(1, (pitch * Math.cos(a)) / width)) * DEG - alphaDeg);
}

/** Direct irradiance on the sunlit part of the glazing (W/m2): clear-sky DNI x cos(incidence) x (1 - shaded share by the roof edge). */
export function effectiveIrradiance(b: Pick<BlindItem, "normal" | "azimuthTrueDeg" | "sill" | "head" | "overhang">, sun: SunInfo): number {
  if (sun.elevationDeg <= 0) return 0;
  const s = sunVector(sun.azimuthHouseDeg, sun.elevationDeg);
  const cos = Math.max(0, b.normal[0] * s[0] + b.normal[1] * s[1]);
  if (cos <= 0) return 0;
  const shaded = overhangShadedFraction({ azimuthTrue: b.azimuthTrueDeg, sill: b.sill, head: b.head, overhang: b.overhang }, { azimuth: sun.azimuthTrueDeg, altitude: sun.elevationDeg });
  return clearSkyDni(sun.elevationDeg) * cos * (1 - shaded);
}

/**
 * State of every blind for a sun position and a request (docs/RENDER-INPUTS.md, section 6). `auto`: a blind goes down to
 * `autoDrop` with the slats at the cut-off tilt (plus the margin) when its sunlit glazing gets more than
 * `closeAboveIrradiance`; otherwise it stays up. A blind deep under a covering roof therefore stays up.
 */
export function blindStates(
  items: readonly BlindItem[],
  rule: { closeAboveIrradiance: number },
  details: Pick<BlindDetails, "autoDrop" | "maxDrop" | "cutoffMarginDeg" | "closedSlatAngleDeg" | "slatPitch" | "slatWidth">,
  sun: SunInfo,
  request: BlindsRequest,
): BlindState[] {
  return items.map((b) => {
    const irradiance = round1(effectiveIrradiance(b, sun));
    if (typeof request === "object") return { drop: request.drop, slatAngleDeg: request.slatAngleDeg, irradiance };
    if (request === "open") return { drop: 0, slatAngleDeg: 0, irradiance };
    if (request === "closed") return { drop: details.maxDrop, slatAngleDeg: details.closedSlatAngleDeg, irradiance };
    const alpha = profileAngle(b.normal, sun);
    if (alpha === null || irradiance <= rule.closeAboveIrradiance) return { drop: 0, slatAngleDeg: 0, irradiance };
    const tilt = clamp(cutoffTilt(alpha, details.slatPitch, details.slatWidth) + details.cutoffMarginDeg, 0, details.closedSlatAngleDeg);
    return { drop: details.autoDrop, slatAngleDeg: round1(tilt), irradiance };
  });
}

// ------------------------------------------------------------------------------------------------ louvre walls

export interface ScreenItem {
  id: string;
  orient: "h" | "v";
  from: [number, number];
  to: [number, number];
  length: number;
  azimuthHouseDeg: number;
  /** Outward unit normal of the wall and the unit vector of the wall axis (from `from` to `to`). */
  normal: Vec3;
  axis: Vec3;
  baseZ: number;
  height: number;
  blades: { count: number; pitch: number; chord: number; thickness: number; positions: number[] };
  closedDeg: number;
  openDeg: number;
  restDeg: number;
  /** Deprecated summary of the blades (pitch, thickness, chord, count), kept for older readers. */
  slat: { pitch: number; width: number; depth: number; count: number };
}

/**
 * The louvre walls. A blade turns about its vertical centre line; at angle `a` its chord points along the wall axis turned
 * counterclockwise (seen from above) by `a`: 0 = in the wall plane, `closedDeg` = neighbours touch, 90 = square to the wall.
 * This is the sense of the web model (src/lib/three), so both show the same blades.
 */
export function buildScreens({ derived }: WorldContext): ScreenItem[] {
  return derived.screens.map((sc) => {
    const axis: Vec3 = sc.orient === "v" ? [0, 1, 0] : [1, 0, 0];
    const { normal } = facadeVectors(sc.azimuth);
    return {
      id: sc.id,
      orient: sc.orient,
      from: (sc.orient === "v" ? [sc.at, sc.from] : [sc.from, sc.at]) as [number, number],
      to: (sc.orient === "v" ? [sc.at, sc.to] : [sc.to, sc.at]) as [number, number],
      length: sc.length,
      azimuthHouseDeg: sc.azimuth,
      normal,
      axis,
      baseZ: sc.z0,
      height: r4(sc.z1 - sc.z0),
      blades: { count: sc.blades.count, pitch: sc.blades.pitch, chord: sc.blades.chord, thickness: sc.blades.thickness, positions: [...sc.blades.positions] },
      closedDeg: sc.closedDeg,
      openDeg: sc.openDeg,
      restDeg: sc.restDeg,
      slat: { pitch: sc.blades.pitch, width: sc.blades.thickness, depth: sc.blades.chord, count: sc.blades.count },
    };
  });
}

/** Do blades of this wall at `angleDeg` stop a horizontal ray towards `s` (unit vector towards the sun, horizontal part)? */
export function bladesBlock(sc: Pick<ScreenItem, "axis" | "blades">, angleDeg: number, s: [number, number]): boolean {
  const a = sc.axis;
  const cross = a[0] * s[1] - a[1] * s[0];
  const dotAS = a[0] * s[0] + a[1] * s[1];
  const t = angleDeg * RAD;
  // chord direction b = a cos t + a_perp sin t; |b x s| = |cross cos t - dot sin t|
  const bladeSpan = sc.blades.chord * Math.abs(cross * Math.cos(t) - dotAS * Math.sin(t));
  return bladeSpan >= sc.blades.pitch * Math.abs(cross) - 1e-9;
}

/** The most open blade angle (whole degrees, in [closedDeg, openDeg]) that still stops the direct sun; openDeg without direct sun. */
export function screenCutoff(sc: ScreenItem, sun: Pick<SunInfo, "azimuthHouseDeg" | "elevationDeg">): number {
  if (sun.elevationDeg <= 0) return sc.openDeg;
  const s3 = sunVector(sun.azimuthHouseDeg, 0);
  if (sc.normal[0] * s3[0] + sc.normal[1] * s3[1] <= 1e-6) return sc.openDeg;
  for (let a = sc.openDeg; a >= sc.closedDeg; a -= 1) if (bladesBlock(sc, a, [s3[0], s3[1]])) return a;
  return sc.closedDeg;
}

/** Angle of every louvre wall for a sun position and a request (`auto` = the cut-off angle). */
export function screenStates(screens: readonly ScreenItem[], sun: SunInfo, request: ScreensRequest): ScreenState {
  const items = screens.map((sc) => {
    let a: number;
    if (typeof request === "object") a = clamp(request.angleDeg, sc.closedDeg, sc.openDeg);
    else if (request === "open") a = sc.openDeg;
    else if (request === "closed") a = sc.closedDeg;
    else if (request === "rest") a = sc.restDeg;
    else a = screenCutoff(sc, sun);
    return { angleDeg: a };
  });
  return { mode: typeof request === "object" ? "custom" : request, angleDeg: items[0]?.angleDeg ?? 90, items };
}

export type { RenderConfig };
