"use client";
// The side panel of the 3D page: time of day, section, layers, movable shading (the louvres only turn; the blinds take three
// positions) and the look. A presentational component:
// the state and the engine calls live in ModelTool, so this file only turns values into controls and texts.
import type { ReactNode } from "react";
import { Chips, Segmented, Slider, Switch } from "@/components/ui/controls";
import { useFormat, useLocale, useT } from "@/lib/i18n/client";
import { pick } from "@/lib/model/text";
import type { LookSelection, StyleModel } from "@/lib/three/style";
import { BLIND_STATES, DAY_PRESETS, PLAN_CUT_M, CUT_RANGE, lookGroups, lookSwatch, type BlindState, type DayPreset, type ModelSettings } from "./settings";

/** The terrace louvres: they only turn, from the closed stop (`min`, derived.screens[].closedDeg) to 90 degrees (open). */
interface Louvres {
  angle: number;
  min: number;
  max: number;
  onAngle: (deg: number) => void;
}

/** The slat tilt of the exterior blinds, degrees (0 level, 90 closed); shown while the blinds are not up. */
interface BlindTilt {
  tilt: number;
  onTilt: (deg: number) => void;
}

/** Step of the angle sliders, degrees. */
const ANGLE_STEP = 5;

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
  /** The terrace louvres; null when the model has none. */
  louvres: Louvres | null;
  /** Does the model give any opening an exterior blind? Then the position control and the tilt slider are shown. */
  hasBlinds: boolean;
  blinds: BlindTilt;
  /** The garage door switch; null unless the GLB has a door leaf to move. */
  garage: { open: boolean; onOpen: (open: boolean) => void } | null;
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
  const blindLabel: Record<BlindState, string> = { up: t("common.shading.up"), half: t("common.shading.half"), down: t("common.shading.down") };
  const louvreText = (v: number, l: Louvres) => (v <= l.min ? t("common.shading.closed") : v >= l.max ? t("common.shading.open") : f.degrees(v));
  const tiltText = (v: number) => (v <= 0 ? t("common.shading.level") : v >= 90 ? t("common.shading.shut") : f.degrees(v));
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
        <Switch label={t("model.layers.pv")} checked={settings.pv} onChange={(pv) => onSettings({ pv })} hint={settings.pv ? p.pvHint : null} />
        <Switch label={t("model.layers.green")} checked={settings.green} onChange={(green) => onSettings({ green })} />
        <Switch label={t("model.layers.roomLabels")} checked={p.roomLabels} onChange={p.onRoomLabels} hint={t("model.layers.roomLabelsHint", { height: planHeight })} />
        <Switch label={t("model.layers.boundary")} checked={settings.boundary} onChange={(boundary) => onSettings({ boundary })} />
        {p.garage && <Switch label={t("model.garageOpen")} checked={p.garage.open} onChange={p.garage.onOpen} />}
      </Group>

      {(p.louvres || p.hasBlinds) && (
        <Group title={t("common.shading.title")}>
          {p.louvres && (
            <Slider
              label={t("common.shading.louvres")} value={p.louvres.angle} min={p.louvres.min} max={p.louvres.max} step={ANGLE_STEP}
              onChange={p.louvres.onAngle} format={(v) => louvreText(v, p.louvres!)}
              hint={t("common.shading.louvreHint", { closed: f.degrees(p.louvres.min) })}
            />
          )}
          {p.hasBlinds && (
            <>
              <Segmented<BlindState>
                label={t("common.shading.blinds")}
                value={settings.blinds}
                options={BLIND_STATES.map((id) => ({ value: id, label: blindLabel[id] }))}
                onChange={(blinds) => onSettings({ blinds })}
              />
              {settings.blinds !== "up" && (
                <Slider label={t("common.shading.blindsTilt")} value={p.blinds.tilt} min={0} max={90} step={ANGLE_STEP} onChange={p.blinds.onTilt}
                  format={tiltText} hint={t("common.shading.blindsTiltHint", { closed: f.degrees(90) })} />
              )}
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
