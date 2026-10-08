// Pure logic of the Sun page (no React, no three.js): the days on offer, the time range of the slider, the rooms and outdoor
// areas to report, what is saved in the browser. Everything comes from the model; nothing here names a room or an opening.
import { HABITABLE, OUTDOOR_TYPE_NAMES, ROOM_TYPE_NAMES } from "@/lib/model/catalog";
import type { Derived, DerivedOutdoor, DerivedRoom, LocalizedText, OutdoorType, RoomType } from "@/lib/model/types";
import { daysInMonthOf, isValidDate, keyDays, type CalendarDate, type GeoPlace, type SunTimes } from "@/lib/calc/sun";
import { finiteIn } from "@/lib/calc/storageKeys";
import { LOCALE_META, type Locale } from "@/lib/i18n/config";
import { nb } from "@/lib/i18n/format";

/** The time slider moves in this many minutes and reaches this far beyond sunrise and sunset. */
export const TIME_STEP_MIN = 5;
export const TIME_MARGIN_MIN = 20;
/** Step of the ray-cast analysis, minutes; the chosen day and the year table use the same one, so equal dates give equal hours. */
export const ANALYSIS_STEP_MIN = 10;
/** The year table reports this day of every month. */
export const YEAR_TABLE_DAY = 21;
/** "Play the day": simulated minutes per second of real time. */
export const PLAY_MINUTES_PER_SECOND = 45;
/** ...and the shortest time between two steps of it, ms (about 30 a second). */
export const PLAY_FRAME_MS = 33;
/** With the system setting "reduce motion" the day advances in distinct steps this far apart, ms. */
export const PLAY_FRAME_REDUCED_MS = 400;
/** The first view of a day is this many hours after solar noon, when the shadows lie across the terrace. */
export const DEFAULT_HOURS_AFTER_NOON = 2;
const LAST_MINUTE = 1435;

export type PresetKey = "spring" | "summer" | "autumn" | "winter";

export interface DayPreset {
  key: PresetKey;
  date: CalendarDate;
}

/** The two equinoxes and two solstices of a year, in calendar order, found from the declination of the sun (not tabulated). */
export function presetDays(place: GeoPlace, year: number): DayPreset[] {
  const k = keyDays(place, year);
  return [
    { key: "spring", date: k.equinox },
    { key: "summer", date: k.summerSolstice },
    { key: "autumn", date: k.autumnEquinox },
    { key: "winter", date: k.winterSolstice },
  ].sort((a, b) => dayIndex(a.date) - dayIndex(b.date)) as DayPreset[];
}

const dayIndex = (d: CalendarDate) => d.month * 40 + d.day;
export const sameDate = (a: CalendarDate, b: CalendarDate) => a.year === b.year && a.month === b.month && a.day === b.day;

/** The preset a date is, or null for any other day. */
export function presetOf(date: CalendarDate, presets: readonly DayPreset[]): PresetKey | null {
  return presets.find((p) => sameDate(p.date, date))?.key ?? null;
}

/** "20. 3." / "20/03": a day for a button label, in the numeric style of the language. `month` is 0-based. */
export function shortDate(locale: Locale, month: number, day: number): string {
  return nb(new Intl.DateTimeFormat(LOCALE_META[locale].intl, { day: "numeric", month: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(2001, month, day))), locale);
}

/** "2026-03-20" for the date input; the month is 0-based in the model and 1-based in ISO. */
export function toIso(d: CalendarDate): string {
  return `${String(d.year).padStart(4, "0")}-${String(d.month + 1).padStart(2, "0")}-${String(d.day).padStart(2, "0")}`;
}

/** Reads the value of a date input; null for anything that is not a real day of `year`. */
export function parseIso(s: string, year: number): CalendarDate | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return null;
  const d = { year: Number(m[1]), month: Number(m[2]) - 1, day: Number(m[3]) };
  return d.year === year && isValidDate(d) ? d : null;
}

/** The same calendar day of another year; 29 February becomes 28 February in a year without one. */
export function inYear(d: CalendarDate, year: number): CalendarDate {
  return { year, month: d.month, day: Math.min(d.day, daysInMonthOf(year, d.month)) };
}

// ------------------------------------------------------------------------------------------------ time of day

export interface TimeRange {
  /** Minutes after local midnight. */
  min: number;
  max: number;
}

/** Sunrise - 20 minutes to sunset + 20 minutes in steps of 5. Polar day: the whole day. Polar night: a short window around noon. */
export function timeRange(t: SunTimes): TimeRange {
  const snap = (v: number, round: (x: number) => number) => round(v / TIME_STEP_MIN) * TIME_STEP_MIN;
  if (t.polar === "day") return { min: 0, max: LAST_MINUTE };
  if (t.sunrise === null || t.sunset === null) {
    const c = snap(t.solarNoon * 60, Math.round);
    return { min: Math.max(0, c - 120), max: Math.min(LAST_MINUTE, c + 120) };
  }
  return {
    min: Math.max(0, snap(t.sunrise * 60, Math.floor) - TIME_MARGIN_MIN),
    max: Math.min(LAST_MINUTE, snap(t.sunset * 60, Math.ceil) + TIME_MARGIN_MIN),
  };
}

/** A time inside the range, on the 5 minute grid. */
export function clampMinute(minute: number, range: TimeRange): number {
  const v = Math.round((Number.isFinite(minute) ? minute : range.min) / TIME_STEP_MIN) * TIME_STEP_MIN;
  return Math.min(range.max, Math.max(range.min, v));
}

/** First time shown for a day. */
export function defaultMinute(t: SunTimes): number {
  return clampMinute((t.solarNoon + DEFAULT_HOURS_AFTER_NOON) * 60, timeRange(t));
}

// ------------------------------------------------------------------------------------------------ rooms and areas

export interface RoomRow {
  id: string;
  type: RoomType;
  /** Both languages: the type name, or the room's own name when two shown rooms share a type. */
  label: LocalizedText;
}

const capital = (s: string) => s.charAt(0).toLocaleUpperCase() + s.slice(1);

/** The rooms worth reporting daylight for: habitable types with a glazed exterior opening, in model order, with short labels from the data. */
export function habitableRooms(derived: Pick<Derived, "rooms" | "openings">): RoomRow[] {
  const lit = new Set(derived.openings.filter((o) => o.exterior === true && o.glazingArea > 0 && o.room !== null).map((o) => o.room));
  const rooms = derived.rooms.filter((r) => HABITABLE.includes(r.type) && lit.has(r.id));
  const count = new Map<RoomType, number>();
  for (const r of rooms) count.set(r.type, (count.get(r.type) ?? 0) + 1);
  return rooms.map((r) => ({
    id: r.id,
    type: r.type,
    label: count.get(r.type) === 1
      ? { cs: capital(ROOM_TYPE_NAMES[r.type].cs), en: capital(ROOM_TYPE_NAMES[r.type].en) }
      : { cs: capital(r.name.cs), en: capital(r.name.en) },
  }));
}

/** The room the day chart follows: the one with the role "main-living", else the largest habitable room. */
export function mainRoom(derived: Pick<Derived, "rooms">): DerivedRoom | null {
  const byRole = derived.rooms.find((r) => r.role === "main-living");
  if (byRole) return byRole;
  return derived.rooms.filter((r) => HABITABLE.includes(r.type)).sort((a, b) => b.area - a.area)[0] ?? null;
}

export interface AreaRow {
  id: string;
  type: OutdoorType;
  covered: boolean;
  label: LocalizedText;
}

/** Said of a covered area that is not a terrace ("Zpevněná plocha (zastřešeno)"), so that it is not mistaken for open paving. */
const ROOFED: LocalizedText = { cs: "zastřešeno", en: "roofed" };

/** Terraces and covered areas (what the analysis reports), in model order; equal names get a number. */
export function sunAreas(derived: Pick<Derived, "outdoor">): AreaRow[] {
  const list: DerivedOutdoor[] = derived.outdoor.filter((a) => a.type === "terrace" || a.covered);
  const total = new Map<OutdoorType, number>();
  for (const a of list) total.set(a.type, (total.get(a.type) ?? 0) + 1);
  const seen = new Map<OutdoorType, number>();
  return list.map((a) => {
    const n = (seen.get(a.type) ?? 0) + 1;
    seen.set(a.type, n);
    const base = OUTDOOR_TYPE_NAMES[a.type];
    const suffix = (total.get(a.type) ?? 0) > 1 ? ` ${n}` : "";
    const roof = a.covered && a.type !== "terrace";
    return { id: a.id, type: a.type, covered: a.covered, label: { cs: `${base.cs}${suffix}${roof ? ` (${ROOFED.cs})` : ""}`, en: `${base.en}${suffix}${roof ? ` (${ROOFED.en})` : ""}` } };
  });
}

/** The area the chart and the headline follow: the first terrace, else the first area. */
export function primaryArea(areas: readonly AreaRow[]): AreaRow | null {
  return areas.find((a) => a.type === "terrace") ?? areas[0] ?? null;
}

// ------------------------------------------------------------------------------------------------ remembered settings

/** What the visitor chose, as kept in the browser and used as state. Shading values are in the units of the sliders (percent, degrees). */
export interface SunSettings {
  month: number;
  day: number;
  minute: number;
  /** Terrace slats: turn 0 (closed) to 90 degrees (edge-on), slide 0 (spread) to 100 percent (stacked). */
  slatAngle: number;
  slatSlide: number;
  /** Exterior blinds: drop 0 to 100 percent, slat tilt 0 (open) to 90 degrees (closed). */
  blindDrop: number;
  blindTilt: number;
}

export const SHADING_RANGE = {
  slatAngle: { min: 0, max: 90, step: 5 },
  slatSlide: { min: 0, max: 100, step: 5 },
  blindDrop: { min: 0, max: 100, step: 5 },
  blindTilt: { min: 0, max: 90, step: 5 },
} as const;

/** Slats half open, nothing lowered: the first impression shows the sun and some shade. */
export const DEFAULT_SHADING = { slatAngle: 60, slatSlide: 0, blindDrop: 0, blindTilt: 45 } as const;

/** Turns anything read from storage into complete valid settings for `year`, or null when there is no usable date. */
export function parseSettings(data: unknown, year: number): SunSettings | null {
  if (typeof data !== "object" || data === null) return null;
  const r = data as Record<string, unknown>;
  const date = { year, month: r.month as number, day: r.day as number };
  if (!isValidDate(date)) return null;
  const snap = (v: unknown, k: keyof typeof SHADING_RANGE) => {
    const { min, max, step } = SHADING_RANGE[k];
    return Math.round(finiteIn(v, min, max, DEFAULT_SHADING[k]) / step) * step;
  };
  return {
    month: date.month,
    day: date.day,
    minute: finiteIn(r.minute, 0, LAST_MINUTE, 12 * 60),
    slatAngle: snap(r.slatAngle, "slatAngle"),
    slatSlide: snap(r.slatSlide, "slatSlide"),
    blindDrop: snap(r.blindDrop, "blindDrop"),
    blindTilt: snap(r.blindTilt, "blindTilt"),
  };
}

// ------------------------------------------------------------------------------------------------ views

/**
 * The camera preset to open with: the perspective view that looks at the house from the side the midday sun comes from
 * (true south in the northern hemisphere), so the first picture shows the lit facade and the shadows on the terrace.
 * `views` carry scene-frame positions (x, y up, z = -north in the house frame); `centre` is the house centre in the house frame.
 */
export function sunnySideView<V extends { id: string; ortho: boolean; position: readonly [number, number, number] }>(
  views: readonly V[], bearingDeg: number, centre: readonly [number, number], southern = true,
): V | null {
  const a = ((southern ? 180 : 0) - bearingDeg) * (Math.PI / 180);
  const toSun = [Math.sin(a), Math.cos(a)];
  let best: V | null = null, bestScore = -Infinity;
  for (const v of views) {
    if (v.ortho) continue;
    const dx = v.position[0] - centre[0], dy = -v.position[2] - centre[1];
    const len = Math.hypot(dx, dy) || 1;
    const score = (dx * toSun[0] + dy * toSun[1]) / len;
    if (score > bestScore) { best = v; bestScore = score; }
  }
  return best;
}
