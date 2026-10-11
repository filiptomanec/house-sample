// The worker client with a fake worker: the probe, request order, at most two decodes at once, cancellation, the main-thread
// fallback, the diagnostic timings and the shared worker's lifecycle.
import { afterEach, describe, expect, it, vi } from "vitest";
import { decoderMode, FrameDecoder, MAX_IN_FLIGHT, releaseDecoder, retainDecoder, type WorkerLike } from "../frameDecoder";
import type { PerfSink } from "../perfSink";

class FakeBitmap {
  closed = false;
  constructor(readonly id: number) {}
  close() { this.closed = true; }
}

type Sent = { t: string; id: number; blob?: Blob };

class FakeWorker implements WorkerLike {
  onmessage: ((e: MessageEvent) => void) | null = null;
  onerror: ((e: ErrorEvent) => void) | null = null;
  sent: Sent[] = [];
  terminated = false;
  postMessage(message: unknown) { this.sent.push(message as Sent); }
  terminate() { this.terminated = true; }
  reply(data: unknown) { this.onmessage?.({ data } as MessageEvent); }
  ready(ok = true) { this.reply({ t: "ready", ok }); }
  /** Ids of the decodes sent so far, in order. */
  decodes() { return this.sent.filter((m) => m.t === "decode").map((m) => m.id); }
  cancels() { return this.sent.filter((m) => m.t === "cancel").map((m) => m.id); }
  finish(id: number) { const b = new FakeBitmap(id); this.reply({ t: "done", id, bitmap: b }); return b; }
}

function setup(worker: FakeWorker | null | "throws" = new FakeWorker()) {
  let now = 0;
  const spans: { kind: string; ms: number }[] = [];
  const perf: PerfSink = { now: () => now, span: (kind, t0) => { if (t0 !== undefined) spans.push({ kind, ms: now - t0 }); }, mark: () => undefined, seq: () => undefined };
  const main: { blob: Blob; resolve: (b: FakeBitmap) => void }[] = [];
  const decoder = new FrameDecoder<FakeBitmap>({
    createWorker: () => { if (worker === "throws") throw new Error("blocked"); return worker; },
    decodeOnMain: (blob) => new Promise((resolve) => main.push({ blob, resolve })),
    readyTimeoutMs: 20,
    perf: () => perf,
  });
  const blobs = Array.from({ length: 5 }, (_, i) => new Blob([String(i)]));
  return { decoder, worker: worker === "throws" ? null : worker, main, spans, blobs, tick: (ms: number) => { now += ms; } };
}

const settle = () => new Promise((r) => setTimeout(r, 0));

describe("FrameDecoder", () => {
  it("waits for the worker's probe, then decodes in request order, at most two at a time", async () => {
    const t = setup(), w = t.worker!;
    expect(t.decoder.mode).toBe("probe");
    const results = t.blobs.slice(0, 4).map((b) => t.decoder.decode(b));
    expect(w.decodes()).toEqual([]); // nothing goes out before the worker has shown it can decode
    w.ready();
    expect(t.decoder.mode).toBe("worker");
    expect(MAX_IN_FLIGHT).toBe(2);
    expect(w.decodes()).toEqual([1, 2]);
    expect(w.sent[0].blob).toBe(t.blobs[0]);
    const second = w.finish(2); // answers may come in any order; each goes to its own request
    expect(w.decodes()).toEqual([1, 2, 3]);
    expect(t.decoder.inFlight).toBe(2);
    const first = w.finish(1);
    w.finish(3);
    w.finish(4);
    expect(await Promise.all(results)).toEqual([first, second, expect.objectContaining({ id: 3 }), expect.objectContaining({ id: 4 })]);
    expect(t.decoder.inFlight + t.decoder.waiting).toBe(0);
    t.decoder.dispose();
    expect(w.terminated).toBe(true);
  });

  it("drops a waiting request at once and lets the worker drop a running one", async () => {
    const t = setup(), w = t.worker!;
    w.ready();
    const ctrls = t.blobs.slice(0, 3).map(() => new AbortController());
    const results = t.blobs.slice(0, 3).map((b, i) => t.decoder.decode(b, ctrls[i].signal));
    results.forEach((p) => p.catch(() => undefined));
    ctrls[2].abort(); // still waiting: never sent
    await expect(results[2]).rejects.toMatchObject({ name: "AbortError" });
    ctrls[0].abort(); // running: the worker is told, the promise rejects now, the slot stays taken until the worker answers
    await expect(results[0]).rejects.toMatchObject({ name: "AbortError" });
    expect(w.cancels()).toEqual([1]);
    expect(t.decoder.inFlight).toBe(2);
    const late = t.decoder.decode(t.blobs[3]);
    expect(w.decodes()).toEqual([1, 2]);
    const raced = w.finish(1); // the bitmap was already on its way: it is closed, not delivered
    expect(raced.closed).toBe(true);
    expect(w.decodes()).toEqual([1, 2, 4]);
    await expect(t.decoder.decode(t.blobs[4], AbortSignal.abort())).rejects.toMatchObject({ name: "AbortError" });
    w.reply({ t: "done", id: 2, error: "bad file" });
    await expect(results[1]).rejects.toThrow("bad file");
    w.finish(4);
    await expect(late).resolves.toMatchObject({ id: 4 });
  });

  it("decodes on the main thread when there is no worker, it cannot decode, it fails or it stays silent", async () => {
    for (const worker of [null, "throws"] as const) {
      const t = setup(worker);
      expect(t.decoder.mode).toBe("main");
      t.blobs.slice(0, 3).forEach((b) => void t.decoder.decode(b));
      expect(t.main.map((m) => m.blob)).toEqual(t.blobs.slice(0, 2)); // the same queue: two at a time
    }

    const refused = setup(), wr = refused.worker!;
    const p = refused.decoder.decode(refused.blobs[0]);
    wr.ready(false);
    expect(refused.decoder.mode).toBe("main");
    expect(wr.terminated).toBe(true);
    refused.main[0].resolve(new FakeBitmap(7));
    await expect(p).resolves.toMatchObject({ id: 7 });

    const crashed = setup(), wc = crashed.worker!;
    wc.ready();
    const a = crashed.decoder.decode(crashed.blobs[0]), b = crashed.decoder.decode(crashed.blobs[1]);
    crashed.decoder.decode(crashed.blobs[2]).catch(() => undefined);
    wc.onerror?.({} as ErrorEvent); // what the worker had starts again on the main thread, first
    expect(crashed.decoder.mode).toBe("main");
    expect(crashed.main.map((m) => m.blob)).toEqual(crashed.blobs.slice(0, 2));
    crashed.main[0].resolve(new FakeBitmap(10));
    crashed.main[1].resolve(new FakeBitmap(11));
    await expect(Promise.all([a, b])).resolves.toEqual([expect.objectContaining({ id: 10 }), expect.objectContaining({ id: 11 })]);

    const silent = setup();
    silent.decoder.decode(silent.blobs[0]).catch(() => undefined);
    await vi.waitFor(() => expect(silent.decoder.mode).toBe("main"));
    expect(silent.worker!.terminated).toBe(true);
    expect(silent.main).toHaveLength(1);
  });

  it("reports the main thread's share of a decode and its latency for the diagnostic mode", async () => {
    const t = setup(), w = t.worker!;
    w.ready();
    const p = t.decoder.decode(t.blobs[0]);
    t.tick(40);
    w.finish(1);
    await p;
    expect(t.spans).toEqual([{ kind: "decodeLatency", ms: 40 }, { kind: "decode", ms: 0 }]);

    const m = setup(null);
    const q = m.decoder.decode(m.blobs[0]);
    m.tick(25);
    m.main[0].resolve(new FakeBitmap(1));
    await q;
    expect(m.spans).toEqual([{ kind: "decode", ms: 25 }, { kind: "decodeLatency", ms: 25 }]);
  });

  it("rejects what is pending when disposed and closes bitmaps that arrive afterwards", async () => {
    const t = setup(null);
    const p = t.decoder.decode(t.blobs[0]);
    t.decoder.dispose();
    await expect(p).rejects.toMatchObject({ name: "AbortError" });
    const late = new FakeBitmap(1);
    t.main[0].resolve(late);
    await settle();
    expect(late.closed).toBe(true);
    await expect(t.decoder.decode(t.blobs[1])).rejects.toMatchObject({ name: "AbortError" });
  });
});

describe("the shared decoder", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("runs one worker for all players and terminates it after the last one", () => {
    const made: FakeWorker[] = [];
    vi.stubGlobal("Worker", class extends FakeWorker { constructor() { super(); made.push(this); } });
    const revoke = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:worker");
    expect(decoderMode()).toBeNull();
    retainDecoder();
    retainDecoder();
    expect(made).toHaveLength(1);
    expect(decoderMode()).toBe("probe");
    made[0].ready();
    expect(decoderMode()).toBe("worker");
    releaseDecoder();
    expect(made[0].terminated).toBe(false);
    releaseDecoder();
    expect(made[0].terminated).toBe(true);
    expect(revoke).toHaveBeenCalledWith("blob:worker");
    expect(decoderMode()).toBeNull();
    vi.restoreAllMocks();
  });
});
