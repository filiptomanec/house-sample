// The start page, the story told over the house: one day on the house (scroll), the house (a statement, four figures and the
// model's own description), an orbit with captions bound to what the camera sees, the furnished layout, light (day and dusk), energy,
// how the house was made (#o-projektu), the gallery band and the index of the tools. Everything it states comes from the model
// (house, derived, metrics, site), the calc modules and the media and models manifests; the texts come from the "home" dictionary.
// The server does the calculations once; the client components only animate.
import { notFound } from "next/navigation";
import AboutSection from "@/components/home/AboutSection";
import CompareSlider from "@/components/home/CompareSlider";
import CountUp from "@/components/home/CountUp";
import DayHero from "@/components/home/DayHero";
import OrbitSection from "@/components/home/OrbitSection";
import PlanDraw, { zoneHoverCss } from "@/components/home/PlanDraw";
import Rail from "@/components/home/Rail";
import { aboutFigures } from "@/components/home/aboutFacts";
import { buildDayStory } from "@/components/home/dayStory";
import { aboutCards, dayMoments, energyKpis, hudEnds, orbitCaptions, railItems, railStills, sharedStillDate } from "@/components/home/content";
import { dayMonth } from "@/components/home/format";
import { homeFacts, ZONE_TOKEN } from "@/components/home/homeFacts";
import { compareSides, orbitPath, renderedCaptionAzimuths, stillPicture } from "@/components/home/mediaExtras";
import { orbitOrder } from "@/components/home/timeline";
import { splitTitle } from "@/components/home/title";
import { accentPhrase, Stat } from "@/components/ui/controls";
import IntentLink from "@/components/ui/IntentLink";
import { dayDate, dayFrames, dayStillIndex, media, orbitFrames, stillMinutes } from "@/lib/data/media";
import { isLocale } from "@/lib/i18n/config";
import { getFormatter, NBSP } from "@/lib/i18n/format";
import { I18n } from "@/lib/i18n/Provider";
import { buildMetadata } from "@/lib/i18n/metadata";
import { getT } from "@/lib/i18n/server";
import { ABOUT_ANCHOR, navLinks } from "@/lib/links";
import { derived, house, metrics } from "@/lib/model/instance";
import { localized } from "@/lib/model/metrics";
import { parseSite, plotPolygon, polygonArea } from "@/lib/model/site";
import { buildPlanDrawing } from "@/lib/plan/planGeometry";
import { ROUTES, routePath } from "@/lib/routes";
import { SITE } from "@/lib/site-config";
import renderJson from "@model/render.json";
import siteJson from "@model/site.json";
import "@/styles/pages/home.css";

type Props = { params: Promise<{ locale: string }> };

/** The orbit as configured for the renders: the fallback while the media manifest does not say how it was rendered (C4). */
const renderOrbit = {
  startAzimuthDeg: renderJson.orbit.startAzimuthDeg,
  direction: renderJson.orbit.direction as "clockwise" | "counterclockwise",
  halfWindowDeg: (renderJson.orbit as { captions?: { halfWindowDeg?: number } }).captions?.halfWindowDeg,
};

export async function generateMetadata({ params }: Props) {
  const { locale } = await params;
  return isLocale(locale) ? buildMetadata(locale, "home") : {};
}

/** "06-21" of the day sequence and its still time: the Sun page opens on that day and hour (read after mount there). */
function sunDeepLink(href: string): string {
  return `${href}?d=${media.day.date.slice(5)}&t=${media.day.stillTime}`;
}

export default async function Home({ params }: Props) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const t = getT(locale);
  const f = getFormatter(locale);

  const facts = homeFacts(house, derived, metrics, polygonArea(plotPolygon(parseSite(siteJson))));
  const story = buildDayStory(house, media);
  const drawing = buildPlanDrawing(derived, { furniture: true, margin: 1 });
  const energy = energyKpis(t, f);
  const pair = compareSides(media, locale);
  const clockA = f.clock(stillMinutes(pair.a)), clockB = f.clock(stillMinutes(pair.b));
  const tagA = pair.titleA ? `${pair.titleA} ${clockA}` : clockA, tagB = pair.titleB ? `${pair.titleB} ${clockB}` : clockB;
  const path = orbitPath(media, renderOrbit);
  const captions = orbitOrder(orbitCaptions(t, f, facts, renderedCaptionAzimuths(media)), path);
  const name = localized(house.name, locale);
  const tools = navLinks(locale, t);
  const railDate = sharedStillDate(railStills(media));
  const model = { href: routePath(locale, "model"), heavy: ROUTES.model.heavy === true };

  return (
    <I18n locale={locale} namespaces={["home"]}>
      <DayHero
        frames={dayFrames(media)}
        stillIndex={dayStillIndex(media)}
        titleLines={splitTitle(name)}
        kicker={t("home.hero.kicker")}
        lede={house.tagline ? localized(house.tagline, locale) : t("home.lede")}
        note={t("home.hero.note")}
        cta={{ ...model, label: t("home.hero.cta") }}
        hint={t("home.hero.hint")}
        minutes={story.minutes}
        sun={story.sun}
        path={story.path}
        ends={hudEnds(t, f, story)}
        moments={dayMoments(t, f, story, facts.roof?.overhang ?? null)}
        dateLabel={dayMonth(locale, dayDate(media))}
        dayCta={{ href: sunDeepLink(routePath(locale, "sun")), heavy: ROUTES.sun.heavy === true, label: t("home.dayCta") }}
      />

      <section className="section numbers" aria-labelledby="numbers-title">
        <div className="shell">
          <p className="kicker rv"><span className="label">{t("home.numbers.kicker")}</span></p>
          <h2 className="h1 numbers-title rv" id="numbers-title">{accentPhrase(t("home.numbers.title"))}</h2>
          <div className="stats-4 home-stats rv">
            <Stat value={<CountUp to={facts.heatedArea} decimals={1} />} unit={t("home.numbers.area.unit")} label={t("home.numbers.area.label")} />
            <Stat value={facts.layoutCode} label={t("home.numbers.layout.label")} />
            <Stat value={<CountUp to={facts.plotArea} />} unit={t("home.numbers.plot.unit")} label={t("home.numbers.plot.label")} />
            <Stat value={`${f.num(facts.footprint.w, 1)}${NBSP}×${NBSP}${f.num(facts.footprint.d, 1)}`} unit={t("home.numbers.size.unit")} label={t("home.numbers.size.label")} />
          </div>
          <div className="numbers-foot">
            <p className="numbers-note label ruled rv">{t("home.numbers.lede")}</p>
            {house.idea && <p className="idea rv">{localized(house.idea, locale)}</p>}
          </div>
        </div>
      </section>

      <section className="night orbit-band" aria-labelledby="orbit-title">
        <h2 className="sr-only" id="orbit-title">{t("home.orbit.label")}</h2>
        <OrbitSection frames={orbitFrames(media)} captions={captions} alt={t("home.orbit.alt")} path={path}
          cta={{ ...model, label: t("home.orbitCta") }} />
      </section>

      <section className="section plan-sec" aria-labelledby="plan-title">
        <style dangerouslySetInnerHTML={{ __html: zoneHoverCss() }} />
        <div className="shell plan-grid">
          <div className="plan-copy">
            <p className="kicker rv"><span className="label">{t("home.plan.kicker")}</span></p>
            <h2 className="h2 rv" id="plan-title">{accentPhrase(t("home.plan.title"))}</h2>
            <p className="body rv">{t("home.plan.text")}</p>
            <ul className="zones rv" role="list">
              {facts.zones.map((z) => (
                <li key={z.key} data-zone={z.key}>
                  <i className="zi" aria-hidden style={{ background: `var(${ZONE_TOKEN[z.key]})` }} />
                  <span>{z.label ? localized(z.label, locale) : t("home.plan.terrace")}</span>
                  <b className="num">{f.area(z.area)}</b>
                </li>
              ))}
            </ul>
            <IntentLink className="link-arrow rv" href={routePath(locale, "plan")}>{t("home.plan.link")}</IntentLink>
          </div>
          <PlanDraw drawing={drawing} zoneOfRoom={facts.zoneOfRoom} locale={locale} label={t("home.plan.alt")} />
        </div>
      </section>

      <section className="section-sm light-sec" aria-labelledby="light-title">
        <div className="shell">
          <p className="kicker rv"><span className="label">{t("home.compare.kicker")}</span></p>
          <div className="split-head">
            <h2 className="h2 rv" id="light-title">{accentPhrase(t("home.compare.title"))}</h2>
            <p className="body rv">{t("home.compare.lede", { a: clockA, b: clockB })}</p>
          </div>
        </div>
        <div className="bleed rv-media">
          <CompareSlider
            a={{ ...stillPicture(pair.a), label: tagA }}
            b={{ ...stillPicture(pair.b), label: tagB }}
            alt={pair.altA}
            altB={pair.altB}
            ariaLabel={t("home.compare.slider", { a: clockA, b: clockB })}
            sizes="100vw"
          />
        </div>
      </section>

      <section className="section energy-sec" aria-labelledby="energy-title">
        <div className="shell">
          <p className="kicker rv"><span className="label">{t("home.energy.kicker")}</span></p>
          <div className="split-head">
            <h2 className="h2 rv" id="energy-title">{accentPhrase(t("home.energy.title"))}</h2>
            <p className="body rv">{energy.lede}</p>
          </div>
          <div className="energy-grid">
            <div className="energy-hero rv">
              <Stat accent value={<CountUp to={energy.hero.value} decimals={energy.hero.digits} />} unit={energy.hero.unit} label={energy.hero.label} />
            </div>
            <div className="energy-list stagger rv">
              {energy.rest.map((k) => (
                <Stat key={k.key} value={<CountUp to={k.value} decimals={k.digits} />} unit={k.unit} label={k.label} />
              ))}
            </div>
          </div>
          <p className="more rv"><IntentLink className="link-arrow" href={routePath(locale, "energy")}>{t("home.energy.link")}</IntentLink></p>
        </div>
      </section>

      <AboutSection
        id={ABOUT_ANCHOR[locale]}
        kicker={t("home.about.kicker")}
        title={t("home.about.title")}
        lede={t("home.about.lede")}
        cards={aboutCards(t, f, locale, aboutFigures(derived.rooms.length, media))}
        stack={t("home.about.stack")}
        fiction={t("home.about.fiction")}
        source={{ href: SITE.repo, label: t("home.about.source"), newTab: t("common.externalLink") }}
      />

      <section className="section-sm night gallery-band" aria-labelledby="gallery-title">
        <div className="shell">
          <p className="kicker">
            <span className="label">{t("home.gallery.kicker")}</span>
            {railDate && <span className="label gallery-date">{dayMonth(locale, railDate)}</span>}
          </p>
          <h2 className="h2 gallery-title" id="gallery-title">{accentPhrase(t("home.gallery.title"))}</h2>
        </div>
        <Rail
          items={railItems(locale, f, media)}
          label={t("home.gallery.label")}
          href={routePath(locale, "gallery")}
          linkLabel={t("home.gallery.link")}
          prevLabel={t("home.gallery.prev")}
          nextLabel={t("home.gallery.next")}
        />
      </section>

      <section className="section explore" aria-labelledby="explore-title">
        <div className="shell">
          <p className="kicker rv"><span className="label">{t("home.explore.kicker")}</span></p>
          <h2 className="sr-only" id="explore-title">{t("home.explore.title")}</h2>
          <ol className="index" role="list">
            {tools.map((l) => (
              <li key={l.key}>
                <IntentLink href={l.href} heavy={l.heavy}><span className="n">{l.n}</span><b>{l.label}</b><span className="d">{l.desc}</span><span className="a" aria-hidden>→</span></IntentLink>
              </li>
            ))}
          </ol>
        </div>
      </section>
    </I18n>
  );
}
