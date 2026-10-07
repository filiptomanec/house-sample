// Position of the sun (NOAA / Meeus), sunrise and sunset in any time zone with daylight saving, daily arcs for drawing,
// directions in the house frame and the analytic shading of a window by the roof overhang. Everything is parametrised by
// the place (`house.location`); nothing is hard-coded to a site or a time zone.
//
// Contract: docs/CALC-API.md, section 4. Pure, no DOM, no three.js, no text, no Date.now().
// Conventions: months are 0-based (like Date and src/lib/calendar.ts); azimuths are TRUE (degrees clockwise from true
// north) unless a name says `house`; altitudes in degrees above the horizon; clock times are decimal wall-clock hours.
import type { House } from "@/lib/model/types";

const RAD = Math.PI / 180;
const MS_HOUR = 3_600_000;
const MS_DAY = 86_400_000;

/** Place on Earth. `lat`/`lon` in degrees (north and east positive), `tz` an IANA name such as "Europe/Prague". */
export interface GeoPlace {
  lat: number;
  lon: number;
  tz: string;
}

/** A calendar day. `month` is 0-based (0 = January). Invalid combinations (30 February) make the functions throw RangeError. */
export interface CalendarDate {
  year: number;
  month: number;
  day: number;
}

/** Unit vector or direction in the house frame: [east (x), north (y), up (z)] as in docs/ARCHITECTURE.md. */
export type Vec3 = [number, number, number];

/** The place of the house: `house.location.lat/lon/tz`. */
export function placeOf(house: Pick<House, "location">): GeoPlace {
  const { lat, lon, tz } = house.location;
  return { lat, lon, tz };
}

const mod = (a: number, n: number) => ((a % n) + n) % n;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Longitude wrapped to (-180, 180]. */
const wrapLongitude = (lon: number) => {
  const w = mod(lon + 180, 360) - 180;
  return w === -180 ? 180 : w;
};

// ------------------------------------------------------------------------------------------------ calendar

/** Number of days in a month (`month` 0-based) of a Gregorian year. */
export function daysInMonthOf(year: number, month: number): number {
  return new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
}

/** Is this a real calendar day (integers, month 0..11, day within the month)? */
export function isValidDate(d: CalendarDate): boolean {
  return Number.isInteger(d.year) && Number.isInteger(d.month) && Number.isInteger(d.day)
    && d.month >= 0 && d.month <= 11 && d.day >= 1 && d.day <= daysInMonthOf(d.year, d.month);
}

function assertDate(d: CalendarDate): void {
  if (!isValidDate(d)) throw new RangeError(`sun: not a calendar day: ${d.year}-${d.month}-${d.day} (month is 0-based)`);
}

/** The calendar day `n` days after `d` (negative: before). */
export function addDays(d: CalendarDate, n: number): CalendarDate {
  const t = new Date(Date.UTC(d.year, d.month, d.day + n));
  return { year: t.getUTCFullYear(), month: t.getUTCMonth(), day: t.getUTCDate() };
}

function assertPlace(p: Pick<GeoPlace, "lat" | "lon">): void {
  if (!Number.isFinite(p.lat) || Math.abs(p.lat) > 90) throw new RangeError(`sun: latitude out of range: ${p.lat}`);
  if (!Number.isFinite(p.lon)) throw new RangeError(`sun: longitude is not finite: ${p.lon}`);
}

// ------------------------------------------------------------------------------------------------ time zones

export interface ZonedParts {
  year: number;
  /** 0-based. */
  month: number;
  day: number;
  /** 0..23 (never 24). */
  hour: number;
  minute: number;
  second: number;
}

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(tz: string): Intl.DateTimeFormat {
  let f = formatters.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: tz, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", second: "numeric",
    });
    formatters.set(tz, f);
  }
  return f;
}

/** Wall-clock parts of an instant in a time zone (Intl, `hourCycle: "h23"`). */
export function zonedParts(ms: number, tz: string): ZonedParts {
  if (!Number.isFinite(ms)) throw new RangeError(`sun: time is not finite: ${ms}`);
  const v: Record<string, number> = {};
  for (const p of formatterFor(tz).formatToParts(ms)) if (p.type !== "literal") v[p.type] = Number(p.value);
  return { year: v.year, month: v.month - 1, day: v.day, hour: v.hour % 24, minute: v.minute, second: v.second };
}

/** Offset of the time zone from UTC at an instant, hours (can be fractional: 5.5, 5.75). */
export function utcOffsetHours(ms: number, tz: string): number {
  const p = zonedParts(ms, tz);
  return (Date.UTC(p.year, p.month, p.day, p.hour, p.minute, p.second) - Math.floor(ms / 1000) * 1000) / MS_HOUR;
}

/**
 * UTC instant (ms) of a wall-clock time on a calendar day in a time zone. `hours` is decimal (6.5 = 6:30), default 0.
 * A time that does not exist (the hour skipped when the clocks go forward) maps to the instant just after the gap;
 * a time that occurs twice (clocks go back) maps to its first occurrence. Correct on the days of the change.
 */
export function localToUtc(tz: string, date: CalendarDate, hours = 0): number {
  assertDate(date);
  if (!Number.isFinite(hours)) throw new RangeError(`sun: hours is not finite: ${hours}`);
  const wall = Date.UTC(date.year, date.month, date.day) + hours * MS_HOUR; // the wall time read as if it were UTC
  // Offsets a day before and after bracket the (at most one) change near the wanted instant.
  const before = utcOffsetHours(wall - MS_DAY, tz);
  const after = utcOffsetHours(wall + MS_DAY, tz);
  const t1 = wall - before * MS_HOUR;
  if (before === after) return t1;
  const t2 = wall - after * MS_HOUR;
  const fits = (t: number) => Math.abs(t + utcOffsetHours(t, tz) * MS_HOUR - wall) < 1;
  const ok1 = fits(t1), ok2 = fits(t2);
  if (ok1 && ok2) return Math.min(t1, t2); // clocks went back: the wall time occurs twice, take the first
  if (ok1) return t1;
  if (ok2) return t2;
  // Clocks went forward and this wall time does not exist: the first instant with the new offset.
  let lo = Math.min(t1, t2), hi = Math.max(t1, t2);
  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2);
    if (utcOffsetHours(mid, tz) === before) lo = mid; else hi = mid;
  }
  return hi;
}

/**
 * For each month of a year the UTC offsets that occur at local noon of its days and the share of days with each offset
 * (shares of a month sum to 1). Lets hourly UTC data (PVGIS) be shifted to local time in the months of the change as a
 * mixture instead of guessing "winter" or "summer". Months without a change have one entry with share 1.
 */
export function monthOffsetMix(tz: string, year: number): { offset: number; share: number }[][] {
  const out: { offset: number; share: number }[][] = [];
  for (let month = 0; month < 12; month++) {
    const n = daysInMonthOf(year, month);
    const count = new Map<number, number>();
    for (let day = 1; day <= n; day++) {
      const o = utcOffsetHours(localToUtc(tz, { year, month, day }, 12), tz);
      count.set(o, (count.get(o) ?? 0) + 1);
    }
    out.push([...count].sort((a, b) => a[0] - b[0]).map(([offset, c]) => ({ offset, share: c / n })));
  }
  return out;
}

/** Wall-clock decimal hours (7.5 = 7:30) of an instant in a time zone. */
export function clockHoursAt(ms: number, tz: string): number {
  const p = zonedParts(ms, tz);
  return p.hour + p.minute / 60 + p.second / 3600;
}

// ------------------------------------------------------------------------------------------------ position

export interface SunPosition {
  /** True azimuth, degrees clockwise from north, [0, 360). */
  azimuth: number;
  /** Altitude above the horizon including atmospheric refraction, degrees. */
  altitude: number;
  /** Geometric altitude without refraction, degrees (used for sunrise/sunset thresholds). */
  altitudeGeometric: number;
  /** Declination of the sun, degrees, and equation of time, minutes. */
  declination: number;
  equationOfTime: number;
  /** Hour angle, degrees (negative before solar noon). */
  hourAngle: number;
}

/** Atmospheric refraction in degrees for a geometric altitude (NOAA's piecewise formula). */
function refraction(h: number): number {
  if (h > 85) return 0;
  const t = Math.tan(h * RAD);
  let arcsec: number;
  if (h > 5) arcsec = 58.1 / t - 0.07 / t ** 3 + 0.000086 / t ** 5;
  else if (h > -0.575) arcsec = 1735 + h * (-518.2 + h * (103.4 + h * (-12.79 + h * 0.711)));
  else arcsec = -20.772 / t;
  return arcsec / 3600;
}

/**
 * Solar position by the NOAA algorithm after Meeus (accuracy about 0.01 degree for the years 1950 to 2050; outside that range
 * it degrades slowly and does not throw). `time` is an instant (Date or ms since the epoch). Throws RangeError for a
 * non-finite time or |lat| > 90; longitudes are wrapped to (-180, 180]. At the poles azimuth is defined as 180 / 0.
 */
export function sunPosition(time: Date | number, place: Pick<GeoPlace, "lat" | "lon">): SunPosition {
  const ms = typeof time === "number" ? time : time.getTime();
  if (!Number.isFinite(ms)) throw new RangeError(`sun: time is not finite: ${ms}`);
  assertPlace(place);
  const lonWrapped = wrapLongitude(place.lon);
  const jd = ms / MS_DAY + 2440587.5;
  const T = (jd - 2451545) / 36525;
  const L0 = mod(280.46646 + T * (36000.76983 + T * 0.0003032), 360);
  const M = 357.52911 + T * (35999.05029 - 0.0001537 * T);
  const e = 0.016708634 - T * (0.000042037 + 0.0000001267 * T);
  const C = Math.sin(M * RAD) * (1.914602 - T * (0.004817 + 0.000014 * T))
    + Math.sin(2 * M * RAD) * (0.019993 - 0.000101 * T)
    + Math.sin(3 * M * RAD) * 0.000289;
  const omega = 125.04 - 1934.136 * T;
  const lambda = L0 + C - 0.00569 - 0.00478 * Math.sin(omega * RAD);
  const eps0 = 23 + (26 + (21.448 - T * (46.815 + T * (0.00059 - T * 0.001813))) / 60) / 60;
  const eps = eps0 + 0.00256 * Math.cos(omega * RAD);
  const declination = Math.asin(Math.sin(eps * RAD) * Math.sin(lambda * RAD)) / RAD;
  const y = Math.tan((eps / 2) * RAD) ** 2;
  const equationOfTime = (4 / RAD) * (y * Math.sin(2 * L0 * RAD) - 2 * e * Math.sin(M * RAD) + 4 * e * y * Math.sin(M * RAD) * Math.cos(2 * L0 * RAD)
    - 0.5 * y * y * Math.sin(4 * L0 * RAD) - 1.25 * e * e * Math.sin(2 * M * RAD));
  const trueSolarMinutes = mod(mod(ms / 60_000, 1440) + equationOfTime + 4 * lonWrapped, 1440);
  let hourAngle = trueSolarMinutes / 4 - 180;
  if (hourAngle < -180) hourAngle += 360;

  const la = place.lat * RAD, de = declination * RAD;
  const cosZenith = clamp(Math.sin(la) * Math.sin(de) + Math.cos(la) * Math.cos(de) * Math.cos(hourAngle * RAD), -1, 1);
  const zenith = Math.acos(cosZenith) / RAD;
  const denominator = Math.cos(la) * Math.sin(zenith * RAD);
  let azimuth: number;
  if (Math.abs(denominator) > 1e-9) {
    const a = clamp((Math.sin(la) * Math.cos(zenith * RAD) - Math.sin(de)) / denominator, -1, 1);
    const acute = Math.acos(a) / RAD;
    azimuth = hourAngle > 0 ? mod(acute + 180, 360) : mod(540 - acute, 360);
  } else {
    azimuth = place.lat > 0 ? 180 : 0; // pole (or zenith): every direction is south / north
  }
  const altitudeGeometric = 90 - zenith;
  return { azimuth, altitude: altitudeGeometric + refraction(altitudeGeometric), altitudeGeometric, declination, equationOfTime, hourAngle };
}

/** Altitude of the upper limb at sunrise and sunset in terms of the geometric altitude: -0.833 degrees (refraction + disc). */
export const SUNRISE_ALTITUDE = -0.833;

/** The sun counts as up for the daylight hours of the Sun page when its altitude (with refraction) is above this, degrees. */
export const SUN_UP_ALTITUDE = 0;

export interface SunTimes {
  /**
   * Wall-clock hours in the place's time zone (7.5 = 7:30) of the sunrise before and the sunset after this day's solar noon,
   * counted from midnight of the date (a sunset after midnight is above 24); null when the sun does not rise / set that day.
   */
  sunrise: number | null;
  sunset: number | null;
  /** Wall-clock time of the highest sun (solar noon). */
  solarNoon: number;
  /** Altitude at solar noon, degrees (with refraction). */
  noonAltitude: number;
  /** Elapsed time between sunrise and sunset, hours; 24 in the midnight sun, 0 in the polar night. */
  dayLength: number;
  polar: "none" | "day" | "night";
  /** Length of the civil day, hours: 24, or 23 / 25 on the days the clocks change. */
  civilDayHours: number;
}

/** Instant of the highest sun nearest to the middle of a civil day (golden section search of the altitude). */
function solarNoonInstant(place: GeoPlace, t0: number, t1: number): number {
  const mid = (t0 + t1) / 2;
  const lon = wrapLongitude(place.lon);
  let est = mid;
  for (let i = 0; i < 3; i++) {
    const eot = sunPosition(est, place).equationOfTime;
    const dayStart = Math.floor(est / MS_DAY) * MS_DAY;
    const base = dayStart + (720 - 4 * lon - eot) * 60_000;
    est = [base - MS_DAY, base, base + MS_DAY].reduce((best, c) => (Math.abs(c - mid) < Math.abs(best - mid) ? c : best));
  }
  const phi = (Math.sqrt(5) - 1) / 2;
  let a = est - 2 * MS_HOUR, b = est + 2 * MS_HOUR;
  let c = b - phi * (b - a), d = a + phi * (b - a);
  let fc = sunPosition(c, place).altitudeGeometric, fd = sunPosition(d, place).altitudeGeometric;
  for (let i = 0; i < 60; i++) {
    if (fc > fd) { b = d; d = c; fd = fc; c = b - phi * (b - a); fc = sunPosition(c, place).altitudeGeometric; }
    else { a = c; c = d; fc = fd; d = a + phi * (b - a); fd = sunPosition(d, place).altitudeGeometric; }
  }
  return (a + b) / 2;
}

/** Wall-clock hours since the midnight that starts `date` (negative before it, above 24 on the next day). */
function clockSince(ms: number, tz: string, date: CalendarDate): number {
  const p = zonedParts(ms, tz);
  const dayShift = (Date.UTC(p.year, p.month, p.day) - Date.UTC(date.year, date.month, date.day)) / MS_DAY;
  return p.hour + p.minute / 60 + p.second / 3600 + 24 * dayShift;
}

/**
 * Sunrise, solar noon and sunset for a calendar day in the time zone of the place, correct on the days of the change to and
 * from summer time (clock values come from Intl; `dayLength` is real elapsed time). Solar noon is found as the maximum of
 * the altitude (golden section around the equation-of-time estimate), sunrise and sunset by bisection of
 * `SUNRISE_ALTITUDE`. Agrees with the NOAA calculator to 2 minutes.
 *
 * Sunrise is the rise before this day's solar noon and sunset the set after it, so at high latitudes (and far from the
 * meridian of the zone) a sunset may fall after midnight: it is then reported as hours above 24 (24.1 = 00:06 the next
 * day), and likewise a sunrise before midnight as a negative number.
 */
export function sunTimes(place: GeoPlace, date: CalendarDate): SunTimes {
  assertDate(date);
  assertPlace(place);
  const t0 = localToUtc(place.tz, date, 0);
  const t1 = localToUtc(place.tz, addDays(date, 1), 0);
  const civilDayHours = (t1 - t0) / MS_HOUR;
  const f = (t: number) => sunPosition(t, place).altitudeGeometric - SUNRISE_ALTITUDE;

  const tNoon = solarNoonInstant(place, t0, t1);
  const noon = sunPosition(tNoon, place);
  const base = { solarNoon: clockSince(tNoon, place.tz, date), noonAltitude: noon.altitude, civilDayHours };
  if (f(tNoon) < 0) return { ...base, sunrise: null, sunset: null, dayLength: 0, polar: "night" };

  // The altitude has one maximum and one minimum per day, so there is at most one crossing on each side of noon. Scan the
  // half days in 10-minute steps for a sign change and refine it by bisection.
  const step = 10 * 60_000;
  const cross = (from: number, to: number): number | null => {
    const dir = Math.sign(to - from);
    let prevT = from, prevF = f(from);
    for (let t = from + dir * step; ; t += dir * step) {
      const tt = dir > 0 ? Math.min(t, to) : Math.max(t, to);
      const ft = f(tt);
      if ((prevF >= 0) !== (ft >= 0)) {
        let a = prevT, b = tt;
        const aUp = prevF >= 0;
        for (let i = 0; i < 40; i++) {
          const mid = (a + b) / 2;
          if ((f(mid) >= 0) === aUp) a = mid; else b = mid;
        }
        return (a + b) / 2;
      }
      prevT = tt; prevF = ft;
      if (tt === to) return null;
    }
  };
  const half = 12.5 * MS_HOUR;
  const rise = cross(tNoon, tNoon - half);
  const set = cross(tNoon, tNoon + half);
  // one altitude maximum per day: both crossings exist, or the sun never dips below the threshold (midnight sun)
  if (rise === null || set === null) return { ...base, sunrise: null, sunset: null, dayLength: 24, polar: "day" };
  return {
    ...base,
    sunrise: clockSince(rise, place.tz, date),
    sunset: clockSince(set, place.tz, date),
    dayLength: (set - rise) / MS_HOUR,
    polar: "none",
  };
}

// ------------------------------------------------------------------------------------------------ daily data

export interface SunSample {
  /** Instant (ms since the epoch). */
  ms: number;
  /** Wall-clock hours in the place's time zone, 0 <= x < 24. */
  localHours: number;
  azimuth: number;
  altitude: number;
}

export interface SunArcOptions {
  /** Sampling step in minutes of elapsed time, default 10. */
  stepMinutes?: number;
  /** Samples below this altitude are left out, default -0.5 degrees (the arc just touches the horizon). */
  minAltitude?: number;
}

function stepOf(opts: { stepMinutes?: number } | undefined): number {
  const s = opts?.stepMinutes ?? 10;
  if (!Number.isFinite(s) || s <= 0) throw new RangeError(`sun: stepMinutes must be positive: ${s}`);
  return s;
}

/** Positions through one calendar day from local midnight to local midnight (23 / 25 hours on change days), for drawing. */
export function sunArc(place: GeoPlace, date: CalendarDate, opts?: SunArcOptions): SunSample[] {
  assertDate(date);
  assertPlace(place);
  const step = stepOf(opts);
  const minAltitude = opts?.minAltitude ?? -0.5;
  const t0 = localToUtc(place.tz, date, 0);
  const t1 = localToUtc(place.tz, addDays(date, 1), 0);
  const out: SunSample[] = [];
  for (let k = 0; ; k++) {
    const ms = t0 + k * step * 60_000;
    if (ms >= t1) break;
    const p = sunPosition(ms, place);
    if (p.altitude >= minAltitude) out.push({ ms, localHours: clockHoursAt(ms, place.tz), azimuth: p.azimuth, altitude: p.altitude });
  }
  return out;
}

export interface SunDay {
  date: CalendarDate;
  times: SunTimes;
  arc: SunSample[];
  /** The samples at full wall-clock hours (for tick marks and labels), subset of what `sunArc` would give at 1 h steps. */
  hourMarks: SunSample[];
  declination: number;
}

/** Everything the Sun page needs for one day. */
export function sunDay(place: GeoPlace, date: CalendarDate, opts?: SunArcOptions): SunDay {
  const times = sunTimes(place, date);
  const arc = sunArc(place, date, opts);
  const seen = new Set<number>();
  const hourMarks = sunArc(place, date, { stepMinutes: 60, minAltitude: opts?.minAltitude }).filter((s) => {
    // the hour that occurs twice when the clocks go back is marked once
    if (seen.has(s.localHours)) return false;
    seen.add(s.localHours);
    return true;
  });
  const noon = localToUtc(place.tz, date, times.solarNoon);
  return { date: { ...date }, times, arc, hourMarks, declination: sunPosition(noon, place).declination };
}

/** Day used as "the typical day" of a month (energy and sun tables): the 15th. */
export const TYPICAL_DAY = 15;

export interface MonthSun {
  /** 0-based month. */
  month: number;
  date: CalendarDate;
  times: SunTimes;
}

/** Sunrise, sunset and noon altitude on the typical day of each month of a year. */
export function monthSummary(place: GeoPlace, year: number): MonthSun[] {
  return Array.from({ length: 12 }, (_, month) => {
    const date = { year, month, day: TYPICAL_DAY };
    return { month, date, times: sunTimes(place, date) };
  });
}

/**
 * The reference days of a year for the arcs of the Sun page: the day of the highest and of the lowest declination, and the days
 * nearest to the equinoxes (`equinox` is the spring one, `autumnEquinox` the one after the summer solstice). Found by searching
 * declination at local solar noon, not tabulated.
 */
export function keyDays(place: GeoPlace, year: number): { summerSolstice: CalendarDate; equinox: CalendarDate; autumnEquinox: CalendarDate; winterSolstice: CalendarDate } {
  assertPlace(place);
  const days: { date: CalendarDate; decl: number }[] = [];
  // declination at the local solar noon of each day (no time-zone arithmetic: the sun moves by 0.4 degrees a day at most)
  const noonOffset = (12 - wrapLongitude(place.lon) / 15) * MS_HOUR;
  for (let d = { year, month: 0, day: 1 }; d.year === year; d = addDays(d, 1)) {
    days.push({ date: d, decl: sunPosition(Date.UTC(d.year, d.month, d.day) + noonOffset, place).declination });
  }
  let hi = 0, lo = 0;
  days.forEach((x, i) => { if (x.decl > days[hi].decl) hi = i; if (x.decl < days[lo].decl) lo = i; });
  const nearestZero = (from: number, to: number) => {
    let best = from;
    for (let i = from; i <= to; i++) if (Math.abs(days[i].decl) < Math.abs(days[best].decl)) best = i;
    return days[best].date;
  };
  return {
    summerSolstice: days[hi].date,
    equinox: nearestZero(0, hi),
    autumnEquinox: nearestZero(hi, Math.max(hi, lo)),
    winterSolstice: days[lo].date,
  };
}

// ------------------------------------------------------------------------------------------------ directions and surfaces

/**
 * Unit vector towards the sun in the house frame ([east, north, up]) from the true azimuth and altitude of the sun and
 * the bearing of the house +y axis (`house.location.houseAxisBearingDeg`). For three.js convert with (x, y, z) -> (x, z, -y).
 * The same formula as `sunDirectionHouse` of the 3D engine (a test compares them).
 */
export function sunDirection(azimuthTrue: number, altitude: number, houseAxisBearingDeg: number): Vec3 {
  const a = mod(azimuthTrue - houseAxisBearingDeg, 360) * RAD;
  const e = altitude * RAD;
  return [Math.sin(a) * Math.cos(e), Math.cos(a) * Math.cos(e), Math.sin(e)];
}

/** Cosine of the angle of incidence of a direct ray on a surface: max(0, normal . direction). Both unit vectors. */
export function cosIncidence(normal: Vec3, direction: Vec3): number {
  return Math.max(0, normal[0] * direction[0] + normal[1] * direction[1] + normal[2] * direction[2]);
}

/**
 * Point of a sun path diagram: azimuth clockwise from the top, equal steps of zenith angle (the horizon is at `radius`, the
 * zenith in the centre). Returns SVG offsets from the centre (y points down): x = r sin(az), y = -r cos(az), r = radius *
 * (90 - altitude) / 90. Altitudes below the horizon give r > radius.
 */
export function skyPoint(azimuth: number, altitude: number, radius: number): { x: number; y: number } {
  const r = (radius * (90 - altitude)) / 90;
  const a = azimuth * RAD;
  return { x: r * Math.sin(a), y: -r * Math.cos(a) };
}

export const COMPASS_POINTS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"] as const;
export type CompassPoint = (typeof COMPASS_POINTS)[number];

/** The eight-point compass direction of a true azimuth (the page turns the key into a word). */
export function compassPoint(azimuth: number): CompassPoint {
  return COMPASS_POINTS[Math.round(mod(azimuth, 360) / 45) % 8];
}

export interface SurfaceSunHours {
  /** Hours of the day with the sun above the horizon and in front of the surface (cos incidence > 0), no obstacles. */
  hours: number;
  /** Wall-clock hours of the first and last such sample, null when there are none. */
  first: number | null;
  last: number | null;
}

/**
 * Unobstructed direct sun hours on a plane with the given outward unit normal (house frame), on a calendar day. This is the
 * analytic upper bound and the oracle for the ray-cast analysis of the Sun page (no neighbours, trees or own shading).
 * Sampled every `stepMinutes` (default 10) at the middle of each interval; the sun counts as up above `SUN_UP_ALTITUDE`.
 */
export function sunHoursOnSurface(place: GeoPlace, date: CalendarDate, normalHouse: Vec3, houseAxisBearingDeg: number, opts?: { stepMinutes?: number }): SurfaceSunHours {
  assertDate(date);
  assertPlace(place);
  const step = stepOf(opts);
  const t0 = localToUtc(place.tz, date, 0);
  const t1 = localToUtc(place.tz, addDays(date, 1), 0);
  let count = 0, first: number | null = null, last: number | null = null;
  for (let k = 0; ; k++) {
    const ms = t0 + (k + 0.5) * step * 60_000;
    if (ms >= t1) break;
    const p = sunPosition(ms, place);
    if (p.altitude <= SUN_UP_ALTITUDE) continue;
    if (cosIncidence(normalHouse, sunDirection(p.azimuth, p.altitude, houseAxisBearingDeg)) <= 0) continue;
    count++;
    const h = clockHoursAt(ms, place.tz);
    first ??= h;
    last = h;
  }
  return { hours: (count * step) / 60, first, last };
}

// ------------------------------------------------------------------------------------------------ roof overhang

/** A glazed opening with the roof edge above it (`DerivedOpening.overhang`). */
export interface OverhangWindow {
  /** True azimuth of the outward normal of the wall. */
  azimuthTrue: number;
  /** Sill and head heights above the floor, m. */
  sill: number;
  head: number;
  /** Horizontal projection of the roof edge beyond the wall face and its height above the floor, m; null = no roof above. */
  overhang: { depth: number; eaveHeight: number } | null;
}

/**
 * Share (0..1) of the glazing height that lies in the shadow of the roof edge for one sun position, for an overhang that is
 * long compared with the window. The vertical profile angle is atan(tan(altitude) / cos(azimuth difference)); the shadow reaches
 * down to `eaveHeight - depth * tan(profile angle)`. Zero when the sun is behind the wall plane (|difference| >= 90 degrees),
 * below the horizon, or there is no overhang; one when the shadow covers the whole glazing. A window without height gives 0.
 */
export function overhangShadedFraction(w: OverhangWindow, sun: Pick<SunPosition, "azimuth" | "altitude">): number {
  if (!w.overhang || sun.altitude <= 0 || w.head <= w.sill) return 0;
  const diff = mod(sun.azimuth - w.azimuthTrue + 180, 360) - 180;
  const cosDiff = Math.cos(diff * RAD);
  if (Math.abs(diff) >= 90 || cosDiff <= 1e-12) return 0;
  const profile = Math.atan(Math.tan(sun.altitude * RAD) / cosDiff);
  const reach = w.overhang.eaveHeight - w.overhang.depth * Math.tan(profile);
  return clamp((w.head - reach) / (w.head - w.sill), 0, 1);
}

/**
 * Beam-weighted shaded share over a day: the average of `overhangShadedFraction` over the samples with the sun above the
 * horizon and in front of the wall, each weighted by the cosine of incidence on the wall (a proxy for the direct irradiance on
 * the facade that needs no irradiance data). 0 when the window sees no direct sun that day.
 */
export function overhangDailyShading(place: GeoPlace, date: CalendarDate, w: OverhangWindow, opts?: { stepMinutes?: number }): number {
  assertDate(date);
  assertPlace(place);
  const step = stepOf(opts);
  const t0 = localToUtc(place.tz, date, 0);
  const t1 = localToUtc(place.tz, addDays(date, 1), 0);
  const normal: Vec3 = [Math.sin(w.azimuthTrue * RAD), Math.cos(w.azimuthTrue * RAD), 0];
  let sum = 0, weights = 0;
  for (let k = 0; ; k++) {
    const ms = t0 + (k + 0.5) * step * 60_000;
    if (ms >= t1) break;
    const p = sunPosition(ms, place);
    if (p.altitude <= 0) continue;
    const weight = cosIncidence(normal, sunDirection(p.azimuth, p.altitude, 0)); // true frame: bearing 0
    if (weight <= 0) continue;
    sum += weight * overhangShadedFraction(w, p);
    weights += weight;
  }
  return weights > 0 ? sum / weights : 0;
}
