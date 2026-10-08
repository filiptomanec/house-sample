"use client";
import Link from "next/link";
import { Fragment } from "react";
import { useFormat, useLocale, useT } from "@/lib/i18n/client";
import { NBSP } from "@/lib/i18n/format";
import { routePath } from "@/lib/routes";
import type { RoomView } from "@/lib/plan/view";

/**
 * Facts about the selected room, all from the view model (the derived data of the house): area, clear height, volume, floor,
 * glazing and the openings to the outside. Heating is shown only for a room that is not heated. `onBack` (phones) returns
 * to the drawing.
 */
export function RoomInfo({ room, onBack }: { room: RoomView; onBack?: () => void }) {
  const t = useT(), f = useFormat(), locale = useLocale();
  return (
    <div className="stack pl-room-info">
      <div className="pl-info-head">
        <span className="mono tint pl-info-no">{room.number}</span>
        <span className="label">{room.zone}</span>
      </div>
      <h2 className="h3 pl-info-name">{room.name}</h2>
      <div className="kv">
        <span>{t("plan.room.area")}</span><span>{f.area(room.area, 2)}</span>
        <span>{t("plan.room.height")}</span><span>{f.length(room.height, 2)}</span>
        <span>{t("plan.room.volume")}</span><span>{f.volume(room.volume, 1)}</span>
        {room.floorName && <><span>{t("plan.room.floor")}</span><span className="txt">{room.floorName}</span></>}
        {!room.heated && <><span>{t("plan.room.heating")}</span><span className="txt">{t("plan.room.unheated")}</span></>}
        <span>{t("plan.room.glazing")}</span>
        <span className="txt">{room.glazing > 0 ? t("plan.room.glazingValue", { area: f.area(room.glazing, 1), share: f.percent(room.glazingRatio * 100) }) : t("plan.room.noWindows")}</span>
      </div>
      {room.openings.length > 0 && (
        <div>
          <p className="label pl-sub">{t("plan.room.openings")}</p>
          <div className="kv pl-openings-kv">
            {room.openings.map((o, i) => (
              <Fragment key={i}>
                <span>{t.dyn(`plan.kinds.${o.kind}`)}<small>{t.dyn(`plan.facing.${o.facing}`)}{o.sill > 0 ? `, ${t("plan.room.sill", { sill: f.unit(o.sill * 1000, "mm") })}` : ""}</small></span>
                <span>{f.num(o.w * 1000)}{`${NBSP}×${NBSP}`}{f.unit(o.h * 1000, "mm")}</span>
              </Fragment>
            ))}
          </div>
        </div>
      )}
      <div className="pl-info-links">
        <Link className="link-arrow small" href={`${routePath(locale, "sun")}?room=${encodeURIComponent(room.id)}`}>{t("plan.room.sunLink")}</Link>
        {onBack && <button type="button" className="btn ghost sm pl-back" onClick={onBack}>{t("plan.info.back")}</button>}
      </div>
    </div>
  );
}
