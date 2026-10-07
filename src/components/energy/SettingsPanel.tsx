"use client";

// The left column of the Energy page: household, house and heating, prices. Every range and default comes from
// energyInputSpecs() (model/assumptions.json); nothing about the house is typed here.

import { useMemo } from "react";
import { energyInputSpecs, type NumericInputKey } from "@/lib/calc/energy";
import { NumberField, Segmented, Slider, Switch } from "@/components/ui/controls";
import { useNarrow } from "@/components/ui/useNarrow";
import { useFormat, useT } from "@/lib/i18n/client";
import type { EnergyState } from "./useEnergy";

export function SettingsPanel({ state }: { state: EnergyState }) {
  const t = useT();
  const f = useFormat();
  const { ctx, inputs, setNumber, setFlag, reset } = state;
  const narrow = useNarrow(); // on a phone only the household group starts open, so the results are not pushed far down
  const spec = useMemo(() => energyInputSpecs(ctx), [ctx]);
  const range = (k: NumericInputKey) => ({ min: spec[k].min, max: spec[k].max, step: spec[k].step });
  const num = (k: NumericInputKey) => ({ value: inputs[k], onChange: (v: number) => setNumber(k, v), ...range(k) });
  const heating = ctx.house.equipment.heating;
  const mechanical = ctx.house.equipment.ventilation.type !== "natural";

  return (
    <aside className="energy-controls panel panel-pad" aria-label={t("energy.settings.label")}>
      <details open className="grp">
        <summary className="label">{t("energy.settings.household")}</summary>
        <div className="stack">
          <Slider label={t("energy.settings.persons")} {...num("persons")} />
          <Slider label={t("energy.settings.indoorTemp")} {...num("indoorTempC")} unit="°C" />
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
        </div>
      </details>

      <details open={!narrow} className="grp">
        <summary className="label">{t("energy.settings.house")}</summary>
        <div className="stack">
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
        </div>
      </details>

      <details open={!narrow} className="grp">
        <summary className="label">{t("energy.settings.prices")}</summary>
        <div className="stack">
          <Slider label={t("energy.settings.priceBuy")} {...num("priceBuy")} unit={t("energy.units.pricePerKwh")} hint={t("energy.settings.priceBuyHint")} />
          <Slider label={t("energy.settings.priceSell")} {...num("priceSell")} unit={t("energy.units.pricePerKwh")} />
          <NumberField label={t("energy.settings.pvPrice")} unit={t("energy.units.currency")} {...num("pvPricePerKwp")} />
          <NumberField label={t("energy.settings.batteryPrice")} unit={t("energy.units.currency")} {...num("batteryPricePerKwh")} />
          <NumberField label={t("energy.settings.subsidy")} unit={t("energy.units.currency")} {...num("subsidy")} />
          <p className="note">{t("energy.settings.pricesNote", { year: String(ctx.assumptions.meta.priceYear) })}</p>
        </div>
      </details>

      <button type="button" className="btn ghost sm energy-reset" onClick={reset}>{t("energy.settings.reset")}</button>
    </aside>
  );
}
