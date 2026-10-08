// Turns the Blender renders (pipeline/out) into the media of the web (public/media) and writes public/media/manifest.json.
//
//   npx tsx scripts/build-media.ts                      all sections (needs ImageMagick; ffmpeg for the video)
//   npx tsx scripts/build-media.ts --only day,stills    some sections: day, orbit, stills, og, video, posters
//   npx tsx scripts/build-media.ts --partial            build what the renders offer, keep the rest as it is
//   npx tsx scripts/build-media.ts --stand-ins [--stand-in-map file.json]
//                                                       a proof build: a missing render is replaced by the nearest existing one
//   options: --in <renders dir>  --out <media dir>  --no-video  --no-prune  --no-check  --force  --jobs <n>  --video-mb <max|lo-hi>
//            --cache <file>  --render <render.json>  --model-dir <dir>  --render-inputs <file>  --derived <file>  --app-dir <dir>
//            --no-app  --built-at <YYYY-MM-DD>  --quiet
//   tools:   MAGICK and FFMPEG (paths) override the search in PATH and the standard locations.
//
// Everything is built in a staging folder inside the output folder and moved into place only when every file of every built
// section is good, so a failed or incomplete run leaves the previous media and manifest untouched. The run is idempotent: the
// same renders give the same file names and bytes. Files carry a short content hash in their name. What the run does, which
// files it writes and what the manifest means: docs/MEDIA.md. Exit codes: 0 ok, 1 missing renders or a failed step, 2 usage.
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { nb } from "../src/lib/i18n/format";
import { getT } from "../src/lib/i18n/server";
import { hashModelFiles, isHashedModelFile } from "../src/lib/model/hash";
import { splitTitle } from "../src/components/home/title";
import {
  GENERATED_NAME,
  MEDIA_PREFIX,
  POSTER_DEVICES,
  POSTER_PAGES,
  SPEC,
  VIDEO_POSTER_WIDTHS,
  extOf,
  hashedName,
  manifestFiles,
  manifestJson,
  mediaManifestSchema,
  parseManifest,
  planFromRender,
  readFootprint,
  relInMedia,
  sequenceHash,
  shortHash,
  type ImageFormat,
  type ImageSpec,
  type MediaManifest,
  type MediaPlan,
  type PictureVariantEntry,
  type PosterPage,
  type VideoVariantSpec,
} from "./lib/media-plan";
import { ogCompositeArgs, ogFonts } from "./lib/media-og";
import { blankEncoderName, imageSize, probeMp4 } from "./lib/media-probe";
import { checkMedia } from "./check-media";
import { ffmpegVideoArgs, searchCrf, videoProblems } from "./lib/media-video";
import { parseRenderConfig } from "./lib/render-schema";

const execFileP = promisify(execFile);

export type Section = "day" | "orbit" | "stills" | "og" | "video" | "posters";
export const SECTIONS: Section[] = ["day", "orbit", "stills", "og", "video", "posters"];
/** Sections every manifest must have (the posters are optional: they are captured from the web scene, scripts/posters.mjs). */
const REQUIRED: Section[] = ["day", "orbit", "stills", "og", "video"];

export interface Tools {
  magick: string;
  ffmpeg: string | null;
}

export interface BuildOptions {
  /** Repository root (model/, generated/ and the default folders are relative to it). */
  root: string;
  /** Folder of the renders (default `pipeline/out`). */
  inDir?: string;
  /** Media folder (default `public/media`); the manifest paths always start with `media/`. */
  outDir?: string;
  /** Plan to build; by default the one of `model/render.json`. */
  plan?: MediaPlan;
  only?: Section[];
  /** Build what the renders offer and keep the rest of the manifest as it is (default: all or nothing). */
  partial?: boolean;
  /**
   * A proof build: a missing render is replaced by an existing one (explicit pairs from `standInMap`, else the nearest time or
   * loop position, else the next unused render of the folder). The manifest counts them in `standIns`; check-media warns.
   */
  standIns?: boolean;
  /** Logical base name of a planned render -> logical base name of the render to use instead. */
  standInMap?: Record<string, string>;
  video?: boolean;
  prune?: boolean;
  /** Re-encode the video although the cache says the frames did not change. */
  force?: boolean;
  jobs?: number;
  /** Check the finished folder with check-media (default true). */
  check?: boolean;
  /** Size range of the widest video rendition [floor, ceiling] in bytes (default: no floor, the SPEC ceiling). */
  videoBytes?: [number, number];
  /** Cache of the video encode (default `<renders>/media-cache.json`); null for none. */
  cacheFile?: string | null;
  tools?: Tools;
  modelDir?: string;
  renderInputs?: string;
  renderJson?: string;
  /** generated/derived.json: the house outline decides whether the compare pair is an interior view. */
  derivedJson?: string;
  /**
   * Where the share images and their alt texts are copied for Next's file convention (`opengraph-image.jpg`, `twitter-image.jpg`
   * and `.alt.txt`). Default `src/app` when the output folder is the default one, else none; null for none.
   */
  appDir?: string | null;
  /** The `builtAt` date of a changed manifest (default: today, UTC). */
  builtAt?: string;
  log?: (line: string) => void;
}

export interface BuildResult {
  ok: boolean;
  /** Logical names of renders that are missing (`section: base`). */
  missing: string[];
  errors: string[];
  warnings: string[];
  /** Sections built in this run. */
  built: Section[];
  /** Seconds per section. */
  timings: Record<string, number>;
  manifest: MediaManifest | null;
  /** Renders replaced by stand-ins (`base <- stand-in`). */
  standIns: string[];
  /** Video only: per rendition the CRF used, the size and whether the cache was used, and the loop check. */
  video?: { variants: { w: number; crf: number; bytes: number; reused: boolean }[]; loopRatio: number | null };
}

// ------------------------------------------------------------------------------------------------ tools

const STANDARD_DIRS = ["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/opt/local/bin"];

function isExecutable(file: string): boolean {
  try {
    fs.accessSync(file, fs.constants.X_OK);
    return fs.statSync(file).isFile();
  } catch {
    return false;
  }
}

/** Env variable first, then PATH, the standard locations and `extra`. */
export function findTool(name: string, envName: string, extra: string[] = []): string | null {
  const fromEnv = process.env[envName];
  if (fromEnv) return isExecutable(fromEnv) ? fromEnv : null;
  const dirs = [...(process.env.PATH ?? "").split(path.delimiter).filter(Boolean), ...STANDARD_DIRS];
  for (const d of dirs) if (isExecutable(path.join(d, name))) return path.join(d, name);
  return extra.find(isExecutable) ?? null;
}

export function discoverTools(root: string): { magick: string | null; ffmpeg: string | null } {
  return {
    magick: findTool("magick", "MAGICK"),
    ffmpeg: findTool("ffmpeg", "FFMPEG", [path.join(root, "node_modules", "ffmpeg-static", "ffmpeg")]),
  };
}

async function run(bin: string, args: string[], opts: { env?: NodeJS.ProcessEnv } = {}): Promise<string> {
  try {
    const { stdout } = await execFileP(bin, args, { maxBuffer: 1 << 26, env: { ...process.env, MAGICK_THREAD_LIMIT: "1", ...opts.env } });
    return stdout;
  } catch (e) {
    const err = e as { stderr?: string; message: string };
    throw new Error(`${path.basename(bin)} failed: ${(err.stderr || err.message).trim().split("\n").slice(-4).join(" | ")}`);
  }
}

/** Runs `fn` over `items` with at most `n` in flight; stops taking new items after the first error. */
async function pool<T>(items: readonly T[], n: number, fn: (item: T, i: number) => Promise<void>): Promise<void> {
  let next = 0;
  let failed = false;
  const worker = async (): Promise<void> => {
    while (!failed) {
      const i = next++;
      if (i >= items.length) return;
      try {
        await fn(items[i], i);
      } catch (e) {
        failed = true;
        throw e;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(n, items.length)) }, worker));
}

const SOURCE_EXTENSIONS = [".png", ".jpg", ".jpeg"];

/** The render file of a logical base name (`day/0800` -> `<in>/day/0800.png`), or null. */
export function resolveSource(inDir: string, base: string): string | null {
  for (const ext of SOURCE_EXTENSIONS) {
    const f = path.join(inDir, `${base}${ext}`);
    if (fs.existsSync(f)) return f;
  }
  return null;
}

function readHead(file: string, bytes = 1 << 18): Buffer {
  const fd = fs.openSync(file, "r");
  try {
    const buf = Buffer.alloc(bytes);
    return buf.subarray(0, fs.readSync(fd, buf, 0, bytes, 0));
  } finally {
    fs.closeSync(fd);
  }
}

// ------------------------------------------------------------------------------------------------ stand-ins

/** Renders of one folder of the render output: logical base names without extension, sorted. */
function rendersIn(inDir: string, folder: string): string[] {
  const dir = path.join(inDir, folder);
  if (!fs.existsSync(dir)) return [];
  const names = new Set<string>();
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const ext = path.extname(e.name).toLowerCase();
    if (e.isFile() && SOURCE_EXTENSIONS.includes(ext) && !e.name.startsWith(".")) names.add(`${folder}/${e.name.slice(0, -ext.length)}`);
  }
  return [...names].sort();
}

const minutesOf = (token: string): number => Number(token.slice(0, 2)) * 60 + Number(token.slice(2, 4));

/**
 * Finds stand-ins for planned renders that do not exist (a proof build on older renders). The rule, in order: an explicit pair of
 * the map; a day frame takes the nearest time of the day folder (a missing portrait frame the landscape frame of its time, cropped
 * to cover); an orbit frame takes the frame at the nearest position of the loop in its variant folder (else the landscape one);
 * anything else takes the next unused render of its folder in name order.
 */
export class StandIns {
  private readonly used = new Map<string, Set<string>>();
  readonly replaced: string[] = [];
  constructor(private readonly inDir: string, private readonly plan: MediaPlan, private readonly map: Record<string, string> = {}) {}

  /** The render file of a base name, or of its stand-in; null when there is neither. */
  resolve(base: string): string | null {
    const direct = this.otherLoop(base) ? null : resolveSource(this.inDir, base);
    if (direct) return direct;
    const sub = this.find(base);
    const file = sub ? resolveSource(this.inDir, sub) : null;
    if (file && sub) this.replaced.push(`${base} <- ${sub}`);
    return file;
  }

  private readonly loops = new Map<string, number | null>();

  /** Frames per loop of the orbit renders in a folder (highest number + step), or null when the folder has none. */
  private loopTotal(folder: string): number | null {
    if (!this.loops.has(folder)) {
      const idx = rendersIn(this.inDir, folder).map((b) => path.posix.basename(b)).filter((n) => /^\d{4}$/.test(n)).map(Number);
      const step = Math.min(...idx.slice(1).map((v, i) => v - idx[i]).filter((d) => d > 0), Infinity);
      this.loops.set(folder, idx.length ? Math.max(...idx) + (Number.isFinite(step) ? step : 1) : null);
    }
    return this.loops.get(folder)!;
  }

  /** An orbit frame whose folder holds a loop of another length: a file of the same name shows another angle (a stand-in is used). */
  private otherLoop(base: string): boolean {
    const folder = path.posix.dirname(base);
    if (!/^orbit\/[\w-]+$/.test(folder)) return false;
    const total = this.loopTotal(folder);
    return total !== null && total !== this.plan.orbit.frameCount;
  }

  private find(base: string): string | null {
    const mapped = this.map[base];
    if (mapped && resolveSource(this.inDir, mapped)) return mapped;
    const folder = path.posix.dirname(base);
    const name = path.posix.basename(base);
    if (/^day\/portrait$/.test(folder)) return resolveSource(this.inDir, `day/${name}`) ? `day/${name}` : this.find(`day/${name}`);
    if (folder === "day" && /^\d{4}$/.test(name)) return this.nearest(rendersIn(this.inDir, "day"), (b) => minutesOf(path.posix.basename(b)), minutesOf(name));
    const orbit = /^orbit\/([\w-]+)$/.exec(folder);
    if (orbit && /^\d{4}$/.test(name)) {
      const at = Number(name) / this.plan.orbit.frameCount;
      for (const f of [folder, path.posix.dirname(this.plan.orbit.scrollSrc[0])]) {
        const list = rendersIn(this.inDir, f).filter((b) => /^\d{4}$/.test(path.posix.basename(b)));
        const total = this.loopTotal(f);
        if (!list.length || !total) continue;
        // nearest on the loop (the last frame is next to the first)
        return this.nearest(list, (b) => Number(path.posix.basename(b)) / total, at, 1);
      }
      return null;
    }
    // stills, compare, og: the next render of the folder that no other stand-in took
    const taken = this.used.get(folder) ?? new Set<string>();
    this.used.set(folder, taken);
    const mappedTargets = new Set(Object.values(this.map));
    const free = rendersIn(this.inDir, folder).filter((b) => !taken.has(b) && !mappedTargets.has(b) && !this.planned(b));
    const pick = free[0] ?? null;
    if (pick) taken.add(pick);
    return pick;
  }

  /** Is the base name a render the plan itself uses (so it must not stand in for another one)? */
  private planned(b: string): boolean {
    const p = this.plan;
    return p.stills.some((s) => s.src === b) || p.og.src === b;
  }

  private nearest(list: string[], value: (b: string) => number, target: number, period?: number): string | null {
    let best: string | null = null;
    let bestD = Infinity;
    for (const b of list) {
      let d = Math.abs(value(b) - target);
      if (period) d = Math.min(d, period - d);
      if (d < bestD) {
        bestD = d;
        best = b;
      }
    }
    return best;
  }
}

// ------------------------------------------------------------------------------------------------ one picture

interface Job {
  src: string;
  dst: string;
  spec: ImageSpec;
  /** The target is meant to be a crop of the render (no warning for another aspect ratio). */
  cover?: boolean;
  /** Fit inside the box keeping the aspect ratio (posters), instead of covering it. */
  fit?: boolean;
}

const FORMAT_ARGS: Record<ImageFormat, (q: number) => string[]> = {
  jpg: (q) => ["-interlace", "JPEG", "-sampling-factor", "4:2:0", "-quality", String(q)],
  webp: (q) => ["-quality", String(q), "-define", "webp:method=6", "-define", "webp:lossless=false"],
  avif: (q) => ["-quality", String(q), "-define", "heic:speed=6"],
};

/** Arguments of the conversion: scale to cover the target and centre it (or fit inside), strip every profile and comment. */
export function magickArgs(job: Job): string[] {
  const { w, h, q, format } = job.spec;
  const args = [job.src, "-auto-orient", "-alpha", "off", "-depth", "8", "-filter", "Lanczos"];
  if (job.fit) args.push("-resize", `${w}x${h}>`);
  else args.push("-resize", `${w}x${h}^`, "-gravity", "center", "-extent", `${w}x${h}`);
  args.push("+repage", "-strip", ...FORMAT_ARGS[format](q), job.dst);
  return args;
}

/** Converts all jobs; returns warnings (unexpected aspect ratios) and throws on the first failure. */
async function runJobs(tools: Tools, jobs: Job[], concurrency: number): Promise<string[]> {
  const warnings = new Set<string>();
  await pool(jobs, concurrency, async (job) => {
    const size = imageSize(readHead(job.src));
    if (!size) throw new Error(`${job.src}: not a readable PNG or JPEG`);
    const want = job.spec.w / job.spec.h;
    if (!job.cover && !job.fit && Math.abs(size.width / size.height / want - 1) > 0.01) {
      warnings.add(`${path.basename(job.src)} is ${size.width}x${size.height}: not the aspect of the output, it is cropped to cover`);
    }
    fs.mkdirSync(path.dirname(job.dst), { recursive: true });
    await run(tools.magick, magickArgs(job));
    const out = fs.statSync(job.dst).size;
    if (out < 256) throw new Error(`${job.dst}: the result is only ${out} bytes`);
  });
  return [...warnings];
}

// ------------------------------------------------------------------------------------------------ sections

/** A built file in the staging folder and its place below the media folder. */
interface Staged {
  from: string;
  rel: string;
}

interface Ctx {
  plan: MediaPlan;
  tools: Tools;
  stage: string;
  outDir: string;
  jobs: number;
  /** Bases whose source is a stand-in (cropping to cover is expected for those). */
  standIn: Set<string>;
  warnings: string[];
  log: (line: string) => void;
}

const PATTERN = {
  dayL: "media/day/l/{time}.{hash}.webp",
  dayS: "media/day/l960/{time}.{hash}.webp",
  dayP: "media/day/p/{time}.{hash}.webp",
  orbitL: "media/orbit/l/{i}.{hash}.webp",
  orbitS: "media/orbit/l960/{i}.{hash}.webp",
  orbitP: "media/orbit/p/{i}.{hash}.webp",
} as const;
const NAMES = { poster: "orbit/poster", video: "orbit/orbit", og: "og", twitter: "twitter" } as const;

const fill = (pattern: string, t: { i?: number; time?: string; hash: string }): string =>
  pattern
    .replaceAll("{i}", t.i === undefined ? "{i}" : String(t.i).padStart(3, "0"))
    .replaceAll("{time}", t.time === undefined ? "{time}" : t.time.replace(":", ""))
    .replaceAll("{hash}", t.hash);

interface SeqVariant {
  pattern: string;
  spec: ImageSpec;
  /** One source per frame token. */
  sources: string[];
  tokens: { i?: number; time?: string }[];
  cover?: boolean;
}

/** One frame sequence in all its variants: converts the jobs, hashes the result (variants in order) and names the files. */
async function buildSequence(c: Ctx, variants: SeqVariant[]): Promise<{ hash: string; files: Staged[] }> {
  const jobs: { job: Job; pattern: string; tok: { i?: number; time?: string } }[] = [];
  for (const v of variants) {
    v.sources.forEach((src, k) => {
      const tok = v.tokens[k];
      jobs.push({ job: { src, dst: path.join(c.stage, relInMedia(fill(v.pattern, { ...tok, hash: "tmp" }))), spec: v.spec, cover: v.cover }, pattern: v.pattern, tok });
    });
  }
  c.warnings.push(...(await runJobs(c.tools, jobs.map((j) => j.job), c.jobs)));
  const hash = sequenceHash(jobs.map((j) => j.job.dst));
  const files = jobs.map((j) => ({ from: j.job.dst, rel: relInMedia(fill(j.pattern, { ...j.tok, hash })) }));
  return { hash, files };
}

const sized = (pattern: string, s: ImageSpec) => ({ pattern, width: s.w, height: s.h });

async function buildDay(c: Ctx, sources: string[], portrait: string[] | null): Promise<{ day: MediaManifest["day"]; files: Staged[] }> {
  const d = c.plan.day;
  const tokens = d.times.map((time) => ({ time }));
  const variants: SeqVariant[] = [
    { pattern: PATTERN.dayL, spec: SPEC.day.landscape, sources, tokens },
    { pattern: PATTERN.dayS, spec: SPEC.day.small, sources, tokens },
  ];
  // a stand-in for a portrait frame is a landscape render, cropped to cover the portrait
  if (portrait) variants.push({ pattern: PATTERN.dayP, spec: SPEC.day.portrait, sources: portrait, tokens, cover: d.portraitSrc?.some((b) => c.standIn.has(b)) });
  const { hash, files } = await buildSequence(c, variants);
  return {
    files,
    day: {
      date: d.date,
      times: d.times,
      stillTime: d.stillTime,
      hash,
      landscape: { ...sized(PATTERN.dayL, SPEC.day.landscape), format: "webp", small: sized(PATTERN.dayS, SPEC.day.small) },
      ...(portrait ? { portrait: { ...sized(PATTERN.dayP, SPEC.day.portrait), format: "webp" as const } } : {}),
    },
  };
}

async function buildOrbitFrames(c: Ctx, landscape: string[], portrait: string[] | null): Promise<{ orbit: Omit<MediaManifest["orbit"], "video" | "captions">; files: Staged[] }> {
  const o = c.plan.orbit;
  const tokens = landscape.map((_, i) => ({ i }));
  const variants: SeqVariant[] = [
    { pattern: PATTERN.orbitL, spec: SPEC.orbit.landscape, sources: landscape, tokens },
    { pattern: PATTERN.orbitS, spec: SPEC.orbit.small, sources: landscape, tokens },
  ];
  if (portrait) {
    variants.push({
      pattern: PATTERN.orbitP,
      spec: SPEC.orbit.portrait,
      sources: portrait,
      tokens: portrait.map((_, j) => ({ i: j * o.portraitStride })),
      cover: o.portraitSrc?.some((b) => c.standIn.has(b)),
    });
  }
  const { hash, files } = await buildSequence(c, variants);
  return {
    files,
    orbit: {
      frames: o.scrollCount,
      degPerFrame: o.degPerFrame,
      hash,
      startAzimuthDeg: o.startAzimuthDeg,
      direction: o.direction,
      captionHalfWindowDeg: o.captionHalfWindowDeg,
      landscape: { ...sized(PATTERN.orbitL, SPEC.orbit.landscape), format: "webp", small: sized(PATTERN.orbitS, SPEC.orbit.small) },
      ...(portrait ? { portrait: { ...sized(PATTERN.orbitP, SPEC.orbit.portrait), format: "webp" as const, stride: o.portraitStride } } : {}),
    },
  };
}

const evenUp = (v: number): number => Math.max(2, Math.round(v / 2) * 2);

/**
 * A responsive picture of one render: AVIF, WebP and JPEG at each width (never wider than the render, except `main`, which is
 * always made), all with the aspect of `main`. Returns the variants (widest last) and the staged files; the JPEG at the main
 * width is the picture's `file`.
 */
async function buildPicture(
  c: Ctx,
  src: string,
  name: string,
  main: { w: number; h: number },
  widths: readonly number[],
  cover: boolean,
): Promise<{ variants: PictureVariantEntry[]; files: Staged[]; mainFile: string }> {
  const size = imageSize(readHead(src));
  if (!size) throw new Error(`${src}: not a readable PNG or JPEG`);
  // every width up to the main one (a small draft render is scaled up like the main file), wider ones only from a render that wide
  const list = [...new Set([...widths.filter((w) => w <= Math.max(size.width, main.w)), main.w])].sort((a, b) => a - b);
  const jobs: { job: Job; w: number; h: number; f: ImageFormat }[] = [];
  for (const w of list) {
    const h = evenUp((w * main.h) / main.w);
    for (const f of ["avif", "webp", "jpg"] as const) {
      jobs.push({ w, h, f, job: { src, dst: path.join(c.stage, `${name}-${w}.${f}`), spec: { w, h, q: SPEC.stills.quality[f], format: f }, cover } });
    }
  }
  c.warnings.push(...(await runJobs(c.tools, jobs.map((j) => j.job), c.jobs)));
  const files: Staged[] = [];
  const byW = new Map<number, PictureVariantEntry>();
  for (const j of jobs) {
    const rel = hashedName(`${name}-${j.w}`, shortHash(fs.readFileSync(j.job.dst)), j.f);
    files.push({ from: j.job.dst, rel });
    const v = byW.get(j.w) ?? { w: j.w, h: j.h };
    v[j.f] = MEDIA_PREFIX + rel;
    byW.set(j.w, v);
  }
  const variants = [...byW.values()].sort((a, b) => a.w - b.w);
  return { variants, files, mainFile: byW.get(main.w)!.jpg! };
}

async function buildStills(c: Ctx, sources: string[]): Promise<{ stills: MediaManifest["stills"]; files: Staged[] }> {
  const files: Staged[] = [];
  const main = SPEC.stills.main;
  const stills: MediaManifest["stills"] = [];
  for (const [i, s] of c.plan.stills.entries()) {
    const pic = await buildPicture(c, sources[i], `stills/${s.id}`, main, SPEC.stills.widths, c.standIn.has(s.src));
    files.push(...pic.files);
    stills.push({
      id: s.id,
      file: pic.mainFile,
      width: main.w,
      height: main.h,
      date: s.date,
      time: s.time,
      category: s.category,
      title: s.title,
      alt: s.alt,
      variants: pic.variants,
      gallery: s.gallery,
    });
  }
  return { stills, files };
}

/** The text of the share image: the house name (model/house.json) in two lines and the hero kicker of the dictionary, Czech. */
function ogText(root: string): { lines: [string, string]; label: string; mint: string } {
  const house = JSON.parse(fs.readFileSync(path.join(root, "model", "house.json"), "utf8")) as { name: { cs: string } };
  const style = JSON.parse(fs.readFileSync(path.join(root, "model", "style.json"), "utf8")) as { palette: { mint: string } };
  const t = getT("cs");
  return { lines: splitTitle(house.name.cs), label: t("home.hero.kicker"), mint: style.palette.mint };
}

async function buildOg(c: Ctx, root: string, source: string): Promise<{ og: MediaManifest["og"]; files: Staged[] }> {
  const text = ogText(root);
  const fonts = ogFonts(root);
  for (const f of [fonts.sansFont, fonts.monoFont]) if (!fs.existsSync(f)) throw new Error(`og: font ${path.relative(root, f)} not found (npm install)`);
  const out: Staged[] = [];
  const made: Record<"og" | "twitter", string> = { og: "", twitter: "" };
  for (const k of ["og", "twitter"] as const) {
    const spec = SPEC[k];
    const dst = path.join(c.stage, `${k}.jpg`);
    await run(c.tools.magick, ogCompositeArgs(source, dst, spec, { lines: text.lines, label: text.label }, { mint: text.mint, ...fonts }));
    const rel = hashedName(NAMES[k], shortHash(fs.readFileSync(dst)), "jpg");
    out.push({ from: dst, rel });
    made[k] = rel;
  }
  return {
    files: out,
    og: {
      file: MEDIA_PREFIX + made.og,
      width: SPEC.og.w,
      height: SPEC.og.h,
      twitter: { file: MEDIA_PREFIX + made.twitter, width: SPEC.twitter.w, height: SPEC.twitter.h },
      alt: c.plan.og.alt,
    },
  };
}

async function buildPosters(c: Ctx, sources: Map<string, string>): Promise<{ posters: NonNullable<MediaManifest["posters"]>; files: Staged[] }> {
  const posters: NonNullable<MediaManifest["posters"]> = {};
  const files: Staged[] = [];
  for (const page of POSTER_PAGES) {
    const entries = POSTER_DEVICES.map((device) => ({ device, src: sources.get(`${page}-${device}`) }));
    if (entries.some((e) => !e.src)) continue;
    const pair: Partial<Record<(typeof POSTER_DEVICES)[number], { file: string; width: number; height: number }>> = {};
    for (const { device, src } of entries) {
      const size = imageSize(readHead(src!));
      if (!size) throw new Error(`${src}: not a readable PNG or JPEG`);
      const max = SPEC.posters.maxWidth[device];
      const w = Math.min(max, size.width);
      const h = evenUp((size.height * w) / size.width);
      const dst = path.join(c.stage, "posters", `${page}-${device}.webp`);
      c.warnings.push(...(await runJobs(c.tools, [{ src: src!, dst, spec: { w, h, q: SPEC.posters.q, format: "webp" }, cover: true }], 1)));
      const rel = hashedName(`posters/${page}-${device}`, shortHash(fs.readFileSync(dst)), "webp");
      files.push({ from: dst, rel });
      pair[device] = { file: MEDIA_PREFIX + rel, width: w, height: h };
    }
    posters[page as PosterPage] = pair as { desktop: { file: string; width: number; height: number }; phone: { file: string; width: number; height: number } };
  }
  return { posters, files };
}

// ------------------------------------------------------------------------------------------------ video

interface VideoCacheEntry {
  key: string;
  crf: number;
  bytes: number;
  file: string;
}
interface VideoCache {
  /** One entry per rendition width. */
  videos?: Record<string, VideoCacheEntry>;
}

function readJson<T>(file: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as T;
  } catch {
    return null;
  }
}

function sourcesKey(frames: string[], extra: unknown): string {
  const h = createHash("sha256");
  for (const f of frames) h.update(createHash("sha256").update(fs.readFileSync(f)).digest());
  h.update(JSON.stringify(extra));
  return h.digest("hex");
}

/** Mean absolute difference (0..255) of two frames, compared at a small size. */
async function frameDistance(magick: string, a: string, b: string): Promise<number> {
  const out = await run(magick, [a, b, "-resize", "320x180!", "-compose", "Difference", "-composite", "-colorspace", "Gray", "-format", "%[fx:mean*255]", "info:"]);
  return Number(out.trim());
}

/** Difference between the last and the first frame divided by the typical difference between neighbours (about 1 for a closed loop). */
async function loopRatio(magick: string, frames: string[]): Promise<number | null> {
  const n = frames.length;
  if (n < 4) return null;
  const wrap = await frameDistance(magick, frames[n - 1], frames[0]);
  const idx = Array.from({ length: 8 }, (_, k) => Math.floor((k * (n - 1)) / 8));
  const steps = (await Promise.all(idx.map((i) => frameDistance(magick, frames[i], frames[i + 1])))).sort((x, y) => x - y);
  const typical = steps[Math.floor(steps.length / 2)];
  return typical > 0 ? wrap / typical : wrap === 0 ? 1 : Number.POSITIVE_INFINITY;
}

async function buildVideo(
  c: Ctx,
  ffmpeg: string,
  frames: string[],
  o: { cacheFile: string | null; force: boolean; bytes: [number, number] | null },
): Promise<{ video: NonNullable<MediaManifest["orbit"]["video"]>; files: Staged[]; info: NonNullable<BuildResult["video"]> }> {
  const plan = c.plan.orbit;
  // ffmpeg reads one numbered series: link the frames (they may come from anywhere, stand-ins too) into one folder
  const exts = new Set(frames.map((f) => path.extname(f).toLowerCase()));
  if (exts.size !== 1) throw new Error(`the video frames must share one file type (found ${[...exts].join(", ")})`);
  const ext = [...exts][0];
  const seqDir = path.join(c.stage, "video-frames");
  fs.mkdirSync(seqDir, { recursive: true });
  frames.forEach((f, i) => fs.symlinkSync(path.resolve(f), path.join(seqDir, `${String(i).padStart(4, "0")}${ext}`)));
  const input = path.join(seqDir, `%04d${ext}`);
  const version = (await run(ffmpeg, ["-version"])).split("\n")[0];
  const cache = (o.cacheFile ? readJson<VideoCache>(o.cacheFile) : null) ?? {};
  const videos: Record<string, VideoCacheEntry> = { ...(cache.videos ?? {}) };
  const files: Staged[] = [];
  const results: NonNullable<BuildResult["video"]>["variants"] = [];
  const renditions: { w: number; h: number; file: string }[] = [];
  const specs: VideoVariantSpec[] = [...SPEC.video.variants].sort((a, b) => b.w - a.w);
  for (const [k, v] of specs.entries()) {
    const [minBytes, maxBytes] = k === 0 && o.bytes ? o.bytes : [0, v.maxBytes];
    const args = ffmpegVideoArgs({ input: "", fps: plan.fps, frames: frames.length, crf: 0, out: "", width: v.w, height: v.h });
    const key = sourcesKey(frames, { version, post: "blank-encoder-name/1", v, minBytes, maxBytes, fps: plan.fps, preset: SPEC.video.preset, gop: SPEC.video.gop, args });
    const cached = videos[String(v.w)];
    let entry: VideoCacheEntry;
    let reused = false;
    if (!o.force && cached && cached.key === key && fs.existsSync(path.join(c.outDir, cached.file))) {
      entry = cached;
      reused = true;
      c.log(`[video] ${v.w} px: frames unchanged, reusing ${cached.file} (crf ${cached.crf}, ${(cached.bytes / 1e6).toFixed(1)} MB)`);
    } else {
      const encode = async (crfTry: number): Promise<number> => {
        const t0 = Date.now();
        const out = path.join(c.stage, `video-${v.w}-crf${crfTry}.mp4`);
        await run(ffmpeg, ffmpegVideoArgs({ input, fps: plan.fps, frames: frames.length, crf: crfTry, out, width: v.w, height: v.h }));
        const size = fs.statSync(out).size;
        c.log(`[video] ${v.w} px, crf ${crfTry}: ${(size / 1e6).toFixed(2)} MB in ${((Date.now() - t0) / 1000).toFixed(0)} s`);
        return size;
      };
      const found = await searchCrf(encode, { start: v.crf, minCrf: v.crf, maxCrf: SPEC.video.crfMax, minBytes, maxBytes, targetBytes: minBytes ? Math.round((minBytes + maxBytes) / 2) : Math.round(maxBytes * 0.95) });
      if (!found.inRange) c.warnings.push(`video ${v.w} px: no CRF gives ${(minBytes / 1e6).toFixed(1)}-${(maxBytes / 1e6).toFixed(1)} MB (tried ${found.tried.map((t) => `${t.crf}: ${(t.bytes / 1e6).toFixed(1)} MB`).join(", ")}); the closest one is used`);
      else if (found.crf !== v.crf) c.warnings.push(`video ${v.w} px: crf ${v.crf} was above ${(maxBytes / 1e6).toFixed(1)} MB, crf ${found.crf} is used`);
      const chosen = path.join(c.stage, `video-${v.w}-crf${found.crf}.mp4`);
      for (const t of found.tried) if (t.crf !== found.crf) fs.rmSync(path.join(c.stage, `video-${v.w}-crf${t.crf}.mp4`), { force: true });
      const data = fs.readFileSync(chosen);
      blankEncoderName(data);
      fs.writeFileSync(chosen, data);
      const problems = videoProblems(probeMp4(data), { width: v.w, height: v.h, fps: plan.fps, frames: frames.length });
      if (problems.length) throw new Error(`video ${v.w} px: ${problems.join("; ")}`);
      entry = { key, crf: found.crf, bytes: data.length, file: hashedName(`${NAMES.video}-${v.w}`, shortHash(data), "mp4") };
      files.push({ from: chosen, rel: entry.file });
    }
    videos[String(v.w)] = entry;
    results.push({ w: v.w, crf: entry.crf, bytes: entry.bytes, reused });
    renditions.push({ w: v.w, h: v.h, file: MEDIA_PREFIX + entry.file });
  }
  // the poster: the first frame as a responsive picture; its widest JPEG is the `poster` of older readers
  const widest = specs[0];
  const pic = await buildPicture(c, frames[0], NAMES.poster, { w: widest.w, h: widest.h }, VIDEO_POSTER_WIDTHS.filter((w) => w <= widest.w), true);
  files.push(...pic.files);
  const ratio = await loopRatio(c.tools.magick, frames);
  if (ratio !== null && ratio > 2.5) c.warnings.push(`video: the last frame differs ${ratio.toFixed(1)} times more from the first one than neighbouring frames do: the loop is not closed`);
  if (o.cacheFile) {
    fs.mkdirSync(path.dirname(o.cacheFile), { recursive: true });
    fs.writeFileSync(o.cacheFile, `${JSON.stringify({ videos }, null, 2)}\n`);
  }
  return {
    files,
    info: { variants: results, loopRatio: ratio },
    video: {
      file: renditions[0].file,
      poster: pic.mainFile,
      width: widest.w,
      height: widest.h,
      fps: plan.fps,
      durationS: frames.length / plan.fps,
      variants: renditions,
      posterVariants: pic.variants,
    },
  };
}

// ------------------------------------------------------------------------------------------------ the build

/** Hash of the current model/*.json, and the one generated/render-inputs.json was made from (when that file exists). */
function modelHashes(o: { modelDir: string; renderInputs: string }): { current: string | null; renders: string | null } {
  if (!fs.existsSync(o.modelDir)) return { current: null, renders: null };
  const files = fs
    .readdirSync(o.modelDir)
    .filter(isHashedModelFile)
    .map((name) => ({ name, content: fs.readFileSync(path.join(o.modelDir, name), "utf8") }));
  return { current: hashModelFiles(files), renders: readJson<{ modelHash?: string }>(o.renderInputs)?.modelHash ?? null };
}

/** The caption windows the render inputs computed (render-inputs.json `orbit.captions`), or null. */
function renderedCaptions(renderInputs: string): { feature: string; azimuthDeg: number }[] | null {
  const ri = readJson<{ orbit?: { captions?: { feature: string; azimuthDeg: number }[] } }>(renderInputs);
  const caps = ri?.orbit?.captions;
  if (!Array.isArray(caps)) return null;
  return caps.filter((c) => typeof c.feature === "string" && Number.isFinite(c.azimuthDeg)).map((c) => ({ feature: c.feature, azimuthDeg: c.azimuthDeg }));
}

function walkFiles(dir: string, base = dir): string[] {
  const out: string[] = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith(".")) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walkFiles(full, base));
    else out.push(path.relative(base, full).split(path.sep).join("/"));
  }
  return out;
}

/** Removes generated, hash-named files that the manifest does not refer to (and empty folders). Nothing else is touched. */
function prune(outDir: string, referenced: Set<string>, log: (l: string) => void): void {
  let removed = 0;
  for (const rel of walkFiles(outDir)) {
    if (referenced.has(rel) || !GENERATED_NAME.test(path.basename(rel))) continue;
    fs.rmSync(path.join(outDir, rel));
    removed++;
  }
  const dirs = (d: string): void => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (!e.isDirectory()) continue;
      const full = path.join(d, e.name);
      if (e.name.startsWith(".build-")) {
        if (Date.now() - fs.statSync(full).mtimeMs > 3600_000) fs.rmSync(full, { recursive: true, force: true }); // left by a crashed run
        continue;
      }
      if (e.name.startsWith(".")) continue;
      dirs(full);
      if (fs.readdirSync(full).length === 0) fs.rmdirSync(full);
    }
  };
  dirs(outDir);
  if (removed) log(`pruned ${removed} files of earlier builds`);
}

/** Writes a file only when its content changes (so an unchanged build touches nothing). */
function writeIfChanged(file: string, data: Buffer | string): void {
  const buf = typeof data === "string" ? Buffer.from(data) : data;
  if (fs.existsSync(file) && fs.readFileSync(file).equals(buf)) return;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(`${file}.tmp-${process.pid}`, buf);
  fs.renameSync(`${file}.tmp-${process.pid}`, file);
}

/** Names of the share images and their alt texts in the app folder (Next's file convention). */
export const APP_FILES = {
  og: "opengraph-image.jpg",
  twitter: "twitter-image.jpg",
  ogAlt: "opengraph-image.alt.txt",
  twitterAlt: "twitter-image.alt.txt",
} as const;

/** The alt text of the share images in the app folder: Czech (the x-default language), typeset. */
export const appAltText = (m: Pick<MediaManifest, "og">): string | null => (m.og.alt ? `${nb(m.og.alt.cs, "cs")}\n` : null);

const todayIso = (): string => new Date().toISOString().slice(0, 10);

export async function buildMedia(o: BuildOptions): Promise<BuildResult> {
  const log = o.log ?? ((line: string) => console.log(line));
  const inDir = path.resolve(o.root, o.inDir ?? "pipeline/out");
  const outDir = path.resolve(o.root, o.outDir ?? "public/media");
  const appDir = o.appDir === undefined ? (o.outDir === undefined ? path.join(o.root, "src", "app") : null) : o.appDir && path.resolve(o.root, o.appDir);
  const res: BuildResult = { ok: false, missing: [], errors: [], warnings: [], built: [], timings: {}, manifest: null, standIns: [] };
  const done = (): BuildResult => {
    res.ok = res.errors.length === 0 && res.missing.length === 0;
    return res;
  };

  let plan = o.plan;
  if (!plan) {
    const renderJson = path.resolve(o.root, o.renderJson ?? "model/render.json");
    try {
      const footprint = readFootprint(path.resolve(o.root, o.derivedJson ?? "generated/derived.json"));
      plan = planFromRender(parseRenderConfig(JSON.parse(fs.readFileSync(renderJson, "utf8"))), { footprint });
    } catch (e) {
      res.errors.push((e as Error).message);
      return done();
    }
  }

  // tools
  const want = new Set<Section>(o.only ?? SECTIONS);
  if (o.video === false) want.delete("video");
  const found = o.tools ?? discoverTools(o.root);
  if (!found.magick) {
    res.errors.push("ImageMagick (magick) not found: install it or set MAGICK to its path");
    return done();
  }
  const ffmpeg = found.ffmpeg;
  if (want.has("video") && !ffmpeg) {
    const msg = "ffmpeg not found: install it or set FFMPEG to its path (--no-video skips the video)";
    if (!o.partial) {
      res.errors.push(msg);
      return done();
    }
    res.warnings.push(msg);
    want.delete("video");
  }
  const tools: Tools = { magick: found.magick, ffmpeg };

  // renders
  const standIns = o.standIns ? new StandIns(inDir, plan, o.standInMap) : null;
  const sources: Partial<Record<Exclude<Section, "posters">, string[]>> = {};
  const resolveAll = (section: Section, bases: string[]): string[] | null => {
    const files = bases.map((b) => (standIns ? standIns.resolve(b) : resolveSource(inDir, b)));
    const lost = bases.filter((_, i) => !files[i]);
    if (lost.length) {
      res.missing.push(...lost.map((b) => `${section}: ${b}`));
      return null;
    }
    return files as string[];
  };
  const wanted: Record<Exclude<Section, "posters">, string[]> = {
    day: [...plan.day.src, ...(plan.day.portraitSrc ?? [])],
    orbit: [...plan.orbit.scrollSrc, ...(plan.orbit.portraitSrc ?? [])],
    stills: plan.stills.map((s) => s.src),
    og: [plan.og.src],
    video: plan.orbit.videoSrc,
  };
  for (const s of REQUIRED) if (want.has(s)) {
    const files = resolveAll(s, wanted[s as Exclude<Section, "posters">]);
    if (files) sources[s as Exclude<Section, "posters">] = files;
  }
  // posters are optional: built when both captures of a page exist, never a stand-in
  const posterSources = new Map<string, string>();
  if (want.has("posters")) for (const p of plan.posters) {
    const f = resolveSource(inDir, p.src);
    if (f) posterSources.set(`${p.page}-${p.device}`, f);
  }
  if (standIns) {
    res.standIns = [...new Set(standIns.replaced)];
    if (res.standIns.length) {
      log(`${res.standIns.length} renders replaced by stand-ins (a proof build: the pictures do not show what the texts say)`);
      for (const s of res.standIns.slice(0, 8)) log(`  ${s}`);
      if (res.standIns.length > 8) log(`  ... and ${res.standIns.length - 8} more`);
    }
  }
  if (res.missing.length) {
    log(`${res.missing.length} renders are missing in ${path.relative(o.root, inDir) || inDir}:`);
    for (const m of res.missing.slice(0, 12)) log(`  ${m}`);
    if (res.missing.length > 12) log(`  ... and ${res.missing.length - 12} more`);
    if (!o.partial) {
      res.errors.push(`${res.missing.length} renders are missing; nothing was written (--partial builds the sections that are complete)`);
      return done();
    }
  }
  const standInBases = new Set(res.standIns.map((s) => s.split(" <- ")[0]));

  // the manifest of the earlier build supplies the sections that are not built now
  const manifestPath = path.join(outDir, "manifest.json");
  let existing: MediaManifest | null = null;
  if (fs.existsSync(manifestPath)) {
    try {
      existing = parseManifest(JSON.parse(fs.readFileSync(manifestPath, "utf8")));
    } catch (e) {
      res.warnings.push(`the existing manifest is not used: ${(e as Error).message.split("\n").slice(0, 2).join(" ")}`);
    }
  }
  for (const s of ["day", "orbit", "stills", "og"] as const) {
    if (!sources[s] && !existing) res.errors.push(`${s}: nothing to build and no manifest that has it: build every section once first`);
  }
  if (res.errors.length) return done();

  fs.mkdirSync(outDir, { recursive: true });
  const stage = path.join(outDir, `.build-${process.pid}`);
  fs.rmSync(stage, { recursive: true, force: true });
  fs.mkdirSync(stage, { recursive: true });
  const ctx: Ctx = { plan, tools, stage, outDir, jobs: o.jobs ?? Math.max(1, Math.min(8, os.cpus().length)), standIn: standInBases, warnings: res.warnings, log };
  const staged: Staged[] = [];
  const part: {
    day?: MediaManifest["day"];
    orbit?: Omit<MediaManifest["orbit"], "video" | "captions">;
    stills?: MediaManifest["stills"];
    og?: MediaManifest["og"];
    video?: NonNullable<MediaManifest["orbit"]["video"]>;
    posters?: NonNullable<MediaManifest["posters"]>;
  } = {};
  const timed = async <T>(section: Section, what: string, fn: () => Promise<T>): Promise<T> => {
    const t0 = Date.now();
    const r = await fn();
    const sec = (Date.now() - t0) / 1000;
    res.timings[section] = sec;
    log(`[${section}] ${what} in ${sec.toFixed(1)} s`);
    res.built.push(section);
    return r;
  };

  try {
    if (sources.day) {
      const n = plan.day.src.length;
      const r = await timed("day", `${n} frames${plan.day.portraitSrc ? ", landscape (full and 960) and portrait" : ""}`, () =>
        buildDay(ctx, sources.day!.slice(0, n), plan.day.portraitSrc ? sources.day!.slice(n) : null),
      );
      part.day = r.day;
      staged.push(...r.files);
    }
    if (sources.orbit) {
      const n = plan.orbit.scrollCount;
      const r = await timed("orbit", `${n} scroll frames${plan.orbit.portraitSrc ? `, portrait every ${plan.orbit.portraitStride}` : ""}`, () =>
        buildOrbitFrames(ctx, sources.orbit!.slice(0, n), plan.orbit.portraitSrc ? sources.orbit!.slice(n) : null),
      );
      part.orbit = r.orbit;
      staged.push(...r.files);
    }
    if (sources.stills) {
      const r = await timed("stills", `${sources.stills.length} stills, AVIF + WebP + JPEG`, () => buildStills(ctx, sources.stills!));
      part.stills = r.stills;
      staged.push(...r.files);
    }
    if (sources.og) {
      const r = await timed("og", "Open Graph and Twitter images with the name", () => buildOg(ctx, o.root, sources.og![0]));
      part.og = r.og;
      staged.push(...r.files);
    }
    if (sources.video && ffmpeg) {
      const cacheFile = o.cacheFile === undefined ? path.join(inDir, "media-cache.json") : o.cacheFile;
      const r = await timed("video", `${sources.video.length} frames, ${SPEC.video.variants.length} renditions`, () =>
        buildVideo(ctx, ffmpeg, sources.video!, { cacheFile, force: o.force ?? false, bytes: o.videoBytes ?? null }),
      );
      part.video = r.video;
      res.video = r.info;
      staged.push(...r.files);
    }
    if (posterSources.size) {
      const r = await timed("posters", `${posterSources.size} captures of the 3D pages`, () => buildPosters(ctx, posterSources));
      if (Object.keys(r.posters).length) part.posters = r.posters;
      staged.push(...r.files);
    }

    // compose the manifest
    const old = existing;
    const stagedRels = new Set(staged.map((s) => s.rel));
    const onDisk = (p: string): boolean => stagedRels.has(relInMedia(p)) || fs.existsSync(path.join(outDir, relInMedia(p)));
    let video = part.video ?? old?.orbit.video;
    const videoFiles = (v: NonNullable<typeof video>): string[] => [v.file, v.poster, ...(v.variants ?? []).map((x) => x.file)];
    if (video && !part.video && !videoFiles(video).every(onDisk)) {
      res.warnings.push("the video of the earlier build is gone from the media folder: the manifest has none");
      video = undefined;
    }
    if (video && !part.video && part.orbit) res.warnings.push("the video was not rebuilt: it may show other frames than the scroll frames");
    const oldOrbit = old ? { ...old.orbit, video: undefined, captions: undefined } : undefined;
    const orbitPart = part.orbit ?? oldOrbit;
    const renderInputs = path.resolve(o.root, o.renderInputs ?? "generated/render-inputs.json");
    const captions = part.orbit ? renderedCaptions(renderInputs) : old?.orbit.captions ?? null;
    if (part.orbit && !captions) res.warnings.push("generated/render-inputs.json has no orbit captions: the manifest has none (the home page computes them)");
    let posters = part.posters ?? old?.posters;
    if (posters && !part.posters) {
      const all = POSTER_PAGES.flatMap((p) => (posters?.[p] ? POSTER_DEVICES.map((d) => posters![p]![d].file) : []));
      if (!all.every(onDisk)) posters = undefined;
    }
    if (part.posters && old?.posters) posters = { ...old.posters, ...part.posters };

    // the model the renders belong to; a proof build follows the current shot list
    const hashes = modelHashes({ modelDir: path.resolve(o.root, o.modelDir ?? "model"), renderInputs });
    let inputHash = hashes.current;
    if (hashes.renders && hashes.current && hashes.renders !== hashes.current) {
      if (res.standIns.length) res.warnings.push("generated/render-inputs.json is older than model/*.json; the stand-in manifest records the current model");
      else {
        res.warnings.push("generated/render-inputs.json was made from another version of model/*.json than the current one: the renders are stale; the manifest records the version they were made from");
        inputHash = hashes.renders;
      }
    }
    const standInCount = res.standIns.length ? res.standIns.length : part.day && part.orbit && part.stills && part.og ? 0 : old?.standIns ?? 0;
    const compare: MediaManifest["compare"] = part.stills
      ? { a: plan.compare.a, b: plan.compare.b, alt: plan.compare.alt, before: plan.compare.before, after: plan.compare.after }
      : old!.compare;
    const draft: MediaManifest = {
      schema: "media/1",
      inputHash,
      ...(standInCount ? { standIns: standInCount } : {}),
      day: (part.day ?? old?.day)!,
      orbit: { ...orbitPart!, ...(captions ? { captions } : {}), ...(video ? { video } : {}) } as MediaManifest["orbit"],
      stills: (part.stills ?? old?.stills)!,
      compare,
      og: (part.og ?? old?.og)!,
      ...(posters && Object.keys(posters).length ? { posters } : {}),
    };
    // the manifest in the key order of the schema (what a reader parses back), so a rebuild compares and writes the same text
    const canonical = (m: MediaManifest): MediaManifest => {
      const checked = mediaManifestSchema.safeParse(m);
      if (!checked.success) throw new Error(`the manifest is invalid: ${checked.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`);
      return checked.data;
    };
    // builtAt: kept while nothing else changes (a rebuild of the same renders writes the same manifest)
    const strip = (m: MediaManifest | null): string => (m ? manifestJson({ ...m, builtAt: undefined }) : "");
    const draftC = canonical(draft);
    const builtAt = o.builtAt ?? (old?.builtAt && strip(old) === strip(draftC) ? old.builtAt : todayIso());
    const manifest = canonical({ ...draftC, builtAt });
    const lost = manifestFiles(manifest).filter((f) => !onDisk(f.path));
    if (lost.length) throw new Error(`the manifest refers to ${lost.length} files that do not exist, e.g. ${lost[0].path}`);

    // promote: files first, the manifest last, so that an interrupted run leaves a consistent folder
    for (const s of staged) {
      const dst = path.join(outDir, s.rel);
      fs.mkdirSync(path.dirname(dst), { recursive: true });
      if (fs.existsSync(dst)) fs.rmSync(s.from);
      else fs.renameSync(s.from, dst);
    }
    writeIfChanged(manifestPath, manifestJson(manifest));
    res.manifest = manifest;
    // the share images for Next's file convention: byte copies of the manifest's files, and their alt text
    if (appDir) {
      writeIfChanged(path.join(appDir, APP_FILES.og), fs.readFileSync(path.join(outDir, relInMedia(manifest.og.file))));
      if (manifest.og.twitter) writeIfChanged(path.join(appDir, APP_FILES.twitter), fs.readFileSync(path.join(outDir, relInMedia(manifest.og.twitter.file))));
      const alt = appAltText(manifest);
      if (alt) for (const f of [APP_FILES.ogAlt, APP_FILES.twitterAlt]) writeIfChanged(path.join(appDir, f), alt);
    }
    if (o.prune !== false) prune(outDir, new Set(manifestFiles(manifest).map((f) => relInMedia(f.path))), log);
    if (o.check !== false) {
      const c = checkMedia({ root: o.root, dir: outDir, modelDir: o.modelDir, renderJson: o.renderJson, derivedJson: o.derivedJson, appDir, allowExtra: o.prune === false });
      res.warnings.push(...c.warnings);
      res.errors.push(...c.errors.map((e) => `check: ${e}`));
    }
  } catch (e) {
    res.errors.push((e as Error).message);
    res.manifest = null;
  } finally {
    fs.rmSync(stage, { recursive: true, force: true });
  }
  return done();
}

// ------------------------------------------------------------------------------------------------ command line

const USAGE = `usage: build-media.ts [--only day,orbit,stills,og,video,posters] [--partial] [--stand-ins] [--stand-in-map file] [--no-video]
                      [--no-prune] [--no-check] [--force] [--jobs n] [--in dir] [--out dir] [--video-mb max|lo-hi] [--cache file]
                      [--render file] [--model-dir dir] [--render-inputs file] [--derived file] [--app-dir dir] [--no-app]
                      [--built-at YYYY-MM-DD] [--quiet]`;

export function parseArgs(argv: string[]): Omit<BuildOptions, "root"> & { quiet: boolean; standInMapFile?: string } {
  const o: Omit<BuildOptions, "root"> & { quiet: boolean; standInMapFile?: string } = { quiet: false };
  const value = (i: number): string => {
    const v = argv[i + 1];
    if (v === undefined) throw new Error(`${argv[i]} needs a value`);
    return v;
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--only") {
      const names = value(i++).split(",").filter(Boolean);
      const bad = names.filter((n) => !SECTIONS.includes(n as Section));
      if (bad.length) throw new Error(`unknown section ${bad.join(", ")} (sections: ${SECTIONS.join(", ")})`);
      o.only = names as Section[];
    } else if (a === "--partial") o.partial = true;
    else if (a === "--stand-ins") o.standIns = true;
    else if (a === "--stand-in-map") {
      o.standIns = true;
      o.standInMapFile = value(i++);
    } else if (a === "--no-video") o.video = false;
    else if (a === "--no-prune") o.prune = false;
    else if (a === "--no-check") o.check = false;
    else if (a === "--no-app") o.appDir = null;
    else if (a === "--force") o.force = true;
    else if (a === "--quiet") o.quiet = true;
    else if (a === "--jobs") o.jobs = Math.max(1, Number(value(i++)) || 1);
    else if (a === "--in") o.inDir = value(i++);
    else if (a === "--out") o.outDir = value(i++);
    else if (a === "--cache") o.cacheFile = value(i++);
    else if (a === "--render") o.renderJson = value(i++);
    else if (a === "--model-dir") o.modelDir = value(i++);
    else if (a === "--render-inputs") o.renderInputs = value(i++);
    else if (a === "--derived") o.derivedJson = value(i++);
    else if (a === "--app-dir") o.appDir = value(i++);
    else if (a === "--built-at") {
      const v = value(i++);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) throw new Error("--built-at needs YYYY-MM-DD");
      o.builtAt = v;
    } else if (a === "--video-mb") {
      const v = value(i++);
      const range = /^(\d+(?:\.\d+)?)-(\d+(?:\.\d+)?)$/.exec(v);
      const max = /^(\d+(?:\.\d+)?)$/.exec(v);
      if (range && Number(range[1]) < Number(range[2])) o.videoBytes = [Math.round(Number(range[1]) * 1e6), Math.round(Number(range[2]) * 1e6)];
      else if (max) o.videoBytes = [0, Math.round(Number(max[1]) * 1e6)];
      else throw new Error("--video-mb needs a ceiling like 14 or a range like 8-14");
    } else throw new Error(`unknown option ${a}`);
  }
  return o;
}

async function main(): Promise<number> {
  let opts: ReturnType<typeof parseArgs>;
  try {
    opts = parseArgs(process.argv.slice(2));
  } catch (e) {
    console.error(`${(e as Error).message}\n${USAGE}`);
    return 2;
  }
  const root = path.resolve(path.dirname(process.argv[1] ?? "."), "..");
  if (opts.standInMapFile) {
    const map = readJson<Record<string, string>>(path.resolve(opts.standInMapFile));
    if (!map || typeof map !== "object") {
      console.error(`--stand-in-map: ${opts.standInMapFile} is not a JSON object of base names`);
      return 2;
    }
    opts.standInMap = map;
  }
  const t0 = Date.now();
  const res = await buildMedia({ ...opts, root, log: opts.quiet ? () => undefined : (l) => console.log(l) });
  for (const w of res.warnings) console.warn(`warning: ${w}`);
  for (const e of res.errors) console.error(`error: ${e}`);
  const m = res.manifest;
  const total = ((Date.now() - t0) / 1000).toFixed(0);
  if (m) {
    const v = m.orbit.video;
    const vi = res.video?.variants.map((x) => `${x.w} px ${(x.bytes / 1e6).toFixed(1)} MB crf ${x.crf}${x.reused ? " (cached)" : ""}`).join(", ");
    console.log(
      `media: day ${m.day.times.length} frames, orbit ${m.orbit.frames} frames${v ? `, video ${v.durationS.toFixed(1)} s${vi ? ` (${vi})` : ""}` : ", no video"}, ${m.stills.length} stills, og ${m.og.width}x${m.og.height}${m.posters ? `, posters ${Object.keys(m.posters).join("+")}` : ""}${m.standIns ? `, ${m.standIns} stand-ins` : ""}; built ${res.built.join(", ") || "nothing"} in ${total} s`,
    );
  }
  if (!res.ok) console.error(`media build ${res.missing.length ? "incomplete" : "failed"}`);
  return res.ok ? 0 : 1;
}

if (process.argv[1] && /build-media\.[cm]?[jt]s$/.test(process.argv[1])) {
  main().then((code) => process.exit(code), (e) => {
    console.error(e);
    process.exit(1);
  });
}

/** For tests: the extension of a manifest path. */
export const fileExt = extOf;
