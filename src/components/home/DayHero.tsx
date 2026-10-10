"use client";
// "One day": a pinned full-screen sequence of the house from morning to dusk. The frame ON THE CANVAS drives the clock, the sun on
// its arc and four captions whose windows follow the sun times of the place (computed on the server, dayStory.ts), so nothing runs
// ahead of the picture while frames arrive. The intro carries the stacked house name ("Dům / pod ořechem", the second line in the
// accent voice), the tagline of the model, the one fiction note and the way into the 3D tour; the last caption hands over to the
// Sun page. A caption fades over a fixed scroll distance (momentOpacity) and only once the title has gone (introFade), and the last
// tenth of the scroll rests on the last frame, so the final caption and its link can be read. With reduced motion (or Save-Data)
// the still frame stands under the intro and the captions are listed below it.

import { useMemo, type CSSProperties } from "react";
import IntentLink from "@/components/ui/IntentLink";
import type { FrameSet } from "@/lib/data/media";
import { useFormat, useT } from "@/lib/i18n/client";
import { arcGeometry, sunAtFrame, type SunSpot } from "./sunArc";
import type { ArcEnd } from "./content";
import ScrollFrames, { type FrameSetX } from "./ScrollFrames";
import { introFade, minuteAtFrame, momentOpacity, type MomentKey } from "./timeline";

/** Height of the pinned section in svh: 100 for the frame plus the scrolling distance. */
const DAY_HEIGHT = 440;
/** The last tenth of the scroll rests on the lit house: the last caption and its link stay readable before the section leaves. */
const END_HOLD = 0.1;

export interface DayMoment { key: MomentKey; from: number; to: number; title: string; text: string }

export interface DayLink { href: string; label: string; heavy?: boolean }

export interface DayHeroProps {
  frames: FrameSet | FrameSetX;
  stillIndex: number;
  /** The two lines of the house name, the page's h1 (title.ts splitTitle). */
  titleLines: [string, string];
  /** Kicker, lede (house.tagline) and the one fiction note of the intro. */
  kicker: string;
  lede: string;
  note: string;
  /** The way into the 3D tour, and the hint to scroll. */
  cta: DayLink;
  hint: string;
  /** Local time of every frame (minutes) and the sun at every frame. */
  minutes: number[];
  sun: SunSpot[];
  /** The whole path of the sun that day, and the labels of its two ends (sunrise, sunset: time and compass point). */
  path: SunSpot[];
  ends: { sunrise: ArcEnd | null; sunset: ArcEnd | null };
  moments: DayMoment[];
  /** The date of the sequence, formatted for the language. */
  dateLabel: string;
  /** The hand-over at the end of the day: the Sun page with this date. */
  dayCta: DayLink;
}

export default function DayHero(props: DayHeroProps) {
  const { frames, stillIndex, titleLines, kicker, lede, note, cta, hint, minutes, sun, path, ends, moments, dateLabel, dayCta } = props;
  const t = useT();
  const f = useFormat();
  const [first, rest] = titleLines;
  // The text does not change while scrolling: these elements are made once per render of DayHero (not per scroll frame), so
  // React skips them when the frame state re-renders the overlay and only the styles, the clock and the arc are updated.
  const introBody = (
    <>
      <p className="kicker day-kicker"><span className="label">{kicker}</span></p>
      <h1 className="display day-title" data-lines={rest ? 2 : 1}>
        <span className="day-line">{first}</span>
        {rest && <>{" "}<span className="day-line accent">{rest}</span></>}
      </h1>
      <p className="day-sub">{lede}</p>
      <p className="day-note">{note}</p>
      <div className="day-actions">
        <IntentLink className="btn mint day-cta" href={cta.href} heavy={cta.heavy}>{cta.label}</IntentLink>
        <p className="day-hint">{hint} <i aria-hidden>↓</i></p>
      </div>
    </>
  );
  const momentBodies = moments.map((m, i) => (
    <>
      <h2 className="h2">{m.title}</h2>
      <p className="lede">{m.text}</p>
      {i === moments.length - 1 && (
        <IntentLink className="link-arrow day-end" href={dayCta.href} heavy={dayCta.heavy}>{dayCta.label}</IntentLink>
      )}
    </>
  ));
  const loader = <div className="day-load" data-sf-loaded aria-hidden><i /></div>;
  return (
    <ScrollFrames frames={frames} stillIndex={stillIndex} height={DAY_HEIGHT} className="day-hero night" navTone="clear" endHold={END_HOLD} priority retain alt={t("home.hero.alt")}>
      {({ progress, drawn, waiting, still }) => {
        const minute = minuteAtFrame(minutes, drawn);
        const spot = sunAtFrame(sun, drawn);
        const fade = introFade(progress, still);
        const vars = { "--in-slow": fade.slow, "--in-fast": fade.fast, "--after-slow": fade.afterSlow, "--after-fast": fade.afterFast } as CSSProperties;
        return (
          <>
            <div className="day-intro shell on-media" style={vars}>{introBody}</div>
            <div className="day-moments">
              {moments.map((m, i) => {
                const o = still ? 1 : momentOpacity(drawn, m, minutes);
                return (
                  <div key={m.key} className="day-moment shell on-media" data-on={o > 0} style={{ ...vars, "--o": o } as CSSProperties}>
                    {momentBodies[i]}
                  </div>
                );
              })}
            </div>
            <div className="day-hud shell" data-waiting={waiting}>
              {loader}
              <div className="day-clock">
                <span className="mono">{dateLabel}<span className="day-wait" aria-hidden>{t("home.day.hud.loading")}</span></span>
                <b className="mono">{f.clock(minute)}</b>
              </div>
              <SunArc path={path} spot={spot} ends={ends} />
            </div>
          </>
        );
      }}
    </ScrollFrames>
  );
}

/** The label of an end of the arc: the whole of it, or only the time where the arc is narrow (CSS picks one). */
const ArcLabel = ({ end }: { end: ArcEnd }) => <><span className="arc-full">{end.full}</span><span className="arc-time">{end.time}</span></>;

/** Drawing box of the arc (SVG user units); the labels are HTML so they keep a readable size on any width. */
const ARC_BOX = { width: 240, height: 76, padX: 8, padTop: 8, padBottom: 8 } as const;
const pct = (v: number) => `${(v / ARC_BOX.width) * 100}%`;

/** The path of the sun that day: the part it has travelled in mint, the sun as a white disc, sunrise and sunset labelled. */
function SunArc({ path, spot, ends }: { path: SunSpot[]; spot: SunSpot; ends: DayHeroProps["ends"] }) {
  const t = useT();
  const f = useFormat();
  const geo = useMemo(() => arcGeometry(path, ARC_BOX), [path]);
  const [x, y] = geo.project(spot.az, Math.max(-6, spot.alt));
  const done = geo.travelled(spot);
  const axis = useMemo(() => {
    const south = geo.cardinals.find((c) => c.az === 180);
    return (
      <span className="day-arc-axis mono" aria-hidden>
        {ends.sunrise && <span className="day-arc-end" style={{ left: pct(geo.ends.start) }}><ArcLabel end={ends.sunrise} /></span>}
        {south && <span className="day-arc-mid" style={{ left: pct(south.x) }}>{t("home.day.hud.compass.S")}</span>}
        {ends.sunset && <span className="day-arc-end" style={{ right: `calc(100% - ${pct(geo.ends.end)})` }}><ArcLabel end={ends.sunset} /></span>}
      </span>
    );
  }, [geo, ends, t]);
  return (
    <div className="day-arc" role="img" aria-label={t("home.day.hud.sun", { altitude: f.degrees(spot.alt), azimuth: f.degrees(spot.az) })}>
      <span className="day-arc-read mono" aria-hidden>{t("home.day.hud.readout", { altitude: f.degrees(spot.alt), azimuth: f.degrees(spot.az) })}</span>
      <svg viewBox={`0 0 ${ARC_BOX.width} ${ARC_BOX.height}`} aria-hidden>
        <line className="day-arc-horizon" x1={0} x2={ARC_BOX.width} y1={geo.horizon} y2={geo.horizon} />
        <path className="day-arc-path" d={geo.d} />
        {done && <path className="day-arc-done" d={done} />}
        <circle className="day-arc-glow" data-up={spot.alt > 0} cx={x} cy={y} r={11} />
        <circle className="day-arc-sun" data-up={spot.alt > 0} cx={x} cy={y} r={4.5} />
      </svg>
      {axis}
    </div>
  );
}
