// The texts and figures of the start page in both languages: complete, formatted by the formatter, taken from the model.
import { describe, expect, it } from "vitest";
import { compassPoint } from "@/lib/calc/sun";
import { stillMinutes, media, type Media } from "@/lib/data/media";
import { LOCALES, type Locale } from "@/lib/i18n/config";
import { getFormatter, NBSP } from "@/lib/i18n/format";
import { getT } from "@/lib/i18n/server";
import { derived, house, metrics } from "@/lib/model/instance";
import { ROUTES, routePath } from "@/lib/routes";
import { ABOUT_STEPS, aboutFigures } from "../aboutFacts";
import { buildDayStory } from "../dayStory";
import { aboutCards, dayMoments, energyKpis, hudEnds, orbitCaptions, railItems, railStills, sharedStillDate, splitFigure } from "../content";
import { dayMonth } from "../format";
import { homeFacts } from "../homeFacts";

const story = buildDayStory(house, media);
const facts = homeFacts(house, derived, metrics, 1000);
const clean = (s: string) => {
  expect(s.trim().length).toBeGreaterThan(0);
  expect(s).not.toMatch(/undefined|NaN|Infinity|\{|\}|\[object/);
};

describe.each(LOCALES)("start page content (%s)", (locale: Locale) => {
  const t = getT(locale), f = getFormatter(locale);

  it("writes one caption per window of the day, with the sun times of the model", () => {
    const moments = dayMoments(t, f, story, facts.roof?.overhang ?? null);
    expect(moments.map((m) => m.key)).toEqual(story.windows.map((w) => w.key));
    moments.forEach((m, i) => {
      clean(m.title);
      clean(m.text);
      expect([m.from, m.to]).toEqual([story.windows[i].from, story.windows[i].to]);
    });
    const morning = moments.find((m) => m.key === "morning")!.text;
    expect(morning).toContain(f.atHours(story.times.sunrise!)); // the time with its preposition ("ve 4:48", "at 4:48")
    expect(morning).toContain(t(`home.compass.${compassPoint(story.times.sunriseAzimuth!)}`));
    const noon = moments.find((m) => m.key === "noon")!.text;
    expect(noon).toContain(f.atHours(story.times.solarNoon));
    expect(noon).toContain(f.degrees(story.times.noonAltitude));
    expect(noon).toContain(f.length(facts.roof!.overhang, 1));
    expect(moments.find((m) => m.key === "afterSunset")!.text).toContain(f.atHours(story.times.sunset!));
  });

  it("labels the two ends of the sun arc with the time and the compass point", () => {
    const ends = hudEnds(t, f, story);
    expect(ends.sunrise!.full).toContain(f.clockHours(story.times.sunrise!));
    expect(ends.sunrise!.full).toContain(t(`home.day.hud.dir.${compassPoint(story.times.sunriseAzimuth!)}`));
    expect(ends.sunrise!.time).toBe(f.clockHours(story.times.sunrise!));
    expect(ends.sunset!.full).toContain(f.clockHours(story.times.sunset!));
    expect(ends.sunset!.full).toContain(t(`home.day.hud.dir.${compassPoint(story.times.sunsetAzimuth!)}`));
    expect(ends.sunset!.time).toBe(f.clockHours(story.times.sunset!));
    const polar = hudEnds(t, f, { times: { ...story.times, sunrise: null, sunset: null, sunriseAzimuth: null, sunsetAzimuth: null } });
    expect(polar).toEqual({ sunrise: null, sunset: null });
  });

  it("describes the features of the house with its own numbers, each at the azimuth of its feature", () => {
    const caps = orbitCaptions(t, f, facts);
    expect(caps.map((c) => c.key)).toEqual(facts.features.map((x) => x.key).filter((k) => caps.some((c) => c.key === k)));
    caps.forEach((c) => { clean(c.title); clean(c.text); expect(c.az).toBe(facts.features.find((x) => x.key === c.key)!.az); });
    const by = Object.fromEntries(caps.map((c) => [c.key, c.text]));
    expect(by.terrace).toContain(f.area(facts.terrace.area));
    if (facts.louvres) expect(by.terrace).toContain(t("home.orbit.louvres.text"));
    expect(by.roof).toContain(f.degrees(facts.roof!.pitchDeg));
    expect(by.roof).toContain(f.length(facts.roof!.ridgeHeight, 1));
    if (facts.pv) expect(by.roof).toContain(f.unit(facts.pv.kwp, "kWp", 1));
    expect(by.garage).toContain(f.area(facts.garage!.area));
    if (!facts.driveToGate) expect(by.garage).toContain(t(`home.side.${facts.garage!.side!}`));
    expect(by.entry).toContain(t(`home.side.${facts.entrySide!}`));
    if (facts.pool) expect(by.pool).toContain(f.area(facts.pool.area));
  });

  it("leaves out a caption for a feature the model does not have", () => {
    const bare = { ...facts, garage: null, entrySide: null, roof: null, pool: null, terrace: { area: 0, covered: 0 } };
    // azimuths the render pipeline computed (media manifest) win over the model's estimate, for features the model has
    const rendered = orbitCaptions(t, f, facts, { pv: 123, entry: 45, nonsense: 1 });
    if (facts.pv) expect(rendered.find((c) => c.key === "roof")!.az).toBe(123);
    expect(rendered.find((c) => c.key === "entry")!.az).toBe(45);
    expect(rendered.map((c) => c.key)).toEqual(orbitCaptions(t, f, facts).map((c) => c.key));
    expect(orbitCaptions(t, f, bare)).toEqual([]);
    expect(orbitCaptions(t, f, { ...facts, features: [] })).toEqual([]);
    const open = orbitCaptions(t, f, { ...facts, terrace: { area: 20, covered: 5 } }).find((c) => c.key === "terrace")!;
    expect(open.text).toContain(f.area(5));
    const roofed = orbitCaptions(t, f, { ...facts, terrace: { area: 20, covered: 20 } }).find((c) => c.key === "terrace")!;
    expect(roofed.text).not.toContain(f.area(5));
    expect(roofed.text).not.toBe(open.text);
    const plain = orbitCaptions(t, f, { ...facts, louvres: false, pv: null, driveToGate: false });
    expect(plain.find((c) => c.key === "terrace")!.text).not.toContain(t("home.orbit.louvres.text"));
    expect(plain.find((c) => c.key === "garage")!.text).toContain(t(`home.side.${facts.garage!.side!}`));
  });

  it("computes one hero figure and three small ones from the default calculation", () => {
    const { kpis, hero, rest, lede } = energyKpis(t, f);
    clean(lede);
    expect(lede).toContain(t("common.count.panels", { count: derived.pv.count }));
    expect(kpis.map((k) => k.key)).toEqual(["designLoad", "heat", "pv", "self"]);
    expect(hero.key).toBe("pv");
    expect(hero.accent).toBe(true);
    expect(rest.map((k) => k.key)).toEqual(["designLoad", "heat", "self"]);
    for (const k of kpis) {
      expect(Number.isFinite(k.value)).toBe(true);
      expect(k.value).toBeGreaterThan(0);
      clean(k.label);
      clean(k.unit);
    }
    expect(rest[2].value).toBeLessThanOrEqual(100);
  });

  it("fills the gallery strip with the stills that are not shown elsewhere on the page, captioned with their time", () => {
    const list = railStills(media);
    const items = railItems(locale, f, media);
    expect(items.map((i) => i.id)).toEqual(list.map((s) => s.id));
    expect(items.some((i) => i.id === media.compare.a || i.id === media.compare.b)).toBe(false);
    const shared = sharedStillDate(list) !== null;
    items.forEach((item, i) => {
      const s = list[i];
      expect(item.title).toBe(s.title[locale]);
      expect(item.caption).toContain(f.clock(stillMinutes(s)));
      if (shared) expect(item.caption).toBe(f.clock(stillMinutes(s)));
      expect(item.src).toMatch(/^\/media\//);
      clean(item.caption);
    });
    expect(new Set(items.map((i) => i.id)).size).toBe(items.length);
  });

  it("names the date of each card only when the stills differ in date", () => {
    const firstRail = railStills(media)[0].id;
    const other: Media = { ...media, stills: media.stills.map((s) => (s.id === firstRail ? { ...s, date: "2026-12-21" } : s)) };
    const list = railStills(other);
    if (list.length < 2) return;
    expect(sharedStillDate(list)).toBeNull();
    for (const item of railItems(locale, f, other)) expect(item.caption).toContain(",");
  });

  it("builds the five steps of the About section with a live figure and a link each", () => {
    const figures = aboutFigures(derived.rooms.length, media);
    const cards = aboutCards(t, f, locale, figures);
    expect(cards.map((c) => c.key)).toEqual([...ABOUT_STEPS]);
    cards.forEach((c, i) => {
      clean(c.title); clean(c.text); clean(c.figure.full);
      expect(c.n).toBe(String(i + 1).padStart(2, "0"));
      expect(c.figure.number).toBe(f.int(figures[c.key]));
      expect(c.figure.before + c.figure.number + c.figure.after).toBe(c.figure.full);
      expect(c.href.startsWith(routePath(locale, "home") === "/" ? "/" : routePath(locale, "home"))).toBe(true);
    });
    expect(cards.find((c) => c.key === "plan")!.href).toBe(routePath(locale, "plan"));
    expect(cards.find((c) => c.key === "model")!.heavy).toBe(ROUTES.model.heavy === true);
  });
});

describe("splitFigure", () => {
  it("cuts a sentence around its number, or leaves it whole", () => {
    expect(splitFigure(`162${NBSP}145 trojúhelníků`, `162${NBSP}145`)).toEqual({ before: "", number: `162${NBSP}145`, after: " trojúhelníků", full: `162${NBSP}145 trojúhelníků` });
    expect(splitFigure("hours: 12", "12")).toEqual({ before: "hours: ", number: "12", after: "", full: "hours: 12" });
    expect(splitFigure("none", "7").number).toBe("");
  });
});

describe("the two languages differ where they should", () => {
  it("says the same facts in different words", () => {
    const cs = orbitCaptions(getT("cs"), getFormatter("cs"), facts), en = orbitCaptions(getT("en"), getFormatter("en"), facts);
    expect(cs.length).toBeGreaterThan(0);
    expect(cs.map((c) => c.key)).toEqual(en.map((c) => c.key));
    cs.forEach((c, i) => { expect(c.text).not.toBe(en[i].text); expect(c.title).not.toBe(en[i].title); });
  });
});

describe("dayMonth", () => {
  const date = { year: 2026, month: 5, day: 21 };
  it("writes the day and the month in the language, Czech with a non-breaking space", () => {
    expect(dayMonth("cs", date)).toBe(`21.${NBSP}června`);
    expect(dayMonth("en", date)).toBe("21 June");
  });
  it("counts months from zero like the calc modules", () => {
    expect(dayMonth("en", { year: 2026, month: 0, day: 5 })).toBe("5 January");
    expect(dayMonth("en", { year: 2026, month: 11, day: 31 })).toBe("31 December");
  });
});
