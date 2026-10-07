"use client";
import { useState } from "react";
import { NumberField } from "@/components/ui/controls";
import { useFormat, useLocale, useT } from "@/lib/i18n/client";
import { FURNITURE } from "@/lib/model/catalog";
import { PRESET_TYPES, SIZE_RANGE, type ItemKind, type MyItem } from "@/lib/plan/myFurniture";

/** Panel of the "My furniture" mode: presets, a custom piece, and the actions for the selected piece. */
export function FurniturePanel({ items, sel, names, onAdd, onRotate, onRemove, onClear }: {
  items: readonly MyItem[]; sel: number | null; names: readonly string[];
  onAdd: (kind: ItemKind, size?: { w: number; d: number }) => void; onRotate: () => void; onRemove: () => void; onClear: () => void;
}) {
  const t = useT(), f = useFormat(), locale = useLocale();
  const [w, setW] = useState(100), [d, setD] = useState(60);
  const [lo, hi] = [Math.round(SIZE_RANGE[0] * 100), Math.round(SIZE_RANGE[1] * 100)];
  const item = sel !== null ? items[sel] : undefined;
  return (
    <div className="stack">
      <p className="label">{t("plan.furniture.title")}</p>
      <p className="small">{t("plan.furniture.intro")}</p>
      {item && sel !== null && (
        <div className="panel panel-pad pl-selected">
          <b>{names[sel]}</b>
          <span className="mono small">{f.int(item.w * 100)}{" × "}{f.int(item.d * 100)}{" cm"}</span>
          <div className="pl-actions">
            <button type="button" className="btn ghost sm" onClick={onRotate}>{t("plan.furniture.rotate")}</button>
            <button type="button" className="btn ghost sm" onClick={onRemove}>{t("plan.furniture.remove")}</button>
          </div>
        </div>
      )}
      <div className="field">
        <div className="field-top"><span>{t("plan.furniture.presets")}</span></div>
        <div className="chips" role="group" aria-label={t("plan.furniture.presets")}>
          {PRESET_TYPES.map((k) => (
            <button key={k} type="button" className="chip" onClick={() => onAdd(k)}>
              {FURNITURE[k].name[locale]} <span className="mono pl-dim">{f.int(FURNITURE[k].w * 100)}{" × "}{f.int(FURNITURE[k].d * 100)}</span>
            </button>
          ))}
        </div>
      </div>
      <div className="field">
        <div className="field-top"><span>{t("plan.furniture.custom")}</span></div>
        <div className="pl-custom">
          <NumberField label={t("plan.furniture.width")} value={w} onChange={setW} min={lo} max={hi} step={5} />
          <NumberField label={t("plan.furniture.depth")} value={d} onChange={setD} min={lo} max={hi} step={5} />
          <button type="button" className="btn ghost sm" onClick={() => onAdd("custom", { w: w / 100, d: d / 100 })}>{t("plan.furniture.add")}</button>
        </div>
      </div>
      {items.length > 0 && (
        <div className="pl-actions">
          <span className="small" aria-live="polite">{t("plan.furniture.count", { count: items.length })}</span>
          <button type="button" className="btn ghost sm" onClick={onClear}>{t("plan.furniture.clear")}</button>
        </div>
      )}
      <p id="furn-keys" className="note">{t("plan.furniture.keys")}</p>
    </div>
  );
}
