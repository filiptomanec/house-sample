// The cross-fade of the day sequence: which two frames blend at a scroll position and by how much, the fade-in of a frame that
// arrives late, the decode window that always holds the pair, and the HUD (clock, sun) that glides with the picture.
import { describe, expect, it } from "vitest";
import { sunAtFrame, type SunSpot } from "../sunArc";
import { ARRIVAL_FADE_MS, arrivalFade, blendAt, blendLayers, decodeWindow, frameAt, minuteAtFrame } from "../timeline";

// unevenly spaced in time, like the real sequence (denser at dusk)
const minutes = [360, 420, 480, 540, 600, 660, 720, 780, 840, 900, 960, 1000, 1030, 1050, 1065, 1080, 1095, 1110, 1140, 1200];
const sun: SunSpot[] = minutes.map((m) => ({ az: 60 + (m - 360) / 4, alt: 40 * Math.sin((Math.PI * (m - 360)) / 900) }));
const n = minutes.length;

describe("blend fraction (blendAt)", () => {
  it("draws frame i whole and frame i + 1 over it at the fraction of the scroll between them", () => {
    expect(blendAt(0, n)).toEqual({ i0: 0, i1: 1, t: 0 });
    expect(blendAt(3.25, n)).toEqual({ i0: 3, i1: 4, t: 0.25 });
    expect(blendAt(7.999, n).i0).toBe(7);
    expect(blendAt(8, n)).toEqual({ i0: 8, i1: 9, t: 0 });
  });

  it("ends the sequence on the last pair at t = 1 and clamps outside it", () => {
    expect(blendAt(n - 1, n)).toEqual({ i0: n - 2, i1: n - 1, t: 1 });
    expect(blendAt(99, n)).toEqual({ i0: n - 2, i1: n - 1, t: 1 });
    expect(blendAt(-2, n)).toEqual({ i0: 0, i1: 1, t: 0 });
    expect(blendAt(0, 1)).toEqual({ i0: 0, i1: 0, t: 0 });
  });

  it("is continuous over the whole scroll: the picture never jumps from one frame to the next", () => {
    let prev = blendAt(0, n);
    for (let k = 1; k <= 4000; k++) {
      const b = blendAt(frameAt(k / 4000, n), n);
      const shown = (x: typeof b) => x.i0 + x.t; // the frame the blend shows
      expect(Math.abs(shown(b) - shown(prev))).toBeLessThan(0.01);
      prev = b;
    }
  });
});

describe("decode window of the cross-fade", () => {
  it("always starts with i0, i1 and the next frame in the scroll direction", () => {
    for (const capacity of [1, 3, 5, 6, 20]) {
      expect(decodeWindow(1, true, capacity).slice(0, 3)).toEqual([0, 1, 2]);
      expect(decodeWindow(-1, true, capacity).slice(0, 3)).toEqual([0, 1, -1]);
    }
  });
});

describe("arrival fade and the layers on the canvas (blendLayers)", () => {
  it("eases in over ARRIVAL_FADE_MS", () => {
    expect(arrivalFade(0)).toBe(0);
    expect(arrivalFade(ARRIVAL_FADE_MS / 2)).toBeCloseTo(0.5, 9);
    expect(arrivalFade(ARRIVAL_FADE_MS)).toBe(1);
    expect(arrivalFade(10 * ARRIVAL_FADE_MS)).toBe(1);
    expect(arrivalFade(-5)).toBe(0);
    expect(arrivalFade(1, 0)).toBe(1);
  });

  it("draws the pair as it is when nothing fades", () => {
    expect(blendLayers({ base: 4, over: 5, t: 0.3 })).toEqual({ layers: [{ index: 4, alpha: 1 }, { index: 5, alpha: 0.3 }], drawn: 4.3 });
    // the next frame is not decoded: frame i alone
    expect(blendLayers({ base: 4, over: -1, t: 0.3 })).toEqual({ layers: [{ index: 4, alpha: 1 }], drawn: 4 });
    expect(blendLayers({ base: -1, over: -1, t: 0 })).toEqual({ layers: [], drawn: 0 });
  });

  it("fades a late frame i + 1 in over frame i instead of popping to alpha t", () => {
    const start = blendLayers({ base: 4, over: 5, t: 0.6 }, 4, 0);
    expect(start.drawn).toBe(4);
    expect(start.layers).toEqual([{ index: 4, alpha: 1 }]);
    const mid = blendLayers({ base: 4, over: 5, t: 0.6 }, 4, 0.5);
    expect(mid.layers).toEqual([{ index: 4, alpha: 1 }, { index: 5, alpha: 0.3 }]);
    expect(mid.drawn).toBeCloseTo(4.3, 9);
    expect(blendLayers({ base: 4, over: 5, t: 0.6 }, 4, 1)).toEqual(blendLayers({ base: 4, over: 5, t: 0.6 }));
  });

  it("fades from another frame that stood alone (frame i was not decoded either)", () => {
    const mid = blendLayers({ base: 6, over: 7, t: 0.5 }, 3, 0.5);
    expect(mid.layers).toEqual([{ index: 3, alpha: 1 }, { index: 6, alpha: 0.5 }, { index: 7, alpha: 0.25 }]);
    expect(mid.drawn).toBeCloseTo(3 + (6.5 - 3) * 0.5, 9);
  });

  it("moves the drawn position continuously through a fade", () => {
    let prev = blendLayers({ base: 4, over: 5, t: 0.8 }, 4, 0).drawn;
    for (let ms = 4; ms <= ARRIVAL_FADE_MS; ms += 4) {
      const d = blendLayers({ base: 4, over: 5, t: 0.8 }, 4, arrivalFade(ms)).drawn;
      expect(d).toBeGreaterThanOrEqual(prev);
      expect(d - prev).toBeLessThan(0.05);
      prev = d;
    }
    expect(prev).toBeCloseTo(4.8, 9);
  });
});

describe("HUD interpolated with the picture", () => {
  it("shows the clock and the sun between the two frames' times by the blend fraction", () => {
    const { drawn } = blendLayers({ base: 11, over: 12, t: 0.5 });
    expect(minuteAtFrame(minutes, drawn)).toBe(1015); // halfway between 1000 and 1030
    const s = sunAtFrame(sun, drawn);
    expect(s.az).toBeCloseTo((sun[11].az + sun[12].az) / 2, 9);
    expect(s.alt).toBeCloseTo((sun[11].alt + sun[12].alt) / 2, 9);
  });

  it("glides over the whole scroll: no step of the clock or the sun is larger than the scroll step allows", () => {
    const steps = 3000;
    let prevMin = minuteAtFrame(minutes, 0), prevSun = sunAtFrame(sun, 0);
    for (let k = 1; k <= steps; k++) {
      const { i0, i1, t } = blendAt(frameAt(k / steps, n), n);
      const { drawn } = blendLayers({ base: i0, over: i1, t });
      const m = minuteAtFrame(minutes, drawn), s = sunAtFrame(sun, drawn);
      // a step of the scroll is (n - 1) / steps of a frame; the widest gap between two frames is 60 minutes
      expect(m - prevMin).toBeGreaterThanOrEqual(0);
      expect(m - prevMin).toBeLessThanOrEqual((60 * (n - 1)) / steps + 1e-9);
      expect(Math.abs(s.az - prevSun.az)).toBeLessThan(1);
      prevMin = m; prevSun = s;
    }
    expect(prevMin).toBe(minutes[n - 1]);
  });

  it("holds the clock on frame i while i + 1 is missing, then glides it in with the fade", () => {
    const alone = blendLayers({ base: 11, over: -1, t: 0.5 }).drawn;
    expect(minuteAtFrame(minutes, alone)).toBe(1000);
    const half = blendLayers({ base: 11, over: 12, t: 0.5 }, 11, 0.5).drawn;
    expect(minuteAtFrame(minutes, half)).toBeCloseTo(1007.5, 9);
  });
});
