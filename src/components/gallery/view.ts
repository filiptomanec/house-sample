// View model of the Gallery page: stills and the orbit video read from the media manifest (src/lib/data/media.ts), in the
// visitor's language. Plain JSON, so it crosses from the server page to the client component. Nothing here names a file or a
// category by hand: filters are made from the categories and times that the manifest actually contains.
import type { Locale } from "@/lib/i18n/config";
import { clockToMinutes, mediaUrl, STILL_CATEGORIES, type Media, type Still } from "@/lib/data/media";
import { matches, type GalleryFilter, type GalleryItem, type GalleryView } from "./filter";

/** Stills from this local time on count as "evening" (dusk and night renders). */
export const EVENING_FROM = "18:00";

export const isEvening = (s: Pick<Still, "time">): boolean => clockToMinutes(s.time) >= clockToMinutes(EVENING_FROM);

/** Filters worth showing: everything, each category that has stills, and "evening" when some still is an evening one. */
export function filtersOf(items: readonly Pick<GalleryItem, "category" | "evening">[]): GalleryFilter[] {
  const all: GalleryFilter["id"][] = ["all", ...STILL_CATEGORIES, "evening"];
  return all.map((id) => ({ id, count: items.filter((i) => matches(i, id)).length })).filter((f) => f.id === "all" || f.count > 0);
}

export function buildGalleryView(media: Media, locale: Locale): GalleryView {
  const items = media.stills.map((s): GalleryItem => ({
    id: s.id, src: mediaUrl(s.file), width: s.width, height: s.height, category: s.category, minutes: clockToMinutes(s.time), evening: isEvening(s),
    title: s.title[locale], alt: s.alt[locale],
  }));
  const v = media.orbit.video;
  return {
    items,
    filters: filtersOf(items),
    video: v ? { src: mediaUrl(v.file), poster: mediaUrl(v.poster), width: v.width, height: v.height, durationS: v.durationS } : null,
  };
}
