// The sun of the 3D page: a few times of the summer-solstice day at the place of the house. Pure (no React, no three.js);
// the astronomy is calc/sun.ts, the presets are in settings.ts.
import assumptions from "../../../model/assumptions.json";
import { dayOfYear } from "@/lib/calendar";
import { keyDays, localToUtc, placeOf, sunPosition, sunTimes, type CalendarDate } from "@/lib/calc/sun";
import type { House } from "@/lib/model/types";
import { presetHours, type DayPreset } from "./settings";

export interface Daylight {
  /** True azimuth and altitude of the sun, degrees. */
  azimuth: number;
  altitude: number;
  /** The day (summer solstice of the reference year) and the clock time of the preset on it. */
  date: CalendarDate;
  hours: number;
  /** Day of the year, for the leaves of deciduous trees. */
  dayOfYear: number;
}

/** The sun at a preset time of the summer solstice at the place of the house (time zone and daylight saving included). */
export function daylightAt(house: Pick<House, "location">, preset: DayPreset): Daylight {
  const place = placeOf(house);
  const date = keyDays(place, assumptions.climate.referenceYear).summerSolstice;
  const hours = presetHours(sunTimes(place, date), preset);
  const sun = sunPosition(localToUtc(place.tz, date, hours), place);
  return { azimuth: sun.azimuth, altitude: sun.altitude, date, hours, dayOfYear: dayOfYear(date.month, date.day) };
}

/** The solstice day itself (for the caption of the day control). */
export function solsticeDate(house: Pick<House, "location">): CalendarDate {
  return keyDays(placeOf(house), assumptions.climate.referenceYear).summerSolstice;
}
