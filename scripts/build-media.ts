// Turns the Blender renders (pipeline/out) into the media of the web (public/media) and writes public/media/manifest.json.
//
//   npx tsx scripts/build-media.ts                      all sections (needs ImageMagick; ffmpeg for the video)
//   npx tsx scripts/build-media.ts --only day,stills    some sections: day, orbit, stills, og, video
//   npx tsx scripts/build-media.ts --partial            build what the renders offer, keep the rest as it is
//   options: --in <renders dir>  --out <media dir>  --no-video  --no-prune  --no-check  --force  --jobs <n>  --video-mb <lo-hi>
//            --cache <file>  --render <render.json>  --model-dir <dir>  --render-inputs <file>  --quiet
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
import { hashModelFiles, isHashedModelFile } from "../src/lib/model/hash";
import {
  GENERATED_NAME,
  MEDIA_PREFIX,
  SPEC,
  hashedName,
  manifestFiles,
  manifestJson,
  mediaManifestSchema,
  parseManifest,
  planFromRender,
  relInMedia,
  sequenceHash,
  shortHash,
  type Crop,
  type JpegSpec,
  type MediaManifest,
  type MediaPlan,
} from "./lib/media-plan";
import { blankEncoderName, imageSize, probeMp4 } from "./lib/media-probe";
import { checkMedia } from "./check-media";
import { ffmpegVideoArgs, searchCrf, videoProblems } from "./lib/media-video";
import { parseRenderConfig } from "./lib/render-schema";

const execFileP = promisify(execFile);

export type Section = "day" | "orbit" | "stills" | "og" | "video";
export const SECTIONS: Section[] = ["day", "orbit", "stills", "og", "video"];

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
  video?: boolean;
  prune?: boolean;
  /** Re-encode the video although the cache says the frames did not change. */
  force?: boolean;
  jobs?: number;
  /** Check the finished folder with check-media (default true). */
  check?: boolean;
  videoBytes?: [number, number];
  /** Cache of the video encode (default `pipeline/out/media-cache.json`); null for none. */
  cacheFile?: string | null;
  tools?: Tools;
  modelDir?: string;
  renderInputs?: string;
  renderJson?: string;
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
  /** Video only: the CRF used and how far the last frame is from the first one compared to a normal step. */
  video?: { crf: number; bytes: number; reused: boolean; loopRatio: number | null };
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

// ------------------------------------------------------------------------------------------------ one JPEG

interface Job {
  src: string;
  dst: string;
  spec: JpegSpec;
  /** Crop box in the pixels of a render of `cropBase` size, applied before the resize. */
  crop?: { box: Crop; base: [number, number] };
  /** The target is meant to be a crop of the render (no warning for another aspect ratio). */
  cover?: boolean;
}

/** Arguments of the conversion: crop, scale to cover the target, centre, strip every profile and comment, progressive JPEG. */
export function magickArgs(job: Job, srcSize: { width: number; height: number }): string[] {
  const { w, h, q } = job.spec;
  const args = [job.src, "-auto-orient", "-alpha", "off", "-depth", "8"];
  if (job.crop) {
    const sx = srcSize.width / job.crop.base[0];
    const sy = srcSize.height / job.crop.base[1];
    const b = job.crop.box;
    args.push("-crop", `${Math.round(b.width * sx)}x${Math.round(b.height * sy)}+${Math.round(b.x * sx)}+${Math.round(b.y * sy)}`, "+repage");
  }
  args.push("-filter", "Lanczos", "-resize", `${w}x${h}^`, "-gravity", "center", "-extent", `${w}x${h}`, "+repage");
  args.push("-strip", "-interlace", "JPEG", "-sampling-factor", "4:2:0", "-quality", String(q), job.dst);
  return args;
}

/** Converts all jobs; returns warnings (unexpected aspect ratios) and throws on the first failure. */
async function runJobs(tools: Tools, jobs: Job[], concurrency: number): Promise<string[]> {
  const warnings: string[] = [];
  await pool(jobs, concurrency, async (job) => {
    const head = readHead(job.src);
    const size = imageSize(head);
    if (!size) throw new Error(`${job.src}: not a readable PNG or JPEG`);
    const want = job.crop ? job.crop.box.width / job.crop.box.height : job.spec.w / job.spec.h;
    const have = job.crop ? (job.crop.box.width * (size.width / job.crop.base[0])) / (job.crop.box.height * (size.height / job.crop.base[1])) : size.width / size.height;
    if (!job.cover && Math.abs(have / want - 1) > 0.01) warnings.push(`${path.basename(job.src)} is ${size.width}x${size.height}: not the aspect of the output, it is cropped to cover`);
    fs.mkdirSync(path.dirname(job.dst), { recursive: true });
    await run(tools.magick, magickArgs(job, size));
    const out = fs.statSync(job.dst).size;
    if (out < 1024) throw new Error(`${job.dst}: the result is only ${out} bytes`);
  });
  return warnings;
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
  warnings: string[];
  log: (line: string) => void;
}

const PATTERN = {
  dayL: "media/day/l/{time}.{hash}.jpg",
  dayP: "media/day/p/{time}.{hash}.jpg",
  orbitL: "media/orbit/l/{i}.{hash}.jpg",
  orbitP: "media/orbit/p/{i}.{hash}.jpg",
} as const;
const NAMES = { poster: "orbit/poster", video: "orbit/orbit", og: "og", twitter: "twitter" } as const;

const fill = (pattern: string, t: { i?: number; time?: string; hash: string }): string =>
  pattern
    .replaceAll("{i}", t.i === undefined ? "{i}" : String(t.i).padStart(3, "0"))
    .replaceAll("{time}", t.time === undefined ? "{time}" : t.time.replace(":", ""))
    .replaceAll("{hash}", t.hash);

/** One frame sequence in both variants: converts the jobs, hashes the result and names the files. */
async function buildSequence(
  c: Ctx,
  variants: { key: "landscape" | "portrait"; pattern: string; spec: JpegSpec; crop?: Job["crop"]; sources: string[] }[],
  token: (index: number) => { i?: number; time?: string },
): Promise<{ hash: string; files: Staged[] }> {
  const jobs: { job: Job; pattern: string; tok: ReturnType<typeof token> }[] = [];
  for (const v of variants) {
    v.sources.forEach((src, index) => {
      const tok = token(index);
      jobs.push({ job: { src, dst: path.join(c.stage, relInMedia(fill(v.pattern, { ...tok, hash: "tmp" }))), spec: v.spec, crop: v.crop }, pattern: v.pattern, tok });
    });
  }
  c.warnings.push(...(await runJobs(c.tools, jobs.map((j) => j.job), c.jobs)));
  const hash = sequenceHash(jobs.map((j) => j.job.dst));
  const files = jobs.map((j) => ({ from: j.job.dst, rel: relInMedia(fill(j.pattern, { ...j.tok, hash })) }));
  return { hash, files };
}

async function buildDay(c: Ctx, sources: string[]): Promise<{ day: MediaManifest["day"]; files: Staged[] }> {
  const d = c.plan.day;
  const { hash, files } = await buildSequence(
    c,
    [
      { key: "landscape", pattern: PATTERN.dayL, spec: SPEC.day.landscape, sources },
      { key: "portrait", pattern: PATTERN.dayP, spec: SPEC.day.portrait, crop: { box: d.crop, base: d.size }, sources },
    ],
    (index) => ({ time: d.times[index] }),
  );
  const l = SPEC.day.landscape;
  const p = SPEC.day.portrait;
  return {
    files,
    day: {
      date: d.date,
      times: d.times,
      stillTime: d.stillTime,
      hash,
      landscape: { pattern: PATTERN.dayL, width: l.w, height: l.h },
      portrait: { pattern: PATTERN.dayP, width: p.w, height: p.h },
    },
  };
}

async function buildOrbitFrames(c: Ctx, landscape: string[], portrait: string[] | null): Promise<{ orbit: Omit<MediaManifest["orbit"], "video">; files: Staged[] }> {
  const o = c.plan.orbit;
  const variants: Parameters<typeof buildSequence>[1] = [{ key: "landscape", pattern: PATTERN.orbitL, spec: SPEC.orbit.landscape, sources: landscape }];
  if (portrait) variants.push({ key: "portrait", pattern: PATTERN.orbitP, spec: SPEC.orbit.portrait, sources: portrait });
  const { hash, files } = await buildSequence(c, variants, (index) => ({ i: index }));
  const l = SPEC.orbit.landscape;
  const p = SPEC.orbit.portrait;
  return {
    files,
    orbit: {
      frames: o.scrollCount,
      degPerFrame: o.degPerFrame,
      hash,
      landscape: { pattern: PATTERN.orbitL, width: l.w, height: l.h },
      ...(portrait ? { portrait: { pattern: PATTERN.orbitP, width: p.w, height: p.h } } : {}),
    },
  };
}

async function buildStills(c: Ctx, sources: string[]): Promise<{ stills: MediaManifest["stills"]; files: Staged[] }> {
  const jobs: Job[] = c.plan.stills.map((s, i) => ({ src: sources[i], dst: path.join(c.stage, "stills", `${s.id}.jpg`), spec: SPEC.stills }));
  c.warnings.push(...(await runJobs(c.tools, jobs, c.jobs)));
  const files: Staged[] = [];
  const stills = c.plan.stills.map((s, i) => {
    const rel = `stills/${hashedName(s.id, shortHash(fs.readFileSync(jobs[i].dst)), "jpg")}`;
    files.push({ from: jobs[i].dst, rel });
    return { id: s.id, file: MEDIA_PREFIX + rel, width: SPEC.stills.w, height: SPEC.stills.h, date: s.date, time: s.time, category: s.category, title: s.title, alt: s.alt };
  });
  return { stills, files };
}

async function buildOg(c: Ctx, source: string): Promise<{ og: MediaManifest["og"]; files: Staged[] }> {
  const jobs: Job[] = [
    { src: source, dst: path.join(c.stage, "og.jpg"), spec: SPEC.og },
    { src: source, dst: path.join(c.stage, "twitter.jpg"), spec: SPEC.twitter, cover: true },
  ];
  c.warnings.push(...(await runJobs(c.tools, jobs, c.jobs)));
  const [ogRel, twRel] = jobs.map((j, k) => `${hashedName(k === 0 ? NAMES.og : NAMES.twitter, shortHash(fs.readFileSync(j.dst)), "jpg")}`);
  return {
    files: [{ from: jobs[0].dst, rel: ogRel }, { from: jobs[1].dst, rel: twRel }],
    og: {
      file: MEDIA_PREFIX + ogRel,
      width: SPEC.og.w,
      height: SPEC.og.h,
      twitter: { file: MEDIA_PREFIX + twRel, width: SPEC.twitter.w, height: SPEC.twitter.h },
    },
  };
}

// ------------------------------------------------------------------------------------------------ video

interface VideoCache {
  video?: { key: string; crf: number; bytes: number; file: string };
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
  o: { cacheFile: string | null; force: boolean; bytes: [number, number] },
): Promise<{ video: NonNullable<MediaManifest["orbit"]["video"]>; files: Staged[]; info: NonNullable<BuildResult["video"]> }> {
  const plan = c.plan.orbit;
  const ext = path.extname(frames[0]);
  const input = path.join(path.dirname(frames[0]), `%04d${ext}`);
  frames.forEach((f, i) => {
    if (f !== input.replace("%04d", String(i).padStart(4, "0"))) throw new Error(`orbit frame ${i} is ${f}: the frames must be one numbered series (0000${ext} ...) in one folder with one extension`);
  });
  const version = (await run(ffmpeg, ["-version"])).split("\n")[0];
  const [minBytes, maxBytes] = o.bytes;
  const key = sourcesKey(frames, { version, post: "blank-encoder-name/1", spec: SPEC.video, fps: plan.fps, minBytes, maxBytes, args: ffmpegVideoArgs({ input: "", fps: plan.fps, frames: frames.length, crf: 0, out: "" }) });
  const cache = (o.cacheFile ? readJson<VideoCache>(o.cacheFile) : null) ?? {};
  const files: Staged[] = [];
  let file: string;
  let crf: number;
  let bytes: number;
  let reused = false;
  const cached = cache.video;
  if (!o.force && cached && cached.key === key && fs.existsSync(path.join(c.outDir, cached.file))) {
    ({ file, crf, bytes } = cached);
    reused = true;
    c.log(`[video] frames unchanged: reusing ${file} (crf ${crf}, ${(bytes / 1e6).toFixed(1)} MB)`);
  } else {
    const encode = async (crfTry: number): Promise<number> => {
      const t0 = Date.now();
      const out = path.join(c.stage, `video-crf${crfTry}.mp4`);
      await run(ffmpeg, ffmpegVideoArgs({ input, fps: plan.fps, frames: frames.length, crf: crfTry, out }));
      const size = fs.statSync(out).size;
      c.log(`[video] crf ${crfTry}: ${(size / 1e6).toFixed(2)} MB in ${((Date.now() - t0) / 1000).toFixed(0)} s`);
      return size;
    };
    const found = await searchCrf(encode, { start: SPEC.video.crfStart, minCrf: SPEC.video.crfMin, maxCrf: SPEC.video.crfMax, minBytes, maxBytes, targetBytes: Math.round((minBytes + maxBytes) / 2) });
    if (!found.inRange) c.warnings.push(`video: no CRF gives ${minBytes / 1e6}-${maxBytes / 1e6} MB (tried ${found.tried.map((t) => `${t.crf}: ${(t.bytes / 1e6).toFixed(1)} MB`).join(", ")}); the closest one is used`);
    const chosen = path.join(c.stage, `video-crf${found.crf}.mp4`);
    for (const t of found.tried) if (t.crf !== found.crf) fs.rmSync(path.join(c.stage, `video-crf${t.crf}.mp4`), { force: true });
    const data = fs.readFileSync(chosen);
    blankEncoderName(data);
    fs.writeFileSync(chosen, data);
    const problems = videoProblems(probeMp4(data), { width: SPEC.video.w, height: SPEC.video.h, fps: plan.fps, frames: frames.length });
    if (problems.length) throw new Error(`video: ${problems.join("; ")}`);
    crf = found.crf;
    bytes = data.length;
    file = `${NAMES.video}.${shortHash(data)}.mp4`;
    files.push({ from: chosen, rel: file });
  }
  // poster: the first frame as a picture of the size of the video
  const poster = path.join(c.stage, "poster.jpg");
  c.warnings.push(...(await runJobs(c.tools, [{ src: frames[0], dst: poster, spec: { w: SPEC.video.w, h: SPEC.video.h, q: SPEC.orbit.landscape.q } }], 1)));
  const posterRel = `${NAMES.poster}.${shortHash(fs.readFileSync(poster))}.jpg`;
  files.push({ from: poster, rel: posterRel });
  const ratio = await loopRatio(c.tools.magick, frames);
  if (ratio !== null && ratio > 2.5) c.warnings.push(`video: the last frame differs ${ratio.toFixed(1)} times more from the first one than neighbouring frames do: the loop is not closed`);
  if (o.cacheFile) {
    fs.mkdirSync(path.dirname(o.cacheFile), { recursive: true });
    fs.writeFileSync(o.cacheFile, `${JSON.stringify({ ...cache, video: { key, crf, bytes, file } }, null, 2)}\n`);
  }
  return {
    files,
    info: { crf, bytes, reused, loopRatio: ratio },
    video: { file: MEDIA_PREFIX + file, poster: MEDIA_PREFIX + posterRel, width: SPEC.video.w, height: SPEC.video.h, fps: plan.fps, durationS: frames.length / plan.fps },
  };
}

// ------------------------------------------------------------------------------------------------ the build

/** Hash of model/*.json the renders were made from: the one in render-inputs.json when that file exists, else the current one. */
function modelHashFor(o: { modelDir: string; renderInputs: string }, warnings: string[]): string | null {
  if (!fs.existsSync(o.modelDir)) return null;
  const files = fs
    .readdirSync(o.modelDir)
    .filter(isHashedModelFile)
    .map((name) => ({ name, content: fs.readFileSync(path.join(o.modelDir, name), "utf8") }));
  const current = hashModelFiles(files);
  const used = readJson<{ modelHash?: string }>(o.renderInputs)?.modelHash;
  if (used && used !== current) {
    warnings.push("generated/render-inputs.json was made from another version of model/*.json than the current one: the renders are stale; the manifest records the version they were made from");
    return used;
  }
  return current;
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

export async function buildMedia(o: BuildOptions): Promise<BuildResult> {
  const log = o.log ?? ((line: string) => console.log(line));
  const inDir = path.resolve(o.root, o.inDir ?? "pipeline/out");
  const outDir = path.resolve(o.root, o.outDir ?? "public/media");
  const res: BuildResult = { ok: false, missing: [], errors: [], warnings: [], built: [], timings: {}, manifest: null };
  const done = (): BuildResult => {
    res.ok = res.errors.length === 0 && res.missing.length === 0;
    return res;
  };

  let plan = o.plan;
  if (!plan) {
    const renderJson = path.resolve(o.root, o.renderJson ?? "model/render.json");
    try {
      plan = planFromRender(parseRenderConfig(JSON.parse(fs.readFileSync(renderJson, "utf8"))));
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
  const sources: Partial<Record<Section, string[]>> = {};
  const resolveAll = (section: Section, bases: string[]): string[] | null => {
    const files = bases.map((b) => resolveSource(inDir, b));
    const lost = bases.filter((_, i) => !files[i]);
    if (lost.length) {
      res.missing.push(...lost.map((b) => `${section}: ${b}`));
      return null;
    }
    return files as string[];
  };
  const orbitBases = [...plan.orbit.scrollSrc, ...(plan.orbit.portraitSrc ?? [])];
  const wanted: Record<Section, string[]> = {
    day: plan.day.src,
    orbit: orbitBases,
    stills: plan.stills.map((s) => s.src),
    og: [plan.og.src],
    video: plan.orbit.videoSrc,
  };
  for (const s of SECTIONS) if (want.has(s)) {
    const files = resolveAll(s, wanted[s]);
    if (files) sources[s] = files;
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
  const todo = SECTIONS.filter((s) => sources[s]);

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
    if (!todo.includes(s) && !existing) {
      res.errors.push(`${s}: nothing to build and no manifest that has it: build every section once first`);
    }
  }
  if (res.errors.length) return done();

  fs.mkdirSync(outDir, { recursive: true });
  const stage = path.join(outDir, `.build-${process.pid}`);
  fs.rmSync(stage, { recursive: true, force: true });
  fs.mkdirSync(stage, { recursive: true });
  const ctx: Ctx = { plan, tools, stage, outDir, jobs: o.jobs ?? Math.max(1, Math.min(8, os.cpus().length)), warnings: res.warnings, log };
  const staged: Staged[] = [];
  const part: { day?: MediaManifest["day"]; orbit?: Omit<MediaManifest["orbit"], "video">; stills?: MediaManifest["stills"]; og?: MediaManifest["og"]; video?: NonNullable<MediaManifest["orbit"]["video"]> } = {};
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
      const r = await timed("day", `${sources.day.length} frames, landscape and portrait`, () => buildDay(ctx, sources.day!));
      part.day = r.day;
      staged.push(...r.files);
    }
    if (sources.orbit) {
      const n = plan.orbit.scrollCount;
      const r = await timed("orbit", `${n} scroll frames${plan.orbit.portraitSrc ? ", landscape and portrait" : ""}`, () =>
        buildOrbitFrames(ctx, sources.orbit!.slice(0, n), plan.orbit.portraitSrc ? sources.orbit!.slice(n) : null),
      );
      part.orbit = r.orbit;
      staged.push(...r.files);
    }
    if (sources.stills) {
      const r = await timed("stills", `${sources.stills.length} stills`, () => buildStills(ctx, sources.stills!));
      part.stills = r.stills;
      staged.push(...r.files);
    }
    if (sources.og) {
      const r = await timed("og", "Open Graph and Twitter images", () => buildOg(ctx, sources.og![0]));
      part.og = r.og;
      staged.push(...r.files);
    }
    if (sources.video && ffmpeg) {
      const cacheFile = o.cacheFile === undefined ? path.join(inDir, "media-cache.json") : o.cacheFile;
      const r = await timed("video", `${sources.video.length} frames`, () =>
        buildVideo(ctx, ffmpeg, sources.video!, { cacheFile, force: o.force ?? false, bytes: o.videoBytes ?? [SPEC.video.minBytes, SPEC.video.maxBytes] }),
      );
      part.video = r.video;
      res.video = r.info;
      staged.push(...r.files);
    }

    // compose the manifest
    const old = existing;
    const orbitPart = part.orbit ?? (old ? { ...old.orbit, video: undefined } : undefined);
    const stagedRels = new Set(staged.map((s) => s.rel));
    const onDisk = (p: string): boolean => stagedRels.has(relInMedia(p)) || fs.existsSync(path.join(outDir, relInMedia(p)));
    let video = part.video ?? old?.orbit.video;
    if (video && !part.video && !(onDisk(video.file) && onDisk(video.poster))) {
      res.warnings.push("the video of the earlier build is gone from the media folder: the manifest has none");
      video = undefined;
    }
    if (video && !part.video && part.orbit) res.warnings.push("the video was not rebuilt: it may show other frames than the scroll frames");
    const manifest: MediaManifest = {
      schema: "media/1",
      inputHash: modelHashFor({ modelDir: path.resolve(o.root, o.modelDir ?? "model"), renderInputs: path.resolve(o.root, o.renderInputs ?? "generated/render-inputs.json") }, res.warnings),
      day: (part.day ?? old?.day)!,
      orbit: { ...orbitPart!, ...(video ? { video } : {}) } as MediaManifest["orbit"],
      stills: (part.stills ?? old?.stills)!,
      compare: part.stills ? plan.compare : old!.compare,
      og: (part.og ?? old?.og)!,
    };
    const checked = mediaManifestSchema.safeParse(manifest);
    if (!checked.success) throw new Error(`the manifest is invalid: ${checked.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`);
    const lost = manifestFiles(manifest).filter((f) => !onDisk(f.path));
    if (lost.length) throw new Error(`the manifest refers to ${lost.length} files that do not exist, e.g. ${lost[0].path}`);

    // promote: files first, the manifest last, so that an interrupted run leaves a consistent folder
    for (const s of staged) {
      const dst = path.join(outDir, s.rel);
      fs.mkdirSync(path.dirname(dst), { recursive: true });
      if (fs.existsSync(dst)) fs.rmSync(s.from);
      else fs.renameSync(s.from, dst);
    }
    const text = manifestJson(manifest);
    if (!fs.existsSync(manifestPath) || fs.readFileSync(manifestPath, "utf8") !== text) {
      fs.writeFileSync(`${manifestPath}.tmp-${process.pid}`, text);
      fs.renameSync(`${manifestPath}.tmp-${process.pid}`, manifestPath);
    }
    res.manifest = manifest;
    if (o.prune !== false) prune(outDir, new Set(manifestFiles(manifest).map((f) => relInMedia(f.path))), log);
    if (o.check !== false) {
      const c = checkMedia({ root: o.root, dir: outDir, modelDir: o.modelDir, renderJson: o.renderJson, allowExtra: o.prune === false });
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

const USAGE = `usage: build-media.ts [--only day,orbit,stills,og,video] [--partial] [--no-video] [--no-prune] [--no-check] [--force] [--jobs n]
                      [--in dir] [--out dir] [--video-mb lo-hi] [--cache file] [--render file] [--model-dir dir] [--render-inputs file] [--quiet]`;

export function parseArgs(argv: string[]): Omit<BuildOptions, "root"> & { quiet: boolean } {
  const o: Omit<BuildOptions, "root"> & { quiet: boolean } = { quiet: false };
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
    else if (a === "--no-video") o.video = false;
    else if (a === "--no-prune") o.prune = false;
    else if (a === "--no-check") o.check = false;
    else if (a === "--force") o.force = true;
    else if (a === "--quiet") o.quiet = true;
    else if (a === "--jobs") o.jobs = Math.max(1, Number(value(i++)) || 1);
    else if (a === "--in") o.inDir = value(i++);
    else if (a === "--out") o.outDir = value(i++);
    else if (a === "--cache") o.cacheFile = value(i++);
    else if (a === "--render") o.renderJson = value(i++);
    else if (a === "--model-dir") o.modelDir = value(i++);
    else if (a === "--render-inputs") o.renderInputs = value(i++);
    else if (a === "--video-mb") {
      const m = /^(\d+(?:\.\d+)?)-(\d+(?:\.\d+)?)$/.exec(value(i++));
      if (!m || Number(m[1]) >= Number(m[2])) throw new Error("--video-mb needs a range like 10-14");
      o.videoBytes = [Math.round(Number(m[1]) * 1e6), Math.round(Number(m[2]) * 1e6)];
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
  const t0 = Date.now();
  const res = await buildMedia({ ...opts, root, log: opts.quiet ? () => undefined : (l) => console.log(l) });
  for (const w of res.warnings) console.warn(`warning: ${w}`);
  for (const e of res.errors) console.error(`error: ${e}`);
  const m = res.manifest;
  const total = ((Date.now() - t0) / 1000).toFixed(0);
  if (m) {
    const v = m.orbit.video;
    console.log(
      `media: day ${m.day.times.length} frames, orbit ${m.orbit.frames} frames${v ? `, video ${v.durationS.toFixed(1)} s${res.video ? ` (${(res.video.bytes / 1e6).toFixed(1)} MB, crf ${res.video.crf})` : ""}` : ", no video"}, ${m.stills.length} stills, og ${m.og.width}x${m.og.height}; built ${res.built.join(", ") || "nothing"} in ${total} s`,
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
