"use client";
// The 3D model page: the stage with its overlay, the view chips, the side panel and the export section. This component owns
// the state and applies it to the engine; every number and text comes from the model, the calc modules or the dictionary.
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import Stage, { type StageHandle, type StageLabels } from "@/components/three/Stage";
import { Chips } from "@/components/ui/controls";
import { dayMonth } from "@/lib/calendar";
import { useFormat, useLocale, useT } from "@/lib/i18n/client";
import { house, derived } from "@/lib/model/instance";
import { pick } from "@/lib/model/text";
import type { DerivedRoom } from "@/lib/model/types";
import type { HouseScene, WalkController } from "@/lib/three";
import { sceneExtent } from "@/lib/three/context";
import { orbitLimitsFor, webViews, type ResolvedView } from "@/lib/three/views";
import ControlPanel from "./ControlPanel";
import ExportPanel from "./ExportPanel";
import StageTools from "./StageTools";
import { daylightAt } from "./daylight";
import { TOP_VIEW_FOV, limitsForViews, refitLens } from "./limits";
import { PLAN_CUT_M, cutMaxFor, type ModelSettings } from "./settings";
import { lookStore, settingsStore, style } from "./stores";
import type { StoredStore } from "./storedStore";
import { useEngine } from "./useEngine";

/** The camera presets of the model (`house.cameras` with use "web"). */
const VIEWS = webViews(house.cameras).map((v) => (v.ortho ? refitLens(v, TOP_VIEW_FOV) : v));
/** The view that looks straight down (an orthographic camera in the model): used by the room numbers. */
const TOP_VIEW = VIEWS.find((v) => v.ortho) ?? null;
/** The end of the section slider: the first step at or above the ridge, which means "no section". */
const CUT_MAX = cutMaxFor(derived.bbox.z1);
/** Default position of the exterior blinds when they are switched on, percent. */
const BLINDS_ON_DROP = 100;
/** What the model has, known before the scene is built (so the panel does not change shape when the movable parts arrive). */
const HAS_SCREENS = derived.screens.length > 0;
const HAS_BLINDS = derived.openings.some((o) => o.blind);

const useStored = <T,>(store: StoredStore<T>): T => useSyncExternalStore(store.subscribe, store.getSnapshot, store.getServerSnapshot);
const updateSettings = (patch: Partial<ModelSettings>) => settingsStore.set({ ...settingsStore.getSnapshot(), ...patch });

export default function ModelTool() {
  const t = useT(), f = useFormat(), locale = useLocale();
  const settings = useStored(settingsStore), look = useStored(lookStore);

  // what is not remembered: section, room numbers, the chosen view, walking, the positions of the movable parts
  const [cut, setCut] = useState(CUT_MAX);
  const [roomLabels, setRoomLabels] = useState(false);
  const [view, setView] = useState<string | null>(VIEWS[0]?.id ?? null);
  const [walking, setWalking] = useState(false);
  const [blindDrop, setBlindDrop] = useState(BLINDS_ON_DROP);
  // null = as the engine built it (the movable parts start in their own rest position)
  const [blindTilt, setBlindTilt] = useState<number | null>(null);
  const [screenAngle, setScreenAngle] = useState<number | null>(null);
  const [screenSlide, setScreenSlide] = useState<number | null>(null);

  const walkRef = useRef<WalkController | null>(null);
  const stageBox = useRef<HTMLDivElement>(null);
  const onGone = useCallback(() => {
    walkRef.current?.stop();
    walkRef.current = null;
    setWalking(false);
  }, []);
  const { engine, onReady: engineReady, onDispose } = useEngine({ onGone });
  const onReady = useCallback((handle: StageHandle) => {
    setView(VIEWS[0]?.id ?? null);
    // every preset must be within reach of the orbit limits (a no-op unless a view lies further out than the default maximum)
    handle.viewer.setLimits(limitsForViews(orbitLimitsFor(sceneExtent(handle.ctx, "plot")), VIEWS));
    engineReady(handle);
  }, [engineReady]);
  const house3d: HouseScene | null = engine?.handle.house ?? null;
  const viewer = engine?.handle.viewer ?? null;
  const equip = engine?.equip ?? null;

  // ------------------------------------------------------------------------------------------ texts for the engine
  const labels: StageLabels = useMemo(() => ({
    loading: t("model.stage.loading"),
    progress: (percent) => t("model.stage.progress", { percent: f.percent(percent) }),
    error: t("model.stage.error"), retry: t("model.stage.retry"), lost: t("model.stage.lost"), restore: t("model.stage.restore"),
    unsupported: t("model.stage.unsupported"), canvas: t("model.stage.canvas"),
    compass: (heading) => t("model.stage.compass", { heading: Math.round(heading) }),
    north: t("model.stage.north"),
  }), [t, f]);
  const build = useMemo(() => ({
    labels: false,
    formatTag: (room: DerivedRoom) => ({ title: room.id, detail: f.area(room.area, 1) }),
  }), [f]);

  // ------------------------------------------------------------------------------------------ settings -> engine
  const sun = useMemo(() => daylightAt(house, settings.day), [settings.day]);
  useEffect(() => {
    if (!engine) return;
    engine.handle.viewer.setSun(sun.azimuth, sun.altitude);
    engine.handle.house.setDayOfYear(sun.dayOfYear);
  }, [engine, sun]);
  useEffect(() => { house3d?.setLook(look); }, [house3d, look]);
  useEffect(() => { house3d?.setRoof(settings.roof); }, [house3d, settings.roof]);
  useEffect(() => { house3d?.setFurniture(settings.furniture); }, [house3d, settings.furniture]);
  useEffect(() => { house3d?.setVegetation(settings.green); }, [house3d, settings.green]);
  useEffect(() => { house3d?.setBoundary(settings.boundary); }, [house3d, settings.boundary]);
  useEffect(() => { house3d?.setLabels(roomLabels); }, [house3d, roomLabels]);
  useEffect(() => { house3d?.setCut(cut >= CUT_MAX ? null : cut); }, [house3d, cut]);
  useEffect(() => { viewer?.setPanMode(settings.pan); }, [viewer, settings.pan]);
  useEffect(() => {
    const pv = equip?.pv;
    if (!pv) return;
    pv.setVisible(settings.pv);
    pv.setPanelsVisible(settings.roof); // the modules sit on the roof; the battery stays when the roof is hidden
  }, [equip, settings.pv, settings.roof]);
  useEffect(() => { equip?.blinds?.setDrop(settings.blinds ? blindDrop / 100 : 0); }, [equip, settings.blinds, blindDrop]);
  useEffect(() => { if (blindTilt !== null) equip?.blinds?.setTilt(blindTilt); }, [equip, blindTilt]);
  useEffect(() => { if (screenAngle !== null) equip?.screens?.setAngle(screenAngle); }, [equip, screenAngle]);
  useEffect(() => { if (screenSlide !== null) equip?.screens?.setSlide(screenSlide / 100); }, [equip, screenSlide]);

  // the chip of a preset view is lit only until the visitor moves the camera by hand
  useEffect(() => {
    const controls = viewer?.controls;
    if (!controls) return;
    const moved = () => setView(null);
    controls.addEventListener("start", moved);
    return () => controls.removeEventListener("start", moved);
  }, [viewer]);

  // the room furnishings load a moment after the building; one automatic second try after a failure
  const subscribeFurniture = useCallback((onChange: () => void) => house3d?.subscribe((e) => { if (e.type === "furniture") onChange(); }) ?? (() => {}), [house3d]);
  const furnitureState = useSyncExternalStore(subscribeFurniture, () => house3d?.furnitureState ?? "idle", () => "idle");
  const retried = useRef<HouseScene | null>(null);
  useEffect(() => {
    if (furnitureState !== "error" || !house3d || retried.current === house3d) return;
    retried.current = house3d;
    const timer = window.setTimeout(() => { house3d.loadFurniture().catch(() => {}); }, 4000);
    return () => window.clearTimeout(timer);
  }, [furnitureState, house3d]);

  // ------------------------------------------------------------------------------------------ actions
  const goTo = useCallback((v: ResolvedView) => {
    walkRef.current?.stop();
    setView(v.id);
    viewer?.setView(v, { animate: true }).catch(() => {}); // a newer view cancels the transition; that is not an error
  }, [viewer]);

  const toggleWalk = useCallback(async () => {
    if (walkRef.current) { walkRef.current.stop(); return; }
    if (!engine) return;
    const { startWalk } = await import("@/lib/three/walk");
    if (walkRef.current) return; // a second click while the module was loading
    setWalking(true);
    walkRef.current = startWalk(engine.handle.viewer, engine.handle.house, engine.handle.viewer.container, {
      labels: { joystick: t("model.walk.joystick") },
      onExit: () => { walkRef.current = null; setWalking(false); },
    });
  }, [engine, t]);

  // the taller stage of a walk is brought fully into view, so that the joystick and the exit are both on screen
  useEffect(() => {
    const el = stageBox.current;
    if (!walking || !el) return;
    const r = el.getBoundingClientRect(), top = parseFloat(getComputedStyle(document.documentElement).scrollPaddingTop) || 0;
    if (r.top >= top - 1 && r.bottom <= window.innerHeight + 1) return;
    el.scrollIntoView({ block: "start", behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  }, [walking]);

  // room numbers make sense over the rooms: switching them on shows a floor plan in 3D (section, top view)
  const autoCut = useRef(false); // the section at the plan height was set by the room numbers, not by the slider
  const onRoomLabels = (on: boolean) => {
    setRoomLabels(on);
    if (walking) return;
    if (!on) {
      // switching the numbers off also takes back the section they made (a section the visitor moved or set stays)
      if (autoCut.current && cut === PLAN_CUT_M) setCut(CUT_MAX);
      autoCut.current = false;
      return;
    }
    if (cut >= CUT_MAX) { setCut(PLAN_CUT_M); autoCut.current = true; }
    if (TOP_VIEW) goTo(TOP_VIEW);
  };
  const onCut = (v: number) => { autoCut.current = false; setCut(v); };

  // ------------------------------------------------------------------------------------------ texts of the panel
  const pvInfo = equip?.pv?.info ?? null;
  const pvPanels = pvInfo ? t("model.layers.pvPanels", { count: pvInfo.panels }) : "";
  const pvPower = pvInfo ? f.unit(pvInfo.kwp, "kWp", 1, 2) : "";
  const pvHint = !pvInfo ? null
    : pvInfo.batteryKWh > 0 ? t("model.layers.pvHint.battery", { panels: pvPanels, power: pvPower, capacity: f.unit(pvInfo.batteryKWh, "kWh", 0, 1) })
    : t("model.layers.pvHint.noBattery", { panels: pvPanels, power: pvPower });
  const furnitureHint = !settings.furniture ? null : furnitureState === "loading" ? t("model.layers.furnitureLoading") : furnitureState === "error" ? t("model.layers.furnitureError") : null;
  const viewName = VIEWS.find((v) => v.id === view);

  return (
    <div className="shell model-tool">
      <div className="model-layout">
        <div className="model-main">
          <div className="model-stage" ref={stageBox} data-walking={walking || undefined}>
            <Stage
              labels={labels} extent="plot" backdrop="stage" initialView={VIEWS[0]?.id} build={build} viewer={{ labels: true }}
              onReady={onReady} onDispose={onDispose}
            >
              <StageTools
                pan={settings.pan} onPan={(pan) => updateSettings({ pan })} walking={walking} onWalk={toggleWalk} ready={!!engine}
                cutText={cut < CUT_MAX ? t("model.hud.cut", { height: f.length(cut, 1) }) : null}
              />
            </Stage>
          </div>
          <div className="model-views">
            <Chips
              ariaLabel={t("model.views.label")}
              options={VIEWS.map((v) => ({ value: v.id, label: pick(v.name, locale) }))}
              selected={view ? [view] : []}
              onToggle={(id) => { const v = VIEWS.find((x) => x.id === id); if (v) goTo(v); }}
            />
            <p className="sr-only" role="status">{viewName ? t("model.views.current", { name: pick(viewName.name, locale) }) : ""}</p>
            <div className="model-help">
              <p className="note only-fine">{t(settings.pan ? "model.help.mousePan" : "model.help.mouseRotate")} {t("model.help.keys")}</p>
              <p className="note only-coarse">{t(settings.pan ? "model.help.touchPan" : "model.help.touchRotate")}</p>
            </div>
          </div>
        </div>

        <ControlPanel
          settings={settings} onSettings={updateSettings}
          dayDate={dayMonth(locale, sun.date.month, sun.date.day)}
          cut={cut} cutMax={CUT_MAX} onCut={onCut}
          roomLabels={roomLabels} onRoomLabels={onRoomLabels}
          furnitureHint={furnitureHint} pvHint={pvHint}
          screens={HAS_SCREENS ? { a: screenAngle ?? equip?.screens?.angle ?? 0, b: screenSlide ?? Math.round((equip?.screens?.slide ?? 0) * 100), onA: setScreenAngle, onB: setScreenSlide } : null}
          hasBlinds={HAS_BLINDS}
          blinds={{ a: blindDrop, b: blindTilt ?? equip?.blinds?.tilt ?? 0, onA: setBlindDrop, onB: setBlindTilt }}
          style={style} look={look} onLook={(group, id) => lookStore.set({ ...lookStore.getSnapshot(), [group]: id })}
        />
      </div>
      <ExportPanel />
    </div>
  );
}
