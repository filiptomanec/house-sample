// FrameStore with fake network and decoding: order, concurrency, retries, the decode window, the bitmap budget and clean-up.
import { describe, expect, it, vi } from "vitest";
import { FrameStore, type Bitmap, type FrameDeps } from "../frames";
import { loadOrder } from "../timeline";

class FakeBitmap implements Bitmap {
  closed = false;
  constructor(readonly width: number, readonly height: number, readonly id: number) {}
  close() { this.closed = true; }
}

/** Fake network: every request waits until the test releases it, so concurrency can be observed. */
function setup(n: number, opts: { capacity?: number; failFirst?: ReadonlySet<number>; retryDelayMs?: number; onProgress?: (settled: number, total: number) => void } = {}) {
  const urls = Array.from({ length: n }, (_, i) => `/f/${i}`);
  const started: number[] = [];
  const pending = new Map<number, () => void>();
  const attempts = new Map<number, number>();
  let inflight = 0, peak = 0;
  const bitmaps: FakeBitmap[] = [];
  const deps: FrameDeps<FakeBitmap> = {
    fetchBlob: (url, signal) => new Promise((resolve, reject) => {
      const i = Number(url.split("/")[2]);
      started.push(i);
      attempts.set(i, (attempts.get(i) ?? 0) + 1);
      inflight++; peak = Math.max(peak, inflight);
      signal.addEventListener("abort", () => { inflight--; reject(new Error("aborted")); });
      pending.set(i, () => {
        inflight--;
        if (opts.failFirst?.has(i) && attempts.get(i) === 1) resolve(null);
        else resolve(new Blob([String(i)]));
      });
    }),
    decode: async (blob) => {
      const b = new FakeBitmap(10, 10, Number(await blob.text()));
      bitmaps.push(b);
      return b;
    },
  };
  const decoded: number[] = [];
  const store = new FrameStore(urls, deps, { capacity: opts.capacity ?? 6, retryDelayMs: opts.retryDelayMs ?? 0, onDecoded: (i) => decoded.push(i), onProgress: opts.onProgress });
  const release = async (i: number) => { pending.get(i)?.(); pending.delete(i); await vi.waitFor(() => undefined); await Promise.resolve(); };
  const releaseAll = async () => { while (pending.size) for (const i of [...pending.keys()]) await release(i); await new Promise((r) => setTimeout(r, 5)); };
  return { store, started, pending, bitmaps, decoded, release, releaseAll, peak: () => peak, attempts };
}

describe("FrameStore", () => {
  it("downloads at most four frames at a time, coarse to fine", async () => {
    const t = setup(30);
    t.store.start();
    expect(t.started).toEqual(loadOrder(30).slice(0, 4));
    expect(t.peak()).toBe(4);
    await t.releaseAll();
    expect(t.peak()).toBe(4);
    expect(t.started).toEqual(loadOrder(30));
    expect(t.store.loadedCount).toBe(30);
    t.store.dispose();
  });

  it("fetches only the first frames of the load order when started with a limit, the rest when started again", async () => {
    const t = setup(30);
    t.store.start(5);
    await t.releaseAll();
    expect(t.started).toEqual(loadOrder(30).slice(0, 5));
    expect(t.store.started).toBe(true);
    t.store.start(3); // a smaller limit changes nothing
    await t.releaseAll();
    expect(t.started).toHaveLength(5);
    t.store.start();
    await t.releaseAll();
    expect(t.started).toEqual(loadOrder(30));
    t.store.dispose();
  });

  it("reports every finished download, failed ones included, until all have settled", async () => {
    const seen: [number, number][] = [];
    const t = setup(6, { failFirst: new Set([2]), retryDelayMs: 0, onProgress: (s, n) => seen.push([s, n]) });
    t.store.start();
    await t.releaseAll();
    await t.releaseAll();
    expect(seen.map(([s]) => s)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(seen.every(([, n]) => n === 6)).toBe(true);
    t.store.dispose();
  });

  it("starts only once", () => {
    const t = setup(10);
    t.store.start();
    t.store.start();
    expect(t.started).toHaveLength(4);
    t.store.dispose();
  });

  it("decodes only the neighbourhood of the current frame", async () => {
    const t = setup(30);
    t.store.setCurrent(8);
    t.store.start();
    await t.releaseAll();
    const have = Array.from({ length: 30 }, (_, i) => i).filter((i) => t.store.has(i));
    expect(have.length).toBeGreaterThan(0);
    expect(have.every((i) => Math.abs(i - 8) <= 2)).toBe(true);
    expect(t.store.loadedCount).toBe(30); // everything is downloaded, little is decoded
    t.store.dispose();
  });

  it("decodes frames that have arrived when the viewer moves to them", async () => {
    const t = setup(30);
    t.store.start();
    await t.releaseAll();
    expect(t.store.decodedCount).toBeLessThanOrEqual(3); // only the start of the sequence, where the viewer was
    t.store.setCurrent(20, [-1, 0, 1]);
    await vi.waitFor(() => expect([19, 20, 21].every((i) => t.store.has(i))).toBe(true));
    t.store.dispose();
  });

  it("keeps no more than `capacity` bitmaps and closes the ones it drops, farthest first", async () => {
    const t = setup(40, { capacity: 3 });
    t.store.start();
    await t.releaseAll();
    for (const i of [2, 10, 18, 26, 34]) {
      t.store.setCurrent(i, [-1, 0, 1]);
      await vi.waitFor(() => expect([i - 1, i, i + 1].every((k) => t.store.has(k))).toBe(true));
      expect(t.store.decodedCount).toBeLessThanOrEqual(3);
    }
    const open = t.bitmaps.filter((b) => !b.closed);
    expect(open).toHaveLength(t.store.decodedCount);
    expect(t.bitmaps.filter((b) => b.closed).length).toBeGreaterThan(0);
    t.store.dispose();
  });

  it("finds the nearest decoded frame while the exact one is still coming", async () => {
    const t = setup(20);
    t.store.setCurrent(0);
    t.store.start();
    await t.release(0);
    await vi.waitFor(() => expect(t.store.has(0)).toBe(true));
    expect(t.store.nearest(9)).toBe(0);
    expect(t.store.nearest(0)).toBe(0);
    t.store.dispose();
  });

  it("retries a failed download and gives the slot back only when it has finished", async () => {
    const t = setup(6, { failFirst: new Set([0]) });
    t.store.setCurrent(0);
    t.store.start();
    await t.releaseAll();
    await vi.waitFor(() => expect(t.attempts.get(0)).toBe(2));
    await t.releaseAll();
    await vi.waitFor(() => expect(t.store.has(0)).toBe(true));
    expect(t.store.loadedCount).toBe(6);
    t.store.dispose();
  });

  it("gives up on a frame after the retries and still loads the others", async () => {
    const urls = ["/f/0", "/f/1", "/f/2"];
    const calls = new Map<string, number>();
    const store = new FrameStore<FakeBitmap>(urls, {
      fetchBlob: async (url) => { calls.set(url, (calls.get(url) ?? 0) + 1); return url === "/f/1" ? null : new Blob(["x"]); },
      decode: async () => new FakeBitmap(1, 1, 0),
    }, { capacity: 3, retries: 2, retryDelayMs: 0 });
    store.start();
    await vi.waitFor(() => expect(store.loadedCount).toBe(2));
    await vi.waitFor(() => expect(calls.get("/f/1")).toBe(3)); // first attempt and two retries
    expect(store.loadedCount).toBe(2);
    store.dispose();
  });

  it("treats a network error like a failed download", async () => {
    let n = 0;
    const store = new FrameStore<FakeBitmap>(["/f/0"], {
      fetchBlob: async () => { if (n++ === 0) throw new Error("offline"); return new Blob(["x"]); },
      decode: async () => new FakeBitmap(1, 1, 0),
    }, { capacity: 3, retryDelayMs: 0 });
    store.start();
    await vi.waitFor(() => expect(store.loadedCount).toBe(1));
    store.dispose();
  });

  it("closes every bitmap and stops fetching when disposed", async () => {
    const t = setup(20);
    t.store.setCurrent(0);
    t.store.start();
    await t.release(0);
    await t.release(8);
    await vi.waitFor(() => expect(t.store.has(0)).toBe(true));
    const before = t.started.length;
    t.store.dispose();
    expect(t.bitmaps.every((b) => b.closed)).toBe(true);
    expect(t.store.decodedCount).toBe(0);
    t.pending.forEach((fn) => fn());
    await new Promise((r) => setTimeout(r, 10));
    expect(t.started.length).toBe(before);
  });

  it("closes a bitmap that finishes decoding after disposal", async () => {
    let finish: (b: FakeBitmap) => void = () => undefined;
    const late = new FakeBitmap(1, 1, 0);
    const store = new FrameStore<FakeBitmap>(["/f/0"], {
      fetchBlob: async () => new Blob(["x"]),
      decode: () => new Promise<FakeBitmap>((resolve) => { finish = resolve; }),
    }, { capacity: 3 });
    store.setCurrent(0);
    store.start();
    await vi.waitFor(() => expect(store.loadedCount).toBe(1));
    store.setCurrent(0);
    store.dispose();
    finish(late);
    await Promise.resolve();
    expect(late.closed).toBe(true);
  });

  it("gives its decoded frames back when released, keeps the files and decodes again on demand", async () => {
    const t = setup(20);
    t.store.setCurrent(0);
    t.store.start();
    await t.releaseAll();
    await vi.waitFor(() => expect(t.store.decodedCount).toBeGreaterThan(0));
    const loaded = t.store.loadedCount;
    t.store.release();
    expect(t.store.decodedCount).toBe(0);
    expect(t.bitmaps.every((b) => b.closed)).toBe(true);
    expect(t.store.loadedCount).toBe(loaded);
    t.store.setCurrent(0);
    await vi.waitFor(() => expect(t.store.has(0)).toBe(true));
    t.store.dispose();
  });

  it("closes a bitmap whose decode was started before a release", async () => {
    let finish: (b: FakeBitmap) => void = () => undefined;
    const late = new FakeBitmap(1, 1, 0);
    const store = new FrameStore<FakeBitmap>(["/f/0"], {
      fetchBlob: async () => new Blob(["x"]),
      decode: () => new Promise<FakeBitmap>((resolve) => { finish = resolve; }),
    }, { capacity: 3 });
    store.setCurrent(0);
    store.start();
    await vi.waitFor(() => expect(store.loadedCount).toBe(1));
    store.setCurrent(0);
    store.release();
    finish(late);
    await Promise.resolve();
    expect(late.closed).toBe(true);
    expect(store.decodedCount).toBe(0);
    store.dispose();
  });
});
