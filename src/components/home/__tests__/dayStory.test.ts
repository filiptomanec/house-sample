// The astronomy behind the hero, checked against textbook values and the invariants of a day's sun path, and the drawing of the arc.
import { describe, expect, it } from "vitest";
import { dayDate, media } from "@/lib/data/media";
import { house } from "@/lib/model/instance";
import { buildDayStory } from "../dayStory";
import { arcGeometry, sunAtFrame, type SunSpot } from "../sunArc";

const story = buildDayStory(house, media);
const RAD = Math.PI / 180;

/** Declination (degrees) by the simple textbook formula, independent of calc/sun.ts. */
const declination = (dayOfYear: number) => 23.44 * Math.sin(((360 / 365) * (dayOfYear - 81)) * RAD);
const dayOfYear = (d: { year: number; month: number; day: number }) => Math.round((Date.UTC(d.year, d.month, d.day) - Date.UTC(d.year, 0, 0)) / 86400000);

describe("buildDayStory", () => {
  it("has one sun position and one time per frame, for the date of the manifest", () => {
    expect(story.minutes).toHaveLength(media.day.times.length);
    expect(story.sun).toHaveLength(media.day.times.length);
    expect(story.date).toEqual(dayDate());
  });

  it("puts the noon altitude where spherical astronomy says (90 - latitude + declination)", () => {
    const expected = 90 - house.location.lat + declination(dayOfYear(story.date));
    expect(story.times.noonAltitude).toBeGreaterThan(expected - 0.7);
    expect(story.times.noonAltitude).toBeLessThan(expected + 0.7);
  });

  it("rises, peaks once near solar noon and sets, with the azimuth growing all day", () => {
    const peak = story.sun.reduce((best, s, i) => (s.alt > story.sun[best].alt ? i : best), 0);
    const noonMinute = story.times.solarNoon * 60;
    // the frames around the peak straddle solar noon
    expect(Math.abs(story.minutes[peak] - noonMinute)).toBeLessThanOrEqual(60);
    for (let i = 1; i < story.sun.length; i++) expect(story.sun[i].az).toBeGreaterThan(story.sun[i - 1].az);
    for (let i = 1; i <= peak; i++) expect(story.sun[i].alt).toBeGreaterThanOrEqual(story.sun[i - 1].alt - 1e-9);
    for (let i = peak + 1; i < story.sun.length; i++) expect(story.sun[i].alt).toBeLessThanOrEqual(story.sun[i - 1].alt + 1e-9);
  });

  it("rises in the north-east at midsummer (true azimuth of the sunrise)", () => {
    const az = story.times.sunriseAzimuth!;
    expect(az).toBeGreaterThan(35);
    expect(az).toBeLessThan(75);
  });

  it("sets in the north-west at midsummer, mirroring the sunrise about the south", () => {
    const az = story.times.sunsetAzimuth!;
    expect(az).toBeGreaterThan(285);
    expect(az).toBeLessThan(325);
    expect(Math.abs((story.times.sunriseAzimuth! + az) / 2 - 180)).toBeLessThan(3);
  });

  it("puts the sun in the east in the morning and the west in the evening (true azimuth)", () => {
    expect(story.sun[0].az).toBeGreaterThan(45);
    expect(story.sun[0].az).toBeLessThan(135);
    expect(story.sun[story.sun.length - 1].az).toBeGreaterThan(225);
  });

  it("is below the horizon after sunset and above it before", () => {
    const sunsetMin = story.times.sunset! * 60;
    story.minutes.forEach((m, i) => {
      if (m > sunsetMin + 5) expect(story.sun[i].alt).toBeLessThan(0.5);
      if (m < sunsetMin - 5 && m > story.times.sunrise! * 60 + 5) expect(story.sun[i].alt).toBeGreaterThan(-0.5);
    });
  });

  it("draws the path of the whole day above the horizon", () => {
    expect(story.path.length).toBeGreaterThan(20);
    expect(story.path.every((p) => p.alt >= 0)).toBe(true);
    const max = Math.max(...story.path.map((p) => p.alt));
    expect(max).toBeGreaterThan(story.times.noonAltitude - 1);
    expect(max).toBeLessThanOrEqual(story.times.noonAltitude + 0.5);
  });

  it("is deterministic", () => {
    expect(buildDayStory(house, media)).toEqual(story);
  });
});

describe("sunAtFrame", () => {
  const sun = story.sun;
  it("equals the sun at whole frames and the mean between two", () => {
    sun.forEach((s, i) => expect(sunAtFrame(sun, i)).toEqual(s));
    const mid = sunAtFrame(sun, 3.5);
    expect(mid.az).toBeCloseTo((sun[3].az + sun[4].az) / 2, 9);
    expect(mid.alt).toBeCloseTo((sun[3].alt + sun[4].alt) / 2, 9);
  });

  it("stays on the ends outside the sequence and survives an empty one", () => {
    expect(sunAtFrame(sun, -4)).toEqual(sun[0]);
    expect(sunAtFrame(sun, 99)).toEqual(sun[sun.length - 1]);
    expect(sunAtFrame([], 2)).toEqual({ az: 0, alt: 0 });
  });
});

describe("arcGeometry", () => {
  const box = { width: 200, height: 70, padX: 8, padTop: 6, padBottom: 8 };
  const geo = arcGeometry(story.path, box);

  it("keeps the whole path inside the box, the highest point at the top padding and the ends on the horizon line", () => {
    for (const p of story.path) {
      const [x, y] = geo.project(p.az, p.alt);
      expect(x).toBeGreaterThanOrEqual(box.padX - 1e-9);
      expect(x).toBeLessThanOrEqual(box.width - box.padX + 1e-9);
      expect(y).toBeGreaterThanOrEqual(box.padTop - 1e-9);
      expect(y).toBeLessThanOrEqual(geo.horizon + 1e-9);
    }
    const top = story.path.reduce((a, b) => (b.alt > a.alt ? b : a));
    expect(geo.project(top.az, top.alt)[1]).toBeCloseTo(box.padTop, 6);
    expect(geo.project(story.path[0].az, 0)[1]).toBeCloseTo(geo.horizon, 6);
    expect(geo.horizon).toBe(box.height - box.padBottom);
  });

  it("writes a path with one command per sample and marks the cardinal directions inside the path", () => {
    expect(geo.d.startsWith("M")).toBe(true);
    expect(geo.d.match(/[ML]/g)).toHaveLength(story.path.length);
    const azs = story.path.map((p) => p.az);
    for (const c of geo.cardinals) {
      expect(c.az).toBeGreaterThanOrEqual(Math.min(...azs));
      expect(c.az).toBeLessThanOrEqual(Math.max(...azs));
      expect(c.x).toBeGreaterThanOrEqual(box.padX);
      expect(c.x).toBeLessThanOrEqual(box.width - box.padX);
    }
    expect(geo.cardinals.map((c) => c.az)).toContain(180); // the sun passes the south on this day
  });

  it("puts east left of south left of west", () => {
    const xs = geo.cardinals.map((c) => c.x);
    expect([...xs].sort((a, b) => a - b)).toEqual(xs);
  });

  it("draws the travelled part: nothing before sunrise, up to the sun during the day, the whole path after sunset", () => {
    const first = story.path[0], lastP = story.path[story.path.length - 1];
    expect(geo.travelled({ az: first.az - 5, alt: -2 })).toBe("");
    expect(geo.travelled({ az: lastP.az + 5, alt: -2 })).toBe(geo.d);
    const noon = story.path[Math.floor(story.path.length / 2)];
    const mid = { az: noon.az + 0.5, alt: noon.alt };
    const d = geo.travelled(mid);
    const points = d.match(/[ML]/g)!.length;
    expect(points).toBeGreaterThan(2);
    expect(points).toBeLessThan(story.path.length);
    // it ends at the sun
    const [x, y] = geo.project(mid.az, mid.alt);
    expect(d.endsWith(`${Math.round(x * 10) / 10},${Math.round(y * 10) / 10}`)).toBe(true);
  });

  it("knows where the sunrise and the sunset end of the path are", () => {
    expect(geo.ends.start).toBeCloseTo(box.padX, 6);
    expect(geo.ends.end).toBeCloseTo(box.width - box.padX, 6);
  });

  it("survives an empty path and a path of one point", () => {
    expect(arcGeometry([], box).d).toBe("");
    const one: SunSpot[] = [{ az: 100, alt: 10 }];
    const g = arcGeometry(one, box);
    expect(Number.isFinite(g.project(100, 10)[0])).toBe(true);
    expect(g.d.startsWith("M")).toBe(true);
  });
});
