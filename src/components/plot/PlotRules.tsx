import type { CSSProperties } from "react";
import type { Locale } from "@/lib/i18n/config";
import { getFormatter } from "@/lib/i18n/format";
import { getT } from "@/lib/i18n/server";
import { limitBar } from "./limits";
import type { PlotView } from "./view";

const vars = (v: Record<string, string>): CSSProperties => v as CSSProperties;

/** Limits and checks (server component): built-up share and green share against their limits, then every rule check. */
export function PlotRules({ view, locale }: { view: PlotView; locale: Locale }) {
  const t = getT(locale), f = getFormatter(locale);
  const { stats: st, limits } = view;
  const pct = (r: number, d = 1) => f.percent(r * 100, d);
  const bars = [
    { key: "builtUp" as const, ratio: st.builtUpRatio, limit: limits.maxBuiltUpRatio, rule: "max" as const },
    { key: "green" as const, ratio: st.greenRatio, limit: limits.minGreenRatio, rule: "min" as const },
  ].map((b) => {
    const bar = limitBar(b.ratio, b.limit, b.rule), area = Math.abs(b.limit - b.ratio) * st.plotArea;
    const note = bar.ok ? t(b.rule === "max" ? "plot.rules.roomMax" : "plot.rules.roomMin", { area: f.area(area, 0) }) : t(b.rule === "max" ? "plot.rules.overMax" : "plot.rules.underMin", { area: f.area(area, 0) });
    return { ...b, ...bar, note };
  });
  const value = (c: PlotView["checks"][number]) => (c.unit === "m" ? f.length(c.actual, 1) : c.unit === "ratio" ? pct(c.actual) : c.ok ? t("plot.rules.yes") : t("plot.rules.no"));
  const limit = (c: PlotView["checks"][number]) => {
    if (c.unit === "flag") return "";
    const v = c.unit === "m" ? f.length(c.limit, 1) : pct(c.limit, 0);
    return t(c.rule === "min" ? "plot.rules.atLeast" : "plot.rules.atMost", { limit: v });
  };
  return (
    <section className="section shell pt-rules" aria-labelledby="pt-rules-h">
      <h2 className="h2" id="pt-rules-h">{t("plot.rules.title")}</h2>
      <p className="lede">{t("plot.rules.lede")}</p>
      <div className="pt-rules-grid">
        <div className="panel panel-pad stack">
          {bars.map((b) => (
            <div key={b.key} className="pt-limit" data-ok={b.ok}>
              <div className="pt-limit-head">
                <span>{t(`plot.rules.check.${b.key}`)}</span>
                <b className="mono">{pct(b.ratio)}</b>
              </div>
              <div className="pt-limit-bar" role="img" aria-label={t("plot.rules.barAria", { value: pct(b.ratio), limit: pct(b.limit, 0) })}>
                <i style={vars({ "--v": `${(b.value * 100).toFixed(2)}%` })} />
                <span className="pt-limit-mark" style={vars({ "--at": `${(b.mark * 100).toFixed(2)}%` })} />
              </div>
              <div className="pt-limit-foot">
                <span>{t(b.rule === "max" ? "plot.rules.limitMax" : "plot.rules.limitMin", { limit: pct(b.limit, 0) })}</span>
                <span>{b.note}</span>
              </div>
            </div>
          ))}
        </div>
        <div className="panel panel-pad">
          <ul className="pt-checks">
            {view.checks.map((c) => (
              <li key={c.key} data-ok={c.ok}>
                <span className="pt-check-name">{t(`plot.rules.check.${c.key}`)}<small>{limit(c)}</small></span>
                <b className="mono">{value(c)}</b>
                <span className="pt-status" data-ok={c.ok}>{c.ok ? t("plot.rules.ok") : t("plot.rules.fail")}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
      <p className="note">{t("plot.rules.note")}</p>
    </section>
  );
}
