import { describe, expect, it } from "vitest";
import { derived, house } from "@/lib/model/instance";
import { HABITABLE } from "@/lib/model/catalog";
import { placeOf, sunPosition, sunTimes, localToUtc } from "@/lib/calc/sun";
import { webViews } from "@/lib/three/views";
import {
  DEFAULT_SHADING, SHADING_RANGE, TIME_MARGIN_MIN, TIME_STEP_MIN, clampMinute, defaultMinute, habitableRooms, inYear, mainRoom, parseIso,
  parseSettings, presetDays, presetOf, primaryArea, sunAreas, sunnySideView, timeRange, toIso,
} from "./model";

const place = placeOf(house);
const YEAR = 2026;

describe("days on offer", () => {
  const presets = presetDays(place, YEAR);
  it("four days in calendar order: equinoxes where the declination is near zero, solstices at the extremes", () => {
    expect(presets.map((p) => p.key)).toEqual(["spring", "summer", "autumn", "winter"]);
    const decl = (p: (typeof presets)[number]) => sunPosition(localToUtc(place.tz, p.date, 12), place).declination;
    expect(Math.abs(decl(presets[0]))).toBeLessThan(0.6);
    expect(Math.abs(decl(presets[2]))).toBeLessThan(0.6);
    expect(decl(presets[1])).toBeGreaterThan(23);
    expect(decl(presets[3])).toBeLessThan(-23);
    for (let i = 1; i < presets.length; i++) expect(presets[i].date.month * 40 + presets[i].date.day).toBeGreaterThan(presets[i - 1].date.month * 40 + presets[i - 1].date.day);
  });
  it("matches a date to its preset", () => {
    for (const p of presets) expect(presetOf(p.date, presets)).toBe(p.key);
    expect(presetOf({ year: YEAR, month: 0, day: 2 }, presets)).toBeNull();
  });
  it("converts ISO dates, rejecting other years and impossible days", () => {
    expect(toIso({ year: 2026, month: 2, day: 5 })).toBe("2026-03-05");
    expect(parseIso("2026-03-05", 2026)).toEqual({ year: 2026, month: 2, day: 5 });
    expect(parseIso("2026-02-30", 2026)).toBeNull();
    expect(parseIso("2025-03-05", 2026)).toBeNull();
    expect(parseIso("", 2026)).toBeNull();
    expect(parseIso("5.3.2026", 2026)).toBeNull();
    const d = { year: 2026, month: 6, day: 14 };
    expect(parseIso(toIso(d), 2026)).toEqual(d);
  });
  it("moves a day to another year, 29 February to the 28th", () => {
    expect(inYear({ year: 2028, month: 1, day: 29 }, 2026)).toEqual({ year: 2026, month: 1, day: 28 });
    expect(inYear({ year: 2026, month: 5, day: 21 }, 2028)).toEqual({ year: 2028, month: 5, day: 21 });
  });
});

describe("time of day", () => {
  it("the slider reaches 20 minutes beyond sunrise and sunset on the 5 minute grid", () => {
    for (const p of presetDays(place, YEAR)) {
      const t = sunTimes(place, p.date);
      const r = timeRange(t);
      expect(r.min % TIME_STEP_MIN).toBe(0);
      expect(r.max % TIME_STEP_MIN).toBe(0);
      expect(r.min).toBeLessThanOrEqual(t.sunrise! * 60 - TIME_MARGIN_MIN + 1e-9);
      expect(r.min).toBeGreaterThan(t.sunrise! * 60 - TIME_MARGIN_MIN - TIME_STEP_MIN - 1e-9);
      expect(r.max).toBeGreaterThanOrEqual(t.sunset! * 60 + TIME_MARGIN_MIN - 1e-9);
      expect(r.max).toBeLessThan(t.sunset! * 60 + TIME_MARGIN_MIN + TIME_STEP_MIN + 1e-9);
      const d = defaultMinute(t);
      expect(d).toBeGreaterThanOrEqual(r.min);
      expect(d).toBeLessThanOrEqual(r.max);
      expect(d).toBeGreaterThan(t.solarNoon * 60);
    }
  });
  it("polar day gives the whole day and polar night a window around noon", () => {
    const arctic = { lat: 69.6, lon: 18.9, tz: "Europe/Oslo" };
    expect(timeRange(sunTimes(arctic, { year: 2026, month: 5, day: 21 }))).toEqual({ min: 0, max: 1435 });
    const night = sunTimes(arctic, { year: 2026, month: 11, day: 21 });
    const r = timeRange(night);
    expect(r.min).toBeLessThan(night.solarNoon * 60);
    expect(r.max).toBeGreaterThan(night.solarNoon * 60);
  });
  it("clampMinute stays in range, snaps to the grid and survives garbage", () => {
    const r = { min: 300, max: 1200 };
    expect(clampMinute(0, r)).toBe(300);
    expect(clampMinute(5000, r)).toBe(1200);
    expect(clampMinute(612, r)).toBe(610);
    expect(clampMinute(NaN, r)).toBe(300);
  });
});

describe("rooms and areas come from the data", () => {
  it("habitable rooms in model order, labelled by type or, when types repeat, by their own name", () => {
    const rows = habitableRooms(derived);
    expect(rows.length).toBeGreaterThan(2);
    const lit = new Set(derived.openings.filter((o) => o.exterior === true && o.glazingArea > 0).map((o) => o.room));
    expect(rows.map((r) => r.id)).toEqual(derived.rooms.filter((r) => HABITABLE.includes(r.type) && lit.has(r.id)).map((r) => r.id));
    expect(new Set(rows.map((r) => r.label.cs)).size).toBe(rows.length);
    expect(new Set(rows.map((r) => r.label.en)).size).toBe(rows.length);
    for (const r of rows) {
      expect(r.label.cs[0]).toBe(r.label.cs[0].toLocaleUpperCase());
      const sameType = rows.filter((x) => x.type === r.type);
      if (sameType.length > 1) expect(r.label.cs.toLowerCase()).toBe(derived.rooms.find((x) => x.id === r.id)!.name.cs.toLowerCase());
    }
  });
  it("the main room is the one with the main-living role or else the largest habitable room", () => {
    const main = mainRoom(derived)!;
    expect(main.role).toBe("main-living");
    const without = { rooms: derived.rooms.map((r) => ({ ...r, role: undefined })) };
    const largest = mainRoom(without)!;
    const habitable = derived.rooms.filter((r) => HABITABLE.includes(r.type));
    expect(largest.area).toBe(Math.max(...habitable.map((r) => r.area)));
    expect(mainRoom({ rooms: [] })).toBeNull();
  });
  it("areas are the terraces and covered areas, numbered when a name repeats", () => {
    const areas = sunAreas(derived);
    expect(areas.map((a) => a.id)).toEqual(derived.outdoor.filter((a) => a.type === "terrace" || a.covered).map((a) => a.id));
    expect(primaryArea(areas)?.type).toBe("terrace");
    const twice = sunAreas({ outdoor: [derived.outdoor[0], { ...derived.outdoor[0], id: "x" }] });
    expect(twice.map((a) => a.label.en)).toEqual([`${twice[0].label.en.replace(/ 1$/, "")} 1`, `${twice[0].label.en.replace(/ 1$/, "")} 2`]);
    expect(primaryArea([])).toBeNull();
  });
});

describe("first view", () => {
  const views = [
    { id: "north", ortho: false, position: [0, 2, -40] as const },
    { id: "south", ortho: false, position: [0, 2, 40] as const },
    { id: "top", ortho: true, position: [0, 60, 0] as const },
    { id: "east", ortho: false, position: [40, 2, 0] as const },
  ];
  // scene frame: z = -north of the house frame, so z = +40 is 40 m to the south of the centre
  it("prefers the view on the side of the midday sun, ignoring orthographic views", () => {
    expect(sunnySideView(views, 0, [0, 0])?.id).toBe("south");
    // the house axis turned 90 degrees clockwise: true south is the house +x side
    expect(sunnySideView(views, 90, [0, 0])?.id).toBe("east");
    // in the southern hemisphere the midday sun is in the north
    expect(sunnySideView(views, 0, [0, 0], false)?.id).toBe("north");
    expect(sunnySideView([views[2]], 0, [0, 0])).toBeNull();
  });
  it("picks a real camera of the model on the south side", () => {
    const all = webViews(house.cameras);
    const pick = sunnySideView(all, house.location.houseAxisBearingDeg, [(derived.bbox.x0 + derived.bbox.x1) / 2, (derived.bbox.y0 + derived.bbox.y1) / 2]);
    expect(pick).not.toBeNull();
    expect(pick!.ortho).toBe(false);
    expect(pick!.position[2]).toBeGreaterThan(0); // south of the house in the scene frame (the house frame is not rotated)
  });
});

describe("remembered settings", () => {
  const good = { month: 5, day: 21, minute: 700, slatAngle: 30, slatSlide: 50, blindDrop: 80, blindTilt: 10 };
  it("accepts a complete record", () => {
    expect(parseSettings(good, YEAR)).toEqual(good);
  });
  it("is total: garbage becomes defaults or null, numbers are clamped and snapped, never NaN", () => {
    expect(parseSettings(null, YEAR)).toBeNull();
    expect(parseSettings("x", YEAR)).toBeNull();
    expect(parseSettings({ month: 1, day: 30 }, YEAR)).toBeNull();
    expect(parseSettings({ month: 12, day: 1 }, YEAR)).toBeNull();
    const s = parseSettings({ month: 0, day: 1, minute: "noon", slatAngle: 1e9, slatSlide: -5, blindDrop: NaN, blindTilt: 33 }, YEAR)!;
    expect(s.minute).toBe(720);
    expect(s.slatAngle).toBe(SHADING_RANGE.slatAngle.max);
    expect(s.slatSlide).toBe(0);
    expect(s.blindDrop).toBe(DEFAULT_SHADING.blindDrop);
    expect(s.blindTilt).toBe(35);
    for (const v of Object.values(s)) expect(Number.isFinite(v)).toBe(true);
  });
  it("is idempotent", () => {
    const once = parseSettings({ month: 3, day: 9, minute: 1e6, slatAngle: 44.4, slatSlide: 12, blindDrop: 3, blindTilt: 89 }, YEAR)!;
    expect(parseSettings(once, YEAR)).toEqual(once);
  });
});
