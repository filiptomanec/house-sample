// Frame store of a scroll sequence: downloads the compressed frames coarse to fine (a few at a time, with retries), decodes only
// the neighbourhood of the current frame and keeps at most `capacity` decoded bitmaps (the farthest are closed first). A decoded
// 1920 x 1080 frame is about 8 MB, so decoding everything would crash a phone; the compressed blobs are small and stay.
// Network and decoding are injected, so the store is tested without a browser.

import { evictions, loadOrder, nearestDecoded } from "./timeline";

export interface Bitmap { width: number; height: number; close?: () => void }

export interface FrameDeps<B extends Bitmap> {
  /** Resolves with the file, or null when the server answered with an error. Rejects on a network failure. */
  fetchBlob(url: string, signal: AbortSignal): Promise<Blob | null>;
  decode(blob: Blob): Promise<B>;
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
  private readonly decoding = new Set<number>();
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
  /** Bumped by release(): a decode that finishes for an older epoch is closed at once. */
  private epoch = 0;
  private alive = true;
  private readonly opts: Required<Omit<FrameStoreOptions, "onDecoded" | "onProgress">> & Pick<FrameStoreOptions, "onDecoded" | "onProgress">;

  constructor(private readonly urls: readonly string[], private readonly deps: FrameDeps<B>, opts: FrameStoreOptions) {
    this.blobs = new Array<Blob | null>(urls.length).fill(null);
    this.order = loadOrder(urls.length);
    this.opts = { concurrency: 4, retries: 2, retryDelayMs: 1200, ...opts };
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

  /** The frame the viewer is at: decoded frames far from it may be dropped, and frames near it are decoded when available. */
  setCurrent(index: number, window: readonly number[] = [-1, 0, 1, 2]): void {
    this.current = Math.max(0, Math.min(this.urls.length - 1, Math.round(index)));
    for (const d of window) this.decodeFrame(this.current + d);
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
    this.epoch++;
    this.decoding.clear();
    for (const b of this.bitmaps.values()) b.close?.();
    this.bitmaps.clear();
  }

  dispose(): void {
    this.alive = false;
    this.ctrl.abort();
    for (const t of this.timers) clearTimeout(t);
    this.timers.clear();
    for (const b of this.bitmaps.values()) b.close?.();
    this.bitmaps.clear();
    this.blobs.fill(null);
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
      if (Math.abs(i - this.current) <= 2) this.decodeFrame(i);
    }
    this.opts.onProgress?.(this.settled, this.urls.length);
    this.pump();
  }

  private decodeFrame(i: number): void {
    if (i < 0 || i >= this.urls.length) return;
    const blob = this.blobs[i];
    if (!blob || this.bitmaps.has(i) || this.decoding.has(i)) return;
    this.decoding.add(i);
    const epoch = this.epoch;
    this.deps.decode(blob).then(
      (bitmap) => {
        if (epoch === this.epoch) this.decoding.delete(i);
        if (!this.alive || epoch !== this.epoch) { bitmap.close?.(); return; }
        this.bitmaps.set(i, bitmap);
        for (const k of evictions(this.bitmaps.keys(), this.current, this.opts.capacity)) {
          this.bitmaps.get(k)?.close?.();
          this.bitmaps.delete(k);
        }
        this.opts.onDecoded?.(i);
      },
      () => { if (epoch === this.epoch) this.decoding.delete(i); },
    );
  }
}

/** Real network and decoding for the browser. */
export const browserDeps: FrameDeps<ImageBitmap> = {
  async fetchBlob(url, signal) {
    const r = await fetch(url, { signal });
    return r.ok ? r.blob() : null;
  },
  decode: (blob) => createImageBitmap(blob),
};
