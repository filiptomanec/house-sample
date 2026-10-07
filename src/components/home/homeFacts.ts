// The facts the start page states about the house, all taken from the model (house, derived, metrics) and the plot area. Pure; the
// page translates and formats them. Nothing is branched on an id: rooms are grouped by their zone, openings by their kind, roofs
// by their height.

import type { Dir, ZoneKey } from "@/lib/model/catalog";
import type { Derived, House, LocalizedText, Metrics } from "@/lib/model/types";

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

export interface HomeFacts {
  /** Net floor area of the heated rooms (garage excluded), m2. */
  netArea: number;
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
}

const facadeOf = (derived: Derived, kind: "garage" | "entry"): Dir | null => {
  const o = derived.openings.find((x) => x.kind === kind && x.exterior);
  return o?.dir ?? null;
};

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
  return {
    netArea: metrics.netArea,
    roomCount: metrics.roomCount,
    footprint: { w: metrics.footprintBBox.w, d: metrics.footprintBBox.d },
    plotArea,
    zones,
    zoneOfRoom,
    roof: main ? { pitchDeg: main.pitch, overhang: main.overhang, ridgeHeight: main.ridgeHeight } : null,
    terrace: { area: metrics.terraceCovered + metrics.terraceUncovered, covered: metrics.terraceCovered },
    garage: metrics.garageArea > 0 ? { area: metrics.garageArea, side: facadeOf(derived, "garage") } : null,
    entrySide: facadeOf(derived, "entry"),
  };
}
