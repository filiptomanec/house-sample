"use client";

// The instrument of the Energy page: the four headline figures, then the settings rail beside the results (the roof, money,
// the two charts, where the heat and the electricity go). Up to 1180 px the rail joins the column after the money card, so the
// roof and the answers come first. All state is in useEnergy(); the method note and the next page are server parts of the page.

import { useState } from "react";
import { monthNames } from "@/lib/calendar";
import { useLocale, useT } from "@/lib/i18n/client";
import { DayChart, type DayKind } from "./DayChart";
import { KeyFigures, MoneyFigures, Warnings } from "./Figures";
import { MonthPicker } from "./MonthPicker";
import { MonthlyChart } from "./MonthlyChart";
import { RoofCard } from "./RoofCard";
import { SettingsPanel } from "./SettingsPanel";
import { DesignPanel, ElectricityPanel, HeatPanel, SummerPanel } from "./Tables";
import { useEnergy } from "./useEnergy";

export default function EnergyTool() {
  const t = useT();
  const locale = useLocale();
  const state = useEnergy();
  const { result, month, setMonth, ctx } = state;
  const [dayKind, setDayKind] = useState<DayKind>("average");

  return (
    <div className="shell energy">
      <KeyFigures result={result} />
      <Warnings result={result} />
      <div className="energy-grid">
        <SettingsPanel state={state} />
        <div className="energy-results">
          <RoofCard state={state} />
          <MoneyFigures result={result} />
          <section className="panel panel-pad energy-chart" aria-labelledby="monthly-title">
            <div className="section-head">
              <h2 className="h3" id="monthly-title">{t("energy.charts.monthlyTitle")}</h2>
              <p className="small">{t("energy.charts.monthlyLede")}</p>
            </div>
            <MonthlyChart result={result} month={month} onMonth={setMonth} />
          </section>
          <section className="panel panel-pad energy-chart" aria-labelledby="day-title">
            <div className="section-head">
              <h2 className="h3" id="day-title">{t("energy.charts.dayTitle", { month: monthNames(locale, "long")[month] })}</h2>
              <p className="small">{t("energy.charts.dayLede")}</p>
            </div>
            <MonthPicker month={month} onMonth={setMonth} />
            <DayChart result={result} month={month} kind={dayKind} onKind={setDayKind} />
          </section>
          <div className="energy-tables">
            <HeatPanel result={result} bridgeDeltaU={ctx.assumptions.thermal.thermalBridgeDeltaU} />
            <div className="energy-side-cards">
              <ElectricityPanel result={result} />
              <DesignPanel result={result} />
              <SummerPanel result={result} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
