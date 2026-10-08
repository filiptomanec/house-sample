import type { CSSProperties } from "react";
import type { Locale } from "@/lib/i18n/config";
import { getFormatter } from "@/lib/i18n/format";
import { accent } from "@/lib/i18n/rich";
import { getT } from "@/lib/i18n/server";
import { limitBar } from "./limits";
import type { PlotView } from "./view";

const vars = (v: Record<string, string>): CSSProperties => v as CSSProperties;

/**
 * Limits and checks (server component): one full-width card with every rule check in two columns. A share of the plot (built-up,
 * green) shows its meter inside its row: the filled part, the limit mark and how much room is left. The disclaimer about the
 * rules lives in the page's MethodNote.
 */
export function PlotRules({ view, locale }: { view: PlotView; locale: Locale }) {
  const t = getT(locale), f = getFormatter(locale);
  const { stats: st } = view;
  const pct = (r: number, d = 1) => f.percent(r * 100, d);
  const value = (c: PlotView["checks"][number]) => (c.unit === "m" ? f.length(c.actual, 1) : c.unit === "ratio" ? pct(c.actual) : c.ok ? t("plot.rules.yes") : t("plot.rules.no"));
  const limit = (c: PlotView["checks"][number]) => {
    if (c.unit === "flag") return "";
    const v = c.unit === "m" ? f.length(c.limit, 1) : pct(c.limit, 0);
    return t(c.rule === "min" ? "plot.rules.atLeast" : "plot.rules.atMost", { limit: v });
  };
  const meter = (c: PlotView["checks"][number]) => {
    const bar = limitBar(c.actual, c.limit, c.rule), area = f.area(Math.abs(c.limit - c.actual) * st.plotArea, 0);
    const note = bar.ok ? t(c.rule === "max" ? "plot.rules.roomMax" : "plot.rules.roomMin", { area }) : t(c.rule === "max" ? "plot.rules.overMax" : "plot.rules.underMin", { area });
    return (
      <span className="pt-meter">
        <span className="pt-limit-bar" role="img" aria-label={t("plot.rules.barAria", { value: pct(c.actual), limit: pct(c.limit, 0) })} data-ok={bar.ok}>
          <i style={vars({ "--v": `${(bar.value * 100).toFixed(2)}%` })} />
          <span className="pt-limit-mark" style={vars({ "--at": `${(bar.mark * 100).toFixed(2)}%` })} />
        </span>
        <small>{note}</small>
      </span>
    );
  };
  return (
    <section className="shell pt-rules" aria-labelledby="pt-rules-h">
      <h2 className="h2" id="pt-rules-h">{accent(t("plot.rules.title"))}</h2>
      <div className="panel panel-pad pt-rules-card">
        <ul className="pt-checks">
          {view.checks.map((c) => (
            <li key={c.key} data-ok={c.ok} data-unit={c.unit}>
              <span className="pt-check-name">{t(`plot.rules.check.${c.key}`)}<small>{limit(c)}</small></span>
              <b className="mono">{value(c)}</b>
              <span className="pt-status" data-ok={c.ok}>{c.ok ? t("plot.rules.ok") : t("plot.rules.fail")}</span>
              {c.unit === "ratio" && meter(c)}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
