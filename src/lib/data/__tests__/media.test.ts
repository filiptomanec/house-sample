// The media contract: the manifest parses, every file it names exists and has the size it declares, the helpers expand patterns
// as the pipeline writes them (strided and small variants too), manifest text is typeset, and a broken manifest is rejected with
// a message that names the problem.
import { existsSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import manifestJson from "../../../../public/media/manifest.json";
import { nb } from "@/lib/i18n/format";
import {
  allMediaPaths, clockToMinutes, clockToken, compareStills, dayDate, dayFrame, dayFrames, dayMinutes, dayStillIndex, expandPattern, inGallery,
  localized, media, mediaUrl, ogAlt, orbitFrame, orbitFrames, parseMedia, pictureOf, posterOf, stillDate, stillMinutes, stillPicture, stills,
  stillUrl, videoPoster, videoRenditions,
} from "../media";

const publicDir = join(__dirname, "..", "..", "..", "..", "public");
const clone = () => structuredClone(manifestJson) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

describe("manifest", () => {
  it("parses", () => {
    expect(media.schema).toBe("media/1");
    expect(() => parseMedia(manifestJson)).not.toThrow();
  });

  it("names only files that exist (a missing frame would show up only at run time)", () => {
    const missing = allMediaPaths().filter((p) => !existsSync(join(publicDir, p)));
    expect(missing).toEqual([]);
  });

  it("has no duplicate files", () => {
    const paths = allMediaPaths();
    expect(new Set(paths).size).toBe(paths.length);
  });

  it("declares the pixel size of what it names (first frame of each variant, every still, the share image)", async () => {
    const check = async (path: string, width: number, height: number) => {
      const meta = await sharp(join(publicDir, path)).metadata();
      expect([path, meta.width, meta.height]).toEqual([path, width, height]);
    };
    for (const v of ["landscape", "portrait"] as const) {
      const d = media.day[v], o = media.orbit[v];
      if (d) await check(expandPattern(d.pattern, { time: media.day.times[0], hash: media.day.hash }), d.width, d.height);
      if (o) await check(expandPattern(o.pattern, { i: 0, hash: media.orbit.hash }), o.width, o.height);
    }
    for (const s of media.stills) {
      await check(s.file, s.width, s.height);
      for (const v of s.variants ?? []) for (const f of [v.avif, v.webp, v.jpg]) if (f) await check(f, v.w, v.h);
    }
    await check(media.og.file, media.og.width, media.og.height);
    if (media.og.twitter) await check(media.og.twitter.file, media.og.twitter.width, media.og.twitter.height);
    for (const page of ["model", "sun"] as const) {
      const p = media.posters?.[page];
      if (p) for (const d of ["desktop", "phone"] as const) await check(p[d].file, p[d].width, p[d].height);
    }
  });

  it("keeps file names under their content hash", () => {
    expect(media.day.landscape.pattern).toContain("{hash}");
    expect(media.orbit.landscape.pattern).toContain("{hash}");
    for (const s of media.stills) expect(s.file).toMatch(/\.[0-9a-f]{6,}\.\w+$/);
  });
});

describe("helpers", () => {
  it("expands the tokens of a pattern", () => {
    expect(expandPattern("media/day/{time}.{hash}.jpg", { time: "08:05", hash: "abc123" })).toBe("media/day/0805.abc123.jpg");
    expect(expandPattern("media/o/{i}.{hash}.jpg", { i: 7, hash: "abc123" })).toBe("media/o/007.abc123.jpg");
    expect(clockToken("21:40")).toBe("2140");
  });

  it("turns paths into root-relative URLs", () => {
    expect(mediaUrl("media/x.jpg")).toBe("/media/x.jpg");
    expect(mediaUrl("/media/x.jpg")).toBe("/media/x.jpg");
  });

  it("lists one frame per time and per orbit step, in order", () => {
    const day = dayFrames();
    expect(day.landscape.urls).toHaveLength(media.day.times.length);
    expect(new Set(day.landscape.urls).size).toBe(media.day.times.length);
    expect(day.landscape.urls[0]).toBe(dayFrame(0, "landscape"));
    const orbit = orbitFrames();
    expect(orbit.landscape.urls).toHaveLength(media.orbit.frames);
    expect(orbit.landscape.urls[media.orbit.frames - 1]).toBe(orbitFrame(media.orbit.frames - 1));
    if (day.portrait) expect(day.portrait.urls).toHaveLength(media.day.times.length);
    expect(() => orbitFrame(media.orbit.frames)).toThrow(RangeError);
    expect(() => dayFrame(-1)).toThrow(RangeError);
  });

  it("gives every variant one URL per frame: a strided variant repeats the file of the frame before, a small copy has the same frames", () => {
    const orbit = orbitFrames();
    for (const v of [orbit.landscape, orbit.portrait, dayFrames().landscape, dayFrames().portrait]) {
      if (!v) continue;
      if (v.small) {
        expect(v.small.urls).toHaveLength(v.urls.length);
        expect(v.small.width).toBeLessThan(v.width);
      }
    }
    const stride = media.orbit.portrait?.stride ?? 1;
    if (orbit.portrait) {
      orbit.portrait.urls.forEach((u, i) => expect(u).toBe(orbit.portrait!.urls[i - (i % stride)]));
      expect(new Set(orbit.portrait.urls).size).toBe(Math.ceil(media.orbit.frames / stride));
    }
    // every URL is a file the manifest lists
    const listed = new Set(allMediaPaths().map(mediaUrl));
    for (const v of [orbit.landscape, orbit.portrait, dayFrames().landscape, dayFrames().portrait]) {
      for (const u of [...(v?.urls ?? []), ...(v?.small?.urls ?? [])]) expect(listed.has(u), u).toBe(true);
    }
  });

  it("typesets manifest text: localized() is nb() of the language", () => {
    for (const s of media.stills) {
      for (const locale of ["cs", "en"] as const) {
        expect(localized(s.title, locale)).toBe(nb(s.title[locale], locale));
        expect(localized(s.alt, locale)).toBe(nb(s.alt[locale], locale));
      }
    }
    expect(localized({ cs: "Dům a zahrada v 21 m", en: "a b" }, "cs")).toBe("Dům a\u00a0zahrada v\u00a021\u00a0m");
    if (media.og.alt) expect(ogAlt("cs")).toBe(nb(media.og.alt.cs, "cs"));
  });

  it("builds responsive pictures from the variants (AVIF and WebP sources, JPEG on the img, widths ascending)", () => {
    const p = pictureOf("media/a.jpg", 1920, 1080, [
      { w: 1280, h: 720, avif: "media/a-1280.avif", webp: "media/a-1280.webp", jpg: "media/a-1280.jpg" },
      { w: 640, h: 360, avif: "media/a-640.avif", jpg: "media/a-640.jpg" },
    ]);
    expect(p.src).toBe("/media/a.jpg");
    expect(p.srcSet).toBe("/media/a-640.jpg 640w, /media/a-1280.jpg 1280w");
    expect(p.sources).toEqual([
      { type: "image/avif", srcSet: "/media/a-640.avif 640w, /media/a-1280.avif 1280w" },
      { type: "image/webp", srcSet: "/media/a-1280.webp 1280w" },
    ]);
    expect(pictureOf("media/b.jpg", 10, 10)).toEqual({ src: "/media/b.jpg", sources: [], width: 10, height: 10 });
    for (const s of media.stills) expect(stillPicture(s).src).toBe(stillUrl(s));
  });

  it("lists the video renditions widest first, the poster as a picture and the posters of the 3D pages", () => {
    const r = videoRenditions();
    if (media.orbit.video) {
      expect(r[0].src).toBe(mediaUrl(media.orbit.video.file));
      for (let i = 1; i < r.length; i++) expect(r[i].width).toBeLessThan(r[i - 1].width);
      expect(videoPoster()!.src).toBe(mediaUrl(media.orbit.video.poster));
    } else expect(r).toEqual([]);
    for (const page of ["model", "sun"] as const) expect(posterOf(page) === null).toBe(!media.posters?.[page]);
  });

  it("reads clock times, dates and the still frame", () => {
    expect(clockToMinutes("08:05")).toBe(485);
    const minutes = dayMinutes();
    expect(minutes).toHaveLength(media.day.times.length);
    expect([...minutes].sort((a, b) => a - b)).toEqual(minutes);
    expect(minutes[dayStillIndex()]).toBe(clockToMinutes(media.day.stillTime));
    const d = dayDate();
    expect(`${d.year}-${String(d.month + 1).padStart(2, "0")}-${String(d.day).padStart(2, "0")}`).toBe(media.day.date);
  });

  it("finds the stills and the before/after pair", () => {
    expect(stills()).toHaveLength(media.stills.length);
    const { a, b } = compareStills();
    expect(a.id).not.toBe(b.id);
    expect(stillMinutes(a)).toBeLessThan(stillMinutes(b)); // day on the left, evening on the right
    expect(stillUrl(a)).toMatch(/^\/media\//);
    expect(stillDate(a).month).toBeGreaterThanOrEqual(0);
    for (const s of stills({ categories: ["aerial"] })) expect(s.category).toBe("aerial");
    expect(stills({ gallery: true })).toEqual(media.stills.filter(inGallery));
    expect(inGallery({ gallery: false })).toBe(false);
    expect(inGallery({})).toBe(true);
  });
});

describe("validation", () => {
  it("rejects times that do not ascend", () => {
    const m = clone();
    m.day.times = [m.day.times[1], m.day.times[0], ...m.day.times.slice(2)];
    expect(() => parseMedia(m)).toThrow(/ascending/);
  });

  it("rejects a still time that is not a frame time", () => {
    const m = clone();
    m.day.stillTime = "03:07";
    expect(() => parseMedia(m)).toThrow(/stillTime/);
  });

  it("rejects patterns without their token", () => {
    const m = clone();
    m.day.landscape.pattern = "media/day/fixed.jpg";
    expect(() => parseMedia(m)).toThrow(/\{time\}/);
    const o = clone();
    o.orbit.landscape.pattern = "media/orbit/fixed.jpg";
    expect(() => parseMedia(o)).toThrow(/\{i\}/);
  });

  it("rejects duplicate still ids and a compare pair that names nothing", () => {
    const dup = clone();
    dup.stills[1].id = dup.stills[0].id;
    expect(() => parseMedia(dup)).toThrow(/duplicate/);
    const bad = clone();
    bad.compare.b = "nope";
    expect(() => parseMedia(bad)).toThrow(/unknown still/);
  });

  it("rejects a stride on day frames, a small copy without its token and a bad build date", () => {
    const d = clone();
    d.day.landscape.stride = 2;
    expect(() => parseMedia(d)).toThrow(/stride/);
    const s = clone();
    s.day.landscape.small = { pattern: "media/day/s.webp", width: 5, height: 5 };
    expect(() => parseMedia(s)).toThrow(/\{time\}/);
    expect(() => parseMedia({ ...clone(), builtAt: "yesterday" })).toThrow();
  });

  it("rejects an unknown schema, a bad clock and a missing translation", () => {
    expect(() => parseMedia({ ...clone(), schema: "media/2" })).toThrow();
    const clock = clone();
    clock.stills[0].time = "25:00";
    expect(() => parseMedia(clock)).toThrow();
    const text = clone();
    delete text.stills[0].alt.en;
    expect(() => parseMedia(text)).toThrow();
  });
});
