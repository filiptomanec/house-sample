"use client";

import { monthNames } from "@/lib/calendar";
import { useLocale, useT } from "@/lib/i18n/client";
import { shortMonths } from "./months";

/** Twelve month buttons (four per row on a phone, one row on a desktop); one is pressed. */
export function MonthPicker({ month, onMonth }: { month: number; onMonth: (m: number) => void }) {
  const locale = useLocale();
  const t = useT();
  const short = shortMonths(locale);
  const long = monthNames(locale, "long");
  return (
    <div className="month-pick" role="group" aria-label={t("energy.charts.month")}>
      {short.map((name, i) => (
        <button key={i} type="button" aria-pressed={i === month} aria-label={long[i]} onClick={() => onMonth(i)}>{name}</button>
      ))}
    </div>
  );
}
