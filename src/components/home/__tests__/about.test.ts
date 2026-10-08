// The live numbers of the About section: counted from the files the site is built from, checked on small fakes and on the real files.
import { describe, expect, it } from "vitest";
import { media, type Media } from "@/lib/data/media";
import { derived } from "@/lib/model/instance";
import modelsJson from "../../../../public/models/manifest.json";
import { ABOUT_STEPS, aboutFigures, budgetLineCount, MODEL_FILES, pvgisHours, renderedImageCount, triangleCount, type ModelsManifestLike } from "../aboutFacts";

describe("about figures", () => {
  it("adds the triangles of the house and its furniture, and ignores files without a count", () => {
    expect(triangleCount({ files: { "house.glb": { triangles: 10 }, "furniture.glb": { triangles: 5 }, "house-lite.glb": { triangles: 99 } } })).toBe(15);
    expect(triangleCount({ files: { "house.glb": {} } })).toBe(0);
    const real = modelsJson.files as Record<string, { triangles?: number } | undefined>;
    expect(triangleCount(modelsJson as ModelsManifestLike)).toBe(MODEL_FILES.reduce((s, f) => s + (real[f]?.triangles ?? 0), 0));
  });

  it("counts the rendered frames: the day, every video frame of the orbit (or its scroll frames) and the stills", () => {
    const base = { day: media.day, orbit: media.orbit, stills: media.stills } satisfies Pick<Media, "day" | "orbit" | "stills">;
    const video = media.orbit.video;
    const expected = media.day.times.length + (video ? Math.round(video.fps * video.durationS) : media.orbit.frames) + media.stills.length;
    expect(renderedImageCount(base)).toBe(expected);
    expect(renderedImageCount({ ...base, orbit: { ...media.orbit, video: undefined } })).toBe(media.day.times.length + media.orbit.frames + media.stills.length);
  });

  it("counts the hours of the PVGIS series from the first to the last year, leap days included", () => {
    expect(pvgisHours({ meta: { years: [2023, 2023] } })).toBe(8760);
    expect(pvgisHours({ meta: { years: [2024] } })).toBe(8784);
    expect(pvgisHours({ meta: { years: [2020, 2021] } })).toBe(8784 + 8760);
    expect(pvgisHours({ meta: { years: [] } })).toBe(0);
  });

  it("counts the priced lines of every group", () => {
    expect(budgetLineCount({ groups: [{ lines: [1, 2] }, { lines: [] }, { lines: [3] }] })).toBe(3);
  });

  it("gives a positive whole figure for every step with the project's files", () => {
    const figures = aboutFigures(derived.rooms.length, media);
    expect(Object.keys(figures)).toEqual([...ABOUT_STEPS]);
    for (const k of ABOUT_STEPS) {
      expect(Number.isInteger(figures[k])).toBe(true);
      expect(figures[k]).toBeGreaterThan(0);
    }
    expect(figures.plan).toBe(derived.rooms.length);
  });
});
