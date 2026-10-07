import { describe, expect, it } from "vitest";
import { derived } from "@/lib/model/instance";
import { dot3, fromScene, headingTrue, houseAzimuth, mod360, outwardNormalHouse, sunDirectionHouse, sunDirectionScene, toScene, trueAzimuth } from "./frame";

const close = (a: readonly number[], b: readonly number[], eps = 1e-9) => a.forEach((v, i) => expect(v).toBeCloseTo(b[i], -Math.log10(eps)));

describe("frames", () => {
  it("maps house to scene and back", () => {
    for (const p of [[1, 2, 3], [-4.5, 0, 0.25], [0, 0, 0]] as const) close(fromScene(toScene(p)), p);
    expect(toScene([1, 2, 3])).toEqual([1, 3, -2]);
  });

  it("keeps a right-handed system: east x north = up in both frames", () => {
    // house: x cross y = z; scene: east (1,0,0), north (0,0,-1), up (0,1,0)
    const east = toScene([1, 0, 0]), north = toScene([0, 1, 0]), up = toScene([0, 0, 1]);
    const cross = [east[1] * north[2] - east[2] * north[1], east[2] * north[0] - east[0] * north[2], east[0] * north[1] - east[1] * north[0]];
    close(cross, up);
  });

  it("wraps angles and converts true and house azimuths both ways", () => {
    expect(mod360(-10)).toBe(350);
    expect(mod360(370)).toBe(10);
    for (const a of [0, 12, 100, 359]) expect(houseAzimuth(trueAzimuth(a, derived.houseAxisBearingDeg), derived.houseAxisBearingDeg)).toBeCloseTo(a, 9);
  });
});

describe("sun direction", () => {
  const bearing = derived.houseAxisBearingDeg;

  it("is a unit vector pointing up for positive altitude", () => {
    for (const [az, alt] of [[0, 10], [90, 45], [192, 60], [270, 5], [359, 89]] as const) {
      const v = sunDirectionHouse(az, alt, bearing);
      expect(Math.hypot(...v)).toBeCloseTo(1, 12);
      expect(v[2]).toBeCloseTo(Math.sin((alt * Math.PI) / 180), 12);
    }
  });

  it("points along the house +y axis when the true azimuth equals the bearing", () => {
    close(sunDirectionHouse(bearing, 0, bearing), [0, 1, 0]);
    close(sunDirectionHouse(bearing + 90, 0, bearing), [1, 0, 0]);
    close(sunDirectionHouse(bearing + 180, 0, bearing), [0, -1, 0]);
  });

  it("the scene vector is the mapped house vector", () => {
    const h = sunDirectionHouse(250, 33, bearing);
    close(sunDirectionScene(250, 33, bearing), toScene(h));
  });

  it("a facade faces the sun exactly when the dot product with its normal is positive", () => {
    // oracle: true north-facing wall (house azimuth = -bearing) is lit by a sun in the true north-east, not by the true south
    const wallHouseAz = houseAzimuth(0, bearing); // wall whose outward normal points to true north
    const [nx, ny] = outwardNormalHouse(wallHouseAz);
    const lit = dot3(sunDirectionHouse(45, 20, bearing), [nx, ny, 0]);
    const dark = dot3(sunDirectionHouse(180, 20, bearing), [nx, ny, 0]);
    expect(lit).toBeGreaterThan(0);
    expect(dark).toBeLessThan(0);
  });
});

describe("heading", () => {
  const bearing = derived.houseAxisBearingDeg;

  it("looking along house +y (scene -z) is the bearing, looking east in the house frame is bearing + 90", () => {
    expect(headingTrue([0, 0, -1], bearing)).toBeCloseTo(bearing, 9);
    expect(headingTrue([1, 0, 0], bearing)).toBeCloseTo(mod360(bearing + 90), 9);
    expect(headingTrue([0, 0, 1], bearing)).toBeCloseTo(mod360(bearing + 180), 9);
  });

  it("is the inverse of the sun azimuth: the heading towards the sun equals its true azimuth", () => {
    for (const az of [0, 33, 100, 192, 281]) {
      const d = sunDirectionScene(az, 0, bearing);
      const diff = Math.abs(((headingTrue(d, bearing) - az + 540) % 360) - 180); // angular distance on the circle
      expect(diff).toBeCloseTo(0, 7);
    }
  });

  it("ignores the vertical part and has no heading when looking straight down", () => {
    expect(headingTrue([0, -1, 0], bearing)).toBe(0);
    expect(headingTrue([0, -5, -1], bearing)).toBeCloseTo(bearing, 9);
  });
});

describe("outward normals", () => {
  it("agree with the derived openings of the exterior walls", () => {
    const ext = derived.openings.filter((o) => o.exterior && o.azimuth !== null);
    expect(ext.length).toBeGreaterThan(0);
    for (const o of ext) {
      const [nx, ny] = outwardNormalHouse(o.azimuth!);
      // a horizontal wall ("h", running along x) has a normal along y, a vertical one along x
      if (o.orient === "h") { expect(Math.abs(nx)).toBeLessThan(1e-9); expect(Math.abs(ny)).toBeCloseTo(1, 9); }
      else { expect(Math.abs(ny)).toBeLessThan(1e-9); expect(Math.abs(nx)).toBeCloseTo(1, 9); }
    }
  });
});
