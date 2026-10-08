import { notFound } from "next/navigation";
import { PlotFacts } from "@/components/plot/PlotFacts";
import { PlotRules } from "@/components/plot/PlotRules";
import { PlotTool } from "@/components/plot/PlotTool";
import { buildPlotView } from "@/components/plot/view";
import { MethodNote, NextTool, Stat, ToolHead } from "@/components/ui/controls";
import { buildMetadata } from "@/lib/i18n/metadata";
import { isLocale } from "@/lib/i18n/config";
import { getFormatter } from "@/lib/i18n/format";
import { I18n } from "@/lib/i18n/Provider";
import { getT } from "@/lib/i18n/server";
import { derived, house } from "@/lib/model/instance";
import { ROUTES } from "@/lib/routes";
import siteJson from "@model/site.json";
import "@/styles/pages/plot.css";

type Props = { params: Promise<{ locale: string }> };

// Everything on the page is computed from the house model and model/site.json when the page is built; the client gets plain data.
const view = buildPlotView(house, derived, siteJson);

/** Method paragraphs a later copy pass adds (requested in the WP13 handoff); each shows once its key exists. */
const METHOD_KEYS = ["plot.method.areas", "plot.method.terrain"] as const;

export async function generateMetadata({ params }: Props) {
  const { locale } = await params;
  return isLocale(locale) ? buildMetadata(locale, "plot") : {};
}

export default async function Page({ params }: Props) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const t = getT(locale), f = getFormatter(locale);
  const st = view.stats;
  // a share as a figure: the number, and the percent sign as the language writes it (spaced in Czech, attached in English)
  const share = (ratio: number) => {
    const v = f.num(ratio * 100, 1);
    return { value: v, suffix: f.percent(ratio * 100, 1).slice(v.length) };
  };
  const nearest = Math.min(...view.setbacks.map((s) => s.d));
  return (
    <>
      <ToolHead n={ROUTES.plot.n} kicker={t("nav.items.plot.label")} title={t("plot.title", { area: f.area(st.plotArea, 0) })} lede={t("plot.lede")} />
      <div className="shell">
        <div className="stats-4 pt-stats">
          <Stat {...share(st.builtUpRatio)} label={t("plot.facts.builtUp")} />
          <Stat {...share(st.greenRatio)} label={t("plot.facts.green")} accent />
          <Stat value={f.num(nearest, 1)} unit="m" label={t("plot.rules.check.boundary")} />
          <Stat value={f.degrees(view.bearingDeg, 0)} label={t("plot.facts.rotation")} />
        </div>
      </div>
      <I18n locale={locale} namespaces={["plot"]}>
        <PlotTool view={view} facts={<PlotFacts view={view} locale={locale} />} />
      </I18n>
      <PlotRules view={view} locale={locale} />
      <MethodNote title={t("common.method.title")}>
        {METHOD_KEYS.filter((k) => t.has(k)).map((k) => <p key={k}>{t.dyn(k)}</p>)}
        <p>{t("plot.rules.note")}</p>
        <p>{t("plot.rules.lede")}</p>
      </MethodNote>
      <NextTool from="plot" t={t} />
    </>
  );
}
