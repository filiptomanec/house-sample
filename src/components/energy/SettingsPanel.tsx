"use client";

// The settings rail of the Energy page: household, house and heating, prices. Every range and default comes from
// energyInputSpecs() (model/assumptions.json); nothing about the house is typed here.
//
// The groups are closed in the server HTML and say in one line what they hold, so a phone gets a short page and never sees
// them snap shut after hydration. On a wide screen (the sticky rail) the household opens after mount (useOpenWhenWide; the CSS
// shows it before that). When the rail is taller than the window it scrolls on its own and fades its lower edge (useRailMask).

import { useMemo, useRef, type ReactNode } from "react";
import { energyInputSpecs, type NumericInputKey } from "@/lib/calc/energy";
import { NumberField, Segmented, Slider, Switch } from "@/components/ui/controls";
import { useFormat, useT } from "@/lib/i18n/client";
import { MQ } from "@/styles/breakpoints";
import { useOpenWhenWide, useRailMask } from "./disclosure";
import type { EnergyState } from "./useEnergy";

function Group({ title, summary, wide, children }: { title: string; summary: string; wide?: boolean; children: ReactNode }) {
  return (
    <details className="grp energy-grp" data-wide-open={wide ? "" : undefined}>
      <summary>
        <span className="grp-head">
          <span className="label">{title}</span>
          <span className="grp-sum">{summary}</span>
        </span>
      </summary>
      <div className="stack">{children}</div>
    </details>
  );
}

export function SettingsPanel({ state }: { state: EnergyState }) {
  const t = useT();
  const f = useFormat();
  const { ctx, inputs, result, setNumber, setFlag, reset } = state;
  const rail = useRef<HTMLElement>(null);
  useOpenWhenWide(rail, MQ.minLg);
  useRailMask(rail);
  const spec = useMemo(() => energyInputSpecs(ctx), [ctx]);
  const range = (k: NumericInputKey) => ({ min: spec[k].min, max: spec[k].max, step: spec[k].step });
  const num = (k: NumericInputKey) => ({ value: inputs[k], onChange: (v: number) => setNumber(k, v), ...range(k) });
  const heating = ctx.house.equipment.heating;
  const mechanical = ctx.house.equipment.ventilation.type !== "natural";
  const price = (v: number) => f.unit(v, t("energy.units.pricePerKwh"), 0, 2);

  const summaries = {
    household: t("energy.settings.summary.household", {
      persons: t("common.count.persons", { count: inputs.persons }),
      dhw: f.unit(inputs.dhwLitresPerPersonDay, "l"),
      appliances: f.unit(inputs.appliancesKwhYear, t("energy.units.kwh")),
    }),
    house: t("energy.settings.summary.house", {
      temp: f.unit(inputs.indoorTempC, "°C", 0, 1),
      scop: f.num(inputs.scop, 1, 2),
      ventilation: t(inputs.heatRecovery && mechanical ? "energy.settings.ventRecovery" : "energy.settings.ventWindows"),
    }),
    prices: t("energy.settings.summary.prices", { buy: price(inputs.priceBuy), sell: price(inputs.priceSell) }),
  };

  return (
    <aside className="energy-controls panel panel-pad" aria-label={t("energy.settings.label")} ref={rail}>
      <Group title={t("energy.settings.household")} summary={summaries.household} wide>
        <Slider label={t("energy.settings.persons")} {...num("persons")} />
        <Slider label={t("energy.settings.dhw")} {...num("dhwLitresPerPersonDay")} unit={t("energy.units.litresPerDay")} hint={t("energy.settings.dhwHint", { temp: f.unit(heating.dhw.setpointC, "°C") })} />
        <Slider label={t("energy.settings.appliances")} {...num("appliancesKwhYear")} unit={t("energy.units.kwhPerYear")} hint={t("energy.settings.appliancesHint")} />
        <Slider
          label={t("energy.settings.ev")}
          {...num("evKmYear")}
          format={(v) => (v > 0 ? t("energy.settings.evKm", { km: f.int(v) }) : t("energy.settings.evNone"))}
        />
        {inputs.evKmYear > 0 && (
          <Segmented
            label={t("energy.settings.evCharge")}
            value={inputs.evChargeDaytime ? "day" : "evening"}
            options={[
              { value: "evening", label: t("energy.settings.evEvening") },
              { value: "day", label: t("energy.settings.evDay") },
            ]}
            onChange={(v) => setFlag("evChargeDaytime", v === "day")}
          />
        )}
        {result.pool.present && (
          <Switch label={t("energy.pool.label")} checked={inputs.pool} onChange={(v) => setFlag("pool", v)} />
        )}
      </Group>

      <Group title={t("energy.settings.house")} summary={summaries.house}>
        <Slider label={t("energy.settings.indoorTemp")} {...num("indoorTempC")} unit="°C" />
        {mechanical && (
          <Segmented
            label={t("energy.settings.ventilation")}
            value={inputs.heatRecovery ? "recovery" : "windows"}
            options={[
              { value: "recovery", label: t("energy.settings.ventRecovery") },
              { value: "windows", label: t("energy.settings.ventWindows") },
            ]}
            onChange={(v) => setFlag("heatRecovery", v === "recovery")}
          />
        )}
        <Slider label={t("energy.settings.n50")} {...num("n50")} unit={t("energy.units.n50")} hint={t("energy.settings.n50Hint")} />
        <Slider label={t("energy.settings.scop")} {...num("scop")} hint={t("energy.settings.scopHint")} />
        <Slider label={t("energy.settings.scopDhw")} {...num("scopDhw")} />
        <Switch label={t("energy.settings.dhwSolar")} checked={inputs.dhwDaytime} onChange={(v) => setFlag("dhwDaytime", v)} hint={t("energy.settings.dhwSolarHint")} />
      </Group>

      <Group title={t("energy.settings.prices")} summary={summaries.prices}>
        <Slider label={t("energy.settings.priceBuy")} {...num("priceBuy")} unit={t("energy.units.pricePerKwh")} hint={t("energy.settings.priceBuyHint")} />
        <Slider label={t("energy.settings.priceSell")} {...num("priceSell")} unit={t("energy.units.pricePerKwh")} />
        <NumberField label={t("energy.settings.pvPrice")} unit={t("energy.units.currency")} {...num("pvPricePerKwp")} />
        <NumberField label={t("energy.settings.batteryPrice")} unit={t("energy.units.currency")} {...num("batteryPricePerKwh")} />
        <NumberField label={t("energy.settings.subsidy")} unit={t("energy.units.currency")} {...num("subsidy")} />
        <p className="note">{t("energy.settings.pricesNote", { year: String(ctx.assumptions.meta.priceYear) })}</p>
      </Group>

      <button type="button" className="btn ghost sm energy-reset" onClick={reset}>{t("energy.settings.reset")}</button>
    </aside>
  );
}
