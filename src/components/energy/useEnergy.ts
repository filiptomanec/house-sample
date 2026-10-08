"use client";

// State of the Energy page: the visitor's inputs (restored from the browser after mount, saved on every change), the month
// shown in the day chart, and the calculation. Server markup and the first client render use the defaults, so they agree.

import { useCallback, useDeferredValue, useEffect, useMemo, useState } from "react";
import { computeEnergy, defaultEnergyContext, defaultInputs, sanitizeInputs, type EnergyInputs, type EnergyResult, type NumericInputKey } from "@/lib/calc/energy";
import { derivedFingerprint, finiteIn, readStored, writeStored } from "@/lib/calc/storageKeys";

const ctx = defaultEnergyContext();
const fingerprint = derivedFingerprint(ctx.derived);

/** The month with the highest production of the default layout: a deterministic starting point for the day chart. */
function initialMonth(): number {
  const r = computeEnergy(defaultInputs(ctx), ctx);
  return r.months.reduce((best, m, i) => (m.pvKwh > r.months[best].pvKwh ? i : best), 0);
}
const START_MONTH = initialMonth();

interface Saved {
  inputs: EnergyInputs;
  month: number;
}

/** Total parser of what the browser holds: anything unusable gives null, anything usable becomes complete valid values. */
function parseSaved(data: unknown): Saved | null {
  if (typeof data !== "object" || data === null) return null;
  const d = data as { inputs?: unknown; month?: unknown };
  return { inputs: sanitizeInputs(d.inputs, ctx), month: Math.round(finiteIn(d.month, 0, 11, START_MONTH)) };
}

/** The switches of the inputs: EV charging in daylight, heat recovery, hot water at midday, the pool in its season. */
export type FlagKey = "evChargeDaytime" | "heatRecovery" | "dhwDaytime" | "pool";

export interface EnergyState {
  ctx: typeof ctx;
  inputs: EnergyInputs;
  result: EnergyResult;
  month: number;
  setMonth: (m: number) => void;
  setNumber: (key: NumericInputKey, value: number) => void;
  setFlag: (key: FlagKey, value: boolean) => void;
  setPanelCount: (count: number) => void;
  setBattery: (id: string) => void;
  togglePlane: (key: string) => void;
  reset: () => void;
}

export function useEnergy(): EnergyState {
  const [inputs, setInputs] = useState<EnergyInputs>(() => defaultInputs(ctx));
  const [month, setMonth] = useState(START_MONTH);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const saved = readStored("energy", { parse: parseSaved, fingerprint });
    /* eslint-disable react-hooks/set-state-in-effect -- the saved choice lives in localStorage, which exists only in the browser (not during SSR) */
    if (saved) {
      setInputs(saved.inputs);
      setMonth(saved.month);
    }
    setLoaded(true);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, []);

  useEffect(() => {
    // `pv` is the part that Model, Home and Budget read through readStoredPv()
    if (loaded) writeStored("energy", { inputs, pv: inputs.pv, month }, { fingerprint });
  }, [inputs, month, loaded]);

  const deferred = useDeferredValue(inputs);
  const result = useMemo(() => computeEnergy(deferred, ctx), [deferred]);

  const setNumber = useCallback((key: NumericInputKey, value: number) => setInputs((o) => ({ ...o, [key]: value })), []);
  const setFlag = useCallback((key: FlagKey, value: boolean) => setInputs((o) => ({ ...o, [key]: value })), []);
  const setPanelCount = useCallback((count: number) => setInputs((o) => ({ ...o, pv: { ...o.pv, panelCount: count } })), []);
  const setBattery = useCallback((id: string) => setInputs((o) => ({ ...o, pv: { ...o.pv, batteryId: id } })), []);
  const togglePlane = useCallback(
    (key: string) =>
      setInputs((o) => {
        const on = o.pv.enabledPlanes.includes(key);
        return { ...o, pv: { ...o.pv, enabledPlanes: on ? o.pv.enabledPlanes.filter((k) => k !== key) : [...o.pv.enabledPlanes, key] } };
      }),
    [],
  );
  const reset = useCallback(() => setInputs(defaultInputs(ctx)), []);

  return { ctx, inputs, result, month, setMonth, setNumber, setFlag, setPanelCount, setBattery, togglePlane, reset };
}
