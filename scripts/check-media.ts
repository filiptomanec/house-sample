// Checks that public/media is what manifest.json says it is (CI runs this; needs no ImageMagick and no ffmpeg):
//   - the manifest is valid (the schema of docs/MEDIA.md) and every file it names exists and is not truncated
//   - JPEG sizes equal the sizes in the manifest, no JPEG carries metadata (Exif, XMP, ICC, comments)
//   - the content hash in every file name (and the hash of each frame sequence) matches the bytes
//   - the video is H.264 High, 8-bit 4:2:0, the right size, frame rate and frame count, fast start, no audio, no metadata
//   - no generated file is left over that the manifest does not refer to
//   - the manifest matches model/render.json (shots, times, texts) and the renders were made from the current model/*.json
//
//   npx tsx scripts/check-media.ts                  check public/media
//   npx tsx scripts/check-media.ts --dir <folder>   another media folder
//   options: --no-model-check (skip the last point)  --allow-extra (leftover files are fine)  --quiet
// Exit code: 0 ok, 1 problems found, 2 usage.
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { hashModelFiles, isHashedModelFile } from "../src/lib/model/hash";
import { SPEC, manifestFiles, parseManifest, planFromRender, relInMedia, shortHash, type MediaManifest } from "./lib/media-plan";
import { probeJpeg, probeMp4 } from "./lib/media-probe";
import { videoProblems } from "./lib/media-video";
import { parseRenderConfig } from "./lib/render-schema";

export interface CheckOptions {
  root: string;
  dir?: string;
  modelCheck?: boolean;
  allowExtra?: boolean;
  modelDir?: string;
  renderJson?: string;
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

/** The frame sequence a role belongs to (its files share one hash), or null for a single file. */
const sequenceOf = (role: string): "day" | "orbit" | null => (role.startsWith("day.") ? "day" : role === "orbit.landscape" || role === "orbit.portrait" ? "orbit" : null);

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

  // expected size of every JPEG role
  const size = (w: number, h: number): [number, number] => [w, h];
  const expected = new Map<string, [number, number]>();
  expected.set("day.landscape", size(m.day.landscape.width, m.day.landscape.height));
  if (m.day.portrait) expected.set("day.portrait", size(m.day.portrait.width, m.day.portrait.height));
  expected.set("orbit.landscape", size(m.orbit.landscape.width, m.orbit.landscape.height));
  if (m.orbit.portrait) expected.set("orbit.portrait", size(m.orbit.portrait.width, m.orbit.portrait.height));
  if (m.orbit.video) {
    expected.set("orbit.poster", size(m.orbit.video.width, m.orbit.video.height));
  }
  for (const s of m.stills) expected.set(`still.${s.id}`, size(s.width, s.height));
  expected.set("og", size(m.og.width, m.og.height));
  if (m.og.twitter) expected.set("og.twitter", size(m.og.twitter.width, m.og.twitter.height));

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
    if (!fs.existsSync(file)) {
      err(`${f.path} (${f.role}) does not exist`);
      broken.add(sequenceOf(f.role) ?? "");
      continue;
    }
    const buf = fs.readFileSync(file);
    res.files++;
    res.bytes += buf.length;
    if (buf.length === 0) {
      err(`${f.path} is empty`);
      broken.add(sequenceOf(f.role) ?? "");
      continue;
    }
    const hashInName = /\.([0-9a-f]{6,64})\.(?:jpg|mp4)$/.exec(f.path)?.[1];
    const seq = sequenceOf(f.role);
    if (seq) {
      sequences[seq].update(buf);
      if (hashInName !== m[seq].hash) err(`${f.path}: the hash in the name is not the sequence hash ${m[seq].hash}`);
    } else if (hashInName !== shortHash(buf)) err(`${f.path}: the hash in the name is not the hash of the content (${shortHash(buf)})`);

    if (f.path.endsWith(".mp4")) {
      checkVideo(m, buf, f.path, res);
      continue;
    }
    try {
      const j = probeJpeg(buf);
      const want = expected.get(f.role);
      if (want && (j.width !== want[0] || j.height !== want[1])) err(`${f.path}: ${j.width}x${j.height}, the manifest says ${want[0]}x${want[1]}`);
      if (j.metadata.length) err(`${f.path} carries metadata: ${j.metadata.join(", ")}`);
      if (j.subsampling !== "4:2:0") res.warnings.push(`${f.path}: chroma subsampling ${j.subsampling}, 4:2:0 is expected`);
      if (buf[buf.length - 2] !== 0xff || buf[buf.length - 1] !== 0xd9) err(`${f.path} is truncated (no end-of-image marker)`);
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
  if (o.modelCheck !== false) checkAgainstModel(o, m, res);
  return res;
}

function checkVideo(m: MediaManifest, buf: Buffer, p: string, res: CheckResult): void {
  const v = m.orbit.video;
  if (!v) return;
  try {
    const info = probeMp4(buf);
    for (const problem of videoProblems(info, { width: v.width, height: v.height, fps: v.fps, frames: Math.round(v.durationS * v.fps) })) res.errors.push(`${p}: ${problem}`);
    if (info.video && Math.abs(info.video.durationS - v.durationS) > 1 / v.fps) res.errors.push(`${p}: ${info.video.durationS.toFixed(2)} s, the manifest says ${v.durationS} s`);
    if (buf.length > SPEC.video.hardMaxBytes) res.errors.push(`${p}: ${(buf.length / 1e6).toFixed(1)} MB is more than the ${SPEC.video.hardMaxBytes / 1e6} MB limit`);
    else if (buf.length > SPEC.video.maxBytes || buf.length < SPEC.video.minBytes) {
      res.warnings.push(`${p}: ${(buf.length / 1e6).toFixed(1)} MB is outside ${SPEC.video.minBytes / 1e6}-${SPEC.video.maxBytes / 1e6} MB`);
    }
  } catch (e) {
    res.errors.push(`${p}: ${(e as Error).message}`);
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
    plan = planFromRender(parseRenderConfig(JSON.parse(fs.readFileSync(path.resolve(o.root, o.renderJson ?? "model/render.json"), "utf8"))));
  } catch (e) {
    err((e as Error).message);
    return;
  }
  const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);
  if (!same(m.day.times, plan.day.times)) err("day.times differ from the shots of model/render.json");
  if (m.day.stillTime !== plan.day.stillTime || m.day.date !== plan.day.date) err("day.date or day.stillTime differ from model/render.json");
  if (m.orbit.frames !== plan.orbit.scrollCount || Math.abs(m.orbit.degPerFrame - plan.orbit.degPerFrame) > 1e-6) err("orbit.frames or orbit.degPerFrame differ from model/render.json");
  if (!plan.orbit.portraitSrc !== !m.orbit.portrait) err("the portrait orbit of the manifest and of model/render.json differ");
  if (m.orbit.video && (m.orbit.video.fps !== plan.orbit.fps || Math.abs(m.orbit.video.durationS - plan.orbit.frameCount / plan.orbit.fps) > 1e-6)) err("the video fps or duration differ from model/render.json");
  if (!same(m.stills.map((s) => [s.id, s.date, s.time, s.category, s.title, s.alt]), plan.stills.map((s) => [s.id, s.date, s.time, s.category, s.title, s.alt]))) err("the stills (ids, times, texts) differ from model/render.json");
  if (!same(m.compare, plan.compare)) err("compare differs from model/render.json");
}

function main(argv: string[]): number {
  const o: CheckOptions = { root: path.resolve(path.dirname(process.argv[1] ?? "."), "..") };
  let quiet = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--dir" && argv[i + 1]) o.dir = argv[++i];
    else if (a === "--no-model-check") o.modelCheck = false;
    else if (a === "--allow-extra") o.allowExtra = true;
    else if (a === "--quiet") quiet = true;
    else {
      console.error(`unknown option ${a}\nusage: check-media.ts [--dir folder] [--no-model-check] [--allow-extra] [--quiet]`);
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
    console.log(`media ok: ${r.files} files, ${(r.bytes / 1e6).toFixed(1)} MB; day ${r.manifest.day.times.length}, orbit ${r.manifest.orbit.frames}, stills ${r.manifest.stills.length}${v ? `, video ${v.durationS} s` : ""}`);
  }
  return 0;
}

if (process.argv[1] && /check-media\.[cm]?[jt]s$/.test(process.argv[1])) process.exit(main(process.argv.slice(2)));
