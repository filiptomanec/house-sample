// Tests of calc/sun.ts: independent oracles (Spencer series, hour-angle formula, brute force sampling), invariants and the
// time-zone arithmetic. No number of the house appears: places are generic (several zones, both hemispheres, the polar circle).
import { describe, expect, it } from "vitest";
import {
  COMPASS_POINTS, SUNRISE_ALTITUDE, addDays, compassPoint, cosIncidence, daysInMonthOf, isValidDate, keyDays, localToUtc,
  monthOffsetMix, monthSummary, overhangDailyShading, overhangShadedFraction, placeOf, skyPoint, sunArc, sunDay, sunDirection,
  sunHoursOnSurface, sunPosition, sunTimes, utcOffsetHours, zonedParts, type CalendarDate, type GeoPlace, type Vec3,
} from "../sun";
import { sunDirectionHouse } from "@/lib/three/frame";
import { house } from "@/lib/model/instance";
import { dayOfYear } from "@/lib/calendar";

const RAD = Math.PI / 180;
const HOUR = 3_600_000;

const MID: GeoPlace = { lat: 49.2, lon: 16.6, tz: "Europe/Prague" };
const SOUTH: GeoPlace = { lat: -33.9, lon: 151.2, tz: "Australia/Sydney" };
const NORTH: GeoPlace = { lat: 64.1, lon: -21.9, tz: "Atlantic/Reykjavik" };
const ARCTIC: GeoPlace = { lat: 69.6, lon: 18.9, tz: "Europe/Oslo" };
const EQUATOR: GeoPlace = { lat: 0, lon: 30, tz: "Africa/Kampala" };
const INDIA: GeoPlace = { lat: 22.6, lon: 88.4, tz: "Asia/Kolkata" };
const ZONES = ["Europe/Prague", "America/New_York", "Australia/Sydney"];

/** Declination (degrees) and equation of time (minutes) by the Spencer (1971) Fourier series: a different formula from NOAA/Meeus. */
function spencer(doy: number, hourUtc: number) {
  const g = ((2 * Math.PI) / 365) * (doy - 1 + (hourUtc - 12) / 24);
  const decl = 0.006918 - 0.399912 * Math.cos(g) + 0.070257 * Math.sin(g) - 0.006758 * Math.cos(2 * g) + 0.000907 * Math.sin(2 * g) - 0.002697 * Math.cos(3 * g) + 0.00148 * Math.sin(3 * g);
  const eot = 229.18 * (0.000075 + 0.001868 * Math.cos(g) - 0.032077 * Math.sin(g) - 0.014615 * Math.cos(2 * g) - 0.040849 * Math.sin(2 * g));
  return { decl: decl / RAD, eot };
}

/**
 * Low-precision solar coordinates of the Astronomical Almanac (mean longitude, mean anomaly, ecliptic longitude, right ascension):
 * a second, independent formula good to about 0.01 degree for 1950 to 2050. Returns declination (degrees) and equation of time (minutes).
 */
function almanac(ms: number) {
  const mod = (a: number, n: number) => ((a % n) + n) % n;
  const n = ms / 86_400_000 + 2440587.5 - 2451545.0;
  const L = mod(280.46 + 0.9856474 * n, 360);
  const g = mod(357.528 + 0.9856003 * n, 360) * RAD;
  const lambda = (L + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * RAD;
  const eps = (23.439 - 0.0000004 * n) * RAD;
  const decl = Math.asin(Math.sin(eps) * Math.sin(lambda)) / RAD;
  const ra = mod(Math.atan2(Math.cos(eps) * Math.sin(lambda), Math.cos(lambda)) / RAD, 360);
  const eot = mod(L - ra + 180, 360) - 180;
  return { decl, eot: eot * 4 };
}

const SAMPLE_DAYS: CalendarDate[] = [
  { year: 2026, month: 0, day: 12 }, { year: 2026, month: 1, day: 20 }, { year: 2026, month: 2, day: 20 }, { year: 2026, month: 3, day: 15 },
  { year: 2026, month: 4, day: 30 }, { year: 2026, month: 5, day: 21 }, { year: 2026, month: 6, day: 25 }, { year: 2026, month: 7, day: 10 },
  { year: 2026, month: 8, day: 23 }, { year: 2026, month: 9, day: 12 }, { year: 2026, month: 10, day: 18 }, { year: 2026, month: 11, day: 21 },
];
const doy = (d: CalendarDate) => dayOfYear(d.month, d.day);

describe("calendar helpers", () => {
  it("knows month lengths and rejects impossible days", () => {
    expect(daysInMonthOf(2028, 1)).toBe(29);
    expect(daysInMonthOf(2026, 1)).toBe(28);
    expect(isValidDate({ year: 2026, month: 1, day: 29 })).toBe(false);
    expect(isValidDate({ year: 2026, month: 12, day: 1 })).toBe(false);
    expect(isValidDate({ year: 2026, month: 0, day: 1.5 })).toBe(false);
    expect(addDays({ year: 2026, month: 11, day: 31 }, 1)).toEqual({ year: 2027, month: 0, day: 1 });
    expect(addDays({ year: 2028, month: 2, day: 1 }, -1)).toEqual({ year: 2028, month: 1, day: 29 });
  });
  it("throws RangeError for a 30 February", () => {
    const bad = { year: 2026, month: 1, day: 30 };
    expect(() => sunTimes(MID, bad)).toThrow(RangeError);
    expect(() => localToUtc(MID.tz, bad)).toThrow(RangeError);
    expect(() => sunArc(MID, bad)).toThrow(RangeError);
  });
});

describe("place of the house", () => {
  it("reads location from the model", () => {
    expect(placeOf(house)).toEqual({ lat: house.location.lat, lon: house.location.lon, tz: house.location.tz });
  });
});

describe("time zones", () => {
  it("fractional offsets", () => {
    expect(utcOffsetHours(Date.UTC(2026, 0, 15, 12), "Asia/Kolkata")).toBe(5.5);
    expect(utcOffsetHours(Date.UTC(2026, 0, 15, 12), "Asia/Kathmandu")).toBe(5.75);
    expect(utcOffsetHours(Date.UTC(2026, 0, 15, 12), "UTC")).toBe(0);
  });
  it("Prague changes on the last Sundays of March and October", () => {
    expect(utcOffsetHours(Date.UTC(2026, 0, 15, 12), "Europe/Prague")).toBe(1);
    expect(utcOffsetHours(Date.UTC(2026, 6, 15, 12), "Europe/Prague")).toBe(2);
    expect(sunTimes(MID, { year: 2026, month: 2, day: 29 }).civilDayHours).toBe(23);
    expect(sunTimes(MID, { year: 2026, month: 9, day: 25 }).civilDayHours).toBe(25);
    for (const d of [{ year: 2026, month: 2, day: 28 }, { year: 2026, month: 2, day: 30 }, { year: 2026, month: 9, day: 24 }, { year: 2026, month: 9, day: 26 }, { year: 2026, month: 5, day: 21 }]) {
      expect(sunTimes(MID, d).civilDayHours).toBe(24);
    }
  });
  it("civil day lengths in the northern and the southern hemisphere", () => {
    const len = (tz: string, d: CalendarDate) => (localToUtc(tz, addDays(d, 1)) - localToUtc(tz, d)) / HOUR;
    expect(len("America/New_York", { year: 2026, month: 2, day: 8 })).toBe(23);
    expect(len("America/New_York", { year: 2026, month: 10, day: 1 })).toBe(25);
    expect(len("Australia/Sydney", { year: 2026, month: 3, day: 5 })).toBe(25); // summer time ends in April
    expect(len("Australia/Sydney", { year: 2026, month: 9, day: 4 })).toBe(23); // and starts in October
  });
  it("a wall time in the gap maps to the first instant after it", () => {
    const t = localToUtc("Europe/Prague", { year: 2026, month: 2, day: 29 }, 2.5);
    expect(t).toBe(Date.UTC(2026, 2, 29, 1, 0, 0));
    expect(zonedParts(t, "Europe/Prague")).toMatchObject({ hour: 3, minute: 0, second: 0 });
    expect(zonedParts(t - 1000, "Europe/Prague")).toMatchObject({ hour: 1, minute: 59, second: 59 });
    const ny = localToUtc("America/New_York", { year: 2026, month: 2, day: 8 }, 2.25);
    expect(ny).toBe(Date.UTC(2026, 2, 8, 7, 0, 0));
  });
  it("a wall time in the overlap maps to its first occurrence", () => {
    expect(localToUtc("Europe/Prague", { year: 2026, month: 9, day: 25 }, 2.5)).toBe(Date.UTC(2026, 9, 25, 0, 30, 0)); // CEST
    expect(localToUtc("America/New_York", { year: 2026, month: 10, day: 1 }, 1.5)).toBe(Date.UTC(2026, 10, 1, 5, 30, 0)); // EDT
    expect(zonedParts(Date.UTC(2026, 9, 25, 1, 30), "Europe/Prague")).toMatchObject({ hour: 2, minute: 30 }); // the second 02:30
  });
  it("zonedParts and localToUtc are inverse over a whole year in three zones (hour never 24)", () => {
    for (const tz of [...ZONES, "Asia/Kolkata"]) {
      const start = Date.UTC(2026, 0, 1) + 17 * 60_000;
      for (let k = 0; k < 8760; k++) {
        const ms = start + k * HOUR;
        const p = zonedParts(ms, tz);
        expect(p.hour).toBeLessThan(24);
        const back = localToUtc(tz, { year: p.year, month: p.month, day: p.day }, p.hour + p.minute / 60 + p.second / 3600);
        if (back !== ms) {
          // only the repeated hour may differ: localToUtc returns its first occurrence, one hour earlier
          expect(back).toBe(ms - HOUR);
          expect(utcOffsetHours(back, tz)).toBeGreaterThan(utcOffsetHours(ms, tz));
        }
      }
    }
  });
  it("monthOffsetMix: shares add up to 1 and a month has two offsets exactly when the zone changes in it", () => {
    for (const tz of [...ZONES, "UTC", "Asia/Kolkata"]) {
      const mix = monthOffsetMix(tz, 2026);
      expect(mix).toHaveLength(12);
      mix.forEach((entries, month) => {
        expect(entries.reduce((a, e) => a + e.share, 0)).toBeCloseTo(1, 12);
        const n = daysInMonthOf(2026, month);
        const first = utcOffsetHours(localToUtc(tz, { year: 2026, month, day: 1 }, 12), tz);
        const last = utcOffsetHours(localToUtc(tz, { year: 2026, month, day: n }, 12), tz);
        expect(entries.length).toBe(first === last ? 1 : 2);
      });
    }
    const prague = monthOffsetMix("Europe/Prague", 2026);
    expect(prague.map((e, m) => (e.length === 2 ? m : -1)).filter((m) => m >= 0)).toEqual([2, 9]);
    // March: 28 winter days (+1) before the change on the 29th, 3 summer days (+2) from the 29th
    expect(prague[2]).toEqual([{ offset: 1, share: 28 / 31 }, { offset: 2, share: 3 / 31 }]);
  });
});

describe("sunPosition against independent formulas", () => {
  it("declination and equation of time agree with the Almanac formulas (0.05 degrees, 0.3 minutes)", () => {
    for (const d of SAMPLE_DAYS) {
      for (const hour of [0, 6, 12, 18]) {
        const ms = Date.UTC(d.year, d.month, d.day, hour);
        const ref = almanac(ms);
        const p = sunPosition(ms, MID);
        expect(Math.abs(p.declination - ref.decl)).toBeLessThan(0.05);
        expect(Math.abs(p.equationOfTime - ref.eot)).toBeLessThan(0.3);
      }
    }
  });
  it("and with the Spencer series, a mean-year approximation (0.5 degrees, 1.5 minutes: one day of motion near the equinoxes)", () => {
    for (const d of SAMPLE_DAYS) {
      const ms = Date.UTC(d.year, d.month, d.day, 12);
      const ref = spencer(doy(d), 12);
      const p = sunPosition(ms, MID);
      expect(Math.abs(p.declination - ref.decl)).toBeLessThan(0.5);
      expect(Math.abs(p.equationOfTime - ref.eot)).toBeLessThan(1.5);
    }
  });
  it("altitude from the hour-angle formula with the Spencer declination (0.5 degrees)", () => {
    for (const place of [MID, SOUTH, NORTH]) {
      for (const d of SAMPLE_DAYS) {
        for (const hour of [6, 9, 12, 15, 18]) {
          const ms = Date.UTC(d.year, d.month, d.day, hour);
          const ref = spencer(doy(d), hour);
          const tst = (hour * 60 + ref.eot + 4 * place.lon + 1440 * 10) % 1440;
          const ha = (tst / 4 - 180) * RAD;
          const sinAlt = Math.sin(place.lat * RAD) * Math.sin(ref.decl * RAD) + Math.cos(place.lat * RAD) * Math.cos(ref.decl * RAD) * Math.cos(ha);
          const altitude = Math.asin(sinAlt) / RAD;
          expect(Math.abs(sunPosition(ms, place).altitudeGeometric - altitude)).toBeLessThan(0.5);
        }
      }
    }
  });
  it("noon altitude is 90 - |latitude - declination| (refraction at most 0.6 degrees)", () => {
    for (const place of [MID, SOUTH, NORTH, EQUATOR]) {
      for (const d of SAMPLE_DAYS) {
        const t = sunTimes(place, d);
        const noonMs = localToUtc(place.tz, d, t.solarNoon);
        const p = sunPosition(noonMs, place);
        const ref = 90 - Math.abs(place.lat - almanac(noonMs).decl);
        expect(Math.abs(p.altitudeGeometric - ref)).toBeLessThan(0.05);
        expect(p.altitude - p.altitudeGeometric).toBeGreaterThanOrEqual(0);
        expect(p.altitude - p.altitudeGeometric).toBeLessThan(0.6);
        expect(Math.abs(t.noonAltitude - p.altitude)).toBeLessThan(0.01);
      }
    }
  });
  it("azimuth is south at solar noon in the north and north in the south", () => {
    for (const d of SAMPLE_DAYS) {
      const north = sunPosition(localToUtc(MID.tz, d, sunTimes(MID, d).solarNoon), MID);
      expect(Math.abs(north.azimuth - 180)).toBeLessThan(1);
      const south = sunPosition(localToUtc(SOUTH.tz, d, sunTimes(SOUTH, d).solarNoon), SOUTH);
      expect(Math.min(south.azimuth, 360 - south.azimuth)).toBeLessThan(1);
    }
  });
  it("the sun rises in the east side and sets in the west side", () => {
    const d = { year: 2026, month: 2, day: 20 };
    const t = sunTimes(MID, d);
    expect(sunPosition(localToUtc(MID.tz, d, t.sunrise! + 0.5), MID).azimuth).toBeGreaterThan(60);
    expect(sunPosition(localToUtc(MID.tz, d, t.sunrise! + 0.5), MID).azimuth).toBeLessThan(120);
    expect(sunPosition(localToUtc(MID.tz, d, t.sunset! - 0.5), MID).azimuth).toBeGreaterThan(240);
    expect(sunPosition(localToUtc(MID.tz, d, t.sunset! - 0.5), MID).azimuth).toBeLessThan(300);
  });
  it("wraps longitudes, accepts a Date, degrades outside 1950 to 2050 without throwing", () => {
    const ms = Date.UTC(2026, 5, 21, 10);
    const a = sunPosition(ms, { lat: 49, lon: 16.6 });
    const b = sunPosition(ms, { lat: 49, lon: 16.6 + 360 });
    const c = sunPosition(new Date(ms), { lat: 49, lon: 16.6 - 360 });
    expect(b.azimuth).toBeCloseTo(a.azimuth, 9);
    expect(c.altitude).toBeCloseTo(a.altitude, 9);
    expect(Number.isFinite(sunPosition(Date.UTC(1850, 5, 21), MID).altitude)).toBe(true);
    expect(Number.isFinite(sunPosition(Date.UTC(2200, 5, 21), MID).altitude)).toBe(true);
    // the antimeridian: +180 and -180 are the same place
    expect(sunPosition(ms, { lat: 10, lon: 180 }).altitude).toBeCloseTo(sunPosition(ms, { lat: 10, lon: -180 }).altitude, 9);
  });
  it("defines the azimuth at the poles and rejects bad input", () => {
    const ms = Date.UTC(2026, 5, 21, 10);
    expect(sunPosition(ms, { lat: 90, lon: 0 }).azimuth).toBe(180);
    expect(sunPosition(ms, { lat: -90, lon: 0 }).azimuth).toBe(0);
    expect(() => sunPosition(NaN, MID)).toThrow(RangeError);
    expect(() => sunPosition(Infinity, MID)).toThrow(RangeError);
    expect(() => sunPosition(ms, { lat: 90.5, lon: 0 })).toThrow(RangeError);
    expect(() => sunPosition(ms, { lat: NaN, lon: 0 })).toThrow(RangeError);
    for (const az of [sunPosition(ms, { lat: 89.99, lon: 20 }).azimuth, sunPosition(ms, { lat: 0, lon: 0 }).azimuth]) {
      expect(az).toBeGreaterThanOrEqual(0);
      expect(az).toBeLessThan(360);
    }
  });
});

describe("sunTimes", () => {
  /** Sunrise, solar noon and sunset (UTC ms) by the hour-angle formula with the Almanac declination and equation of time, iterated. */
  function oracle(place: GeoPlace, d: CalendarDate) {
    const day0 = Date.UTC(d.year, d.month, d.day);
    const noonAt = (t: number) => day0 + (720 - 4 * place.lon - almanac(t).eot) * 60_000;
    let noon = noonAt(day0 + 12 * HOUR);
    for (let i = 0; i < 3; i++) noon = noonAt(noon);
    const h0 = (t: number) => {
      const decl = almanac(t).decl;
      return Math.acos((Math.sin(SUNRISE_ALTITUDE * RAD) - Math.sin(place.lat * RAD) * Math.sin(decl * RAD)) / (Math.cos(place.lat * RAD) * Math.cos(decl * RAD))) / RAD;
    };
    let rise = noon - 6 * HOUR, set = noon + 6 * HOUR;
    for (let i = 0; i < 6; i++) {
      rise = noonAt(rise) - 4 * h0(rise) * 60_000;
      set = noonAt(set) + 4 * h0(set) * 60_000;
    }
    return { rise, noon, set };
  }
  it("agrees with the hour-angle formula to 1 minute (both hemispheres, all seasons)", () => {
    for (const place of [MID, SOUTH, NORTH, INDIA]) {
      for (const d of SAMPLE_DAYS) {
        const t = sunTimes(place, d);
        expect(t.civilDayHours).toBe(24);
        const o = oracle(place, d);
        expect(Math.abs(localToUtc(place.tz, d, t.sunrise!) - o.rise) / 60_000).toBeLessThan(1);
        expect(Math.abs(localToUtc(place.tz, d, t.sunset!) - o.set) / 60_000).toBeLessThan(1);
        expect(Math.abs(localToUtc(place.tz, d, t.solarNoon) - o.noon) / 60_000).toBeLessThan(1);
      }
    }
  });
  it("day length is sunset minus sunrise in elapsed time (also on the days of the change)", () => {
    for (const d of [{ year: 2026, month: 2, day: 29 }, { year: 2026, month: 9, day: 25 }, { year: 2026, month: 5, day: 21 }]) {
      const t = sunTimes(MID, d);
      const up = localToUtc(MID.tz, d, t.sunrise!), down = localToUtc(MID.tz, d, t.sunset!);
      expect(t.dayLength).toBeCloseTo((down - up) / HOUR, 2);
      expect(t.polar).toBe("none");
    }
    // the change happens at night, so on the day itself both clock readings are after it and the difference is the elapsed time
    const t = sunTimes(MID, { year: 2026, month: 2, day: 29 });
    expect(t.dayLength).toBeCloseTo(t.sunset! - t.sunrise!, 2);
    // a sunset after midnight (high latitude, west of the zone meridian) is reported above 24, never before the sunrise
    const reykjavik = sunTimes(NORTH, { year: 2026, month: 5, day: 21 });
    expect(reykjavik.polar).toBe("none");
    expect(reykjavik.sunset!).toBeGreaterThan(24);
    expect(reykjavik.sunset! - reykjavik.sunrise!).toBeCloseTo(reykjavik.dayLength, 2);
  });
  it("the equator has about 12 hours all year", () => {
    for (const d of SAMPLE_DAYS) {
      const t = sunTimes(EQUATOR, d);
      expect(t.dayLength).toBeGreaterThan(11.9);
      expect(t.dayLength).toBeLessThan(12.3);
    }
  });
  it("midnight sun and polar night at the polar circle, ordinary days at its edge", () => {
    const june = sunTimes(ARCTIC, { year: 2026, month: 5, day: 21 });
    expect(june).toMatchObject({ polar: "day", sunrise: null, sunset: null, dayLength: 24 });
    const dec = sunTimes(ARCTIC, { year: 2026, month: 11, day: 21 });
    expect(dec).toMatchObject({ polar: "night", sunrise: null, sunset: null, dayLength: 0 });
    expect(dec.noonAltitude).toBeLessThan(0);
    const mar = sunTimes(ARCTIC, { year: 2026, month: 2, day: 20 });
    expect(mar.polar).toBe("none");
    expect(mar.sunrise).not.toBeNull();
    // the polar day is long near the solstice, short days around the equinox keep the usual symmetry
    expect(mar.dayLength).toBeGreaterThan(11);
    expect(mar.dayLength).toBeLessThan(13);
  });
  it("fractional zone: solar noon follows the longitude, not the zone", () => {
    const d = { year: 2026, month: 3, day: 15 };
    const t = sunTimes(INDIA, d);
    const eot = spencer(doy(d), 6).eot;
    const expected = 12 + 5.5 - INDIA.lon / 15 - eot / 60; // wall clock = solar noon in UT + the zone's offset
    expect(Math.abs(t.solarNoon - expected) * 60).toBeLessThan(3);
  });
  it("sunrise comes before noon before sunset; the arc is symmetric about solar noon", () => {
    for (const place of [MID, SOUTH, NORTH]) {
      for (const d of SAMPLE_DAYS) {
        const t = sunTimes(place, d);
        if (t.civilDayHours !== 24) continue;
        expect(t.sunrise!).toBeLessThan(t.solarNoon);
        expect(t.solarNoon).toBeLessThan(t.sunset!);
        const noon = localToUtc(place.tz, d, t.solarNoon);
        for (const minutes of [30, 90, 180, 240]) {
          const a = sunPosition(noon - minutes * 60_000, place), b = sunPosition(noon + minutes * 60_000, place);
          expect(Math.abs(a.altitude - b.altitude)).toBeLessThan(0.15);
          const sum = (a.azimuth + b.azimuth) % 360; // mirror images about the meridian add up to 360
          expect(Math.min(sum, 360 - sum)).toBeLessThan(2);
        }
      }
    }
  });
  it("is deterministic and does not depend on the clock", () => {
    const d = { year: 2026, month: 3, day: 15 };
    expect(sunTimes(MID, d)).toEqual(sunTimes(MID, d));
  });
});

describe("daily data", () => {
  it("sunArc: ascending samples above the minimum altitude, in elapsed steps, 23 / 25 hours on change days", () => {
    const d = { year: 2026, month: 5, day: 21 };
    const arc = sunArc(MID, d, { stepMinutes: 10 });
    expect(arc.length).toBeGreaterThan(80);
    arc.forEach((s, i) => {
      expect(s.altitude).toBeGreaterThanOrEqual(-0.5);
      if (i) expect(s.ms - arc[i - 1].ms).toBe(10 * 60_000);
      expect(s.localHours).toBeGreaterThanOrEqual(0);
      expect(s.localHours).toBeLessThan(24);
    });
    const all = (date: CalendarDate) => sunArc(MID, date, { stepMinutes: 60, minAltitude: -90 });
    expect(all({ year: 2026, month: 2, day: 29 })).toHaveLength(23);
    expect(all({ year: 2026, month: 9, day: 25 })).toHaveLength(25);
    expect(all(d)).toHaveLength(24);
    expect(() => sunArc(MID, d, { stepMinutes: 0 })).toThrow(RangeError);
  });
  it("sunArc starts and ends where the sun crosses the horizon", () => {
    const d = { year: 2026, month: 2, day: 20 };
    const arc = sunArc(MID, d, { stepMinutes: 5 });
    const t = sunTimes(MID, d);
    // the arc includes the sun down to -0.5 degrees, a few minutes before the upper limb appears; the step is 5 minutes
    expect(Math.abs(arc[0].localHours - t.sunrise!)).toBeLessThan(10 / 60);
    expect(Math.abs(arc[arc.length - 1].localHours - t.sunset!)).toBeLessThan(10 / 60);
  });
  it("sunDay: hour marks lie on full hours and are a subset of the hourly arc", () => {
    for (const d of [{ year: 2026, month: 5, day: 21 }, { year: 2026, month: 2, day: 29 }, { year: 2026, month: 9, day: 25 }]) {
      const day = sunDay(MID, d);
      const hourly = sunArc(MID, d, { stepMinutes: 60 });
      expect(day.hourMarks.length).toBeGreaterThan(8);
      for (const m of day.hourMarks) {
        expect(Number.isInteger(m.localHours)).toBe(true);
        expect(hourly.some((h) => h.ms === m.ms)).toBe(true);
      }
      expect(new Set(day.hourMarks.map((m) => m.localHours)).size).toBe(day.hourMarks.length);
      expect(day.times).toEqual(sunTimes(MID, d));
      expect(day.date).toEqual(d);
      expect(Math.abs(day.declination - almanac(localToUtc(MID.tz, d, day.times.solarNoon)).decl)).toBeLessThan(0.05);
    }
  });
  it("monthSummary has twelve months with the 15th as typical day", () => {
    const s = monthSummary(MID, 2026);
    expect(s).toHaveLength(12);
    s.forEach((m, i) => {
      expect(m.month).toBe(i);
      expect(m.date).toEqual({ year: 2026, month: i, day: 15 });
    });
    // day length is longest in June and shortest in December in the north
    const lens = s.map((m) => m.times.dayLength);
    expect(lens.indexOf(Math.max(...lens))).toBe(5);
    expect(lens.indexOf(Math.min(...lens))).toBe(11);
    const south = monthSummary(SOUTH, 2026).map((m) => m.times.dayLength);
    expect(south.indexOf(Math.max(...south))).toBe(11);
  });
  it("keyDays finds the solstices and the equinox from the declination", () => {
    const k = keyDays(MID, 2026);
    expect(k.summerSolstice.month).toBe(5);
    expect(k.summerSolstice.day).toBeGreaterThanOrEqual(20);
    expect(k.summerSolstice.day).toBeLessThanOrEqual(22);
    expect(k.winterSolstice.month).toBe(11);
    expect(k.winterSolstice.day).toBeGreaterThanOrEqual(20);
    expect(k.winterSolstice.day).toBeLessThanOrEqual(22);
    expect(k.equinox.month).toBe(2);
    expect(k.equinox.day).toBeGreaterThanOrEqual(19);
    expect(k.equinox.day).toBeLessThanOrEqual(21);
    expect(k.autumnEquinox.month).toBe(8);
    expect(k.autumnEquinox.day).toBeGreaterThanOrEqual(21);
    expect(k.autumnEquinox.day).toBeLessThanOrEqual(24);
    expect(Math.abs(sunTimes(MID, k.autumnEquinox).dayLength - 12)).toBeLessThan(0.35);
    // the same days in the southern hemisphere (declination does not depend on the latitude)
    expect(keyDays(SOUTH, 2026).summerSolstice.month).toBe(5);
    // equal day and night at the equinox
    expect(Math.abs(sunTimes(MID, k.equinox).dayLength - 12)).toBeLessThan(0.35);
    // a leap year has 366 days and still finds them
    expect(keyDays(MID, 2028).summerSolstice.month).toBe(5);
  });
});

describe("directions and surfaces", () => {
  it("sunDirection is a unit vector with the right axes", () => {
    for (const [az, alt, bearing] of [[0, 0, 0], [90, 30, 12], [200, 55, -20], [359, 89, 45], [123.4, -5, 12]] as const) {
      const v = sunDirection(az, alt, bearing);
      expect(Math.hypot(...v)).toBeCloseTo(1, 12);
    }
    const near = (a: Vec3, b: Vec3) => a.forEach((x, i) => expect(x).toBeCloseTo(b[i], 12));
    near(sunDirection(0, 0, 0), [0, 1, 0]);
    near(sunDirection(90, 0, 0), [1, 0, 0]);
    near(sunDirection(180, 0, 0), [0, -1, 0]);
    near(sunDirection(10, 90, 0), [0, 0, 1]);
    near(sunDirection(90, 45, 0), [Math.SQRT1_2, 0, Math.SQRT1_2]);
  });
  it("the bearing of the house axis shifts the azimuth", () => {
    for (const [az, alt, bearing] of [[100, 20, 12], [350, 40, 30], [180, 10, 270]] as const) {
      const a = sunDirection(az, alt, bearing), b = sunDirection(az - bearing, alt, 0);
      a.forEach((x, i) => expect(x).toBeCloseTo(b[i], 12));
    }
    // a sun due north-by-bearing stands on the house +y axis
    const v = sunDirection(37, 0, 37);
    expect(v[0]).toBeCloseTo(0, 12);
    expect(v[1]).toBeCloseTo(1, 12);
  });
  it("is the same formula as the 3D engine's sunDirectionHouse", () => {
    for (let az = 0; az < 360; az += 37) {
      for (const alt of [-3, 0, 12, 47, 89]) {
        for (const bearing of [0, 12, 250]) {
          const a = sunDirection(az, alt, bearing), b = sunDirectionHouse(az, alt, bearing);
          a.forEach((x, i) => expect(x).toBeCloseTo(b[i], 12));
        }
      }
    }
  });
  it("cosIncidence is max(0, n . d)", () => {
    expect(cosIncidence([0, 0, 1], [0, 0, 1])).toBe(1);
    expect(cosIncidence([0, 0, 1], [0, 0, -1])).toBe(0);
    expect(cosIncidence([1, 0, 0], [Math.SQRT1_2, 0, Math.SQRT1_2])).toBeCloseTo(Math.SQRT1_2, 12);
    expect(cosIncidence([0, 1, 0], [1, 0, 0])).toBe(0);
  });
  it("skyPoint: zenith in the centre, horizon on the circle, azimuth clockwise from the top", () => {
    expect(Math.hypot(skyPoint(123, 90, 100).x, skyPoint(123, 90, 100).y)).toBe(0);
    const n = skyPoint(0, 0, 100), e = skyPoint(90, 0, 100), s = skyPoint(180, 0, 100), w = skyPoint(270, 0, 100);
    expect(n.y).toBeCloseTo(-100, 9);
    expect(e.x).toBeCloseTo(100, 9);
    expect(s.y).toBeCloseTo(100, 9);
    expect(w.x).toBeCloseTo(-100, 9);
    expect(Math.hypot(skyPoint(77, 30, 90).x, skyPoint(77, 30, 90).y)).toBeCloseTo(60, 9);
    expect(Math.hypot(skyPoint(77, -10, 90).x, skyPoint(77, -10, 90).y)).toBeGreaterThan(90);
  });
  it("compassPoint covers eight sectors", () => {
    expect(compassPoint(0)).toBe("N");
    expect(compassPoint(359)).toBe("N");
    expect(compassPoint(44)).toBe("NE");
    expect(compassPoint(180)).toBe("S");
    expect(compassPoint(-90)).toBe("W");
    expect(new Set(Array.from({ length: 360 }, (_, a) => compassPoint(a)))).toEqual(new Set(COMPASS_POINTS));
  });
  it("sunHoursOnSurface: a horizontal plane gets the hours above the horizon (brute force)", () => {
    for (const place of [MID, SOUTH, NORTH]) {
      for (const d of SAMPLE_DAYS) {
        const h = sunHoursOnSurface(place, d, [0, 0, 1], 0, { stepMinutes: 1 });
        // brute force: every minute of the civil day
        const t0 = localToUtc(place.tz, d), t1 = localToUtc(place.tz, addDays(d, 1));
        let n = 0;
        for (let t = t0 + 30_000; t < t1; t += 60_000) if (sunPosition(t, place).altitude > 0) n++;
        expect(h.hours).toBeCloseTo(n / 60, 6);
        const coarse = sunHoursOnSurface(place, d, [0, 0, 1], 0);
        expect(Math.abs(coarse.hours - h.hours)).toBeLessThanOrEqual(10 / 60);
        // and about the day length of sunTimes (threshold differs by the refraction margin)
        expect(Math.abs(h.hours - sunTimes(place, d).dayLength)).toBeLessThan(0.25);
      }
    }
  });
  it("sunHoursOnSurface: a vertical south wall is symmetric about solar noon and a north wall is dark in winter", () => {
    const winter = { year: 2026, month: 11, day: 21 };
    for (const d of SAMPLE_DAYS) {
      const south = sunHoursOnSurface(MID, d, [0, -1, 0], 0, { stepMinutes: 5 });
      expect(south.hours).toBeGreaterThan(0);
      const noon = sunTimes(MID, d).solarNoon;
      expect(Math.abs((south.first! + south.last!) / 2 - noon)).toBeLessThan(0.1);
    }
    expect(sunHoursOnSurface(MID, winter, [0, 1, 0], 0).hours).toBe(0);
    expect(sunHoursOnSurface(MID, winter, [0, 1, 0], 0).first).toBeNull();
    // rotating the house with the bearing rotates the wall with it
    const a = sunHoursOnSurface(MID, SAMPLE_DAYS[5], [0, -1, 0], 0);
    // a wall facing true south in a house whose axis points 30 degrees east of north has the house azimuth 150
    const b = sunHoursOnSurface(MID, SAMPLE_DAYS[5], [Math.sin(150 * RAD), Math.cos(150 * RAD), 0], 30);
    expect(b.hours).toBeCloseTo(a.hours, 9);
  });
  it("sunHoursOnSurface: more sun on the south wall in winter than in summer at mid latitudes, more on the roof in summer", () => {
    const summer = SAMPLE_DAYS[5], winter = SAMPLE_DAYS[11];
    expect(sunHoursOnSurface(MID, winter, [0, -1, 0], 0).hours).toBeGreaterThan(0);
    expect(sunHoursOnSurface(MID, summer, [0, 0, 1], 0).hours).toBeGreaterThan(sunHoursOnSurface(MID, winter, [0, 0, 1], 0).hours + 5);
  });
});

describe("roof overhang", () => {
  const win = (depth: number, eave = 3, sill = 0.9, head = 2.1, az = 180) => ({ azimuthTrue: az, sill, head, overhang: { depth, eaveHeight: eave } });
  it("hand-computed cases", () => {
    // sun straight on, 45 degrees: the shadow reaches down to eave - depth
    expect(overhangShadedFraction(win(1), { azimuth: 180, altitude: 45 })).toBeCloseTo((2.1 - 2.0) / 1.2, 12);
    expect(overhangShadedFraction(win(2), { azimuth: 180, altitude: 45 })).toBeCloseTo((2.1 - 1.0) / 1.2, 12);
    expect(overhangShadedFraction(win(2.5), { azimuth: 180, altitude: 45 })).toBe(1);
    // oblique sun: profile angle atan(tan(30 deg) / cos(60 deg))
    const reach = 3 - 1.5 * Math.tan(Math.atan(Math.tan(30 * RAD) / Math.cos(60 * RAD)));
    expect(overhangShadedFraction(win(1.5), { azimuth: 240, altitude: 30 })).toBeCloseTo(Math.min(1, Math.max(0, (2.1 - reach) / 1.2)), 12);
    // a low sun does not reach the glass
    expect(overhangShadedFraction(win(1), { azimuth: 180, altitude: 10 })).toBe(0);
  });
  it("is zero behind the wall plane, below the horizon, without a roof and for a window without height", () => {
    expect(overhangShadedFraction(win(1), { azimuth: 270, altitude: 45 })).toBe(0);
    expect(overhangShadedFraction(win(1), { azimuth: 90, altitude: 45 })).toBe(0);
    expect(overhangShadedFraction(win(1), { azimuth: 0, altitude: 45 })).toBe(0);
    expect(overhangShadedFraction(win(1), { azimuth: 180, altitude: -5 })).toBe(0);
    expect(overhangShadedFraction({ ...win(1), overhang: null }, { azimuth: 180, altitude: 45 })).toBe(0);
    expect(overhangShadedFraction(win(1, 3, 2, 2), { azimuth: 180, altitude: 45 })).toBe(0);
  });
  it("is monotone in altitude and in depth and stays within 0..1", () => {
    let prev = 0;
    for (let alt = 1; alt <= 89; alt += 2) {
      const f = overhangShadedFraction(win(1), { azimuth: 200, altitude: alt });
      expect(f).toBeGreaterThanOrEqual(prev - 1e-12);
      expect(f).toBeLessThanOrEqual(1);
      prev = f;
    }
    prev = 0;
    for (let depth = 0; depth <= 4; depth += 0.25) {
      const f = overhangShadedFraction(win(depth), { azimuth: 160, altitude: 40 });
      expect(f).toBeGreaterThanOrEqual(prev - 1e-12);
      prev = f;
    }
  });
  it("daily shading: between 0 and 1, grows with depth, is larger in summer, zero for a wall that gets no sun", () => {
    const summer = SAMPLE_DAYS[5], winter = SAMPLE_DAYS[11];
    const s = overhangDailyShading(MID, summer, win(0.4)), w = overhangDailyShading(MID, winter, win(0.4));
    expect(s).toBeGreaterThan(w);
    expect(s).toBeGreaterThan(0);
    expect(s).toBeLessThanOrEqual(1);
    expect(overhangDailyShading(MID, summer, win(0.8))).toBeGreaterThan(s);
    expect(overhangDailyShading(MID, summer, win(0.1))).toBeLessThan(s);
    expect(overhangDailyShading(MID, summer, win(0))).toBeLessThan(0.05);
    expect(overhangDailyShading(MID, winter, win(0.4, 3, 0.9, 2.1, 0))).toBe(0); // north wall in December
    expect(overhangDailyShading(MID, summer, { ...win(1), overhang: null })).toBe(0);
  });
});
