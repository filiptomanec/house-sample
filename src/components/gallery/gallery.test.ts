// Gallery: the bento layout fills complete rows for any number of tiles (checked by simulating grid placement), filters and
// items follow the manifest, and a server render shows every still in both languages. No file names or counts of the project's
// own media are written here: the expectations are computed from the manifest.
import { createElement as h, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { clockToMinutes, media, parseMedia } from "@/lib/data/media";
import { I18nProvider } from "@/lib/i18n/client";
import type { Locale } from "@/lib/i18n/config";
import { getFormatter } from "@/lib/i18n/format";
import { messagesFor } from "@/lib/i18n/messages";
import { bento, CELLS, type Tile } from "./bento";
import { Gallery } from "./Gallery";
import { matches } from "./filter";
import { mmss, VideoPlayer } from "./VideoPlayer";
import { buildGalleryView, EVENING_FROM, filtersOf } from "./view";

vi.mock("next/navigation", () => ({ usePathname: () => "/", notFound: () => { throw new Error("NEXT_NOT_FOUND"); } }));

const html = (el: ReactElement) => renderToStaticMarkup(el);
const provide = (locale: Locale, child: ReactElement) => h(I18nProvider, { locale, messages: messagesFor(locale, ["common", "gallery"]), children: child });
const count = (s: string, re: RegExp) => (s.match(re) ?? []).length;

/** Cells of a tile on a grid with `cols` columns (the two-column grid shrinks the four-column sizes). */
const cellsOn = (t: Tile, cols: number): [number, number] => {
  const [w, hgt] = CELLS[t.size];
  return cols === 4 ? [w, hgt] : [Math.min(w, cols), t.size === "wide" ? 1 : t.size === "full" ? 2 : hgt];
};

/** Places tiles the way CSS grid does with `grid-auto-flow: row dense` (mirrored big tiles ask for column 3 in the four-column grid). */
function place(tiles: Tile[], cols: number): { rows: number; filled: boolean[][] } {
  const filled: boolean[][] = [];
  const free = (r: number, c: number, w: number, hh: number) => { for (let i = r; i < r + hh; i++) for (let j = c; j < c + w; j++) if (filled[i]?.[j]) return false; return j0(c, w); };
  const j0 = (c: number, w: number) => c + w <= cols;
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
      const { filled } = place(tiles, cols);
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
});

describe("view model", () => {
  for (const locale of ["cs", "en"] as const) {
    const view = buildGalleryView(media, locale);

    it(`has one item per still with the title and alt text of the manifest in ${locale}`, () => {
      expect(view.items).toHaveLength(media.stills.length);
      media.stills.forEach((s, i) => {
        expect(view.items[i].title).toBe(s.title[locale]);
        expect(view.items[i].alt).toBe(s.alt[locale]);
        expect(view.items[i].src).toBe(`/${s.file}`);
        expect(view.items[i].minutes).toBe(clockToMinutes(s.time));
      });
    });
  }

  const view = buildGalleryView(media, "en");
  it("offers all, each category that occurs and evening, with counts computed from the manifest", () => {
    expect(view.filters[0]).toEqual({ id: "all", count: media.stills.length });
    for (const f of view.filters) {
      const expected = media.stills.filter((s) => (f.id === "all" ? true : f.id === "evening" ? clockToMinutes(s.time) >= clockToMinutes(EVENING_FROM) : s.category === f.id)).length;
      expect(f.count).toBe(expected);
      expect(view.items.filter((i) => matches(i, f.id))).toHaveLength(expected);
    }
    const categories = view.filters.filter((f) => f.id !== "all" && f.id !== "evening");
    expect(categories.reduce((s, f) => s + f.count, 0)).toBe(media.stills.length);
    expect(new Set(view.filters.map((f) => f.id)).size).toBe(view.filters.length);
  });

  it("drops filters without stills", () => {
    const only = filtersOf([{ category: "exterior", evening: false }, { category: "exterior", evening: false }]);
    expect(only.map((f) => f.id)).toEqual(["all", "exterior"]);
    expect(filtersOf([{ category: "interior", evening: true }]).map((f) => f.id)).toEqual(["all", "interior", "evening"]);
  });

  it("carries the video only when the manifest has one", () => {
    expect(view.video === null).toBe(media.orbit.video === undefined);
    const withVideo = parseMedia({ ...structuredClone(JSON.parse(JSON.stringify(media))), orbit: { ...media.orbit, video: { file: "media/orbit/x.mp4", poster: media.stills[0].file, width: 1280, height: 720, fps: 24, durationS: 9.7 } } });
    const v = buildGalleryView(withVideo, "cs").video!;
    expect(v).toEqual({ src: "/media/orbit/x.mp4", poster: `/${media.stills[0].file}`, width: 1280, height: 720, durationS: 9.7 });
  });

  it("the video length is shown like the native player: whole seconds rounded down", () => {
    const f = getFormatter("cs");
    expect(mmss(f, 9.7)).toBe("0:09");
    expect(mmss(f, 75.2)).toBe("1:15");
    expect(mmss(f, 0)).toBe("0:00");
  });
});

describe.each(["cs", "en"] as const)("Gallery render (%s)", (locale) => {
  const view = buildGalleryView(media, locale);
  const out = html(provide(locale, h(Gallery, { view })));

  it("shows one tile per still, each a button with the picture's alt text and its real size", () => {
    expect(count(out, /class="gal-item"/g)).toBe(view.items.length);
    for (const it of view.items) {
      expect(out).toContain(`src="${it.src}"`);
      expect(out).toContain(`width="${it.width}" height="${it.height}"`);
    }
    expect(count(out, /<img /g)).toBe(view.items.length);
    expect(count(out, /loading="eager"/g)).toBeLessThanOrEqual(3);
    expect(count(out, /loading="lazy"/g)).toBe(Math.max(0, view.items.length - 3));
  });

  it("has a chip per filter (the first one pressed) and no open dialog", () => {
    expect(count(out, /class="chip"/g)).toBe(view.filters.length);
    expect(count(out, /aria-pressed="true"/g)).toBe(1);
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
  const video = { src: "/media/orbit/x.mp4", poster: "/media/stills/p.jpg", width: 1280, height: 720, durationS: 9.7 };
  const out = html(provide(locale, h(VideoPlayer, { video })));

  it("is built for iPhone: inline playback, metadata only, poster, no native controls until the first tap", () => {
    expect(out).toMatch(/playsinline=""/i);
    expect(out).toContain('preload="metadata"');
    expect(out).toContain(`poster="${video.poster}"`);
    expect(out).toContain(`src="${video.src}"`);
    expect(out).not.toMatch(/<video[^>]*controls/);
  });

  it("reserves the box of the video (no layout shift) and has a named play button with the length from the manifest", () => {
    expect(out).toContain("aspect-ratio:1280 / 720");
    expect(out).toMatch(/<button[^>]*class="gal-play"[^>]*aria-label="[^"]*0:09/);
    expect(out).toContain("0:09");
  });

  it("the gallery shows the video block when its view has a video", () => {
    const view = { ...buildGalleryView(media, locale), video };
    expect(html(provide(locale, h(Gallery, { view })))).toContain("gal-video");
  });
});
