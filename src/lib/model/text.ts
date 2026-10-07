// Small helpers for bilingual text and display of model values.
import { ROOM_TYPE_NAMES, type LocalizedText } from "./catalog";
import type { Locale } from "./types";

/** Picks the text of a locale from a bilingual value. */
export const pick = (t: LocalizedText, locale: Locale): string => t[locale];

/** Name of a room type in a locale ("garage" -> "garáž"). */
export const roomTypeName = (type: keyof typeof ROOM_TYPE_NAMES, locale: Locale): string => ROOM_TYPE_NAMES[type][locale];
