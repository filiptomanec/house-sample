// Media contract (docs/ARCHITECTURE.md section 4): `public/media/manifest.json` is written by the render pipeline and read here.
// No media path is written anywhere else in the code. A path in the manifest is relative to `public/`; the helpers below turn
// it into a URL ("/media/...") and expand the frame patterns.
//
// Manifest (`media/1`):
//   day      the scroll-driven "one day on the terrace": local date, one local time per frame (ascending), the still time,
//            landscape and (optional) portrait frame pattern with sizes. Frames are a static camera: neighbours can cross-fade.
//   orbit    the camera orbit: number of frames (one scroll position each), degrees per frame, patterns, optionally the MP4
//            (24 fps, real frames, no interpolation) and its poster. A moving camera: frames are shown whole.
//   stills   single renders: id, file, size, date and local time, category, bilingual title and alt text.
//   compare  the before/after pair (two still ids rendered from the same camera).
//   og       the Open Graph image.
// Patterns contain {i} (zero-based frame index, 3 digits), {time} (day only: local time as HHMM) and {hash} (the sequence's
// content hash). File names carry a content hash, so every file can be cached as immutable.
//
// `parseMedia` validates the file; `tests` (src/lib/data/__tests__/media.test.ts) check that every file the manifest names exists.

import { z } from "zod";
import manifestJson from "../../../public/media/manifest.json";
import type { CalendarDate } from "@/lib/calc/sun";

const LocalizedText = z.object({ cs: z.string().min(1), en: z.string().min(1) });
const Dimension = z.number().int().positive();
const Clock = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "HH:MM");
const IsoDate = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/, "YYYY-MM-DD");
const PublicPath = z.string().regex(/^[\w][\w./-]*$/, "path relative to public/");

const Pattern = z.string().regex(/^[\w{][\w{}./-]*$/, "path pattern relative to public/");
const Variant = z.object({ pattern: Pattern, width: Dimension, height: Dimension });
const Hash = z.string().regex(/^[0-9a-f]{6,64}$/, "hex content hash");

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
});

const VideoSchema = z.object({
  file: PublicPath,
  poster: PublicPath,
  width: Dimension,
  height: Dimension,
  fps: z.number().positive(),
  durationS: z.number().positive(),
});

export const MediaSchema = z
  .object({
    schema: z.literal("media/1"),
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
      landscape: Variant,
      portrait: Variant.optional(),
      video: VideoSchema.optional(),
    }),
    stills: z.array(StillSchema).min(1),
    compare: z.object({ a: z.string(), b: z.string() }),
    og: z.object({ file: PublicPath, width: Dimension, height: Dimension }),
  })
  .superRefine((m, ctx) => {
    const issue = (message: string, path: (string | number)[]) => ctx.addIssue({ code: "custom", message, path });
    const times = m.day.times;
    for (let i = 1; i < times.length; i++) if (times[i] <= times[i - 1]) issue("times must be strictly ascending", ["day", "times", i]);
    if (!times.includes(m.day.stillTime)) issue("stillTime must be one of times", ["day", "stillTime"]);
    for (const k of ["landscape", "portrait"] as const) {
      const v = m.day[k];
      if (v && !v.pattern.includes("{time}")) issue("a day pattern needs {time}", ["day", k, "pattern"]);
      const o = m.orbit[k];
      if (o && !o.pattern.includes("{i}")) issue("an orbit pattern needs {i}", ["orbit", k, "pattern"]);
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
export type FrameVariant = "landscape" | "portrait";
/** One scroll-driven sequence ready for the client: URLs, in order, and the pixel size of each variant. */
export type FrameSet = {
  landscape: { urls: string[]; width: number; height: number };
  portrait: { urls: string[]; width: number; height: number } | null;
};

/** Parses and validates a manifest (throws a ZodError that names the path). */
export function parseMedia(json: unknown): Media {
  return MediaSchema.parse(json);
}

/** The project's manifest, parsed once. */
export const media: Media = parseMedia(manifestJson);

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

export function dayFrame(index: number, variant: FrameVariant = "landscape", m: Media = media): string {
  const v = m.day[variant] ?? m.day.landscape;
  const time = m.day.times[index];
  if (time === undefined) throw new RangeError(`day frame ${index} out of range`);
  return mediaUrl(expandPattern(v.pattern, { time, hash: m.day.hash }));
}

export function dayFrames(m: Media = media): FrameSet {
  const urls = (variant: FrameVariant) => m.day.times.map((_, i) => dayFrame(i, variant, m));
  return {
    landscape: { urls: urls("landscape"), width: m.day.landscape.width, height: m.day.landscape.height },
    portrait: m.day.portrait ? { urls: urls("portrait"), width: m.day.portrait.width, height: m.day.portrait.height } : null,
  };
}

// ------------------------------------------------------------------------------------------------ the orbit sequence

export function orbitFrame(index: number, variant: FrameVariant = "landscape", m: Media = media): string {
  if (!Number.isInteger(index) || index < 0 || index >= m.orbit.frames) throw new RangeError(`orbit frame ${index} out of range`);
  const v = m.orbit[variant] ?? m.orbit.landscape;
  return mediaUrl(expandPattern(v.pattern, { i: index, hash: m.orbit.hash }));
}

export function orbitFrames(m: Media = media): FrameSet {
  const urls = (variant: FrameVariant) => Array.from({ length: m.orbit.frames }, (_, i) => orbitFrame(i, variant, m));
  return {
    landscape: { urls: urls("landscape"), width: m.orbit.landscape.width, height: m.orbit.landscape.height },
    portrait: m.orbit.portrait ? { urls: urls("portrait"), width: m.orbit.portrait.width, height: m.orbit.portrait.height } : null,
  };
}

/** Every public path the manifest refers to (used by the file-existence test and the privacy scan). */
export function allMediaPaths(m: Media = media): string[] {
  const out: string[] = [];
  for (const v of ["landscape", "portrait"] as const) {
    if (m.day[v]) for (const time of m.day.times) out.push(expandPattern(m.day[v]!.pattern, { time, hash: m.day.hash }));
    if (m.orbit[v]) for (let i = 0; i < m.orbit.frames; i++) out.push(expandPattern(m.orbit[v]!.pattern, { i, hash: m.orbit.hash }));
  }
  if (m.orbit.video) out.push(m.orbit.video.file, m.orbit.video.poster);
  for (const s of m.stills) out.push(s.file);
  out.push(m.og.file);
  return out;
}

// ------------------------------------------------------------------------------------------------ stills

export const stillUrl = (s: Still): string => mediaUrl(s.file);

/** Stills in manifest order, optionally of some categories. */
export function stills(filter?: { categories?: readonly StillCategory[] }, m: Media = media): Still[] {
  const cats = filter?.categories;
  return cats ? m.stills.filter((s) => cats.includes(s.category)) : [...m.stills];
}

/** The two stills of the before/after pair. */
export function compareStills(m: Media = media): { a: Still; b: Still } {
  const find = (id: string) => m.stills.find((s) => s.id === id)!;
  return { a: find(m.compare.a), b: find(m.compare.b) };
}

/** Local time of a still, minutes since midnight. */
export const stillMinutes = (s: Still): number => clockToMinutes(s.time);

/** Local date of a still (month 0-based). */
export function stillDate(s: Still): CalendarDate {
  const [year, month, day] = s.date.split("-").map(Number);
  return { year, month: month - 1, day };
}
