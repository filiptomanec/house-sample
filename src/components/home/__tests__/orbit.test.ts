// The orbit captions are bound to what the camera sees: the azimuth arithmetic, the features of the model and, for the real orbit
// and for orbits that start elsewhere or turn the other way, that every caption names a feature on the camera's side of the house.
import { describe, expect, it } from "vitest";
import { media } from "@/lib/data/media";
import { derived, house, metrics } from "@/lib/model/instance";
import renderJson from "@model/render.json";
import { bestViewAzimuth, homeFacts, orbitFeatures, orbitRadiusOf, ORBIT_FEATURES, type OrbitFeature } from "../homeFacts";
import { orbitPath } from "../mediaExtras";
import { angleDiff, azimuthOf, CAPTION_HALF_WINDOW, captionAt, meanAzimuth, mod360, orbitAzimuthAt, orbitOrder, type OrbitPath } from "../timeline";

const facts = homeFacts(house, derived, metrics, 1000);
const real: OrbitPath = orbitPath(media, {
  startAzimuthDeg: renderJson.orbit.startAzimuthDeg,
  direction: renderJson.orbit.direction as OrbitPath["direction"],
  halfWindowDeg: (renderJson.orbit as { captions?: { halfWindowDeg?: number } }).captions?.halfWindowDeg,
});
const frames = media.orbit.frames;
const dirOf = (az: number) => [Math.sin((az * Math.PI) / 180), Math.cos((az * Math.PI) / 180)];
const dot = (a: number[], b: number[]) => a[0] * b[0] + a[1] * b[1];

describe("azimuth arithmetic", () => {
  it("wraps angles into 0..360 and takes signed differences the short way round", () => {
    expect([mod360(-10), mod360(370), mod360(720), mod360(0)]).toEqual([350, 10, 0, 0]);
    expect(angleDiff(10, 350)).toBeCloseTo(20, 9);
    expect(angleDiff(350, 10)).toBeCloseTo(-20, 9);
    expect(Math.abs(angleDiff(0, 180))).toBe(180);
  });

  it("averages azimuths on the circle", () => {
    expect(meanAzimuth([350, 10])).toBeCloseTo(0, 6);
    expect(meanAzimuth([90, 180])).toBeCloseTo(135, 6);
    expect(meanAzimuth([270])).toBeCloseTo(270, 6);
  });

  it("measures house azimuths clockwise from +y, like the render cameras", () => {
    expect(azimuthOf([0, 0], [0, 5])).toBeCloseTo(0, 9);
    expect(azimuthOf([0, 0], [5, 0])).toBeCloseTo(90, 9);
    expect(azimuthOf([0, 0], [0, -5])).toBeCloseTo(180, 9);
    expect(azimuthOf([0, 0], [-5, 0])).toBeCloseTo(270, 9);
  });

  it("turns the camera from its start in the direction of the orbit, degPerFrame per scroll frame", () => {
    const ccw: OrbitPath = { startAzimuthDeg: 215, direction: "counterclockwise", degPerFrame: 6 };
    expect(orbitAzimuthAt(0, ccw)).toBe(215);
    expect(orbitAzimuthAt(1, ccw)).toBe(209);
    expect(orbitAzimuthAt(60, ccw)).toBeCloseTo(215, 9);
    expect(orbitAzimuthAt(2.5, { ...ccw, direction: "clockwise" })).toBe(230);
  });
});

describe("captionAt", () => {
  const o: OrbitPath = { startAzimuthDeg: 0, direction: "clockwise", degPerFrame: 10 };
  const caps = [{ az: 20 }, { az: 90 }, { az: 200 }];

  it("shows the feature nearest to the camera, and nothing when every feature is farther than the window", () => {
    expect(captionAt(0, caps, o)).toBe(0);
    expect(captionAt(6, caps, o)).toBe(1);
    expect(captionAt(14, caps, o)).toBe(1); // 140°: 50° from 90 is still inside the window
    expect(captionAt(14.5, caps, o)).toBe(-1); // 145°: 55° from both 90 and 200
    expect(captionAt(15, caps, o)).toBe(2);
    expect(captionAt(30, caps, o)).toBe(-1);
  });

  it("respects the window it is given", () => {
    expect(captionAt(4, caps, o, 10)).toBe(-1);
    expect(captionAt(4, caps, o, 30)).toBe(0);
    expect(captionAt(0, [], o)).toBe(-1);
  });

  it("orders captions as the camera first shows them, starting with what frame 0 shows", () => {
    expect(orbitOrder([{ az: 200 }, { az: 90 }, { az: 350 }, { az: 20 }], o).map((c) => c.az)).toEqual([350, 20, 90, 200]);
    expect(orbitOrder([{ az: 200 }, { az: 90 }, { az: 20 }], { ...o, direction: "counterclockwise" }).map((c) => c.az)).toEqual([20, 200, 90]);
    // a feature hidden behind a nearer one never shows: it goes last
    expect(orbitOrder([{ az: 270, k: 1 }, { az: 90, k: 2 }, { az: 90, k: 3 }], o).map((c) => c.k)).toEqual([2, 1, 3]);
  });
});

describe("orbit features of the model", () => {
  it("finds each feature by the type of the outdoor area, the kind of the opening or the panels on the roof", () => {
    const keys = facts.features.map((f) => f.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const k of keys) expect(ORBIT_FEATURES).toContain(k);
    expect(keys.includes("terrace")).toBe(derived.outdoor.some((o) => o.type === "terrace"));
    expect(keys.includes("pool")).toBe(derived.outdoor.some((o) => o.pool !== null));
    expect(keys.includes("entry")).toBe(derived.openings.some((o) => o.kind === "entry" && o.exterior));
    expect(keys.includes("garage")).toBe(derived.openings.some((o) => o.kind === "garage" && o.exterior));
  });

  it("aims at the middle of the building's plan box, as the render pipeline does", () => {
    const b = derived.bbox;
    expect(facts.orbitCentre).toEqual([(b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2]);
  });

  it("gives a facade feature a best view between its direction and its outward normal", () => {
    for (const f of facts.features) {
      const dir = azimuthOf(facts.orbitCentre, f.at);
      if (f.normal === null) expect(f.az).toBeCloseTo(dir, 6);
      else {
        expect(Math.abs(angleDiff(f.az, dir))).toBeLessThanOrEqual(Math.abs(angleDiff(f.normal, dir)) + 1e-6);
        expect(Math.abs(angleDiff(f.az, f.normal))).toBeLessThanOrEqual(90);
      }
    }
  });

  it("uses the render pipeline's rule for the best view: the camera on the outward normal at the orbit radius", () => {
    const R = facts.orbitRadius;
    expect(R).toBeCloseTo(orbitRadiusOf(derived.bbox), 9);
    for (const f of facts.features) {
      // independent of homeFacts: the point R metres out along the normal, seen from the centre
      const expected = f.normal === null ? azimuthOf(facts.orbitCentre, f.at)
        : azimuthOf(facts.orbitCentre, [f.at[0] + R * Math.sin((f.normal * Math.PI) / 180), f.at[1] + R * Math.cos((f.normal * Math.PI) / 180)]);
      expect(f.az).toBeCloseTo(expected, 6);
    }
    // a far camera looks along the normal; a camera on the feature looks at it
    expect(bestViewAzimuth([0, 0], [10, 0], 0, 1e7)).toBeCloseTo(0, 3);
    expect(bestViewAzimuth([0, 0], [10, 0], 0, 0)).toBeCloseTo(90, 9);
    expect(bestViewAzimuth([0, 0], [10, 0], null, 50)).toBeCloseTo(90, 9);
  });

  it("puts the orbit radius outside the building (the camera never stands on the house)", () => {
    const b = derived.bbox;
    expect(facts.orbitRadius).toBeGreaterThan(Math.hypot(b.x1 - b.x0, b.y1 - b.y0) / 2);
  });

  it("drops what the model does not have", () => {
    const bare = orbitFeatures({ ...derived, outdoor: [], openings: [], roofPlanes: [], pv: { ...derived.pv, panels: [], count: 0 } }, facts.orbitCentre);
    expect(bare).toEqual([]);
  });
});

/** The camera at azimuth `cam` sees a feature when it is on the near half of the plot and on the outward side of its facade. */
function visible(cam: number, f: OrbitFeature, centre: [number, number]): boolean {
  const toCam = dirOf(cam);
  const near = dot(toCam, dirOf(azimuthOf(centre, f.at))) > 0;
  const outward = f.normal === null || dot(toCam, dirOf(f.normal)) > 0;
  return near && outward;
}

describe.each([
  ["the rendered orbit", real],
  ["an orbit from the south-west turning clockwise", { ...real, startAzimuthDeg: 225, direction: "clockwise" as const }],
  ["an orbit from the north", { ...real, startAzimuthDeg: 10 }],
])("captions of %s", (_name, path: OrbitPath) => {
  const caps = orbitOrder(facts.features, path);
  const shown = Array.from({ length: frames * 4 }, (_, k) => captionAt(k / 4, caps, path));

  it("name only a feature the camera sees (captions match the visible feature)", () => {
    shown.forEach((i, k) => {
      if (i < 0) return;
      const cam = orbitAzimuthAt(k / 4, path);
      expect(visible(cam, caps[i], facts.orbitCentre), `${caps[i].key} at camera azimuth ${cam.toFixed(0)}`).toBe(true);
      expect(Math.abs(angleDiff(cam, caps[i].az))).toBeLessThanOrEqual(path.halfWindowDeg ?? CAPTION_HALF_WINDOW);
    });
  });

  it("show every feature at some point of the turn", () => {
    expect(new Set(shown.filter((i) => i >= 0)).size).toBe(caps.length);
  });

  it("appear in the order of the list (each caption comes once, the one of frame 0 may come back at the end)", () => {
    const runs = shown.filter((i, k) => i >= 0 && i !== shown[k - 1]);
    const firstPass = runs.filter((i, k) => runs.indexOf(i) === k);
    expect(firstPass).toEqual([...firstPass].sort((a, b) => a - b));
  });
});
