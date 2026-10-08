"use client";

// The three headline figures and the band that puts the house price next to the typical range for its size. Amounts are
// estimates (three significant digits, the method says so); the band's marker has the precision of the stat above it, and the
// order of currency and amount comes from budget.money.* (view.ts).

import { Stat } from "@/components/ui/controls";
import type { BudgetResult } from "@/lib/calc/budgetCompute";
import { estimateBand, type Pricebook } from "@/lib/calc/budgetCore";
import { useFormat, useT } from "@/lib/i18n/client";
import { bandScale } from "./bandScale";
import { MILLION, millionText, summaryFigures } from "./view";

export function Summary({ result, book }: { result: BudgetResult; book: Pricebook }) {
  const t = useT();
  const f = useFormat();
  return (
    <section className="budget-stats" aria-label={t("budget.summary.label")}>
      <div className="budget-figures" aria-live="polite">
        {summaryFigures(result, t, f).map((s) => (
          <Stat key={s.key} value={s.value} unit={s.unit} prefix={s.prefix} suffix={s.suffix} label={s.label} accent={s.accent} />
        ))}
      </div>
      <Band result={result} book={book} />
    </section>
  );
}

function Band({ result, book }: { result: BudgetResult; book: Pricebook }) {
  const t = useT();
  const f = useFormat();
  const band = estimateBand(book, result.floorArea);
  if (!band || !book.benchmark) return null;
  const house = result.coreWithVat;
  const scale = bandScale(band.low, band.high, house);
  const pct = (v: number) => `${(scale.at(v) * 100).toFixed(2)}%`;
  const edge = scale.at(house) < 0.08 ? "start" : scale.at(house) > 0.92 ? "end" : undefined;
  const m = (v: number) => millionText(t, f, v);
  return (
    <figure className="band">
      <figcaption className="band-head">
        <span className="label">{t("budget.band.label")}</span>
        <span className="band-where">{t(`budget.band.${scale.where}`)}</span>
      </figcaption>
      <div className="band-plot" role="img" aria-label={t("budget.band.alt", { house: m(house), low: m(band.low), high: m(band.high) })}>
        <b className="band-val num" data-edge={edge} style={{ left: pct(house) }}>{m(house)}</b>
        <div className="band-track">
          <span className="band-range" style={{ left: pct(band.low), width: `${((scale.at(band.high) - scale.at(band.low)) * 100).toFixed(2)}%` }} />
          <i className="band-dot" style={{ left: pct(house) }} />
        </div>
        <div className="band-ticks num" aria-hidden="true">
          {scale.ticks.map((v) => <span key={v} style={{ left: pct(v) }}>{f.num(v / MILLION)}</span>)}
        </div>
      </div>
      <p className="small band-caption">
        {t("budget.band.caption", { low: m(band.low), high: m(band.high), lowM2: f.money(book.benchmark.perM2Low), highM2: f.money(book.benchmark.perM2High) })}
      </p>
    </figure>
  );
}
