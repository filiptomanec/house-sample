// Builds generated/render-inputs.json: everything the Blender render scripts read (terrain grid, plot, vegetation, neighbours,
// PV modules, blinds, screens, lamps, sun and cameras of every shot) from the model and the TypeScript kernel, so that Python
// never computes geometry, terrain or the position of the sun. Format: docs/RENDER-INPUTS.md.
//
//   npx tsx scripts/build-render-inputs.ts                 write generated/render-inputs.json
//   npx tsx scripts/build-render-inputs.ts --check         write nothing; exit 1 when the file is stale
//   npx tsx scripts/build-render-inputs.ts --summary       also print counts, the sun table and the orbit radius
//   options: --out <file>  --furniture-report <file>  --no-furniture-report
//
// Exit codes: 0 ok, 1 stale (--check) or inconsistent inputs, 2 input/IO problem.
import fs from "node:fs";
import path from "node:path";
import { analyzeHouse, hashModelFiles, isHashedModelFile, sha256Hex, type Derived, type House } from "../src/lib/model";
import { createSite, exportSiteDerived } from "../src/lib/model/site";
import { buildBlinds, buildPv, buildScreens } from "./lib/render-equipment";
import { buildLights, type FurnitureReport } from "./lib/render-lights";
import { parseRenderConfig, type RenderConfig } from "./lib/render-schema";
import { buildCompare, buildDay, buildOg, buildOrbit, buildStills, type ShotContext, type SunProvider } from "./lib/render-shots";
import { buildHouseSection, buildNeighbours, buildSite, buildTerrain, buildVegetation, type WorldContext } from "./lib/render-world";
import { dayEvents, solarPosition } from "./lib/solar";

export const SCHEMA = "render-inputs/1";
const CAMERA_NEAR = 0.1;
const CAMERA_FAR = 600;

/** Own NOAA implementation (scripts/lib/solar.ts). */
export const solarProvider: SunProvider = {
  name: "scripts/lib/solar.ts",
  position: (utcMs, lat, lon) => {
    const p = solarPosition(utcMs, lat, lon);
    return { azimuthDeg: p.azimuthDeg, elevationDeg: p.elevationDeg, elevationGeomDeg: p.elevationGeomDeg };
  },
};

/** The web's sun module when it is implemented, else the local NOAA implementation. */
export async function resolveSunProvider(): Promise<SunProvider> {
  try {
    const m = await import("../src/lib/calc/sun");
    const probe = m.sunPosition(Date.UTC(2026, 5, 21, 10, 0), { lat: 49.2, lon: 16.6 });
    if (Number.isFinite(probe.azimuth) && Number.isFinite(probe.altitude)) {
      return {
        name: "src/lib/calc/sun.ts",
        position: (utcMs, lat, lon) => {
          const p = m.sunPosition(utcMs, { lat, lon });
          return { azimuthDeg: p.azimuth, elevationDeg: p.altitude, elevationGeomDeg: p.altitudeGeometric };
        },
      };
    }
  } catch {
    // not implemented yet (the stubs throw) or not present
  }
  return solarProvider;
}

// ------------------------------------------------------------------------------------------------ JSON output

const isNum = (v: unknown): v is number => typeof v === "number";
const fmtNum = (v: number): string => {
  if (!Number.isFinite(v)) throw new Error(`non-finite number in render inputs`);
  return String(Math.round(v * 1e6) / 1e6 + 0);
};
const isPoint = (v: unknown): boolean => Array.isArray(v) && v.length <= 4 && v.every(isNum);

/** Canonical JSON text: stable key order (insertion), numbers rounded to 6 decimals, long number lists wrapped. */
export function stableJson(value: unknown, ind = ""): string {
  if (value === null || value === undefined) return "null";
  if (typeof value === "number") return fmtNum(value);
  if (typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (Array.isArray(value)) {
    if (value.length === 0) return "[]";
    if (value.every(isNum)) {
      const parts = value.map(fmtNum);
      if (parts.length <= 16) return `[${parts.join(", ")}]`;
      const lines: string[] = [];
      for (let i = 0; i < parts.length; i += 24) lines.push(ind + "  " + parts.slice(i, i + 24).join(", "));
      return `[\n${lines.join(",\n")}\n${ind}]`;
    }
    if (value.length <= 8 && value.every(isPoint)) return `[${value.map((p) => stableJson(p)).join(", ")}]`;
    return `[\n${value.map((v) => `${ind}  ${stableJson(v, ind + "  ")}`).join(",\n")}\n${ind}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>).filter(([, v]) => v !== undefined);
  if (entries.length === 0) return "{}";
  const flat = entries.length <= 4 && entries.every(([, v]) => v === null || ["number", "string", "boolean"].includes(typeof v));
  if (flat) return `{ ${entries.map(([k, v]) => `${JSON.stringify(k)}: ${stableJson(v)}`).join(", ")} }`;
  return `{\n${entries.map(([k, v]) => `${ind}  ${JSON.stringify(k)}: ${stableJson(v, ind + "  ")}`).join(",\n")}\n${ind}}`;
}

// ------------------------------------------------------------------------------------------------ build

export interface BuildOptions {
  /** Repository root. */
  root: string;
  /** Sun implementation; default `solarProvider`. */
  sun?: SunProvider;
  /** Path of the furniture report, or null to ignore it. Default: pipeline/out/furniture-report.json when it exists. */
  furnitureReport?: string | null;
  /** Overrides model/render.json (tests). */
  renderJson?: unknown;
}

export interface BuildResult {
  data: Record<string, unknown> & { hash: string };
  text: string;
  warnings: string[];
  config: RenderConfig;
}

const readJson = (file: string): unknown => JSON.parse(fs.readFileSync(file, "utf8"));
const stableForCompare = (v: unknown): string => JSON.stringify(v, (_k, x) => (typeof x === "number" && Number.isFinite(x) ? Math.round(x * 1e9) / 1e9 : x));

export function buildRenderInputs(opts: BuildOptions): BuildResult {
  const root = opts.root;
  const warnings: string[] = [];
  const modelDir = path.join(root, "model");
  const files = fs
    .readdirSync(modelDir)
    .filter(isHashedModelFile)
    .map((name) => ({ name, content: fs.readFileSync(path.join(modelDir, name), "utf8") }));
  const modelHash = hashModelFiles(opts.renderJson === undefined ? files : files.map((f) => (f.name === "render.json" ? { name: f.name, content: JSON.stringify(opts.renderJson) } : f)));
  const text = (name: string): string => files.find((f) => f.name === name)?.content ?? "";
  const cfg = parseRenderConfig(opts.renderJson ?? JSON.parse(text("render.json")));
  const { house, derived } = analyzeHouse(JSON.parse(text("house.json")));

  // the Blender scene reads generated/derived.json: it must be the same geometry as the kernel produces now
  const derivedPath = path.join(root, "generated", "derived.json");
  let derivedHash: string | null = null;
  if (fs.existsSync(derivedPath)) {
    const committed = readJson(derivedPath) as Record<string, unknown>;
    derivedHash = typeof committed.inputHash === "string" ? committed.inputHash : null;
    const a = { ...committed, inputHash: null };
    const b = { ...derived, inputHash: null };
    if (stableForCompare(a) !== stableForCompare(b)) throw new Error("generated/derived.json is stale: run `npx tsx scripts/build-derived.ts`");
  } else warnings.push("generated/derived.json is missing: the Blender scene cannot be built without it");

  const site = createSite(JSON.parse(text("site.json")), house.location.houseAxisBearingDeg);
  const siteDerived = exportSiteDerived(site, house.outdoor, { gridStep: 10 });
  const ctx: WorldContext = { house, derived, site, siteDerived, cfg };

  const hints = (species: string): { form: string; leaf: string; flower?: string } => {
    const h = cfg.vegetation.species[species];
    if (!h) throw new Error(`render.json: no vegetation hint for species "${species}"`);
    return h.flower ? { form: h.form, leaf: h.leaf, flower: h.flower } : { form: h.form, leaf: h.leaf };
  };

  // furniture decor lamps: only from a report that was built from this derived data
  let report: FurnitureReport | null = null;
  let reportPath: string | null = null;
  const wanted = opts.furnitureReport === undefined ? path.join(root, "pipeline", "out", "furniture-report.json") : opts.furnitureReport;
  if (wanted && fs.existsSync(wanted)) {
    const r = readJson(wanted) as FurnitureReport;
    if (derivedHash && r.modelHash === derivedHash) {
      report = r;
      reportPath = path.relative(root, wanted).split(path.sep).join("/");
    } else warnings.push("furniture report ignored: it was not built from the current generated/derived.json");
  }

  const blinds = buildBlinds(ctx);
  const sun = opts.sun ?? solarProvider;
  const shotCtx: ShotContext = {
    cfg,
    lat: house.location.lat,
    lon: house.location.lon,
    tz: house.location.tz,
    bearingDeg: house.location.houseAxisBearingDeg,
    sun,
    blinds: { rule: blinds.rule, details: blinds.details, items: blinds.items },
    camera: { sensorWidthMm: cfg.sensorWidthMm, near: CAMERA_NEAR, far: CAMERA_FAR },
    bbox: { x0: derived.bbox.x0, y0: derived.bbox.y0, x1: derived.bbox.x1, y1: derived.bbox.y1, z0: derived.bbox.z0, z1: derived.bbox.z1 },
    roofs: derived.roofs.map((r) => ({ eaveRect: r.eaveRect as [number, number, number, number], eaveHeight: r.eaveHeight })),
  };
  const events = dayEvents(cfg.date, house.location.tz, house.location.lat, house.location.lon, (t, la, lo) => sun.position(t, la, lo).elevationGeomDeg);

  const body = {
    schema: SCHEMA,
    modelHash,
    inputs: {
      derived: "generated/derived.json",
      derivedHash,
      house: "model/house.json",
      site: "model/site.json",
      style: "model/style.json",
      render: "model/render.json",
      glb: {
        house: "public/models/house.glb",
        houseLite: "public/models/house-lite.glb",
        furniture: "public/models/furniture.glb",
        furnitureLite: "public/models/furniture-lite.glb",
        footprints: "public/models/furniture-footprints.json",
        manifest: "public/models/manifest.json",
      },
      furnitureReport: reportPath,
      sunSource: sun.name,
    },
    location: {
      lat: house.location.lat,
      lon: house.location.lon,
      elevationM: house.location.elevation,
      tz: house.location.tz,
      houseAxisBearingDeg: house.location.houseAxisBearingDeg,
      region: house.location.region,
    },
    date: cfg.date,
    daylight: events,
    sky: { ...cfg.sky, altitudeM: house.location.elevation },
    sensor: { widthMm: cfg.sensorWidthMm, fit: "AUTO" },
    house: buildHouseSection(ctx),
    terrain: buildTerrain(ctx),
    site: buildSite(ctx, hints),
    vegetation: buildVegetation(ctx, hints),
    neighbours: buildNeighbours(ctx),
    pv: buildPv(ctx),
    blinds,
    screens: buildScreens(ctx),
    lights: buildLights(ctx, report),
    stills: buildStills(shotCtx),
    day: buildDay(shotCtx),
    orbit: buildOrbit(shotCtx),
    compare: buildCompare(shotCtx),
    og: buildOg(shotCtx),
  };
  const hash = sha256Hex(stableJson(body));
  const { schema, ...rest } = body;
  const data = { schema, hash, ...rest };
  return { data, text: stableJson(data) + "\n", warnings, config: cfg };
}

/** Recomputes the content hash of a parsed render-inputs object (everything except `hash`). */
export function contentHash(data: Record<string, unknown>): string {
  const copy: Record<string, unknown> = { ...data };
  delete copy.hash;
  return sha256Hex(stableJson(copy));
}

// ------------------------------------------------------------------------------------------------ summary + CLI

function summary(res: BuildResult): string {
  const d = res.data as unknown as {
    inputs: { sunSource: string; furnitureReport: string | null };
    daylight: { sunrise: string; sunset: string; solarNoon: string; noonElevationDeg: number };
    terrain: { grid: { nx: number; ny: number } };
    vegetation: { trees: unknown[]; shrubs: unknown[] };
    pv: { count: number; kwp: number };
    blinds: { items: unknown[] };
    lights: { items: { group: string }[]; sources: unknown };
    stills: { id: string; time: { local: string }; sun: { azimuthHouseDeg: number; elevationDeg: number }; lights: { interior: number; exterior: number }; sunScreen: { visible: boolean } | null }[];
    day: { frames: { time: { local: string }; sun: { azimuthTrueDeg: number; elevationDeg: number }; lights: { interior: number }; blinds: { drop: number }[]; sunScreen: { visible: boolean } | null }[]; portrait: { crop: unknown } };
    orbit: { variants: { id: string; radiusMin: number; radiusMax: number; frames: unknown[] }[]; sun: { elevationDeg: number; azimuthTrueDeg: number } };
  };
  const out: string[] = [];
  out.push(`render-inputs ${res.data.hash.slice(0, 12)}  sun: ${d.inputs.sunSource}  furniture report: ${d.inputs.furnitureReport ?? "none"}`);
  out.push(`daylight: sunrise ${d.daylight.sunrise}, solar noon ${d.daylight.solarNoon} (${d.daylight.noonElevationDeg.toFixed(1)} deg), sunset ${d.daylight.sunset}`);
  out.push(`terrain ${d.terrain.grid.nx} x ${d.terrain.grid.ny}, trees ${d.vegetation.trees.length}, shrubs ${d.vegetation.shrubs.length}, PV ${d.pv.count} (${d.pv.kwp} kWp), blinds ${d.blinds.items.length}, lamps ${d.lights.items.length} (interior ${d.lights.items.filter((l) => l.group === "interior").length})`);
  out.push("stills:");
  for (const s of d.stills) out.push(`  ${s.id.padEnd(18)} ${s.time.local}  sun az(house) ${s.sun.azimuthHouseDeg.toFixed(0).padStart(3)} el ${s.sun.elevationDeg.toFixed(1).padStart(5)}  lamps ${s.lights.interior.toFixed(2)}/${s.lights.exterior.toFixed(2)}  sun visible: ${s.sunScreen?.visible ? "yes" : "no"}`);
  out.push("day frames:");
  for (const f of d.day.frames) out.push(`  ${f.time.local}  az(true) ${f.sun.azimuthTrueDeg.toFixed(1).padStart(5)} el ${f.sun.elevationDeg.toFixed(1).padStart(5)}  lamps ${f.lights.interior.toFixed(2)}  blinds down ${f.blinds.filter((b) => b.drop > 0).length}/${f.blinds.length}  sun visible: ${f.sunScreen?.visible ? "yes" : "no"}`);
  out.push(`day portrait crop: ${JSON.stringify(d.day.portrait.crop)}`);
  out.push(`orbit sun: az ${d.orbit.sun.azimuthTrueDeg.toFixed(1)} el ${d.orbit.sun.elevationDeg.toFixed(1)}; ` + d.orbit.variants.map((v) => `${v.id}: radius ${v.radiusMin}..${v.radiusMax} m, ${v.frames.length} frames`).join("; "));
  return out.join("\n");
}

async function main(): Promise<number> {
  const args = process.argv.slice(2);
  const opt = (k: string): string | undefined => (args.includes(k) ? args[args.indexOf(k) + 1] : undefined);
  const root = path.resolve(path.dirname(process.argv[1] ?? "."), "..");
  const out = opt("--out") ?? path.join(root, "generated", "render-inputs.json");
  const furnitureReport = args.includes("--no-furniture-report") ? null : opt("--furniture-report");
  let res: BuildResult;
  try {
    res = buildRenderInputs({ root, sun: await resolveSunProvider(), furnitureReport });
  } catch (e) {
    console.error(`cannot build the render inputs: ${(e as Error).message}`);
    return 1;
  }
  for (const w of res.warnings) console.warn(`warning: ${w}`);
  if (args.includes("--summary")) console.log(summary(res));
  if (args.includes("--check")) {
    const have = fs.existsSync(out) ? fs.readFileSync(out, "utf8") : null;
    if (have !== res.text) {
      console.error(`STALE: ${path.relative(root, out)} (run: npx tsx scripts/build-render-inputs.ts)`);
      return 1;
    }
    console.log(`${path.relative(root, out)} is up to date`);
    return 0;
  }
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, res.text);
  console.log(`wrote ${path.relative(root, out)} (${(res.text.length / 1024).toFixed(0)} kB, hash ${res.data.hash.slice(0, 12)})`);
  return 0;
}

if (process.argv[1] && /build-render-inputs\.[cm]?[jt]s$/.test(process.argv[1])) {
  main().then((c) => process.exit(c));
}

export type { Derived, House };
