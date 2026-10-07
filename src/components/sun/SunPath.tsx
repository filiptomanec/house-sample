"use client";
// The sun path diagram: the sky seen from above (north up, the horizon is the outer circle, the zenith the centre) with the
// path of the chosen day, the solstices and the equinox, the hour marks, the sun now, and the plan of the house and its
// terraces turned to their true orientation. The plan is symbolic (it is scaled to the middle of the diagram).
import { memo, useMemo } from "react";
import { useFormat, useT } from "@/lib/i18n/client";
import { COMPASS_POINTS, skyPoint, sunDay, type CalendarDate, type GeoPlace, type SunSample } from "@/lib/calc/sun";
import type { Derived } from "@/lib/model/types";
import type { DayPreset, PresetKey } from "./model";

const SIZE = 360;
const CENTER = SIZE / 2;
const RADIUS = SIZE / 2 - 36;
/** The plan fills this share of the horizon radius (its diagonal). */
const PLAN_SHARE = 0.5;
/** Altitude circles drawn inside the horizon. */
const RINGS = [30, 60] as const;
/** The compass letters sit this far below the horizon (degrees of altitude), i.e. outside the circle. */
const LETTER_ALTITUDE = -14;

type Marker = { azimuth: number; altitude: number };

/**
 * Coordinates are rounded to a tenth of a unit: sin and cos differ in the last digit between Node and the browser, and a
 * server-rendered attribute must be the very string the client computes (hydration).
 */
const r1 = (v: number) => Math.round(v * 10) / 10;
/** The point of the sky diagram in SVG coordinates. */
const at = (azimuth: number, altitude: number) => {
  const p = skyPoint(azimuth, altitude, RADIUS);
  return { x: r1(CENTER + p.x), y: r1(CENTER + p.y) };
};

const path = (arc: readonly SunSample[]) => {
  let d = "", pen = false;
  let last: SunSample | null = null;
  for (const s of arc) {
    // a gap in the samples (the sun went below the horizon and came back, polar edge) starts a new stroke
    if (last && s.ms - last.ms > 3 * 600_000) pen = false;
    const p = at(s.azimuth, Math.max(0, s.altitude));
    d += `${pen ? "L" : "M"}${p.x.toFixed(1)} ${p.y.toFixed(1)}`;
    pen = true;
    last = s;
  }
  return d;
};

function SunPathView({ place, date, presets, marker, derived, bearingDeg }: {
  place: GeoPlace; date: CalendarDate; presets: readonly DayPreset[]; marker: Marker; derived: Pick<Derived, "outline" | "outdoor" | "bbox">; bearingDeg: number;
}) {
  const t = useT(), f = useFormat();
  const chosen = useMemo(() => sunDay(place, date), [place, date]);
  const refs = useMemo(() => ([["summer", "summer", "sun-arc-summer"], ["spring", "equinox", "sun-arc-equinox"], ["winter", "winter", "sun-arc-winter"]] as const).flatMap(([k, name, cls]: readonly [PresetKey, "summer" | "equinox" | "winter", string]) => {
    const p = presets.find((x) => x.key === k);
    return p ? [{ id: k, cls, label: t(`sun.path.${name}`), d: path(sunDay(place, p.date).arc) }] : [];
  }), [place, presets, t]);

  // the plan of the house, from the footprint and the terraces, turned from the house frame into true directions
  const plan = useMemo(() => {
    const b = derived.bbox, b0 = (bearingDeg * Math.PI) / 180;
    const cx = (b.x0 + b.x1) / 2, cy = (b.y0 + b.y1) / 2;
    const k = (PLAN_SHARE * RADIUS) / Math.max(1e-9, Math.hypot(b.w, b.d));
    const to = ([x, y]: readonly [number, number]) => {
      const dx = x - cx, dy = y - cy;
      const east = dx * Math.cos(b0) + dy * Math.sin(b0), north = -dx * Math.sin(b0) + dy * Math.cos(b0);
      return `${r1(CENTER + k * east).toFixed(1)},${r1(CENTER - k * north).toFixed(1)}`;
    };
    const rect = ([x0, y0, x1, y1]: readonly number[]) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]] as const;
    return {
      house: derived.outline.polygons.map((p) => p.pts.map(to).join(" ")),
      outdoor: derived.outdoor.filter((a) => a.type === "terrace" || a.covered).map((a) => rect(a.rect).map(to).join(" ")),
    };
  }, [derived, bearingDeg]);

  const dot = marker.altitude > -1 ? at(marker.azimuth, Math.max(0, marker.altitude)) : null;
  return (
    <figure className="sun-path">
      <svg viewBox={`0 0 ${SIZE} ${SIZE}`} role="img" aria-label={t("sun.path.aria")}>
        <circle className="sun-sky" cx={CENTER} cy={CENTER} r={RADIUS} />
        {RINGS.map((alt) => <circle key={alt} className="sun-ring" cx={CENTER} cy={CENTER} r={(RADIUS * (90 - alt)) / 90} />)}
        {RINGS.map((alt) => <text key={alt} className="sun-ring-label" x={CENTER + 4} y={CENTER - (RADIUS * (90 - alt)) / 90 - 4}>{f.degrees(alt)}</text>)}
        {COMPASS_POINTS.map((p, i) => {
          const end = at(i * 45, 0);
          return <line key={p} className="sun-spoke" x1={CENTER} y1={CENTER} x2={end.x} y2={end.y} />;
        })}
        {(["N", "E", "S", "W"] as const).map((p, i) => {
          const letter = at(i * 90, LETTER_ALTITUDE);
          return <text key={p} className="sun-compass" x={letter.x} y={r1(letter.y + 5)} textAnchor="middle">{t(`sun.compass.short.${p}`)}</text>;
        })}
        {plan.house.map((pts, i) => <polygon key={`h${i}`} className="sun-plan-house" points={pts} />)}
        {plan.outdoor.map((pts, i) => <polygon key={`o${i}`} className="sun-plan-outdoor" points={pts} />)}
        {refs.map((r) => <path key={r.id} className={`sun-arc ${r.cls}`} d={r.d} />)}
        <path className="sun-arc sun-arc-chosen" d={path(chosen.arc)} />
        {chosen.hourMarks.map((h) => {
          const { x, y } = at(h.azimuth, Math.max(0, h.altitude));
          return (
            <g key={h.ms}>
              <circle className="sun-hour" cx={x} cy={y} r={2.4} />
              {Math.round(h.localHours) % 2 === 0 && <text className="sun-hour-label" x={x} y={y - 7} textAnchor="middle">{Math.round(h.localHours)}</text>}
            </g>
          );
        })}
        {dot && <circle className="sun-disc" cx={dot.x} cy={dot.y} r={9} />}
      </svg>
      <figcaption className="legend">
        <span><i className="sun-key sun-key-chosen" aria-hidden="true" />{t("sun.path.selected")}</span>
        {refs.map((r) => <span key={r.id}><i className={`sun-key ${r.cls}`} aria-hidden="true" />{r.label}</span>)}
        <span><i className="sun-key sun-key-plan" aria-hidden="true" />{t("sun.path.house")}</span>
      </figcaption>
    </figure>
  );
}

export const SunPath = memo(SunPathView);
export default SunPath;
