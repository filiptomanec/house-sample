// Pure rules of the scroll sequences on the home page: scroll position -> frame -> time of day, the windows of the day captions
// (anchored on the sun times of the place, never on fixed minutes), the fade of the intro, the orbit captions (bound to the camera
// azimuth), which frames to fetch first and which decoded frames to keep. No DOM, no React: everything here is covered by unit tests.

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
 * Progress of the frames when the last `hold` share of the scroll rests on the last frame (0..1 in, 0..1 out): the sequence
 * reaches its end early and stays there, so its last caption and link can be read before the section scrolls away.
 */
export function heldProgress(progress: number, hold: number): number {
  const h = Math.min(0.9, Math.max(0, hold));
  return h === 0 ? clamp01(progress) : clamp01(progress / (1 - h));
}

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
const MORNING_END_BEFORE_NOON = 60;
const NOON_BEFORE = 60;
const NOON_AFTER = 150;
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

/**
 * Opacity of a caption at a time of day: zero outside its window, rising to 1 over `ramp` minutes from either edge.
 * @deprecated The hero fades its captions over a scroll distance (`momentOpacity`): the frames are denser in time at dusk, so a
 * ramp in minutes is abrupt at noon and drags at dusk, and the last caption never reached full opacity.
 */
export function windowOpacity(minute: number, w: Pick<MomentWindow, "from" | "to">, ramp = 25): number {
  if (minute < w.from || minute > w.to) return 0;
  return clamp01(Math.min(minute - w.from, w.to - minute) / ramp);
}

/** Frames (of scroll) over which a day caption fades in and out. */
export const MOMENT_RAMP_FRAMES = 1;
/** A ramp never takes more than this share of a closed window, nor more than OPEN_RAMP_SHARE of the last (open) one. */
const RAMP_SHARE = 0.4;
const OPEN_RAMP_SHARE = 0.7;

/**
 * Opacity of a day caption at a fractional frame. The window (minutes) is mapped onto the frames, and the caption fades in and
 * out over `ramp` frames of scroll (at most 40 % of the window), so a fade feels the same at noon and at dusk. A window that
 * reaches the last frame is open: it never fades out, so the end of the day (and its link) stays on screen to the end.
 */
export function momentOpacity(frame: number, w: Pick<MomentWindow, "from" | "to">, minutes: readonly number[], ramp = MOMENT_RAMP_FRAMES): number {
  const last = minutes.length - 1;
  if (last < 0) return 0;
  const a = frameAtMinute(minutes, w.from), b = frameAtMinute(minutes, w.to);
  const open = w.to >= minutes[last];
  if (frame < a || (!open && frame > b) || (!open && b <= a)) return 0;
  if (open && frame >= last) return 1;
  const r =Math.max(1e-6, Math.min(ramp, (b - a) * (open ? OPEN_RAMP_SHARE : RAMP_SHARE)));
  const rise = (frame - a) / r;
  return clamp01(open ? rise : Math.min(rise, (b - frame) / r));
}

// ------------------------------------------------------------------------------------------------ intro fade

/** Scroll distance (as a fraction of the sequence) over which the title leaves: 1/16 of it, 1/24 on low screens. */
const TITLE_FADE_SLOW = 16;
const TITLE_FADE_FAST = 24;
/** A caption starts only when the title is less than 1/CAPTION_GATE visible, and is whole once the title has gone. */
const CAPTION_GATE = 2.5;

export interface IntroFade {
  /** Opacity factor of the title block on normal screens and on low ones. */
  slow: number;
  fast: number;
  /** 0..1 factor of a caption on normal and on low screens: the two text blocks never stand over each other. */
  afterSlow: number;
  afterFast: number;
}

/** The caption factor for a title opacity. */
const gate = (title: number): number => clamp01(1 - title * CAPTION_GATE);

/** The still frame (reduced motion) keeps the title, and its captions are listed under the picture (factor 1). */
export function introFade(progress: number, still: boolean): IntroFade {
  if (still) return { slow: 1, fast: 1, afterSlow: 1, afterFast: 1 };
  const slow = Math.max(0, 1 - progress * TITLE_FADE_SLOW);
  const fast = Math.max(0, 1 - progress * TITLE_FADE_FAST);
  return { slow, fast, afterSlow: gate(slow), afterFast: gate(fast) };
}

// ------------------------------------------------------------------------------------------------ orbit captions

/**
 * Which of `count` captions is active at a progress value (equal parts of the turn).
 * @deprecated The orbit binds its captions to the camera azimuth (`captionAt`); equal parts name features that are out of view.
 */
export const captionIndex = (progress: number, count: number): number => (count <= 0 ? 0 : Math.min(count - 1, Math.floor(clamp01(progress) * count)));

/** An angle in degrees brought into 0..360. */
export const mod360 = (a: number): number => ((a % 360) + 360) % 360;

/** Signed difference a - b of two azimuths, -180..180. */
export function angleDiff(a: number, b: number): number {
  const d = mod360(a - b);
  return d > 180 ? d - 360 : d;
}

/** Circular mean of azimuths (degrees, 0..360); the first one when they cancel out. */
export function meanAzimuth(azimuths: readonly number[]): number {
  let x = 0, y = 0;
  for (const a of azimuths) { x += Math.sin((a * Math.PI) / 180); y += Math.cos((a * Math.PI) / 180); }
  return Math.hypot(x, y) < 1e-9 ? mod360(azimuths[0] ?? 0) : mod360((Math.atan2(x, y) * 180) / Math.PI);
}

/** House azimuth (clockwise from +y) of a point seen from a centre: the convention of the render cameras. */
export const azimuthOf = (from: readonly [number, number], to: readonly [number, number]): number =>
  mod360((Math.atan2(to[0] - from[0], to[1] - from[1]) * 180) / Math.PI);

/** Where the orbit camera starts and which way it turns: the media manifest (`orbit`), falling back to the render settings. */
export interface OrbitPath {
  /** House azimuth of the camera at frame 0, seen from the orbit centre. */
  startAzimuthDeg: number;
  direction: "clockwise" | "counterclockwise";
  /** Degrees between two scroll frames. */
  degPerFrame: number;
  /** Half the window (degrees of azimuth) in which a caption shows; CAPTION_HALF_WINDOW when not given. */
  halfWindowDeg?: number;
}

/** House azimuth of the camera at a (fractional) scroll frame. */
export const orbitAzimuthAt = (frame: number, o: OrbitPath): number =>
  mod360(o.startAzimuthDeg + (o.direction === "clockwise" ? 1 : -1) * o.degPerFrame * frame);

/**
 * A caption is shown while the camera is at most this far (degrees of azimuth) from the best view of its feature, unless the
 * orbit says otherwise (`OrbitPath.halfWindowDeg`: render.json `orbit.captions.halfWindowDeg`, the window the render pipeline
 * keeps free of trees).
 */
export const CAPTION_HALF_WINDOW = 50;

/**
 * The caption of the orbit at a frame: the feature whose best view (`az`, a house azimuth seen from the orbit centre) is
 * nearest to the camera, when it is within `maxDeg`; -1 between features. So a caption never names something on the far side.
 */
export function captionAt(frame: number, caps: readonly { az: number }[], o: OrbitPath, maxDeg = o.halfWindowDeg ?? CAPTION_HALF_WINDOW): number {
  const cam = orbitAzimuthAt(frame, o);
  let best = -1, bestD = Infinity;
  caps.forEach((c, i) => {
    const d = Math.abs(angleDiff(cam, c.az));
    if (d <= maxDeg && d < bestD) { best = i; bestD = d; }
  });
  return best;
}

/** Captions in the order the camera first shows them (captionAt), starting at frame 0; never-shown ones last. For the reading order and the still list. */
export function orbitOrder<C extends { az: number }>(caps: readonly C[], o: OrbitPath, maxDeg = o.halfWindowDeg ?? CAPTION_HALF_WINDOW): C[] {
  const first = new Map<C, number>();
  const degree: OrbitPath = { ...o, degPerFrame: 1 };
  for (let d = 0; d < 360; d++) {
    const i = captionAt(d, caps, degree, maxDeg);
    if (i >= 0 && !first.has(caps[i])) first.set(caps[i], d);
  }
  return [...caps].sort((a, b) => (first.get(a) ?? 360) - (first.get(b) ?? 360));
}

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

/**
 * How many frames the first, coarsest pass of `loadOrder` holds (every `step`-th frame plus the last). The hero fetches only
 * these before the visitor scrolls, so a phone stays within its image budget until it is clear the sequence will be watched.
 */
export function coarseCount(count: number, step = 8): number {
  if (count <= 0) return 0;
  return Math.ceil(count / step) + (count > 1 && (count - 1) % step !== 0 ? 1 : 0);
}

/**
 * Is the smaller variant of a sequence sharp enough for this canvas? The canvas is drawn "cover" at no more than 2 device
 * pixels per CSS pixel; the small frames may be stretched by at most `tolerance`.
 */
export function smallVariantFits(
  cssWidth: number, cssHeight: number, dpr: number,
  full: { width: number; height: number }, small: { width: number }, tolerance = 1.1,
): boolean {
  const scale = Math.max(1, Math.min(2, dpr));
  const needed = Math.max(cssWidth * scale, cssHeight * scale * (full.width / full.height));
  return needed <= small.width * tolerance;
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

/**
 * Keys to drop so that at most `capacity` remain: the ones outside the decode window (`keep`) go first, then the ones farthest
 * from the current frame (so a frame decoded ahead of the scroll direction is not dropped for one left behind).
 */
export function evictions(keys: Iterable<number>, current: number, capacity: number, keep: readonly number[] = []): number[] {
  const kept = new Set(keep);
  const sorted = [...keys].sort((a, b) => Number(kept.has(a)) - Number(kept.has(b)) || Math.abs(b - current) - Math.abs(a - current) || b - a);
  return sorted.slice(0, Math.max(0, sorted.length - capacity));
}

/**
 * Frames to decode around the current one (offsets), in the order they are decoded: the current frame, then ahead of the scroll
 * direction before behind it, so the next frames are ready before the scroll reaches them (a decode never lands on the frame
 * that needs it). A cut is anchored on the nearest frame and needs the frames ahead. A cross-fade is anchored on the frame under
 * the scroll position (`blendAt` i0): its first three are always i0, i1 (= i0 + 1) and the next frame in the scroll direction,
 * whichever way the scroll goes. At most `capacity`, never fewer than three.
 */
export function decodeWindow(dir: 1 | -1, blend: boolean, capacity: number): number[] {
  // `|| 0`: no -0 offsets
  const order = !blend ? [0, 1, 2, -1, 3, 4, -2].map((d) => d * dir || 0) : dir > 0 ? [0, 1, 2, -1, 3, -2, 4] : [0, 1, -1, -2, 2, -3, 3];
  return order.slice(0, Math.max(3, Math.min(order.length, capacity)));
}

// ------------------------------------------------------------------------------------------------ cross-fade (day sequence)

/**
 * The two frames a static camera cross-fades at a fractional frame index: i0 drawn whole, i1 = i0 + 1 over it at alpha `t` (the
 * fraction of the scroll between the two frames' positions; linear, so the picture changes at an even rate). The last frame is
 * the end of the last pair (t = 1), never a pair of its own, so arriving at or leaving the end is no different from any frame.
 */
export function blendAt(frame: number, count: number): { i0: number; i1: number; t: number } {
  if (count <= 1) return { i0: 0, i1: 0, t: 0 };
  const f = Math.min(count - 1, Math.max(0, frame));
  const i0 = Math.min(count - 2, Math.floor(f));
  return { i0, i1: i0 + 1, t: f - i0 };
}

/** Milliseconds over which a frame that arrives late (decoded after the scroll got there) fades in instead of popping. */
export const ARRIVAL_FADE_MS = 160;

/** Progress 0..1 of an arrival fade after `elapsedMs` (smoothstep: no visible start or stop). */
export function arrivalFade(elapsedMs: number, durationMs = ARRIVAL_FADE_MS): number {
  const k = durationMs <= 0 ? 1 : clamp01(elapsedMs / durationMs);
  return k * k * (3 - 2 * k);
}

/** What a cross-fading player wants on the canvas: `base` whole and `over` (-1: none decoded) over it at alpha `t`. */
export interface BlendTarget { base: number; over: number; t: number }
/** A frame drawn over the ones before it at `alpha` (the first one is drawn whole). */
export interface BlendLayer { index: number; alpha: number }

/**
 * The layers to draw (bottom first) for a blend target, and the fractional frame they show (the clock and the sun of the HUD
 * follow it). While a late frame arrives (`from`: the frame that stood alone on the canvas, `k`: arrivalFade 0..1) the target
 * fades in over `from`, so the picture and the HUD glide instead of jumping; `from` = -1 (or k = 1) is the target as it is.
 */
export function blendLayers(target: BlendTarget, from = -1, k = 1): { layers: BlendLayer[]; drawn: number } {
  if (target.base < 0) return { layers: [], drawn: Math.max(0, from) };
  const fading = from >= 0 && k < 1;
  const e = fading ? clamp01(k) : 1;
  const t = target.over >= 0 ? clamp01(target.t) : 0;
  const layers: BlendLayer[] = [];
  if (fading && from !== target.base) layers.push({ index: from, alpha: 1 });
  layers.push({ index: target.base, alpha: layers.length ? e : 1 });
  if (target.over >= 0 && t * e > 0) layers.push({ index: target.over, alpha: t * e });
  const shown = target.over >= 0 ? target.base + (target.over - target.base) * t : target.base;
  return { layers, drawn: fading ? from + (shown - from) * e : shown };
}

/** A source rectangle in image pixels (fractions allowed). */
export interface SourceRect { sx: number; sy: number; sw: number; sh: number }

/**
 * The part of an image that a cover-fitted canvas shows, as the source rectangle of drawImage(img, sx, sy, sw, sh, 0, 0, canvasW,
 * canvasH): the same picture as drawing the whole image at coverRect, without copying anything first (no crop bitmap is made).
 */
export function coverSource(imageW: number, imageH: number, canvasW: number, canvasH: number): SourceRect {
  if (canvasW <= 0 || canvasH <= 0 || imageW <= 0 || imageH <= 0) return { sx: 0, sy: 0, sw: Math.max(0, imageW), sh: Math.max(0, imageH) };
  const s = Math.max(canvasW / imageW, canvasH / imageH); // canvas pixels per image pixel
  const sw = Math.min(imageW, canvasW / s), sh = Math.min(imageH, canvasH / s);
  return { sx: (imageW - sw) / 2, sy: (imageH - sh) / 2, sw, sh };
}

/** Widest frame that is kept decoded whole (a phone's portrait frames, or a 960 px copy). */
export const KEEP_ALL_MAX_WIDTH = 1600;

/**
 * Are all decoded frames of a sequence kept (no eviction), instead of a window around the current frame? For portrait or narrow
 * frames (32 portrait frames of 1080 x 1620 are about 224 MB decoded), not on a device that reports 2 GB of memory or less, and
 * not for wide desktop frames (32 x 1920 x 1080 would be 265 MB).
 */
export function keepsAll(frame: { width: number; height: number }, deviceMemoryGb?: number): boolean {
  if (deviceMemoryGb !== undefined && deviceMemoryGb <= 2) return false;
  return frame.height > frame.width || frame.width <= KEEP_ALL_MAX_WIDTH;
}

/**
 * Decode order of a sequence whose frames are all kept: the window first (absolute indices, nearest first, as decodeWindow
 * anchors it on the frames the canvas needs now), then every other frame outward from `current`, the one ahead in the scroll
 * direction first at each distance. Each frame once.
 */
export function keepAllOrder(current: number, count: number, window: readonly number[], dir: 1 | -1 = 1): number[] {
  const seen = new Set<number>();
  const order: number[] = [];
  const push = (i: number) => { if (i >= 0 && i < count && !seen.has(i)) { seen.add(i); order.push(i); } };
  window.forEach(push);
  for (let d = 0; order.length < count && d < count; d++) { push(current + d * dir); push(current - d * dir); }
  return order;
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

// ------------------------------------------------------------------------------------------------ compositor layers

/**
 * Backing store of a layer canvas: the part of the frame the viewport shows (coverSource, in frame pixels), so drawImage copies
 * the source pixels 1:1 and the compositor scales the canvas to the viewport (CSS 100 %). Never finer than 2 device pixels per
 * CSS pixel (as canvasScale), which a frame larger than the screen needs; the source pixels are the same, nothing is lost.
 */
export function layerSize(cssWidth: number, cssHeight: number, dpr: number, frameWidth: number, frameHeight: number): { width: number; height: number } {
  const s = coverSource(frameWidth, frameHeight, cssWidth, cssHeight);
  const k = s.sw > 0 ? Math.min(1, (cssWidth * Math.max(1, Math.min(2, dpr))) / s.sw) : 1;
  return { width: Math.max(1, Math.round(s.sw * k)), height: Math.max(1, Math.round(s.sh * k)) };
}

/** Two stacked canvases: `bottom` shown whole, `top` over it at the element opacity `opacity` (the compositor blends them). */
export interface LayerStack { bottom: BlendLayer[]; top: BlendLayer[]; opacity: number }

/**
 * The layers of blendLayers on two stacked canvases, where the cross-fade is only the CSS opacity of the upper one: nothing is
 * redrawn while the blend fraction changes. The first layer is the bottom canvas, the second the top canvas at its alpha. A third
 * layer (only while a late frame fades in: the pair over the frame that stood alone) is drawn into the top canvas over the second
 * at its alpha relative to it (t), so the top canvas holds the pair and the arrival fade is its opacity.
 */
export function stackLayers(layers: readonly BlendLayer[]): LayerStack {
  const [first, second, ...rest] = layers;
  if (!first) return { bottom: [], top: [], opacity: 0 };
  const bottom = [{ index: first.index, alpha: 1 }];
  if (!second) return { bottom, top: [], opacity: 0 };
  const rel = (a: number) => (second.alpha > 0 ? clamp01(a / second.alpha) : 0);
  return { bottom, top: [{ index: second.index, alpha: 1 }, ...rest.map((l) => ({ index: l.index, alpha: rel(l.alpha) }))], opacity: clamp01(second.alpha) };
}

/** What a canvas holds (its frames and their alphas in `steps`); a canvas is drawn only when this changes. "" is nothing. */
export const layerKey = (layers: readonly BlendLayer[], steps = 128): string => layers.map((l) => `${l.index}:${Math.round(l.alpha * steps)}`).join(" ");

/**
 * Which of the two canvases takes the bottom picture (the other one takes the top), from what each holds (`have`, layerKey) and
 * which one is at the bottom now (`lower`): a canvas that already holds a wanted picture keeps it, so when the pair moves on by
 * one frame the two swap places and only one is drawn. The order changes only when that saves a drawing; an empty top ("")
 * needs no canvas.
 */
export function assignLayers(have: readonly [string, string], bottom: string, top: string, lower: 0 | 1): 0 | 1 {
  const score = (b: 0 | 1) => Number(have[b] === bottom) + Number(top !== "" && have[1 - b] === top);
  const other: 0 | 1 = lower === 0 ? 1 : 0;
  return score(other) > score(lower) ? other : lower;
}
