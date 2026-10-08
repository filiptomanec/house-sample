// View model of the Gallery page: stills and the orbit video read from the media manifest (src/lib/data/media.ts), in the
// visitor's language, captioned with the date, the time and where the sun stood (computed for the house's place, so every caption
// is true to its render). Plain JSON, so it crosses from the server page to the client component. Nothing here names a file or a
// category by hand: filters are made from the categories and the light that the manifest actually contains.
import { compassPoint, localToUtc, sunPosition, type GeoPlace } from "@/lib/calc/sun";
import { dayMonth } from "@/lib/calendar";
import type { Locale } from "@/lib/i18n/config";
import { getFormatter } from "@/lib/i18n/format";
import { getT } from "@/lib/i18n/server";
import { clockToMinutes, inGallery, localized, stillDate, stillPicture, STILL_CATEGORIES, videoPoster, videoRenditions, type Media, type Still } from "@/lib/data/media";
import { matches, type GalleryFilter, type GalleryItem, type GalleryView } from "./filter";

/** A filter is offered only when it holds at least this many pictures (a filter of one or two reads as a mistake). */
export const MIN_FILTER_ITEMS = 3;
/** "Evening" light: after solar noon with the sun lower than this (golden hour, sunset and dusk). */
export const EVENING_BELOW_DEG = 12;

/** Where the sun stood for a still: altitude (degrees, with refraction), true azimuth and the hour angle (negative before noon). */
export function sunOf(s: Pick<Still, "date" | "time">, place: GeoPlace): { altitude: number; azimuth: number; hourAngle: number } {
  const ms = localToUtc(place.tz, stillDate(s), clockToMinutes(s.time) / 60);
  const p = sunPosition(ms, place);
  return { altitude: p.altitude, azimuth: p.azimuth, hourAngle: p.hourAngle };
}

export const isEvening = (sun: { altitude: number; hourAngle: number }): boolean => sun.hourAngle > 0 && sun.altitude < EVENING_BELOW_DEG;

/** The caption of a still: "21. června, 20:15 · slunce 4° nad obzorem na severozápadě" (gallery.caption, typeset by t()). */
export function captionOf(s: Pick<Still, "date" | "time">, place: GeoPlace, locale: Locale): string {
  const t = getT(locale), f = getFormatter(locale);
  const d = stillDate(s);
  const sun = sunOf(s, place);
  const altitude = Math.round(sun.altitude);
  const where = altitude > 0
    ? t("gallery.sun.above", { altitude: f.degrees(altitude, 0), direction: t(`gallery.compass.${compassPoint(sun.azimuth)}`) })
    : t("gallery.sun.below");
  return t("gallery.caption", { date: dayMonth(locale, d.month, d.day), time: f.clock(clockToMinutes(s.time)), sun: where });
}

/**
 * Filters worth offering: "all", then each category and "evening" when they hold at least MIN_FILTER_ITEMS pictures and fewer
 * than all of them. No filters at all when nothing is left to choose besides "all".
 */
export function filtersOf(items: readonly Pick<GalleryItem, "category" | "evening">[]): GalleryFilter[] {
  const ids: GalleryFilter["id"][] = [...STILL_CATEGORIES, "evening"];
  const useful = ids
    .map((id) => ({ id, count: items.filter((i) => matches(i, id)).length }))
    .filter((f) => f.count >= MIN_FILTER_ITEMS && f.count < items.length);
  return useful.length ? [{ id: "all", count: items.length }, ...useful] : [];
}

export function buildGalleryView(media: Media, locale: Locale, place: GeoPlace): GalleryView {
  const items = media.stills.filter(inGallery).map((s): GalleryItem => {
    const picture = stillPicture(s);
    return {
      id: s.id, picture, src: picture.src, width: s.width, height: s.height, category: s.category, minutes: clockToMinutes(s.time),
      evening: isEvening(sunOf(s, place)), title: localized(s.title, locale), alt: localized(s.alt, locale), caption: captionOf(s, place, locale),
    };
  });
  const v = media.orbit.video;
  const sources = videoRenditions(media);
  return {
    items,
    filters: filtersOf(items),
    video: v ? { sources, src: sources[0].src, poster: videoPoster(media)!, width: v.width, height: v.height, durationS: v.durationS } : null,
  };
}
