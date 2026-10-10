// Scroll -> frame -> time, caption windows, load order and memory rules of the start page sequences.
import { describe, expect, it } from "vitest";
import { localToUtc, placeOf, sunTimes } from "@/lib/calc/sun";
import { dayDate, dayMinutes, media } from "@/lib/data/media";
import { house } from "@/lib/model/instance";
import {
  canvasScale, captionIndex, coarseCount, coverRect, coverSource, decodeBudgetBytes, decodeWindow, evictions, frameAt, frameAtMinute, heldProgress, introFade, keepAllOrder, keepsAll, loadOrder, lruCapacity,
  minuteAtFrame, MOMENT_RAMP_FRAMES, momentOpacity, momentWindows, nearestDecoded, sectionProgress, smallVariantFits, windowOpacity,
} from "../timeline";

const minutes = dayMinutes();
const sun = sunTimes(placeOf(house), dayDate());
const first = minutes[0], last = minutes[minutes.length - 1];

describe("scroll to frame to time", () => {
  it("clamps progress to the scrollable distance", () => {
    expect(sectionProgress(0, 1000)).toBe(0);
    expect(sectionProgress(100, 1000)).toBe(0); // the section has not reached the top yet
    expect(sectionProgress(-500, 1000)).toBe(0.5);
    expect(sectionProgress(-5000, 1000)).toBe(1);
    expect(sectionProgress(-10, 0)).toBe(0);
  });

  it("maps progress onto the frames", () => {
    expect(frameAt(0, 30)).toBe(0);
    expect(frameAt(1, 30)).toBe(29);
    expect(frameAt(0.5, 31)).toBe(15);
    expect(frameAt(-1, 30)).toBe(0);
    expect(frameAt(2, 30)).toBe(29);
    expect(frameAt(0.5, 1)).toBe(0);
  });

  it("rests on the last frame for the held share at the end, and is unchanged without a hold", () => {
    for (let k = 0; k <= 100; k++) expect(heldProgress(k / 100, 0)).toBeCloseTo(k / 100, 12);
    expect(heldProgress(0, 0.1)).toBe(0);
    expect(heldProgress(0.9, 0.1)).toBeCloseTo(1, 12);
    expect(heldProgress(0.95, 0.1)).toBe(1);
    expect(heldProgress(1, 0.1)).toBe(1);
    let prev = -1;
    for (let k = 0; k <= 100; k++) { const v = heldProgress(k / 100, 0.1); expect(v).toBeGreaterThanOrEqual(prev); prev = v; }
    expect(heldProgress(0.5, 5)).toBeLessThanOrEqual(1); // an absurd hold is capped
  });

  it("interpolates minutes between frames, never the position of the sun", () => {
    for (let i = 0; i < minutes.length; i++) expect(minuteAtFrame(minutes, i)).toBe(minutes[i]);
    for (let i = 0; i + 1 < minutes.length; i++) {
      const mid = minuteAtFrame(minutes, i + 0.5);
      expect(mid).toBeCloseTo((minutes[i] + minutes[i + 1]) / 2, 9);
    }
    expect(minuteAtFrame(minutes, -3)).toBe(first);
    expect(minuteAtFrame(minutes, 999)).toBe(last);
    expect(minuteAtFrame([], 1)).toBe(0);
  });

  it("has a monotonic clock over the whole scroll", () => {
    let prev = -Infinity;
    for (let k = 0; k <= 400; k++) {
      const m = minuteAtFrame(minutes, frameAt(k / 400, minutes.length));
      expect(m).toBeGreaterThanOrEqual(prev);
      prev = m;
    }
  });

  it("inverts minuteAtFrame", () => {
    for (let k = 0; k <= 100; k++) {
      const f = (k / 100) * (minutes.length - 1);
      expect(frameAtMinute(minutes, minuteAtFrame(minutes, f))).toBeCloseTo(f, 9);
    }
    expect(frameAtMinute(minutes, first - 60)).toBe(0);
    expect(frameAtMinute(minutes, last + 60)).toBe(minutes.length - 1);
  });
});

describe("caption windows", () => {
  const windows = momentWindows(sun, first, last);

  it("gives the four captions in time order for the day of the sequence", () => {
    expect(windows.map((w) => w.key)).toEqual(["morning", "noon", "evening", "afterSunset"]);
  });

  it("anchors them on the sun: noon around solar noon, evening before sunset, the last one after it", () => {
    const by = Object.fromEntries(windows.map((w) => [w.key, w]));
    const noon = sun.solarNoon * 60, set = sun.sunset! * 60;
    expect(by.noon.from).toBeLessThan(noon);
    expect(by.noon.to).toBeGreaterThan(noon);
    expect(by.evening.to).toBeLessThan(set);
    expect(by.afterSunset.from).toBeGreaterThan(set);
  });

  it("never overlaps and stays inside the sequence (plus the ramp after the last frame)", () => {
    for (let i = 0; i < windows.length; i++) {
      expect(windows[i].from).toBeLessThan(windows[i].to);
      if (i) expect(windows[i].from).toBeGreaterThanOrEqual(windows[i - 1].to);
    }
    expect(windows[0].from).toBeGreaterThanOrEqual(first);
    expect(windows[windows.length - 1].from).toBeLessThan(last + 40);
  });

  it("shows exactly one caption at a time and every caption at some frame", () => {
    const shown = new Set<string>();
    for (let m = first; m <= last; m += 5) {
      const visible = windows.filter((w) => windowOpacity(m, w) > 0);
      expect(visible.length).toBeLessThanOrEqual(1);
      visible.forEach((w) => shown.add(w.key));
    }
    expect([...shown].sort()).toEqual(windows.map((w) => w.key).sort());
  });

  it("drops what the sky does not offer: no sunset, no evening captions", () => {
    const polar = momentWindows({ sunrise: null, solarNoon: 12, sunset: null }, 8 * 60, 22 * 60);
    expect(polar.map((w) => w.key)).toEqual(["morning", "noon"]);
  });

  it("drops windows outside the sequence", () => {
    const short = momentWindows({ sunrise: 5, solarNoon: 12, sunset: 21 }, 14 * 60, 16 * 60);
    expect(short.every((w) => w.to > 14 * 60 && w.from < 16 * 60 + 40)).toBe(true);
  });

  it("fades in and out over the ramp", () => {
    const w = { from: 100, to: 300 };
    expect(windowOpacity(99, w)).toBe(0);
    expect(windowOpacity(100, w)).toBe(0);
    expect(windowOpacity(112.5, w)).toBeCloseTo(0.5, 9);
    expect(windowOpacity(200, w)).toBe(1);
    expect(windowOpacity(300, w)).toBe(0);
    expect(windowOpacity(301, w)).toBe(0);
    for (let d = 0; d <= 50; d += 5) expect(windowOpacity(100 + d, w)).toBeCloseTo(windowOpacity(300 - d, w), 9);
  });
});

describe("caption opacity over the scroll (momentOpacity)", () => {
  const windows = momentWindows(sun, first, last);
  const lastFrame = minutes.length - 1;
  const STEP = 0.05;

  it("shows at most one caption at a time and every caption fully at some frame", () => {
    const full = new Set<string>();
    for (let f = 0; f <= lastFrame + 1e-9; f += STEP) {
      const os = windows.map((w) => momentOpacity(f, w, minutes));
      expect(os.filter((o) => o > 0).length).toBeLessThanOrEqual(1);
      windows.forEach((w, i) => { if (os[i] >= 1) full.add(w.key); });
    }
    expect([...full].sort()).toEqual(windows.map((w) => w.key).sort());
  });

  it("keeps the last caption (the end of the day and its link) fully visible on the last frame", () => {
    const end = windows[windows.length - 1];
    expect(momentOpacity(lastFrame, end, minutes)).toBe(1);
    windows.slice(0, -1).forEach((w) => expect(momentOpacity(lastFrame, w, minutes)).toBe(0));
  });

  it("fades over the same scroll distance wherever the frames are in time, never longer than the ramp", () => {
    for (const w of windows.slice(0, -1)) {
      const a = frameAtMinute(minutes, w.from), b = frameAtMinute(minutes, w.to);
      let rising = 0;
      for (let f = a; f <= b; f += STEP) { const o = momentOpacity(f, w, minutes); if (o > 0 && o < 1 && f < (a + b) / 2) rising += STEP; }
      expect(rising).toBeLessThanOrEqual(MOMENT_RAMP_FRAMES + STEP);
      expect(momentOpacity((a + b) / 2, w, minutes)).toBe(1);
    }
  });

  it("works for a sequence with other times too (hourly by day, every 10 minutes at dusk)", () => {
    const times: number[] = [];
    for (let m = 8 * 60; m <= 15 * 60; m += 60) times.push(m);
    for (let m = 16 * 60; m <= 19 * 60 + 40; m += 20) times.push(m);
    for (let m = 19 * 60 + 50; m <= 21 * 60 + 40; m += 10) times.push(m);
    const ws = momentWindows(sun, times[0], times[times.length - 1]);
    const full = new Set<string>();
    for (let f = 0; f <= times.length - 1 + 1e-9; f += STEP) {
      const os = ws.map((w) => momentOpacity(f, w, times));
      expect(os.filter((o) => o > 0).length).toBeLessThanOrEqual(1);
      ws.forEach((w, i) => { if (os[i] >= 1) full.add(w.key); });
    }
    expect(full.size).toBe(ws.length);
    expect(momentOpacity(times.length - 1, ws[ws.length - 1], times)).toBe(1);
  });

  it("is zero outside a closed window and symmetric inside it", () => {
    const m = [0, 60, 120, 180, 240, 300];
    const w = { from: 60, to: 240 }; // frames 1..4
    expect(momentOpacity(0.9, w, m)).toBe(0);
    expect(momentOpacity(4.1, w, m)).toBe(0);
    expect(momentOpacity(2.5, w, m)).toBe(1);
    for (let d = 0; d <= 1; d += 0.1) expect(momentOpacity(1 + d, w, m)).toBeCloseTo(momentOpacity(4 - d, w, m), 9);
    // an open window (reaching the last frame) never fades out
    expect(momentOpacity(5, { from: 240, to: 400 }, m)).toBe(1);
    expect(momentOpacity(5, { from: 300, to: 400 }, m)).toBe(1);
  });
});

describe("intro fade", () => {
  it("only ever fades out as the scroll advances, and the low-screen title goes first", () => {
    let slow = 2, fast = 2;
    for (let k = 0; k <= 100; k++) {
      const f = introFade(k / 100, false);
      expect(f.slow).toBeLessThanOrEqual(slow);
      expect(f.fast).toBeLessThanOrEqual(f.slow);
      expect(f.fast).toBeLessThanOrEqual(fast);
      slow = f.slow;
      fast = f.fast;
    }
    expect(introFade(0, false)).toEqual({ slow: 1, fast: 1, afterSlow: 0, afterFast: 0 });
    expect(introFade(1, false).slow).toBe(0);
  });

  it("never stands a caption over the title: it starts when the title is mostly gone and is whole once it has gone", () => {
    for (let k = 0; k <= 400; k++) {
      const f = introFade(k / 400, false);
      // the caption factor grows as the title fades and is zero while the title is still clearly there
      if (f.slow >= 0.4) expect(f.afterSlow).toBe(0);
      if (f.fast >= 0.4) expect(f.afterFast).toBe(0);
      if (f.slow === 0) expect(f.afterSlow).toBe(1);
      if (f.fast === 0) expect(f.afterFast).toBe(1);
      expect(f.afterFast).toBeGreaterThanOrEqual(f.afterSlow);
    }
  });

  it("lets the title leave within the first tenth of the sequence, so the morning caption has room", () => {
    expect(introFade(0.1, false).slow).toBe(0);
    expect(introFade(0.1, false).afterSlow).toBe(1);
  });

  it("keeps the title for the still frame", () => {
    expect(introFade(0.9, true)).toEqual({ slow: 1, fast: 1, afterSlow: 1, afterFast: 1 });
  });
});

describe("orbit captions", () => {
  it("spreads the captions evenly over the turn", () => {
    expect([0, 0.24, 0.25, 0.49, 0.5, 0.74, 0.75, 1].map((p) => captionIndex(p, 4))).toEqual([0, 0, 1, 1, 2, 2, 3, 3]);
    expect(captionIndex(0.5, 0)).toBe(0);
    expect(captionIndex(5, 3)).toBe(2);
  });
});

describe("loading and memory", () => {
  it.each([1, 2, 7, 30, 60, 61])("fetches each of %i frames exactly once, coarse to fine", (n) => {
    const order = loadOrder(n);
    expect([...order].sort((a, b) => a - b)).toEqual(Array.from({ length: n }, (_, i) => i));
    if (n > 1) expect(order[0]).toBe(0);
    if (n > 2) expect(order[1]).toBe(n - 1); // the last frame early
  });

  it.each([1, 2, 7, 8, 9, 30, 60, 61])("counts the coarse pass of %i frames: exactly the frames before the first 4th-frame step", (n) => {
    const order = loadOrder(n);
    const k = coarseCount(n);
    const coarse = order.slice(0, k);
    expect(new Set(coarse).size).toBe(k);
    // every 8th frame and the last one, nothing else
    expect([...coarse].sort((a, b) => a - b)).toEqual([...new Set([...Array.from({ length: Math.ceil(n / 8) }, (_, i) => i * 8), n - 1])].sort((a, b) => a - b));
    expect(coarseCount(0)).toBe(0);
  });

  it("uses the small variant only where it is sharp enough (cover, at most 2 device pixels per CSS pixel)", () => {
    const full = { width: 1920, height: 1080 }, small = { width: 960 };
    expect(smallVariantFits(1440, 900, 1, full, small)).toBe(false);
    expect(smallVariantFits(900, 500, 1, full, small)).toBe(true);
    expect(smallVariantFits(900, 500, 2, full, small)).toBe(false);
    // a tall window needs the width that covers its height
    expect(smallVariantFits(500, 900, 1, full, small)).toBe(false);
    // a 3x phone counts as 2x
    expect(smallVariantFits(480, 270, 3, full, small)).toBe(smallVariantFits(480, 270, 2, full, small));
  });

  it("starts with every 8th frame, then every 4th", () => {
    const order = loadOrder(60);
    const rest = order.filter((i) => i !== 59);
    const firstEights = rest.slice(0, 8);
    expect(firstEights).toEqual([0, 8, 16, 24, 32, 40, 48, 56]);
    expect(rest.slice(8, 15).every((i) => i % 4 === 0)).toBe(true);
  });

  it("finds the nearest decoded frame, the earlier one on a tie", () => {
    const has = (set: number[]) => (k: number) => set.includes(k);
    expect(nearestDecoded(5, has([5]), 10)).toBe(5);
    expect(nearestDecoded(5, has([3, 7]), 10)).toBe(3);
    expect(nearestDecoded(5, has([8]), 10)).toBe(8);
    expect(nearestDecoded(5, has([]), 10)).toBe(-1);
  });

  it("sizes the bitmap cache by memory, never below a working window and never above the cap", () => {
    const MB = 1024 * 1024;
    const phone = decodeBudgetBytes({ coarse: true });
    const desktop = decodeBudgetBytes({ coarse: false });
    expect(phone).toBeLessThan(desktop);
    expect(decodeBudgetBytes({ coarse: false, deviceMemoryGb: 1 })).toBeLessThan(desktop);
    // a decoded 1920 x 1080 landscape frame is about 8 MB, a 800 x 1200 portrait one about 3.7 MB
    expect(lruCapacity(1920, 1080, phone)).toBeLessThan(lruCapacity(1920, 1080, desktop));
    // a phone gets portrait frames, and those fit the budget
    expect(lruCapacity(800, 1200, phone) * 800 * 1200 * 4).toBeLessThanOrEqual(phone);
    expect(lruCapacity(800, 1200, phone)).toBeGreaterThanOrEqual(5);
    // frames that are huge for the budget still get the working window of five (the blend needs the neighbours)
    expect(lruCapacity(1920, 1080, phone)).toBe(5);
    expect(lruCapacity(7680, 4320, 8 * MB)).toBe(5);
    expect(lruCapacity(10, 10, 1e12)).toBe(20);
  });

  it("evicts the frames farthest from the current one", () => {
    const dropped = evictions([1, 2, 3, 4, 5, 6], 3, 4);
    expect(dropped).toContain(6); // the single farthest
    expect(dropped).toHaveLength(2);
    expect(dropped.every((k) => Math.abs(k - 3) >= 2)).toBe(true);
    expect(evictions([1, 2, 3], 2, 5)).toEqual([]);
    expect(evictions([0, 10, 20], 0, 1).sort((a, b) => a - b)).toEqual([10, 20]);
    const keys = [3, 4, 5, 9, 12, 20];
    const drop = evictions(keys, 10, 3);
    expect(keys.filter((k) => !drop.includes(k))).toHaveLength(3);
    expect(keys.filter((k) => !drop.includes(k)).sort((a, b) => a - b)).toEqual([5, 9, 12]);
  });

  it("keeps the frames of the decode window over closer ones left behind", () => {
    // scrolling forward from 10: 12 and 13 are wanted, 8 and 9 are behind
    const drop = evictions([8, 9, 10, 11, 12, 13], 10, 4, [10, 11, 12, 13]);
    expect(drop.sort((a, b) => a - b)).toEqual([8, 9]);
  });

  it("decodes the current frame first, then ahead of the scroll direction, within the capacity", () => {
    // a cross-fade is anchored on the frame under the scroll position (i0): i0, i1 and the next one in the scroll direction first
    expect(decodeWindow(1, true, 6)).toEqual([0, 1, 2, -1, 3, -2]);
    expect(decodeWindow(-1, true, 6)).toEqual([0, 1, -1, -2, 2, -3]);
    expect(decodeWindow(1, false, 5)).toEqual([0, 1, 2, -1, 3]);
    expect(decodeWindow(1, true, 1)).toHaveLength(3); // never fewer than a cross-fade needs
    expect(decodeWindow(1, true, 99)).toHaveLength(7);
  });

  it("picks the part of a frame a cover-fitted canvas shows as the source rectangle of drawImage", () => {
    // a portrait phone: the 1080 x 1620 frame fills the height 1:1, the middle 729 px of its width show (drawn 1:1, no resampling)
    expect(coverSource(1080, 1620, 729, 1620)).toEqual({ sx: 175.5, sy: 0, sw: 729, sh: 1620 });
    // scaled down (canvas pixel = 2 frame pixels): the rectangle is in frame pixels
    expect(coverSource(1920, 1080, 480, 540)).toEqual({ sx: 480, sy: 0, sw: 960, sh: 1080 });
    // the same aspect: the whole frame; a wider canvas cuts top and bottom
    expect(coverSource(1920, 1080, 1280, 720)).toEqual({ sx: 0, sy: 0, sw: 1920, sh: 1080 });
    expect(coverSource(1920, 1080, 1920, 800)).toEqual({ sx: 0, sy: 140, sw: 1920, sh: 800 });
    expect(coverSource(1920, 1080, 0, 0)).toEqual({ sx: 0, sy: 0, sw: 1920, sh: 1080 });
    // the same picture as the whole frame drawn at coverRect: the rectangle maps onto the canvas exactly
    for (const [iw, ih, cw, ch] of [[1080, 1620, 747, 1620], [1920, 1080, 1440, 1100], [960, 540, 375, 812], [1080, 1620, 1206, 2622]]) {
      const s = coverSource(iw, ih, cw, ch), r = coverRect(iw, ih, cw, ch), k = r.w / iw;
      expect(s.sx).toBeGreaterThanOrEqual(0);
      expect(s.sy).toBeGreaterThanOrEqual(0);
      expect(s.sx + s.sw).toBeLessThanOrEqual(iw + 1e-9);
      expect(s.sy + s.sh).toBeLessThanOrEqual(ih + 1e-9);
      expect(r.x + s.sx * k).toBeCloseTo(0, 6);
      expect(r.y + s.sy * k).toBeCloseTo(0, 6);
      expect(s.sw * k).toBeCloseTo(cw, 6);
      expect(s.sh * k).toBeCloseTo(ch, 6);
    }
  });

  it("keeps every decoded frame of portrait or narrow frames only", () => {
    expect(keepsAll({ width: 1080, height: 1620 })).toBe(true); // phone portrait
    expect(keepsAll({ width: 960, height: 540 })).toBe(true); // small landscape copy
    expect(keepsAll({ width: 1600, height: 900 })).toBe(true);
    expect(keepsAll({ width: 1920, height: 1080 })).toBe(false); // desktop landscape keeps the window
    expect(keepsAll({ width: 1080, height: 1620 }, 2)).toBe(false); // too little memory
    expect(keepsAll({ width: 1080, height: 1620 }, 4)).toBe(true);
  });

  it("orders the decodes of a kept sequence: the window first, then outward, ahead in the scroll direction first", () => {
    expect(keepAllOrder(10, 16, [10, 11, 12, 9])).toEqual([10, 11, 12, 9, 8, 13, 7, 14, 6, 15, 5, 4, 3, 2, 1, 0]);
    expect(keepAllOrder(10, 16, [10, 11, 9, 8], -1)).toEqual([10, 11, 9, 8, 12, 7, 13, 6, 14, 5, 15, 4, 3, 2, 1, 0]);
    expect(keepAllOrder(0, 5, [0, 1, 2])).toEqual([0, 1, 2, 3, 4]);
    expect(keepAllOrder(4, 5, [4], -1)).toEqual([4, 3, 2, 1, 0]);
    for (const [cur, dir] of [[0, 1], [7, -1], [31, 1], [15, -1]] as const) {
      const o = keepAllOrder(cur, 32, [cur, cur + 1, cur - 1].filter((i) => i >= 0 && i < 32), dir);
      expect([...o].sort((x, y) => x - y)).toEqual(Array.from({ length: 32 }, (_, i) => i)); // every frame, once
    }
  });

  it("limits the canvas to what the frame can show", () => {
    expect(canvasScale(1440, 900, 2, 1920, 1080)).toBeCloseTo(1080 / 900, 9); // a 1920 x 1080 frame covers 1440 x 900 with 1.2 px per CSS px
    expect(canvasScale(393, 852, 3, 800, 1200)).toBeCloseTo(1200 / 852, 9); // an iPhone at 3x needs only 1.41
    expect(canvasScale(393, 852, 1, 800, 1200)).toBe(1);
    expect(canvasScale(2000, 1200, 2, 1000, 600)).toBe(1); // never below 1
    expect(canvasScale(100, 100, 3, 4000, 4000)).toBe(2); // never above 2
  });

  it("draws an image so that it covers the canvas and stays centred", () => {
    for (const [iw, ih, cw, ch] of [[1920, 1080, 393, 852], [800, 1200, 1440, 900], [1000, 1000, 500, 500]]) {
      const r = coverRect(iw, ih, cw, ch);
      expect(r.w).toBeGreaterThanOrEqual(cw - 1e-9);
      expect(r.h).toBeGreaterThanOrEqual(ch - 1e-9);
      expect(r.x + r.w / 2).toBeCloseTo(cw / 2, 9);
      expect(r.y + r.h / 2).toBeCloseTo(ch / 2, 9);
      expect(r.w / r.h).toBeCloseTo(iw / ih, 9);
    }
  });
});

describe("with the real manifest and place", () => {
  it("has a sun time for the date and frames that bracket the day's key moments", () => {
    expect(media.day.times.length).toBeGreaterThan(8);
    expect(sun.sunrise).not.toBeNull();
    expect(sun.sunset).not.toBeNull();
    expect(first / 60).toBeLessThan(sun.solarNoon);
    expect(last / 60).toBeGreaterThan(sun.sunset!);
    expect(localToUtc(placeOf(house).tz, dayDate(), 12)).toBeGreaterThan(0);
  });
});
