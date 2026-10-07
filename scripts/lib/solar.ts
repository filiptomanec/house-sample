// Solar position for the render inputs (NOAA solar calculator algorithm, Meeus based). Pure TypeScript, no I/O.
//
// This is the TEMPORARY implementation used by scripts/build-render-inputs.ts while src/lib/calc/sun.ts (the web's source
// of truth) is not available. The build script prefers calc/sun.ts as soon as it exists and the test compares the two to
// 0.1 degree (see docs/RENDER-INPUTS.md, section "Sun").
//
// Conventions: azimuth is clockwise from true north, elevation above the horizon, both in degrees. `elevationDeg` is the
// apparent elevation (atmospheric refraction included, NOAA formula), `elevationGeomDeg` the geometric one.

const RAD = Math.PI / 180;
const DEG = 180 / Math.PI;
const mod = (a: number, n: number): number => ((a % n) + n) % n;

export interface SolarPosition {
  /** Clockwise from true north, [0, 360). */
  azimuthDeg: number;
  /** Apparent elevation (with refraction). */
  elevationDeg: number;
  /** Geometric elevation (no refraction). */
  elevationGeomDeg: number;
  declinationDeg: number;
  /** Equation of time in minutes. */
  equationOfTimeMin: number;
  /** Hour angle in degrees, negative before solar noon. */
  hourAngleDeg: number;
}

/** Julian day of a UTC instant (milliseconds since the epoch). */
export const julianDay = (utcMs: number): number => utcMs / 86400000 + 2440587.5;

/** Solar position at a UTC instant (ms since epoch) for latitude / longitude in degrees (east positive). */
export function solarPosition(utcMs: number, latDeg: number, lonDeg: number): SolarPosition {
  const jd = julianDay(utcMs);
  const T = (jd - 2451545) / 36525;
  const L0 = mod(280.46646 + T * (36000.76983 + T * 0.0003032), 360);
  const M = 357.52911 + T * (35999.05029 - 0.0001537 * T);
  const e = 0.016708634 - T * (0.000042037 + 0.0000001267 * T);
  const C =
    Math.sin(M * RAD) * (1.914602 - T * (0.004817 + 0.000014 * T)) +
    Math.sin(2 * M * RAD) * (0.019993 - 0.000101 * T) +
    Math.sin(3 * M * RAD) * 0.000289;
  const trueLong = L0 + C;
  const omega = 125.04 - 1934.136 * T;
  const appLong = trueLong - 0.00569 - 0.00478 * Math.sin(omega * RAD);
  const obliqMean = 23 + (26 + (21.448 - T * (46.815 + T * (0.00059 - T * 0.001813))) / 60) / 60;
  const obliq = obliqMean + 0.00256 * Math.cos(omega * RAD);
  const decl = Math.asin(Math.sin(obliq * RAD) * Math.sin(appLong * RAD));
  const y = Math.tan((obliq * RAD) / 2) ** 2;
  const eqTime =
    4 *
    DEG *
    (y * Math.sin(2 * L0 * RAD) -
      2 * e * Math.sin(M * RAD) +
      4 * e * y * Math.sin(M * RAD) * Math.cos(2 * L0 * RAD) -
      0.5 * y * y * Math.sin(4 * L0 * RAD) -
      1.25 * e * e * Math.sin(2 * M * RAD));

  const minutesUtc = mod(utcMs / 60000, 1440);
  const trueSolarTime = mod(minutesUtc + eqTime + 4 * lonDeg, 1440);
  let H = trueSolarTime / 4 - 180;
  if (H < -180) H += 360;
  const lat = latDeg * RAD;
  const cosZen = Math.sin(lat) * Math.sin(decl) + Math.cos(lat) * Math.cos(decl) * Math.cos(H * RAD);
  const elevGeom = 90 - Math.acos(Math.min(1, Math.max(-1, cosZen))) * DEG;
  // azimuth from north, clockwise (atan2 form is stable at the poles of the formula)
  const az = mod(Math.atan2(Math.sin(H * RAD), Math.cos(H * RAD) * Math.sin(lat) - Math.tan(decl) * Math.cos(lat)) * DEG + 180, 360);

  return {
    azimuthDeg: az,
    elevationDeg: elevGeom + refractionDeg(elevGeom),
    elevationGeomDeg: elevGeom,
    declinationDeg: decl * DEG,
    equationOfTimeMin: eqTime,
    hourAngleDeg: H,
  };
}

/** NOAA approximation of the atmospheric refraction (degrees) for a geometric elevation. */
export function refractionDeg(elevGeomDeg: number): number {
  const el = elevGeomDeg;
  if (el > 85) return 0;
  const t = Math.tan(el * RAD);
  let arcsec: number;
  if (el > 5) arcsec = 58.1 / t - 0.07 / t ** 3 + 0.000086 / t ** 5;
  else if (el > -0.575) arcsec = 1735 + el * (-518.2 + el * (103.4 + el * (-12.79 + el * 0.711)));
  else arcsec = -20.772 / t;
  return arcsec / 3600;
}

/** UTC offset in minutes of an IANA time zone at a UTC instant (DST aware, via ICU). */
export function utcOffsetMinutes(tz: string, utcMs: number): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(utcMs));
  const get = (t: string): number => Number(parts.find((p) => p.type === t)?.value);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return Math.round((asUtc - Math.floor(utcMs / 1000) * 1000) / 60000);
}

export interface LocalTime {
  utcMs: number;
  utcOffsetMinutes: number;
  /** "2026-06-21T20:45:00+02:00" */
  iso: string;
  /** "2026-06-21T18:45:00Z" */
  utcIso: string;
}

/** Converts a local wall-clock time ("YYYY-MM-DD", "HH:MM") in a time zone to a UTC instant. */
export function localToUtc(date: string, time: string, tz: string): LocalTime {
  const [y, mo, d] = date.split("-").map(Number);
  const [h, mi] = time.split(":").map(Number);
  const wall = Date.UTC(y, mo - 1, d, h, mi, 0);
  let utc = wall;
  for (let i = 0; i < 3; i++) utc = wall - utcOffsetMinutes(tz, utc) * 60000;
  const off = utcOffsetMinutes(tz, utc);
  const sign = off < 0 ? "-" : "+";
  const abs = Math.abs(off);
  const oh = String(Math.floor(abs / 60)).padStart(2, "0");
  const om = String(abs % 60).padStart(2, "0");
  const pad = (n: number): string => String(n).padStart(2, "0");
  return {
    utcMs: utc,
    utcOffsetMinutes: off,
    iso: `${date}T${pad(h)}:${pad(mi)}:00${sign}${oh}:${om}`,
    utcIso: new Date(utc).toISOString().replace(".000Z", "Z"),
  };
}

/** Local clock time "HH:MM" of a UTC instant in a time zone. */
export function formatLocal(tz: string, utcMs: number): string {
  const f = new Intl.DateTimeFormat("en-GB", { timeZone: tz, hourCycle: "h23", hour: "2-digit", minute: "2-digit" });
  return f.format(new Date(utcMs));
}

export interface DayEvents {
  /** Local "HH:MM" of sunrise / sunset (apparent centre of the disc at -0.833 degrees geometric, NOAA convention). */
  sunrise: string;
  sunset: string;
  /** Civil dusk / dawn: the sun at -6 degrees. */
  civilDawn: string;
  civilDusk: string;
  solarNoon: string;
  /** Maximum geometric elevation of the day. */
  noonElevationDeg: number;
}

/** Position function of a sun implementation: (UTC ms, lat, lon) -> geometric elevation in degrees (the only part needed here). */
export type GeomElevationFn = (utcMs: number, latDeg: number, lonDeg: number) => number;

/** Events of a local date, found by ternary search and bisection. `geomElevation` defaults to this file's implementation. */
export function dayEvents(
  date: string,
  tz: string,
  latDeg: number,
  lonDeg: number,
  geomElevation: GeomElevationFn = (t, la, lo) => solarPosition(t, la, lo).elevationGeomDeg,
): DayEvents {
  const start = localToUtc(date, "00:00", tz).utcMs;
  const elevAt = (minute: number): number => geomElevation(start + minute * 60000, latDeg, lonDeg);
  // solar noon: maximum of the elevation (ternary search on the day)
  let lo = 0, hi = 1440;
  for (let i = 0; i < 60; i++) {
    const a = lo + (hi - lo) / 3, b = hi - (hi - lo) / 3;
    if (elevAt(a) < elevAt(b)) lo = a;
    else hi = b;
  }
  const noon = (lo + hi) / 2;
  const cross = (level: number, from: number, to: number): number => {
    let a = from, b = to;
    const rising = elevAt(a) < level;
    for (let i = 0; i < 50; i++) {
      const m = (a + b) / 2;
      if (elevAt(m) < level === rising) a = m;
      else b = m;
    }
    return (a + b) / 2;
  };
  const clock = (minute: number): string => formatLocal(tz, start + Math.round(minute) * 60000);
  return {
    sunrise: clock(cross(-0.833, 0, noon)),
    sunset: clock(cross(-0.833, noon, 1440)),
    civilDawn: clock(cross(-6, 0, noon)),
    civilDusk: clock(cross(-6, noon, 1440)),
    solarNoon: clock(noon),
    noonElevationDeg: elevAt(noon),
  };
}

/** Sun phase used to pick the sky and lights set-up. */
export type SunPhase = "night" | "astronomical" | "nautical" | "civil" | "golden" | "day";

/** Phase from the apparent elevation: day above 10, golden hour 0..10 (sun above the horizon but low), twilight steps below. */
export function sunPhase(elevationDeg: number): SunPhase {
  if (elevationDeg >= 10) return "day";
  if (elevationDeg >= -0.833) return "golden";
  if (elevationDeg >= -6) return "civil";
  if (elevationDeg >= -12) return "nautical";
  if (elevationDeg >= -18) return "astronomical";
  return "night";
}

/** Unit vector towards the sun in the house frame (x east, y north, z up) from the house azimuth and the elevation. */
export function sunVector(azimuthHouseDeg: number, elevationDeg: number): [number, number, number] {
  const a = azimuthHouseDeg * RAD, e = elevationDeg * RAD;
  return [Math.sin(a) * Math.cos(e), Math.cos(a) * Math.cos(e), Math.sin(e)];
}

/**
 * Clear-sky direct normal irradiance (W/m2) of the Meinel model, used only to decide when the blinds close in the renders.
 * It is a rule of thumb (the web's energy page has its own model); 0 below the horizon.
 */
export function clearSkyDni(elevationDeg: number): number {
  if (elevationDeg <= 0) return 0;
  const zen = (90 - elevationDeg) * RAD;
  const airMass = 1 / (Math.cos(zen) + 0.50572 * (96.07995 - 90 + elevationDeg) ** -1.6364);
  return 1353 * 0.7 ** (airMass ** 0.678);
}
