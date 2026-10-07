// Pure rules of the scroll sequences on the home page: scroll position -> frame -> time of day, the windows of the day captions
// (anchored on the sun times of the place, never on fixed minutes), the fade of the intro, which frames to fetch first and which
// decoded frames to keep. No DOM, no React: everything here is covered by unit tests.

export const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

// ------------------------------------------------------------------------------------------------ scroll -> frame -> time

/**
 * Progress 0..1 of a pinned section from the viewport position of its top edge. `scrollable` is the distance the sticky frame
 * travels: the section height minus the height of the sticky frame itself (the same unit, so a collapsing browser bar cannot
 * make progress reach 1 before the frame is released).
 */
export const sectionProgress = (top: number, scrollable: number): number => (scrollable <= 0 ? 0 : clamp01((0 - top) / scrollable));

/** Fractional frame index of a progress value. */
export const frameAt = (progress: number, count: number): number => clamp01(progress) * Math.max(0, count - 1);

/**
 * Time of day (minutes) shown at a fractional frame index. The frames are unevenly spaced in time (denser around dusk), so the
 * clock interpolates MINUTES between the two frames, not the position of the sun.
 */
export function minuteAtFrame(minutes: readonly number[], frame: number): number {
  const last = minutes.length - 1;
  if (last < 0) return 0;
  const f = Math.min(last, Math.max(0, frame));
  const i = Math.min(last, Math.floor(f));
  const next = Math.min(last, i + 1);
  return minutes[i] + (minutes[next] - minutes[i]) * (f - i);
}

/** Inverse of `minuteAtFrame`: the fractional frame that shows a minute of the day (clamped to the sequence). */
export function frameAtMinute(minutes: readonly number[], minute: number): number {
  const last = minutes.length - 1;
  if (last <= 0 || minute <= minutes[0]) return 0;
  if (minute >= minutes[last]) return last;
  let i = 0;
  while (minutes[i + 1] < minute) i++;
  return i + (minute - minutes[i]) / (minutes[i + 1] - minutes[i]);
}

// ------------------------------------------------------------------------------------------------ day captions

export const MOMENT_KEYS = ["morning", "noon", "evening", "afterSunset"] as const;
export type MomentKey = (typeof MOMENT_KEYS)[number];
export interface MomentWindow {
  key: MomentKey;
  /** Minutes since midnight in which the caption is visible. */
  from: number;
  to: number;
}

/** Sun times of the day as wall-clock hours (the shape of `sunTimes` in calc/sun.ts); null when the sun does not rise or set. */
export interface SunHours {
  sunrise: number | null;
  solarNoon: number;
  sunset: number | null;
}

/** Margins around the key moments, minutes. */
const MORNING_END_BEFORE_NOON = 100;
const NOON_BEFORE = 60;
const NOON_AFTER = 75;
const EVENING_BEFORE_SUNSET = 210;
const EVENING_END_BEFORE_SUNSET = 30;
const DUSK_AFTER_SUNSET = 15;
const DUSK_EXTRA_AFTER_LAST = 40;

/**
 * Windows of the four captions for a sequence that runs from `first` to `last` (minutes). Morning starts with the first frame,
 * noon is centred on solar noon, the evening ends shortly before sunset, and "after sunset" runs to the end. Windows that do not
 * intersect the sequence are dropped (a polar day has no sunset); the remaining ones never overlap and are in time order.
 */
export function momentWindows(sun: SunHours, first: number, last: number): MomentWindow[] {
  const noon = sun.solarNoon * 60;
  const raw: MomentWindow[] = [
    { key: "morning", from: first, to: noon - MORNING_END_BEFORE_NOON },
    { key: "noon", from: noon - NOON_BEFORE, to: noon + NOON_AFTER },
  ];
  if (sun.sunset !== null) {
    const set = sun.sunset * 60;
    raw.push(
      { key: "evening", from: set - EVENING_BEFORE_SUNSET, to: set - EVENING_END_BEFORE_SUNSET },
      { key: "afterSunset", from: set + DUSK_AFTER_SUNSET, to: last + DUSK_EXTRA_AFTER_LAST },
    );
  }
  const out: MomentWindow[] = [];
  for (const w of raw) {
    const from = Math.max(w.from, out.length ? out[out.length - 1].to : -Infinity);
    const to = w.to;
    if (to <= first || from >= last + DUSK_EXTRA_AFTER_LAST || to - from < 20) continue;
    out.push({ key: w.key, from, to });
  }
  return out;
}

/** Opacity of a caption at a time of day: zero outside its window, rising to 1 over `ramp` minutes from either edge. */
export function windowOpacity(minute: number, w: Pick<MomentWindow, "from" | "to">, ramp = 25): number {
  if (minute < w.from || minute > w.to) return 0;
  return clamp01(Math.min(minute - w.from, w.to - minute) / ramp);
}

// ------------------------------------------------------------------------------------------------ intro fade

/** Scroll distance (as a fraction of the sequence) over which the title leaves; shorter on low screens. */
const TITLE_FADE_SLOW = 9;
const TITLE_FADE_FAST = 24;

export interface IntroFade {
  /** Opacity factor of the title block on normal screens and on low ones. */
  slow: number;
  fast: number;
  /** 0..1: a caption on a low screen appears only after the title has gone. */
  after: number;
}

/** The still frame (reduced motion) keeps the title and shows no captions. */
export function introFade(progress: number, still: boolean): IntroFade {
  if (still) return { slow: 1, fast: 1, after: 1 };
  return {
    slow: Math.max(0, 1 - progress * TITLE_FADE_SLOW),
    fast: Math.max(0, 1 - progress * TITLE_FADE_FAST),
    after: clamp01((progress * TITLE_FADE_FAST - 1) * 2),
  };
}

// ------------------------------------------------------------------------------------------------ orbit captions

/** Which of `count` captions is active at a progress value (equal parts of the turn). */
export const captionIndex = (progress: number, count: number): number => (count <= 0 ? 0 : Math.min(count - 1, Math.floor(clamp01(progress) * count)));

// ------------------------------------------------------------------------------------------------ loading and memory

/**
 * Order in which frames are fetched: coarse to fine (every 8th, then every 4th, 2nd, then all) with the last frame early, so
 * the whole range is usable long before every frame has arrived.
 */
export function loadOrder(count: number, steps: readonly number[] = [8, 4, 2, 1]): number[] {
  const seen = new Set<number>();
  const order: number[] = [];
  const push = (i: number) => { if (i >= 0 && i < count && !seen.has(i)) { seen.add(i); order.push(i); } };
  for (const step of steps) for (let i = 0; i < count; i += step) push(i);
  if (count > 1 && order.indexOf(count - 1) > 1) {
    order.splice(order.indexOf(count - 1), 1);
    order.splice(1, 0, count - 1);
  }
  return order;
}

/** The decoded frame nearest to `i` (ties go to the earlier one), or -1 when none is decoded. */
export function nearestDecoded(i: number, has: (k: number) => boolean, count: number): number {
  for (let d = 0; d < count; d++) {
    if (has(i - d)) return i - d;
    if (has(i + d)) return i + d;
  }
  return -1;
}

/** How many decoded frames (RGBA bitmaps) fit a memory budget; clamped so a window of neighbours always fits. */
export function lruCapacity(width: number, height: number, budgetBytes: number, min = 5, max = 20): number {
  const bytes = Math.max(1, width * height * 4);
  return Math.max(min, Math.min(max, Math.floor(budgetBytes / bytes)));
}

/** Memory budget for decoded frames: small on touch phones and tablets and on devices that report little memory. */
export function decodeBudgetBytes(opts: { coarse: boolean; deviceMemoryGb?: number }): number {
  const MB = 1024 * 1024;
  let budget = opts.coarse ? 32 * MB : 128 * MB;
  if (opts.deviceMemoryGb !== undefined && opts.deviceMemoryGb <= 2) budget = Math.min(budget, 24 * MB);
  return budget;
}

/** Keys to drop so that at most `capacity` remain: the ones farthest from the current frame go first. */
export function evictions(keys: Iterable<number>, current: number, capacity: number): number[] {
  const sorted = [...keys].sort((a, b) => Math.abs(b - current) - Math.abs(a - current) || b - a);
  return sorted.slice(0, Math.max(0, sorted.length - capacity));
}

/**
 * Device pixel ratio for the canvas: never above 2 and never finer than the source frame needs (a 1920 px frame shown 1440 px
 * wide needs 1.33, not 2), at least 1.
 */
export function canvasScale(cssWidth: number, cssHeight: number, dpr: number, frameWidth: number, frameHeight: number): number {
  const shown = Math.max(cssWidth / frameWidth, cssHeight / frameHeight); // CSS pixels per frame pixel (cover)
  const needed = shown > 0 ? 1 / shown : 1;
  return Math.max(1, Math.min(2, dpr, needed));
}

/** Source and destination rectangle of an image drawn "cover" into a canvas. */
export function coverRect(imageW: number, imageH: number, canvasW: number, canvasH: number): { x: number; y: number; w: number; h: number } {
  const s = Math.max(canvasW / imageW, canvasH / imageH);
  const w = imageW * s, h = imageH * s;
  return { x: (canvasW - w) / 2, y: (canvasH - h) / 2, w, h };
}
