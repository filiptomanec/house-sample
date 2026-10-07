"use client";

// The three headline numbers and the band that puts the house price next to the typical range for its size.
import { Stat } from "@/components/ui/controls";
import type { BudgetResult } from "@/lib/calc/budgetCompute";
import { estimateBand, type Pricebook } from "@/lib/calc/budgetCore";
import { useFormat, useT } from "@/lib/i18n/client";
import { bandScale } from "./bandScale";

const MILLION = 1e6;

export function Summary({ result, book }: { result: BudgetResult; book: Pricebook }) {
  const t = useT();
  const f = useFormat();
  const million = (v: number) => f.num(v / MILLION, 2);
  return (
    <section className="budget-stats" aria-label={t("budget.summary.label")}>
      <Stat accent value={million(result.total)} unit={t("budget.million")} label={t("budget.summary.total")} />
      <Stat value={million(result.coreWithVat)} unit={t("budget.million")} label={t("budget.summary.house")} />
      <Stat value={result.perM2 === null ? f.num(NaN) : f.int(result.perM2)} unit={t("budget.perM2Unit")}
        label={t("budget.summary.perM2", { area: f.area(result.floorArea) })} />
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
  // millions written out (money({ compact }) uses the browser's own abbreviations, which differ between Node and browsers)
  const compact = (v: number) => f.unit(v / MILLION, t("budget.million"), 0, 1);
  const edge = scale.at(house) < 0.08 ? "start" : scale.at(house) > 0.92 ? "end" : undefined;
  return (
    <figure className="band">
      <div className="band-plot" role="img"
        aria-label={t("budget.band.alt", { house: compact(house), low: compact(band.low), high: compact(band.high) })}>
        <b className="band-val num" data-edge={edge} style={{ left: pct(house) }}>{compact(house)}</b>
        <div className="band-track">
          <span className="band-range" style={{ left: pct(band.low), width: `${((scale.at(band.high) - scale.at(band.low)) * 100).toFixed(2)}%` }} />
          <i className="band-dot" style={{ left: pct(house) }} />
        </div>
        <div className="band-ticks num" aria-hidden="true">
          {scale.ticks.map((v) => <span key={v} style={{ left: pct(v) }}>{f.num(v / MILLION)}</span>)}
        </div>
      </div>
      <figcaption className="small">
        {t("budget.band.caption", {
          low: compact(band.low), high: compact(band.high),
          lowM2: f.money(book.benchmark.perM2Low), highM2: f.money(book.benchmark.perM2High),
        })}{" "}
        {t(`budget.band.${scale.where}`)}
      </figcaption>
    </figure>
  );
}
