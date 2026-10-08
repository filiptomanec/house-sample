// Media contract (docs/ARCHITECTURE.md section 4, docs/MEDIA.md): `public/media/manifest.json` is written by the media build
// (scripts/build-media.ts) and read here. No media path is written anywhere else in the code. A path in the manifest is relative
// to `public/`; the helpers below turn it into a URL ("/media/...") and expand the frame patterns.
//
// Manifest (`media/1`; the fields of contract C4 are optional, so older manifests still parse):
//   day      the scroll-driven day: local date, one local time per frame (ascending), the still time, the landscape frames (WebP,
//            with a 960 px `small` copy) and the portrait frames of the phone camera. A static camera: neighbours can cross-fade.
//   orbit    the camera orbit: number of frames (one scroll position each), degrees per frame, start azimuth and direction, the
//            caption windows, patterns (the portrait variant has a file for every `stride`-th frame), the MP4 renditions (24 fps,
//            real frames, no interpolation) and the poster. A moving camera: frames are shown whole.
//   stills   single renders: id, the main JPEG, size, date and local time, category, bilingual title and alt text, responsive
//            `variants` (AVIF, WebP, JPEG per width) and `gallery: false` for pictures that only live in the slider.
//   compare  the before/after pair (two still ids rendered from the same camera) with a label, title and alt text per side.
//   og       the share image (the render with the house name) and its alt text; `posters` the first view of the 3D pages.
// Patterns contain {i} (zero-based frame index, 3 digits), {time} (day only: local time as HHMM) and {hash} (the sequence's
// content hash). File names carry a content hash, so every file can be cached as immutable.
//
// Manifest text is typeset on the way out: read titles and alt texts through `localized()` (Czech non-breaking spaces).
// `parseMedia` validates the file; src/lib/data/__tests__/media.test.ts checks that every file the manifest names exists.

import { z } from "zod";
import manifestJson from "../../../public/media/manifest.json";
import type { CalendarDate } from "@/lib/calc/sun";
import type { Locale } from "@/lib/i18n/config";
import { nb } from "@/lib/i18n/format";

const LocalizedText = z.object({ cs: z.string().min(1), en: z.string().min(1) });
const Dimension = z.number().int().positive();
const Clock = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "HH:MM");
const IsoDate = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/, "YYYY-MM-DD");
const PublicPath = z.string().regex(/^[\w][\w./-]*$/, "path relative to public/");

const Pattern = z.string().regex(/^[\w{][\w{}./-]*$/, "path pattern relative to public/");
const SmallVariant = z.object({ pattern: Pattern, width: Dimension, height: Dimension });
const Variant = z.object({
  pattern: Pattern,
  width: Dimension,
  height: Dimension,
  format: z.enum(["jpg", "webp"]).optional(),
  /** A lighter copy (about 960 px wide) of the same frames. */
  small: SmallVariant.optional(),
  /** A file for every `stride`-th frame only (default 1); frame i is shown by the file of frame i - i % stride. */
  stride: z.number().int().min(1).optional(),
});
const Hash = z.string().regex(/^[0-9a-f]{6,64}$/, "hex content hash");
const ImageFile = z.object({ file: PublicPath, width: Dimension, height: Dimension });
/** One width of a picture in up to three formats (paths relative to public/). */
const PictureVariant = z.object({ w: Dimension, h: Dimension, avif: PublicPath.optional(), webp: PublicPath.optional(), jpg: PublicPath.optional() });
const CompareSide = z.object({ label: LocalizedText.optional(), title: LocalizedText.optional(), alt: LocalizedText.optional() });

export const STILL_CATEGORIES = ["exterior", "interior", "aerial", "detail"] as const;
export type StillCategory = (typeof STILL_CATEGORIES)[number];

const StillSchema = z.object({
  id: z.string().min(1),
  file: PublicPath,
  width: Dimension,
  height: Dimension,
  /** Local date and time of day the light was rendered for. */
  date: IsoDate,
  time: Clock,
  category: z.enum(STILL_CATEGORIES),
  title: LocalizedText,
  alt: LocalizedText,
  /** The same picture as AVIF, WebP and JPEG at several widths (the widest is for the lightbox). */
  variants: z.array(PictureVariant).optional(),
  /** false: only part of the before/after slider, not a gallery picture. Default true. */
  gallery: z.boolean().optional(),
});

const VideoSchema = z.object({
  file: PublicPath,
  poster: PublicPath,
  width: Dimension,
  height: Dimension,
  fps: z.number().positive(),
  durationS: z.number().positive(),
  /** Every rendition, widest first (`file` is the widest). */
  variants: z.array(z.object({ w: Dimension, h: Dimension, file: PublicPath })).optional(),
  /** The poster (first frame) as a responsive picture. */
  posterVariants: z.array(PictureVariant).optional(),
});

export const MediaSchema = z
  .object({
    schema: z.literal("media/1"),
    builtAt: IsoDate.optional(),
    /** A proof build: this many renders were stand-ins (the pictures do not show what their texts say yet). */
    standIns: z.number().int().min(0).optional(),
    day: z.object({
      date: IsoDate,
      times: z.array(Clock).min(2),
      stillTime: Clock,
      hash: Hash,
      landscape: Variant,
      portrait: Variant.optional(),
    }),
    orbit: z.object({
      frames: z.number().int().min(2),
      degPerFrame: z.number().positive(),
      hash: Hash,
      startAzimuthDeg: z.number().optional(),
      direction: z.enum(["clockwise", "counterclockwise"]).optional(),
      captionHalfWindowDeg: z.number().positive().optional(),
      captions: z.array(z.object({ feature: z.string().min(1), azimuthDeg: z.number() })).optional(),
      landscape: Variant,
      portrait: Variant.optional(),
      video: VideoSchema.optional(),
    }),
    stills: z.array(StillSchema).min(1),
    compare: z.object({ a: z.string(), b: z.string(), alt: LocalizedText.optional(), before: CompareSide.optional(), after: CompareSide.optional() }),
    og: ImageFile.extend({ twitter: ImageFile.optional(), alt: LocalizedText.optional() }),
    posters: z
      .object({
        model: z.object({ desktop: ImageFile, phone: ImageFile }).optional(),
        sun: z.object({ desktop: ImageFile, phone: ImageFile }).optional(),
      })
      .optional(),
  })
  .superRefine((m, ctx) => {
    const issue = (message: string, path: (string | number)[]) => ctx.addIssue({ code: "custom", message, path });
    const times = m.day.times;
    for (let i = 1; i < times.length; i++) if (times[i] <= times[i - 1]) issue("times must be strictly ascending", ["day", "times", i]);
    if (!times.includes(m.day.stillTime)) issue("stillTime must be one of times", ["day", "stillTime"]);
    for (const k of ["landscape", "portrait"] as const) {
      const v = m.day[k];
      if (v && !v.pattern.includes("{time}")) issue("a day pattern needs {time}", ["day", k, "pattern"]);
      if (v?.small && !v.small.pattern.includes("{time}")) issue("a day pattern needs {time}", ["day", k, "small", "pattern"]);
      if (v?.stride && v.stride > 1) issue("day frames have no stride", ["day", k, "stride"]);
      const o = m.orbit[k];
      if (o && !o.pattern.includes("{i}")) issue("an orbit pattern needs {i}", ["orbit", k, "pattern"]);
      if (o?.small && !o.small.pattern.includes("{i}")) issue("an orbit pattern needs {i}", ["orbit", k, "small", "pattern"]);
    }
    const ids = new Set<string>();
    m.stills.forEach((s, i) => {
      if (ids.has(s.id)) issue(`duplicate still id ${s.id}`, ["stills", i, "id"]);
      ids.add(s.id);
    });
    for (const k of ["a", "b"] as const) if (!ids.has(m.compare[k])) issue(`unknown still ${m.compare[k]}`, ["compare", k]);
  });

export type Media = z.infer<typeof MediaSchema>;
export type Still = Media["stills"][number];
export type PictureVariant = z.infer<typeof PictureVariant>;
export type LocalizedText = z.infer<typeof LocalizedText>;
export type FrameVariant = "landscape" | "portrait";
/** One variant of a sequence for the client: URLs (one per frame, in order) and the pixel size; `small` is the 960 px copy. */
export type FrameSeqData = { urls: string[]; width: number; height: number; small?: { urls: string[]; width: number; height: number } };
/** One scroll-driven sequence ready for the client. */
export type FrameSet = {
  landscape: FrameSeqData;
  portrait: FrameSeqData | null;
};

/** Parses and validates a manifest (throws a ZodError that names the path). */
export function parseMedia(json: unknown): Media {
  return MediaSchema.parse(json);
}

/** The project's manifest, parsed once. */
export const media: Media = parseMedia(manifestJson);

// ------------------------------------------------------------------------------------------------ text

/** A text of the manifest in one language, typeset like every dictionary string (nb(): Czech non-breaking spaces). */
export function localized(text: LocalizedText, locale: Locale): string {
  return nb(text[locale], locale);
}

// ------------------------------------------------------------------------------------------------ paths and patterns

/** URL of a path relative to `public/`. */
export const mediaUrl = (path: string): string => `/${path.replace(/^\/+/, "")}`;

const pad3 = (n: number) => String(n).padStart(3, "0");
/** "08:05" -> "0805". */
export const clockToken = (time: string): string => time.replace(":", "");

/** Expands {i}, {time} and {hash} in a frame pattern. */
export function expandPattern(pattern: string, tokens: { i?: number; time?: string; hash: string }): string {
  return pattern
    .replaceAll("{i}", tokens.i === undefined ? "{i}" : pad3(tokens.i))
    .replaceAll("{time}", tokens.time === undefined ? "{time}" : clockToken(tokens.time))
    .replaceAll("{hash}", tokens.hash);
}

/** Minutes since midnight of "HH:MM". */
export const clockToMinutes = (time: string): number => {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
};

// ------------------------------------------------------------------------------------------------ the day sequence

/** The local date of the day sequence (month 0-based, like the calc modules). */
export function dayDate(m: Pick<Media, "day"> = media): CalendarDate {
  const [year, month, day] = m.day.date.split("-").map(Number);
  return { year, month: month - 1, day };
}

/** Local time of every day frame, minutes since midnight. */
export const dayMinutes = (m: Pick<Media, "day"> = media): number[] => m.day.times.map(clockToMinutes);

/** Index of the still frame (the frame shown with reduced motion). */
export const dayStillIndex = (m: Pick<Media, "day"> = media): number => Math.max(0, m.day.times.indexOf(m.day.stillTime));

export function dayFrame(index: number, variant: FrameVariant = "landscape", m: Media = media, small = false): string {
  const v = m.day[variant] ?? m.day.landscape;
  const time = m.day.times[index];
  if (time === undefined) throw new RangeError(`day frame ${index} out of range`);
  const pattern = small && v.small ? v.small.pattern : v.pattern;
  return mediaUrl(expandPattern(pattern, { time, hash: m.day.hash }));
}

export function dayFrames(m: Media = media): FrameSet {
  const seq = (variant: FrameVariant): FrameSeqData => {
    const v = m.day[variant] ?? m.day.landscape;
    const urls = (small: boolean) => m.day.times.map((_, i) => dayFrame(i, variant, m, small));
    return { urls: urls(false), width: v.width, height: v.height, ...(v.small ? { small: { urls: urls(true), width: v.small.width, height: v.small.height } } : {}) };
  };
  return { landscape: seq("landscape"), portrait: m.day.portrait ? seq("portrait") : null };
}

// ------------------------------------------------------------------------------------------------ the orbit sequence

/** URL of orbit frame `index`; in a variant with a stride, the file of the nearest earlier frame that has one. */
export function orbitFrame(index: number, variant: FrameVariant = "landscape", m: Media = media, small = false): string {
  if (!Number.isInteger(index) || index < 0 || index >= m.orbit.frames) throw new RangeError(`orbit frame ${index} out of range`);
  const v = m.orbit[variant] ?? m.orbit.landscape;
  const i = index - (index % (v.stride ?? 1));
  const pattern = small && v.small ? v.small.pattern : v.pattern;
  return mediaUrl(expandPattern(pattern, { i, hash: m.orbit.hash }));
}

/**
 * The orbit for the client: one URL per frame in every variant, so a frame index means the same camera angle everywhere. A variant
 * with a stride repeats the file of the frame before (a phone downloads it once; the browser cache serves the repeat).
 */
export function orbitFrames(m: Media = media): FrameSet {
  const seq = (variant: FrameVariant): FrameSeqData => {
    const v = m.orbit[variant] ?? m.orbit.landscape;
    const urls = (small: boolean) => Array.from({ length: m.orbit.frames }, (_, i) => orbitFrame(i, variant, m, small));
    return { urls: urls(false), width: v.width, height: v.height, ...(v.small ? { small: { urls: urls(true), width: v.small.width, height: v.small.height } } : {}) };
  };
  return { landscape: seq("landscape"), portrait: m.orbit.portrait ? seq("portrait") : null };
}

/** Frame indices of a variant that have a file of their own. */
const strideIndices = (frames: number, stride = 1): number[] => Array.from({ length: Math.ceil(frames / stride) }, (_, j) => j * stride);

/** Every public path the manifest refers to, each once (used by the file-existence test, the e2e media test and the privacy scan). */
export function allMediaPaths(m: Media = media): string[] {
  const out = new Set<string>();
  for (const v of ["landscape", "portrait"] as const) {
    const d = m.day[v];
    if (d) for (const time of m.day.times) for (const p of [d.pattern, d.small?.pattern]) if (p) out.add(expandPattern(p, { time, hash: m.day.hash }));
    const o = m.orbit[v];
    if (o) for (const i of strideIndices(m.orbit.frames, o.stride)) for (const p of [o.pattern, o.small?.pattern]) if (p) out.add(expandPattern(p, { i, hash: m.orbit.hash }));
  }
  const pictures = (vs: readonly PictureVariant[] | undefined) => {
    for (const v of vs ?? []) for (const f of [v.avif, v.webp, v.jpg]) if (f) out.add(f);
  };
  if (m.orbit.video) {
    out.add(m.orbit.video.file);
    out.add(m.orbit.video.poster);
    for (const v of m.orbit.video.variants ?? []) out.add(v.file);
    pictures(m.orbit.video.posterVariants);
  }
  for (const s of m.stills) {
    out.add(s.file);
    pictures(s.variants);
  }
  out.add(m.og.file);
  if (m.og.twitter) out.add(m.og.twitter.file);
  for (const page of ["model", "sun"] as const) {
    const p = m.posters?.[page];
    if (p) out.add(p.desktop.file).add(p.phone.file);
  }
  return [...out];
}

// ------------------------------------------------------------------------------------------------ pictures

/** A responsive picture: AVIF and WebP as <source> sets, JPEG (or the single file) on the <img>, with its intrinsic size. */
export interface Picture {
  src: string;
  srcSet?: string;
  sources: { type: string; srcSet: string }[];
  width: number;
  height: number;
}

const srcSetOf = (vs: readonly PictureVariant[], k: "avif" | "webp" | "jpg"): string =>
  vs.filter((v) => v[k]).sort((a, b) => a.w - b.w).map((v) => `${mediaUrl(v[k]!)} ${v.w}w`).join(", ");

/** The <picture> data of a file with optional variants (a single file when there are none). */
export function pictureOf(file: string, width: number, height: number, variants: readonly PictureVariant[] = []): Picture {
  const sources = (["avif", "webp"] as const).map((k) => ({ type: `image/${k}`, srcSet: srcSetOf(variants, k) })).filter((x) => x.srcSet);
  const jpg = srcSetOf(variants, "jpg");
  return { src: mediaUrl(file), ...(jpg ? { srcSet: jpg } : {}), sources, width, height };
}

/** The responsive picture of a still. */
export const stillPicture = (s: Still): Picture => pictureOf(s.file, s.width, s.height, s.variants);

// ------------------------------------------------------------------------------------------------ stills

export const stillUrl = (s: Still): string => mediaUrl(s.file);

/** Is the still a gallery picture? (The "before" half of the slider is not.) */
export const inGallery = (s: Pick<Still, "gallery">): boolean => s.gallery !== false;

/** Stills in manifest order, optionally of some categories and only the gallery pictures. */
export function stills(filter?: { categories?: readonly StillCategory[]; gallery?: boolean }, m: Media = media): Still[] {
  const cats = filter?.categories;
  return m.stills.filter((s) => (!cats || cats.includes(s.category)) && (!filter?.gallery || inGallery(s)));
}

/** The two stills of the before/after pair. */
export function compareStills(m: Media = media): { a: Still; b: Still } {
  const find = (id: string) => m.stills.find((s) => s.id === id)!;
  return { a: find(m.compare.a), b: find(m.compare.b) };
}

/** Local time of a still, minutes since midnight. */
export const stillMinutes = (s: Still): number => clockToMinutes(s.time);

/** Local date of a still (month 0-based). */
export function stillDate(s: Pick<Still, "date">): CalendarDate {
  const [year, month, day] = s.date.split("-").map(Number);
  return { year, month: month - 1, day };
}

// ------------------------------------------------------------------------------------------------ video, share image, posters

/** The renditions of the orbit video, widest first (the single file when the manifest has no list). */
export function videoRenditions(m: Media = media): { src: string; width: number; height: number }[] {
  const v = m.orbit.video;
  if (!v) return [];
  const list = v.variants?.length ? [...v.variants].sort((a, b) => b.w - a.w) : [{ w: v.width, h: v.height, file: v.file }];
  return list.map((r) => ({ src: mediaUrl(r.file), width: r.w, height: r.h }));
}

/** The poster of the orbit video as a responsive picture. */
export function videoPoster(m: Media = media): Picture | null {
  const v = m.orbit.video;
  return v ? pictureOf(v.poster, v.width, v.height, v.posterVariants) : null;
}

/** Alt text of the share image in one language (typeset), or null when the manifest has none. */
export const ogAlt = (locale: Locale, m: Media = media): string | null => (m.og.alt ? localized(m.og.alt, locale) : null);

export type PosterPage = "model" | "sun";
/** The first view of a 3D page (captured from the web scene) for desktop and phone, or null before the posters exist. */
export function posterOf(page: PosterPage, m: Media = media): { desktop: { src: string; width: number; height: number }; phone: { src: string; width: number; height: number } } | null {
  const p = m.posters?.[page];
  if (!p) return null;
  const one = (x: { file: string; width: number; height: number }) => ({ src: mediaUrl(x.file), width: x.width, height: x.height });
  return { desktop: one(p.desktop), phone: one(p.phone) };
}
