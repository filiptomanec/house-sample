"use client";
// The controls of the Sun page: the day (four reference days and a date), the time of day with "play the whole day", and the
// movable shading the model has (terrace louvres, which only turn; exterior blinds in three positions). Values are in the units of the sliders; the page applies them.
import { useId } from "react";
import { Segmented, Slider } from "@/components/ui/controls";
import { useFormat, useLocale, useT } from "@/lib/i18n/client";
import type { CalendarDate } from "@/lib/calc/sun";
import { BLIND_POSITIONS, SHADING_RANGE, TIME_STEP_MIN, parseIso, presetOf, shortDate, toIso, type DayPreset, type PresetKey, type SunSettings, type TimeRange } from "./model";

export interface SunControlsProps {
  presets: readonly DayPreset[];
  date: CalendarDate;
  onDate: (d: CalendarDate) => void;
  range: TimeRange;
  minute: number;
  onMinute: (minute: number) => void;
  playing: boolean;
  onPlay: () => void;
  settings: SunSettings;
  onShading: (patch: Partial<SunSettings>) => void;
  /** The louvre range (`louvreRange`): they only turn, from the closed stop to 90 degrees. Null when the model has none. */
  louvres: { min: number; max: number } | null;
  hasBlinds: boolean;
}

function DayAndTime(p: SunControlsProps) {
  const t = useT(), f = useFormat(), locale = useLocale();
  const dateId = useId();
  const preset = presetOf(p.date, p.presets);
  return (
    <div className="stack sun-pick">
      <div className="sun-day-pick">
        <Segmented<string>
          label={t("sun.controls.day")}
          value={preset ?? ""}
          options={p.presets.map((x) => ({ value: x.key, label: `${t(`sun.controls.presets.${x.key satisfies PresetKey}`)} ${shortDate(locale, x.date.month, x.date.day)}` }))}
          onChange={(key) => {
            const hit = p.presets.find((x) => x.key === key);
            if (hit) p.onDate(hit.date);
          }}
        />
        <p className="small sun-hint">{t("sun.controls.presetsHint")}</p>
        <div className="field">
          <div className="field-top"><label htmlFor={dateId}>{t("sun.controls.date")}</label></div>
          <input
            id={dateId} className="numin sun-date" type="date" value={toIso(p.date)}
            min={toIso({ year: p.date.year, month: 0, day: 1 })} max={toIso({ year: p.date.year, month: 11, day: 31 })}
            onChange={(e) => {
              const d = parseIso(e.target.value, p.date.year);
              if (d) p.onDate(d);
            }}
          />
        </div>
      </div>
      <Slider
        label={t("sun.controls.time")} value={Math.round(p.minute / TIME_STEP_MIN) * TIME_STEP_MIN} min={p.range.min} max={p.range.max} step={TIME_STEP_MIN}
        format={(m) => f.clock(m)} onChange={p.onMinute}
      />
      <button type="button" className="btn ghost sm sun-play" onClick={p.onPlay}>
        {p.playing ? t("sun.controls.stop") : t("sun.controls.play")}
      </button>
    </div>
  );
}

function Shading(p: SunControlsProps) {
  const t = useT(), f = useFormat();
  const s = p.settings, R = SHADING_RANGE, L = p.louvres;
  const louvreAngle = L ? Math.min(L.max, Math.max(L.min, s.slatAngle)) : 0;
  const blindLabel = { up: t("common.shading.up"), half: t("common.shading.half"), down: t("common.shading.down") } as const;
  return (
    <div className="stack sun-shading">
      <h2 className="label sun-group">{t("common.shading.title")}</h2>
      {L && (
        <fieldset className="sun-fieldset">
          <legend>{t("common.shading.louvres")}</legend>
          <Slider
            label={t("common.shading.louvreAngle")} value={louvreAngle} min={L.min} max={L.max} step={R.slatAngle.step}
            format={(v) => (v <= L.min ? t("common.shading.closed") : v >= L.max ? t("common.shading.open") : f.degrees(v))}
            hint={t("common.shading.louvreHint", { closed: f.degrees(L.min) })} onChange={(v) => p.onShading({ slatAngle: v })}
          />
        </fieldset>
      )}
      {p.hasBlinds && (
        <fieldset className="sun-fieldset">
          <legend>{t("common.shading.blinds")}</legend>
          <Segmented<number>
            ariaLabel={t("common.shading.blindsDrop")}
            value={s.blindDrop}
            options={BLIND_POSITIONS.map((b) => ({ value: b.drop, label: blindLabel[b.key] }))}
            onChange={(blindDrop) => p.onShading({ blindDrop })}
          />
          {s.blindDrop > 0 && (
            <Slider
              label={t("common.shading.blindsTilt")} value={s.blindTilt} min={R.blindTilt.min} max={R.blindTilt.max} step={R.blindTilt.step}
              format={(v) => (v === R.blindTilt.min ? t("common.shading.level") : v === R.blindTilt.max ? t("common.shading.shut") : f.degrees(v))}
              hint={t("common.shading.blindsTiltHint", { closed: f.degrees(R.blindTilt.max) })} onChange={(v) => p.onShading({ blindTilt: v })}
            />
          )}
        </fieldset>
      )}
    </div>
  );
}

export default function SunControls(p: SunControlsProps) {
  return (
    <div className="sun-controls">
      <DayAndTime {...p} />
      {(p.louvres || p.hasBlinds) && <Shading {...p} />}
    </div>
  );
}
