// "How it is calculated" of the Energy page: the method in words, the main assumptions with their values from the data files,
// the limits and the disclaimer. A server component: the page renders it inside the shared MethodNote, so it ships no client code.

import type { EnergyContext } from "@/lib/calc/energy";
import type { Formatter } from "@/lib/i18n/format";
import type { T } from "@/lib/i18n/messages";

export function EnergyMethod({ ctx, t, f }: { ctx: EnergyContext; t: T; f: Formatter }) {
  const { assumptions: a, climate, house } = ctx;
  return (
    <>
      <p>{t("energy.method.heat", { temp: f.unit(a.climate.designOutdoorC, "°C") })}</p>
      <p>
        {t("energy.method.electricity", {
          dist: f.percent(a.heating.distributionLossShare * 100),
          dhw: f.percent(a.dhw.lossShare * 100),
          fixed: f.money(a.economy.fixedChargesPerYear),
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
      <div className="method-kv">
        <h3>{t("energy.method.assumptions")}</h3>
        <dl className="kv">
          <dt>{t("energy.method.aRoofBridge")}</dt><dd>{f.unit(a.thermal.thermalBridgeDeltaU, t("energy.units.u"), 2)}</dd>
          <dt>{t("energy.method.aHeatCapacity")}</dt><dd>{f.unit(a.thermal.internalHeatCapacityKjPerM2K, "kJ/(m²·K)")}</dd>
          <dt>{t("energy.method.aAir")}</dt><dd>{f.unit(a.ventilation.airflowPerPersonM3h, "m³/h")}</dd>
          <dt>{t("energy.method.aMinAir")}</dt><dd>{f.unit(a.ventilation.minAirChangeRate, t("energy.units.n50"), 1)}</dd>
          <dt>{t("energy.method.aSoil")}</dt><dd>{f.unit(a.ground.soilLambda, "W/(m·K)", 1)}</dd>
          <dt>{t("energy.method.aDesign")}</dt><dd>{f.unit(a.climate.designOutdoorC, "°C")}</dd>
          <dt>{t("energy.method.aRecovery")}</dt><dd>{f.percent(house.equipment.ventilation.heatRecoveryEfficiency * 100)}</dd>
          <dt>{t("energy.method.aBattery")}</dt><dd>{f.percent(a.battery.usableShare * 100)}</dd>
          <dt>{t("energy.method.aStatus")}</dt><dd>{t(a.meta.status === "reviewed" ? "energy.method.statusReviewed" : "energy.method.statusStarter")}</dd>
        </dl>
      </div>
      <p className="note">{t("energy.disclaimer")} {t("energy.method.credit", { year: String(a.meta.priceYear) })}</p>
    </>
  );
}
