import type { Locale } from "@/lib/i18n/config";
import { NBSP, VALUE_SLOT, affixes, getFormatter } from "@/lib/i18n/format";
import { getT } from "@/lib/i18n/server";
import type { PlotView } from "./view";

/** The unit of heights above sea level in the visitor's language ("m n. m.", "m a.s.l."), taken from a dictionary template. */
export function aslUnit(t: ReturnType<typeof getT>): string {
  return affixes(t("plot.measure.riseNote", { from: "", to: VALUE_SLOT })).suffix;
}

/**
 * The numbers of the plot (server component): areas and shares, heights, rotation of the house, earthworks and planting.
 * Every value carries its unit; the captions name the quantity.
 */
export function PlotFacts({ view, locale }: { view: PlotView; locale: Locale }) {
  const t = getT(locale), f = getFormatter(locale);
  const { stats: st, ground: g } = view;
  const share = (ratio: number) => f.percent(ratio * 100, 1);
  const asl = aslUnit(t);
  const pair = (area: number, ratio: number) => `${f.area(area, 0)}${NBSP}·${NBSP}${share(ratio)}`;
  return (
    <section className="panel panel-pad stack pt-facts" aria-labelledby="pt-facts-h">
      <h2 className="label" id="pt-facts-h">{t("plot.facts.title")}</h2>
      <div className="kv">
        <span>{t("plot.facts.area")}</span><span>{f.area(st.plotArea, 0)}</span>
        <span>{t("plot.facts.builtUp")}<small>{t("plot.facts.builtUpNote")}</small></span><span>{pair(st.builtUpArea, st.builtUpRatio)}</span>
        <span>{t("plot.facts.paved")}<small>{t("plot.facts.pavedNote")}</small></span><span>{pair(st.pavedArea, st.pavedRatio)}</span>
        {st.waterArea > 0 && <><span>{t("plot.facts.water")}<small>{t("plot.facts.waterNote")}</small></span><span>{pair(st.waterArea, st.waterRatio)}</span></>}
        <span>{t("plot.facts.green")}</span><span>{pair(st.greenArea, st.greenRatio)}</span>
        <span>{t("plot.facts.range")}<small>{t("plot.facts.rangeNote")}</small></span><span>{f.range(g.zMin + view.zeroLevelAsl, g.zMax + view.zeroLevelAsl, { digits: 1, unit: asl })}</span>
        <span>{t("plot.facts.zero")}<small>{t("plot.facts.zeroNote")}</small></span><span>{f.unit(view.zeroLevelAsl, asl, 2)}</span>
        <span>{t("plot.facts.rotation")}<small>{t("plot.facts.rotationNote")}</small></span><span>{f.degrees(view.bearingDeg, 0)}</span>
        <span>{t("plot.facts.slope")}<small>{t("plot.facts.slopeNote")}</small></span><span>{f.percent(g.slopeMeanPct, 1)}{NBSP}/{NBSP}{f.percent(g.slopeMaxPct, 1)}</span>
        <span>{t("plot.facts.earthworks")}<small>{t("plot.facts.earthworksNote")}</small></span><span>{f.num(g.cut, 0)}{NBSP}/{NBSP}{f.volume(g.fill, 0)}</span>
        <span>{t("plot.facts.planting")}</span>
        <span>{t("plot.facts.plantingValue", { trees: t("common.count.trees", { count: view.counts.trees }), shrubs: t("common.count.shrubs", { count: view.counts.shrubs }) })}</span>
      </div>
    </section>
  );
}
