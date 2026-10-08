// Everything the "one day" hero needs from astronomy, computed once on the server for the date and the times of the day sequence
// in the media manifest: the sun at every frame (for the clock and the arc), the whole-day arc, the sun times and the windows of
// the captions. Pure and deterministic (no clock, no random numbers); the client only interpolates.

import { localToUtc, placeOf, sunArc, sunPosition, sunTimes, type CalendarDate, type GeoPlace } from "@/lib/calc/sun";
import type { House } from "@/lib/model/types";
import { dayDate, dayMinutes, type Media } from "@/lib/data/media";
import type { SunSpot } from "./sunArc";
import { momentWindows, type MomentWindow } from "./timeline";

export interface DayStory {
  date: CalendarDate;
  /** Local time of every frame, minutes since midnight. */
  minutes: number[];
  /** The sun at every frame. */
  sun: SunSpot[];
  /** The whole path of the sun above the horizon on that day. */
  path: SunSpot[];
  /** Sun times, wall-clock hours (null when the sun does not rise or set), the true azimuth of the sunrise. */
  times: { sunrise: number | null; sunriseAzimuth: number | null; solarNoon: number; sunset: number | null; noonAltitude: number };
  windows: MomentWindow[];
}

/** Sampling step of the drawn path, minutes. */
const PATH_STEP_MINUTES = 20;

export function buildDayStory(house: Pick<House, "location">, media: Pick<Media, "day">): DayStory {
  const place: GeoPlace = placeOf(house);
  const date = dayDate(media);
  const minutes = dayMinutes(media);
  const spot = (ms: number): SunSpot => {
    const p = sunPosition(ms, place);
    return { az: p.azimuth, alt: p.altitude };
  };
  const t = sunTimes(place, date);
  return {
    date,
    minutes,
    sun: minutes.map((m) => spot(localToUtc(place.tz, date, m / 60))),
    path: sunArc(place, date, { stepMinutes: PATH_STEP_MINUTES, minAltitude: 0 }).map((s) => ({ az: s.azimuth, alt: s.altitude })),
    times: {
      sunrise: t.sunrise,
      sunriseAzimuth: t.sunrise === null ? null : sunPosition(localToUtc(place.tz, date, t.sunrise), place).azimuth,
      solarNoon: t.solarNoon,
      sunset: t.sunset,
      noonAltitude: t.noonAltitude,
    },
    windows: momentWindows(t, minutes[0], minutes[minutes.length - 1]),
  };
}
