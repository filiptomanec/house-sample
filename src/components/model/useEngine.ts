"use client";
// The link between the Stage (which owns the viewer and the house scene) and the page: the handle it hands over, and the
// equipment built on top of it. The handle lives in state, so every effect that applies a setting depends on it and runs
// again after a retry or a restore (the scene is then a new one). Equipment is created once per handle and disposed by
// `onDispose`, which the Stage calls before the viewer goes away.
import { useCallback, useEffect, useRef, useState } from "react";
import type { StageHandle } from "@/components/three/Stage";
import { buildEquipment, type Equipment } from "./equipment";

export interface EngineState {
  handle: StageHandle;
  /** Null until the movable parts are built (a moment after the first frame) and when the model has none. */
  equip: Equipment | null;
}

interface Lifecycle {
  /** Called when a scene is going away, after the equipment was disposed. */
  onGone: (handle: StageHandle) => void;
}

export function useEngine({ onGone }: Lifecycle) {
  const [engine, setEngine] = useState<EngineState | null>(null);
  const current = useRef<{ handle: StageHandle; equip: Equipment | null; gone: boolean } | null>(null);
  // the Stage may keep the callbacks it saw first, so they read the latest `onGone` through a ref
  const goneRef = useRef(onGone);
  useEffect(() => { goneRef.current = onGone; });

  const onReady = useCallback((handle: StageHandle) => {
    const entry = { handle, equip: null as Equipment | null, gone: false };
    current.current = entry;
    setEngine({ handle, equip: null });
    buildEquipment(handle).then(
      (equip) => {
        if (entry.gone) { equip.dispose(); return; }
        entry.equip = equip;
        setEngine((prev) => (prev?.handle === handle ? { handle, equip } : prev));
      },
      (error) => console.warn("3D model: the equipment could not be loaded", error),
    );
  }, []);

  const onDispose = useCallback((handle: StageHandle) => {
    const entry = current.current;
    if (entry?.handle === handle) {
      entry.gone = true;
      entry.equip?.dispose();
      current.current = null;
    }
    goneRef.current(handle);
    setEngine((prev) => (prev?.handle === handle ? null : prev));
  }, []);

  return { engine, onReady, onDispose };
}
