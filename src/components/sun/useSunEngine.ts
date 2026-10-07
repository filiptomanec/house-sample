"use client";
// The link between the Stage (which owns the viewer and the house scene) and the page. The engine lives in state, so every
// effect that applies a setting depends on it and runs again after a retry or a restore (the scene is then a new one).
// `onDispose` is called by the Stage before the viewer goes away: the movable parts are disposed first.
import { useCallback, useRef, useState } from "react";
import type { StageHandle, StageStatus } from "@/components/three/Stage";
import { buildSunEngine, type SunEngine } from "./engine";

export function useSunEngine() {
  const [engine, setEngine] = useState<SunEngine | null>(null);
  const [status, setStatus] = useState<StageStatus>("loading");
  const current = useRef<{ handle: StageHandle; engine: SunEngine | null; gone: boolean } | null>(null);

  const onReady = useCallback((handle: StageHandle) => {
    const entry = { handle, engine: null as SunEngine | null, gone: false };
    current.current = entry;
    buildSunEngine(handle).then(
      (built) => {
        if (entry.gone) { built.dispose(); return; }
        entry.engine = built;
        setEngine(built);
      },
      (error) => console.warn("Sun page: the analysis could not be prepared", error),
    );
  }, []);

  const onDispose = useCallback((handle: StageHandle) => {
    const entry = current.current;
    if (entry?.handle !== handle) return;
    entry.gone = true;
    entry.engine?.dispose();
    current.current = null;
    setEngine((prev) => (prev?.handle === handle ? null : prev));
  }, []);

  return { engine, status, onReady, onDispose, onStatus: setStatus };
}
