// The start page: a scroll-driven day on the house, the house in numbers, an orbit, the layout, light, energy, the gallery and the index
// of the other pages. Everything it states comes from the model (house, derived, metrics, site), the calc modules and the media
// manifest; the texts come from the "home" dictionary. The server does the calculations once; the client components only animate.
import Link from "next/link";
import { notFound } from "next/navigation";
import CompareSlider from "@/components/home/CompareSlider";
import CountUp from "@/components/home/CountUp";
import DayHero from "@/components/home/DayHero";
import OrbitSection from "@/components/home/OrbitSection";
import PlanDraw from "@/components/home/PlanDraw";
import Rail from "@/components/home/Rail";
import { buildDayStory } from "@/components/home/dayStory";
import { dayMoments, energyKpis, orbitCaptions, railItems } from "@/components/home/content";
import { dayMonth } from "@/components/home/format";
import { homeFacts, ZONE_TOKEN } from "@/components/home/homeFacts";
import { Stat } from "@/components/ui/controls";
import { compareStills, dayFrames, dayStillIndex, media, orbitFrames, stillMinutes, stillUrl } from "@/lib/data/media";
import { isLocale } from "@/lib/i18n/config";
import { getFormatter, NBSP } from "@/lib/i18n/format";
import { I18n } from "@/lib/i18n/Provider";
import { buildMetadata } from "@/lib/i18n/metadata";
import { getT } from "@/lib/i18n/server";
import { navLinks } from "@/lib/links";
import { derived, house, metrics } from "@/lib/model/instance";
import { parseSite, plotPolygon, polygonArea } from "@/lib/model/site";
import { buildPlanDrawing } from "@/lib/plan/planGeometry";
import { routePath } from "@/lib/routes";
import { SITE } from "@/lib/site-config";
import siteJson from "@model/site.json";
import "@/styles/pages/home.css";

type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props) {
  const { locale } = await params;
  return isLocale(locale) ? buildMetadata(locale, "home") : {};
}

export default async function Home({ params }: Props) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const t = getT(locale);
  const f = getFormatter(locale);

  const facts = homeFacts(house, derived, metrics, polygonArea(plotPolygon(parseSite(siteJson))));
  const story = buildDayStory(house, media);
  const drawing = buildPlanDrawing(derived, { furniture: false, margin: 1 });
  const energy = energyKpis(t, f);
  const { a, b } = compareStills(media);
  const clockA = f.clock(stillMinutes(a)), clockB = f.clock(stillMinutes(b));

  return (
    <I18n locale={locale} namespaces={["home"]}>
      <DayHero
        frames={dayFrames(media)}
        stillIndex={dayStillIndex(media)}
        title={SITE.house.name[locale]}
        minutes={story.minutes}
        sun={story.sun}
        path={story.path}
        moments={dayMoments(t, f, story, facts.roof?.overhang ?? null)}
        dateLabel={dayMonth(locale, story.date)}
      />

      <section className="section numbers" aria-labelledby="numbers-title">
        <div className="shell">
          <p className="kicker rv"><span className="label">{t("home.numbers.kicker")}</span></p>
          <div className="split-head">
            <h2 className="h1 rv" id="numbers-title">{t("home.numbers.title")}</h2>
            <p className="lede rv">{t("home.numbers.lede")}</p>
          </div>
          <div className="stats-4 rv">
            <Stat value={<CountUp to={facts.netArea} decimals={1} />} unit={t("home.numbers.area.unit")} label={t("home.numbers.area.label")} />
            <Stat value={<CountUp to={facts.roomCount} />} label={t("home.numbers.rooms.label")} />
            <Stat value={<CountUp to={facts.plotArea} />} unit={t("home.numbers.plot.unit")} label={t("home.numbers.plot.label")} />
            <Stat value={`${f.num(facts.footprint.w, 1)}${NBSP}×${NBSP}${f.num(facts.footprint.d, 1)}`} unit={t("home.numbers.size.unit")} label={t("home.numbers.size.label")} />
          </div>
        </div>
      </section>

      <section className="night" aria-labelledby="orbit-title">
        <h2 className="sr-only" id="orbit-title">{t("home.orbit.label")}</h2>
        <OrbitSection frames={orbitFrames(media)} captions={orbitCaptions(t, f, facts)} alt={t("home.orbit.alt")} />
      </section>

      <section className="section" aria-labelledby="plan-title">
        <div className="shell plan-grid">
          <div className="plan-copy">
            <p className="kicker rv"><span className="label">{t("home.plan.kicker")}</span></p>
            <h2 className="h2 rv" id="plan-title">{t("home.plan.title")}</h2>
            <p className="body rv">{t("home.plan.text")}</p>
            <ul className="zones rv" role="list">
              {facts.zones.map((z) => (
                <li key={z.key}>
                  <i className="zi" aria-hidden style={{ background: `var(${ZONE_TOKEN[z.key]})` }} />
                  <span>{z.label ? z.label[locale] : t("home.plan.terrace")}</span>
                  <b className="num">{f.area(z.area)}</b>
                </li>
              ))}
            </ul>
            <Link className="link-arrow rv" href={routePath(locale, "plan")}>{t("home.plan.link")}</Link>
          </div>
          <PlanDraw drawing={drawing} zoneOfRoom={facts.zoneOfRoom} locale={locale} label={t("home.plan.alt")} />
        </div>
      </section>

      <section className="section-sm" aria-labelledby="light-title">
        <div className="shell">
          <p className="kicker rv"><span className="label">{t("home.compare.kicker")}</span></p>
          <div className="split-head">
            <h2 className="h2 rv" id="light-title">{t("home.compare.title")}</h2>
            <p className="body rv">{t("home.compare.lede", { a: clockA, b: clockB })}</p>
          </div>
          <div className="rv">
            <CompareSlider
              a={{ src: stillUrl(a), width: a.width, height: a.height, label: clockA }}
              b={{ src: stillUrl(b), width: b.width, height: b.height, label: clockB }}
              alt={a.alt[locale]}
              ariaLabel={t("home.compare.slider", { a: clockA, b: clockB })}
            />
          </div>
        </div>
      </section>

      <section className="section" aria-labelledby="energy-title">
        <div className="shell">
          <p className="kicker rv"><span className="label">{t("home.energy.kicker")}</span></p>
          <div className="split-head">
            <h2 className="h2 rv" id="energy-title">{t("home.energy.title")}</h2>
            <p className="body rv">{energy.lede}</p>
          </div>
          <div className="stats-4 rv">
            {energy.kpis.map((k) => (
              <Stat key={k.key} accent={k.accent} value={<CountUp to={k.value} decimals={k.digits} />} unit={k.unit} label={k.label} />
            ))}
          </div>
          <p className="more rv"><Link className="link-arrow" href={routePath(locale, "energy")}>{t("home.energy.link")}</Link></p>
        </div>
      </section>

      <section className="section-sm night" aria-labelledby="gallery-title">
        <div className="shell">
          <p className="kicker"><span className="label">{t("home.gallery.kicker")}</span></p>
          <h2 className="h2 gallery-title" id="gallery-title">{t("home.gallery.title")}</h2>
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

      <section className="section" aria-labelledby="explore-title">
        <div className="shell">
          <p className="kicker rv"><span className="label">{t("home.explore.kicker")}</span></p>
          <h2 className="sr-only" id="explore-title">{t("home.explore.title")}</h2>
          <ol className="index">
            {navLinks(locale, t).map((l) => (
              <li key={l.key}>
                <Link href={l.href}><span className="n">{l.n}</span><b>{l.label}</b><span className="d">{l.desc}</span><span className="a" aria-hidden>→</span></Link>
              </li>
            ))}
          </ol>
        </div>
      </section>
    </I18n>
  );
}
