// Assembles src/lib/data/pvgis.json from the raw PVGIS responses in pipeline/data/pvgis/ (no network needed).
// Deterministic and idempotent: same raw files, same bytes.
// Usage: npx tsx scripts/build-pvgis.ts [--check] [--out=path] [--raw=dir]
//        npx tsx scripts/build-pvgis.ts --model   (offline fallback, flagged source "model"; only when PVGIS is unreachable)
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import {
  FACINGS, HOUSE_AZIMUTH, MANIFEST_FILE, RAW_DIR, VERTICAL_PITCH, buildPlan, findRoot, pvgisAspect, resolveParams, trueAzimuth, validateRaw,
  type Facing, type Manifest, type Params,
} from "./fetch-pvgis";

export const OUT_FILE = "src/lib/data/pvgis.json";
export const DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

// ------------------------------------------------------------------ output schema (pvgis/1)
const perFacing = <T extends z.ZodType>(t: T) => z.strictObject({ N: t, E: t, S: t, W: t });
const months = z.array(z.number().finite()).length(12);
const hourly = z.array(z.array(z.number().finite()).length(24)).length(12);

export const pvgisSchema = z.strictObject({
  schema: z.literal("pvgis/1"),
  /** "pvgis" = fetched from the EU PVGIS API; "model" = offline fallback (clear sky + climatology). */
  source: z.enum(["pvgis", "model"]),
  meta: z.strictObject({
    service: z.string(), apiVersion: z.string().nullable(), radiationDb: z.string(), meteoDb: z.string().nullable(),
    years: z.tuple([z.number().int(), z.number().int()]).nullable(),
    horizon: z.boolean(), horizonDb: z.string().nullable(), pvTechnology: z.string(), mounting: z.string(),
    retrieved: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
    lat: z.number(), lon: z.number(), elevationM: z.number().nullable(),
  }),
  /** Plane pitch of the PVcalc/DRcalc roof requests (degrees). */ slope: z.number(),
  /** System loss assumed by PVcalc (%). */ loss: z.number(),
  /** Azimuth of the house +y axis (degrees clockwise from true north). */ houseAxisBearingDeg: z.number(),
  /** Facings are named in the house frame; azimuths are true (clockwise from north), aspect is the PVGIS convention. */
  facings: perFacing(z.strictObject({ houseAzimuthDeg: z.number(), azimuthDeg: z.number(), pvgisAspect: z.number() })),
  /** Monthly yield of 1 kWp on the roof pitch, kWh per kWp. */ monthly: perFacing(months),
  /** Yearly yield of 1 kWp, kWh per kWp. */ yearly: perFacing(z.number().finite()),
  /** Mean irradiance on the roof plane, W/m2, per month and UTC hour (index = UTC hour label). */ profileUTC: perFacing(hourly),
  /** Mean 2 m air temperature, deg C, per month and UTC hour. */ tempUTC: hourly,
  /** Monthly irradiation of a vertical plane, kWh/m2. */ vertical: perFacing(months),
});
export type PvgisData = z.infer<typeof pvgisSchema>;

const round = (v: number, d: number) => Math.round(v * 10 ** d) / 10 ** d;
const sum = (a: number[]) => a.reduce((s, v) => s + v, 0);

/** Physical sanity checks on top of the shape; returns a list of problems (empty = fine). */
export function checkRanges(d: PvgisData): string[] {
  const bad: string[] = [];
  const within = (name: string, v: number, lo: number, hi: number) => { if (!(v >= lo && v <= hi)) bad.push(`${name} = ${v} outside ${lo}..${hi}`); };
  for (const f of FACINGS) {
    d.monthly[f].forEach((v, m) => within(`monthly.${f}[${m}]`, v, 0, 250));
    within(`yearly.${f}`, d.yearly[f], 300, 1500);
    within(`sum(monthly.${f}) - yearly`, Math.abs(sum(d.monthly[f]) - d.yearly[f]), 0, 0.25);
    d.profileUTC[f].forEach((row, m) => row.forEach((v, h) => within(`profileUTC.${f}[${m}][${h}]`, v, 0, 1200)));
    d.vertical[f].forEach((v, m) => within(`vertical.${f}[${m}]`, v, 0, 250));
  }
  d.tempUTC.forEach((row, m) => row.forEach((v, h) => within(`tempUTC[${m}][${h}]`, v, -30, 42)));
  const mean = (m: number) => sum(d.tempUTC[m]) / 24;
  if (!(mean(0) < mean(6))) bad.push("January is not colder than July");
  within("mean annual temperature", sum(d.tempUTC.map((_, m) => mean(m))) / 12, 3, 15);
  return bad;
}

// ------------------------------------------------------------------ assemble from raw PVGIS files
type Doc = { inputs: Record<string, unknown> & { location: Record<string, unknown>; meteo_data: Record<string, unknown> }; outputs: Record<string, unknown> };
type DrRow = { month: number; time: string; "G(i)": number; T2m: number };

function readJson(file: string): unknown {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

export function assemble(rawDir: string): PvgisData {
  const manifest = readJson(path.join(rawDir, MANIFEST_FILE)) as Manifest;
  if (manifest.schema !== "pvgis-raw/1") throw new Error("Unknown raw manifest schema");
  const plan = buildPlan(manifest.params);
  if (plan.length !== manifest.requests.length) throw new Error("Manifest does not match the request plan; run scripts/fetch-pvgis.ts");
  const docs = new Map<string, Doc>();
  for (const item of plan) {
    const rec = manifest.requests.find((r) => r.file === item.file);
    if (!rec || JSON.stringify(rec.query) !== JSON.stringify(item.query)) throw new Error(`Manifest entry for ${item.file} does not match the plan; re-fetch with --force`);
    const doc = readJson(path.join(rawDir, item.file));
    validateRaw(item, doc);
    docs.set(item.file, doc as Doc);
  }
  const first = docs.get(plan[0].file)!;
  for (const [file, doc] of docs) {
    if (JSON.stringify(doc.inputs.location) !== JSON.stringify(first.inputs.location) || JSON.stringify(doc.inputs.meteo_data) !== JSON.stringify(first.inputs.meteo_data)) {
      throw new Error(`${file}: location or data sources differ between responses`);
    }
  }
  const rows = (kind: "dr-roof" | "dr-vertical", f: Facing) => (docs.get(plan.find((p) => p.kind === kind && p.facing === f)!.file)!.outputs.daily_profile as DrRow[]);
  const byFacing = byKeys;

  const monthly = byFacing((f) => {
    const doc = docs.get(plan.find((p) => p.kind === "pvcalc" && p.facing === f)!.file)!;
    return ((doc.outputs.monthly as { fixed: { E_m: number }[] }).fixed).map((m) => round(m.E_m, 2));
  });
  const yearly = byFacing((f) => {
    const doc = docs.get(plan.find((p) => p.kind === "pvcalc" && p.facing === f)!.file)!;
    return round((doc.outputs.totals as { fixed: { E_y: number } }).fixed.E_y, 1);
  });
  const profileUTC = byFacing((f) => Array.from({ length: 12 }, (_, m) => rows("dr-roof", f).slice(m * 24, m * 24 + 24).map((r) => round(r["G(i)"], 1))));
  const vertical = byFacing((f) => Array.from({ length: 12 }, (_, m) => round((sum(rows("dr-vertical", f).slice(m * 24, m * 24 + 24).map((r) => r["G(i)"])) * DAYS[m]) / 1000, 1)));

  // air temperature does not depend on the plane: take the S roof response and require all eight to agree
  const temps = (f: Facing, kind: "dr-roof" | "dr-vertical") => rows(kind, f).map((r) => r.T2m);
  const refTemp = temps("S", "dr-roof");
  for (const f of FACINGS) for (const k of ["dr-roof", "dr-vertical"] as const) {
    if (JSON.stringify(temps(f, k)) !== JSON.stringify(refTemp)) throw new Error(`Temperature series differs in ${k} ${f}`);
  }
  const tempUTC = Array.from({ length: 12 }, (_, m) => refTemp.slice(m * 24, m * 24 + 24).map((t) => round(t, 2)));

  const md = first.inputs.meteo_data as { radiation_db: string; meteo_db: string; year_min: number; year_max: number; use_horizon: boolean; horizon_db: string };
  const loc = first.inputs.location as { elevation: number };
  const pvIn = docs.get(plan[0].file)!.inputs as unknown as { pv_module: { technology: string }; mounting_system: { fixed: { type: string } } };
  const retrieved = manifest.requests.map((r) => r.fetchedAt).sort().at(-1) ?? null;
  const p = manifest.params;
  return pvgisSchema.parse({
    schema: "pvgis/1", source: "pvgis",
    meta: {
      service: "PVGIS 5.3 (EU JRC)", apiVersion: path.posix.basename(manifest.apiBase), radiationDb: md.radiation_db, meteoDb: md.meteo_db,
      years: [md.year_min, md.year_max], horizon: md.use_horizon, horizonDb: md.horizon_db,
      pvTechnology: pvIn.pv_module.technology, mounting: pvIn.mounting_system.fixed.type, retrieved,
      lat: p.lat, lon: p.lon, elevationM: loc.elevation,
    },
    slope: p.pitch, loss: p.loss, houseAxisBearingDeg: p.bearing,
    facings: facingsOf(p),
    monthly, yearly, profileUTC, tempUTC, vertical,
  });
}

function facingsOf(p: Params) {
  return byKeys((f) => ({ houseAzimuthDeg: HOUSE_AZIMUTH[f], azimuthDeg: trueAzimuth(f, p.bearing), pvgisAspect: pvgisAspect(trueAzimuth(f, p.bearing)) }));
}
function byKeys<T>(fn: (f: Facing) => T): Record<Facing, T> {
  return { N: fn("N"), E: fn("E"), S: fn("S"), W: fn("W") };
}

// ------------------------------------------------------------------ offline fallback: clear sky + climatology
// Only used when the PVGIS API stays unreachable. Generic climatology constants for South Moravia (approximate, not fetched data).
const MID_DOY = [17, 47, 75, 105, 135, 162, 198, 228, 258, 288, 318, 344]; // representative day of each month
const CLIM_GHI = [26, 44, 87, 128, 165, 175, 178, 153, 105, 65, 30, 19]; // kWh/m2 per month, horizontal plane
const CLIM_T = [-1.5, 0.3, 4.4, 9.8, 14.6, 17.9, 19.8, 19.4, 14.8, 9.5, 4.2, -0.2]; // monthly mean, deg C
const CLIM_DT = [2.5, 3.2, 4.5, 5.8, 6.5, 6.8, 7.2, 7.2, 6, 4.2, 2.5, 2]; // half-range of the daily cycle, deg C
const MODEL_PR = 0.8, ALBEDO = 0.2, DEG = Math.PI / 180;

/** Irradiance (W/m2) on a plane of pitch beta and PVGIS aspect gamma for the representative day of month m, per UTC hour label. */
function modelPlane(p: Params, m: number, beta: number, gamma: number): number[] {
  const n = MID_DOY[m], phi = p.lat * DEG;
  const decl = 23.45 * Math.sin(((360 * (284 + n)) / 365) * DEG) * DEG;
  const B = ((360 * (n - 81)) / 364) * DEG;
  const eot = 9.87 * Math.sin(2 * B) - 7.53 * Math.cos(B) - 1.5 * Math.sin(B); // minutes
  const e0 = 1 + 0.033 * Math.cos(((360 * n) / 365) * DEG);
  const geo = (h: number) => {
    const w = (15 * (h + 0.5 + p.lon / 15 + eot / 60 - 12)) * DEG; // the hour label is the start of the hour: use its middle
    const cosz = Math.sin(phi) * Math.sin(decl) + Math.cos(phi) * Math.cos(decl) * Math.cos(w);
    const b = beta * DEG, g = gamma * DEG;
    const cost = Math.sin(decl) * Math.sin(phi) * Math.cos(b) - Math.sin(decl) * Math.cos(phi) * Math.sin(b) * Math.cos(g)
      + Math.cos(decl) * Math.cos(phi) * Math.cos(b) * Math.cos(w) + Math.cos(decl) * Math.sin(phi) * Math.sin(b) * Math.cos(g) * Math.cos(w)
      + Math.cos(decl) * Math.sin(b) * Math.sin(g) * Math.sin(w);
    return { cosz, cost };
  };
  const hours = Array.from({ length: 24 }, (_, h) => h);
  const clear = hours.map((h) => { const { cosz } = geo(h); return cosz > 0 ? 1098 * cosz * Math.exp(-0.057 / cosz) : 0; }); // Haurwitz
  const h0 = sum(hours.map((h) => 1361 * e0 * Math.max(0, geo(h).cosz)));
  const dailyGhi = (CLIM_GHI[m] * 1000) / DAYS[m]; // Wh/m2 per day
  const kt = Math.min(0.8, dailyGhi / h0);
  const kd = Math.min(0.9, Math.max(0.25, 1 - 1.13 * kt)); // Page: monthly-mean diffuse fraction from the monthly clearness index
  const scale = dailyGhi / sum(clear);
  return hours.map((h, i) => {
    const gh = clear[i] * scale, gd = kd * gh, gb = gh - gd, { cosz, cost } = geo(h);
    const rb = cosz > 0.05 ? Math.max(0, cost) / cosz : 0;
    return gb * rb + gd * (1 + Math.cos(beta * DEG)) / 2 + ALBEDO * gh * (1 - Math.cos(beta * DEG)) / 2;
  });
}

export function modelData(p: Params): PvgisData {
  const planes = byKeys((f) => {
    const aspect = pvgisAspect(trueAzimuth(f, p.bearing));
    const roof = Array.from({ length: 12 }, (_, m) => modelPlane(p, m, p.pitch, aspect));
    const wall = Array.from({ length: 12 }, (_, m) => modelPlane(p, m, VERTICAL_PITCH, aspect));
    const yieldM = roof.map((row, m) => (sum(row) * DAYS[m] * MODEL_PR) / 1000); // kWh per kWp
    return {
      monthly: yieldM.map((v) => round(v, 2)), yearly: round(sum(yieldM), 1),
      profile: roof.map((row) => row.map((v) => round(v, 1))),
      vertical: wall.map((row, m) => round((sum(row) * DAYS[m]) / 1000, 1)),
    };
  });
  const tempUTC = Array.from({ length: 12 }, (_, m) => Array.from({ length: 24 }, (_, h) => round(CLIM_T[m] + CLIM_DT[m] * Math.cos((2 * Math.PI * (h + 0.5 - 13)) / 24), 2)));
  return pvgisSchema.parse({
    schema: "pvgis/1", source: "model",
    meta: {
      service: "model", apiVersion: null, radiationDb: "clear-sky model + climatology", meteoDb: null, years: null, horizon: false, horizonDb: null,
      pvTechnology: "c-Si", mounting: "free-standing", retrieved: null, lat: p.lat, lon: p.lon, elevationM: null,
    },
    slope: p.pitch, loss: p.loss, houseAxisBearingDeg: p.bearing, facings: facingsOf(p),
    monthly: byKeys((f) => planes[f].monthly), yearly: byKeys((f) => planes[f].yearly), profileUTC: byKeys((f) => planes[f].profile),
    tempUTC, vertical: byKeys((f) => planes[f].vertical),
  });
}

// ------------------------------------------------------------------ serialisation (stable, readable diffs)
const isPrim = (x: unknown) => x === null || typeof x !== "object";
export function serialize(v: unknown, pad = ""): string {
  if (Array.isArray(v)) {
    if (v.every(isPrim)) return "[" + v.map((x) => JSON.stringify(x)).join(", ") + "]";
    return "[\n" + v.map((x) => `${pad}  ${serialize(x, pad + "  ")}`).join(",\n") + `\n${pad}]`;
  }
  if (v !== null && typeof v === "object") {
    const e = Object.entries(v as Record<string, unknown>);
    if (e.every(([, x]) => isPrim(x))) {
      const flat = "{ " + e.map(([k, x]) => `${JSON.stringify(k)}: ${JSON.stringify(x)}`).join(", ") + " }";
      if (flat.length <= 110) return flat;
    }
    return "{\n" + e.map(([k, x]) => `${pad}  ${JSON.stringify(k)}: ${serialize(x, pad + "  ")}`).join(",\n") + `\n${pad}}`;
  }
  return JSON.stringify(v);
}

// ------------------------------------------------------------------ CLI
function main() {
  const args = process.argv.slice(2);
  const opt = (name: string) => args.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
  const root = findRoot();
  const out = path.resolve(root, opt("out") ?? OUT_FILE), rawDir = path.resolve(root, opt("raw") ?? RAW_DIR);
  const data = args.includes("--model") ? modelData(resolveParams({}, root).params) : assemble(rawDir);
  const problems = checkRanges(data);
  if (problems.length) throw new Error(`pvgis data failed the range checks:\n  ${problems.slice(0, 10).join("\n  ")}`);
  const text = serialize(data) + "\n";
  if (args.includes("--check")) {
    const same = fs.existsSync(out) && fs.readFileSync(out, "utf8") === text;
    console.log(same ? `${path.relative(root, out)} is up to date` : `${path.relative(root, out)} is out of date: run npx tsx scripts/build-pvgis.ts`);
    process.exit(same ? 0 : 1);
  }
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out + ".tmp", text);
  fs.renameSync(out + ".tmp", out);
  console.log(`wrote ${path.relative(root, out)} (source: ${data.source}, S yield ${data.yearly.S} kWh/kWp)`);
}

if (/build-pvgis\.[cm]?[jt]s$/.test(process.argv[1] ?? "")) {
  try { main(); } catch (e) { console.error(String(e instanceof Error ? e.message : e)); process.exit(1); }
}
