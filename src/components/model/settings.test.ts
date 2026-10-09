import { describe, expect, it } from "vitest";
import { derived, house } from "@/lib/model/instance";
import { defaultLook, type StyleModel } from "@/lib/three/style";
import { daylightAt } from "./daylight";
import { BLIND_DROP, BLIND_STATES, CUT_RANGE, DAY_PRESETS, DEFAULT_SETTINGS, cutMaxFor, lookSwatch, parseLook, parseSettings, presetHours } from "./settings";
import { style } from "./stores";

describe("parseSettings", () => {
  it("returns the defaults for anything that is not an object", () => {
    for (const bad of [null, undefined, 3, "x", [], true]) expect(parseSettings(bad)).toEqual(DEFAULT_SETTINGS);
  });

  it("keeps valid values and replaces invalid ones one by one", () => {
    const parsed = parseSettings({ roof: false, furniture: "yes", day: "evening", pan: true, extra: 1 });
    expect(parsed).toEqual({ ...DEFAULT_SETTINGS, roof: false, day: "evening", pan: true });
    expect(parseSettings({ day: "midnight" }).day).toBe(DEFAULT_SETTINGS.day);
    expect(DAY_PRESETS).toContain(DEFAULT_SETTINGS.day);
  });

  it("keeps the blinds as one of three positions; an old on/off value or a stale slide key falls back to the default", () => {
    expect(DEFAULT_SETTINGS.blinds).toBe("up");
    expect(parseSettings({ blinds: "half" }).blinds).toBe("half");
    expect(parseSettings({ blinds: true }).blinds).toBe("up");
    expect(parseSettings({ screenSlide: 50 })).toEqual(DEFAULT_SETTINGS);
    for (const b of BLIND_STATES) expect(BLIND_DROP[b]).toBeGreaterThanOrEqual(0);
    expect(BLIND_DROP.up).toBe(0);
    expect(BLIND_DROP.down).toBe(1);
  });

  it("is idempotent", () => {
    const once = parseSettings({ roof: false, green: false, day: "morning" });
    expect(parseSettings(once)).toEqual(once);
  });
});

describe("parseLook", () => {
  it("returns a complete selection: one valid option per group of the style", () => {
    for (const bad of [null, undefined, 5, "x", { facade: 3 }, { facade: "no-such", ghost: "x" }]) {
      const sel = parseLook(bad, style);
      expect(Object.keys(sel).sort()).toEqual(Object.keys(style.looks).sort());
      for (const [group, id] of Object.entries(sel)) expect(style.looks[group].options.map((o) => o.id)).toContain(id);
      expect(sel).toEqual(defaultLook(style));
    }
  });

  it("keeps ids that exist, whichever the groups are called", () => {
    for (const [group, g] of Object.entries(style.looks)) {
      const last = g.options[g.options.length - 1].id;
      expect(parseLook({ [group]: last }, style)[group]).toBe(last);
    }
  });
});

describe("lookSwatch", () => {
  it("gives every option a colour of the model, or none when it has no colour of its own", () => {
    for (const g of Object.values(style.looks)) {
      for (const o of g.options) {
        const c = lookSwatch(o, style);
        if (o.set && Object.values(o.set).some((p) => p.color)) expect(c).toMatch(/^#[0-9a-f]{6}$/i);
        else if (o.substitute) expect(c).toBe(style.materials[Object.values(o.substitute)[0]].color);
      }
    }
  });

  it("an option without colour and substitution has no swatch", () => {
    const bare: StyleModel = { ...style, looks: { g: { label: { cs: "g", en: "g" }, options: [{ id: "a", name: { cs: "a", en: "a" }, default: true }] } } };
    expect(lookSwatch(bare.looks.g.options[0], bare)).toBeNull();
  });
});

describe("the section slider", () => {
  it("ends at or above the ridge, within one step of it", () => {
    for (const ridge of [3.05, 5.5348, 5.6, 5.61, 7]) {
      const max = cutMaxFor(ridge);
      expect(max).toBeGreaterThanOrEqual(ridge - 1e-9);
      expect(max - ridge).toBeLessThan(CUT_RANGE.step + 1e-9);
    }
    expect(cutMaxFor(5.6)).toBe(5.6);
  });

  it("the top of the track is at or above the ridge (the engine treats that as no cut), the step below cuts the building", () => {
    const max = cutMaxFor(derived.bbox.z1);
    expect(max).toBeGreaterThanOrEqual(derived.bbox.z1);
    expect(max - CUT_RANGE.step).toBeLessThan(derived.bbox.z1);
    expect(CUT_RANGE.min).toBeLessThan(derived.defaultWallTop); // the lowest cut is inside the walls
  });
});

describe("daylight presets", () => {
  const times = { sunrise: 5, solarNoon: 13.3, sunset: 21.5 };

  it("run in time order inside the day", () => {
    const h = DAY_PRESETS.map((p) => presetHours(times, p));
    expect(h).toEqual([...h].sort((a, b) => a - b));
    expect(h[0]).toBeGreaterThan(times.sunrise);
    expect(h[h.length - 1]).toBeLessThan(times.sunset);
    expect(presetHours(times, "noon")).toBe(times.solarNoon);
  });

  it("cope with a sun that does not rise or set", () => {
    for (const p of DAY_PRESETS) expect(Number.isFinite(presetHours({ sunrise: null, solarNoon: 12, sunset: null }, p))).toBe(true);
  });

  it("the sun at the presets of the model's solstice: above the horizon, higher at noon than in the evening, west later in the day", () => {
    const sun = Object.fromEntries(DAY_PRESETS.map((p) => [p, daylightAt(house, p)]));
    for (const p of DAY_PRESETS) expect(sun[p].altitude).toBeGreaterThan(0);
    expect(sun.noon.altitude).toBeGreaterThan(sun.afternoon.altitude);
    expect(sun.afternoon.altitude).toBeGreaterThan(sun.evening.altitude);
    expect(sun.morning.azimuth).toBeLessThan(sun.noon.azimuth);
    expect(sun.noon.azimuth).toBeLessThan(sun.evening.azimuth);
    // the day is the one with the highest sun of the year: a solstice in the northern hemisphere is in June
    expect(sun.noon.date.month).toBe(5);
    expect(sun.noon.dayOfYear).toBeGreaterThan(150);
    expect(sun.noon.dayOfYear).toBeLessThan(200);
  });
});
