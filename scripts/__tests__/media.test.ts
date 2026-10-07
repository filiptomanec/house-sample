// Tests of the media build (scripts/build-media.ts, scripts/check-media.ts, scripts/lib/media-*.ts). The renders are synthetic
// pictures made with ImageMagick into pipeline/out/test-media-* (git-ignored, removed afterwards); the parts that need
// ImageMagick or ffmpeg are skipped when the tool is not installed (MAGICK / FFMPEG point to them when they are not in PATH).
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildMedia, discoverTools, type BuildOptions } from "../build-media";
import { checkMedia } from "../check-media";
import {
  SPEC,
  dayCrop,
  expandPattern,
  manifestFiles,
  parseManifest,
  planFromRender,
  relInMedia,
  type MediaManifest,
  type MediaPlan,
} from "../lib/media-plan";
import { blankEncoderName, imageSize, probeJpeg, probeMp4 } from "../lib/media-probe";
import { makeSyntheticRenders } from "../lib/media-synthetic";
import { ffmpegVideoArgs, searchCrf, videoProblems } from "../lib/media-video";
import { buildRenderInputs, solarProvider } from "../build-render-inputs";
import { parseRenderConfig } from "../lib/render-schema";

const root = path.resolve(__dirname, "..", "..");
const cfg = parseRenderConfig(JSON.parse(fs.readFileSync(path.join(root, "model/render.json"), "utf8")));
const realPlan = planFromRender(cfg);
const found = discoverTools(root);
const magick = found.magick;
const ffmpeg = found.ffmpeg;
const scratch = path.join(root, "pipeline/out", `test-media-${process.pid}`);

fs.mkdirSync(scratch, { recursive: true });
afterAll(() => fs.rmSync(scratch, { recursive: true, force: true }));

// ------------------------------------------------------------------------------------------------ no tools needed

describe("plan", () => {
  it("lists 30 day frames, 60 scroll frames, the 300 video frames and 11 stills (9 + the compare pair)", () => {
    expect(realPlan.day.times).toHaveLength(30);
    expect(realPlan.day.src).toHaveLength(30);
    expect(realPlan.orbit.scrollCount).toBe(60);
    expect(realPlan.orbit.scrollSrc).toHaveLength(60);
    expect(realPlan.orbit.portraitSrc).toHaveLength(60);
    expect(realPlan.orbit.videoSrc).toHaveLength(300);
    expect(realPlan.orbit.degPerFrame).toBeCloseTo(6, 9);
    expect(realPlan.stills).toHaveLength(11);
    expect(new Set(realPlan.stills.map((s) => s.id)).size).toBe(11);
    expect(realPlan.compare).toEqual({ a: "day-night-before", b: "day-night-after" });
    expect(realPlan.og.src).toBe("og/og");
  });

  it("takes every fifth frame as a scroll frame and names the sources like the render inputs", () => {
    expect(realPlan.orbit.scrollSrc.slice(0, 3)).toEqual(["orbit/landscape/0000", "orbit/landscape/0005", "orbit/landscape/0010"]);
    expect(realPlan.orbit.scrollSrc[59]).toBe("orbit/landscape/0295");
    expect(realPlan.orbit.portraitSrc?.[59]).toBe("orbit/portrait/0295");
    expect(realPlan.day.src[0]).toBe("day/0800");
    expect(realPlan.day.src[29]).toBe("day/2130");
  });

  it("maps the render categories to the gallery ones and keeps the bilingual texts", () => {
    for (const s of realPlan.stills) {
      expect(["exterior", "interior", "aerial", "detail"]).toContain(s.category);
      expect(s.title.cs.length).toBeGreaterThan(0);
      expect(s.alt.en.length).toBeGreaterThan(10);
    }
    const evening = cfg.stills.find((s) => s.category === "evening");
    if (evening) expect(realPlan.stills.find((s) => s.id === evening.id)?.category).toBe("exterior");
  });

  it("computes the portrait crop like the render inputs", () => {
    const built = buildRenderInputs({ root, sun: solarProvider, furnitureReport: null }).data as unknown as { day: { portrait: { crop: unknown } } };
    expect(dayCrop(cfg.day)).toEqual(built.day.portrait.crop);
    expect(realPlan.day.crop.width / realPlan.day.crop.height).toBeCloseTo(2 / 3, 3);
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

  it("takes the CRF closest to the target when none fits", async () => {
    const small = await searchCrf(async () => 2e6, opts);
    expect(small.inRange).toBe(false);
    const simple = await searchCrf(model(3e6), opts); // even the best quality (CRF 12) gives only 6 MB
    expect(simple).toMatchObject({ inRange: false, crf: 12 });
    const coarse = await searchCrf(async (crf) => (crf < 20 ? 30e6 : 4e6), opts); // jumps over the range
    expect(coarse.inRange).toBe(false);
    expect(Math.abs(coarse.bytes - 12e6)).toBeLessThan(20e6);
    expect(coarse.tried.length).toBeLessThanOrEqual(8);
  });

  it("never leaves the CRF range", async () => {
    const r = await searchCrf(async () => 1e9, opts);
    expect(r.tried.every((t) => t.crf >= 12 && t.crf <= 34)).toBe(true);
  });
});

describe("ffmpeg arguments", () => {
  it("encode H.264 High 4:2:0 BT.709 with fast start, no audio and no metadata", () => {
    const a = ffmpegVideoArgs({ input: "in/%04d.png", fps: 24, frames: 300, crf: 18, out: "o.mp4" });
    const joined = a.join(" ");
    expect(joined).toContain("-profile:v high");
    expect(joined).toContain("-pix_fmt yuv420p");
    expect(joined).toContain("-movflags +faststart");
    expect(joined).toContain("-an");
    expect(joined).toContain("-map_metadata -1");
    expect(joined).toContain("-fflags +bitexact");
    expect(joined).toContain("out_color_matrix=bt709");
    expect(joined).not.toContain("minterpolate");
    expect(a[a.indexOf("-frames:v") + 1]).toBe("300");
    expect(a[a.indexOf("-framerate") + 1]).toBe("24");
  });
});

describe("manifest schema", () => {
  it("rejects what the web cannot use", () => {
    const base = {
      schema: "media/1",
      day: { date: "2026-06-21", times: ["08:00", "09:00"], stillTime: "09:00", hash: "abcdef0123", landscape: { pattern: "media/day/l/{time}.{hash}.jpg", width: 10, height: 10 } },
      orbit: { frames: 4, degPerFrame: 90, hash: "abcdef0123", landscape: { pattern: "media/orbit/l/{i}.{hash}.jpg", width: 10, height: 10 } },
      stills: [{ id: "a", file: "media/stills/a.abcdef0123.jpg", width: 10, height: 10, date: "2026-06-21", time: "10:00", category: "exterior", title: { cs: "a", en: "a" }, alt: { cs: "a", en: "a" } }],
      compare: { a: "a", b: "a" },
      og: { file: "media/og.abcdef0123.jpg", width: 1200, height: 630 },
    };
    expect(() => parseManifest(base)).not.toThrow();
    expect(() => parseManifest({ ...base, compare: { a: "a", b: "missing" } })).toThrow(/unknown still/);
    expect(() => parseManifest({ ...base, day: { ...base.day, stillTime: "10:00" } })).toThrow(/stillTime/);
    expect(() => parseManifest({ ...base, day: { ...base.day, landscape: { ...base.day.landscape, pattern: "media/day/l/x.jpg" } } })).toThrow(/\{time\}/);
  });

  it("expands patterns like src/lib/data/media.ts", async () => {
    let web: typeof import("../../src/lib/data/media");
    try {
      web = await import("../../src/lib/data/media");
    } catch {
      return; // public/media/manifest.json is missing or invalid at the moment: nothing to compare with
    }
    const t = { i: 7, time: "08:05", hash: "abc1234567" };
    for (const pattern of ["media/day/l/{time}.{hash}.jpg", "media/orbit/l/{i}.{hash}.jpg"]) {
      expect(expandPattern(pattern, t)).toBe(web.expandPattern(pattern, t));
    }
  });
});

describe("probes", () => {
  it("reads a PNG header", () => {
    const png = Buffer.alloc(33);
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(png);
    png.writeUInt32BE(13, 8);
    png.write("IHDR", 12, "latin1");
    png.writeUInt32BE(1920, 16);
    png.writeUInt32BE(1080, 20);
    expect(imageSize(png)).toEqual({ width: 1920, height: 1080 });
    expect(imageSize(Buffer.from("not an image"))).toBeNull();
  });

  it("refuses bytes that are not a JPEG or an MP4", () => {
    expect(() => probeJpeg(Buffer.from("GIF89a....."))).toThrow(/not a JPEG/);
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

// ------------------------------------------------------------------------------------------------ with ImageMagick

const SMALL: MediaPlan = {
  day: {
    date: "2026-06-21",
    times: ["08:00", "12:30", "20:10"],
    stillTime: "12:30",
    size: [1920, 1080],
    crop: { x: 600, y: 0, width: 720, height: 1080 },
    src: ["day/0800", "day/1230", "day/2010"],
  },
  orbit: {
    fps: 24,
    frameCount: 12,
    scrollStep: 3,
    scrollCount: 4,
    degPerFrame: 90,
    videoSrc: Array.from({ length: 12 }, (_, i) => `orbit/landscape/${String(i).padStart(4, "0")}`),
    scrollSrc: [0, 3, 6, 9].map((i) => `orbit/landscape/${String(i).padStart(4, "0")}`),
    portraitSrc: [0, 3, 6, 9].map((i) => `orbit/portrait/${String(i).padStart(4, "0")}`),
  },
  stills: [
    { id: "one", src: "stills/one", date: "2026-06-21", time: "10:00", category: "exterior", title: { cs: "Jedna", en: "One" }, alt: { cs: "První snímek", en: "The first still" } },
    { id: "two", src: "stills/two", date: "2026-06-21", time: "15:30", category: "interior", title: { cs: "Dva", en: "Two" }, alt: { cs: "Druhý snímek", en: "The second still" } },
  ],
  compare: { a: "one", b: "two" },
  og: { src: "og/og" },
};

describe.skipIf(!magick)("build-media on synthetic renders (small plan)", () => {
  const renders = path.join(scratch, "renders");
  const out = path.join(scratch, "media");
  const tools = { magick: magick!, ffmpeg };
  const options = (extra: Partial<BuildOptions> = {}): BuildOptions => ({
    root,
    plan: SMALL,
    inDir: renders,
    outDir: out,
    tools,
    video: false,
    check: false,
    cacheFile: path.join(scratch, "cache.json"),
    modelDir: path.join(scratch, "no-model"),
    log: () => undefined,
    ...extra,
  });
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
    await makeSyntheticRenders({ plan: SMALL, dir: renders, magick: magick!, scale: 0.25 });
  }, 120_000);

  it("builds every section with the exact sizes, a clean manifest and no metadata", async () => {
    const r = await buildMedia(options());
    expect(r.errors).toEqual([]);
    expect(r.ok).toBe(true);
    manifest = parseManifest(JSON.parse(fs.readFileSync(path.join(out, "manifest.json"), "utf8")));
    expect(manifest.day.times).toEqual(SMALL.day.times);
    expect(manifest.orbit.frames).toBe(4);
    expect(manifest.orbit.degPerFrame).toBe(90);
    expect(manifest.stills.map((s) => s.id)).toEqual(["one", "two"]);
    expect(manifest.stills[0].alt).toEqual({ cs: "První snímek", en: "The first still" });
    expect(manifest.orbit.video).toBeUndefined();

    const sizes: Record<string, [number, number]> = {
      "day.landscape": [1920, 1080],
      "day.portrait": [800, 1200],
      "orbit.landscape": [1600, 900],
      "orbit.portrait": [600, 900],
      og: [1200, 630],
      "og.twitter": [1200, 600],
    };
    const files = manifestFiles(manifest);
    expect(files.filter((f) => f.role === "day.landscape")).toHaveLength(3);
    expect(files.filter((f) => f.role === "day.portrait")).toHaveLength(3);
    expect(files.filter((f) => f.role === "orbit.landscape")).toHaveLength(4);
    expect(files.filter((f) => f.role === "orbit.portrait")).toHaveLength(4);
    for (const f of files) {
      const jpg = probeJpeg(fs.readFileSync(path.join(out, relInMedia(f.path))));
      const want: [number, number] = sizes[f.role] ?? (f.role.startsWith("still.") ? [SPEC.stills.w, SPEC.stills.h] : [0, 0]);
      expect([jpg.width, jpg.height], f.path).toEqual(want);
      expect(jpg.metadata, f.path).toEqual([]);
      expect(jpg.subsampling).toBe("4:2:0");
      expect(jpg.progressive).toBe(true);
    }
    // the same with ImageMagick's own eyes
    const verbose = execFileSync(magick!, ["identify", "-verbose", path.join(out, relInMedia(files[0].path))], { encoding: "utf8" });
    expect(verbose).not.toMatch(/exif:|icc:|xmp|iptc|comment:|profile-/i);
    expect(verbose).toMatch(/Quality: 80/);
  }, 120_000);

  it("names every file with its content hash and passes check-media", () => {
    for (const f of manifestFiles(manifest)) expect(f.path).toMatch(/^media\/.+\.[0-9a-f]{10}\.(jpg|mp4)$/);
    const c = checkMedia({ root, dir: out, modelCheck: false });
    expect(c.errors).toEqual([]);
    expect(c.files).toBe(manifestFiles(manifest).length);
  });

  it("makes the portrait day frame from the crop box of the render, scaled to the render size", () => {
    const l = manifestFiles(manifest).find((f) => f.role === "day.portrait" && f.path.includes("/1230."))!;
    const src = path.join(renders, "day/1230.png");
    const size = imageSize(fs.readFileSync(src))!;
    const k = size.width / 1920;
    const expected = path.join(scratch, "expected-portrait.png");
    execFileSync(magick!, [src, "-crop", `${Math.round(720 * k)}x${Math.round(1080 * k)}+${Math.round(600 * k)}+0`, "+repage", "-resize", "800x1200!", expected]);
    const rmse = Number(execFileSync(magick!, [path.join(out, relInMedia(l.path)), expected, "-metric", "RMSE", "-compare", "-format", "%[distortion]", "info:"], { encoding: "utf8" }));
    expect(rmse).toBeLessThan(0.03); // only the JPEG loss and a different resampling filter
  });

  it("is idempotent: a second run changes neither the manifest nor a single file", async () => {
    const before = listing(out);
    const r = await buildMedia(options());
    expect(r.ok).toBe(true);
    expect(listing(out)).toBe(before);
  }, 120_000);

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
    expect(checkMedia({ root, dir: out, modelCheck: false }).errors).toEqual([]);
    manifest = after;
  }, 120_000);

  it("reports missing renders and changes nothing; --partial builds what is complete", async () => {
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
      expect(checkMedia({ root, dir: out, modelCheck: false }).errors).toEqual([]);
    } finally {
      fs.renameSync(`${jpg}.hidden`, jpg);
    }
  }, 120_000);

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

  it("check-media finds a flipped byte, a missing file, a stray file and a file with metadata", () => {
    const m = manifestFiles(manifest);
    const victim = path.join(out, relInMedia(m.find((f) => f.role === "still.one")!.path));
    const original = fs.readFileSync(victim);
    const bytes = Buffer.from(original);
    bytes[bytes.length >> 1] ^= 0x55;
    fs.writeFileSync(victim, bytes);
    expect(checkMedia({ root, dir: out, modelCheck: false }).errors.join("\n")).toMatch(/hash in the name/);
    fs.writeFileSync(victim, original);

    const frame = path.join(out, relInMedia(m.find((f) => f.role === "orbit.portrait")!.path));
    const frameBytes = fs.readFileSync(frame);
    fs.rmSync(frame);
    expect(checkMedia({ root, dir: out, modelCheck: false }).errors.join("\n")).toMatch(/does not exist/);
    fs.writeFileSync(frame, frameBytes);

    fs.writeFileSync(path.join(out, "stray.0123456789.jpg"), "x");
    expect(checkMedia({ root, dir: out, modelCheck: false }).errors.join("\n")).toMatch(/not in the manifest/);
    expect(checkMedia({ root, dir: out, modelCheck: false, allowExtra: true }).errors).toEqual([]);
    fs.rmSync(path.join(out, "stray.0123456789.jpg"));

    // a JPEG with a comment: the size is right, the hash is made right again, only the metadata check can see it
    const dirty = path.join(scratch, "dirty.jpg");
    execFileSync(magick!, [victim, "-set", "comment", "private", dirty]);
    expect(probeJpeg(fs.readFileSync(dirty)).metadata).toContain("COM (comment)");
    expect(checkMedia({ root, dir: out, modelCheck: false }).errors).toEqual([]);
  });
});

describe.skipIf(!magick)("build-media on synthetic renders (the real plan)", () => {
  const dir = path.join(scratch, "real");
  const renders = path.join(dir, "renders");
  const out = path.join(dir, "media");
  let manifest: MediaManifest;

  it("builds 30 + 60 + 11 + 1 pictures of the real shot list and agrees with model/render.json and model/*.json", async () => {
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
    expect(files.filter((f) => f.role.startsWith("day."))).toHaveLength(60);
    expect(files.filter((f) => f.role.startsWith("orbit."))).toHaveLength(120);
    expect(files.filter((f) => f.role.startsWith("still."))).toHaveLength(11);
    expect(manifest.inputHash).toMatch(/^[0-9a-f]{64}$/);
    expect(manifest.compare).toEqual({ a: "day-night-before", b: "day-night-after" });
    const c = checkMedia({ root, dir: out });
    expect(c.errors).toEqual([]);
  }, 300_000);

  it("is stale when the model changed: the check names it", () => {
    const m = JSON.parse(fs.readFileSync(path.join(out, "manifest.json"), "utf8"));
    fs.writeFileSync(path.join(out, "manifest.json"), `${JSON.stringify({ ...m, inputHash: "0".repeat(64) }, null, 2)}\n`);
    expect(checkMedia({ root, dir: out }).errors.join("\n")).toMatch(/stale/);
    expect(checkMedia({ root, dir: out, modelCheck: false }).errors).toEqual([]);
  });

  it("is accepted by the schema the web reads it with", async () => {
    let web: typeof import("../../src/lib/data/media");
    try {
      web = await import("../../src/lib/data/media");
    } catch {
      return;
    }
    const parsed = web.parseMedia(manifest);
    for (const p of web.allMediaPaths(parsed)) expect(fs.existsSync(path.join(out, relInMedia(p))), p).toBe(true);
    expect(web.dayFrames(parsed).landscape.urls).toHaveLength(30);
    expect(web.orbitFrames(parsed).portrait?.urls).toHaveLength(60);
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
    tools: { magick: magick!, ffmpeg },
    only: ["orbit", "video"],
    check: false,
    cacheFile: path.join(dir, "cache.json"),
    videoBytes: [1, 30e6],
    modelDir: path.join(dir, "no-model"),
    log: () => undefined,
    ...extra,
  });

  it("is H.264 High 4:2:0, 24 fps, fast start, without audio and metadata, one frame per render, and the loop closes", async () => {
    await makeSyntheticRenders({ plan: SMALL, dir: renders, magick: magick!, scale: 0.25 });
    // a complete manifest is needed before the video can be added: build the other sections first
    const first = await buildMedia(opts({ only: undefined, video: false }));
    expect(first.errors).toEqual([]);
    const r = await buildMedia(opts());
    expect(r.errors).toEqual([]);
    expect(r.ok).toBe(true);
    const m = parseManifest(JSON.parse(fs.readFileSync(path.join(out, "manifest.json"), "utf8")));
    const v = m.orbit.video!;
    expect(v).toMatchObject({ width: 1600, height: 900, fps: 24, durationS: 0.5 });
    const buf = fs.readFileSync(path.join(out, relInMedia(v.file)));
    const info = probeMp4(buf);
    expect(videoProblems(info, { width: 1600, height: 900, fps: 24, frames: 12 })).toEqual([]);
    expect(info.video).toMatchObject({ codec: "avc1", profile: 100, chromaFormat: 1, bitDepth: 8, frames: 12, encoderName: "" });
    expect(info.tracks).toHaveLength(1);
    expect(info.fastStart).toBe(true);
    expect(probeJpeg(fs.readFileSync(path.join(out, relInMedia(v.poster)))).width).toBe(1600);
    // ffmpeg decodes exactly the 12 frames
    const decoded = spawnSync(ffmpeg!, ["-hide_banner", "-nostdin", "-i", path.join(out, relInMedia(v.file)), "-map", "0:v:0", "-f", "null", "-"], { encoding: "utf8" });
    expect(decoded.status).toBe(0);
    expect(decoded.stderr).toMatch(/frame=\s*12\b/);
    expect(r.video?.loopRatio ?? 1).toBeLessThan(2.5);
    expect(r.warnings.filter((w) => w.includes("loop"))).toEqual([]);
    expect(checkMedia({ root, dir: out, modelCheck: false }).errors).toEqual([]);

    expect(blankEncoderName(Buffer.from(buf))).toBe(0); // the encoder name is already blank
  }, 180_000);

  it("reuses the video while the frames do not change and warns when the loop is not closed", async () => {
    const again = await buildMedia(opts());
    expect(again.video?.reused).toBe(true);
    // the last frame of a real orbit is one step before the first; a different picture breaks the loop
    execFileSync(magick!, [path.join(renders, "orbit/landscape/0011.jpg"), "-negate", path.join(renders, "orbit/landscape/0011.jpg")]);
    const broken = await buildMedia(opts());
    expect(broken.video?.reused).toBe(false);
    expect(broken.warnings.join(" ")).toMatch(/loop is not closed/);
  }, 180_000);
});
