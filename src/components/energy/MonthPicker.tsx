"use client";

import { monthNames } from "@/lib/calendar";
import { Segmented } from "@/components/ui/controls";
import { useLocale, useT } from "@/lib/i18n/client";
import { shortMonths } from "./months";

/**
 * The month of the day chart: one choice of twelve, so a Segmented control (DESIGN.md, control rule). It keeps one row while the
 * short names fit and becomes a balanced grid (6 × 2, 4 × 3) on narrower screens; each segment carries the full month name.
 */
export function MonthPicker({ month, onMonth }: { month: number; onMonth: (m: number) => void }) {
  const locale = useLocale();
  const t = useT();
  const short = shortMonths(locale);
  const long = monthNames(locale, "long");
  return (
    <div className="month-pick">
      <Segmented
        ariaLabel={t("energy.charts.month")}
        value={month}
        options={short.map((name, i) => ({ value: i, label: <><span aria-hidden>{name}</span><span className="sr-only">{long[i]}</span></> }))}
        onChange={onMonth}
      />
    </div>
  );
}
