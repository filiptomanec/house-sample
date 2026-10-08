// Builds the texts and figures of the start page from the model and the calc modules: plain data for the page and its client
// components. Server side only (it runs calc modules); every sentence comes from the "home" dictionary, every number through the
// formatter, every value from the model.

import { computeEnergy, defaultEnergyContext, defaultInputs } from "@/lib/calc/energy";
import { compassPoint } from "@/lib/calc/sun";
import type { Media, Still } from "@/lib/data/media";
import { stillDate, stillMinutes, stills, stillUrl } from "@/lib/data/media";
import { NBSP, type Formatter } from "@/lib/i18n/format";
import type { Locale } from "@/lib/i18n/config";
import type { T } from "@/lib/i18n/messages";
import { dayMonth } from "./format";
import type { DayStory } from "./dayStory";
import type { DayMoment } from "./DayHero";
import type { HomeFacts } from "./homeFacts";
import type { OrbitCaption } from "./OrbitSection";
import type { RailItem } from "./Rail";

/** A terrace counts as fully roofed when less than this (m2) is open. */
const TERRACE_EPS = 0.05;

/** The captions of the day hero, with the times and angles of the sun filled in. */
export function dayMoments(t: T, f: Formatter, story: Pick<DayStory, "times" | "windows">, roofOverhang: number | null): DayMoment[] {
  const { sunrise, sunriseAzimuth, solarNoon, sunset, noonAltitude } = story.times;
  return story.windows.map((w): DayMoment => {
    switch (w.key) {
      case "morning":
        return { ...w, title: t("home.day.moments.morning.title"), text: sunrise === null || sunriseAzimuth === null ? t("home.day.moments.morning.textAlways") : t("home.day.moments.morning.text", { sunrise: f.clockHours(sunrise), direction: t(`home.compass.${compassPoint(sunriseAzimuth)}`) }) };
      case "noon":
        return { ...w, title: t("home.day.moments.noon.title"), text: t("home.day.moments.noon.text", { noon: f.clockHours(solarNoon), altitude: f.degrees(noonAltitude), overhang: f.length(roofOverhang ?? 0, 1) }) };
      case "evening":
        return { ...w, title: t("home.day.moments.evening.title"), text: t("home.day.moments.evening.text") };
      case "afterSunset":
        return { ...w, title: t("home.day.moments.afterSunset.title"), text: t("home.day.moments.afterSunset.text", { sunset: f.clockHours(sunset ?? solarNoon) }) };
    }
  });
}

/** The captions of the orbit, one per feature of the house that the model has (terrace, roof, garage, entrance). */
export function orbitCaptions(t: T, f: Formatter, facts: HomeFacts): OrbitCaption[] {
  const out: OrbitCaption[] = [];
  if (facts.terrace.area > 0) {
    const all = facts.terrace.covered >= facts.terrace.area - TERRACE_EPS;
    out.push({
      key: "terrace",
      title: t("home.orbit.terrace.title"),
      text: all ? t("home.orbit.terrace.textCovered", { area: f.area(facts.terrace.area) }) : t("home.orbit.terrace.text", { area: f.area(facts.terrace.area), covered: f.area(facts.terrace.covered) }),
    });
  }
  if (facts.roof) {
    out.push({ key: "roof", title: t("home.orbit.roof.title"), text: t("home.orbit.roof.text", { pitch: f.degrees(facts.roof.pitchDeg), overhang: f.length(facts.roof.overhang, 1), ridge: f.length(facts.roof.ridgeHeight, 1) }) });
  }
  if (facts.garage?.side) {
    out.push({ key: "garage", title: t("home.orbit.garage.title"), text: t("home.orbit.garage.text", { area: f.area(facts.garage.area), side: t(`home.side.${facts.garage.side}`) }) });
  }
  if (facts.entrySide) {
    out.push({ key: "entry", title: t("home.orbit.entry.title"), text: t("home.orbit.entry.text", { side: t(`home.side.${facts.entrySide}`) }) });
  }
  return out;
}

export interface EnergyKpi { key: string; value: number; digits: number; unit: string; label: string; accent?: boolean }

/** The four figures of the energy section: the same default calculation as the Energy page opens with. */
export function energyKpis(t: T, f: Formatter): { kpis: EnergyKpi[]; lede: string } {
  const ctx = defaultEnergyContext();
  const inputs = defaultInputs(ctx);
  const r = computeEnergy(inputs, ctx);
  const battery = ctx.house.equipment.battery.options.find((o) => o.id === r.inputs.pv.batteryId);
  const batteryKwh = battery?.capacityKwh ?? 0;
  const self = batteryKwh > 0
    ? { unit: t("home.energy.self.unit"), label: t("home.energy.self.label", { battery: f.unit(batteryKwh, "kWh") }) }
    : { unit: t("home.energy.selfNoBattery.unit"), label: t("home.energy.selfNoBattery.label") };
  return {
    lede: t("home.energy.lede", { panels: r.layout.count, kwp: f.unit(r.layout.kwp, "kWp", 1) }),
    kpis: [
      { key: "designLoad", value: r.designLoad.totalW / 1000, digits: 1, unit: t("home.energy.designLoad.unit"), label: t("home.energy.designLoad.label", { outdoor: `${f.num(r.designLoad.outdoorC)}${NBSP}°C` }) },
      { key: "heat", value: r.totals.specificHeatNeed, digits: 0, unit: t("home.energy.heat.unit"), label: t("home.energy.heat.label") },
      { key: "pv", value: r.totals.pvKwh / 1000, digits: 1, unit: t("home.energy.pv.unit"), label: t("home.energy.pv.label"), accent: true },
      { key: "self", value: r.totals.selfSufficiency * 100, digits: 0, ...self },
    ],
  };
}

/** Cards of the gallery strip: the stills of the manifest, captioned with their local date and time. */
export function railItems(locale: Locale, f: Formatter, m: Media): RailItem[] {
  return stills(undefined, m).map((s: Still) => ({
    id: s.id,
    src: stillUrl(s),
    title: s.title[locale],
    caption: `${dayMonth(locale, stillDate(s))}, ${f.clock(stillMinutes(s))}`,
    width: s.width,
    height: s.height,
  }));
}
