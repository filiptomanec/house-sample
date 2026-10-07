"use client";

// The Energy page: settings on the left, results on the right (stacked on small screens). All state is in useEnergy().

import { useState } from "react";
import { useT } from "@/lib/i18n/client";
import { DayChart } from "./DayChart";
import { KeyFigures, MoneyFigures, Warnings } from "./Figures";
import { Method } from "./Method";
import { MonthPicker } from "./MonthPicker";
import { MonthlyChart } from "./MonthlyChart";
import { RoofCard } from "./RoofCard";
import { SettingsPanel } from "./SettingsPanel";
import { ElectricityPanel, HeatPanel } from "./Tables";
import { useEnergy } from "./useEnergy";
import { monthNames } from "@/lib/calendar";
import { useLocale } from "@/lib/i18n/client";

export default function EnergyTool() {
  const t = useT();
  const locale = useLocale();
  const state = useEnergy();
  const { result, month, setMonth, ctx } = state;
  const [dayKind, setDayKind] = useState<"average" | "clear" | "partly" | "overcast" | "dark">("average");

  return (
    <div className="shell energy">
      <p className="note energy-disclaimer">{t("energy.disclaimer")}</p>
      <Warnings result={result} />
      <KeyFigures result={result} />
      <div className="energy-grid">
        <SettingsPanel state={state} />
        <div className="energy-results">
          <RoofCard state={state} />
          <MoneyFigures result={result} />
          <section className="panel panel-pad" aria-labelledby="monthly-title">
            <div className="section-head">
              <h2 className="h3" id="monthly-title">{t("energy.charts.monthlyTitle")}</h2>
              <p className="small">{t("energy.charts.monthlyLede")}</p>
            </div>
            <MonthlyChart result={result} month={month} onMonth={setMonth} />
          </section>
          <section className="panel panel-pad" aria-labelledby="day-title">
            <div className="section-head">
              <h2 className="h3" id="day-title">{t("energy.charts.dayTitle", { month: monthNames(locale, "long")[month] })}</h2>
              <p className="small">{t("energy.charts.dayLede")}</p>
            </div>
            <MonthPicker month={month} onMonth={setMonth} />
            <DayChart result={result} month={month} kind={dayKind} onKind={setDayKind} />
          </section>
          <div className="cols-2 energy-tables">
            <HeatPanel result={result} bridgeDeltaU={ctx.assumptions.thermal.thermalBridgeDeltaU} />
            <ElectricityPanel result={result} />
          </div>
          <Method ctx={ctx} />
        </div>
      </div>
    </div>
  );
}
