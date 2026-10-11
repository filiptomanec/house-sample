// The diagnostic mode (?perf=1): the recorder the player reports to and the aggregate the probe shows.
import { describe, expect, it } from "vitest";
import { createRecorder, MAX_EVENTS, type PerfEvent } from "../perfSink";
import { DROP_FACTOR, Histogram, hints, nominalHz, panelLines, PerfStats, type ProbeEnv } from "../perfStats";

const F60 = 1000 / 60;
const env: ProbeEnv = { dpr: 3, viewport: "402x874", vvHeight: 800, cores: 6, reducedMotion: false, saveData: false, seq: null, canvas: null, ua: "test" };

/** `count` frames `dt` ms apart after `from`, the page moving `dy` px per frame; returns where it ended. */
function run(stats: PerfStats, from: { ts: number; y: number }, count: number, dt: number, dy = 0) {
  let { ts, y } = from;
  for (let i = 0; i < count; i++) { ts += dt; y += dy; stats.tick(ts, y); }
  return { ts, y };
}

describe("createRecorder", () => {
  it("records spans and moments, ignores a span whose start it missed, and drains", () => {
    let now = 10;
    const r = createRecorder(() => now);
    const t0 = r.sink.now();
    now = 13;
    r.sink.span("draw", t0, 2);
    r.sink.span("decode", undefined);
    r.sink.mark("hold", 7);
    r.sink.seq({ width: 1080, height: 1920, count: 120, small: false, portrait: true, capacity: 8, blend: true, priority: true });
    expect(r.drain()).toEqual([{ kind: "draw", t0: 10, t1: 13, value: 2 }, { kind: "hold", t0: 13, t1: 13, value: 7 }]);
    expect(r.drain()).toEqual([]);
    expect(r.seqs).toHaveLength(1);
  });

  it("stops growing when nobody drains it", () => {
    const r = createRecorder(() => 0);
    for (let i = 0; i < MAX_EVENTS + 10; i++) r.sink.mark("frame", i);
    expect(r.drain()).toHaveLength(MAX_EVENTS);
  });
});

describe("Histogram and nominalHz", () => {
  it("takes the median from the bins and keeps the exact maximum", () => {
    const h = new Histogram();
    expect(h.median()).toBeNull();
    [8, 8, 9, 8, 300].forEach((v) => h.add(v));
    expect(h.median()).toBeCloseTo(8.125, 3);
    expect(h.max).toBe(300);
    const g = new Histogram();
    [17, 17, 17].forEach((v) => g.add(v));
    expect(g.median()).toBe(17);
    expect(Histogram.median(h, g)).toBeCloseTo(9.125, 3);
  });

  it("snaps an interval to 120, 90, 60 or 30 Hz despite coarse timers", () => {
    expect([8, 8.33, 9, 11.1, 16, 16.67, 17, 33.3, 34].map(nominalHz)).toEqual([120, 120, 120, 90, 60, 60, 60, 30, 30]);
    expect(nominalHz(20)).toBe(50);
    expect(nominalHz(null)).toBeNull();
    expect(nominalHz(0)).toBeNull();
  });
});

describe("PerfStats", () => {
  it("measures the frame rate idle and while scrolling, split by scroll speed", () => {
    const s = new PerfStats();
    let at = run(s, { ts: 0, y: 0 }, 120, F60);
    at = run(s, at, 60, F60, 10); // 600 px/s
    run(s, at, 60, F60, 50); // 3000 px/s
    const sum = s.summary();
    expect(sum.raf.idle).toMatchObject({ n: 119, hz: 60 });
    expect(sum.raf.scroll).toMatchObject({ n: 120, hz: 60 });
    expect(sum.raf.slow.n).toBeGreaterThanOrEqual(60);
    expect(sum.raf.fast.n).toBeGreaterThanOrEqual(50);
    expect(sum.speed.maxPxS).toBeCloseTo(3000, -2);
    expect(sum.drops).toMatchObject({ idle: 0, slow: 0, fast: 0, worstBucket: null });
  });

  it("counts a late frame as dropped in its speed bucket, with the player's work that overlapped it", () => {
    const s = new PerfStats();
    let at = run(s, { ts: 0, y: 0 }, 60, F60);
    at = run(s, at, 30, F60, 50);
    const start = at.ts;
    s.events([
      { kind: "draw", t0: start + 1, t1: start + 3, value: 1 },
      { kind: "decode", t0: start - 30, t1: start + 20 },
      { kind: "hold", t0: start + 2, t1: start + 2, value: 40 },
      { kind: "draw", t0: start - 10, t1: start - 9, value: 1 },
    ]);
    s.tick(start + 50, at.y + 150);
    run(s, { ts: start + 50, y: at.y + 150 }, 30, F60, 50);
    const sum = s.summary();
    expect(sum.drops.thresholdMs).toBeCloseTo(DROP_FACTOR * F60, 0);
    expect(sum.drops).toMatchObject({ idle: 0, slow: 0, fast: 1, worstBucket: "fast" });
    expect(sum.drops.worstMs).toBeCloseTo(50, 1);
    expect(sum.player.draw).toMatchObject({ n: 2, inDrops: 1, fast: 2, maxMs: 2 });
    expect(sum.player.decode).toMatchObject({ n: 1, inDrops: 1, avgMs: 50 });
    expect(sum.player.hold).toMatchObject({ n: 1, inDrops: 1, fast: 1, avgMs: null });
  });

  it("places an event only once the frame it ran in has ended", () => {
    const s = new PerfStats();
    const at = run(s, { ts: 0, y: 0 }, 59, F60);
    const T = at.ts + F60;
    s.events([{ kind: "draw", t0: T + 0.5, t1: T + 1.5 }]); // the player's rAF ran before the probe's in the frame at T
    s.tick(T, 0);
    expect(s.summary().player.draw.n).toBe(0);
    s.tick(T + 50, 0);
    expect(s.summary().player.draw).toMatchObject({ n: 1, inDrops: 1, idle: 1 });
    expect(s.summary().drops.idle).toBe(1);
  });

  it("leaves out the gap of a hidden tab", () => {
    const s = new PerfStats();
    const at = run(s, { ts: 0, y: 0 }, 30, F60);
    s.tick(at.ts + 5000, 0);
    run(s, { ts: at.ts + 5000, y: 0 }, 30, F60);
    const sum = s.summary();
    expect(sum.raf.idle.n).toBe(59);
    expect(sum.drops).toMatchObject({ idle: 0, worstMs: 0 });
  });

  it("measures the scroll event cadence and the events per frame", () => {
    const s = new PerfStats();
    let ts = 0, y = 0;
    for (let i = 0; i < 120; i++) {
      s.scrollEvent(ts + 2);
      s.scrollEvent(ts + 2 + 1000 / 120);
      ts += F60;
      y += 20;
      s.tick(ts, y);
    }
    const ev = s.summary().scrollEvents;
    expect(ev).toMatchObject({ n: 240, hz: 120 });
    expect(ev.perFrame).toBeCloseTo(2, 1);
  });

  it("follows the frame index the scroll asks for", () => {
    const s = new PerfStats();
    const ev = (t: number, v: number): PerfEvent => ({ kind: "frame", t0: t, t1: t, value: v });
    s.events([ev(1, 0), ev(2, 0), ev(3, 1), ev(4, 4), ev(5, 3)]);
    s.tick(10, 0);
    expect(s.summary().frames).toEqual({ calls: 5, changes: 3, avgStep: 1.67, maxStep: 3 });
  });
});

describe("hints and panel", () => {
  const scrolled = (dt: number, dy: number) => {
    const s = new PerfStats();
    run(s, run(s, { ts: 0, y: 0 }, 60, dt), 90, dt, dy);
    return s.summary();
  };

  it("reads the frame rate while scrolling in plain words", () => {
    expect(hints(scrolled(F60, 50), env)[0]).toBe("rAF ~60 Hz while scrolling on a 120 Hz screen");
    expect(hints(scrolled(2 * F60, 100), env)[0]).toBe("rAF ~30 Hz: Low Power Mode?");
    expect(hints(scrolled(1000 / 120, 25), env)[0]).toBe("rAF ~120 Hz while scrolling: the full ProMotion rate");
    expect(hints(scrolled(F60, 50), env)[1]).toBe("rAF keeps up in fast scroll (0 % dropped)");
    expect(hints(new PerfStats().summary(), env)).toEqual(["scroll the hero slowly, then fast; the summary freezes 2 s after"]);
    expect(hints(scrolled(F60, 50), { ...env, reducedMotion: true })[0]).toMatch(/reduced-motion is on/);
  });

  it("keeps the numbers within 38 columns", () => {
    const sum = scrolled(F60, 50);
    const seq = { width: 1080, height: 1920, count: 120, small: true, portrait: true, capacity: 12, blend: true, priority: true };
    const lines = panelLines(sum, { ...env, seq, canvas: "1206x2622" }, "LIVE", []);
    expect(lines.length).toBeGreaterThan(15);
    for (const l of lines) expect(l.length, l).toBeLessThanOrEqual(38);
    expect(panelLines(sum, env, "LIVE", ["a hint"]).at(-1)).toBe("> a hint");
  });
});
