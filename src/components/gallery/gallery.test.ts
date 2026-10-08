// Gallery: the bento layout fills complete rows for any number of tiles (checked by simulating grid placement), filters, items
// and captions follow the manifest and the sun of the house's place, the zoom geometry keeps the picture under the fingers, and a
// server render shows every gallery picture as a responsive <picture> in both languages. No file names or counts of the project's
// own media are written here: the expectations are computed from the manifest.
import { createElement as h, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { compassPoint, placeOf } from "@/lib/calc/sun";
import { inGallery, localized, media, parseMedia, stillPicture } from "@/lib/data/media";
import { I18nProvider } from "@/lib/i18n/client";
import type { Locale } from "@/lib/i18n/config";
import { getFormatter, nb } from "@/lib/i18n/format";
import { messagesFor } from "@/lib/i18n/messages";
import { getT } from "@/lib/i18n/server";
import { house } from "@/lib/model/instance";
import { bento, CELLS, type Tile } from "./bento";
import { EAGER, Gallery, TILE_SIZES } from "./Gallery";
import { matches } from "./filter";
import { mmss, phoneRendition, VideoPlayer } from "./VideoPlayer";
import { buildGalleryView, captionOf, EVENING_BELOW_DEG, filtersOf, isEvening, MIN_FILTER_ITEMS, sunOf } from "./view";
import { clampZoom, isZoomed, NO_ZOOM, panBy, pinchStep, toggleAt, ZOOM_MAX, ZOOM_TAP, zoomAt, zoomTransform } from "./zoom";

vi.mock("next/navigation", () => ({ usePathname: () => "/", notFound: () => { throw new Error("NEXT_NOT_FOUND"); } }));

const place = placeOf(house);
const html = (el: ReactElement) => renderToStaticMarkup(el);
const provide = (locale: Locale, child: ReactElement) => h(I18nProvider, { locale, messages: messagesFor(locale, ["common", "gallery"]), children: child });
const count = (s: string, re: RegExp) => (s.match(re) ?? []).length;
const esc = (s: string) => s.replaceAll("&", "&amp;").replaceAll('"', "&quot;");

/** Cells of a tile on a grid with `cols` columns (the two-column grid shrinks the four-column sizes). */
const cellsOn = (t: Tile, cols: number): [number, number] => {
  const [w, hgt] = CELLS[t.size];
  return cols === 4 ? [w, hgt] : [Math.min(w, cols), t.size === "wide" ? 1 : t.size === "full" ? 2 : hgt];
};

/** Places tiles the way CSS grid does with `grid-auto-flow: row dense` (mirrored big tiles ask for column 3 in the four-column grid). */
function place2(tiles: Tile[], cols: number): { rows: number; filled: boolean[][] } {
  const filled: boolean[][] = [];
  const free = (r: number, c: number, w: number, hh: number) => { for (let i = r; i < r + hh; i++) for (let j = c; j < c + w; j++) if (filled[i]?.[j]) return false; return c + w <= cols; };
  const mark = (r: number, c: number, w: number, hh: number) => { for (let i = r; i < r + hh; i++) { filled[i] ??= Array(cols).fill(false); for (let j = c; j < c + w; j++) filled[i][j] = true; } };
  for (const t of tiles) {
    const [w, hh] = cellsOn(t, cols);
    const fixed = cols === 4 && t.size === "big" && t.mirror ? 2 : null;
    let done = false;
    for (let r = 0; !done; r++) {
      for (let c = fixed ?? 0; c < (fixed === null ? cols : fixed + 1); c++) {
        if (free(r, c, w, hh)) { mark(r, c, w, hh); done = true; break; }
      }
    }
  }
  return { rows: filled.length, filled };
}

describe("bento", () => {
  it("is empty for no tiles and one full tile for one", () => {
    expect(bento(0)).toEqual([]);
    expect(bento(1).map((t) => t.size)).toEqual(["full"]);
  });

  it.each([4, 2])("fills every cell of complete rows without overlap or holes, for 0 to 40 tiles (%i columns)", (cols) => {
    for (let n = 0; n <= 40; n++) {
      const tiles = bento(n);
      expect(tiles).toHaveLength(n);
      const { filled } = place2(tiles, cols);
      const area = tiles.reduce((s, t) => { const [w, hh] = cellsOn(t, cols); return s + w * hh; }, 0);
      expect(filled.flat().filter(Boolean).length).toBe(area); // no overlap: every cell marked once
      for (const row of filled) expect(row.every(Boolean)).toBe(true); // no hole
    }
  });

  it("alternates the side of the big tile from block to block", () => {
    const t = bento(10);
    const bigs = t.filter((x) => x.size === "big");
    expect(bigs.map((b) => b.mirror)).toEqual([false, true]);
  });

  it("asks for a picture width per tile size: the whole screen on phones, never more than the shell", () => {
    for (const size of Object.keys(CELLS) as Tile["size"][]) {
      expect(TILE_SIZES[size]).toMatch(/100vw/);
      expect(TILE_SIZES[size]).toMatch(/\d+px$/);
    }
  });
});

describe("view model", () => {
  const gallery = media.stills.filter(inGallery);
  for (const locale of ["cs", "en"] as const) {
    const view = buildGalleryView(media, locale, place);

    it(`has one item per gallery still (the slider-only half is left out), with the typeset texts of the manifest in ${locale}`, () => {
      expect(view.items.map((i) => i.id)).toEqual(gallery.map((s) => s.id));
      for (const s of media.stills.filter((x) => !inGallery(x))) expect(view.items.some((i) => i.id === s.id)).toBe(false);
      gallery.forEach((s, i) => {
        expect(view.items[i].title).toBe(localized(s.title, locale));
        expect(view.items[i].alt).toBe(localized(s.alt, locale));
        expect(view.items[i].src).toBe(`/${s.file}`);
        expect(view.items[i].picture).toEqual(stillPicture(s));
      });
    });

    it(`captions every picture with its date, time and the sun of that moment in ${locale}`, () => {
      const t = getT(locale), f = getFormatter(locale);
      gallery.forEach((s, i) => {
        const cap = view.items[i].caption;
        const sun = sunOf(s, place);
        expect(cap).toBe(captionOf(s, place, locale));
        expect(cap).toBe(nb(cap, locale)); // typeset
        expect(cap).toContain(f.clock(view.items[i].minutes));
        if (Math.round(sun.altitude) > 0) {
          expect(cap).toContain(f.degrees(Math.round(sun.altitude), 0));
          expect(cap).toContain(t(`gallery.compass.${compassPoint(sun.azimuth)}`));
        } else expect(cap).toContain(t("gallery.sun.below"));
      });
    });
  }

  it("computes the sun for the house's place: high at noon, below the horizon at midnight, low in the evening", () => {
    const day = media.stills[0].date;
    const noon = sunOf({ date: day, time: "13:00" }, place);
    const night = sunOf({ date: day, time: "00:30" }, place);
    expect(noon.altitude).toBeGreaterThan(30);
    expect(night.altitude).toBeLessThan(0);
    expect(isEvening(noon)).toBe(false);
    expect(isEvening({ altitude: EVENING_BELOW_DEG - 1, hourAngle: 60 })).toBe(true);
    expect(isEvening({ altitude: EVENING_BELOW_DEG - 1, hourAngle: -60 })).toBe(false); // the same light in the morning
  });

  const view = buildGalleryView(media, "en", place);
  it("offers only filters that hold enough pictures and fewer than all, with counts computed from the items", () => {
    if (view.filters.length) expect(view.filters[0]).toEqual({ id: "all", count: view.items.length });
    for (const f of view.filters.slice(1)) {
      const n = view.items.filter((i) => matches(i, f.id)).length;
      expect(f.count).toBe(n);
      expect(n).toBeGreaterThanOrEqual(MIN_FILTER_ITEMS);
      expect(n).toBeLessThan(view.items.length);
    }
    expect(new Set(view.filters.map((f) => f.id)).size).toBe(view.filters.length);
  });

  it("drops small filters and shows none when nothing is left to choose", () => {
    const ext = { category: "exterior" as const, evening: false };
    const int = { category: "interior" as const, evening: false };
    const eve = { category: "exterior" as const, evening: true };
    expect(filtersOf([ext, ext, ext, int, int, int]).map((f) => f.id)).toEqual(["all", "exterior", "interior"]);
    expect(filtersOf([ext, ext, ext, int, eve]).map((f) => f.id)).toEqual(["all", "exterior"]);
    expect(filtersOf([ext, ext, ext, ext])).toEqual([]); // "exterior" would be the same as "all"
    expect(filtersOf([ext, int])).toEqual([]);
  });

  it("carries the video with its renditions and responsive poster only when the manifest has one", () => {
    expect(view.video === null).toBe(media.orbit.video === undefined);
    const raw = JSON.parse(JSON.stringify(media));
    const withVideo = parseMedia({ ...raw, orbit: { ...raw.orbit, video: { file: "media/orbit/x.mp4", poster: media.stills[0].file, width: 1280, height: 720, fps: 24, durationS: 9.7, variants: [{ w: 1280, h: 720, file: "media/orbit/x.mp4" }, { w: 640, h: 360, file: "media/orbit/x-640.mp4" }] } } });
    const v = buildGalleryView(withVideo, "cs", place).video!;
    expect(v).toMatchObject({ src: "/media/orbit/x.mp4", width: 1280, height: 720, durationS: 9.7 });
    expect(v.sources.map((s) => s.width)).toEqual([1280, 640]);
    expect(v.poster.src).toBe(`/${media.stills[0].file}`);
    expect(phoneRendition(v.sources)?.src).toBe("/media/orbit/x-640.mp4");
    expect(phoneRendition(v.sources.slice(0, 1))).toBeNull();
  });

  it("the video length is shown like the native player: whole seconds rounded down", () => {
    const f = getFormatter("cs");
    expect(mmss(f, 9.7)).toBe("0:09");
    expect(mmss(f, 75.2)).toBe("1:15");
    expect(mmss(f, 0)).toBe("0:00");
  });
});

describe("zoom", () => {
  const W = 1000, H = 560;

  it("toggles 2x at the tapped point (that point stays under the finger) and back", () => {
    const p = { x: 200, y: -100 };
    const z = toggleAt(NO_ZOOM, p, W, H);
    expect(z.s).toBe(ZOOM_TAP);
    // the picture point that was under p is still under p: t + s * q = p with q = p (it was at scale 1, no pan)
    expect(z.x + z.s * p.x).toBeCloseTo(p.x, 6);
    expect(z.y + z.s * p.y).toBeCloseTo(p.y, 6);
    expect(isZoomed(z)).toBe(true);
    expect(toggleAt(z, p, W, H)).toEqual(NO_ZOOM);
  });

  it("never lets a margin into view and never zooms outside its range", () => {
    const z = zoomAt(NO_ZOOM, 2, { x: W, y: H }, W, H); // a tap far outside: clamped to the edge
    expect(Math.abs(z.x)).toBeLessThanOrEqual((W * (z.s - 1)) / 2);
    expect(Math.abs(z.y)).toBeLessThanOrEqual((H * (z.s - 1)) / 2);
    expect(clampZoom({ s: 9, x: 0, y: 0 }, W, H).s).toBe(ZOOM_MAX);
    expect(clampZoom({ s: 0.2, x: 50, y: 50 }, W, H)).toEqual(NO_ZOOM);
    expect(panBy(NO_ZOOM, 40, 40, W, H)).toEqual(NO_ZOOM); // an unzoomed picture does not move
    const moved = panBy({ s: 2, x: 0, y: 0 }, 10_000, -10_000, W, H);
    expect(moved).toEqual({ s: 2, x: W / 2, y: -H / 2 });
  });

  it("pinches about the fingers' midpoint and follows it", () => {
    const prev = { mid: { x: 100, y: 50 }, dist: 100 };
    const next = { mid: { x: 120, y: 60 }, dist: 150 };
    const z = pinchStep(NO_ZOOM, prev, next, W, H);
    expect(z.s).toBeCloseTo(1.5, 6);
    // the picture point under the old midpoint is under the new one
    const q = { x: prev.mid.x, y: prev.mid.y }; // at scale 1 without pan the picture point equals the screen point
    expect(z.x + z.s * q.x).toBeCloseTo(next.mid.x, 6);
    expect(z.y + z.s * q.y).toBeCloseTo(next.mid.y, 6);
    expect(zoomTransform(z)).toMatch(/^translate\(.+\) scale\(1\.500\)$/);
    expect(zoomTransform(NO_ZOOM)).toBe("");
  });
});

describe.each(["cs", "en"] as const)("Gallery render (%s)", (locale) => {
  const view = buildGalleryView(media, locale, place);
  const out = html(provide(locale, h(Gallery, { view })));

  it("shows one tile per gallery picture: a button with a <picture> (AVIF/WebP sources, sizes), the alt text and the real size", () => {
    expect(count(out, /class="gal-item"/g)).toBe(view.items.length);
    for (const it of view.items) {
      expect(out).toContain(`src="${it.src}"`);
      expect(out).toContain(`width="${it.width}" height="${it.height}"`);
      expect(out).toContain(`alt="${esc(it.alt)}"`);
      for (const s of it.picture.sources) expect(out).toContain(`srcSet="${s.srcSet}"`);
    }
    expect(count(out, /<picture/g)).toBe(view.items.length + (view.video ? 1 : 0));
    expect(count(out, /sizes="/g)).toBeGreaterThanOrEqual(view.items.length);
    expect(count(out, /loading="eager"/g)).toBe(Math.min(EAGER, view.items.length));
    expect(count(out, /fetchPriority="high"/gi)).toBe(1);
  });

  it("captions every tile with the title and the sun line", () => {
    for (const it of view.items) expect(out).toContain(esc(it.caption).replaceAll(" ", " "));
  });

  it("has a segmented filter only when there is a choice (the first option pressed) and no open dialog", () => {
    expect(count(out, /class="seg fit"/g)).toBe(view.filters.length ? 1 : 0);
    expect(count(out, /aria-pressed="true"/g)).toBe(view.filters.length ? 1 : 0);
    expect(out).not.toContain('class="chip"');
    expect(out).not.toContain('role="dialog"');
  });

  it("every tile has an accessible name that says where it is in the list", () => {
    expect(count(out, /<button[^>]*class="gal-item"[^>]*aria-label="/g) + count(out, /<button[^>]*aria-label="[^"]*"[^>]*class="gal-item"/g)).toBe(view.items.length);
  });

  it("renders the video block only when there is a video", () => {
    expect(out.includes("gal-video")).toBe(view.video !== null);
  });
});

describe.each(["cs", "en"] as const)("VideoPlayer render (%s)", (locale) => {
  const poster = { src: "/media/p.jpg", srcSet: "/media/p-640.jpg 640w, /media/p.jpg 1280w", sources: [{ type: "image/avif", srcSet: "/media/p-640.avif 640w" }], width: 1280, height: 720 };
  const video = { src: "/media/orbit/x.mp4", sources: [{ src: "/media/orbit/x.mp4", width: 1280, height: 720 }, { src: "/media/orbit/x-640.mp4", width: 640, height: 360 }], poster, width: 1280, height: 720, durationS: 9.7 };
  const out = html(provide(locale, h(VideoPlayer, { video })));

  it("is built for iPhone: inline playback, nothing fetched before the tap, the phone rendition by media query, no native controls yet", () => {
    expect(out).toMatch(/playsinline=""/i);
    expect(out).toContain('preload="none"');
    expect(out).toMatch(/<source src="\/media\/orbit\/x-640\.mp4" type="video\/mp4" media="\(max-width: 900px\)"/);
    expect(out.indexOf("x-640.mp4")).toBeLessThan(out.indexOf('src="/media/orbit/x.mp4"'));
    expect(out).not.toMatch(/<video[^>]*controls/);
  });

  it("shows a responsive poster picture with high fetch priority, and reserves the box of the video (no layout shift)", () => {
    expect(out).toContain('class="gal-poster"');
    expect(out).toContain('type="image/avif"');
    expect(out).toMatch(/fetchPriority="high"/i);
    expect(out).toContain("aspect-ratio:1280 / 720");
    expect(out).toMatch(/<button[^>]*class="gal-play"[^>]*aria-label="[^"]*0:09/);
  });

  it("the gallery shows the video block when its view has a video", () => {
    const view = { ...buildGalleryView(media, locale, place), video };
    expect(html(provide(locale, h(Gallery, { view })))).toContain("gal-video");
  });
});
