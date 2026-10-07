"use client";
// Runs the ray-cast analysis for the chosen day and then for the 21st of every month, in slices that yield to the event loop,
// and starts again (after a short pause) whenever the day or the position of the shading changes. A result stays on screen
// while its successor is being computed (`pending`), so the numbers do not flicker while a slider is dragged.
import { useEffect, useState } from "react";
import type { CalendarDate } from "@/lib/calc/sun";
import type { SunDayResult } from "@/lib/three";
import { ANALYSIS_STEP_MIN, YEAR_TABLE_DAY } from "./model";
import type { SunEngine } from "./engine";

/** Pause after the last change before the work starts: a dragged slider triggers one analysis, not one per pixel. */
const DEBOUNCE_MS = 250;

export interface SunAnalysisState {
  /** The latest result for the chosen day (maybe of an earlier day or position of the shading while `pending`); null before the first. */
  day: SunDayResult | null;
  /** One result per month (index = 0-based month), null while not computed. */
  year: (SunDayResult | null)[];
  /** The work for the current day and shading is not finished. */
  pending: boolean;
  /** It failed for the current day and shading. */
  failed: boolean;
}

const EMPTY_YEAR: (SunDayResult | null)[] = Array.from({ length: 12 }, () => null);

interface Stored {
  engine: SunEngine | null;
  key: string;
  day: SunDayResult | null;
  year: (SunDayResult | null)[];
  finished: boolean;
  failed: boolean;
}

/**
 * `shadingKey` is any string that changes whenever the movable shading does; the effect also depends on the engine, so a new
 * scene (retry, restore) is analysed again.
 */
export function useSunAnalysis(engine: SunEngine | null, date: CalendarDate, shadingKey: string): SunAnalysisState {
  const { year: y, month: m, day: d } = date;
  const key = `${y}-${m}-${d}|${shadingKey}`;
  const [stored, setStored] = useState<Stored>({ engine: null, key: "", day: null, year: EMPTY_YEAR, finished: false, failed: false });

  useEffect(() => {
    if (!engine) return;
    const abort = new AbortController();
    const { signal } = abort;
    const put = (patch: Partial<Stored>) => setStored((s) => ({ ...s, engine, key, ...patch }));
    const timer = setTimeout(async () => {
      try {
        const day = await engine.analyzer.dayAsync({ year: y, month: m, day: d }, ANALYSIS_STEP_MIN, engine.shades(), { signal });
        if (!day) return;
        put({ day, finished: false, failed: false });
        const rows: (SunDayResult | null)[] = [...EMPTY_YEAR];
        for (let month = 0; month < 12; month++) {
          const r = await engine.analyzer.dayAsync({ year: y, month, day: YEAR_TABLE_DAY }, ANALYSIS_STEP_MIN, engine.shades(), { signal });
          if (!r) return;
          rows[month] = r;
          put({ year: [...rows], finished: month === 11 });
        }
      } catch (error) {
        if (signal.aborted) return;
        console.warn("Sun page: the analysis failed", error);
        put({ finished: true, failed: true });
      }
    }, DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      abort.abort();
    };
  }, [engine, y, m, d, key]);

  const current = stored.engine === engine && stored.key === key;
  return { day: stored.day, year: stored.year, pending: !current || !stored.finished, failed: current && stored.failed };
}
