"use client";
// Course of the day: the share of the terrace (as set and without the movable shading) and of the best window of the main
// room that is in direct sun, at every analysed instant, with a cursor at the time chosen on the slider.
import { memo } from "react";
import { useNarrow } from "@/components/ui/useNarrow";
import { useFormat, useT } from "@/lib/i18n/client";
import type { SunDayResult, SunSeries } from "@/lib/three";

interface Props {
  result: SunDayResult;
  /** Series to draw: the key of `outdoors` / `rooms`, null when the model has none. */
  areaId: string | null;
  roomId: string | null;
  areaName: string;
  roomName: string;
  /** Draw the line without the movable shading (only when the model has any). */
  showOpen: boolean;
  /** Time of the cursor, minutes after midnight. */
  minute: number;
}

const GRID = [0, 0.5, 1] as const;

function DayChartView({ result, areaId, roomId, areaName, roomName, showOpen, minute }: Props) {
  const t = useT(), f = useFormat();
  const narrow = useNarrow();
  const W = narrow ? 380 : 720, H = narrow ? 230 : 190, L = narrow ? 52 : 46, B = 26, T = 8, R = 10;
  const size = narrow ? 12.5 : 11;
  const { times } = result;
  const t0 = Math.floor(times[0] ?? 6), t1 = Math.max(t0 + 1, Math.ceil(times[times.length - 1] ?? 18));
  const x = (h: number) => L + ((h - t0) / (t1 - t0)) * (W - L - R);
  const y = (v: number) => T + (H - T - B) * (1 - v);
  const line = (s: SunSeries | undefined) => (s ? s.fraction.map((v, i) => `${i ? "L" : "M"}${x(times[i]).toFixed(1)},${y(v).toFixed(1)}`).join("") : "");
  // about seventy points per line: cheap enough to rebuild when the cursor moves
  const d = {
    area: line(areaId ? result.outdoors[areaId] : undefined),
    open: line(areaId ? result.outdoorsOpen[areaId] : undefined),
    room: line(roomId ? result.rooms[roomId] : undefined),
  };
  if (!times.length) return null;
  const every = narrow ? 3 : 2;
  const hours = Array.from({ length: t1 - t0 + 1 }, (_, i) => t0 + i).filter((h) => h % every === 0);
  const cursor = minute / 60;
  return (
    <figure className="sun-day">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={t("sun.day.aria")}>
        {GRID.map((g) => (
          <g key={g}>
            <line className="sun-rule" x1={L} x2={W - R} y1={y(g)} y2={y(g)} />
            <text className="sun-tick" x={L - 6} y={y(g) + 4} textAnchor="end" fontSize={size}>{f.percent(g * 100)}</text>
          </g>
        ))}
        {hours.map((h) => <text key={h} className="sun-tick" x={x(h)} y={H - 7} textAnchor="middle" fontSize={size}>{h}</text>)}
        {d.room && <path className="sun-line sun-line-room" d={d.room} />}
        {showOpen && d.open && <path className="sun-line sun-line-open" d={d.open} />}
        {d.area && <path className="sun-line sun-line-area" d={d.area} />}
        {cursor >= t0 && cursor <= t1 && <line className="sun-cursor" x1={x(cursor)} x2={x(cursor)} y1={T} y2={H - B} />}
      </svg>
      <figcaption className="legend">
        {areaId && <span><i className="sun-key sun-line-area" aria-hidden="true" />{t("sun.results.withShading", { name: areaName })}</span>}
        {areaId && showOpen && <span><i className="sun-key sun-line-open dashed" aria-hidden="true" />{t("sun.results.withoutShading", { name: areaName })}</span>}
        {roomId && <span><i className="sun-key sun-line-room" aria-hidden="true" />{t("sun.day.room", { name: roomName })}</span>}
      </figcaption>
    </figure>
  );
}

export const DayChart = memo(DayChartView);
export default DayChart;
