import type { Locale } from "@/lib/i18n/config";
import { getFormatter, NBSP } from "@/lib/i18n/format";
import { getT } from "@/lib/i18n/server";
import { absolute } from "./fmt";
import type { PlotView } from "./view";

/** The numbers of the plot (server component): areas, shares, heights, rotation of the house, earthworks. */
export function PlotFacts({ view, locale }: { view: PlotView; locale: Locale }) {
  const t = getT(locale), f = getFormatter(locale);
  const { stats: st, ground: g } = view;
  const share = (ratio: number) => f.percent(ratio * 100, 1);
  const abs = (z: number) => absolute(f, z, view.zeroLevelAsl);
  return (
    <section className="panel panel-pad stack pt-facts" aria-labelledby="pt-facts-h">
      <h2 className="label" id="pt-facts-h">{t("plot.facts.title")}</h2>
      <div className="kv">
        <span>{t("plot.facts.area")}</span><span>{f.area(st.plotArea, 0)}</span>
        <span>{t("plot.facts.builtUp")}<small>{t("plot.facts.builtUpNote")}</small></span><span>{f.area(st.builtUpArea, 0)}{NBSP}·{NBSP}{share(st.builtUpRatio)}</span>
        <span>{t("plot.facts.paved")}<small>{t("plot.facts.pavedNote")}</small></span><span>{f.area(st.pavedArea, 0)}{NBSP}·{NBSP}{share(st.pavedRatio)}</span>
        <span>{t("plot.facts.green")}</span><span>{f.area(st.greenArea, 0)}{NBSP}·{NBSP}{share(st.greenRatio)}</span>
        <span>{t("plot.facts.range")}<small>{t("plot.facts.rangeNote")}</small></span><span>{f.range(g.zMin + view.zeroLevelAsl, g.zMax + view.zeroLevelAsl, { digits: 1 })}</span>
        <span>{t("plot.facts.zero")}<small>{t("plot.facts.zeroNote")}</small></span><span>{abs(0)}</span>
        <span>{t("plot.facts.rotation")}<small>{t("plot.facts.rotationNote")}</small></span><span>{f.degrees(view.bearingDeg, 0)}</span>
        <span>{t("plot.facts.slope")}<small>{t("plot.facts.slopeNote")}</small></span><span>{f.percent(g.slopeMeanPct, 1)}{NBSP}/{NBSP}{f.percent(g.slopeMaxPct, 1)}</span>
        <span>{t("plot.facts.earthworks")}<small>{t("plot.facts.earthworksNote")}</small></span><span>{f.num(g.cut, 0)}{NBSP}/{NBSP}{f.volume(g.fill, 0)}</span>
        <span>{t("plot.facts.planting")}</span><span>{t("plot.facts.plantingValue", { trees: view.counts.trees, shrubs: view.counts.shrubs })}</span>
      </div>
      <p className="note">{t("plot.fiction")}</p>
    </section>
  );
}
