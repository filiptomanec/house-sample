// Builds the texts and figures of the start page from the model and the calc modules: plain data for the page and its client
// components. Server side only (it runs calc modules); every sentence comes from the "home" dictionary, every number through the
// formatter, every value from the model.

import { computeEnergy, defaultEnergyContext, defaultInputs } from "@/lib/calc/energy";
import { compassPoint, type CalendarDate } from "@/lib/calc/sun";
import type { Media, Still } from "@/lib/data/media";
import { stillDate, stillMinutes, stills } from "@/lib/data/media";
import { NBSP, type Formatter } from "@/lib/i18n/format";
import type { Locale } from "@/lib/i18n/config";
import type { T } from "@/lib/i18n/messages";
import { ROUTES, routePath, type RouteKey } from "@/lib/routes";
import { ABOUT_STEPS, type AboutStep } from "./aboutFacts";
import { dayMonth } from "./format";
import type { DayStory } from "./dayStory";
import type { DayMoment } from "./DayHero";
import { RENDER_FEATURE_WORD, type HomeFacts, type OrbitFeatureKey } from "./homeFacts";
import { inGallery, stillPicture } from "./mediaExtras";
import type { OrbitCaption } from "./OrbitSection";
import type { RailItem } from "./Rail";

/** A terrace counts as fully roofed when less than this (m2) is open. */
const TERRACE_EPS = 0.05;

/** The captions of the day hero, with the times (and their prepositions) and the angles of the sun filled in. */
export function dayMoments(t: T, f: Formatter, story: Pick<DayStory, "times" | "windows">, roofOverhang: number | null): DayMoment[] {
  const { sunrise, sunriseAzimuth, solarNoon, sunset, noonAltitude } = story.times;
  return story.windows.map((w): DayMoment => {
    switch (w.key) {
      case "morning":
        return {
          ...w, title: t("home.day.moments.morning.title"),
          text: sunrise === null || sunriseAzimuth === null
            ? t("home.day.moments.morning.textAlways")
            : t("home.day.moments.morning.textAt", { atSunrise: f.atHours(sunrise), direction: t(`home.compass.${compassPoint(sunriseAzimuth)}`) }),
        };
      case "noon":
        return { ...w, title: t("home.day.moments.noon.title"), text: t("home.day.moments.noon.textAt", { atNoon: f.atHours(solarNoon), altitude: f.degrees(noonAltitude), overhang: f.length(roofOverhang ?? 0, 1) }) };
      case "evening":
        return { ...w, title: t("home.day.moments.evening.title"), text: t("home.day.moments.evening.text") };
      case "afterSunset":
        return { ...w, title: t("home.day.moments.afterSunset.title"), text: t("home.day.moments.afterSunset.textAt", { atSunset: f.atHours(sunset ?? solarNoon) }) };
    }
  });
}

/** One end of the sun arc: the whole label ("východ 4:52 · SV") and the time alone (for narrow screens). */
export interface ArcEnd { full: string; time: string }

/** Labels of the two ends of the sun arc (null when the sun does not rise or set that day). */
export function hudEnds(t: T, f: Formatter, story: Pick<DayStory, "times">): { sunrise: ArcEnd | null; sunset: ArcEnd | null } {
  const { sunrise, sunriseAzimuth, sunset, sunsetAzimuth } = story.times;
  const label = (key: "sunrise" | "sunset", hours: number | null, az: number | null): ArcEnd | null => {
    if (hours === null || az === null) return null;
    const time = f.clockHours(hours);
    return { full: t(`home.day.hud.${key}`, { time, dir: t(`home.day.hud.dir.${compassPoint(az)}`) }), time };
  };
  return { sunrise: label("sunrise", sunrise, sunriseAzimuth), sunset: label("sunset", sunset, sunsetAzimuth) };
}

/**
 * The captions of the orbit, one per feature of the house that the model has (terrace and its louvres, roof and its panels,
 * entrance, garage and its driveway, pool), each with the azimuth from which the camera sees it: as the render pipeline computed
 * it when the media manifest carries it (`rendered`, keyed by RENDER_FEATURE_WORD), else from the model (homeFacts.features).
 */
export function orbitCaptions(t: T, f: Formatter, facts: HomeFacts, rendered: Readonly<Record<string, number>> = {}): OrbitCaption[] {
  const az = (key: OrbitFeatureKey) => {
    const model = facts.features.find((x) => x.key === key)?.az;
    return model === undefined ? undefined : rendered[RENDER_FEATURE_WORD[key]] ?? model;
  };
  const out: OrbitCaption[] = [];
  const push = (key: OrbitFeatureKey, title: string, text: string) => {
    const a = az(key);
    if (a !== undefined) out.push({ key, title, text, az: a });
  };
  if (facts.terrace.area > 0) {
    const all = facts.terrace.covered >= facts.terrace.area - TERRACE_EPS;
    const area = all
      ? t("home.orbit.terrace.textCovered", { area: f.area(facts.terrace.area) })
      : t("home.orbit.terrace.text", { area: f.area(facts.terrace.area), covered: f.area(facts.terrace.covered) });
    push("terrace", t("home.orbit.terrace.title"), facts.louvres ? `${area} ${t("home.orbit.louvres.text")}` : area);
  }
  if (facts.roof) {
    const roof = t("home.orbit.roof.text", { pitch: f.degrees(facts.roof.pitchDeg), overhang: f.length(facts.roof.overhang, 1), ridge: f.length(facts.roof.ridgeHeight, 1) });
    const pv = facts.pv ? t("home.orbit.pv.text", { panels: t("common.count.panels", { count: facts.pv.count }), kwp: f.unit(facts.pv.kwp, "kWp", 1) }) : null;
    push("roof", t("home.orbit.roof.title"), pv ? `${roof} ${pv}` : roof);
  }
  if (facts.entrySide) push("entry", t("home.orbit.entry.title"), t("home.orbit.entry.text", { side: t(`home.side.${facts.entrySide}`) }));
  if (facts.garage?.side) {
    push("garage", ...(facts.driveToGate
      ? [t("home.orbit.garageDrive.title"), t("home.orbit.garageDrive.text", { area: f.area(facts.garage.area) })] as const
      : [t("home.orbit.garage.title"), t("home.orbit.garage.text", { area: f.area(facts.garage.area), side: t(`home.side.${facts.garage.side}`) })] as const));
  }
  if (facts.pool) push("pool", t("home.orbit.pool.title"), t("home.orbit.pool.text", { area: f.area(facts.pool.area), depth: f.length(facts.pool.depth, 1) }));
  return out;
}

export interface EnergyKpi { key: string; value: number; digits: number; unit: string; label: string; accent?: boolean }

/**
 * The figures of the energy section: the same default calculation as the Energy page opens with. `hero` is the solar yield (the
 * one mint figure), `rest` the design heat load, the heating need per m2 and the share of the power the roof covers; `kpis` lists
 * all four in that order.
 */
export function energyKpis(t: T, f: Formatter): { kpis: EnergyKpi[]; hero: EnergyKpi; rest: EnergyKpi[]; lede: string } {
  const ctx = defaultEnergyContext();
  const inputs = defaultInputs(ctx);
  const r = computeEnergy(inputs, ctx);
  const battery = ctx.house.equipment.battery.options.find((o) => o.id === r.inputs.pv.batteryId);
  const batteryKwh = battery?.capacityKwh ?? 0;
  const self = batteryKwh > 0
    ? { unit: t("home.energy.self.unit"), label: t("home.energy.self.label", { battery: f.unit(batteryKwh, "kWh") }) }
    : { unit: t("home.energy.selfNoBattery.unit"), label: t("home.energy.selfNoBattery.label") };
  const hero: EnergyKpi = { key: "pv", value: r.totals.pvKwh / 1000, digits: 1, unit: t("home.energy.pv.unit"), label: t("home.energy.pv.label"), accent: true };
  const rest: EnergyKpi[] = [
    { key: "designLoad", value: r.designLoad.totalW / 1000, digits: 1, unit: t("home.energy.designLoad.unit"), label: t("home.energy.designLoad.label", { outdoor: `${f.num(r.designLoad.outdoorC)}${NBSP}°C` }) },
    { key: "heat", value: r.totals.specificHeatNeed, digits: 0, unit: t("home.energy.heat.unit"), label: t("home.energy.heat.label") },
    { key: "self", value: r.totals.selfSufficiency * 100, digits: 0, ...self },
  ];
  return {
    lede: t("home.energy.ledeCount", { panels: t("common.count.panels", { count: r.layout.count }), kwp: f.unit(r.layout.kwp, "kWp", 1) }),
    hero,
    rest,
    kpis: [rest[0], rest[1], hero, rest[2]],
  };
}

/** The stills of the gallery strip: in manifest order, without the comparison pair (shown just above) and stills kept out of galleries. */
export function railStills(m: Media): Still[] {
  const pair = new Set([m.compare.a, m.compare.b]);
  const rest = stills(undefined, m).filter((s) => inGallery(s) && !pair.has(s.id));
  return rest.length ? rest : stills(undefined, m).filter(inGallery);
}

/** The date all stills of the strip share (month 0-based), or null when they differ (then every card names its own date). */
export function sharedStillDate(list: readonly Still[]): CalendarDate | null {
  return list.length && list.every((s) => s.date === list[0].date) ? stillDate(list[0]) : null;
}

/** Cards of the gallery strip, captioned with their local time (and the date, unless all share it), with responsive sources. */
export function railItems(locale: Locale, f: Formatter, m: Media): RailItem[] {
  const list = railStills(m);
  const shared = sharedStillDate(list) !== null;
  return list.map((s: Still) => ({
    id: s.id,
    title: s.title[locale],
    caption: shared ? f.clock(stillMinutes(s)) : `${dayMonth(locale, stillDate(s))}, ${f.clock(stillMinutes(s))}`,
    picture: stillPicture(s),
    src: stillPicture(s).src,
    width: s.width,
    height: s.height,
  }));
}

export interface AboutCard {
  key: AboutStep;
  n: string;
  title: string;
  text: string;
  /** The figure as the dictionary writes it ("162 145 trojúhelníků"), split around the number for the big type. */
  figure: { before: string; number: string; after: string; full: string };
  href: string;
  heavy: boolean;
}

/** The page each step of "how it was made" leads to. */
const STEP_ROUTE: Record<AboutStep, RouteKey> = { plan: "plan", model: "model", renders: "gallery", sun: "sun", budget: "budget" };

/** Splits a sentence around the formatted number it contains (no number found: everything is "after"). */
export function splitFigure(full: string, number: string): AboutCard["figure"] {
  const i = full.indexOf(number);
  return i < 0 ? { before: "", number: "", after: full, full } : { before: full.slice(0, i), number, after: full.slice(i + number.length), full };
}

/** The five step cards of the About section, each with its live figure and the page it leads to. */
export function aboutCards(t: T, f: Formatter, locale: Locale, figures: Record<AboutStep, number>): AboutCard[] {
  return ABOUT_STEPS.map((key, i) => {
    const count = figures[key];
    const route = STEP_ROUTE[key];
    return {
      key,
      n: String(i + 1).padStart(2, "0"),
      title: t(`home.about.steps.${key}.title`),
      text: t(`home.about.steps.${key}.text`),
      figure: splitFigure(t(`home.about.steps.${key}.figure`, { count }), f.int(count)),
      href: routePath(locale, route),
      heavy: ROUTES[route].heavy === true,
    };
  });
}
