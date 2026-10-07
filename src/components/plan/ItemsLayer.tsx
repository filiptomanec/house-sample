"use client";
import type { KeyboardEvent } from "react";
import { useFormat, useT } from "@/lib/i18n/client";
import type { PlacedItem } from "@/lib/plan/labels";
import type { MyItem } from "@/lib/plan/myFurniture";
import { Txt } from "./Txt";

/** The visitor's furniture: draggable rectangles with a name. Interactive only in the furniture mode. */
export function ItemsLayer({ items, placed, names, sel, active, onSelect, onKey }: {
  items: readonly MyItem[]; placed: readonly PlacedItem[]; names: readonly string[]; sel: number | null; active: boolean;
  onSelect: (i: number) => void; onKey: (e: KeyboardEvent, i: number) => void;
}) {
  const t = useT(), f = useFormat();
  return (
    <g className="pl-items" data-active={active ? "on" : "off"}>
      {items.map((it, i) => {
        const p = placed[i], lh = p.label.fs * 1.1, y0 = (-((p.label.lines.length - 1) * lh) / 2 + p.label.fs * 0.35) * 100;
        return (
          <g key={i} data-item={i} className="pl-item" data-selected={i === sel ? "true" : undefined}
            tabIndex={active ? 0 : -1} role={active ? "button" : undefined} aria-hidden={active ? undefined : true}
            aria-label={active ? t("plan.furniture.item", { name: names[i], w: f.int(it.w * 100), d: f.int(it.d * 100) }) : undefined}
            aria-describedby={active ? "furn-keys" : undefined} onFocus={() => onSelect(i)} onKeyDown={(e) => onKey(e, i)}>
            <rect x={p.cx - p.w / 2} y={p.cy - p.d / 2} width={p.w} height={p.d} rx={0.04} className="pl-item-rect" />
            <Txt x={p.cx} y={p.cy} fs={p.label.fs} rot={p.label.vertical ? -90 : 0} halo={p.label.over ? 0.24 : 0.16} textAnchor="middle" className="pl-item-text" pointerEvents="none">
              {p.label.lines.map((l, j) => <tspan key={j} x={0} y={y0 + j * lh * 100}>{l}</tspan>)}
            </Txt>
          </g>
        );
      })}
    </g>
  );
}
