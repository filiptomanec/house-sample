// The live numbers of "Jak dům vznikl" (#o-projektu): one figure per output of the model, counted from the files the site is
// built from (derived geometry, the models manifest, the media manifest, the PVGIS data, the price book). Server only: it imports
// the JSON files. The counting functions take the parsed files, so the unit tests feed them small fakes.

import modelsJson from "../../../public/models/manifest.json";
import pvgisJson from "@/lib/data/pvgis.json";
import type { Media } from "@/lib/data/media";
import pricebookJson from "@model/pricebook.json";

export const ABOUT_STEPS = ["plan", "model", "renders", "sun", "budget"] as const;
export type AboutStep = (typeof ABOUT_STEPS)[number];

/** The shape of the models manifest this module reads (schema models/1). */
export interface ModelsManifestLike { files: Record<string, { triangles?: number } | undefined> }
/** The PVGIS metadata this module reads: the first and the last year of the hourly series. */
export interface PvgisLike { meta: { years: readonly number[] } }
/** The price book this module reads: groups of priced lines. */
export interface PricebookLike { groups: readonly { lines: readonly unknown[] }[] }

/** Triangles of the desktop house and its furniture: the GLB files the 3D tour loads (docs/ARCHITECTURE.md section 3). */
export const MODEL_FILES = ["house.glb", "furniture.glb"] as const;

export function triangleCount(m: ModelsManifestLike): number {
  return MODEL_FILES.reduce((s, f) => s + (m.files[f]?.triangles ?? 0), 0);
}

/**
 * Cycles frames behind the media of the site: the day sequence, the orbit (every frame of the video when there is one, else the
 * scroll frames) and the stills. Portrait frames are not counted (they may be crops of the landscape ones).
 */
export function renderedImageCount(m: Pick<Media, "day" | "orbit" | "stills">): number {
  const orbit = m.orbit.video ? Math.round(m.orbit.video.fps * m.orbit.video.durationS) : m.orbit.frames;
  return m.day.times.length + orbit + m.stills.length;
}

/** Hours of the PVGIS hourly series (from 1 January of the first year to 31 December of the last). */
export function pvgisHours(p: PvgisLike): number {
  const years = p.meta.years;
  if (!years.length) return 0;
  const first = Math.min(...years), last = Math.max(...years);
  return Math.round((Date.UTC(last + 1, 0, 1) - Date.UTC(first, 0, 1)) / 3_600_000);
}

/** Priced lines of the budget. */
export const budgetLineCount = (p: PricebookLike): number => p.groups.reduce((s, g) => s + g.lines.length, 0);

/** The five figures, in the order of ABOUT_STEPS. */
export function aboutFigures(roomCount: number, media: Pick<Media, "day" | "orbit" | "stills">,
  files: { models?: ModelsManifestLike; pvgis?: PvgisLike; pricebook?: PricebookLike } = {}): Record<AboutStep, number> {
  return {
    plan: roomCount,
    model: triangleCount(files.models ?? (modelsJson as ModelsManifestLike)),
    renders: renderedImageCount(media),
    sun: pvgisHours(files.pvgis ?? (pvgisJson as PvgisLike)),
    budget: budgetLineCount(files.pricebook ?? (pricebookJson as unknown as PricebookLike)),
  };
}
