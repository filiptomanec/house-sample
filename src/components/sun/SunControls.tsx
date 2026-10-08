"use client";
// The controls of the Sun page: the day (four reference days and a date), the time of day with "play the whole day", and the
// movable shading the model has (terrace slats, exterior blinds). Values are in the units of the sliders; the page applies them.
import { useId } from "react";
import { Segmented, Slider } from "@/components/ui/controls";
import { useFormat, useLocale, useT } from "@/lib/i18n/client";
import type { CalendarDate } from "@/lib/calc/sun";
import { SHADING_RANGE, TIME_STEP_MIN, parseIso, presetOf, shortDate, toIso, type DayPreset, type PresetKey, type SunSettings, type TimeRange } from "./model";

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
  hasSlats: boolean;
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
  const s = p.settings, R = SHADING_RANGE;
  return (
    <div className="stack sun-shading">
      <h3 className="label sun-group" aria-level={2}>{t("sun.shading.title")}</h3>
      {p.hasSlats && (
        <fieldset className="sun-fieldset">
          <legend>{t("sun.shading.slats")}</legend>
          <Slider
            label={t("sun.shading.angle")} value={s.slatAngle} min={R.slatAngle.min} max={R.slatAngle.max} step={R.slatAngle.step}
            format={(v) => (v === R.slatAngle.min ? t("sun.shading.closed") : v === R.slatAngle.max ? t("sun.shading.open") : f.degrees(v))}
            hint={t("sun.shading.angleHint")} onChange={(v) => p.onShading({ slatAngle: v })}
          />
          <Slider
            label={t("sun.shading.slide")} value={s.slatSlide} min={R.slatSlide.min} max={R.slatSlide.max} step={R.slatSlide.step}
            format={(v) => (v === R.slatSlide.min ? t("sun.shading.spread") : v === R.slatSlide.max ? t("sun.shading.stacked") : f.percent(v))}
            hint={t("sun.shading.slideHint")} onChange={(v) => p.onShading({ slatSlide: v })}
          />
        </fieldset>
      )}
      {p.hasBlinds && (
        <fieldset className="sun-fieldset">
          <legend>{t("sun.shading.blinds")}</legend>
          <Slider
            label={t("sun.shading.drop")} value={s.blindDrop} min={R.blindDrop.min} max={R.blindDrop.max} step={R.blindDrop.step}
            format={(v) => (v === R.blindDrop.min ? t("sun.shading.raised") : v === R.blindDrop.max ? t("sun.shading.lowered") : f.percent(v))}
            onChange={(v) => p.onShading({ blindDrop: v })}
          />
          {s.blindDrop > 0 && (
            <Slider
              label={t("sun.shading.tilt")} value={s.blindTilt} min={R.blindTilt.min} max={R.blindTilt.max} step={R.blindTilt.step}
              format={(v) => (v === R.blindTilt.min ? t("sun.shading.horizontal") : v === R.blindTilt.max ? t("sun.shading.closed") : f.degrees(v))}
              hint={t("sun.shading.tiltHint")} onChange={(v) => p.onShading({ blindTilt: v })}
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
      {(p.hasSlats || p.hasBlinds) && <Shading {...p} />}
    </div>
  );
}
