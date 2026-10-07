// Scroll -> frame -> time, caption windows, load order and memory rules of the start page sequences.
import { describe, expect, it } from "vitest";
import { localToUtc, placeOf, sunTimes } from "@/lib/calc/sun";
import { dayDate, dayMinutes, media } from "@/lib/data/media";
import { house } from "@/lib/model/instance";
import {
  canvasScale, captionIndex, coverRect, decodeBudgetBytes, evictions, frameAt, frameAtMinute, introFade, loadOrder, lruCapacity, minuteAtFrame,
  momentWindows, nearestDecoded, sectionProgress, windowOpacity,
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
    expect(introFade(0, false)).toEqual({ slow: 1, fast: 1, after: 0 });
    expect(introFade(1, false).slow).toBe(0);
  });

  it("lets a caption start only after the low-screen title has gone", () => {
    expect(introFade(0.02, false).after).toBe(0);
    expect(introFade(0.1, false).after).toBe(1);
    const f = introFade(0.05, false);
    expect(f.after).toBeGreaterThan(0);
    expect(f.fast).toBe(0);
  });

  it("keeps the title for the still frame", () => {
    expect(introFade(0.9, true)).toEqual({ slow: 1, fast: 1, after: 1 });
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
