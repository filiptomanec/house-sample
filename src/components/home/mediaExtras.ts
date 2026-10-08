// What the start page reads from the media manifest beyond the fields every version has: responsive still variants, the gallery
// flag, the orbit's start, direction and caption windows, per-side labels, titles and alt texts of the before/after pair (contract
// C4). Each field is
// optional here, with a fallback, so the page works with the manifest of today and picks the fields up as soon as the media build
// writes them. Paths come from the manifest only (src/lib/data/media.ts); no media path is written here.

import { compareStills, mediaUrl, stillUrl, type Media, type Still } from "@/lib/data/media";
import type { Locale } from "@/lib/i18n/config";
import type { OrbitPath } from "./timeline";

type Localized = { cs: string; en: string };
/** One width of a still in up to three formats (paths relative to public/). */
export interface StillVariant { w: number; avif?: string; webp?: string; jpg?: string }
type StillExtras = { variants?: readonly StillVariant[]; gallery?: boolean };
/** `label` is the short tag on the picture ("Odpoledne"), `title` the full name ("Terasa odpoledne"). */
type CompareSide = { label?: Localized; title?: Localized; alt?: Localized };
/** The caption windows of the orbit as the render pipeline computed them (render-inputs `orbit.captions`). */
type OrbitCaptionWindow = { feature: string; azimuthDeg: number };
type MediaExtras = {
  orbit: { startAzimuthDeg?: number; direction?: OrbitPath["direction"]; captionHalfWindowDeg?: number; captions?: readonly OrbitCaptionWindow[] };
  compare: { before?: CompareSide; after?: CompareSide };
};

/** A picture ready for <picture>: modern formats as <source>, JPEG (or the file itself) on the <img>. */
export interface Picture {
  src: string;
  srcSet?: string;
  sources: { type: string; srcSet: string }[];
  width: number;
  height: number;
}

const srcSetOf = (vs: readonly StillVariant[], k: "avif" | "webp" | "jpg"): string =>
  vs.filter((v) => v[k]).sort((a, b) => a.w - b.w).map((v) => `${mediaUrl(v[k]!)} ${v.w}w`).join(", ");

/** The responsive picture of a still (a single file when the manifest has no variants yet). */
export function stillPicture(s: Still): Picture {
  const vs = (s as Still & StillExtras).variants ?? [];
  const sources = (["avif", "webp"] as const)
    .map((k) => ({ type: `image/${k}`, srcSet: srcSetOf(vs, k) }))
    .filter((x) => x.srcSet);
  const jpg = srcSetOf(vs, "jpg");
  return { src: stillUrl(s), srcSet: jpg || undefined, sources, width: s.width, height: s.height };
}

/** Is the still meant for galleries? (The "before" half of the comparison is not.) */
export const inGallery = (s: Still): boolean => (s as Still & StillExtras).gallery !== false;

/** Start azimuth, direction and caption window of the orbit as rendered (manifest), else as configured (render settings). */
export function orbitPath(m: Pick<Media, "orbit">, fallback: Pick<OrbitPath, "startAzimuthDeg" | "direction" | "halfWindowDeg">): OrbitPath {
  const o = m.orbit as Media["orbit"] & MediaExtras["orbit"];
  const halfWindowDeg = o.captionHalfWindowDeg ?? fallback.halfWindowDeg;
  return {
    startAzimuthDeg: o.startAzimuthDeg ?? fallback.startAzimuthDeg,
    direction: o.direction ?? fallback.direction,
    degPerFrame: m.orbit.degPerFrame,
    ...(halfWindowDeg !== undefined ? { halfWindowDeg } : {}),
  };
}

/**
 * The best-view azimuth of every caption feature as the render pipeline computed it, keyed by its word ("terrace", "pv"...);
 * empty when the manifest does not carry them (the page then computes them from the model, homeFacts.orbitFeatures).
 */
export function renderedCaptionAzimuths(m: Pick<Media, "orbit">): Readonly<Record<string, number>> {
  const caps = (m.orbit as Media["orbit"] & MediaExtras["orbit"]).captions ?? [];
  return Object.fromEntries(caps.filter((c) => Number.isFinite(c.azimuthDeg)).map((c) => [c.feature, c.azimuthDeg]));
}

/**
 * The two halves of the comparison with their own tags and alt texts when the manifest has them: `titleA`/`titleB` are what the
 * tag on each picture says before the time (the short label, else the title), null when the manifest names neither.
 */
export function compareSides(m: Media, locale: Locale): { a: Still; b: Still; titleA: string | null; titleB: string | null; altA: string; altB: string | null } {
  const { a, b } = compareStills(m);
  const c = m.compare as Media["compare"] & MediaExtras["compare"];
  return {
    a, b,
    titleA: c.before?.label?.[locale] ?? c.before?.title?.[locale] ?? null,
    titleB: c.after?.label?.[locale] ?? c.after?.title?.[locale] ?? null,
    altA: c.before?.alt?.[locale] ?? a.alt[locale],
    altB: c.after?.alt?.[locale] ?? null,
  };
}
