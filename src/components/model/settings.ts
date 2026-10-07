// What the visitor can set on the 3D page, its defaults and how stored values are validated. Pure: no React, no three.js.
// The values live in the browser only (STORAGE_KEYS.model, STORAGE_KEYS.look); nothing here describes the house.
import { defaultLook, type LookGroup, type LookOption, type LookSelection, type StyleModel } from "@/lib/three/style";

/** Times of the summer-solstice day offered as presets. */
export const DAY_PRESETS = ["morning", "noon", "afternoon", "evening"] as const;
export type DayPreset = (typeof DAY_PRESETS)[number];

/** How far from solar noon the morning and afternoon presets lie (hours), and how long before sunset the evening one (hours). */
export const DAY_OFFSETS = { aroundNoonH: 4, beforeSunsetH: 1 } as const;

/** Height of the section that turns the model into a floor plan in 3D (room numbers switch it on), metres. */
export const PLAN_CUT_M = 1.2;
/** The section slider: lowest cut, and the end of the track that means "no cut" (metres above the floor). */
export const CUT_RANGE = { min: 0.4, step: 0.1 } as const;

/** The end of the section slider: the first step at or above the ridge, where a cut is no cut any more (`normalizeCut`). */
export function cutMaxFor(ridgeHeight: number): number {
  return Math.round(Math.ceil(ridgeHeight / CUT_RANGE.step - 1e-9) * CUT_RANGE.step * 100) / 100;
}

/** Switches and choices that are remembered per browser. */
export interface ModelSettings {
  roof: boolean;
  furniture: boolean;
  blinds: boolean;
  pv: boolean;
  green: boolean;
  boundary: boolean;
  day: DayPreset;
  /** Dragging pans instead of rotating. */
  pan: boolean;
}

export const DEFAULT_SETTINGS: ModelSettings = {
  roof: true, furniture: true, blinds: true, pv: true, green: true, boundary: true, day: "afternoon", pan: false,
};

const bool = (v: unknown, fallback: boolean): boolean => (typeof v === "boolean" ? v : fallback);

/** Complete valid settings from untrusted stored data; anything unknown or of the wrong type falls back to the default. */
export function parseSettings(data: unknown): ModelSettings {
  const d = typeof data === "object" && data !== null ? (data as Record<string, unknown>) : {};
  const day = DAY_PRESETS.find((p) => p === d.day) ?? DEFAULT_SETTINGS.day;
  return {
    roof: bool(d.roof, DEFAULT_SETTINGS.roof), furniture: bool(d.furniture, DEFAULT_SETTINGS.furniture), blinds: bool(d.blinds, DEFAULT_SETTINGS.blinds),
    pv: bool(d.pv, DEFAULT_SETTINGS.pv), green: bool(d.green, DEFAULT_SETTINGS.green), boundary: bool(d.boundary, DEFAULT_SETTINGS.boundary),
    day, pan: bool(d.pan, DEFAULT_SETTINGS.pan),
  };
}

/**
 * The stored look as a complete selection: every group of the style present, unknown groups dropped, unknown option ids
 * replaced by the group's default (a stale value must never reach the engine).
 */
export function parseLook(data: unknown, style: StyleModel): LookSelection {
  const base = defaultLook(style);
  if (typeof data !== "object" || data === null) return base;
  const d = data as Record<string, unknown>;
  return Object.fromEntries(Object.entries(style.looks).map(([group, g]) => [group, g.options.find((o) => o.id === d[group])?.id ?? base[group]]));
}

/**
 * A CSS colour that shows what an option looks like: the first colour it sets; for an option that draws a role with
 * another role's material, that material's colour; else null (shown as an outlined dot). Colours come from `model/style.json`.
 */
export function lookSwatch(option: LookOption, style: StyleModel): string | null {
  for (const patch of Object.values(option.set ?? {})) if (patch.color) return patch.color;
  for (const role of Object.values(option.substitute ?? {})) {
    const m = style.materials[role];
    if (m) return m.color;
  }
  return null;
}

/** Groups of the look in the order of the style file. */
export const lookGroups = (style: StyleModel): [string, LookGroup][] => Object.entries(style.looks);

// ------------------------------------------------------------------------------------------------ the day

/** Clock times that the summer-solstice presets stand for, from the day's sunrise, solar noon and sunset (decimal hours). */
export function presetHours(times: { sunrise: number | null; solarNoon: number; sunset: number | null }, preset: DayPreset): number {
  const { sunrise, solarNoon, sunset } = times;
  const lo = sunrise ?? solarNoon - 12, hi = sunset ?? solarNoon + 12;
  switch (preset) {
    case "morning": return Math.max(lo + 0.5, solarNoon - DAY_OFFSETS.aroundNoonH);
    case "noon": return solarNoon;
    case "afternoon": return Math.min(hi - 1.5, solarNoon + DAY_OFFSETS.aroundNoonH);
    case "evening": return Math.max(solarNoon, hi - DAY_OFFSETS.beforeSunsetH);
  }
}
