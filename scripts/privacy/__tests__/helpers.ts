// Shared helpers for the privacy scanner tests: a synthetic denylist, temporary repositories, CLI runner and builders for
// small binary files. The planted strings are made up; none of them is a real value, and the real denylist is never used.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";
import { createContext, type Context, type Finding, scanBufferContent } from "../api.mjs";

export const SCAN_JS = fileURLToPath(new URL("../scan.mjs", import.meta.url));
export const HOOKS_DIR = fileURLToPath(new URL("../../../.githooks", import.meta.url));

/** Made-up strings that stand in for forbidden values. */
export const PLANT = {
  place: "Zorblax Village",
  stem: "quuxvil",
  person: "Gustav Plonk",
  surname: "plonk",
  slug: "plonk-house",
  csWord: "Wumpa",
  regexHit: "ZQ-4711",
  doc: "plonk_study.pdf",
};

/** Synthetic denylist used by all tests. */
export const SYNTHETIC_DENYLIST = {
  version: 1,
  salt: "test-salt",
  categories: {
    place: {
      literals: [PLANT.place, { v: PLANT.stem, mode: "sub" }, { v: PLANT.csWord, mode: "word-cs" }, { v: "kru", mode: "word" }],
      regexes: ["zq-\\d{4}"],
    },
    person: { literals: [{ v: PLANT.surname, mode: "sub" }] },
    domain: { literals: [PLANT.slug] },
    plot: {
      numbers: [
        { value: 1234.5, tol: 0.05, label: "area", kind: "area" },
        { value: 9.87, tol: 0.005, label: "ridge", keys: ["ridge"] },
        { value: 5432.1, tol: 0.05, label: "r1" },
        { value: 6543.21, tol: 0.005, label: "r2" },
        { value: 7654.321, tol: 0.0005, label: "r3" },
      ],
      sequences: [{ values: [1.11, 2.22, 3.33, 4.44, 5.55, 6.66], tol: 0.005, label: "poly" }],
    },
  },
};

export function makeContext(extra: Partial<Parameters<typeof createContext>[0]> = {}): Context {
  return createContext({ root: os.tmpdir(), denylistData: SYNTHETIC_DENYLIST, ...extra });
}

/** Categories found in a text (sorted, unique). */
export function categoriesOf(ctx: Context, text: string | Buffer, name = "sample.txt"): string[] {
  return [...new Set(scanBufferContent(ctx, text, name).map((f) => f.category))].sort();
}

export function findingsOf(ctx: Context, text: string | Buffer, name = "sample.txt"): Finding[] {
  return scanBufferContent(ctx, text, name);
}

// ------------------------------------------------------------------ temporary directories

const made: string[] = [];

export function tmpDir(prefix = "privacy-test-"): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  made.push(d);
  return d;
}

export function cleanupTmp(): void {
  for (const d of made.splice(0)) fs.rmSync(d, { recursive: true, force: true });
}

export function write(root: string, rel: string, content: string | Buffer): string {
  const abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content);
  return abs;
}

// ------------------------------------------------------------------ git and CLI

const GIT_ENV = {
  GIT_CONFIG_GLOBAL: os.devNull,
  GIT_CONFIG_SYSTEM: os.devNull,
  GIT_TERMINAL_PROMPT: "0",
};

export function git(cwd: string, args: string[], env: Record<string, string> = {}): { status: number; out: string; err: string } {
  const clean: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined && !k.startsWith("GIT_")) clean[k] = v;
  const r = spawnSync("git", args, { cwd, env: Object.assign({} as NodeJS.ProcessEnv, clean, GIT_ENV, env), encoding: "utf8" });
  return { status: r.status ?? 1, out: r.stdout ?? "", err: r.stderr ?? "" };
}

export interface Identity {
  name: string;
  email: string;
}

export function identityEnv(id: Identity): Record<string, string> {
  return { GIT_AUTHOR_NAME: id.name, GIT_AUTHOR_EMAIL: id.email, GIT_COMMITTER_NAME: id.name, GIT_COMMITTER_EMAIL: id.email };
}

/** A temporary repository with .privacy/ ignored and the synthetic denylist in place. */
export function makeRepo(opts: { denylist?: boolean } = {}): string {
  const dir = tmpDir("privacy-repo-");
  git(dir, ["init", "-q", "-b", "main"]);
  git(dir, ["config", "commit.gpgsign", "false"]);
  write(dir, ".gitignore", "/.privacy/\n");
  if (opts.denylist !== false) {
    write(dir, ".privacy/denylist.local.json", JSON.stringify(SYNTHETIC_DENYLIST));
    fs.chmodSync(path.join(dir, ".privacy/denylist.local.json"), 0o600);
  }
  return dir;
}

export function commitAll(dir: string, message: string, id: Identity): { status: number; out: string; err: string } {
  git(dir, ["add", "-A"]);
  return git(dir, ["commit", "-q", "--no-verify", "-m", message], identityEnv(id));
}

export interface CliResult {
  status: number;
  stdout: string;
  stderr: string;
}

export function runCli(args: string[], opts: { cwd?: string; env?: Record<string, string> } = {}): CliResult {
  const r = spawnSync(process.execPath, [SCAN_JS, ...args], { cwd: opts.cwd, env: { ...process.env, ...GIT_ENV, ...opts.env }, encoding: "utf8" });
  return { status: r.status ?? -1, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

// ------------------------------------------------------------------ binary builders

/** Big-endian TIFF with ASCII entries in IFD0 and an optional GPS IFD. */
export function buildTiff(ascii: [number, string][], gps = false): Buffer {
  const n = ascii.length + (gps ? 1 : 0);
  const ifdLen = 2 + 12 * n + 4;
  const datas = ascii.map(([, text]) => Buffer.from(`${text}\0`, "latin1"));
  let dataOff = 8 + ifdLen;
  const offsets = datas.map((d) => {
    const o = dataOff;
    dataOff += d.length + (d.length % 2);
    return o;
  });
  const gpsOff = dataOff;
  const out = Buffer.alloc(gps ? gpsOff + 2 + 12 + 4 : dataOff);
  out.write("MM", 0, "latin1");
  out.writeUInt16BE(42, 2);
  out.writeUInt32BE(8, 4);
  out.writeUInt16BE(n, 8);
  ascii.forEach(([tag], i) => {
    const e = 10 + i * 12;
    out.writeUInt16BE(tag, e);
    out.writeUInt16BE(2, e + 2);
    out.writeUInt32BE(datas[i].length, e + 4);
    if (datas[i].length <= 4) datas[i].copy(out, e + 8);
    else out.writeUInt32BE(offsets[i], e + 8);
    if (datas[i].length > 4) datas[i].copy(out, offsets[i]);
  });
  if (gps) {
    const e = 10 + ascii.length * 12;
    out.writeUInt16BE(0x8825, e);
    out.writeUInt16BE(4, e + 2);
    out.writeUInt32BE(1, e + 4);
    out.writeUInt32BE(gpsOff, e + 8);
    out.writeUInt16BE(1, gpsOff);
    out.writeUInt16BE(0, gpsOff + 2); // GPSVersionID
    out.writeUInt16BE(1, gpsOff + 4);
    out.writeUInt32BE(4, gpsOff + 6);
  }
  return out;
}

export function jpegSegment(marker: number, payload: Buffer): Buffer {
  const head = Buffer.alloc(4);
  head[0] = 0xff;
  head[1] = marker;
  head.writeUInt16BE(payload.length + 2, 2);
  return Buffer.concat([head, payload]);
}

/** A tiny but structurally valid JPEG skeleton with the given extra segments before the scan. */
export function buildJpeg(segments: Buffer[]): Buffer {
  const sos = Buffer.from([0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3f, 0x00, 0x12, 0x34, 0xff, 0xd9]);
  return Buffer.concat([Buffer.from([0xff, 0xd8]), jpegSegment(0xe0, Buffer.from("JFIF\0\x01\x01\0\0\x01\0\x01\0\0", "latin1")), ...segments, sos]);
}

export function exifSegment(ascii: [number, string][], gps = false): Buffer {
  return jpegSegment(0xe1, Buffer.concat([Buffer.from("Exif\0\0", "latin1"), buildTiff(ascii, gps)]));
}

function crc32(buf: Buffer): number {
  return zlib.crc32(buf) >>> 0;
}

export function pngChunk(type: string, data: Buffer): Buffer {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, "latin1");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type, "latin1"), data])), 0);
  return Buffer.concat([head, data, crc]);
}

export function buildPng(chunks: Buffer[]): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(1, 0);
  ihdr.writeUInt32BE(1, 4);
  ihdr[8] = 8;
  ihdr[9] = 0;
  const idat = zlib.deflateSync(Buffer.from([0, 0]));
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), pngChunk("IHDR", ihdr), ...chunks, pngChunk("IDAT", idat), pngChunk("IEND", Buffer.alloc(0))]);
}

export function pngText(keyword: string, value: string, compressed = false): Buffer {
  if (!compressed) return pngChunk("tEXt", Buffer.concat([Buffer.from(keyword, "latin1"), Buffer.from([0]), Buffer.from(value, "latin1")]));
  return pngChunk("zTXt", Buffer.concat([Buffer.from(keyword, "latin1"), Buffer.from([0, 0]), zlib.deflateSync(Buffer.from(value, "latin1"))]));
}

export function riffChunk(type: string, data: Buffer): Buffer {
  const head = Buffer.alloc(8);
  head.write(type, 0, "latin1");
  head.writeUInt32LE(data.length, 4);
  return Buffer.concat([head, data, data.length % 2 ? Buffer.from([0]) : Buffer.alloc(0)]);
}

export function buildWebp(chunks: Buffer[]): Buffer {
  const vp8x = riffChunk("VP8X", Buffer.alloc(10));
  const body = Buffer.concat([Buffer.from("WEBP", "latin1"), vp8x, ...chunks]);
  const head = Buffer.alloc(8);
  head.write("RIFF", 0, "latin1");
  head.writeUInt32LE(body.length, 4);
  return Buffer.concat([head, body]);
}

export function box(type: string, payload: Buffer | Buffer[] = Buffer.alloc(0)): Buffer {
  const body = Array.isArray(payload) ? Buffer.concat(payload) : payload;
  const head = Buffer.alloc(8);
  head.writeUInt32BE(body.length + 8, 0);
  head.write(type, 4, "latin1");
  return Buffer.concat([head, body]);
}

/** QuickTime text atom: 2-byte length, 2-byte language, text. */
export function qtText(type: string, text: string): Buffer {
  const t = Buffer.from(text, "utf8");
  const head = Buffer.alloc(4);
  head.writeUInt16BE(t.length, 0);
  return box(type, Buffer.concat([head, t]));
}

export function buildMp4(udtaChildren: Buffer[]): Buffer {
  const ftyp = box("ftyp", Buffer.from("isom\0\0\x02\0isomiso2", "latin1"));
  const moov = box("moov", [box("mvhd", Buffer.alloc(100)), box("udta", udtaChildren)]);
  const mdat = box("mdat", Buffer.from("not really video data, no strings of interest"));
  return Buffer.concat([ftyp, moov, mdat]);
}

export function buildGlb(json: object, bin?: Buffer): Buffer {
  let j = Buffer.from(JSON.stringify(json), "utf8");
  j = Buffer.concat([j, Buffer.alloc((4 - (j.length % 4)) % 4, 0x20)]);
  const chunks: Buffer[] = [];
  const jh = Buffer.alloc(8);
  jh.writeUInt32LE(j.length, 0);
  jh.writeUInt32LE(0x4e4f534a, 4);
  chunks.push(jh, j);
  if (bin) {
    const b = Buffer.concat([bin, Buffer.alloc((4 - (bin.length % 4)) % 4)]);
    const bh = Buffer.alloc(8);
    bh.writeUInt32LE(b.length, 0);
    bh.writeUInt32LE(0x004e4942, 4);
    chunks.push(bh, b);
  }
  const total = 12 + chunks.reduce((s, c) => s + c.length, 0);
  const head = Buffer.alloc(12);
  head.writeUInt32LE(0x46546c67, 0);
  head.writeUInt32LE(2, 4);
  head.writeUInt32LE(total, 8);
  return Buffer.concat([head, ...chunks]);
}

/** ZIP with stored (method 0) or deflated (method 8) entries. */
export function buildZip(entries: { name: string; data: Buffer; deflate?: boolean }[], comment = ""): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const e of entries) {
    const name = Buffer.from(e.name, "utf8");
    const data = e.deflate ? zlib.deflateRawSync(e.data) : e.data;
    const method = e.deflate ? 8 : 0;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x800, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(crc32(e.data), 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(e.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    const lr = Buffer.concat([local, name, data]);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x800, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt32LE(crc32(e.data), 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(e.data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(Buffer.concat([central, name]));
    locals.push(lr);
    offset += lr.length;
  }
  const cd = Buffer.concat(centrals);
  const c = Buffer.from(comment, "utf8");
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(cd.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(c.length, 20);
  return Buffer.concat([...locals, cd, eocd, c]);
}

/** UTF-16LE text embedded in binary noise. */
export function utf16InNoise(text: string): Buffer {
  return Buffer.concat([Buffer.from([0, 1, 2, 3, 0xff, 0xfe, 9]), Buffer.from(text, "utf16le"), Buffer.from([0, 7, 8, 9, 0x80])]);
}

/** Pieces that must not appear literally in this source (the repository scan would flag them). */
export const parts = {
  userPath: (name: string) => ["/Us", "ers/", name, "/project"].join(""),
  ip: () => ["203", "0", "113", "9"].join("."),
  url: (host: string) => ["https", "://", host, "/page"].join(""),
  phone: () => ["+420", " 777", " 123", " 456"].join(""),
  token: () => ["ghp", "_", "A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8"].join(""),
  pem: () => ["-----BEGIN ", "PRIVATE KEY-----"].join(""),
  email: (local: string, host: string) => `${local}@${host}`,
  latlon: () => ["49.1", "234, 16.5", "678"].join(""),
};
