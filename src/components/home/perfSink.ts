// The sink of the hidden diagnostic mode of the home page (?perf=1, see PerfGate.tsx): the frame player reports its work through
// `globalThis.__hsPerf`. Without the query parameter the global stays undefined and every report is an optional call that does
// nothing (its arguments are not even evaluated). With it, PerfGate installs a recorder before the player sets up, and the probe
// (PerfProbe.tsx, loaded only then) drains the recorded events once per animation frame and aggregates them (perfStats.ts).

/** What is reported. Spans have a duration (t0..t1); the others are moments (t0 === t1). */
export type PerfKind =
  | "decode" // createImageBitmap of one frame (span)
  | "draw" // the drawImage calls of one canvas update (span; value: images drawn)
  | "hold" // the scroll asks for a frame that is not decoded yet (value: that frame)
  | "measure" // the player's measure(): layout reads and the canvas size (span)
  | "handler" // the player's scroll/resize handler (span)
  | "ro" // a ResizeObserver callback of the player
  | "realloc" // the canvas backing store was resized (value: its pixels)
  | "frame" // the frame the scroll asks for, at every draw (value: its index)
  | "resize" // a window resize event (the probe's own listener)
  | "viewport"; // the visual viewport changed its height, e.g. the iOS toolbar (the probe's own listener; value: the height)

export interface PerfEvent { kind: PerfKind; t0: number; t1: number; value?: number }

/** The sequence a player has set up. */
export interface PerfSeq { width: number; height: number; count: number; small: boolean; portrait: boolean; capacity: number; blend: boolean; priority: boolean }

export interface PerfSink {
  /** The start of a span (performance.now()). */
  now(): number;
  /** A span that began at `t0` ends now; one whose start was not seen (t0 undefined: the sink came later) is ignored. */
  span(kind: PerfKind, t0: number | undefined, value?: number): void;
  mark(kind: PerfKind, value?: number): void;
  seq(info: PerfSeq): void;
}

declare global {
  var __hsPerf: PerfSink | undefined;
}

/** Events kept when nobody drains them (the probe failed to load): the recorder never grows without bound. */
export const MAX_EVENTS = 20000;

/** A sink that only records (cheap, so it can live in the main bundle) and the drain the probe reads it through. */
export interface PerfRecorder { sink: PerfSink; drain(): PerfEvent[]; readonly seqs: PerfSeq[] }

export function createRecorder(now: () => number = () => performance.now()): PerfRecorder {
  let events: PerfEvent[] = [];
  const seqs: PerfSeq[] = [];
  const push = (e: PerfEvent) => { if (events.length < MAX_EVENTS) events.push(e); };
  const sink: PerfSink = {
    now,
    span(kind, t0, value) { if (t0 !== undefined) push({ kind, t0, t1: now(), value }); },
    mark(kind, value) { const t = now(); push({ kind, t0: t, t1: t, value }); },
    seq(info) { seqs.push(info); },
  };
  return { sink, seqs, drain() { const out = events; events = []; return out; } };
}
