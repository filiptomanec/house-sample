"use client";
// "One day": a pinned full-screen sequence of the house from morning to dusk. The scroll position drives the frame, the clock,
// the sun on a small arc and four captions whose windows follow the sun times of the place (computed on the server, dayStory.ts).

import { Fragment, useMemo, type CSSProperties } from "react";
import type { FrameSet } from "@/lib/data/media";
import { useFormat, useT } from "@/lib/i18n/client";
import { arcGeometry, sunAtFrame, type SunSpot } from "./sunArc";
import ScrollFrames from "./ScrollFrames";
import { introFade, minuteAtFrame, windowOpacity, type MomentKey } from "./timeline";

/** Height of the pinned section in svh: 100 for the frame plus the scrolling distance. */
const DAY_HEIGHT = 420;

export interface DayMoment { key: MomentKey; from: number; to: number; title: string; text: string }

export interface DayHeroProps {
  frames: FrameSet;
  stillIndex: number;
  /** The house name, shown as the page's h1. */
  title: string;
  /** Local time of every frame (minutes) and the sun at every frame. */
  minutes: number[];
  sun: SunSpot[];
  /** The whole path of the sun that day. */
  path: SunSpot[];
  moments: DayMoment[];
  /** The date of the sequence, formatted for the language. */
  dateLabel: string;
}

export default function DayHero({ frames, stillIndex, title, minutes, sun, path, moments, dateLabel }: DayHeroProps) {
  const t = useT();
  const f = useFormat();
  const words = title.split(" ");
  return (
    <ScrollFrames frames={frames} stillIndex={stillIndex} height={DAY_HEIGHT} className="day-hero night" navTone="clear" priority alt={t("home.hero.alt")}>
      {({ progress, frame }) => {
        const minute = minuteAtFrame(minutes, frame);
        const spot = sunAtFrame(sun, frame);
        const fade = introFade(progress, false);
        const vars = { "--in-slow": fade.slow, "--in-fast": fade.fast, "--after": fade.after } as CSSProperties;
        return (
          <>
            <div className="day-intro shell" style={vars}>
              <p className="label day-kicker">{t("home.hero.kicker")}</p>
              <h1 className="display day-title">
                {/* one readable name for assistive technology; the words below only animate */}
                <span className="sr-only">{title}</span>
                <span aria-hidden>
                  {words.map((w, i) => (
                    <Fragment key={`${w}-${i}`}>{i > 0 ? " " : null}<span className="w" style={{ "--i": i } as CSSProperties}>{w}</span></Fragment>
                  ))}
                </span>
              </h1>
              <p className="day-sub">{t("home.lede")}</p>
              <p className="day-hint">{t("home.hero.hint")} <i aria-hidden>↓</i></p>
            </div>
            {moments.map((m) => (
              <div key={m.key} className="day-moment shell" style={{ ...vars, "--o": windowOpacity(minute, m) } as CSSProperties}>
                <h2 className="h2">{m.title}</h2>
                <p className="lede">{m.text}</p>
              </div>
            ))}
            <div className="day-hud shell">
              <div className="day-clock"><span className="mono">{dateLabel}</span><b className="mono">{f.clock(minute)}</b></div>
              <SunArc path={path} spot={spot} />
            </div>
          </>
        );
      }}
    </ScrollFrames>
  );
}

/** Drawing box of the arc (SVG user units); the labels are HTML so they keep a readable size on any width. */
const ARC_BOX = { width: 200, height: 70, padX: 8, padTop: 6, padBottom: 8 } as const;

/** The path of the sun that day with a dot at the current position. */
function SunArc({ path, spot }: { path: SunSpot[]; spot: SunSpot }) {
  const t = useT();
  const f = useFormat();
  const geo = useMemo(() => arcGeometry(path, ARC_BOX), [path]);
  const [x, y] = geo.project(spot.az, Math.max(-6, spot.alt));
  const compass: Record<number, "E" | "S" | "W"> = { 90: "E", 180: "S", 270: "W" };
  return (
    <div className="day-arc" role="img" aria-label={t("home.day.hud.sun", { altitude: f.degrees(spot.alt), azimuth: f.degrees(spot.az) })}>
      <span className="day-arc-read mono" aria-hidden>{t("home.day.hud.readout", { altitude: f.degrees(spot.alt), azimuth: f.degrees(spot.az) })}</span>
      <svg viewBox={`0 0 ${ARC_BOX.width} ${ARC_BOX.height}`} aria-hidden>
        <path className="day-arc-path" d={geo.d} />
        <line className="day-arc-horizon" x1={2} x2={ARC_BOX.width - 2} y1={geo.horizon} y2={geo.horizon} />
        <circle className="day-arc-sun" data-up={spot.alt > 0} cx={x} cy={y} r={5} />
      </svg>
      <span className="day-arc-axis mono" aria-hidden>
        {geo.cardinals.map((c) => <span key={c.az} style={{ left: `${(c.x / ARC_BOX.width) * 100}%` }}>{t(`home.day.hud.compass.${compass[c.az]}`)}</span>)}
      </span>
    </div>
  );
}
