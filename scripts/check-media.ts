// Checks that public/media is what manifest.json says it is (CI runs this; needs no ImageMagick and no ffmpeg):
//   - the manifest is valid (the schema of docs/MEDIA.md) and every file it names exists and is not truncated
//   - every picture (JPEG, WebP, AVIF) has the size the manifest gives and carries no metadata (Exif, XMP, ICC, comments)
//   - the content hash in every file name (and the hash of each frame sequence) matches the bytes
//   - every video rendition is H.264 High, 8-bit 4:2:0, the right size, frame rate and frame count, fast start, no audio, no
//     metadata, below the size limit
//   - no generated file is left over that the manifest does not refer to
//   - the share images of the app folder (src/app/opengraph-image.jpg, twitter-image.jpg and their .alt.txt) are the manifest's
//   - the manifest matches model/render.json (shots, times, texts) and the renders were made from the current model/*.json
//   - a proof build (stand-in renders) is a warning, and an error with --final (the release gate)
//
//   npx tsx scripts/check-media.ts                  check public/media
//   npx tsx scripts/check-media.ts --dir <folder>   another media folder (the app folder is then not checked)
//   options: --no-model-check (skip the model comparison)  --allow-extra (leftover files are fine)  --final  --quiet
// Exit code: 0 ok, 1 problems found, 2 usage.
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { nb } from "../src/lib/i18n/format";
import { hashModelFiles, isHashedModelFile } from "../src/lib/model/hash";
import {
  SPEC,
  extOf,
  manifestFiles,
  parseManifest,
  planFromRender,
  readFootprint,
  relInMedia,
  sequenceOfRole,
  shortHash,
  type MediaManifest,
} from "./lib/media-plan";
import { probeAvif, probeJpeg, probeMp4, probeWebp } from "./lib/media-probe";
import { videoProblems } from "./lib/media-video";
import { parseRenderConfig } from "./lib/render-schema";

export interface CheckOptions {
  root: string;
  dir?: string;
  modelCheck?: boolean;
  allowExtra?: boolean;
  modelDir?: string;
  renderJson?: string;
  derivedJson?: string;
  /** The app folder with the share images (default `src/app` when `dir` is the default media folder); null to skip. */
  appDir?: string | null;
  /** Release gate: stand-in renders are an error, not a warning. */
  final?: boolean;
}

export interface CheckResult {
  errors: string[];
  warnings: string[];
  manifest: MediaManifest | null;
  files: number;
  bytes: number;
}

function walk(dir: string, base = dir): string[] {
  const out: string[] = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith(".")) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(full, base));
    else out.push(path.relative(base, full).split(path.sep).join("/"));
  }
  return out;
}

/** Size, metadata and completeness of a picture, by its file type. */
function probePicture(buf: Buffer, ext: string): { width: number; height: number; metadata: string[]; problems: string[]; warnings: string[] } {
  if (ext === "jpg" || ext === "jpeg") {
    const j = probeJpeg(buf);
    const problems = buf[buf.length - 2] !== 0xff || buf[buf.length - 1] !== 0xd9 ? ["truncated (no end-of-image marker)"] : [];
    const warnings = j.subsampling !== "4:2:0" ? [`chroma subsampling ${j.subsampling}, 4:2:0 is expected`] : [];
    return { width: j.width, height: j.height, metadata: j.metadata, problems, warnings };
  }
  if (ext === "webp") {
    const w = probeWebp(buf);
    const problems = [...(w.complete ? [] : ["truncated (the RIFF size does not match the file)"]), ...(w.kind === "lossy" ? [] : ["not a lossy WebP"]), ...(w.alpha ? ["has an alpha channel"] : [])];
    return { width: w.width, height: w.height, metadata: w.metadata, problems, warnings: [] };
  }
  if (ext === "avif") {
    const a = probeAvif(buf);
    return { width: a.width, height: a.height, metadata: a.metadata, problems: a.complete ? [] : ["truncated (no image data)"], warnings: [] };
  }
  throw new Error(`unexpected file type .${ext}`);
}

const videoCeiling = (width: number): number => (SPEC.video.variants.find((v) => v.w === width) ?? SPEC.video.variants[0]).maxBytes;

export function checkMedia(o: CheckOptions): CheckResult {
  const dir = path.resolve(o.root, o.dir ?? "public/media");
  const res: CheckResult = { errors: [], warnings: [], manifest: null, files: 0, bytes: 0 };
  const err = (m: string): void => void res.errors.push(m);
  const manifestPath = path.join(dir, "manifest.json");
  if (!fs.existsSync(manifestPath)) {
    err(`${path.relative(o.root, manifestPath)} does not exist`);
    return res;
  }
  let m: MediaManifest;
  try {
    m = parseManifest(JSON.parse(fs.readFileSync(manifestPath, "utf8")));
  } catch (e) {
    err((e as Error).message);
    return res;
  }
  res.manifest = m;

  const list = manifestFiles(m);
  const seen = new Set<string>();
  const sequences = { day: createHash("sha256"), orbit: createHash("sha256") };
  const broken = new Set<string>();
  for (const f of list) {
    if (seen.has(f.path)) {
      err(`${f.path} is named twice in the manifest`);
      continue;
    }
    seen.add(f.path);
    const file = path.join(dir, relInMedia(f.path));
    const seq = sequenceOfRole(f.role);
    if (!fs.existsSync(file)) {
      err(`${f.path} (${f.role}) does not exist`);
      broken.add(seq ?? "");
      continue;
    }
    const buf = fs.readFileSync(file);
    res.files++;
    res.bytes += buf.length;
    if (buf.length === 0) {
      err(`${f.path} is empty`);
      broken.add(seq ?? "");
      continue;
    }
    const hashInName = /\.([0-9a-f]{6,64})\.(?:jpg|webp|avif|mp4)$/.exec(f.path)?.[1];
    if (seq) {
      sequences[seq].update(buf);
      if (hashInName !== m[seq].hash) err(`${f.path}: the hash in the name is not the sequence hash ${m[seq].hash}`);
    } else if (hashInName !== shortHash(buf)) err(`${f.path}: the hash in the name is not the hash of the content (${shortHash(buf)})`);

    const ext = extOf(f.path);
    if (ext === "mp4") {
      checkVideo(m, buf, f.path, f.width ?? 0, f.height ?? 0, res);
      continue;
    }
    try {
      const p = probePicture(buf, ext);
      if (f.width && f.height && (p.width !== f.width || p.height !== f.height)) err(`${f.path}: ${p.width}x${p.height}, the manifest says ${f.width}x${f.height}`);
      if (p.metadata.length) err(`${f.path} carries metadata: ${p.metadata.join(", ")}`);
      for (const x of p.problems) err(`${f.path}: ${x}`);
      for (const x of p.warnings) res.warnings.push(`${f.path}: ${x}`);
    } catch (e) {
      err(`${f.path}: ${(e as Error).message}`);
    }
  }
  for (const key of ["day", "orbit"] as const) {
    const h = m[key].hash;
    const total = sequences[key].digest("hex").slice(0, h.length);
    if (!broken.has(key) && total !== h) err(`${key}: the sequence hash ${h} in the manifest is not the hash of the frames (${total})`);
  }

  if (!o.allowExtra) {
    const extra = walk(dir).filter((rel) => rel !== "manifest.json" && !seen.has(`media/${rel}`));
    if (extra.length) err(`${extra.length} files are not in the manifest, e.g. ${extra.slice(0, 3).join(", ")} (remove them or run build-media)`);
  }
  if (m.standIns) {
    const msg = `a proof build: ${m.standIns} renders are stand-ins, so pictures do not show what their texts say (render, then run build-media without --stand-ins)`;
    if (o.final) err(msg);
    else res.warnings.push(msg);
  }
  const appDir = o.appDir === undefined ? (o.dir === undefined ? path.join(o.root, "src", "app") : null) : o.appDir;
  if (appDir) checkApp(appDir, dir, m, res);
  if (o.modelCheck !== false) checkAgainstModel(o, m, res);
  return res;
}

function checkVideo(m: MediaManifest, buf: Buffer, p: string, width: number, height: number, res: CheckResult): void {
  const v = m.orbit.video;
  if (!v) return;
  try {
    const info = probeMp4(buf);
    for (const problem of videoProblems(info, { width, height, fps: v.fps, frames: Math.round(v.durationS * v.fps) })) res.errors.push(`${p}: ${problem}`);
    if (info.video && Math.abs(info.video.durationS - v.durationS) > 1 / v.fps) res.errors.push(`${p}: ${info.video.durationS.toFixed(2)} s, the manifest says ${v.durationS} s`);
    if (buf.length > SPEC.video.hardMaxBytes) res.errors.push(`${p}: ${(buf.length / 1e6).toFixed(1)} MB is more than the ${SPEC.video.hardMaxBytes / 1e6} MB limit`);
    else if (buf.length > videoCeiling(width)) res.warnings.push(`${p}: ${(buf.length / 1e6).toFixed(1)} MB is above the ${(videoCeiling(width) / 1e6).toFixed(0)} MB ceiling of the ${width} px rendition`);
  } catch (e) {
    res.errors.push(`${p}: ${(e as Error).message}`);
  }
}

/** The share images of the app folder are byte copies of the manifest's og files, and the alt text is the manifest's (Czech). */
function checkApp(appDir: string, dir: string, m: MediaManifest, res: CheckResult): void {
  const pairs: [string, string | undefined][] = [["opengraph-image.jpg", m.og.file], ["twitter-image.jpg", m.og.twitter?.file]];
  for (const [name, file] of pairs) {
    if (!file) continue;
    const app = path.join(appDir, name);
    const media = path.join(dir, relInMedia(file));
    if (!fs.existsSync(app)) res.errors.push(`${name} is missing in the app folder (run build-media)`);
    else if (fs.existsSync(media) && !fs.readFileSync(app).equals(fs.readFileSync(media))) res.errors.push(`${name} in the app folder is not ${file} (run build-media)`);
  }
  if (m.og.alt) {
    const want = `${nb(m.og.alt.cs, "cs")}\n`;
    for (const name of ["opengraph-image.alt.txt", "twitter-image.alt.txt"]) {
      const f = path.join(appDir, name);
      if (fs.existsSync(f) && fs.readFileSync(f, "utf8") !== want) res.errors.push(`${name} is not the og alt text of the manifest (run build-media)`);
    }
  }
}

/** The manifest against the sources it was made from: model/render.json (shots and texts) and the hash of model/*.json. */
function checkAgainstModel(o: CheckOptions, m: MediaManifest, res: CheckResult): void {
  const err = (msg: string): void => void res.errors.push(msg);
  const modelDir = path.resolve(o.root, o.modelDir ?? "model");
  if (!fs.existsSync(modelDir)) {
    res.warnings.push("no model folder: the manifest was not compared with the model");
    return;
  }
  const files = fs.readdirSync(modelDir).filter(isHashedModelFile).map((name) => ({ name, content: fs.readFileSync(path.join(modelDir, name), "utf8") }));
  const current = hashModelFiles(files);
  if (!m.inputHash) res.warnings.push("the manifest has no inputHash: it cannot be compared with the current model/*.json");
  else if (m.inputHash !== current) err("the renders are stale: model/*.json changed since they were made (render again and run build-media)");

  let plan;
  try {
    const footprint = readFootprint(path.resolve(o.root, o.derivedJson ?? "generated/derived.json"));
    plan = planFromRender(parseRenderConfig(JSON.parse(fs.readFileSync(path.resolve(o.root, o.renderJson ?? "model/render.json"), "utf8"))), { footprint });
  } catch (e) {
    err((e as Error).message);
    return;
  }
  const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);
  if (!same(m.day.times, plan.day.times)) err("day.times differ from the shots of model/render.json");
  if (m.day.stillTime !== plan.day.stillTime || m.day.date !== plan.day.date) err("day.date or day.stillTime differ from model/render.json");
  if (!plan.day.portraitSrc !== !m.day.portrait) err("the portrait day frames of the manifest and of model/render.json differ");
  if (m.orbit.frames !== plan.orbit.scrollCount || Math.abs(m.orbit.degPerFrame - plan.orbit.degPerFrame) > 1e-6) err("orbit.frames or orbit.degPerFrame differ from model/render.json");
  if (!plan.orbit.portraitSrc !== !m.orbit.portrait) err("the portrait orbit of the manifest and of model/render.json differ");
  if (m.orbit.startAzimuthDeg !== undefined && (m.orbit.startAzimuthDeg !== plan.orbit.startAzimuthDeg || m.orbit.direction !== plan.orbit.direction)) err("orbit.startAzimuthDeg or orbit.direction differ from model/render.json");
  if (m.orbit.captionHalfWindowDeg !== undefined && m.orbit.captionHalfWindowDeg !== plan.orbit.captionHalfWindowDeg) err("orbit.captionHalfWindowDeg differs from model/render.json");
  if (m.orbit.video && (m.orbit.video.fps !== plan.orbit.fps || Math.abs(m.orbit.video.durationS - plan.orbit.frameCount / plan.orbit.fps) > 1e-6)) err("the video fps or duration differ from model/render.json");
  const row = (s: { id: string; date: string; time: string; category: string; title: unknown; alt: unknown; gallery?: boolean }) => [s.id, s.date, s.time, s.category, s.title, s.alt, s.gallery !== false];
  if (!same(m.stills.map(row), plan.stills.map(row))) err("the stills (ids, times, categories, texts, gallery flags) differ from model/render.json");
  if (m.compare.a !== plan.compare.a || m.compare.b !== plan.compare.b) err("compare differs from model/render.json");
  if (m.compare.before && !same([m.compare.alt, m.compare.before, m.compare.after], [plan.compare.alt, plan.compare.before, plan.compare.after])) err("the texts of the compare pair differ from model/render.json");
  if (m.og.alt && !same(m.og.alt, plan.og.alt)) err("og.alt differs from model/render.json");
}

function main(argv: string[]): number {
  const o: CheckOptions = { root: path.resolve(path.dirname(process.argv[1] ?? "."), "..") };
  let quiet = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--dir" && argv[i + 1]) o.dir = argv[++i];
    else if (a === "--no-model-check") o.modelCheck = false;
    else if (a === "--allow-extra") o.allowExtra = true;
    else if (a === "--final") o.final = true;
    else if (a === "--quiet") quiet = true;
    else {
      console.error(`unknown option ${a}\nusage: check-media.ts [--dir folder] [--no-model-check] [--allow-extra] [--final] [--quiet]`);
      return 2;
    }
  }
  const r = checkMedia(o);
  for (const w of r.warnings) console.warn(`warning: ${w}`);
  for (const e of r.errors) console.error(`error: ${e}`);
  if (r.errors.length) {
    console.error(`media check failed: ${r.errors.length} problems`);
    return 1;
  }
  if (!quiet && r.manifest) {
    const v = r.manifest.orbit.video;
    console.log(
      `media ok: ${r.files} files, ${(r.bytes / 1e6).toFixed(1)} MB; day ${r.manifest.day.times.length}, orbit ${r.manifest.orbit.frames}, stills ${r.manifest.stills.length}${v ? `, video ${v.durationS} s` : ""}${r.manifest.standIns ? ` (proof build: ${r.manifest.standIns} stand-ins)` : ""}`,
    );
  }
  return 0;
}

if (process.argv[1] && /check-media\.[cm]?[jt]s$/.test(process.argv[1])) process.exit(main(process.argv.slice(2)));
