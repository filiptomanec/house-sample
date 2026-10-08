"use client";

// "How it is calculated": the method in words, the main assumptions with their values from the data files, the limits.

import type { EnergyContext } from "@/lib/calc/energy";
import { useFormat, useT } from "@/lib/i18n/client";

export function Method({ ctx }: { ctx: EnergyContext }) {
  const t = useT();
  const f = useFormat();
  const { assumptions: a, climate, house } = ctx;
  return (
    <details className="method panel panel-pad">
      <summary><h2 className="h3">{t("energy.method.title")}</h2></summary>
      <div className="method-body small">
        <p>{t("energy.method.heat", { temp: f.unit(a.climate.designOutdoorC, "°C") })}</p>
        <p>
          {t("energy.method.electricity", {
            dist: f.percent(a.heating.distributionLossShare * 100),
            dhw: f.percent(a.dhw.lossShare * 100),
            fixed: f.unit(a.economy.fixedChargesPerYear, t("energy.units.currency")),
          })}
        </p>
        <p>
          {t("energy.method.pv", {
            version: climate.meta.apiVersion.replace("v", "").replace("_", "."),
            db: climate.meta.radiationDb,
            pitch: f.degrees(climate.slope),
            loss: f.percent(climate.loss),
            rte: f.percent(a.battery.roundTripEfficiency * 100),
          })}
        </p>
        <p>{t("energy.method.limits")}</p>
        <h3 className="energy-subhead">{t("energy.method.assumptions")}</h3>
        <div className="kv">
          <span>{t("energy.method.aRoofBridge")}</span><span>{f.unit(a.thermal.thermalBridgeDeltaU, t("energy.units.u"), 2)}</span>
          <span>{t("energy.method.aHeatCapacity")}</span><span>{f.unit(a.thermal.internalHeatCapacityKjPerM2K, "kJ/(m²·K)")}</span>
          <span>{t("energy.method.aAir")}</span><span>{f.unit(a.ventilation.airflowPerPersonM3h, "m³/h")}</span>
          <span>{t("energy.method.aMinAir")}</span><span>{f.unit(a.ventilation.minAirChangeRate, t("energy.units.n50"), 1)}</span>
          <span>{t("energy.method.aSoil")}</span><span>{f.unit(a.ground.soilLambda, "W/(m·K)", 1)}</span>
          <span>{t("energy.method.aDesign")}</span><span>{f.unit(a.climate.designOutdoorC, "°C")}</span>
          <span>{t("energy.method.aRecovery")}</span><span>{f.percent(house.equipment.ventilation.heatRecoveryEfficiency * 100)}</span>
          <span>{t("energy.method.aBattery")}</span><span>{f.percent(a.battery.usableShare * 100)}</span>
          <span>{t("energy.method.aStatus")}</span><span>{t(a.meta.status === "reviewed" ? "energy.method.statusReviewed" : "energy.method.statusStarter")}</span>
        </div>
        <p className="note">{t("energy.method.credit", { year: String(a.meta.priceYear) })}</p>
      </div>
    </details>
  );
}
