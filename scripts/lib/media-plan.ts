// What the media build produces, as data: the plan (which render goes where), the output specification (sizes, JPEG qualities,
// video limits), file naming with content hashes and the manifest schema (`media/1`). Pure, no external tools; shared by
// scripts/build-media.ts and scripts/check-media.ts. See docs/MEDIA.md.
import { createHash } from "node:crypto";
import fs from "node:fs";
import { z } from "zod";
import type { RenderConfig } from "./render-schema";
import { expandRanges } from "./render-shots";

// ------------------------------------------------------------------------------------------------ output specification

export interface JpegSpec {
  w: number;
  h: number;
  /** JPEG quality (magick -quality). */
  q: number;
}

export const SPEC = {
  day: { landscape: { w: 1920, h: 1080, q: 80 }, portrait: { w: 800, h: 1200, q: 78 } },
  orbit: { landscape: { w: 1600, h: 900, q: 80 }, portrait: { w: 600, h: 900, q: 78 } },
  stills: { w: 1920, h: 1080, q: 84 },
  og: { w: 1200, h: 630, q: 86 },
  twitter: { w: 1200, h: 600, q: 86 },
  video: {
    w: 1600,
    h: 900,
    preset: "slow",
    gop: 48,
    crfStart: 18,
    crfMin: 12,
    crfMax: 34,
    minBytes: 10_000_000,
    maxBytes: 14_000_000,
    targetBytes: 12_000_000,
    /** check-media: above this the page weight is a bug, between maxBytes and this only a warning. */
    hardMaxBytes: 20_000_000,
  },
  /** The two shots of the before/after pair have no category in model/render.json; they are views into a room. */
  compareCategory: "interior",
} as const;

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
}

export interface MediaPlan {
  day: {
    date: string;
    times: string[];
    stillTime: string;
    /** Size of the renders the portrait crop box refers to. */
    size: [number, number];
    crop: Crop;
    /** Source of each time, same order as `times`. */
    src: string[];
  };
  orbit: {
    fps: number;
    frameCount: number;
    scrollStep: number;
    scrollCount: number;
    degPerFrame: number;
    /** All `frameCount` frames of the landscape variant (the video), in order. */
    videoSrc: string[];
    /** The `scrollCount` scroll frames of the landscape variant. */
    scrollSrc: string[];
    /** Own renders of the portrait variant (one per scroll frame) or null when the config has none. */
    portraitSrc: string[] | null;
  };
  /** Gallery stills first, then the two shots of the compare pair. */
  stills: PlanStill[];
  compare: { a: string; b: string };
  og: { src: string };
}

const pad4 = (n: number): string => String(n).padStart(4, "0");

/** Portrait crop box of the day frames; the same rule as `buildDay` in scripts/lib/render-shots.ts. */
export function dayCrop(d: RenderConfig["day"]): Crop {
  const [w, h] = d.size;
  const even = (v: number): number => Math.round(v / 2) * 2;
  const cw = Math.min(w, even((h * d.portrait.aspect[0]) / d.portrait.aspect[1]));
  const cx = Math.max(0, Math.min(w - cw, even(d.portrait.centerX * w - cw / 2)));
  return { x: cx, y: 0, width: cw, height: h };
}

export function planFromRender(cfg: RenderConfig): MediaPlan {
  const times = expandRanges(cfg.day.ranges);
  if (!times.includes(cfg.day.stillTime)) throw new Error(`day.stillTime ${cfg.day.stillTime} is not one of the day times`);
  const o = cfg.orbit;
  const all = o.variants.find((v) => v.frameSelection === "all");
  if (!all) throw new Error("orbit needs a variant with frameSelection \"all\" (the video)");
  const portrait = o.variants.find((v) => v.frameSelection === "scroll");
  const scrollCount = Math.ceil(o.frameCount / o.scrollStep);
  const index = (k: number): number => k * o.scrollStep;
  const stills: PlanStill[] = cfg.stills.map((s) => ({
    id: s.id,
    src: `stills/${s.id}`,
    date: s.date ?? cfg.date,
    time: s.time,
    category: stillCategory(s.category),
    title: s.label,
    alt: s.alt,
  }));
  const c = cfg.compare;
  for (const side of ["before", "after"] as const) {
    const label = c[side].label;
    stills.push({
      id: `${c.id}-${side}`,
      src: `compare/${c.id}-${side}`,
      date: cfg.date,
      time: c[side].time,
      category: SPEC.compareCategory,
      title: label,
      alt: { cs: `${label.cs}. ${c.alt.cs}`, en: `${label.en}. ${c.alt.en}` },
    });
  }
  return {
    day: {
      date: cfg.day.date ?? cfg.date,
      times,
      stillTime: cfg.day.stillTime,
      size: cfg.day.size,
      crop: dayCrop(cfg.day),
      src: times.map((t) => `day/${t.replace(":", "")}`),
    },
    orbit: {
      fps: o.fps,
      frameCount: o.frameCount,
      scrollStep: o.scrollStep,
      scrollCount,
      degPerFrame: Math.round((360 * o.scrollStep * 1e4) / o.frameCount) / 1e4,
      videoSrc: Array.from({ length: o.frameCount }, (_, i) => `orbit/${all.id}/${pad4(i)}`),
      scrollSrc: Array.from({ length: scrollCount }, (_, k) => `orbit/${all.id}/${pad4(index(k))}`),
      portraitSrc: portrait ? Array.from({ length: scrollCount }, (_, k) => `orbit/${portrait.id}/${pad4(index(k))}`) : null,
    },
    stills,
    compare: { a: `${c.id}-before`, b: `${c.id}-after` },
    og: { src: `og/${cfg.og.id}` },
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
export const clockToken = (time: string): string => time.replace(":", "");
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
export const GENERATED_NAME = /^[\w-]+\.[0-9a-f]{10}\.(jpg|mp4)$/;

// ------------------------------------------------------------------------------------------------ manifest schema

// Same fields and rules as the schema in src/lib/data/media.ts (which reads the file on the web side), plus `inputHash` and
// the optional Twitter image. scripts/__tests__/media.test.ts checks that both accept the same manifests.
const LocalizedText = z.object({ cs: z.string().min(1), en: z.string().min(1) });
const Dimension = z.number().int().positive();
const Clock = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "HH:MM");
const IsoDate = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/, "YYYY-MM-DD");
const PublicPath = z.string().regex(/^[\w][\w./-]*$/, "path relative to public/");
const Pattern = z.string().regex(/^[\w{][\w{}./-]*$/, "path pattern relative to public/");
const Variant = z.object({ pattern: Pattern, width: Dimension, height: Dimension });
const Hash = z.string().regex(/^[0-9a-f]{6,64}$/, "hex content hash");
const ImageFile = z.object({ file: PublicPath, width: Dimension, height: Dimension });

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
});

const VideoSchema = z.object({
  file: PublicPath,
  poster: PublicPath,
  width: Dimension,
  height: Dimension,
  fps: z.number().positive(),
  durationS: z.number().positive(),
});

export const mediaManifestSchema = z
  .object({
    schema: z.literal("media/1"),
    /** `hashModelFiles` of model/*.json the renders were made from (docs/HOUSE-FORMAT.md section 8); null when unknown. */
    inputHash: z.string().regex(/^[0-9a-f]{64}$/).nullish(),
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
    og: ImageFile.extend({ twitter: ImageFile.optional() }),
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

export type MediaManifest = z.infer<typeof mediaManifestSchema>;

/** Parses a manifest; throws one readable error that lists every problem. */
export function parseManifest(raw: unknown): MediaManifest {
  const r = mediaManifestSchema.safeParse(raw);
  if (r.success) return r.data;
  throw new Error(`media manifest is invalid:\n${r.error.issues.map((i) => `  ${i.path.join(".") || "(root)"}: ${i.message}`).join("\n")}`);
}

/** Every path the manifest refers to (relative to public/), with its role; the frames of a sequence are in order. */
export function manifestFiles(m: MediaManifest): { path: string; role: string }[] {
  const out: { path: string; role: string }[] = [];
  const day: [string, typeof m.day.landscape | undefined][] = [["landscape", m.day.landscape], ["portrait", m.day.portrait]];
  for (const [k, v] of day) if (v) for (const time of m.day.times) out.push({ path: expandPattern(v.pattern, { time, hash: m.day.hash }), role: `day.${k}` });
  const orbit: [string, typeof m.orbit.landscape | undefined][] = [["landscape", m.orbit.landscape], ["portrait", m.orbit.portrait]];
  for (const [k, v] of orbit) if (v) for (let i = 0; i < m.orbit.frames; i++) out.push({ path: expandPattern(v.pattern, { i, hash: m.orbit.hash }), role: `orbit.${k}` });
  if (m.orbit.video) {
    out.push({ path: m.orbit.video.file, role: "orbit.video" }, { path: m.orbit.video.poster, role: "orbit.poster" });
  }
  for (const s of m.stills) out.push({ path: s.file, role: `still.${s.id}` });
  out.push({ path: m.og.file, role: "og" });
  if (m.og.twitter) out.push({ path: m.og.twitter.file, role: "og.twitter" });
  return out;
}

/** Serialises a manifest the same way every time. */
export const manifestJson = (m: MediaManifest): string => `${JSON.stringify(m, null, 2)}\n`;
