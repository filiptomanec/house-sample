// The compositor-driven player of the day sequence: two stacked canvases, the cross-fade is the opacity of the upper one, a canvas
// is drawn only when its frame changes (the two swap places when the pair moves on), and each backing store is the shown part of
// the frame (scaled to the screen by the compositor).
import { describe, expect, it } from "vitest";
import { assignLayers, blendAt, blendLayers, canvasScale, frameAt, layerKey, layerSize, stackLayers, type BlendLayer } from "../timeline";

/** Weight of every frame in a picture drawn layer by layer (source-over): what the viewer sees. */
function weights(layers: readonly BlendLayer[]): Map<number, number> {
  const w = new Map<number, number>();
  for (const l of layers) {
    for (const [k, v] of w) w.set(k, v * (1 - l.alpha));
    w.set(l.index, (w.get(l.index) ?? 0) + l.alpha);
  }
  return w;
}

/** The two-canvas player of ScrollFrames, without the DOM: counts drawings and returns the picture it composes. */
function player() {
  const have: [string, string] = ["", ""];
  const contents: [BlendLayer[], BlendLayer[]] = [[], []];
  let lower: 0 | 1 = 0, draws = 0, swaps = 0;
  const show = (layers: BlendLayer[]) => {
    const stack = stackLayers(layers);
    const bk = layerKey(stack.bottom), tk = layerKey(stack.top);
    const b = assignLayers(have, bk, tk, lower), t = b === 0 ? 1 : 0;
    if (b !== lower) { lower = b; swaps++; }
    if (have[b] !== bk) { have[b] = bk; contents[b] = stack.bottom; draws += stack.bottom.length; }
    if (tk && have[t] !== tk) { have[t] = tk; contents[t] = stack.top; draws += stack.top.length; }
    const top = tk ? stack.opacity : 0;
    // the compositor: the bottom canvas whole, the top canvas (its own picture) over it at its opacity
    const picture = weights(contents[b]);
    for (const [k, v] of picture) picture.set(k, v * (1 - top));
    for (const [k, v] of weights(contents[t])) picture.set(k, (picture.get(k) ?? 0) + v * top);
    return picture;
  };
  return { show, get draws() { return draws; }, get swaps() { return swaps; } };
}

const close = (a: Map<number, number>, b: Map<number, number>) => {
  for (const k of new Set([...a.keys(), ...b.keys()])) expect(Math.abs((a.get(k) ?? 0) - (b.get(k) ?? 0))).toBeLessThan(1e-9);
};

describe("backing store of a layer (layerSize)", () => {
  it("is the shown part of a portrait frame on a phone, not the viewport times its pixel ratio", () => {
    // 402 x 874 CSS px at 3x (1206 x 2622 device px): the cover crop of a 1080 x 1620 frame
    expect(layerSize(402, 874, 3, 1080, 1620)).toEqual({ width: 745, height: 1620 });
  });

  it("is never finer than 2 device pixels per CSS pixel, as before (canvasScale)", () => {
    for (const [w, h, dpr, fw, fh] of [[393, 659, 3, 1080, 1620], [1440, 900, 2, 1920, 1080], [800, 600, 1, 1920, 1080], [402, 874, 3, 1080, 1620]]) {
      const s = canvasScale(w, h, dpr, fw, fh);
      expect(layerSize(w, h, dpr, fw, fh)).toEqual({ width: Math.round(w * s), height: Math.round(h * s) });
    }
  });

  it("keeps a frame smaller than the screen at its own pixels (the compositor scales it up)", () => {
    expect(layerSize(2560, 1440, 1, 1920, 1080)).toEqual({ width: 1920, height: 1080 });
  });
});

describe("two stacked canvases (stackLayers, assignLayers)", () => {
  it("puts frame i on the bottom canvas and frame i + 1 on the top one at the blend fraction", () => {
    expect(stackLayers([{ index: 3, alpha: 1 }, { index: 4, alpha: 0.25 }])).toEqual({ bottom: [{ index: 3, alpha: 1 }], top: [{ index: 4, alpha: 1 }], opacity: 0.25 });
    expect(stackLayers([{ index: 3, alpha: 1 }])).toEqual({ bottom: [{ index: 3, alpha: 1 }], top: [], opacity: 0 });
    expect(stackLayers([])).toEqual({ bottom: [], top: [], opacity: 0 });
  });

  it("holds the pair in the top canvas while it fades in over a late frame, and composes the same picture", () => {
    const layers = blendLayers({ base: 5, over: 6, t: 0.4 }, 2, 0.5).layers;
    const s = stackLayers(layers);
    expect(s.bottom).toEqual([{ index: 2, alpha: 1 }]);
    expect(s.top.map((l) => l.index)).toEqual([5, 6]);
    expect(s.top[1].alpha).toBeCloseTo(0.4);
    expect(s.opacity).toBeCloseTo(0.5);
  });

  it("keeps the canvas that already holds a wanted frame (the two swap places), and the order otherwise", () => {
    expect(assignLayers(["5:128", "6:128"], "6:128", "7:128", 0)).toBe(1);
    expect(assignLayers(["5:128", "6:128"], "4:128", "5:128", 1)).toBe(1);
    expect(assignLayers(["5:128", "6:128"], "5:128", "6:128", 0)).toBe(0);
    expect(assignLayers(["5:128", "6:128"], "6:128", "", 0)).toBe(1);
    expect(assignLayers(["", ""], "0:128", "1:128", 0)).toBe(0);
  });
});

describe("the player over a scroll", () => {
  const n = 32;
  const run = (positions: number[]) => {
    const p = player();
    let changes = 0, prev = -1;
    for (const f of positions) {
      const { i0, i1, t } = blendAt(f, n);
      const { layers } = blendLayers({ base: i0, over: i1, t });
      close(p.show(layers), weights(layers));
      const pair = i0 + (t > 0 ? 0.5 : 0); // a new frame is needed when i0 moves or i1 first shows
      if (pair !== prev) { changes++; prev = pair; }
    }
    return { draws: p.draws, changes };
  };

  it("draws once per frame change, never per animation frame, and shows exactly the cross-fade", () => {
    // a slow scroll: 4000 animation frames over the sequence, forwards and back
    const slow = Array.from({ length: 4001 }, (_, k) => frameAt(k / 4000, n));
    const r = run([...slow, ...slow.slice().reverse()]);
    expect(r.draws).toBeLessThanOrEqual(2 * 2 * (n - 1) + 2);
    expect(r.draws).toBeGreaterThan(0);
  });

  it("draws at most two canvases when a fast scroll skips frames", () => {
    const fast = Array.from({ length: 21 }, (_, k) => frameAt(k / 20, n)); // about 1.5 frames per animation frame
    const r = run([...fast, ...fast.slice().reverse()]);
    expect(r.draws).toBeLessThanOrEqual(2 * fast.length * 2);
    expect(r.draws).toBeLessThanOrEqual(2 * r.changes + 2);
  });
});
