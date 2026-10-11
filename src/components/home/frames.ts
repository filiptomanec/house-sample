// Frame store of a scroll sequence: downloads the compressed frames coarse to fine (a few at a time, with retries), decodes only
// the neighbourhood of the current frame (and, once the viewer moves, the frames ahead of it first: decodeOrder) and keeps at
// most `capacity` decoded bitmaps (the farthest are closed first). A decoded 1920 x 1080 frame is about 8 MB, so decoding
// everything would crash a phone; the compressed blobs are small and stay. A requested decode the viewer no longer needs is
// aborted. Network and decoding are injected, so the store is tested without a browser; in the browser frames are decoded in a
// shared Web Worker (frameDecoder.ts).

import { decodeFrame, releaseDecoder, retainDecoder } from "./frameDecoder";
import { decodeOrder, evictions, loadOrder, nearestDecoded } from "./timeline";

export interface Bitmap { width: number; height: number; close?: () => void }

export interface FrameDeps<B extends Bitmap> {
  /** Resolves with the file, or null when the server answered with an error. Rejects on a network failure. */
  fetchBlob(url: string, signal: AbortSignal): Promise<Blob | null>;
  /** Decodes a downloaded frame; when `signal` fires the frame is no longer needed (the promise may then reject). */
  decode(blob: Blob, signal?: AbortSignal): Promise<B>;
  /** Called when a store is created and when it is disposed (a shared decoder runs while any store does). */
  retain?(): void;
  release?(): void;
}

export interface FrameStoreOptions {
  /** Decoded frames kept at once. */
  capacity: number;
  /** Parallel downloads. */
  concurrency?: number;
  /** Extra attempts after a failed download, and the pause before the n-th retry (n x delay). */
  retries?: number;
  retryDelayMs?: number;
  /** Called after a frame has been decoded (so the owner can redraw). */
  onDecoded?: (index: number) => void;
  /** Called whenever a download has finished for good (arrived, or given up after the retries): `settled` of `total`. */
  onProgress?: (settled: number, total: number) => void;
}

export class FrameStore<B extends Bitmap> {
  private readonly blobs: (Blob | null)[];
  private readonly bitmaps = new Map<number, B>();
  /** Requested decodes by frame; a result whose controller is no longer here (aborted, released) is closed at once. */
  private readonly decoding = new Map<number, AbortController>();
  private readonly ctrl = new AbortController();
  private readonly order: number[];
  private readonly timers = new Set<ReturnType<typeof setTimeout>>();
  private next = 0;
  private inflight = 0;
  /** Downloads that have finished for good (arrived or given up). */
  private settled = 0;
  /** How many entries of the load order may be fetched (raised by start()). */
  private limit = 0;
  private current = 0;
  /** The fractional position of the last setCurrent() (null before the first) and the way the viewer last moved. */
  private at: number | null = null;
  private direction: -1 | 0 | 1 = 0;
  /** Frames the viewer needs now (decodeOrder): a download that completes one of them is decoded. */
  private wanted: ReadonlySet<number>;
  private alive = true;
  private readonly opts: Required<Omit<FrameStoreOptions, "onDecoded" | "onProgress">> & Pick<FrameStoreOptions, "onDecoded" | "onProgress">;

  constructor(private readonly urls: readonly string[], private readonly deps: FrameDeps<B>, opts: FrameStoreOptions) {
    this.blobs = new Array<Blob | null>(urls.length).fill(null);
    this.order = loadOrder(urls.length);
    this.opts = { concurrency: 4, retries: 2, retryDelayMs: 1200, ...opts };
    this.wanted = new Set(decodeOrder(0, urls.length, [-1, 0, 1, 2], this.opts.capacity, 0));
    deps.retain?.();
  }

  get count(): number { return this.urls.length; }

  /**
   * Starts downloading, or lets it go further: only the first `limit` frames of the load order (coarse to fine; see
   * `coarseCount`), or all of them. Calling it again with the same or a smaller limit does nothing.
   */
  start(limit = Infinity): void {
    if (!this.alive || limit <= this.limit) return;
    this.limit = limit;
    this.pump();
  }

  /** Has start() been called? */
  get started(): boolean { return this.limit > 0; }

  /**
   * Where the viewer is (a fractional frame index): decoded frames far from it may be dropped; the `window` around it (offsets
   * from the nearest frame) is decoded when available, nearest first, and once the viewer moves also the frames ahead that the
   * cache can keep. Requested decodes that are no longer needed are aborted.
   */
  setCurrent(index: number, window: readonly number[] = [-1, 0, 1, 2]): void {
    const at = Math.max(0, Math.min(this.urls.length - 1, index));
    if (this.at !== null && at !== this.at) this.direction = at > this.at ? 1 : -1;
    this.at = at;
    this.current = Math.round(at);
    const order = decodeOrder(at, this.urls.length, window, this.opts.capacity, this.direction);
    this.wanted = new Set(order);
    for (const [i, ctrl] of this.decoding) {
      if (this.wanted.has(i)) continue;
      this.decoding.delete(i);
      ctrl.abort();
    }
    for (const i of order) this.decodeFrame(i);
  }

  has(i: number): boolean { return this.bitmaps.has(i); }
  get(i: number): B | undefined { return this.bitmaps.get(i); }
  /** Nearest decoded frame to `i`, or -1. */
  nearest(i: number): number { return nearestDecoded(i, (k) => this.bitmaps.has(k), this.urls.length); }
  get decodedCount(): number { return this.bitmaps.size; }
  /** Number of frames whose file has been downloaded. */
  get loadedCount(): number { return this.blobs.filter(Boolean).length; }

  /** Closes every decoded bitmap (the downloaded files stay), e.g. when the sequence is far off screen. They are decoded again on demand. */
  release(): void {
    this.abortDecodes();
    for (const b of this.bitmaps.values()) b.close?.();
    this.bitmaps.clear();
  }

  dispose(): void {
    if (!this.alive) return;
    this.alive = false;
    this.ctrl.abort();
    this.abortDecodes();
    for (const t of this.timers) clearTimeout(t);
    this.timers.clear();
    for (const b of this.bitmaps.values()) b.close?.();
    this.bitmaps.clear();
    this.blobs.fill(null);
    this.deps.release?.();
  }

  private abortDecodes(): void {
    const ctrls = [...this.decoding.values()];
    this.decoding.clear();
    for (const c of ctrls) c.abort();
  }

  private pump(): void {
    while (this.alive && this.inflight < this.opts.concurrency && this.next < this.order.length && this.next < this.limit) {
      const i = this.order[this.next++];
      this.inflight++;
      void this.download(i, 0);
    }
  }

  private async download(i: number, attempt: number): Promise<void> {
    let blob: Blob | null = null;
    try {
      blob = await this.deps.fetchBlob(this.urls[i], this.ctrl.signal);
    } catch {
      blob = null;
    }
    if (!this.alive) return;
    if (!blob && attempt < this.opts.retries) {
      const timer = setTimeout(() => { this.timers.delete(timer); if (this.alive) void this.download(i, attempt + 1); }, this.opts.retryDelayMs * (attempt + 1));
      this.timers.add(timer);
      return; // the slot stays taken until the retry finishes
    }
    this.inflight--;
    this.settled++;
    if (blob) {
      this.blobs[i] = blob;
      if (this.wanted.has(i)) this.decodeFrame(i);
    }
    this.opts.onProgress?.(this.settled, this.urls.length);
    this.pump();
  }

  private decodeFrame(i: number): void {
    if (i < 0 || i >= this.urls.length) return;
    const blob = this.blobs[i];
    if (!blob || this.bitmaps.has(i) || this.decoding.has(i)) return;
    const ctrl = new AbortController();
    this.decoding.set(i, ctrl);
    this.deps.decode(blob, ctrl.signal).then(
      (bitmap) => {
        const live = this.decoding.get(i) === ctrl;
        if (live) this.decoding.delete(i);
        if (!live || !this.alive) { bitmap.close?.(); return; }
        this.bitmaps.set(i, bitmap);
        for (const k of evictions(this.bitmaps.keys(), this.current, this.opts.capacity)) {
          this.bitmaps.get(k)?.close?.();
          this.bitmaps.delete(k);
        }
        this.opts.onDecoded?.(i);
      },
      () => { if (this.decoding.get(i) === ctrl) this.decoding.delete(i); },
    );
  }
}

/** Real network and decoding for the browser: decodes run in the worker shared by all players (frameDecoder.ts, which also times them for ?perf=1). */
export const browserDeps: FrameDeps<ImageBitmap> = {
  async fetchBlob(url, signal) {
    const r = await fetch(url, { signal });
    return r.ok ? r.blob() : null;
  },
  decode: decodeFrame,
  retain: retainDecoder,
  release: releaseDecoder,
};
