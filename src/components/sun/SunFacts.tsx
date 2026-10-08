"use client";
// The sun at the chosen moment as a short list: where it stands, when it rises and sets, how long the day is.
import { memo } from "react";
import { useFormat, useT } from "@/lib/i18n/client";
import { compassPoint, type SunPosition, type SunTimes } from "@/lib/calc/sun";

/** Clock hours 0..24 for display; a sunset after midnight is written on the 24-hour clock of the next day. */
const wrap = (h: number) => ((h % 24) + 24) % 24;

function SunFactsView({ sun, times }: { sun: Pick<SunPosition, "azimuth" | "altitude">; times: SunTimes }) {
  const t = useT(), f = useFormat();
  const up = sun.altitude > 0;
  return (
    <section className="sun-facts" aria-labelledby="sun-facts-title">
      <h3 className="label" id="sun-facts-title" aria-level={2}>{t("sun.facts.title")}</h3>
      <dl className="kv">
        <dt>{t("sun.facts.azimuth")}</dt>
        <dd>{f.degrees(sun.azimuth, 1)} ({t(`sun.compass.long.${compassPoint(sun.azimuth)}`)})</dd>
        <dt>{t("sun.facts.altitude")}</dt>
        <dd>{up ? f.degrees(sun.altitude, 1) : t("sun.facts.below")}</dd>
        {times.polar === "none" ? (
          <>
            <dt>{t("sun.facts.sunrise")}</dt>
            <dd>{times.sunrise === null ? f.clockHours(0) : f.clockHours(wrap(times.sunrise))}</dd>
            <dt>{t("sun.facts.sunset")}</dt>
            <dd>{times.sunset === null ? f.clockHours(0) : f.clockHours(wrap(times.sunset))}</dd>
          </>
        ) : (
          <>
            <dt>{t("sun.facts.sunrise")}</dt>
            <dd>{times.polar === "day" ? t("sun.facts.polarDay") : t("sun.facts.polarNight")}</dd>
          </>
        )}
        <dt>{t("sun.facts.noon")}</dt>
        <dd>{t("sun.facts.noonAt", { time: f.clockHours(wrap(times.solarNoon)), altitude: f.degrees(times.noonAltitude, 0) })}</dd>
        <dt>{t("sun.facts.dayLength")}</dt>
        <dd>{f.duration(times.dayLength)}</dd>
      </dl>
    </section>
  );
}

export const SunFacts = memo(SunFactsView);
export default SunFacts;
