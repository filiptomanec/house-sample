// The texts and figures of the start page in both languages: complete, formatted by the formatter, taken from the model.
import { describe, expect, it } from "vitest";
import { compassPoint } from "@/lib/calc/sun";
import { stillMinutes, stills, media } from "@/lib/data/media";
import { LOCALES, type Locale } from "@/lib/i18n/config";
import { getFormatter, NBSP } from "@/lib/i18n/format";
import { getT } from "@/lib/i18n/server";
import { derived, house, metrics } from "@/lib/model/instance";
import { buildDayStory } from "../dayStory";
import { dayMoments, energyKpis, orbitCaptions, railItems } from "../content";
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
    expect(morning).toContain(f.clockHours(story.times.sunrise!));
    expect(morning).toContain(t(`home.compass.${compassPoint(story.times.sunriseAzimuth!)}`));
    const noon = moments.find((m) => m.key === "noon")!.text;
    expect(noon).toContain(f.clockHours(story.times.solarNoon));
    expect(noon).toContain(f.degrees(story.times.noonAltitude));
    expect(noon).toContain(f.length(facts.roof!.overhang, 1));
    expect(moments.find((m) => m.key === "afterSunset")!.text).toContain(f.clockHours(story.times.sunset!));
  });

  it("describes the features of the house with its own numbers", () => {
    const caps = orbitCaptions(t, f, facts);
    expect(caps.map((c) => c.key)).toEqual(["terrace", "roof", "garage", "entry"]);
    caps.forEach((c) => { clean(c.title); clean(c.text); });
    const by = Object.fromEntries(caps.map((c) => [c.key, c.text]));
    expect(by.terrace).toContain(f.area(facts.terrace.area));
    expect(by.roof).toContain(f.degrees(facts.roof!.pitchDeg));
    expect(by.roof).toContain(f.length(facts.roof!.ridgeHeight, 1));
    expect(by.garage).toContain(f.area(facts.garage!.area));
    expect(by.garage).toContain(t(`home.side.${facts.garage!.side!}`));
    expect(by.entry).toContain(t(`home.side.${facts.entrySide!}`));
  });

  it("leaves out a caption for a feature the model does not have", () => {
    const bare = { ...facts, garage: null, entrySide: null, roof: null, terrace: { area: 0, covered: 0 } };
    expect(orbitCaptions(t, f, bare)).toEqual([]);
    const open = orbitCaptions(t, f, { ...facts, terrace: { area: 20, covered: 5 } }).find((c) => c.key === "terrace")!;
    expect(open.text).toContain(f.area(5));
    const roofed = orbitCaptions(t, f, { ...facts, terrace: { area: 20, covered: 20 } }).find((c) => c.key === "terrace")!;
    expect(roofed.text).not.toContain(f.area(5));
    expect(roofed.text).not.toBe(open.text);
  });

  it("computes four finite energy figures from the default calculation", () => {
    const { kpis, lede } = energyKpis(t, f);
    clean(lede);
    expect(kpis.map((k) => k.key)).toEqual(["designLoad", "heat", "pv", "self"]);
    for (const k of kpis) {
      expect(Number.isFinite(k.value)).toBe(true);
      expect(k.value).toBeGreaterThan(0);
      clean(k.label);
      clean(k.unit);
    }
    const self = kpis[3];
    expect(self.value).toBeLessThanOrEqual(100);
  });

  it("captions the gallery strip with the local date and time of every still", () => {
    const items = railItems(locale, f, media);
    expect(items).toHaveLength(media.stills.length);
    items.forEach((item, i) => {
      const s = stills(undefined, media)[i];
      expect(item.title).toBe(s.title[locale]);
      expect(item.caption).toContain(f.clock(stillMinutes(s)));
      expect(item.src).toMatch(/^\/media\//);
      clean(item.caption);
    });
    expect(new Set(items.map((i) => i.id)).size).toBe(items.length);
  });
});

describe("the two languages differ where they should", () => {
  it("says the same facts in different words", () => {
    const cs = orbitCaptions(getT("cs"), getFormatter("cs"), facts), en = orbitCaptions(getT("en"), getFormatter("en"), facts);
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
