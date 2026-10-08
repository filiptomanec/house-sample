// The optional fields of the media manifest the start page reads (contract C4), with their fallbacks, and the zone hover rules.
import { describe, expect, it } from "vitest";
import { media, stillUrl, type Media, type Still } from "@/lib/data/media";
import { LOCALES } from "@/lib/i18n/config";
import { ZONE_ORDER } from "../homeFacts";
import { compareSides, inGallery, orbitPath, renderedCaptionAzimuths, stillPicture } from "../mediaExtras";
import { zoneHoverCss } from "../PlanDraw";

const still: Still = media.stills[0];

describe("stillPicture", () => {
  it("is the single file when the manifest has no variants", () => {
    const p = stillPicture({ ...still, variants: undefined } as Still);
    expect(p).toEqual({ src: stillUrl(still), srcSet: undefined, sources: [], width: still.width, height: still.height });
  });

  it("lists every width per format, narrowest first, modern formats as sources and JPEG on the image", () => {
    const variants = [
      { w: 1280, avif: "media/s/a-1280.avif", webp: "media/s/a-1280.webp", jpg: "media/s/a-1280.jpg" },
      { w: 640, avif: "media/s/a-640.avif", webp: "media/s/a-640.webp", jpg: "media/s/a-640.jpg" },
    ];
    const p = stillPicture({ ...still, variants } as Still);
    expect(p.sources.map((s) => s.type)).toEqual(["image/avif", "image/webp"]);
    expect(p.sources[0].srcSet).toBe("/media/s/a-640.avif 640w, /media/s/a-1280.avif 1280w");
    expect(p.srcSet).toBe("/media/s/a-640.jpg 640w, /media/s/a-1280.jpg 1280w");
    expect(p.src).toBe(stillUrl(still));
  });

  it("leaves out a format the variants do not have", () => {
    const p = stillPicture({ ...still, variants: [{ w: 640, webp: "media/s/b.webp" }] } as Still);
    expect(p.sources.map((s) => s.type)).toEqual(["image/webp"]);
    expect(p.srcSet).toBeUndefined();
  });
});

describe("manifest fields with fallbacks", () => {
  it("keeps a still in the gallery unless the manifest says no", () => {
    expect(inGallery(still)).toBe(true);
    expect(inGallery({ ...still, gallery: false } as Still)).toBe(false);
  });

  it("reads the orbit's start and direction from the manifest, else from the render settings", () => {
    const fallback = { startAzimuthDeg: 123, direction: "clockwise" as const };
    const bare = { orbit: { ...media.orbit } } as Pick<Media, "orbit">;
    delete (bare.orbit as { startAzimuthDeg?: number }).startAzimuthDeg;
    delete (bare.orbit as { direction?: string }).direction;
    expect(orbitPath(bare, fallback)).toEqual({ ...fallback, degPerFrame: media.orbit.degPerFrame });
    const written = { orbit: { ...media.orbit, startAzimuthDeg: 200, direction: "counterclockwise" } } as Pick<Media, "orbit">;
    expect(orbitPath(written, fallback)).toEqual({ startAzimuthDeg: 200, direction: "counterclockwise", degPerFrame: media.orbit.degPerFrame });
  });

  it("takes the caption window from the manifest, else from the render settings, else leaves it to the default", () => {
    const fallback = { startAzimuthDeg: 123, direction: "clockwise" as const, halfWindowDeg: 35 };
    expect(orbitPath({ orbit: { ...media.orbit } } as Pick<Media, "orbit">, fallback).halfWindowDeg).toBe(
      (media.orbit as { captionHalfWindowDeg?: number }).captionHalfWindowDeg ?? 35);
    const written = { orbit: { ...media.orbit, captionHalfWindowDeg: 40 } } as Pick<Media, "orbit">;
    expect(orbitPath(written, fallback).halfWindowDeg).toBe(40);
    const none = { orbit: { ...media.orbit } } as Pick<Media, "orbit">;
    delete (none.orbit as { captionHalfWindowDeg?: number }).captionHalfWindowDeg;
    expect("halfWindowDeg" in orbitPath(none, { startAzimuthDeg: 1, direction: "clockwise" as const, halfWindowDeg: undefined })).toBe(false);
  });

  it("reads the caption azimuths the render pipeline computed, keyed by their word, and nothing when they are missing", () => {
    const bare = { orbit: { ...media.orbit } } as Pick<Media, "orbit">;
    delete (bare.orbit as { captions?: unknown }).captions;
    expect(renderedCaptionAzimuths(bare)).toEqual({});
    const written = { orbit: { ...media.orbit, captions: [{ feature: "pv", azimuthDeg: 180 }, { feature: "entry", azimuthDeg: 10.1 }, { feature: "x", azimuthDeg: Number.NaN }] } } as Pick<Media, "orbit">;
    expect(renderedCaptionAzimuths(written)).toEqual({ pv: 180, entry: 10.1 });
  });

  it("tags each half with its short label when the manifest has one, else with its title", () => {
    for (const l of LOCALES) {
      const loc = (s: string) => ({ cs: `${s} cs`, en: `${s} en` });
      const both = compareSides({ ...media, compare: { ...media.compare, before: { label: loc("La"), title: loc("Ta") }, after: { title: loc("Tb") } } } as Media, l);
      expect([both.titleA, both.titleB]).toEqual([`La ${l}`, `Tb ${l}`]);
    }
  });

  it("titles and describes the halves of the comparison when the manifest does, else uses the still's alt text", () => {
    for (const l of LOCALES) {
      const plain = compareSides({ ...media, compare: { a: media.compare.a, b: media.compare.b } }, l);
      expect(plain.altA).toBe(plain.a.alt[l]);
      expect([plain.titleA, plain.titleB, plain.altB]).toEqual([null, null, null]);
      const side = (s: string) => ({ title: { cs: `${s} cs`, en: `${s} en` }, alt: { cs: `${s} alt cs`, en: `${s} alt en` } });
      const rich = compareSides({ ...media, compare: { ...media.compare, before: side("A"), after: side("B") } } as Media, l);
      expect([rich.titleA, rich.titleB, rich.altA, rich.altB]).toEqual([`A ${l}`, `B ${l}`, `A alt ${l}`, `B alt ${l}`]);
    }
  });
});

describe("zoneHoverCss", () => {
  it("writes one rule per zone that keeps the hovered zone lit in the list and the drawing", () => {
    const css = zoneHoverCss();
    for (const k of ZONE_ORDER) expect(css).toContain(`:has([data-zone="${k}"]:hover) [data-zone="${k}"]{opacity:1}`);
    expect(css.match(/\{opacity:1\}/g)).toHaveLength(ZONE_ORDER.length);
    expect(zoneHoverCss([])).toBe("");
  });
});
