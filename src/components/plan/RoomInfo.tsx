"use client";
import Link from "next/link";
import { Fragment } from "react";
import { useFormat, useLocale, useT } from "@/lib/i18n/client";
import { routePath } from "@/lib/routes";
import type { RoomView } from "@/lib/plan/view";

/** Facts about the selected room, all from the view model (the derived data of the house). */
export function RoomInfo({ room }: { room: RoomView }) {
  const t = useT(), f = useFormat(), locale = useLocale();
  const dash = "–";
  return (
    <div className="stack">
      <div className="pl-info-head">
        <span className="mono accent">{room.number}</span>
        <span className="label">{room.zone}</span>
      </div>
      <h2 className="h3">{room.name}</h2>
      <div className="kv">
        <span>{t("plan.room.area")}</span><span>{f.area(room.area, 2)}</span>
        <span>{t("plan.room.perimeter")}</span><span>{f.length(room.perimeter, 2)}</span>
        <span>{t("plan.room.height")}</span><span>{f.length(room.height, 2)}</span>
        <span>{t("plan.room.volume")}</span><span>{f.volume(room.volume, 1)}</span>
        <span>{t("plan.room.floor")}</span><span className="txt">{room.floorName ?? dash}</span>
        <span>{t("plan.room.heating")}</span><span className="txt">{t(room.heated ? "plan.room.heated" : "plan.room.unheated")}</span>
        <span>{t("plan.room.exteriorWalls")}</span><span>{room.exteriorWallLength > 0 ? f.length(room.exteriorWallLength, 2) : dash}</span>
        <span>{t("plan.room.glazing")}</span>
        <span className="txt">{room.glazing > 0 ? t("plan.room.glazingValue", { area: f.area(room.glazing, 1), share: f.percent(room.glazingRatio * 100) }) : t("plan.room.noWindows")}</span>
        <span>{t("plan.room.doors")}</span><span>{room.doorsFromEntry === null ? dash : f.int(room.doorsFromEntry)}</span>
      </div>
      {room.openings.length > 0 && (
        <div>
          <p className="label pl-sub">{t("plan.room.openings")}</p>
          <div className="kv">
            {room.openings.map((o, i) => (
              <Fragment key={i}>
                <span>{t.dyn(`plan.kinds.${o.kind}`)}<small>{t.dyn(`plan.facing.${o.facing}`)}{o.sill > 0 ? `, ${t("plan.room.sill", { sill: f.unit(o.sill * 1000, "mm") })}` : ""}</small></span>
                <span>{f.num(o.w * 1000)}{" × "}{f.num(o.h * 1000)}{" mm"}</span>
              </Fragment>
            ))}
          </div>
        </div>
      )}
      <Link className="link-arrow small" href={routePath(locale, "sun")}>{t("plan.room.sunLink")}</Link>
    </div>
  );
}
