// What the media build produces, as data: the plan (which render goes where), the output specification (sizes, formats,
// qualities, video settings), file naming with content hashes and the manifest schema (`media/1`, contract C4). Pure, no
// external tools; shared by scripts/build-media.ts and scripts/check-media.ts. See docs/MEDIA.md.
import { createHash } from "node:crypto";
import fs from "node:fs";
import { z } from "zod";
import type { RenderConfig } from "./render-schema";
import { expandRanges } from "./render-shots";

// ------------------------------------------------------------------------------------------------ output specification

export type ImageFormat = "jpg" | "webp" | "avif";

export interface ImageSpec {
  w: number;
  h: number;
  /** Encoder quality (magick -quality): JPEG 0-100, WebP 0-100, AVIF 0-100 (libheif). */
  q: number;
  format: ImageFormat;
}

/** Kept for older callers: a JPEG target. */
export type JpegSpec = Omit<ImageSpec, "format"> & { format?: "jpg" };

export interface VideoVariantSpec {
  w: number;
  h: number;
  /** Constant quality of the encode. */
  crf: number;
  /** Ceiling: a bigger file is encoded again with a higher CRF (a warning names it). */
  maxBytes: number;
}

export const SPEC = {
  /**
   * Scroll sequences: WebP (it decodes fast enough on phones for scrubbing; AVIF does not), a full and a 960 px landscape
   * variant, and the portrait frames of the phone camera (own renders, never a crop of the landscape frame).
   */
  day: {
    landscape: { w: 1920, h: 1080, q: 72, format: "webp" },
    small: { w: 960, h: 540, q: 72, format: "webp" },
    portrait: { w: 1080, h: 1620, q: 72, format: "webp" },
  },
  orbit: {
    landscape: { w: 1600, h: 900, q: 72, format: "webp" },
    small: { w: 960, h: 540, q: 72, format: "webp" },
    portrait: { w: 900, h: 1350, q: 72, format: "webp" },
    /** Phones load every second scroll frame: the portrait variant has a file for every `portraitStride`-th frame only. */
    portraitStride: 2,
  },
  /** Stills: AVIF + WebP + JPEG at these widths (never wider than the render), the main JPEG (`file`) at `main`. */
  stills: {
    main: { w: 1920, h: 1080 },
    widths: [640, 1280, 1920, 2560],
    quality: { avif: 50, webp: 76, jpg: 80 },
  },
  /** The share images: the render with the house name composited on it (scripts/lib/media-og.ts). */
  og: { w: 1200, h: 630, q: 86 },
  twitter: { w: 1200, h: 600, q: 86 },
  /** Posters of the 3D pages, captured from the web scene (scripts/posters.mjs), WebP. */
  posters: { q: 76, maxWidth: { desktop: 1600, phone: 1080 } },
  video: {
    variants: [
      { w: 1600, h: 900, crf: 21, maxBytes: 14_000_000 },
      { w: 960, h: 540, crf: 24, maxBytes: 5_000_000 },
    ] as readonly VideoVariantSpec[],
    preset: "slow",
    gop: 48,
    crfMax: 34,
    /** check-media: above this the page weight is a bug (an error); above a variant's maxBytes only a warning. */
    hardMaxBytes: 20_000_000,
  },
} as const satisfies Record<string, unknown>;

/** The poster of the video: the first frame at these widths (never wider than the video), formats and qualities of the stills. */
export const VIDEO_POSTER_WIDTHS = [640, 1280, 1600] as const;

export const STILL_CATEGORIES = ["exterior", "interior", "aerial", "detail"] as const;
export type StillCategory = (typeof STILL_CATEGORIES)[number];
export type Text = { cs: string; en: string };
export interface Crop {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Gallery category of a render category: the manifest knows exterior, interior, aerial and detail. */
export function stillCategory(c: RenderConfig["stills"][number]["category"]): StillCategory {
  return c === "evening" ? "exterior" : c;
}

/** The pages with a 3D stage and the two posters each gets. */
export const POSTER_PAGES = ["model", "sun"] as const;
export const POSTER_DEVICES = ["desktop", "phone"] as const;
export type PosterPage = (typeof POSTER_PAGES)[number];
export type PosterDevice = (typeof POSTER_DEVICES)[number];

// ------------------------------------------------------------------------------------------------ plan

export interface PlanStill {
  id: string;
  /** Logical base name of the render below the render output folder, without extension, e.g. "stills/aerial". */
  src: string;
  date: string;
  time: string;
  category: StillCategory;
  title: Text;
  alt: Text;
  /** false: part of the before/after slider only, not a gallery picture. */
  gallery: boolean;
}

export interface CompareSide {
  label: Text;
  title: Text;
  alt: Text;
}

export interface MediaPlan {
  day: {
    date: string;
    times: string[];
    stillTime: string;
    /** Size of the landscape renders. */
    size: [number, number];
    /** Landscape render of each time, same order as `times`. */
    src: string[];
    /** Portrait render of each time (the phone camera), or null when the config has no portrait camera. */
    portraitSrc: string[] | null;
  };
  orbit: {
    fps: number;
    frameCount: number;
    scrollStep: number;
    scrollCount: number;
    degPerFrame: number;
    startAzimuthDeg: number;
    direction: "clockwise" | "counterclockwise";
    /** Caption window (degrees of camera azimuth either side of a feature) from model/render.json. */
    captionHalfWindowDeg: number;
    /** All `frameCount` frames of the landscape variant (the video), in order. */
    videoSrc: string[];
    /** The `scrollCount` scroll frames of the landscape variant. */
    scrollSrc: string[];
    /** Own renders of the portrait variant for the scroll frames it is served at (every `portraitStride`-th), or null. */
    portraitSrc: string[] | null;
    /** The portrait variant has a file for every `portraitStride`-th scroll frame. */
    portraitStride: number;
  };
  /** Gallery stills first, then the two shots of the compare pair (the "before" one with `gallery: false` if so configured). */
  stills: PlanStill[];
  compare: { a: string; b: string; alt: Text; before: CompareSide; after: CompareSide };
  og: { src: string; alt: Text };
  /** Captures of the 3D pages (scripts/posters.mjs writes them into `<renders>/posters/`), optional. */
  posters: { page: PosterPage; device: PosterDevice; src: string }[];
}

export interface PlanOptions {
  /** Outline of the house (house frame, metres): a compare camera inside it makes the pair an interior view. */
  footprint?: readonly (readonly [number, number])[] | null;
}

const pad4 = (n: number): string => String(n).padStart(4, "0");

/** Is the point inside the polygon (even-odd rule)? */
export function insidePolygon(p: readonly [number, number], poly: readonly (readonly [number, number])[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** The outline of the house from generated/derived.json (`outer.pts`), or null when the file is missing or has none. */
export function readFootprint(derivedJson: string): [number, number][] | null {
  try {
    const d = JSON.parse(fs.readFileSync(derivedJson, "utf8")) as { outer?: { pts?: [number, number][] } };
    return Array.isArray(d.outer?.pts) && d.outer.pts.length >= 3 ? d.outer.pts : null;
  } catch {
    return null;
  }
}

export function planFromRender(cfg: RenderConfig, opts: PlanOptions = {}): MediaPlan {
  const times = expandRanges(cfg.day.ranges);
  if (!times.includes(cfg.day.stillTime)) throw new Error(`day.stillTime ${cfg.day.stillTime} is not one of the day times`);
  const o = cfg.orbit;
  const all = o.variants.find((v) => v.frameSelection === "all");
  if (!all) throw new Error("orbit needs a variant with frameSelection \"all\" (the video)");
  const portrait = o.variants.find((v) => v.frameSelection === "scroll");
  const scrollCount = Math.ceil(o.frameCount / o.scrollStep);
  const index = (k: number): number => k * o.scrollStep;
  const stride = SPEC.orbit.portraitStride;
  const stills: PlanStill[] = cfg.stills.map((s) => ({
    id: s.id,
    src: `stills/${s.id}`,
    date: s.date ?? cfg.date,
    time: s.time,
    category: stillCategory(s.category),
    title: s.label,
    alt: s.alt,
    gallery: true,
  }));
  const c = cfg.compare;
  const cam = c.camera.position;
  const compareCategory: StillCategory = opts.footprint && insidePolygon([cam[0], cam[1]], opts.footprint) ? "interior" : "exterior";
  for (const side of ["before", "after"] as const) {
    const s = c[side];
    stills.push({
      id: `${c.id}-${side}`,
      src: `compare/${c.id}-${side}`,
      date: cfg.date,
      time: s.time,
      category: compareCategory,
      title: s.title,
      alt: s.alt,
      gallery: s.gallery !== false,
    });
  }
  const side = (s: RenderConfig["compare"]["before"]): CompareSide => ({ label: s.label, title: s.title, alt: s.alt });
  const date = cfg.day.date ?? cfg.date;
  return {
    day: {
      date,
      times,
      stillTime: cfg.day.stillTime,
      size: cfg.day.size,
      src: times.map((t) => `day/${clockToken(t)}`),
      portraitSrc: cfg.day.portrait?.camera ? times.map((t) => `day/portrait/${clockToken(t)}`) : null,
    },
    orbit: {
      fps: o.fps,
      frameCount: o.frameCount,
      scrollStep: o.scrollStep,
      scrollCount,
      degPerFrame: Math.round((360 * o.scrollStep * 1e4) / o.frameCount) / 1e4,
      startAzimuthDeg: o.startAzimuthDeg,
      direction: o.direction,
      captionHalfWindowDeg: o.captions.halfWindowDeg,
      videoSrc: Array.from({ length: o.frameCount }, (_, i) => `orbit/${all.id}/${pad4(i)}`),
      scrollSrc: Array.from({ length: scrollCount }, (_, k) => `orbit/${all.id}/${pad4(index(k))}`),
      portraitSrc: portrait
        ? Array.from({ length: Math.ceil(scrollCount / stride) }, (_, j) => `orbit/${portrait.id}/${pad4(index(j * stride))}`)
        : null,
      portraitStride: stride,
    },
    stills,
    compare: { a: `${c.id}-before`, b: `${c.id}-after`, alt: c.alt, before: side(c.before), after: side(c.after) },
    og: { src: `og/${cfg.og.id}`, alt: cfg.og.alt },
    posters: POSTER_PAGES.flatMap((page) => POSTER_DEVICES.map((device) => ({ page, device, src: `posters/${page}-${device}` }))),
  };
}

// ------------------------------------------------------------------------------------------------ hashing and names

/** Length of the content hash in file names. */
export const HASH_LEN = 10;

export const sha256 = (data: Buffer | string): string => createHash("sha256").update(data).digest("hex");
/** Short content hash used in file names. */
export const shortHash = (data: Buffer | string): string => sha256(data).slice(0, HASH_LEN);

/** Hash of a sequence: SHA-256 over the bytes of all files in the given order, shortened. */
export function sequenceHash(files: readonly string[]): string {
  const h = createHash("sha256");
  for (const f of files) h.update(fs.readFileSync(f));
  return h.digest("hex").slice(0, HASH_LEN);
}

/** "08:05" -> "0805". */
export function clockToken(time: string): string {
  return time.replace(":", "");
}
const pad3 = (n: number): string => String(n).padStart(3, "0");

/** Expands {i}, {time} and {hash} of a pattern (same rules as src/lib/data/media.ts). */
export function expandPattern(pattern: string, t: { i?: number; time?: string; hash: string }): string {
  return pattern
    .replaceAll("{i}", t.i === undefined ? "{i}" : pad3(t.i))
    .replaceAll("{time}", t.time === undefined ? "{time}" : clockToken(t.time))
    .replaceAll("{hash}", t.hash);
}

/** Public path of the media folder: manifest paths are relative to `public/` and all start with this. */
export const MEDIA_PREFIX = "media/";

/** Disk path below the media folder (`dir`) of a manifest path; throws for a path outside of it. */
export function relInMedia(p: string): string {
  if (!p.startsWith(MEDIA_PREFIX)) throw new Error(`manifest path "${p}" does not start with ${MEDIA_PREFIX}`);
  return p.slice(MEDIA_PREFIX.length);
}

/** `name.<hash>.<ext>` */
export const hashedName = (name: string, hash: string, ext: string): string => `${name}.${hash}.${ext}`;
/** Pattern of generated, hash-carrying file names (used to keep the cleanup away from anything else). */
export const GENERATED_NAME = /^[\w-]+\.[0-9a-f]{10}\.(jpg|webp|avif|mp4)$/;
/** File extension of a manifest path. */
export const extOf = (p: string): string => /\.(\w+)$/.exec(p)?.[1] ?? "";

// ------------------------------------------------------------------------------------------------ manifest schema

// Same fields and rules as the schema in src/lib/data/media.ts (which reads the file on the web side), plus `inputHash`.
// scripts/__tests__/media.test.ts checks that both accept the same manifests. Everything added for contract C4 is optional,
// so a reader written against the first version keeps working.
const LocalizedText = z.object({ cs: z.string().min(1), en: z.string().min(1) });
const Dimension = z.number().int().positive();
const Clock = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "HH:MM");
const IsoDate = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/, "YYYY-MM-DD");
const PublicPath = z.string().regex(/^[\w][\w./-]*$/, "path relative to public/");
const Pattern = z.string().regex(/^[\w{][\w{}./-]*$/, "path pattern relative to public/");
const Hash = z.string().regex(/^[0-9a-f]{6,64}$/, "hex content hash");
const ImageFile = z.object({ file: PublicPath, width: Dimension, height: Dimension });
/** A lighter copy of a sequence variant (about 960 px wide), same frames. */
const SmallVariant = z.object({ pattern: Pattern, width: Dimension, height: Dimension });
const Variant = z.object({
  pattern: Pattern,
  width: Dimension,
  height: Dimension,
  /** Image format of the frames (default jpg). */
  format: z.enum(["jpg", "webp"]).optional(),
  small: SmallVariant.optional(),
  /** The variant has a file for every `stride`-th frame only (default 1): frame i is shown by the file of frame i - i % stride. */
  stride: z.number().int().min(1).optional(),
});
/** One width of a picture in up to three formats (paths relative to public/). */
const PictureVariant = z.object({ w: Dimension, h: Dimension, avif: PublicPath.optional(), webp: PublicPath.optional(), jpg: PublicPath.optional() });
const CompareSideSchema = z.object({ label: LocalizedText.optional(), title: LocalizedText.optional(), alt: LocalizedText.optional() });
const Poster = ImageFile;

const StillSchema = z.object({
  id: z.string().min(1),
  file: PublicPath,
  width: Dimension,
  height: Dimension,
  date: IsoDate,
  time: Clock,
  category: z.enum(STILL_CATEGORIES),
  title: LocalizedText,
  alt: LocalizedText,
  variants: z.array(PictureVariant).optional(),
  /** false: not a gallery picture (the "before" half of the slider). Default true. */
  gallery: z.boolean().optional(),
});

const VideoSchema = z.object({
  file: PublicPath,
  poster: PublicPath,
  width: Dimension,
  height: Dimension,
  fps: z.number().positive(),
  durationS: z.number().positive(),
  /** Every rendition, widest first; `file` is the widest. */
  variants: z.array(z.object({ w: Dimension, h: Dimension, file: PublicPath })).optional(),
  /** The poster (first frame) as a responsive picture. */
  posterVariants: z.array(PictureVariant).optional(),
});

export const mediaManifestSchema = z
  .object({
    schema: z.literal("media/1"),
    /** `hashModelFiles` of model/*.json the renders were made from (docs/HOUSE-FORMAT.md section 8); null when unknown. */
    inputHash: z.string().regex(/^[0-9a-f]{64}$/).nullish(),
    /** Day the media were built (ISO date). */
    builtAt: IsoDate.optional(),
    /** How many renders were stand-ins (another render used because the real one does not exist yet). Absent = none. */
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
    compare: z.object({
      a: z.string(),
      b: z.string(),
      alt: LocalizedText.optional(),
      before: CompareSideSchema.optional(),
      after: CompareSideSchema.optional(),
    }),
    og: ImageFile.extend({ twitter: ImageFile.optional(), alt: LocalizedText.optional() }),
    posters: z
      .object({
        model: z.object({ desktop: Poster, phone: Poster }).optional(),
        sun: z.object({ desktop: Poster, phone: Poster }).optional(),
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

export type MediaManifest = z.infer<typeof mediaManifestSchema>;
export type PictureVariantEntry = z.infer<typeof PictureVariant>;

/** Parses a manifest; throws one readable error that lists every problem. */
export function parseManifest(raw: unknown): MediaManifest {
  const r = mediaManifestSchema.safeParse(raw);
  if (r.success) return r.data;
  throw new Error(`media manifest is invalid:\n${r.error.issues.map((i) => `  ${i.path.join(".") || "(root)"}: ${i.message}`).join("\n")}`);
}

/** Frame indices that have a file in a variant with this stride: 0, stride, 2 * stride, ... below `frames`. */
export const strideIndices = (frames: number, stride = 1): number[] => Array.from({ length: Math.ceil(frames / stride) }, (_, j) => j * stride);

/** Role of a file in a sequence: "day.landscape", "day.landscape.small", "orbit.portrait", ... */
export type FileRole = string;

/**
 * Every path the manifest refers to (relative to public/), with its role and, for pictures, the pixel size it must have.
 * The frames of a sequence come in order (landscape, its small copy, portrait, its small copy), so the sequence hash can be
 * recomputed from this list.
 */
export function manifestFiles(m: MediaManifest): { path: string; role: FileRole; width?: number; height?: number }[] {
  const out: { path: string; role: FileRole; width?: number; height?: number }[] = [];
  const seq = (key: "day" | "orbit", k: "landscape" | "portrait", v: z.infer<typeof Variant> | undefined): void => {
    if (!v) return;
    const tokens =
      key === "day" ? m.day.times.map((time) => ({ time })) : strideIndices(m.orbit.frames, v.stride).map((i) => ({ i }));
    const hash = m[key].hash;
    for (const t of tokens) out.push({ path: expandPattern(v.pattern, { ...t, hash }), role: `${key}.${k}`, width: v.width, height: v.height });
    if (v.small) for (const t of tokens) out.push({ path: expandPattern(v.small.pattern, { ...t, hash }), role: `${key}.${k}.small`, width: v.small.width, height: v.small.height });
  };
  seq("day", "landscape", m.day.landscape);
  seq("day", "portrait", m.day.portrait);
  seq("orbit", "landscape", m.orbit.landscape);
  seq("orbit", "portrait", m.orbit.portrait);
  const pictures = (role: string, vs: readonly PictureVariantEntry[] | undefined, seen: Set<string>): void => {
    for (const v of vs ?? []) {
      for (const f of ["avif", "webp", "jpg"] as const) {
        const p = v[f];
        if (p && !seen.has(p)) {
          seen.add(p);
          out.push({ path: p, role: `${role}.${v.w}.${f}`, width: v.w, height: v.h });
        }
      }
    }
  };
  const video = m.orbit.video;
  if (video) {
    const files = new Set<string>([video.file]);
    out.push({ path: video.file, role: "orbit.video", width: video.width, height: video.height });
    for (const v of video.variants ?? []) {
      if (files.has(v.file)) continue;
      files.add(v.file);
      out.push({ path: v.file, role: `orbit.video.${v.w}`, width: v.w, height: v.h });
    }
    const posters = new Set<string>([video.poster]);
    out.push({ path: video.poster, role: "orbit.poster", width: video.width, height: video.height });
    pictures("orbit.poster", video.posterVariants, posters);
  }
  for (const s of m.stills) {
    const seen = new Set<string>([s.file]);
    out.push({ path: s.file, role: `still.${s.id}`, width: s.width, height: s.height });
    pictures(`still.${s.id}`, s.variants, seen);
  }
  out.push({ path: m.og.file, role: "og", width: m.og.width, height: m.og.height });
  if (m.og.twitter) out.push({ path: m.og.twitter.file, role: "og.twitter", width: m.og.twitter.width, height: m.og.twitter.height });
  for (const page of POSTER_PAGES) {
    const p = m.posters?.[page];
    if (p) for (const d of POSTER_DEVICES) out.push({ path: p[d].file, role: `poster.${page}.${d}`, width: p[d].width, height: p[d].height });
  }
  return out;
}

/** The frame sequence a role belongs to (its files share one hash), or null for a single file. */
export const sequenceOfRole = (role: string): "day" | "orbit" | null =>
  role.startsWith("day.") ? "day" : /^orbit\.(landscape|portrait)/.test(role) ? "orbit" : null;

/** Serialises a manifest the same way every time. */
export const manifestJson = (m: MediaManifest): string => `${JSON.stringify(m, null, 2)}\n`;
