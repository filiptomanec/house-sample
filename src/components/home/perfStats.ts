// Aggregates what the diagnostic probe sees (?perf=1, PerfProbe.tsx): the intervals of its own animation-frame loop with the
// scroll position read in each frame, the page's scroll events and the events the frame player reports (perfSink.ts). Pure (no
// DOM) and incremental: fixed-size histograms, so a minute of data costs what a second does and nothing is sorted while scrolling.
//
// Definitions (the copied JSON uses them too):
// * an interval is the time between two animation frames; it is idle when the page has not moved for IDLE_AFTER_MS, otherwise
//   slow or fast by the scroll speed (smoothed over about SPEED_TAU_MS) against FAST_PX_S;
// * a frame is dropped when its interval is longer than DROP_FACTOR x the idle median (60 Hz until there are idle frames);
// * a player event is "in a drop" when it overlaps a dropped interval [previous frame, this frame), i.e. it ran while that frame
//   was late, and it belongs to the speed bucket of the interval in which it ended.
// The panel and the JSON are a developer tool: English labels (see PerfProbe.tsx).

import type { PerfEvent, PerfKind, PerfSeq } from "./perfSink";

/** Scroll speed (px/s) from which an interval counts as fast. */
export const FAST_PX_S = 1500;
/** A frame is dropped when its interval exceeds this many idle medians. */
export const DROP_FACTOR = 1.5;
/** The frame interval assumed until enough idle frames have been seen. */
export const FALLBACK_FRAME_MS = 1000 / 60;
/** Frames are idle only once the page has not moved for this long (the tail of a fling is not idle). */
export const IDLE_AFTER_MS = 250;
/** Longer intervals are a hidden tab or a paused page, not dropped frames: they are left out. */
export const MAX_GAP_MS = 1000;
/** Idle frames needed before their median sets the drop threshold. */
const MIN_IDLE = 20;
/** Scroll events further apart belong to different gestures (their gap is not a cadence). */
const SCROLL_GAP_MS = 200;
/** Time constant of the speed estimate. */
const SPEED_TAU_MS = 50;
/** Recent intervals kept to place the player's events (about two seconds at 120 Hz). */
const RECENT = 256;
/** Scrolling frames needed before the hints judge anything. */
const MIN_SCROLL_FRAMES = 30;

export type Bucket = "idle" | "slow" | "fast";
/** The player's kinds in the summary ("frame" has its own block). */
export type PlayerKind = Exclude<PerfKind, "frame">;
const PLAYER_KINDS: readonly PlayerKind[] = ["draw", "decode", "decodeLatency", "hold", "handler", "measure", "ro", "resize", "realloc", "viewport"];
/** Kinds whose events have a duration worth averaging. */
const TIMED: ReadonlySet<PerfKind> = new Set<PerfKind>(["draw", "decode", "decodeLatency", "handler", "measure"]);
/** Kinds that measure waiting, not work on the main thread: they span frames without delaying them, so they are not "in a drop". */
const WAITS: ReadonlySet<PerfKind> = new Set<PerfKind>(["decodeLatency"]);

const round = (v: number | null, digits: number): number | null => (v === null ? null : Number(v.toFixed(digits)));

/** The refresh rate an interval stands for, snapped to 120/90/60/30 Hz within 12 % (Safari's timers are coarse: 8, 9, 16, 17 ms). */
export function nominalHz(ms: number | null): number | null {
  if (ms === null || !(ms > 0)) return null;
  const hz = 1000 / ms;
  for (const n of [120, 90, 60, 30]) if (Math.abs(hz - n) / n < 0.12) return n;
  return Math.round(hz);
}

/** Durations in fixed bins (0.25 ms up to 250 ms; longer ones share the last bin, the maximum stays exact). */
export class Histogram {
  private readonly bins: Uint32Array;
  count = 0;
  max = 0;
  constructor(readonly binMs = 0.25, maxMs = 250) { this.bins = new Uint32Array(Math.ceil(maxMs / binMs) + 1); }

  add(ms: number): void {
    this.bins[Math.min(this.bins.length - 1, Math.max(0, Math.floor(ms / this.binMs)))]++;
    this.count++;
    if (ms > this.max) this.max = ms;
  }

  /** The median of the samples of several histograms (the middle of its bin, never above the maximum), or null without samples. */
  static median(...hs: Histogram[]): number | null {
    const count = hs.reduce((a, h) => a + h.count, 0);
    if (!count) return null;
    const half = Math.ceil(count / 2), max = Math.max(...hs.map((h) => h.max));
    for (let i = 0, acc = 0; i < hs[0].bins.length; i++) {
      for (const h of hs) acc += h.bins[i];
      if (acc >= half) return Math.min((i + 0.5) * hs[0].binMs, max);
    }
    return max;
  }

  median(): number | null { return Histogram.median(this); }
}

export interface RateStats { n: number; medianMs: number | null; hz: number | null }
export interface KindStats { n: number; avgMs: number | null; maxMs: number | null; inDrops: number; idle: number; slow: number; fast: number }
export interface StatsSummary {
  raf: { idle: RateStats; scroll: RateStats; slow: RateStats; fast: RateStats };
  scrollEvents: { n: number; medianMs: number | null; hz: number | null; perFrame: number | null };
  speed: { nowPxS: number; maxPxS: number };
  drops: { thresholdMs: number; idle: number; slow: number; fast: number; worstMs: number; worstBucket: Bucket | null };
  /** The frame index the scroll asks for, at every draw call: how often it changed and by how much. */
  frames: { calls: number; changes: number; avgStep: number | null; maxStep: number };
  player: Record<PlayerKind, KindStats>;
}

interface Interval { s: number; e: number; bucket: Bucket; drop: boolean }
interface Acc { n: number; ms: number; maxMs: number; inDrops: number; idle: number; slow: number; fast: number }

export class PerfStats {
  private prevTs: number | null = null;
  private prevY: number | null = null;
  private speed = 0;
  private maxSpeed = 0;
  private moved = -Infinity;
  private lastScroll = -Infinity;
  private scrolls = 0;
  private readonly scrollGaps = new Histogram();
  private readonly gaps: Record<Bucket, Histogram> = { idle: new Histogram(), slow: new Histogram(), fast: new Histogram() };
  private readonly drops: Record<Bucket, number> = { idle: 0, slow: 0, fast: 0 };
  private worst: { ms: number; bucket: Bucket | null } = { ms: 0, bucket: null };
  private recent: Interval[] = [];
  private pending: PerfEvent[] = [];
  private readonly kinds = new Map<PerfKind, Acc>();
  private readonly frame = { last: null as number | null, changes: 0, steps: 0, maxStep: 0 };

  /** When the page last moved (a scroll event or a new scroll position in a frame). */
  get lastMoveAt(): number { return this.moved; }

  /** A scroll event of the page at time `t`. */
  scrollEvent(t: number): void {
    const gap = t - this.lastScroll;
    if (gap >= 0 && gap < SCROLL_GAP_MS) this.scrollGaps.add(gap);
    this.lastScroll = t;
    this.scrolls++;
    if (t > this.moved) this.moved = t;
  }

  /** Events from the sink; they are placed once the frame they belong to has ended. */
  events(list: Iterable<PerfEvent>): void { for (const e of list) this.pending.push(e); }

  /** One animation frame: its timestamp and the scroll position read in it. */
  tick(ts: number, scrollY: number): void {
    const prevTs = this.prevTs, dy = Math.abs(scrollY - (this.prevY ?? scrollY));
    this.prevTs = ts;
    this.prevY = scrollY;
    if (dy > 0 && ts > this.moved) this.moved = ts;
    if (prevTs !== null && ts > prevTs && ts - prevTs <= MAX_GAP_MS) this.interval(prevTs, ts, dy);
    this.settle(ts);
  }

  /** The current drop threshold (ms). */
  threshold(): number {
    const idle = this.gaps.idle.count >= MIN_IDLE ? this.gaps.idle.median() : null;
    return DROP_FACTOR * (idle ?? FALLBACK_FRAME_MS);
  }

  private interval(s: number, e: number, dy: number): void {
    const dt = e - s;
    this.speed += ((dy / dt) * 1000 - this.speed) * Math.min(1, dt / SPEED_TAU_MS);
    if (this.speed > this.maxSpeed) this.maxSpeed = this.speed;
    const bucket: Bucket = e - this.moved > IDLE_AFTER_MS ? "idle" : this.speed < FAST_PX_S ? "slow" : "fast";
    const drop = dt > this.threshold();
    this.gaps[bucket].add(dt);
    if (drop) {
      this.drops[bucket]++;
      if (dt > this.worst.ms) this.worst = { ms: dt, bucket };
    }
    this.recent.push({ s, e, bucket, drop });
    if (this.recent.length > 2 * RECENT) this.recent = this.recent.slice(-RECENT);
  }

  /** Places the events that ended before the frame at `ts` began (later ones wait: their interval is not over yet). */
  private settle(ts: number): void {
    if (!this.pending.length) return;
    const wait: PerfEvent[] = [];
    for (const e of this.pending) {
      if (e.t1 < ts) this.place(e);
      else wait.push(e);
    }
    this.pending = wait;
  }

  private place(ev: PerfEvent): void {
    let bucket: Bucket | null = null, inDrop = false;
    for (let i = this.recent.length - 1; i >= 0; i--) {
      const r = this.recent[i];
      if (r.e <= ev.t0) break; // this interval and all older ones ended before the event began
      if (ev.t1 < r.s) continue; // the event ended before this interval began
      bucket ??= r.bucket; // the newest overlapping interval is the one the event ended in
      if (r.drop) inDrop = true;
    }
    let a = this.kinds.get(ev.kind);
    if (!a) this.kinds.set(ev.kind, (a = { n: 0, ms: 0, maxMs: 0, inDrops: 0, idle: 0, slow: 0, fast: 0 }));
    const d = ev.t1 - ev.t0;
    a.n++;
    a.ms += d;
    if (d > a.maxMs) a.maxMs = d;
    if (inDrop && !WAITS.has(ev.kind)) a.inDrops++;
    if (bucket) a[bucket]++;
    if (ev.kind === "frame" && ev.value !== undefined) {
      const f = this.frame;
      if (f.last !== null && ev.value !== f.last) {
        const step = Math.abs(ev.value - f.last);
        f.changes++;
        f.steps += step;
        if (step > f.maxStep) f.maxStep = step;
      }
      f.last = ev.value;
    }
  }

  summary(): StatsSummary {
    const rate = (...hs: Histogram[]): RateStats => {
      const m = Histogram.median(...hs);
      return { n: hs.reduce((a, h) => a + h.count, 0), medianMs: round(m, 2), hz: nominalHz(m) };
    };
    const kind = (k: PlayerKind): KindStats => {
      const a = this.kinds.get(k), timed = TIMED.has(k) && !!a?.n;
      return {
        n: a?.n ?? 0, avgMs: timed ? round(a!.ms / a!.n, 2) : null, maxMs: timed ? round(a!.maxMs, 2) : null,
        inDrops: a?.inDrops ?? 0, idle: a?.idle ?? 0, slow: a?.slow ?? 0, fast: a?.fast ?? 0,
      };
    };
    const scrolling = this.gaps.slow.count + this.gaps.fast.count, sm = this.scrollGaps.median(), f = this.frame;
    return {
      raf: { idle: rate(this.gaps.idle), scroll: rate(this.gaps.slow, this.gaps.fast), slow: rate(this.gaps.slow), fast: rate(this.gaps.fast) },
      scrollEvents: { n: this.scrolls, medianMs: round(sm, 2), hz: nominalHz(sm), perFrame: scrolling ? round(this.scrolls / scrolling, 2) : null },
      speed: { nowPxS: Math.round(this.speed), maxPxS: Math.round(this.maxSpeed) },
      drops: { thresholdMs: round(this.threshold(), 1)!, ...this.drops, worstMs: round(this.worst.ms, 1)!, worstBucket: this.worst.bucket },
      frames: { calls: this.kinds.get("frame")?.n ?? 0, changes: f.changes, avgStep: f.changes ? round(f.steps / f.changes, 2) : null, maxStep: f.maxStep },
      player: Object.fromEntries(PLAYER_KINDS.map((k) => [k, kind(k)])) as Record<PlayerKind, KindStats>,
    };
  }
}

/** What the probe knows about the device and the page. */
export interface ProbeEnv {
  dpr: number;
  /** innerWidth x innerHeight. */
  viewport: string;
  /** visualViewport height now (its changes are the "viewport" events). */
  vvHeight: number | null;
  cores: number | null;
  reducedMotion: boolean;
  saveData: boolean;
  /** The hero's sequence as the player set it up. */
  seq: PerfSeq | null;
  /** How frames are decoded: "worker", "main" (the fallback) or "probe" (frameDecoder.ts); null without a player. */
  decoder: string | null;
  /** The canvas backing store, width x height. */
  canvas: string | null;
  ua: string;
}

const pct = (v: number) => `${Math.round(v * 100)} %`;

/** Plain-language reading of the summary, most telling first. */
export function hints(s: StatsSummary, env: Pick<ProbeEnv, "reducedMotion" | "saveData">): string[] {
  if (env.reducedMotion) return ["prefers-reduced-motion is on: the hero does not scrub (turn it off to measure)"];
  if (env.saveData) return ["Save-Data is on: the hero does not scrub"];
  const { scroll, slow, fast } = s.raf;
  if (scroll.n < MIN_SCROLL_FRAMES) return ["scroll the hero slowly, then fast; the summary freezes 2 s after"];
  const out: string[] = [];
  if (scroll.hz === 30) out.push("rAF ~30 Hz: Low Power Mode?");
  else if (scroll.hz === 60) out.push("rAF ~60 Hz while scrolling on a 120 Hz screen");
  else if (scroll.hz !== null && scroll.hz >= 100) out.push(`rAF ~${scroll.hz} Hz while scrolling: the full ProMotion rate`);
  else out.push(`rAF ~${scroll.hz ?? "?"} Hz while scrolling`);
  if (fast.n >= MIN_SCROLL_FRAMES) {
    const share = s.drops.fast / fast.n, slowShare = slow.n ? s.drops.slow / slow.n : 0;
    out.push(share >= 0.05 ? `fast scroll drops ${pct(share)} of frames (slow ${pct(slowShare)})` : `rAF keeps up in fast scroll (${pct(share)} dropped)`);
  } else out.push(`no fast scroll yet (> ${FAST_PX_S} px/s)`);
  const hold = s.player.hold;
  if (hold.n > 0) out.push(`frames not decoded in time: ${hold.n} holds (${hold.fast} in fast scroll)`);
  if (s.frames.maxStep >= 3) out.push(`frame index jumps up to ${s.frames.maxStep} frames per draw`);
  const realloc = s.player.realloc.slow + s.player.realloc.fast;
  if (realloc > 0) out.push(`canvas reallocated ${realloc}x while scrolling (toolbar resize?)`);
  return out;
}

const num = (v: number | null, digits: number) => (v === null ? "-" : v.toFixed(digits));
const rateText = (r: RateStats) => (r.medianMs === null ? "-" : `${r.medianMs.toFixed(1)}ms ~${r.hz}Hz`);

/** The text of the panel: a head line, the numbers (at most 38 columns) and the hints. */
export function panelLines(s: StatsSummary, env: ProbeEnv, head: string, notes: readonly string[]): string[] {
  const { raf: r, drops: d, player: p } = s;
  const row = (name: string, k: KindStats) =>
    name.padEnd(8) + String(k.n).padStart(5) + num(k.avgMs, 2).padStart(6) + num(k.maxMs, 1).padStart(6) + String(k.inDrops).padStart(5) + String(k.fast).padStart(5);
  const q = env.seq;
  return [
    head,
    `rAF idle   ${rateText(r.idle)}  n ${r.idle.n}`,
    `rAF scroll ${rateText(r.scroll)}  n ${r.scroll.n}`,
    `slow ${rateText(r.slow)}  fast ${rateText(r.fast)}`,
    `scroll ev ${num(s.scrollEvents.medianMs, 1)}ms ~${s.scrollEvents.hz ?? "-"}/s ${num(s.scrollEvents.perFrame, 1)}/frame`,
    `speed ${s.speed.nowPxS} px/s  max ${s.speed.maxPxS}`,
    `drops >${d.thresholdMs.toFixed(1)}ms idle ${d.idle}/${r.idle.n}`,
    ` slow ${d.slow}/${r.slow.n}  fast ${d.fast}/${r.fast.n}`,
    `worst gap ${d.worstMs.toFixed(1)}ms ${d.worstBucket ?? ""}`,
    `frame step avg ${num(s.frames.avgStep, 1)} max ${s.frames.maxStep} calls ${s.frames.calls}`,
    "kind        n   avg   max drop fast",
    row("draw", p.draw),
    row("decode", p.decode),
    row("decLat", p.decodeLatency),
    row("hold", p.hold),
    row("scrollH", p.handler),
    row("measure", p.measure),
    row("resize", p.resize),
    `ro ${p.ro.n}  realloc ${p.realloc.n}  vv ${p.viewport.n} (h ${env.vvHeight ?? "-"})`,
    `dpr ${env.dpr} ${env.viewport} cores ${env.cores ?? "-"}`,
    q ? `seq ${q.width}x${q.height} x${q.count}${q.portrait ? " port" : ""}${q.small ? " small" : ""} cap ${q.capacity}` : "seq -",
    `decoder ${env.decoder ?? "-"}  (decode = main thread)`,
    `canvas ${env.canvas ?? "-"}  rm ${env.reducedMotion ? "ON" : "off"}${env.saveData ? "  save-data" : ""}`,
    ...notes.map((n) => `> ${n}`),
  ];
}
