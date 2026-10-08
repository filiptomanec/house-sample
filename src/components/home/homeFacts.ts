// The facts the start page states about the house, all taken from the model (house, derived, metrics) and the plot area. Pure; the
// page translates and formats them. Nothing is branched on an id: rooms are grouped by their zone, openings by their kind, roofs
// by their height, outdoor areas by their type. The orbit features carry the azimuth from which the orbit camera sees them best.

import type { Dir, ZoneKey } from "@/lib/model/catalog";
import type { Derived, House, LocalizedText, Metrics, Pt3 } from "@/lib/model/types";
import { azimuthOf } from "./timeline";

/** The zones of the start page: the three zones of the model's rooms and the terrace (the outdoor zone). */
export const ZONE_ORDER = ["day", "night", "service", "outdoor"] as const satisfies readonly ZoneKey[];
export type HomeZoneKey = (typeof ZONE_ORDER)[number];

/** Design token of the fill of a zone on the plan and in its legend. */
export const ZONE_TOKEN: Record<HomeZoneKey, string> = {
  day: "--zone-day", night: "--zone-night", service: "--zone-service", outdoor: "--zone-terrace",
};

export interface HomeZone {
  key: HomeZoneKey;
  /** Label from the model for the room zones; null for the terrace (the page's dictionary names it). */
  label: LocalizedText | null;
  /** Net floor area, m2 (for the outdoor zone: the terraces). */
  area: number;
}

/** The features of the house the orbit captions name, in no particular order (the page sorts them by the camera's path). */
export const ORBIT_FEATURES = ["terrace", "roof", "entry", "garage", "pool"] as const;
export type OrbitFeatureKey = (typeof ORBIT_FEATURES)[number];

/**
 * The word the render pipeline uses for each feature (render.json `orbit.captions.features`, the media manifest's
 * `orbit.captions[].feature`): the roof caption is about the roof plane that carries the panels.
 */
export const RENDER_FEATURE_WORD: Record<OrbitFeatureKey, string> = { terrace: "terrace", roof: "pv", entry: "entry", garage: "garage", pool: "pool" };

/**
 * When the media manifest does not give the caption azimuths, the orbit radius is estimated as this many diagonals of the
 * building's plan box (the render pipeline fits the camera round the building frame by frame, scripts/lib/render-shots.ts).
 */
export const ORBIT_RADIUS_PER_DIAGONAL = 1.1;

export interface OrbitFeature {
  key: OrbitFeatureKey;
  /**
   * House azimuth (degrees clockwise from +y) from which the orbit camera sees the feature best, seen from the orbit centre,
   * by the rule of the render pipeline (render-features.ts bestAzimuth): straight at a free-standing area, and for a facade or
   * roof element the camera that stands on its outward normal at the orbit radius.
   */
  az: number;
  /** The outward normal (house azimuth) of the facade or roof plane the feature sits on; null for a free-standing area. */
  normal: number | null;
  /** Plan position of the feature (x, y), m. */
  at: [number, number];
}

export interface HomeFacts {
  /** Net floor area of the heated rooms (garage excluded), m2: metrics.netArea. */
  netArea: number;
  /** "Užitná plocha" of the glossary (docs/COPY.md): the net area of the heated rooms, m2 (metrics.heatedArea). */
  heatedArea: number;
  /** Czech layout code ("5+kk") and the number of bedrooms (BEDROOM_TYPES). */
  layoutCode: string;
  bedroomCount: number;
  roomCount: number;
  /** Outer dimensions of the footprint, m. */
  footprint: { w: number; d: number };
  plotArea: number;
  zones: HomeZone[];
  /** Fill zone of every room, keyed by room id (the id joins the model to the drawing; it is never branched on). */
  zoneOfRoom: Record<string, HomeZoneKey>;
  /** The roof that reaches the highest ridge. */
  roof: { pitchDeg: number; overhang: number; ridgeHeight: number } | null;
  terrace: { area: number; covered: number };
  /** Garage floor area and the facade its door faces (house-frame direction). */
  garage: { area: number; side: Dir | null } | null;
  /** Facade of the main entrance. */
  entrySide: Dir | null;
  /** The louvre wall of the terrace (any slat screen). */
  louvres: boolean;
  /** Photovoltaics on the roof: module count and installed power. */
  pv: { count: number; kwp: number } | null;
  /** The pool: water area (m2) and depth (m). */
  pool: { area: number; depth: number } | null;
  /** A driveway that runs out to a gate (a graded ramp ends at its gate). */
  driveToGate: boolean;
  /** Centre of the orbit: the middle of the building's plan box (the render pipeline aims the orbit camera there). */
  orbitCentre: [number, number];
  /** Estimated horizontal distance of the orbit camera (ORBIT_RADIUS_PER_DIAGONAL), m. */
  orbitRadius: number;
  /** What the orbit can name, with the azimuth of its best view. */
  features: OrbitFeature[];
}

const facadeOf = (derived: Derived, kind: "garage" | "entry"): Dir | null => {
  const o = derived.openings.find((x) => x.kind === kind && x.exterior);
  return o?.dir ?? null;
};

const rectCentre = (r: readonly [number, number, number, number]): [number, number] => [(r[0] + r[2]) / 2, (r[1] + r[3]) / 2];
const meanXY = (pts: readonly Pt3[]): [number, number] =>
  [pts.reduce((s, p) => s + p[0], 0) / pts.length, pts.reduce((s, p) => s + p[1], 0) / pts.length];
const largest = <T extends { area: number }>(xs: readonly T[]): T | undefined => xs.reduce<T | undefined>((b, x) => (!b || x.area > b.area ? x : b), undefined);

/** The orbit radius estimated from the building's plan box (ORBIT_RADIUS_PER_DIAGONAL). */
export const orbitRadiusOf = (b: Derived["bbox"]): number => ORBIT_RADIUS_PER_DIAGONAL * Math.hypot(b.x1 - b.x0, b.y1 - b.y0);

/** The best view of a feature from an orbit of this radius round `centre` (the rule of OrbitFeature.az). */
export function bestViewAzimuth(centre: readonly [number, number], at: readonly [number, number], normal: number | null, radius: number): number {
  if (normal === null) return azimuthOf(centre, at);
  const n = (normal * Math.PI) / 180;
  return azimuthOf(centre, [at[0] + Math.sin(n) * radius, at[1] + Math.cos(n) * radius]);
}

/** The orbit features the model has: by outdoor type, opening kind and the roof face that carries the panels. */
export function orbitFeatures(derived: Derived, centre: [number, number], radius: number = orbitRadiusOf(derived.bbox)): OrbitFeature[] {
  const out: OrbitFeature[] = [];
  const add = (key: OrbitFeatureKey, at: [number, number], normal: number | null) => {
    out.push({ key, at, normal, az: bestViewAzimuth(centre, at, normal, radius) });
  };
  const terrace = largest(derived.outdoor.filter((o) => o.type === "terrace"));
  if (terrace) add("terrace", rectCentre(terrace.rect), null);
  if (derived.pv.panels.length) {
    // the face with most panels gives the normal; the panels themselves give the position
    const counts = new Map<string, number>();
    for (const p of derived.pv.panels) counts.set(p.face, (counts.get(p.face) ?? 0) + 1);
    const face = [...counts].sort((a, b) => b[1] - a[1])[0][0];
    const plane = derived.roofPlanes.find((r) => r.id === face);
    add("roof", meanXY(derived.pv.panels.filter((p) => p.face === face).map((p) => p.center)), plane ? plane.azimuth : null);
  } else {
    const plane = largest(derived.roofPlanes);
    if (plane) add("roof", [plane.centroid[0], plane.centroid[1]], plane.azimuth);
  }
  for (const kind of ["entry", "garage"] as const) {
    const o = derived.openings.find((x) => x.kind === kind && x.exterior && x.center);
    if (o?.center) add(kind, [o.center[0], o.center[1]], o.azimuth);
  }
  const pool = largest(derived.outdoor.filter((o) => o.pool));
  if (pool?.pool) add("pool", rectCentre(pool.pool.water), null);
  return out;
}

export function homeFacts(house: Pick<House, "zones">, derived: Derived, metrics: Metrics, plotArea: number): HomeFacts {
  const zoneOfRoom: Record<string, HomeZoneKey> = {};
  const area: Record<HomeZoneKey, number> = { day: 0, night: 0, service: 0, outdoor: 0 };
  for (const r of derived.rooms) {
    zoneOfRoom[r.id] = r.zone;
    area[r.zone] += r.area;
  }
  area.outdoor = metrics.outdoorByType.terrace ?? 0;
  const zones: HomeZone[] = ZONE_ORDER.map((key) => ({
    key,
    label: key === "outdoor" ? null : house.zones[key].label,
    area: area[key],
  }));
  const main = derived.roofs.reduce<(typeof derived.roofs)[number] | null>((best, r) => (!best || r.ridgeHeight > best.ridgeHeight ? r : best), null);
  const b = derived.bbox;
  const orbitCentre: [number, number] = [(b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2];
  const pool = largest(derived.outdoor.filter((o) => o.pool));
  return {
    netArea: metrics.netArea,
    heatedArea: metrics.heatedArea,
    layoutCode: metrics.layoutCode,
    bedroomCount: metrics.bedroomCount,
    roomCount: metrics.roomCount,
    footprint: { w: metrics.footprintBBox.w, d: metrics.footprintBBox.d },
    plotArea,
    zones,
    zoneOfRoom,
    roof: main ? { pitchDeg: main.pitch, overhang: main.overhang, ridgeHeight: main.ridgeHeight } : null,
    terrace: { area: metrics.terraceCovered + metrics.terraceUncovered, covered: metrics.terraceCovered },
    garage: metrics.garageArea > 0 ? { area: metrics.garageArea, side: facadeOf(derived, "garage") } : null,
    entrySide: facadeOf(derived, "entry"),
    louvres: derived.screens.length > 0,
    pv: derived.pv.count > 0 ? { count: derived.pv.count, kwp: derived.pv.kwp } : null,
    pool: pool?.pool ? { area: pool.pool.waterArea, depth: pool.pool.depth } : null,
    driveToGate: derived.outdoor.some((o) => o.type === "drive" && o.grade.ramp !== null),
    orbitCentre,
    orbitRadius: orbitRadiusOf(b),
    features: orbitFeatures(derived, orbitCentre, orbitRadiusOf(b)),
  };
}
