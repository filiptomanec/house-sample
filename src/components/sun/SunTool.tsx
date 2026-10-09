"use client";
// The Sun page: the 3D scene with the sun for the chosen day and time, the controls, the facts about the sun, and the results of
// the ray-cast analysis (hours of direct sun on the terraces and in the rooms, the course of the day, the sun path, the year).
// This component owns the state and applies it to the engine; every number and name comes from the model or the calc modules.
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import Stage, { type StageHandle, type StageLabels } from "@/components/three/Stage";
import { Chips } from "@/components/ui/controls";
import { dayMonth, dayOfYear } from "@/lib/calendar";
import { localToUtc, placeOf, sunPosition, sunTimes, type CalendarDate } from "@/lib/calc/sun";
import { useFormat, useLocale, useT } from "@/lib/i18n/client";
import { derived, house } from "@/lib/model/instance";
import { pageViews } from "@/lib/three/views";
import { MQ } from "@/styles/breakpoints";
import DayChart from "./DayChart";
import SunBars from "./SunBars";
import SunControls from "./SunControls";
import SunFacts from "./SunFacts";
import SunPath from "./SunPath";
import YearTable from "./YearTable";
import {
  PLAY_FRAME_MS, PLAY_FRAME_REDUCED_MS, PLAY_MINUTES_PER_SECOND, SHADING_RANGE, YEAR_TABLE_DAY, clampMinute, habitableRooms, louvreRange, mainRoom, presetDays, primaryArea, sunAreas, timeRange,
  type SunSettings,
} from "./model";
import { createSunStore, defaultSettings } from "./store";
import { useSunAnalysis } from "./useSunAnalysis";
import { useSunEngine } from "./useSunEngine";

// What the model has, known before the scene is built (so nothing changes shape when the movable parts arrive).
const PLACE = placeOf(house);
/** The camera presets of this page (cameras with use "sun"); the Stage opens on `defaultView`. */
const VIEWS = pageViews({ derived }, "sun");
const ROOMS = habitableRooms(derived);
const AREAS = sunAreas(derived);
const PRIMARY = primaryArea(AREAS);
const MAIN_ROOM = mainRoom(derived);
const LOUVRES = louvreRange(derived.screens);
const HAS_BLINDS = derived.openings.some((o) => o.blind);
const HAS_MOVABLE = LOUVRES !== null || HAS_BLINDS;

/** The scene for this page: the house with its roof (the shadows), plants and neighbours, no furniture, no plot outline. */
const BUILD = { furniture: false, furnitureDelayMs: null, labels: false, boundary: false, vegetation: true, roof: true } as const;
/** Hours between two labelled ticks of the sun path in the scene. */
const SUN_PATH_LABEL_EVERY = 3;
/** Labels on: the hour ticks of the sun path. */
const VIEWER = { keyboard: true, labels: true } as const;

export default function SunTool({ year }: { year: number }) {
  const t = useT(), f = useFormat(), locale = useLocale();
  const presets = useMemo(() => presetDays(PLACE, year), [year]);
  const [store] = useState(() => createSunStore(year, defaultSettings(house, presets)));
  const settings = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getServerSnapshot);
  const date: CalendarDate = useMemo(() => ({ year, month: settings.month, day: settings.day }), [year, settings.month, settings.day]);

  // ------------------------------------------------------------------------------------------ the day and the time
  const times = useMemo(() => sunTimes(PLACE, date), [date]);
  const range = useMemo(() => timeRange(times), [times]);
  const [live, setLive] = useState<number | null>(null); // minute while the day is playing
  const playing = live !== null;
  const stored = Math.min(range.max, Math.max(range.min, settings.minute));
  const minute = live ?? stored;

  const [view, setView] = useState<string | null>(null);
  const preset = VIEWS.find((v) => v.id === view) ?? null;
  // the arc is labelled every SUN_PATH_LABEL_EVERY hours: hourly labels crowd where the arc runs towards the camera
  const formatHour = useCallback((hour: number) => (hour % SUN_PATH_LABEL_EVERY === 0 ? f.clock(hour * 60) : ""), [f]);
  const { engine, status, onReady: engineReady, onDispose, onStatus } = useSunEngine({ date, minute, formatHour, visible: !preset?.ortho });
  const onReady = useCallback((handle: StageHandle) => {
    setView(handle.initialView?.id ?? null);
    engineReady(handle);
  }, [engineReady]);
  const sun = useMemo(() => sunPosition(localToUtc(PLACE.tz, date, minute / 60), PLACE), [date, minute]);

  const chooseDate = useCallback((d: CalendarDate) => {
    const r = timeRange(sunTimes(PLACE, d));
    setLive(null);
    store.update({ month: d.month, day: d.day, minute: clampMinute(store.getSnapshot().minute, r) });
  }, [store]);
  const chooseMinute = useCallback((m: number) => { setLive(null); store.update({ minute: m }); }, [store]);
  const shade = useCallback((patch: Partial<SunSettings>) => store.update(patch), [store]);

  // play the day: the clock runs through the slider range; stopping keeps the time reached
  const resume = useRef(0);
  const togglePlay = useCallback(() => {
    if (playing) {
      const at = clampMinute(live ?? stored, range);
      setLive(null);
      store.update({ minute: at });
    } else {
      resume.current = stored >= range.max ? range.min : stored;
      setLive(resume.current);
    }
  }, [playing, live, stored, range, store]);
  useEffect(() => {
    if (!playing) return;
    let raf = 0, last = performance.now(), at = resume.current;
    // the shadow map is redrawn for every new time: at most about 30 a second, which is smooth enough and kind to phones;
    // with reduced motion the day advances in a few distinct steps instead of flowing
    const frame = matchMedia(MQ.reducedMotion).matches ? PLAY_FRAME_REDUCED_MS : PLAY_FRAME_MS;
    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      if (now - last < frame) return;
      at += ((now - last) / 1000) * PLAY_MINUTES_PER_SECOND;
      last = now;
      if (at > range.max) at = range.min;
      setLive(at);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, range.min, range.max]);

  // ------------------------------------------------------------------------------------------ the scene follows the state
  useEffect(() => { engine?.handle.viewer.setSun(sun.azimuth, sun.altitude); }, [engine, sun]);
  useEffect(() => {
    engine?.handle.house.setDayOfYear(dayOfYear(date.month, date.day));
    engine?.handle.viewer.requestRender();
  }, [engine, date]);
  // the louvres only turn; a stored angle below the closed stop of the model is shown and applied as closed
  const slatAngle = LOUVRES ? Math.min(LOUVRES.max, Math.max(LOUVRES.min, settings.slatAngle)) : settings.slatAngle;
  useEffect(() => { engine?.slats?.setAngle(slatAngle); }, [engine, slatAngle]);
  useEffect(() => {
    engine?.blinds?.setDrop(settings.blindDrop / SHADING_RANGE.blindDrop.max);
    engine?.blinds?.setTilt(settings.blindTilt);
  }, [engine, settings.blindDrop, settings.blindTilt]);

  // the sun path follows the day and the clock, can be dragged, and is hidden in the top view (it would cover the plan)
  const path = engine?.path ?? null;
  useEffect(() => { path?.setDay(date); }, [path, date]);
  useEffect(() => { path?.setMinute(minute); }, [path, minute]);
  useEffect(() => { path?.setVisible(!preset?.ortho); }, [path, preset]);
  useEffect(() => path?.onDrag((m) => chooseMinute(clampMinute(m, range))), [path, chooseMinute, range]);

  // the chip of a preset view is lit only until the visitor moves the camera by hand
  const viewer = engine?.handle.viewer ?? null;
  useEffect(() => {
    const controls = viewer?.controls;
    if (!controls) return;
    const moved = () => setView(null);
    controls.addEventListener("start", moved);
    return () => controls.removeEventListener("start", moved);
  }, [viewer]);

  const shadingKey = `${slatAngle}|${settings.blindDrop}|${settings.blindDrop > 0 ? settings.blindTilt : 0}`;
  const analysis = useSunAnalysis(engine, date, shadingKey);

  // ------------------------------------------------------------------------------------------ texts
  const labels: StageLabels = useMemo(() => ({
    loading: t("sun.stage.loading"),
    progress: (percent) => t("sun.stage.progress", { percent: f.percent(percent) }),
    error: t("sun.stage.error"), retry: t("sun.stage.retry"), lost: t("sun.stage.lost"), restore: t("sun.stage.restore"),
    unsupported: t("sun.stage.unsupported"), canvas: t("sun.stage.canvas"),
    compass: (heading) => t("sun.stage.compass", { heading: f.degrees(heading) }),
    north: t("sun.stage.north"),
  }), [t, f]);

  const R = SHADING_RANGE;
  const shadingText = useMemo(() => {
    const parts: string[] = [];
    if (LOUVRES) {
      const a = slatAngle;
      parts.push(t("common.shading.summaryLouvres", { value: a <= LOUVRES.min ? t("common.shading.closed") : a >= LOUVRES.max ? t("common.shading.open") : f.degrees(a) }));
    }
    if (HAS_BLINDS) {
      const d = settings.blindDrop, tilt = settings.blindTilt;
      parts.push(d === 0 ? t("common.shading.summaryBlindsUp") : t("common.shading.summaryBlinds", {
        drop: t("common.shading.downTo", { value: f.percent(d) }),
        tilt: tilt === R.blindTilt.min ? t("common.shading.level") : tilt === R.blindTilt.max ? t("common.shading.shut") : f.degrees(tilt),
      }));
    }
    return parts.length ? t("sun.results.shadingNow", { summary: f.list(parts) }) : "";
  }, [t, f, R, slatAngle, settings.blindDrop, settings.blindTilt]);

  const dayLengths = useMemo(
    () => Array.from({ length: 12 }, (_, month) => sunTimes(PLACE, { year, month, day: YEAR_TABLE_DAY }).dayLength),
    [year],
  );
  const dateText = dayMonth(locale, date.month, date.day);

  return (
    <div className="shell sun-tool">
      <div className="sun-layout">
        <div className="sun-main">
          <div className="sun-stage">
            <Stage
              labels={labels} page="sun" build={BUILD} viewer={VIEWER}
              onReady={onReady} onDispose={onDispose} onStatus={onStatus}
            >
              <p className="sun-hud num" aria-hidden="true">
                <span>{dateText}, {f.clock(minute)}</span>
                <span>{t("sun.hud.altitude", { value: f.degrees(sun.altitude, 0) })}</span>
                <span>{t("sun.hud.azimuth", { value: f.degrees(sun.azimuth, 0) })}</span>
              </p>
            </Stage>
          </div>
          <Chips<string>
            ariaLabel={t("sun.views.label")}
            options={VIEWS.map((v) => ({ value: v.id, label: v.name[locale] }))}
            selected={view ? [view] : []}
            onToggle={(id) => {
              const v = VIEWS.find((x) => x.id === id);
              if (!v) return;
              setView(id);
              viewer?.fit(v, undefined, { animate: true }).catch(() => {}); // a newer view cancels the transition
            }}
          />
        </div>
        <aside className="panel panel-pad sun-side">
          <SunControls
            presets={presets} date={date} onDate={chooseDate} range={range} minute={minute} onMinute={chooseMinute}
            playing={playing} onPlay={togglePlay} settings={settings} onShading={shade}
            louvres={LOUVRES} hasBlinds={HAS_BLINDS}
          />
          <SunFacts sun={sun} times={times} />
        </aside>
      </div>

      <section className="section-sm sun-results">
        <div className="sun-grid">
          <SunBars
            result={analysis.day} pending={analysis.pending} failed={analysis.failed} unavailable={status === "unsupported"}
            areas={AREAS} primary={PRIMARY} rooms={ROOMS} hasMovable={HAS_MOVABLE} dateText={dateText} shadingText={shadingText}
          />
          <div className="panel panel-pad">
            <h2 className="h3">{t("sun.path.title")}</h2>
            <SunPath place={PLACE} date={date} presets={presets} marker={sun} derived={derived} bearingDeg={house.location.houseAxisBearingDeg} />
          </div>
        </div>
        {analysis.day && (
          <div className="panel panel-pad sun-day-panel" data-pending={analysis.pending || undefined}>
            <h2 className="h3">{t("sun.day.title")}</h2>
            <DayChart
              result={analysis.day} areaId={PRIMARY?.id ?? null} roomId={MAIN_ROOM?.id ?? null}
              areaName={PRIMARY?.label[locale] ?? ""} roomName={ROOMS.find((r) => r.id === MAIN_ROOM?.id)?.label[locale] ?? MAIN_ROOM?.name[locale] ?? ""}
              showOpen={HAS_MOVABLE} minute={minute}
            />
          </div>
        )}
        <YearTable
          year={analysis.year} dayLengths={dayLengths} primary={PRIMARY} rooms={ROOMS} hasMovable={HAS_MOVABLE} pending={analysis.pending}
          shadingText={shadingText}
        />
      </section>
    </div>
  );
}
