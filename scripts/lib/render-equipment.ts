// PV modules, external blinds (geometry and the state rule), timber slat screens and lamps for the render inputs.
// Inputs are the kernel's derived data (derive(house)); nothing here re-derives geometry.
import { clearSkyDni, sunVector } from "./solar";
import { facadeVectors, type WorldContext } from "./render-world";
import type { Vec3 } from "./render-schema";
import type { BlindState, SunInfo } from "./render-types";

const DEG = 180 / Math.PI;
const RAD = Math.PI / 180;
const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

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

export interface BlindItem {
  openingId: string;
  kind: string;
  room: string | null;
  dir: string | null;
  azimuthHouseDeg: number;
  azimuthTrueDeg: number;
  normal: Vec3;
  along: Vec3;
  width: number;
  sill: number;
  head: number;
  height: number;
  faceCenter: Vec3;
  box: { center: Vec3; size: Vec3 };
}

export function buildBlinds({ house, derived, cfg }: WorldContext) {
  const rule = house.shading.blinds;
  const items: BlindItem[] = [];
  for (const o of derived.openings) {
    if (!o.blind || o.azimuth == null || o.center == null) continue;
    const wall = derived.walls.find((w) => w.id === o.wallId);
    const t = wall?.t ?? derived.wall.ext;
    const { normal, along } = facadeVectors(o.azimuth);
    const face: Vec3 = [o.center[0] + normal[0] * (t / 2), o.center[1] + normal[1] * (t / 2), o.center[2]];
    const boxZ = o.head + rule.boxHeight / 2;
    const boxOut = cfg.blinds.boxDepth / 2;
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
      height: o.head - o.sill,
      faceCenter: face,
      box: { center: [face[0] + normal[0] * boxOut, face[1] + normal[1] * boxOut, boxZ], size: [o.w + 2 * cfg.blinds.railWidth, cfg.blinds.boxDepth, rule.boxHeight] },
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
    details: { ...cfg.blinds },
    items,
  };
}

/** State of every blind for a sun position and a request. The rule is documented in docs/RENDER-INPUTS.md, section 6. */
export function blindStates(
  items: readonly BlindItem[],
  rule: { closeAboveIrradiance: number },
  details: { maxDrop: number; cutoffMarginDeg: number; closedSlatAngleDeg: number },
  sun: SunInfo,
  request: "auto" | "open" | "closed",
): BlindState[] {
  const dni = clearSkyDni(sun.elevationDeg);
  const s = sunVector(sun.azimuthHouseDeg, sun.elevationDeg);
  return items.map((b) => {
    const cos = Math.max(0, b.normal[0] * s[0] + b.normal[1] * s[1]);
    const irradiance = dni * cos;
    if (request === "open") return { drop: 0, slatAngleDeg: 0, irradiance: round(irradiance) };
    if (request === "closed") return { drop: details.maxDrop, slatAngleDeg: details.closedSlatAngleDeg, irradiance: round(irradiance) };
    if (sun.elevationDeg <= 0 || irradiance <= rule.closeAboveIrradiance) return { drop: 0, slatAngleDeg: 0, irradiance: round(irradiance) };
    // profile angle of the sun on the facade, then the slat tilt that cuts it off (plus a margin)
    const cosGamma = Math.max(0.05, cos / Math.max(1e-6, Math.cos(sun.elevationDeg * RAD)));
    const profile = Math.atan(Math.tan(sun.elevationDeg * RAD) / cosGamma) * DEG;
    return { drop: details.maxDrop, slatAngleDeg: round(clamp(profile + details.cutoffMarginDeg, 15, 80)), irradiance: round(irradiance) };
  });
}

const round = (v: number): number => Math.round(v * 10) / 10;

export function buildScreens({ house, derived }: WorldContext) {
  const s = house.shading.slats;
  return derived.screens.map((sc) => ({
    orient: sc.orient,
    from: (sc.orient === "v" ? [sc.at, sc.from] : [sc.from, sc.at]) as [number, number],
    to: (sc.orient === "v" ? [sc.at, sc.to] : [sc.to, sc.at]) as [number, number],
    length: sc.length,
    azimuthHouseDeg: sc.azimuth,
    baseZ: 0,
    height: house.clearHeight,
    slat: { pitch: s.pitch, width: s.width, depth: s.depth, count: Math.floor(sc.length / s.pitch) },
  }));
}
