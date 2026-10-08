// Tests of the media build (scripts/build-media.ts, scripts/check-media.ts, scripts/lib/media-*.ts). The renders are synthetic
// pictures made with ImageMagick into pipeline/out/test-media-* (git-ignored, removed afterwards); the parts that need
// ImageMagick or ffmpeg are skipped when the tool is not installed (MAGICK / FFMPEG point to them when they are not in PATH).
// Counts and sizes are computed from model/render.json and the output specification, never written here.
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { APP_FILES, StandIns, appAltText, buildMedia, discoverTools, parseArgs, type BuildOptions } from "../build-media";
import { checkMedia } from "../check-media";
import { buildRenderInputs, solarProvider } from "../build-render-inputs";
import {
  SPEC,
  expandPattern,
  extOf,
  insidePolygon,
  manifestFiles,
  mediaManifestSchema,
  parseManifest,
  planFromRender,
  readFootprint,
  relInMedia,
  strideIndices,
  type MediaManifest,
  type MediaPlan,
} from "../lib/media-plan";
import { ogCompositeArgs, ogFonts } from "../lib/media-og";
import { blankEncoderName, imageSize, probeAvif, probeJpeg, probeMp4, probeWebp } from "../lib/media-probe";
import { makeSyntheticRenders } from "../lib/media-synthetic";
import { ffmpegVideoArgs, searchCrf, videoProblems } from "../lib/media-video";
import { expandRanges } from "../lib/render-shots";
import { parseRenderConfig } from "../lib/render-schema";

const root = path.resolve(__dirname, "..", "..");
const cfg = parseRenderConfig(JSON.parse(fs.readFileSync(path.join(root, "model/render.json"), "utf8")));
const footprint = readFootprint(path.join(root, "generated/derived.json"));
const realPlan = planFromRender(cfg, { footprint });
const found = discoverTools(root);
const magick = found.magick;
const ffmpeg = found.ffmpeg;
const scratch = path.join(root, "pipeline/out", `test-media-${process.pid}`);

fs.mkdirSync(scratch, { recursive: true });
afterAll(() => fs.rmSync(scratch, { recursive: true, force: true }));

const formatOf = (buf: Buffer): string => {
  if (buf[0] === 0xff && buf[1] === 0xd8) return "jpg";
  if (buf.toString("latin1", 0, 4) === "RIFF" && buf.toString("latin1", 8, 12) === "WEBP") return "webp";
  if (buf.toString("latin1", 4, 12) === "ftypavif") return "avif";
  if (buf.toString("latin1", 4, 8) === "ftyp") return "mp4";
  return "?";
};

// ------------------------------------------------------------------------------------------------ no tools needed

describe("plan", () => {
  const times = expandRanges(cfg.day.ranges);
  const scrollCount = Math.ceil(cfg.orbit.frameCount / cfg.orbit.scrollStep);

  it("lists one landscape and one portrait render per day time, the scroll frames, the video frames and every still", () => {
    expect(realPlan.day.times).toEqual(times);
    expect(realPlan.day.src).toHaveLength(times.length);
    expect(realPlan.day.portraitSrc).toHaveLength(times.length);
    expect(realPlan.orbit.scrollCount).toBe(scrollCount);
    expect(realPlan.orbit.scrollSrc).toHaveLength(scrollCount);
    expect(realPlan.orbit.portraitSrc).toHaveLength(Math.ceil(scrollCount / SPEC.orbit.portraitStride));
    expect(realPlan.orbit.videoSrc).toHaveLength(cfg.orbit.frameCount);
    expect(realPlan.orbit.degPerFrame * scrollCount).toBeCloseTo(360 * (scrollCount * cfg.orbit.scrollStep) / cfg.orbit.frameCount, 6);
    expect(realPlan.stills).toHaveLength(cfg.stills.length + 2);
    expect(new Set(realPlan.stills.map((s) => s.id)).size).toBe(realPlan.stills.length);
    expect(realPlan.compare.a).toBe(realPlan.stills.at(-2)!.id);
    expect(realPlan.compare.b).toBe(realPlan.stills.at(-1)!.id);
  });

  it("names exactly the files the render inputs write (stills, compare, og, day in both cameras, orbit frames)", () => {
    const ri = buildRenderInputs({ root, sun: solarProvider, furnitureReport: null }).data as unknown as {
      stills: { file: string }[];
      day: { frames: { file: string; portrait?: { file: string } }[] };
      orbit: { variants: { id: string; frames: { file: string }[] }[] };
      compare: { before: { file: string }; after: { file: string } };
      og: { file: string };
    };
    expect(realPlan.stills.slice(0, -2).map((s) => s.src)).toEqual(ri.stills.map((s) => s.file));
    expect(realPlan.stills.slice(-2).map((s) => s.src)).toEqual([ri.compare.before.file, ri.compare.after.file]);
    expect(realPlan.og.src).toBe(ri.og.file);
    expect(realPlan.day.src).toEqual(ri.day.frames.map((f) => f.file));
    expect(realPlan.day.portraitSrc).toEqual(ri.day.frames.map((f) => f.portrait?.file));
    const files = new Set(ri.orbit.variants.flatMap((v) => v.frames.map((f) => f.file)));
    for (const b of [...realPlan.orbit.videoSrc, ...realPlan.orbit.scrollSrc, ...(realPlan.orbit.portraitSrc ?? [])]) expect(files.has(b), b).toBe(true);
  });

  it("serves the portrait orbit at every stride-th scroll frame, starting with the first", () => {
    const stride = realPlan.orbit.portraitStride;
    const step = cfg.orbit.scrollStep;
    realPlan.orbit.portraitSrc!.forEach((b, j) => expect(Number(b.slice(-4))).toBe(j * stride * step));
  });

  it("carries the texts of model/render.json: titles, alt texts, the compare sides, the gallery flag and the og alt", () => {
    cfg.stills.forEach((s, i) => {
      expect(realPlan.stills[i].title).toEqual(s.label);
      expect(realPlan.stills[i].alt).toEqual(s.alt);
      expect(realPlan.stills[i].gallery).toBe(true);
      expect(realPlan.stills[i].category).toBe(s.category === "evening" ? "exterior" : s.category);
    });
    for (const side of ["before", "after"] as const) {
      const still = realPlan.stills.find((s) => s.id === `${cfg.compare.id}-${side}`)!;
      expect(still.title).toEqual(cfg.compare[side].title);
      expect(still.alt).toEqual(cfg.compare[side].alt);
      expect(still.gallery).toBe(cfg.compare[side].gallery !== false);
      expect(realPlan.compare[side]).toEqual({ label: cfg.compare[side].label, title: cfg.compare[side].title, alt: cfg.compare[side].alt });
    }
    expect(realPlan.og.alt).toEqual(cfg.og.alt);
    expect(realPlan.orbit.startAzimuthDeg).toBe(cfg.orbit.startAzimuthDeg);
    expect(realPlan.orbit.direction).toBe(cfg.orbit.direction);
    expect(realPlan.orbit.captionHalfWindowDeg).toBe(cfg.orbit.captions.halfWindowDeg);
  });

  it("calls the compare pair an interior view exactly when its camera stands inside the house", () => {
    const cam = cfg.compare.camera.position;
    const inside = footprint ? insidePolygon([cam[0], cam[1]], footprint) : false;
    expect(realPlan.stills.at(-1)!.category).toBe(inside ? "interior" : "exterior");
    const square: [number, number][] = [[cam[0] - 1, cam[1] - 1], [cam[0] + 1, cam[1] - 1], [cam[0] + 1, cam[1] + 1], [cam[0] - 1, cam[1] + 1]];
    expect(planFromRender(cfg, { footprint: square }).stills.at(-1)!.category).toBe("interior");
    expect(planFromRender(cfg, { footprint: null }).stills.at(-1)!.category).toBe("exterior");
  });
});

describe("searchCrf", () => {
  const opts = { start: 18, minCrf: 12, maxCrf: 34, minBytes: 10e6, maxBytes: 14e6, targetBytes: 12e6 };
  // the size doubles every 6 CRF steps
  const model = (at18: number) => async (crf: number) => Math.round(at18 * 2 ** ((18 - crf) / 6));

  it("stops at the first size in range", async () => {
    const r = await searchCrf(model(12e6), opts);
    expect(r).toMatchObject({ crf: 18, inRange: true });
    expect(r.tried).toHaveLength(1);
  });

  it("jumps by 6 CRF per doubling and then bisects", async () => {
    for (const at18 of [5e6, 6e6, 9e6, 20e6, 40e6, 80e6]) {
      const r = await searchCrf(model(at18), opts);
      expect(r.inRange, `at18=${at18}`).toBe(true);
      expect(r.bytes).toBeGreaterThanOrEqual(10e6);
      expect(r.bytes).toBeLessThanOrEqual(14e6);
      expect(r.tried.length).toBeLessThanOrEqual(6);
    }
  });

  it("as a ceiling (no floor): keeps the configured CRF when the file fits and raises it only when it does not", async () => {
    const ceiling = { start: 21, minCrf: 21, maxCrf: 34, minBytes: 0, maxBytes: 14e6, targetBytes: 13.3e6 };
    expect(await searchCrf(model(4e6), ceiling)).toMatchObject({ crf: 21, inRange: true });
    const big = await searchCrf(model(60e6), ceiling);
    expect(big.inRange).toBe(true);
    expect(big.crf).toBeGreaterThan(21);
    expect(big.bytes).toBeLessThanOrEqual(14e6);
    expect(big.tried.every((t) => t.crf >= 21)).toBe(true);
  });

  it("takes the CRF closest to the target when none fits", async () => {
    const small = await searchCrf(async () => 2e6, opts);
    expect(small.inRange).toBe(false);
    const simple = await searchCrf(model(3e6), opts); // even the best quality (CRF 12) gives only 6 MB
    expect(simple).toMatchObject({ inRange: false, crf: 12 });
    const coarse = await searchCrf(async (crf) => (crf < 20 ? 30e6 : 4e6), opts); // jumps over the range
    expect(coarse.inRange).toBe(false);
    expect(coarse.tried.length).toBeLessThanOrEqual(8);
  });

  it("never leaves the CRF range", async () => {
    const r = await searchCrf(async () => 1e9, opts);
    expect(r.tried.every((t) => t.crf >= 12 && t.crf <= 34)).toBe(true);
  });
});

describe("ffmpeg arguments", () => {
  it("encode H.264 High 4:2:0 BT.709 at the rendition's size with fast start, no audio and no metadata", () => {
    const v = SPEC.video.variants.at(-1)!;
    const a = ffmpegVideoArgs({ input: "in/%04d.png", fps: 24, frames: 300, crf: v.crf, out: "o.mp4", width: v.w, height: v.h });
    const joined = a.join(" ");
    for (const part of ["-profile:v high", "-pix_fmt yuv420p", "-movflags +faststart", "-an", "-map_metadata -1", "-fflags +bitexact", "out_color_matrix=bt709", `scale=${v.w}:${v.h}`]) expect(joined).toContain(part);
    expect(joined).not.toContain("minterpolate");
    expect(a[a.indexOf("-frames:v") + 1]).toBe("300");
    expect(a[a.indexOf("-framerate") + 1]).toBe("24");
    expect(a[a.indexOf("-crf") + 1]).toBe(String(v.crf));
  });

  it("has a full and a phone rendition, the phone one smaller and at a lower quality", () => {
    const [big, small] = [...SPEC.video.variants].sort((a, b) => b.w - a.w);
    expect(small.w).toBeLessThan(big.w);
    expect(small.w / small.h).toBeCloseTo(big.w / big.h, 3);
    expect(small.crf).toBeGreaterThanOrEqual(big.crf);
    expect(small.maxBytes).toBeLessThan(big.maxBytes);
  });
});

describe("command line", () => {
  it("reads the sections, the stand-in map and the video ceiling", () => {
    expect(parseArgs(["--only", "stills,posters", "--partial"])).toMatchObject({ only: ["stills", "posters"], partial: true });
    expect(parseArgs(["--stand-in-map", "x.json"])).toMatchObject({ standIns: true, standInMapFile: "x.json" });
    expect(parseArgs(["--video-mb", "12"]).videoBytes).toEqual([0, 12e6]);
    expect(parseArgs(["--video-mb", "8-12"]).videoBytes).toEqual([8e6, 12e6]);
    expect(parseArgs(["--no-app"]).appDir).toBeNull();
    expect(() => parseArgs(["--only", "nope"])).toThrow(/unknown section/);
    expect(() => parseArgs(["--built-at", "yesterday"])).toThrow(/YYYY-MM-DD/);
  });
});

// a minimal valid manifest of the first version (no C4 fields)
const BASE = {
  schema: "media/1",
  day: { date: "2026-06-21", times: ["08:00", "09:00"], stillTime: "09:00", hash: "abcdef0123", landscape: { pattern: "media/day/l/{time}.{hash}.jpg", width: 10, height: 10 } },
  orbit: { frames: 4, degPerFrame: 90, hash: "abcdef0123", landscape: { pattern: "media/orbit/l/{i}.{hash}.jpg", width: 10, height: 10 } },
  stills: [{ id: "a", file: "media/stills/a.abcdef0123.jpg", width: 10, height: 10, date: "2026-06-21", time: "10:00", category: "exterior", title: { cs: "a", en: "a" }, alt: { cs: "a", en: "a" } }],
  compare: { a: "a", b: "a" },
  og: { file: "media/og.abcdef0123.jpg", width: 1200, height: 630 },
};
const C4 = {
  ...BASE,
  builtAt: "2026-10-08",
  standIns: 3,
  day: { ...BASE.day, landscape: { ...BASE.day.landscape, format: "webp", small: { pattern: "media/day/s/{time}.{hash}.webp", width: 5, height: 5 } } },
  orbit: {
    ...BASE.orbit,
    startAzimuthDeg: 225,
    direction: "counterclockwise",
    captionHalfWindowDeg: 30,
    captions: [{ feature: "terrace", azimuthDeg: 241 }],
    portrait: { pattern: "media/orbit/p/{i}.{hash}.webp", width: 6, height: 9, stride: 2 },
    video: {
      file: "media/orbit/o-1600.abcdef0123.mp4", poster: "media/orbit/p-1600.abcdef0123.jpg", width: 1600, height: 900, fps: 24, durationS: 1,
      variants: [{ w: 1600, h: 900, file: "media/orbit/o-1600.abcdef0123.mp4" }, { w: 960, h: 540, file: "media/orbit/o-960.abcdef0123.mp4" }],
      posterVariants: [{ w: 640, h: 360, avif: "media/orbit/p-640.abcdef0123.avif", jpg: "media/orbit/p-640.abcdef0124.jpg" }],
    },
  },
  stills: [{ ...BASE.stills[0], gallery: false, variants: [{ w: 640, h: 360, avif: "media/stills/a-640.abcdef0123.avif", webp: "media/stills/a-640.abcdef0123.webp", jpg: "media/stills/a-640.abcdef0123.jpg" }] }],
  compare: { a: "a", b: "a", alt: { cs: "x", en: "x" }, before: { label: { cs: "l", en: "l" }, title: { cs: "t", en: "t" }, alt: { cs: "a", en: "a" } }, after: { title: { cs: "t", en: "t" } } },
  og: { ...BASE.og, alt: { cs: "og", en: "og" } },
  posters: { model: { desktop: { file: "media/posters/model-desktop.abcdef0123.webp", width: 1600, height: 900 }, phone: { file: "media/posters/model-phone.abcdef0123.webp", width: 1080, height: 1600 } } },
};

describe("manifest schema", () => {
  it("accepts the first version and the C4 fields, and rejects what the web cannot use", () => {
    expect(() => parseManifest(BASE)).not.toThrow();
    expect(() => parseManifest(C4)).not.toThrow();
    expect(() => parseManifest({ ...BASE, compare: { a: "a", b: "missing" } })).toThrow(/unknown still/);
    expect(() => parseManifest({ ...BASE, day: { ...BASE.day, stillTime: "10:00" } })).toThrow(/stillTime/);
    expect(() => parseManifest({ ...BASE, day: { ...BASE.day, landscape: { ...BASE.day.landscape, pattern: "media/day/l/x.jpg" } } })).toThrow(/\{time\}/);
    expect(() => parseManifest({ ...C4, day: { ...C4.day, landscape: { ...C4.day.landscape, small: { pattern: "media/day/s.webp", width: 5, height: 5 } } } })).toThrow(/\{time\}/);
    expect(() => parseManifest({ ...C4, day: { ...C4.day, landscape: { ...C4.day.landscape, stride: 2 } } })).toThrow(/stride/);
    expect(() => parseManifest({ ...C4, builtAt: "8. 10. 2026" })).toThrow();
  });

  it("is the schema the web reads the manifest with: both accept and reject the same manifests", async () => {
    let web: typeof import("../../src/lib/data/media");
    try {
      web = await import("../../src/lib/data/media");
    } catch {
      return; // public/media/manifest.json is missing or invalid at the moment: nothing to compare with
    }
    const samples: unknown[] = [BASE, C4, { ...C4, standIns: -1 }, { ...C4, orbit: { ...C4.orbit, direction: "left" } }, { ...C4, og: { ...C4.og, alt: { cs: "" } } }];
    for (const s of samples) expect(web.MediaSchema.safeParse(s).success).toBe(mediaManifestSchema.safeParse(s).success);
    const t = { i: 7, time: "08:05", hash: "abc1234567" };
    for (const pattern of ["media/day/l/{time}.{hash}.webp", "media/orbit/l/{i}.{hash}.webp"]) expect(expandPattern(pattern, t)).toBe(web.expandPattern(pattern, t));
    // the web lists the same files as the pipeline (each once)
    const m = parseManifest(C4);
    expect(new Set(web.allMediaPaths(web.parseMedia(C4)))).toEqual(new Set(manifestFiles(m).map((f) => f.path)));
  });

  it("lists every file once with the size it must have; a strided variant only every stride-th frame", () => {
    const files = manifestFiles(parseManifest(C4));
    expect(new Set(files.map((f) => f.path)).size).toBe(files.length);
    expect(files.filter((f) => f.role === "orbit.portrait").map((f) => f.path)).toEqual(strideIndices(C4.orbit.frames, 2).map((i) => expandPattern(C4.orbit.portrait.pattern, { i, hash: C4.orbit.hash })));
    expect(files.filter((f) => f.role === "day.landscape.small")).toHaveLength(C4.day.times.length);
    expect(files.find((f) => f.role === "orbit.video.960")).toMatchObject({ width: 960, height: 540 });
    expect(files.filter((f) => f.role.startsWith("poster.model"))).toHaveLength(2);
  });
});

// ------------------------------------------------------------------------------------------------ probes

/** An ISOBMFF box. */
const box = (type: string, ...payload: Buffer[]): Buffer => {
  const body = Buffer.concat(payload);
  const head = Buffer.alloc(8);
  head.writeUInt32BE(body.length + 8);
  head.write(type, 4, "latin1");
  return Buffer.concat([head, body]);
};
const full = (version: number, ...payload: Buffer[]): Buffer => Buffer.concat([Buffer.from([version, 0, 0, 0]), ...payload]);
const u16 = (v: number): Buffer => { const b = Buffer.alloc(2); b.writeUInt16BE(v); return b; };
const u32 = (v: number): Buffer => { const b = Buffer.alloc(4); b.writeUInt32BE(v); return b; };
/** A tiny AVIF-shaped file: ftyp, meta with the given item types and an ispe of w x h, mdat. */
function fakeAvif(items: string[], w: number, h: number, colr?: string): Buffer {
  const infes = items.map((t, k) => box("infe", full(2, u16(k + 1), u16(0), Buffer.from(t, "latin1"), Buffer.from([0]))));
  const props = [box("ispe", full(0, u32(w), u32(h))), ...(colr ? [box("colr", Buffer.from(colr, "latin1"), Buffer.alloc(4))] : [])];
  return Buffer.concat([
    box("ftyp", Buffer.from("avif", "latin1"), u32(0), Buffer.from("mif1avif", "latin1")),
    box("meta", full(0, box("hdlr", full(0, u32(0), Buffer.from("pict", "latin1"), Buffer.alloc(12))), box("iinf", full(0, u16(items.length), ...infes)), box("iprp", box("ipco", ...props)))),
    box("mdat", Buffer.alloc(16)),
  ]);
}
/** A lossy WebP header with a 1x1 frame and extra chunks. */
function fakeWebp(w: number, h: number, extra: string[] = []): Buffer {
  const vp8 = Buffer.alloc(10);
  vp8.writeUIntLE(0, 0, 3);
  vp8[3] = 0x9d; vp8[4] = 0x01; vp8[5] = 0x2a;
  vp8.writeUInt16LE(w, 6);
  vp8.writeUInt16LE(h, 8);
  const chunk = (id: string, data: Buffer): Buffer => {
    const head = Buffer.alloc(8);
    head.write(id, 0, "latin1");
    head.writeUInt32LE(data.length, 4);
    return Buffer.concat([head, data, data.length & 1 ? Buffer.alloc(1) : Buffer.alloc(0)]);
  };
  const body = Buffer.concat([Buffer.from("WEBP", "latin1"), chunk("VP8 ", vp8), ...extra.map((id) => chunk(id, Buffer.from("private")))]);
  const riff = Buffer.alloc(8);
  riff.write("RIFF", 0, "latin1");
  riff.writeUInt32LE(body.length, 4);
  return Buffer.concat([riff, body]);
}

describe("probes", () => {
  it("reads PNG, WebP and AVIF sizes", () => {
    const png = Buffer.alloc(33);
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(png);
    png.writeUInt32BE(13, 8);
    png.write("IHDR", 12, "latin1");
    png.writeUInt32BE(1920, 16);
    png.writeUInt32BE(1080, 20);
    expect(imageSize(png)).toEqual({ width: 1920, height: 1080 });
    expect(imageSize(fakeWebp(640, 360))).toEqual({ width: 640, height: 360 });
    expect(imageSize(fakeAvif(["av01"], 1280, 720))).toEqual({ width: 1280, height: 720 });
    expect(imageSize(Buffer.from("not an image"))).toBeNull();
  });

  it("finds metadata in WebP (EXIF, XMP, ICC chunks) and AVIF (Exif and XMP items, an ICC profile), and nothing in clean files", () => {
    expect(probeWebp(fakeWebp(4, 4)).metadata).toEqual([]);
    expect(probeWebp(fakeWebp(4, 4, ["EXIF", "XMP ", "ICCP"])).metadata).toEqual(["EXIF", "XMP", "ICCP"]);
    expect(probeAvif(fakeAvif(["av01"], 4, 4, "nclx")).metadata).toEqual([]);
    expect(probeAvif(fakeAvif(["av01", "Exif", "mime"], 4, 4, "prof")).metadata).toEqual(["Exif", "XMP (mime item)", "ICC profile"]);
  });

  it("sees a truncated WebP and refuses bytes of another kind", () => {
    const w = fakeWebp(4, 4);
    expect(probeWebp(w).complete).toBe(true);
    expect(probeWebp(Buffer.concat([w, Buffer.alloc(4)])).complete).toBe(false);
    expect(() => probeJpeg(Buffer.from("GIF89a....."))).toThrow(/not a JPEG/);
    expect(() => probeWebp(Buffer.from("RIFF0000AVI LIST"))).toThrow(/not a WebP/);
    expect(() => probeAvif(Buffer.from("0000ftypisom0000"))).toThrow(/not an AVIF/);
    expect(() => probeMp4(Buffer.from("0000000000000000"))).toThrow();
  });

  it("flags every kind of video defect", () => {
    const info = {
      brands: ["isom"],
      fastStart: false,
      tracks: [{ handler: "vide", timescale: 1, durationS: 1, samples: 1 }, { handler: "soun", timescale: 1, durationS: 1, samples: 1 }],
      video: { width: 10, height: 10, codec: "hvc1", profile: 77, level: 30, chromaFormat: 3, bitDepth: 10, encoderName: "x", fps: 30, frames: 5, durationS: 1 },
      metadataBoxes: ["udta/meta/keys"],
      creationTime: 5,
    };
    const problems = videoProblems(info, { width: 1600, height: 900, fps: 24, frames: 300 }).join("\n");
    for (const word of ["avc1", "profile", "4:2:0", "size", "fps", "frames", "fast start", "audio", "metadata boxes", "encoder", "creation"]) expect(problems).toContain(word);
  });
});

// ------------------------------------------------------------------------------------------------ stand-ins (files only)

describe("stand-ins", () => {
  const dir = path.join(scratch, "standins");
  const touch = (base: string): void => {
    fs.mkdirSync(path.dirname(path.join(dir, base)), { recursive: true });
    fs.writeFileSync(path.join(dir, `${base}.jpg`), "x");
  };
  const plan: MediaPlan = { ...realPlan, orbit: { ...realPlan.orbit, frameCount: 8, scrollStep: 2, scrollCount: 4 } };

  beforeAll(() => {
    for (const t of ["0800", "1200", "2100"]) touch(`day/${t}`);
    for (let i = 0; i < 10; i++) touch(`orbit/landscape/${String(i).padStart(4, "0")}`); // a loop of 10 frames, not 8
    for (const n of ["b-old", "a-old", "c-old"]) touch(`stills/${n}`);
    touch("compare/one");
  });

  it("takes the nearest time, the landscape frame for a portrait, the nearest loop position and the map", () => {
    const s = new StandIns(dir, plan, { "compare/x-after": "compare/one" });
    expect(s.resolve("day/1200")).toBe(path.join(dir, "day/1200.jpg")); // exists: no stand-in
    expect(s.resolve("day/1310")).toBe(path.join(dir, "day/1200.jpg"));
    expect(s.resolve("day/portrait/2040")).toBe(path.join(dir, "day/2100.jpg"));
    // frame 4 of 8 is half way round: frame 5 of the 10-frame loop (the file "0004" shows another angle)
    expect(s.resolve("orbit/landscape/0004")).toBe(path.join(dir, "orbit/landscape/0005.jpg"));
    expect(s.resolve("orbit/portrait/0004")).toBe(path.join(dir, "orbit/landscape/0005.jpg"));
    expect(s.resolve("compare/x-after")).toBe(path.join(dir, "compare/one.jpg"));
    expect(s.replaced).toHaveLength(5);
  });

  it("gives every still a different render of its folder, in name order, and never one that is mapped elsewhere", () => {
    const s = new StandIns(dir, plan, { "stills/z": "stills/a-old" });
    expect(s.resolve("stills/new-1")).toBe(path.join(dir, "stills/b-old.jpg"));
    expect(s.resolve("stills/new-2")).toBe(path.join(dir, "stills/c-old.jpg"));
    expect(s.resolve("stills/new-3")).toBeNull();
    expect(s.resolve("og/og")).toBeNull();
  });
});

// ------------------------------------------------------------------------------------------------ with ImageMagick

const text = (cs: string, en: string) => ({ cs, en });
const SMALL: MediaPlan = {
  day: { date: "2026-06-21", times: ["08:00", "12:30", "20:10"], stillTime: "12:30", size: [1920, 1080], src: ["day/0800", "day/1230", "day/2010"], portraitSrc: ["day/portrait/0800", "day/portrait/1230", "day/portrait/2010"] },
  orbit: {
    fps: 24,
    frameCount: 12,
    scrollStep: 3,
    scrollCount: 4,
    degPerFrame: 90,
    startAzimuthDeg: 200,
    direction: "counterclockwise",
    captionHalfWindowDeg: 30,
    videoSrc: Array.from({ length: 12 }, (_, i) => `orbit/landscape/${String(i).padStart(4, "0")}`),
    scrollSrc: [0, 3, 6, 9].map((i) => `orbit/landscape/${String(i).padStart(4, "0")}`),
    portraitSrc: [0, 6].map((i) => `orbit/portrait/${String(i).padStart(4, "0")}`),
    portraitStride: 2,
  },
  stills: [
    { id: "one", src: "stills/one", date: "2026-06-21", time: "10:00", category: "exterior", title: text("Jedna", "One"), alt: text("První snímek", "The first still"), gallery: true },
    { id: "two", src: "stills/two", date: "2026-06-21", time: "15:30", category: "interior", title: text("Dva", "Two"), alt: text("Druhý snímek", "The second still"), gallery: true },
    { id: "pair-before", src: "compare/pair-before", date: "2026-06-21", time: "16:00", category: "exterior", title: text("Před", "Before"), alt: text("Odpoledne", "Afternoon"), gallery: false },
    { id: "pair-after", src: "compare/pair-after", date: "2026-06-21", time: "21:00", category: "exterior", title: text("Po", "After"), alt: text("Večer", "Evening"), gallery: true },
  ],
  compare: { a: "pair-before", b: "pair-after", alt: text("Dvojice", "The pair"), before: { label: text("Den", "Day"), title: text("Před", "Before"), alt: text("Odpoledne", "Afternoon") }, after: { label: text("Noc", "Night"), title: text("Po", "After"), alt: text("Večer", "Evening") } },
  og: { src: "og/og", alt: text("Dům a zahrada", "The house and the garden") },
  posters: ["model", "sun"].flatMap((page) => ["desktop", "phone"].map((device) => ({ page: page as "model", device: device as "desktop", src: `posters/${page}-${device}` }))),
};

describe.skipIf(!magick)("build-media on synthetic renders (small plan)", () => {
  const renders = path.join(scratch, "renders");
  const out = path.join(scratch, "media");
  const app = path.join(scratch, "app");
  const tools = { magick: magick!, ffmpeg };
  const options = (extra: Partial<BuildOptions> = {}): BuildOptions => ({
    root,
    plan: SMALL,
    inDir: renders,
    outDir: out,
    appDir: app,
    tools,
    video: false,
    check: false,
    cacheFile: path.join(scratch, "cache.json"),
    modelDir: path.join(scratch, "no-model"),
    builtAt: "2026-10-08",
    log: () => undefined,
    ...extra,
  });
  const check = (extra = {}) => checkMedia({ root, dir: out, modelCheck: false, appDir: app, ...extra });
  const listing = (dir: string): string => {
    const rows: string[] = [];
    const walk = (d: string): void => {
      for (const e of fs.readdirSync(d, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
        const f = path.join(d, e.name);
        if (e.isDirectory()) walk(f);
        else rows.push(`${path.relative(dir, f)} ${fs.statSync(f).size} ${fs.statSync(f).mtimeMs}`);
      }
    };
    walk(dir);
    return rows.join("\n");
  };
  let manifest: MediaManifest;

  beforeAll(async () => {
    await makeSyntheticRenders({ plan: SMALL, dir: renders, magick: magick!, scale: 0.25, posters: true });
  }, 120_000);

  it("builds every section in the formats and sizes of the specification, without metadata", async () => {
    const r = await buildMedia(options());
    expect(r.errors).toEqual([]);
    expect(r.ok).toBe(true);
    manifest = parseManifest(JSON.parse(fs.readFileSync(path.join(out, "manifest.json"), "utf8")));
    expect(manifest.day.times).toEqual(SMALL.day.times);
    expect(manifest.orbit).toMatchObject({ frames: SMALL.orbit.scrollCount, degPerFrame: SMALL.orbit.degPerFrame, startAzimuthDeg: 200, direction: "counterclockwise" });
    expect(manifest.orbit.portrait?.stride).toBe(SMALL.orbit.portraitStride);
    expect(manifest.stills.map((s) => [s.id, s.gallery])).toEqual(SMALL.stills.map((s) => [s.id, s.gallery]));
    expect(manifest.compare).toEqual(SMALL.compare);
    expect(manifest.og.alt).toEqual(SMALL.og.alt);
    expect(manifest.orbit.video).toBeUndefined();
    expect(manifest.builtAt).toBe("2026-10-08");
    expect(manifest.standIns).toBeUndefined();

    const files = manifestFiles(manifest);
    expect(files.filter((f) => f.role === "day.portrait")).toHaveLength(SMALL.day.times.length);
    expect(files.filter((f) => f.role === "orbit.portrait")).toHaveLength(SMALL.orbit.portraitSrc!.length);
    for (const f of files) {
      const buf = fs.readFileSync(path.join(out, relInMedia(f.path)));
      expect(formatOf(buf), f.path).toBe(extOf(f.path));
      expect(imageSize(buf), f.path).toEqual({ width: f.width, height: f.height });
      if (extOf(f.path) === "jpg") {
        const j = probeJpeg(buf);
        expect(j.metadata, f.path).toEqual([]);
        expect(j.progressive).toBe(true);
      } else if (extOf(f.path) === "webp") expect(probeWebp(buf).metadata, f.path).toEqual([]);
      else expect(probeAvif(buf).metadata, f.path).toEqual([]);
    }
    // sequences are WebP with a 960 copy, stills come in AVIF, WebP and JPEG at every width up to the main one
    expect(manifest.day.landscape.pattern).toMatch(/\.webp$/);
    expect(manifest.day.landscape.small).toMatchObject({ width: SPEC.day.small.w, height: SPEC.day.small.h });
    for (const s of manifest.stills) {
      expect(s.variants!.map((v) => v.w)).toEqual(SPEC.stills.widths.filter((w) => w <= SPEC.stills.main.w));
      for (const v of s.variants!) expect([v.avif, v.webp, v.jpg].every(Boolean)).toBe(true);
      expect(s.file).toBe(s.variants!.find((v) => v.w === SPEC.stills.main.w)!.jpg);
    }
    // the same with ImageMagick's own eyes
    const first = files.find((f) => extOf(f.path) === "webp")!;
    const verbose = execFileSync(magick!, ["identify", "-verbose", path.join(out, relInMedia(first.path))], { encoding: "utf8" });
    expect(verbose).not.toMatch(/exif:|icc:|xmp|iptc|comment:|profile-/i);
  }, 180_000);

  it("names every file with its content hash and passes check-media", () => {
    for (const f of manifestFiles(manifest)) expect(f.path).toMatch(/^media\/.+\.[0-9a-f]{10}\.(jpg|webp|avif|mp4)$/);
    const c = check();
    expect(c.errors).toEqual([]);
    expect(c.files).toBe(manifestFiles(manifest).length);
  });

  it("composites the house name on the share images and copies them, with the alt text, into the app folder", () => {
    const og = fs.readFileSync(path.join(out, relInMedia(manifest.og.file)));
    expect(fs.readFileSync(path.join(app, APP_FILES.og)).equals(og)).toBe(true);
    expect(fs.readFileSync(path.join(app, APP_FILES.twitter)).equals(fs.readFileSync(path.join(out, relInMedia(manifest.og.twitter!.file))))).toBe(true);
    expect(fs.readFileSync(path.join(app, APP_FILES.ogAlt), "utf8")).toBe(appAltText(manifest));
    expect(appAltText(manifest)).toContain(SMALL.og.alt.cs.split(" ")[0]);
    // the type sits top left: that corner differs from a plain conversion of the render, the opposite corner does not
    const plain = path.join(scratch, "plain-og.png");
    execFileSync(magick!, [path.join(renders, "og/og.png"), "-resize", `${SPEC.og.w}x${SPEC.og.h}^`, "-gravity", "center", "-extent", `${SPEC.og.w}x${SPEC.og.h}`, plain]);
    const diff = (crop: string): number =>
      Number(execFileSync(magick!, ["(", path.join(app, APP_FILES.og), "-crop", crop, "+repage", ")", "(", plain, "-crop", crop, "+repage", ")", "-metric", "RMSE", "-compare", "-format", "%[distortion]", "info:"], { encoding: "utf8" }));
    expect(diff("400x200+40+40")).toBeGreaterThan(0.05);
    expect(diff("300x150+880+460")).toBeLessThan(0.03);
    // check-media sees an app copy that is not the manifest's file and an alt text that drifted
    fs.writeFileSync(path.join(app, APP_FILES.ogAlt), "something else\n");
    expect(check().errors.join("\n")).toMatch(/alt text/);
    fs.writeFileSync(path.join(app, APP_FILES.ogAlt), appAltText(manifest)!);
    const twitter = fs.readFileSync(path.join(app, APP_FILES.twitter));
    fs.writeFileSync(path.join(app, APP_FILES.twitter), og);
    expect(check().errors.join("\n")).toMatch(/twitter-image\.jpg/);
    fs.writeFileSync(path.join(app, APP_FILES.twitter), twitter);
    expect(check().errors).toEqual([]);
  });

  it("lays the share text out relative to the frame, so the Twitter crop keeps it", () => {
    const fonts = ogFonts(root);
    const og = ogCompositeArgs("in.png", "out.jpg", SPEC.og, { lines: ["Dům", "pod ořechem"], label: "Studie · 100 %" }, { mint: "#5fd6ae", ...fonts });
    const tw = ogCompositeArgs("in.png", "out.jpg", SPEC.twitter, { lines: ["Dům", ""], label: "x" }, { mint: "#5fd6ae", ...fonts });
    expect(og).toContain(`${SPEC.og.w}x${SPEC.og.h}^`);
    expect(og).toContain("STUDIE · 100 %%"); // capitals, and % escaped for ImageMagick
    expect(og.filter((a) => a === "-annotate")).toHaveLength(3);
    expect(tw.filter((a) => a === "-annotate")).toHaveLength(2); // no empty second line
    expect(og).toContain("-strip");
    expect(fs.existsSync(fonts.sansFont) && fs.existsSync(fonts.monoFont)).toBe(true);
  });

  it("makes the portrait frames from their own renders (no crop of the landscape frame)", () => {
    const f = manifestFiles(manifest).find((x) => x.role === "day.portrait" && x.path.includes("/1230."))!;
    const expected = path.join(scratch, "expected-portrait.png");
    execFileSync(magick!, [path.join(renders, "day/portrait/1230.png"), "-resize", `${SPEC.day.portrait.w}x${SPEC.day.portrait.h}!`, expected]);
    const rmse = Number(execFileSync(magick!, [path.join(out, relInMedia(f.path)), expected, "-metric", "RMSE", "-compare", "-format", "%[distortion]", "info:"], { encoding: "utf8" }));
    expect(rmse).toBeLessThan(0.03); // only the WebP loss and a different resampling filter
  });

  it("builds the posters of the 3D pages from their captures, fitted, not cropped", () => {
    for (const page of ["model", "sun"] as const) {
      for (const device of ["desktop", "phone"] as const) {
        const p = manifest.posters![page]![device];
        const src = imageSize(fs.readFileSync(path.join(renders, `posters/${page}-${device}.png`)))!;
        expect(p.width).toBeLessThanOrEqual(SPEC.posters.maxWidth[device]);
        expect(p.width / p.height).toBeCloseTo(src.width / src.height, 1);
        expect(p.file).toMatch(/\.webp$/);
      }
    }
  });

  it("is idempotent: a second run changes neither the manifest nor a single file", async () => {
    const before = listing(out) + listing(app);
    const r = await buildMedia(options({ builtAt: undefined }));
    expect(r.ok).toBe(true);
    expect(listing(out) + listing(app)).toBe(before);
  }, 180_000);

  it("gives new names to a sequence whose frame changed and removes the old files, other sections stay", async () => {
    const before = parseManifest(JSON.parse(fs.readFileSync(path.join(out, "manifest.json"), "utf8")));
    execFileSync(magick!, ["-size", "480x270", "xc:crimson", path.join(renders, "day/1230.png")]);
    const r = await buildMedia(options());
    expect(r.ok).toBe(true);
    const after = parseManifest(JSON.parse(fs.readFileSync(path.join(out, "manifest.json"), "utf8")));
    expect(after.day.hash).not.toBe(before.day.hash);
    expect(after.orbit.hash).toBe(before.orbit.hash);
    expect(after.stills).toEqual(before.stills);
    for (const f of manifestFiles(before).filter((x) => x.role.startsWith("day."))) expect(fs.existsSync(path.join(out, relInMedia(f.path)))).toBe(false);
    expect(check().errors).toEqual([]);
    manifest = after;
  }, 180_000);

  it("reports missing renders and changes nothing; --partial builds what is complete; --stand-ins fills the gap and says so", async () => {
    const before = listing(out);
    const jpg = path.join(renders, "orbit/landscape/0006.jpg");
    fs.renameSync(jpg, `${jpg}.hidden`);
    execFileSync(magick!, ["-size", "480x270", "xc:navy", path.join(renders, "stills/two.png")]);
    try {
      const strict = await buildMedia(options());
      expect(strict.ok).toBe(false);
      expect(strict.missing).toContain("orbit: orbit/landscape/0006");
      expect(listing(out)).toBe(before);
      const partial = await buildMedia(options({ partial: true }));
      expect(partial.ok).toBe(false); // incomplete, but written
      expect(partial.built).toContain("stills");
      expect(partial.built).not.toContain("orbit");
      const m = parseManifest(JSON.parse(fs.readFileSync(path.join(out, "manifest.json"), "utf8")));
      expect(m.orbit.hash).toBe(manifest.orbit.hash);
      expect(m.stills[1].file).not.toBe(manifest.stills[1].file);
      expect(check().errors).toEqual([]);

      const proof = await buildMedia(options({ standIns: true }));
      expect(proof.errors).toEqual([]);
      expect(proof.ok).toBe(true);
      expect(proof.standIns).toEqual(["orbit/landscape/0006 <- orbit/landscape/0005"]);
      const p = parseManifest(JSON.parse(fs.readFileSync(path.join(out, "manifest.json"), "utf8")));
      expect(p.standIns).toBe(1);
      const c = check();
      expect(c.errors).toEqual([]);
      expect(c.warnings.join(" ")).toMatch(/proof build/);
      expect(check({ final: true }).errors.join(" ")).toMatch(/proof build/);
    } finally {
      fs.renameSync(`${jpg}.hidden`, jpg);
    }
    const real = await buildMedia(options());
    expect(real.ok).toBe(true);
    expect(parseManifest(JSON.parse(fs.readFileSync(path.join(out, "manifest.json"), "utf8"))).standIns).toBeUndefined();
  }, 240_000);

  it("never replaces good media with an unreadable render", async () => {
    const before = listing(out);
    const f = path.join(renders, "stills/one.png");
    const saved = fs.readFileSync(f);
    fs.writeFileSync(f, Buffer.alloc(0));
    try {
      const r = await buildMedia(options());
      expect(r.ok).toBe(false);
      expect(r.errors.join(" ")).toMatch(/not a readable/);
      expect(listing(out)).toBe(before);
      expect(fs.readdirSync(out).filter((n) => n.startsWith(".build-"))).toEqual([]);
    } finally {
      fs.writeFileSync(f, saved);
    }
  }, 120_000);

  it("check-media finds a flipped byte, a missing file, a stray file and pictures with metadata", () => {
    const m = parseManifest(JSON.parse(fs.readFileSync(path.join(out, "manifest.json"), "utf8")));
    const files = manifestFiles(m);
    const victim = path.join(out, relInMedia(files.find((f) => f.role === "still.one")!.path));
    const original = fs.readFileSync(victim);
    const bytes = Buffer.from(original);
    bytes[bytes.length >> 1] ^= 0x55;
    fs.writeFileSync(victim, bytes);
    expect(check().errors.join("\n")).toMatch(/hash in the name/);
    fs.writeFileSync(victim, original);

    const frame = path.join(out, relInMedia(files.find((f) => f.role === "orbit.portrait")!.path));
    const frameBytes = fs.readFileSync(frame);
    fs.rmSync(frame);
    expect(check().errors.join("\n")).toMatch(/does not exist/);
    fs.writeFileSync(frame, frameBytes);

    fs.writeFileSync(path.join(out, "stray.0123456789.webp"), "x");
    expect(check().errors.join("\n")).toMatch(/not in the manifest/);
    expect(check({ allowExtra: true }).errors).toEqual([]);
    fs.rmSync(path.join(out, "stray.0123456789.webp"));

    // a WebP still with an EXIF chunk appended
    const webp = path.join(out, relInMedia(files.find((f) => f.role.startsWith("still.two.") && f.path.endsWith(".webp"))!.path));
    const clean = fs.readFileSync(webp);
    const exif = Buffer.concat([clean, Buffer.from("EXIF", "latin1"), Buffer.from([4, 0, 0, 0]), Buffer.from("priv")]);
    exif.writeUInt32LE(exif.length - 8, 4);
    expect(probeWebp(exif).metadata).toEqual(["EXIF"]);
    fs.writeFileSync(webp, exif);
    expect(check().errors.join("\n")).toMatch(/carries metadata: EXIF/);
    fs.writeFileSync(webp, clean);
    expect(check().errors).toEqual([]);
  });
});

describe.skipIf(!magick)("build-media on synthetic renders (the real plan)", () => {
  const dir = path.join(scratch, "real");
  const renders = path.join(dir, "renders");
  const out = path.join(dir, "media");
  let manifest: MediaManifest;

  it("builds the real shot list and agrees with model/render.json and model/*.json", async () => {
    await makeSyntheticRenders({ plan: realPlan, dir: renders, magick: magick!, scale: 0.1, jobs: 8 });
    const r = await buildMedia({
      root,
      inDir: renders,
      outDir: out,
      tools: { magick: magick!, ffmpeg },
      video: false,
      renderInputs: path.join(dir, "none.json"),
      cacheFile: null,
      log: () => undefined,
    });
    expect(r.errors).toEqual([]);
    expect(r.ok).toBe(true);
    manifest = parseManifest(JSON.parse(fs.readFileSync(path.join(out, "manifest.json"), "utf8")));
    const files = manifestFiles(manifest);
    const n = realPlan.day.times.length;
    expect(files.filter((f) => f.role.startsWith("day."))).toHaveLength(n * 3); // landscape, its 960 copy, portrait
    expect(files.filter((f) => f.role === "orbit.landscape")).toHaveLength(realPlan.orbit.scrollCount);
    expect(files.filter((f) => f.role === "orbit.portrait")).toHaveLength(realPlan.orbit.portraitSrc!.length);
    expect(manifest.stills.map((s) => s.id)).toEqual(realPlan.stills.map((s) => s.id));
    expect(manifest.inputHash).toMatch(/^[0-9a-f]{64}$/);
    expect(manifest.compare).toMatchObject({ a: realPlan.compare.a, b: realPlan.compare.b });
    const c = checkMedia({ root, dir: out });
    expect(c.errors).toEqual([]);
  }, 400_000);

  it("is stale when the model changed, and differs when a text changed: the check names both", () => {
    const m = JSON.parse(fs.readFileSync(path.join(out, "manifest.json"), "utf8"));
    const file = path.join(out, "manifest.json");
    fs.writeFileSync(file, `${JSON.stringify({ ...m, inputHash: "0".repeat(64) }, null, 2)}\n`);
    expect(checkMedia({ root, dir: out }).errors.join("\n")).toMatch(/stale/);
    expect(checkMedia({ root, dir: out, modelCheck: false }).errors).toEqual([]);
    fs.writeFileSync(file, `${JSON.stringify({ ...m, og: { ...m.og, alt: { cs: "jiný", en: "other" } } }, null, 2)}\n`);
    expect(checkMedia({ root, dir: out }).errors.join("\n")).toMatch(/og\.alt/);
    fs.writeFileSync(file, `${JSON.stringify(m, null, 2)}\n`);
  });

  it("is read by the web: every path exists, one URL per frame in every variant", async () => {
    let web: typeof import("../../src/lib/data/media");
    try {
      web = await import("../../src/lib/data/media");
    } catch {
      return;
    }
    const parsed = web.parseMedia(manifest);
    for (const p of web.allMediaPaths(parsed)) expect(fs.existsSync(path.join(out, relInMedia(p))), p).toBe(true);
    const day = web.dayFrames(parsed);
    expect(day.landscape.urls).toHaveLength(realPlan.day.times.length);
    expect(day.landscape.small?.urls).toHaveLength(realPlan.day.times.length);
    const orbit = web.orbitFrames(parsed);
    expect(orbit.portrait?.urls).toHaveLength(realPlan.orbit.scrollCount);
    expect(new Set(orbit.portrait?.urls).size).toBe(realPlan.orbit.portraitSrc!.length);
  });
});

// ------------------------------------------------------------------------------------------------ with ffmpeg

describe.skipIf(!magick || !ffmpeg)("the orbit video", () => {
  const dir = path.join(scratch, "video");
  const renders = path.join(dir, "renders");
  const out = path.join(dir, "media");
  const opts = (extra: Partial<BuildOptions> = {}): BuildOptions => ({
    root,
    plan: SMALL,
    inDir: renders,
    outDir: out,
    appDir: null,
    tools: { magick: magick!, ffmpeg },
    only: ["orbit", "video"],
    check: false,
    cacheFile: path.join(dir, "cache.json"),
    modelDir: path.join(dir, "no-model"),
    log: () => undefined,
    ...extra,
  });

  it("has every rendition: H.264 High 4:2:0, 24 fps, fast start, no audio, no metadata, one frame per render; the loop closes", async () => {
    await makeSyntheticRenders({ plan: SMALL, dir: renders, magick: magick!, scale: 0.25 });
    // a complete manifest is needed before the video can be added: build the other sections first
    const first = await buildMedia(opts({ only: undefined, video: false }));
    expect(first.errors).toEqual([]);
    const r = await buildMedia(opts());
    expect(r.errors).toEqual([]);
    expect(r.ok).toBe(true);
    const m = parseManifest(JSON.parse(fs.readFileSync(path.join(out, "manifest.json"), "utf8")));
    const v = m.orbit.video!;
    const widest = [...SPEC.video.variants].sort((a, b) => b.w - a.w)[0];
    expect(v).toMatchObject({ width: widest.w, height: widest.h, fps: SMALL.orbit.fps, durationS: SMALL.orbit.frameCount / SMALL.orbit.fps });
    expect(v.variants!.map((x) => x.w)).toEqual([...SPEC.video.variants].map((x) => x.w).sort((a, b) => b - a));
    expect(v.file).toBe(v.variants![0].file);
    for (const rendition of v.variants!) {
      const buf = fs.readFileSync(path.join(out, relInMedia(rendition.file)));
      const info = probeMp4(buf);
      expect(videoProblems(info, { width: rendition.w, height: rendition.h, fps: 24, frames: SMALL.orbit.frameCount })).toEqual([]);
      expect(info.video).toMatchObject({ codec: "avc1", profile: 100, chromaFormat: 1, bitDepth: 8, frames: SMALL.orbit.frameCount, encoderName: "" });
      expect(info.tracks).toHaveLength(1);
      expect(blankEncoderName(Buffer.from(buf))).toBe(0); // the encoder name is already blank
      const decoded = spawnSync(ffmpeg!, ["-hide_banner", "-nostdin", "-i", path.join(out, relInMedia(rendition.file)), "-map", "0:v:0", "-f", "null", "-"], { encoding: "utf8" });
      expect(decoded.status).toBe(0);
      expect(decoded.stderr).toMatch(new RegExp(`frame=\\s*${SMALL.orbit.frameCount}\\b`));
    }
    // the poster: the first frame, a responsive picture whose widest JPEG is `poster`
    expect(probeJpeg(fs.readFileSync(path.join(out, relInMedia(v.poster)))).width).toBe(widest.w);
    expect(v.posterVariants!.at(-1)!.jpg).toBe(v.poster);
    expect(r.video?.loopRatio ?? 1).toBeLessThan(2.5);
    expect(r.warnings.filter((w) => w.includes("loop"))).toEqual([]);
    expect(checkMedia({ root, dir: out, modelCheck: false, appDir: null }).errors).toEqual([]);
  }, 240_000);

  it("reuses the renditions while the frames do not change and warns when the loop is not closed", async () => {
    const again = await buildMedia(opts());
    expect(again.video?.variants.every((x) => x.reused)).toBe(true);
    // the last frame of a real orbit is one step before the first; a different picture breaks the loop
    execFileSync(magick!, [path.join(renders, "orbit/landscape/0011.jpg"), "-negate", path.join(renders, "orbit/landscape/0011.jpg")]);
    const broken = await buildMedia(opts());
    expect(broken.video?.variants.some((x) => x.reused)).toBe(false);
    expect(broken.warnings.join(" ")).toMatch(/loop is not closed/);
  }, 240_000);
});
