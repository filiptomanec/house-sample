// Decodes frames off the main thread. WebKit runs createImageBitmap(blob) on the calling thread, which on an iPhone blocked the
// scroll-driven hero for 24 ms per frame on average (80 ms at worst). Here one small Web Worker, shared by every frame player on
// the page and created from an inline script (no bundler set-up; the CSP has no worker-src), decodes the downloaded file and
// transfers the bitmap back, so the main thread only receives it. At most MAX_IN_FLIGHT decodes run at once, the others wait in
// order, and a request whose AbortSignal fires is dropped (the player has scrolled past that frame). The worker first proves it
// can decode a 1 x 1 WebP; without a worker, without createImageBitmap in workers, or when the worker fails or stays silent, the
// same queue decodes on the main thread (the previous path). The worker stops when the last player unmounts.
//
// The diagnostic mode (?perf=1, perfSink.ts) gets `decode`, the main thread's share of a decode (on the worker path the handling
// of the reply, about 0 ms; on the fallback the createImageBitmap call), and `decodeLatency`, from the request to the bitmap.

import type { PerfSink } from "./perfSink";

/** "probe" while the worker has not yet shown that it can decode (requests wait), "main" on the fallback. */
export type DecoderMode = "probe" | "worker" | "main";

/** The part of a Worker the client uses (a fake in tests). */
export interface WorkerLike {
  postMessage(message: unknown): void;
  terminate(): void;
  onmessage: ((e: MessageEvent) => void) | null;
  onerror: ((e: ErrorEvent) => void) | null;
}

export interface DecoderEnv<B> {
  /** A worker running WORKER_SOURCE, or null where there is none (a throw counts as none). */
  createWorker(): WorkerLike | null;
  /** The main-thread decode of the fallback. */
  decodeOnMain(blob: Blob): Promise<B>;
  maxInFlight?: number;
  /** How long the worker may take to report that it can decode before the main thread takes over. */
  readyTimeoutMs?: number;
  perf?(): PerfSink | undefined;
}

/** Decodes running at once (the worker's thread and the transfers stay light; the rest wait in order). */
export const MAX_IN_FLIGHT = 2;
const READY_TIMEOUT_MS = 3000;

/** The worker: it decodes a 1 x 1 WebP to show that it can, then decodes what it is sent and transfers the bitmaps back. */
export const WORKER_SOURCE = `"use strict";
const dropped = new Set();
const probe = Uint8Array.from(atob("UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AAAAAA"), (c) => c.charCodeAt(0));
createImageBitmap(new Blob([probe], { type: "image/webp" })).then(
  (b) => { const ok = b.width === 1 && b.height === 1; b.close(); postMessage({ t: "ready", ok }); },
  () => postMessage({ t: "ready", ok: false }),
);
onmessage = (e) => {
  const m = e.data;
  if (m.t === "cancel") { dropped.add(m.id); return; }
  if (m.t !== "decode") return;
  createImageBitmap(m.blob).then(
    (bitmap) => {
      if (dropped.delete(m.id)) { bitmap.close(); postMessage({ t: "done", id: m.id }); }
      else postMessage({ t: "done", id: m.id, bitmap }, [bitmap]);
    },
    (err) => { dropped.delete(m.id); postMessage({ t: "done", id: m.id, error: String((err && err.message) || err) }); },
  );
};`;

type Reply = { t: "ready"; ok: boolean } | { t: "done"; id: number; bitmap?: { close(): void }; error?: string };

interface Job<B> {
  id: number;
  blob: Blob;
  /** When it was requested (the diagnostic mode's clock), for decodeLatency. */
  t0: number | undefined;
  resolve(bitmap: B): void;
  reject(reason: unknown): void;
  /** Aborted while running: its promise is already rejected and its bitmap is closed when it arrives. */
  dropped: boolean;
  unlisten?: () => void;
}

const abortError = () => new DOMException("The frame is no longer needed", "AbortError");

export class FrameDecoder<B extends { close?(): void }> {
  private worker: WorkerLike | null = null;
  private state: DecoderMode = "main";
  private readonly queue: Job<B>[] = [];
  private readonly running = new Map<number, Job<B>>();
  private readonly max: number;
  private nextId = 1;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private disposed = false;

  constructor(private readonly env: DecoderEnv<B>) {
    this.max = Math.max(1, env.maxInFlight ?? MAX_IN_FLIGHT);
    let worker: WorkerLike | null = null;
    try { worker = env.createWorker(); } catch { worker = null; }
    if (!worker) return;
    this.worker = worker;
    this.state = "probe";
    worker.onmessage = (e) => this.receive(e.data as Reply);
    worker.onerror = () => this.fallBack();
    this.timer = setTimeout(() => this.fallBack(), env.readyTimeoutMs ?? READY_TIMEOUT_MS);
  }

  get mode(): DecoderMode { return this.state; }
  /** Requests sent to the worker (or started on the main thread) and not yet answered. */
  get inFlight(): number { return this.running.size; }
  /** Requests waiting for a free slot. */
  get waiting(): number { return this.queue.length; }

  /** Decodes `blob`; rejects with an AbortError when `signal` fires first (or the decoder is disposed). */
  decode(blob: Blob, signal?: AbortSignal): Promise<B> {
    return new Promise<B>((resolve, reject) => {
      if (this.disposed || signal?.aborted) { reject(abortError()); return; }
      const job: Job<B> = { id: this.nextId++, blob, t0: this.env.perf?.()?.now(), resolve, reject, dropped: false };
      if (signal) {
        const onAbort = () => this.cancel(job);
        signal.addEventListener("abort", onAbort, { once: true });
        job.unlisten = () => signal.removeEventListener("abort", onAbort);
      }
      this.queue.push(job);
      this.pump();
    });
  }

  /** Stops the worker and rejects everything that has not been answered (bitmaps that still arrive are closed). */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    clearTimeout(this.timer);
    this.stopWorker();
    for (const job of [...this.queue, ...this.running.values()]) {
      job.unlisten?.();
      if (!job.dropped) job.reject(abortError());
    }
    this.queue.length = 0;
    this.running.clear();
  }

  private cancel(job: Job<B>): void {
    job.unlisten?.();
    const at = this.queue.indexOf(job);
    if (at >= 0) this.queue.splice(at, 1);
    else if (this.running.get(job.id) === job && !job.dropped) {
      // already decoding: the worker drops the result if it has not sent it yet; the slot stays taken until it answers
      job.dropped = true;
      if (this.state === "worker") this.worker?.postMessage({ t: "cancel", id: job.id });
    } else return;
    job.reject(abortError());
  }

  private pump(): void {
    while (!this.disposed && this.state !== "probe" && this.running.size < this.max && this.queue.length) {
      const job = this.queue.shift()!;
      this.running.set(job.id, job);
      if (this.state === "worker") this.worker!.postMessage({ t: "decode", id: job.id, blob: job.blob });
      else this.decodeOnMain(job);
    }
  }

  private decodeOnMain(job: Job<B>): void {
    const perf = this.env.perf?.(), t0 = perf?.now();
    this.env.decodeOnMain(job.blob).then(
      (bitmap) => { perf?.span("decode", t0); this.finish(job, bitmap); },
      (err: unknown) => this.finish(job, undefined, err),
    );
  }

  private receive(m: Reply): void {
    if (m.t === "ready") {
      if (this.state !== "probe") return;
      clearTimeout(this.timer);
      if (!m.ok) { this.fallBack(); return; }
      this.state = "worker";
      this.pump();
      return;
    }
    const perf = m.bitmap ? this.env.perf?.() : undefined, t0 = perf?.now();
    const job = this.running.get(m.id);
    if (!job) { m.bitmap?.close(); return; }
    this.finish(job, m.bitmap as B | undefined, m.error === undefined ? undefined : new Error(m.error));
    perf?.span("decode", t0);
  }

  private finish(job: Job<B>, bitmap: B | undefined, err?: unknown): void {
    if (this.running.get(job.id) !== job) { bitmap?.close?.(); return; } // disposed, or re-run after the worker failed
    this.running.delete(job.id);
    job.unlisten?.();
    if (job.dropped) bitmap?.close?.();
    else if (bitmap) {
      this.env.perf?.()?.span("decodeLatency", job.t0);
      job.resolve(bitmap);
    } else job.reject(err ?? new Error("The frame could not be decoded"));
    this.pump();
  }

  /** The worker cannot decode, failed or stayed silent: the main thread takes over, starting with what the worker had. */
  private fallBack(): void {
    if (this.disposed || this.state === "main") return;
    clearTimeout(this.timer);
    this.state = "main";
    this.stopWorker();
    const again = [...this.running.values()].filter((j) => !j.dropped);
    this.running.clear();
    this.queue.unshift(...again);
    this.pump();
  }

  private stopWorker(): void {
    const worker = this.worker;
    this.worker = null;
    if (!worker) return;
    worker.onmessage = null;
    worker.onerror = null;
    try { worker.terminate(); } catch { /* already gone */ }
  }
}

/** The browser's worker (from a blob: URL, revoked when it is terminated) and its main-thread fallback. */
function browserEnv(): DecoderEnv<ImageBitmap> {
  return {
    createWorker() {
      if (typeof Worker !== "function" || typeof URL.createObjectURL !== "function") return null;
      const url = URL.createObjectURL(new Blob([WORKER_SOURCE], { type: "text/javascript" }));
      let worker: Worker;
      try { worker = new Worker(url); } catch { URL.revokeObjectURL(url); return null; }
      const terminate = worker.terminate.bind(worker);
      worker.terminate = () => { terminate(); URL.revokeObjectURL(url); };
      return worker;
    },
    decodeOnMain: (blob) => createImageBitmap(blob),
    perf: () => globalThis.__hsPerf,
  };
}

let shared: FrameDecoder<ImageBitmap> | null = null;
let users = 0;

/** A frame player starts: the first one starts the shared worker. */
export function retainDecoder(): void {
  users++;
  shared ??= new FrameDecoder(browserEnv());
}

/** A frame player stops: after the last one the worker is terminated. */
export function releaseDecoder(): void {
  users = Math.max(0, users - 1);
  if (users > 0 || !shared) return;
  shared.dispose();
  shared = null;
}

/** Decodes with the shared decoder; without a mounted player (it should not happen) directly on the main thread. */
export function decodeFrame(blob: Blob, signal?: AbortSignal): Promise<ImageBitmap> {
  return shared ? shared.decode(blob, signal) : createImageBitmap(blob);
}

/** How frames are decoded now, for the diagnostic panel (null while no player is mounted). */
export function decoderMode(): DecoderMode | null {
  return shared?.mode ?? null;
}
