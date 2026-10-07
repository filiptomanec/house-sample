"use client";
// The side panel of the 3D page: time of day, section, layers, movable shading and the look. A presentational component:
// the state and the engine calls live in ModelTool, so this file only turns values into controls and texts.
import type { ReactNode } from "react";
import { Chips, Segmented, Slider, Switch } from "@/components/ui/controls";
import { useFormat, useLocale, useT } from "@/lib/i18n/client";
import { pick } from "@/lib/model/text";
import type { LookSelection, StyleModel } from "@/lib/three/style";
import { DAY_PRESETS, PLAN_CUT_M, CUT_RANGE, lookGroups, lookSwatch, type DayPreset, type ModelSettings } from "./settings";

/** Values and handlers for a pair of sliders of a movable part (all in percent or degrees, as the sliders show them). */
interface Pair {
  a: number;
  b: number;
  onA: (v: number) => void;
  onB: (v: number) => void;
}

export interface ControlPanelProps {
  settings: ModelSettings;
  onSettings: (patch: Partial<ModelSettings>) => void;
  /** The solstice day as written in a sentence ("21. června"). */
  dayDate: string;
  cut: number;
  cutMax: number;
  onCut: (v: number) => void;
  roomLabels: boolean;
  onRoomLabels: (on: boolean) => void;
  furnitureHint: string | null;
  pvHint: string | null;
  /** Slat screens (angle, position); null when the model has none. */
  screens: Pair | null;
  /** Does the model give any opening an exterior blind? Then the layer switch and the blind sliders are shown. */
  hasBlinds: boolean;
  /** Exterior blinds (position, tilt). */
  blinds: Pair;
  style: StyleModel;
  look: LookSelection;
  onLook: (group: string, option: string) => void;
}

function Group({ title, children }: { title: ReactNode; children: ReactNode }) {
  return (
    <details className="grp" open>
      <summary><span className="label">{title}</span></summary>
      <div className="stack">{children}</div>
    </details>
  );
}

export default function ControlPanel(p: ControlPanelProps) {
  const t = useT(), f = useFormat(), locale = useLocale();
  const { settings, onSettings } = p;
  const dayLabel: Record<DayPreset, string> = {
    morning: t("model.day.morning"), noon: t("model.day.noon"), afternoon: t("model.day.afternoon"), evening: t("model.day.evening"),
  };
  const percentText = (v: number, zero: string, full: string) => (v <= 0 ? zero : v >= 100 ? full : f.percent(v));
  const degreeText = (v: number, zero: string, full: string) => (v <= 0 ? zero : v >= 90 ? full : f.degrees(v));
  const planHeight = f.length(PLAN_CUT_M, 1);

  return (
    <aside className="panel panel-pad model-controls" aria-label={t("model.panel.label")}>
      <Group title={t("model.panel.light")}>
        <Segmented
          ariaLabel={t("model.day.label")}
          value={settings.day}
          options={DAY_PRESETS.map((id) => ({ value: id, label: dayLabel[id] }))}
          onChange={(day) => onSettings({ day })}
        />
        <p className="note">{t("model.day.hint", { date: p.dayDate })}</p>
        <Slider
          label={t("model.cut.label")} value={p.cut} min={CUT_RANGE.min} max={p.cutMax} step={CUT_RANGE.step} onChange={p.onCut}
          format={(v) => (v >= p.cutMax ? t("model.cut.none") : t("model.cut.value", { height: f.length(v, 1) }))}
          hint={t("model.cut.hint", { height: planHeight })}
        />
      </Group>

      <Group title={t("model.layers.title")}>
        <Switch label={t("model.layers.roof")} checked={settings.roof} onChange={(roof) => onSettings({ roof })} />
        <Switch label={t("model.layers.furniture")} checked={settings.furniture} onChange={(furniture) => onSettings({ furniture })} hint={p.furnitureHint} />
        {p.hasBlinds && <Switch label={t("model.layers.blinds")} checked={settings.blinds} onChange={(blinds) => onSettings({ blinds })} hint={t("model.layers.blindsHint")} />}
        <Switch label={t("model.layers.pv")} checked={settings.pv} onChange={(pv) => onSettings({ pv })} hint={settings.pv ? p.pvHint : null} />
        <Switch label={t("model.layers.green")} checked={settings.green} onChange={(green) => onSettings({ green })} />
        <Switch label={t("model.layers.roomLabels")} checked={p.roomLabels} onChange={p.onRoomLabels} hint={t("model.layers.roomLabelsHint", { height: planHeight })} />
        <Switch label={t("model.layers.boundary")} checked={settings.boundary} onChange={(boundary) => onSettings({ boundary })} />
      </Group>

      {(p.screens || (p.hasBlinds && settings.blinds)) && (
        <Group title={t("model.panel.shading")}>
          {p.screens && (
            <>
              <Slider label={t("model.screens.angle")} value={p.screens.a} min={0} max={90} step={5} onChange={p.screens.onA}
                format={(v) => degreeText(v, t("model.screens.closed"), t("model.screens.open"))} />
              <Slider label={t("model.screens.slide")} value={p.screens.b} min={0} max={100} step={5} onChange={p.screens.onB}
                format={(v) => percentText(v, t("model.screens.spread"), t("model.screens.stacked"))} />
            </>
          )}
          {p.hasBlinds && settings.blinds && (
            <>
              <Slider label={t("model.blinds.drop")} value={p.blinds.a} min={0} max={100} step={5} onChange={p.blinds.onA}
                format={(v) => percentText(v, t("model.blinds.raised"), t("model.blinds.lowered"))} />
              <Slider label={t("model.blinds.tilt")} value={p.blinds.b} min={0} max={90} step={5} onChange={p.blinds.onB}
                format={(v) => degreeText(v, t("model.blinds.flat"), t("model.blinds.closed"))} />
            </>
          )}
        </Group>
      )}

      <Group title={t("model.look.title")}>
        {lookGroups(p.style).map(([key, group]) => (
          <Chips
            key={key}
            label={pick(group.label, locale)}
            options={group.options.map((o) => ({ value: o.id, label: pick(o.name, locale), dot: lookSwatch(o, p.style) ?? undefined }))}
            selected={[p.look[key]]}
            onToggle={(id) => p.onLook(key, id)}
          />
        ))}
      </Group>
    </aside>
  );
}
