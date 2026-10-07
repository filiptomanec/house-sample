// Fetches photovoltaic yield and irradiance profiles from the EU PVGIS API for the one fictional site.
// Raw responses are stored verbatim in pipeline/data/pvgis/ (plus a manifest), and scripts/build-pvgis.ts turns them
// into src/lib/data/pvgis.json offline. Usage: npx tsx scripts/fetch-pvgis.ts [--force] [--budget-min=30]
//   [--lat=49.2] [--lon=16.6] [--pitch=22] [--bearing=12] [--loss=14]
// Network errors are retried with exponential backoff for up to 30 minutes per request; nothing is ever invented here.
import fs from "node:fs";
import path from "node:path";

// ------------------------------------------------------------------ constants and pure helpers
export const API_BASE = "https://re.jrc.ec.europa.eu/api/v5_3";
export const RAD_DATABASE = "PVGIS-SARAH3";
export const RAW_DIR = "pipeline/data/pvgis";
export const MANIFEST_FILE = "meta.json";
/** Facings are named in the HOUSE frame: N = the plane that looks along the house +y axis, S = against it, and so on. */
export const FACINGS = ["N", "E", "S", "W"] as const;
export type Facing = (typeof FACINGS)[number];
/** Azimuth of each facing relative to the house +y axis (clockwise). */
export const HOUSE_AZIMUTH: Record<Facing, number> = { N: 0, E: 90, S: 180, W: 270 };
export const VERTICAL_PITCH = 90;
/** Fictional site (South Moravia, rounded to 0.1 degree) used when model/*.json does not say otherwise. */
export const DEFAULTS = { lat: 49.2, lon: 16.6, pitch: 22, bearing: 12, loss: 14 } as const;

const mod = (a: number, n: number) => ((a % n) + n) % n;
/** True azimuth (clockwise from north, 0..360) of a facing, given the azimuth of the house +y axis. */
export const trueAzimuth = (facing: Facing, bearingDeg: number) => mod(HOUSE_AZIMUTH[facing] + bearingDeg, 360);
/** PVGIS aspect: 0 = south, +90 = west, -90 = east, +-180 = north; azimuth minus 180 normalised to (-180, 180]. */
export function pvgisAspect(azimuthDeg: number): number {
  const a = mod(azimuthDeg, 360) - 180; // azimuth - 180, folded into [-180, 180)
  return a === -180 ? 180 : a;
}
const round1 = (v: number) => Math.round(v * 10) / 10;

export type Params = { lat: number; lon: number; pitch: number; bearing: number; loss: number };
export type ParamSources = Record<keyof Params, string>;

export type RequestKind = "pvcalc" | "dr-roof" | "dr-vertical";
export type PlanItem = {
  file: string; endpoint: "PVcalc" | "DRcalc"; kind: RequestKind; facing: Facing; angle: number; aspect: number;
  query: Record<string, string | number>;
};

const KIND_PREFIX: Record<RequestKind, string> = { pvcalc: "pvcalc", "dr-roof": "dr", "dr-vertical": "dr90" };

/** The 12 requests: PVcalc (monthly yield) and DRcalc (average day per month) on the roof pitch, DRcalc on vertical planes. */
export function buildPlan(p: Params): PlanItem[] {
  const site = { lat: p.lat, lon: p.lon, raddatabase: RAD_DATABASE, usehorizon: 1, outputformat: "json" };
  const items: PlanItem[] = [];
  const add = (kind: RequestKind, facing: Facing) => {
    const aspect = pvgisAspect(trueAzimuth(facing, p.bearing));
    const angle = kind === "dr-vertical" ? VERTICAL_PITCH : p.pitch;
    const query: Record<string, string | number> = kind === "pvcalc"
      ? { ...site, peakpower: 1, loss: p.loss, pvtechchoice: "crystSi", mountingplace: "free", angle, aspect }
      : { ...site, angle, aspect, month: 0, global: 1, localtime: 0, showtemperatures: 1 };
    items.push({ file: `${KIND_PREFIX[kind]}-${facing}.json`, endpoint: kind === "pvcalc" ? "PVcalc" : "DRcalc", kind, facing, angle, aspect, query });
  };
  for (const kind of ["pvcalc", "dr-roof", "dr-vertical"] as RequestKind[]) for (const f of FACINGS) add(kind, f);
  return items;
}

export function requestUrl(item: PlanItem): string {
  const qs = Object.keys(item.query).sort().map((k) => `${k}=${encodeURIComponent(String(item.query[k]))}`).join("&");
  return `${API_BASE}/${item.endpoint}?${qs}`;
}

// ------------------------------------------------------------------ repository paths and model parameters
export function findRoot(from = process.cwd()): string {
  let dir = path.resolve(from);
  for (;;) {
    if (fs.existsSync(path.join(dir, "package.json")) && fs.existsSync(path.join(dir, "docs"))) return dir;
    const up = path.dirname(dir);
    if (up === dir) return path.resolve(from);
    dir = up;
  }
}

function readJsonIfExists(file: string): unknown {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return null; }
}
function getPath(obj: unknown, dotted: string): unknown {
  let cur: unknown = obj;
  for (const k of dotted.split(".")) {
    if (cur === null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[k];
  }
  return cur;
}
const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);

/** Reads site and roof parameters from model/house.json and model/site.json when present, otherwise the fictional defaults. */
export function resolveParams(over: Partial<Params> = {}, root = findRoot()): { params: Params; sources: ParamSources } {
  const files = { "model/house.json": readJsonIfExists(path.join(root, "model/house.json")), "model/site.json": readJsonIfExists(path.join(root, "model/site.json")) };
  const find = (paths: string[], order: (keyof typeof files)[]): [number, string] | null => {
    for (const f of order) for (const p of paths) { const v = num(getPath(files[f], p)); if (v !== undefined) return [v, f]; }
    return null;
  };
  const siteFirst: (keyof typeof files)[] = ["model/site.json", "model/house.json"];
  const houseFirst: (keyof typeof files)[] = ["model/house.json", "model/site.json"];
  const lat = find(["location.lat", "location.latitude", "lat"], siteFirst);
  const lon = find(["location.lon", "location.lng", "location.longitude", "lon"], siteFirst);
  const bearing = find(["location.houseAxisBearingDeg", "houseAxisBearingDeg"], houseFirst);
  let pitch: [number, string] | null = null;
  const roofs = getPath(files["model/house.json"], "roofs");
  if (Array.isArray(roofs)) {
    const pitches = roofs.map((r) => num((r as { pitch?: unknown } | null)?.pitch)).filter((v): v is number => v !== undefined);
    if (pitches.length && new Set(pitches).size > 1) throw new Error(`model/house.json roofs have different pitches (${[...new Set(pitches)].join(", ")}); pvgis.json holds a single slope`);
    if (pitches.length) pitch = [pitches[0], "model/house.json"];
  }
  const pick = (key: keyof Params, found: [number, string] | null): [number, string] =>
    over[key] !== undefined ? [over[key] as number, "cli"] : found ?? [DEFAULTS[key], "default"];
  const [latV, latS] = pick("lat", lat), [lonV, lonS] = pick("lon", lon), [pitchV, pitchS] = pick("pitch", pitch);
  const [bearV, bearS] = pick("bearing", bearing), [lossV, lossS] = pick("loss", null);
  return {
    // the published position is always rounded to 0.1 degree
    params: { lat: round1(latV), lon: round1(lonV), pitch: pitchV, bearing: bearV, loss: lossV },
    sources: { lat: latS, lon: lonS, pitch: pitchS, bearing: bearS, loss: lossS },
  };
}

// ------------------------------------------------------------------ HTTP with retry
export type HttpResponse = { status: number; headers: { get(name: string): string | null }; text(): Promise<string> };
export type HttpFetch = (url: string, init: { signal: AbortSignal }) => Promise<HttpResponse>;

export class PvgisRequestError extends Error {}
export class PvgisUnavailableError extends Error {}

export type RetryOptions = {
  fetchFn?: HttpFetch; sleep?: (ms: number) => Promise<void>; now?: () => number;
  budgetMs?: number; timeoutMs?: number; baseDelayMs?: number; maxDelayMs?: number; minGapMs?: number;
  limiter?: () => Promise<void>; log?: (msg: string) => void;
};

/** Spaces the start of requests by at least minGapMs (default 250 ms = at most 4 requests per second). */
export function makeLimiter(minGapMs: number, now: () => number, sleep: (ms: number) => Promise<void>) {
  let next = 0;
  return async () => {
    const t = now();
    const wait = Math.max(0, next - t);
    next = Math.max(t, next) + minGapMs;
    if (wait > 0) await sleep(wait);
  };
}

const realSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const defaultLimiter = makeLimiter(250, Date.now, realSleep);

/** GET a JSON document; transient failures (network, timeout, 408/425/429, 5xx, broken JSON) are retried until the budget is spent. */
export async function fetchJsonWithRetry(url: string, opts: RetryOptions = {}): Promise<{ text: string; json: unknown; attempts: number }> {
  const fetchFn: HttpFetch = opts.fetchFn ?? ((u, init) => fetch(u, init));
  const sleep = opts.sleep ?? realSleep, now = opts.now ?? Date.now;
  const budgetMs = opts.budgetMs ?? 30 * 60_000, timeoutMs = opts.timeoutMs ?? 60_000;
  const baseDelay = opts.baseDelayMs ?? 2_000, maxDelay = opts.maxDelayMs ?? 120_000;
  const limiter = opts.limiter ?? (opts.minGapMs !== undefined ? makeLimiter(opts.minGapMs, now, sleep) : defaultLimiter);
  const log = opts.log ?? (() => {});
  const deadline = now() + budgetMs;
  for (let attempt = 1; ; attempt++) {
    await limiter();
    let reason: string, retryAfterMs = 0;
    try {
      const res = await fetchFn(url, { signal: AbortSignal.timeout(timeoutMs) });
      const text = await res.text();
      if (res.status === 200) {
        try { return { text, json: JSON.parse(text), attempts: attempt }; } catch { reason = "response is not valid JSON"; }
      } else if (res.status === 408 || res.status === 425 || res.status === 429 || res.status >= 500) {
        reason = `HTTP ${res.status}`;
        const ra = Number(res.headers.get("retry-after"));
        if (Number.isFinite(ra) && ra > 0) retryAfterMs = Math.min(ra, 300) * 1000;
      } else {
        throw new PvgisRequestError(`HTTP ${res.status}: ${text.slice(0, 200)}`);
      }
    } catch (e) {
      if (e instanceof PvgisRequestError) throw e;
      reason = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
    }
    const delay = Math.max(retryAfterMs, Math.min(maxDelay, baseDelay * 2 ** (attempt - 1)));
    if (now() + delay > deadline) throw new PvgisUnavailableError(`PVGIS not reachable after ${attempt} attempts (${reason})`);
    log(`  attempt ${attempt} failed (${reason}); retrying in ${Math.round(delay / 1000)} s`);
    await sleep(delay);
  }
}

// ------------------------------------------------------------------ raw response checks
type Json = Record<string, unknown>;
const obj = (v: unknown, what: string): Json => {
  if (v === null || typeof v !== "object" || Array.isArray(v)) throw new Error(`${what}: expected an object`);
  return v as Json;
};
const arr = (v: unknown, what: string, len?: number): unknown[] => {
  if (!Array.isArray(v) || (len !== undefined && v.length !== len)) throw new Error(`${what}: expected an array${len !== undefined ? ` of ${len}` : ""}`);
  return v;
};
const fin = (v: unknown, what: string): number => {
  if (typeof v !== "number" || !Number.isFinite(v)) throw new Error(`${what}: expected a finite number`);
  return v;
};

/** Throws when a stored/received response is not what the plan item asked for. */
export function validateRaw(item: PlanItem, doc: unknown): void {
  const root = obj(doc, item.file), inputs = obj(root.inputs, `${item.file} inputs`), outputs = obj(root.outputs, `${item.file} outputs`);
  const plane = obj(item.kind === "pvcalc" ? inputs.mounting_system : inputs.plane, `${item.file} plane`);
  const fixed = obj(plane.fixed, `${item.file} plane.fixed`);
  const slope = fin(obj(fixed.slope, "slope").value, `${item.file} slope`), az = fin(obj(fixed.azimuth, "azimuth").value, `${item.file} azimuth`);
  if (slope !== item.angle || az !== item.aspect) throw new Error(`${item.file}: PVGIS used slope ${slope} / aspect ${az}, requested ${item.angle} / ${item.aspect}`);
  if (obj(inputs.meteo_data, `${item.file} meteo_data`).radiation_db !== RAD_DATABASE) throw new Error(`${item.file}: unexpected radiation database`);
  if (item.kind === "pvcalc") {
    const months = arr(obj(outputs.monthly, "monthly").fixed, `${item.file} monthly`, 12);
    months.forEach((m, i) => { const r = obj(m, "month"); if (r.month !== i + 1) throw new Error(`${item.file}: month order`); fin(r.E_m, `${item.file} E_m`); });
    fin(obj(obj(outputs.totals, "totals").fixed, "totals.fixed").E_y, `${item.file} E_y`);
  } else {
    const rows = arr(outputs.daily_profile, `${item.file} daily_profile`, 288);
    rows.forEach((r, i) => {
      const row = obj(r, "row");
      if (row.month !== Math.floor(i / 24) + 1 || row.time !== `${String(i % 24).padStart(2, "0")}:00`) throw new Error(`${item.file}: row ${i} is out of order`);
      fin(row["G(i)"], `${item.file} G(i)`); fin(row.T2m, `${item.file} T2m`);
    });
  }
}

// ------------------------------------------------------------------ main
export type Manifest = {
  schema: "pvgis-raw/1"; apiBase: string; radiationDb: string; params: Params; paramSources: ParamSources;
  requests: (Omit<PlanItem, "query"> & { query: Record<string, string | number>; fetchedAt: string })[];
};

function parseArgs(argv: string[]) {
  const o: { force: boolean; budgetMin: number; over: Partial<Params> } = { force: false, budgetMin: 30, over: {} };
  for (const a of argv) {
    const m = /^--([a-z-]+)(?:=(.*))?$/.exec(a);
    if (!m) throw new Error(`Unknown argument ${a}`);
    const [, k, v] = m;
    if (k === "force") o.force = true;
    else if (k === "budget-min") o.budgetMin = Number(v);
    else if (k === "lat" || k === "lon" || k === "pitch" || k === "bearing" || k === "loss") o.over[k] = Number(v);
    else throw new Error(`Unknown option --${k}`);
  }
  return o;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const root = findRoot(), dir = path.join(root, RAW_DIR);
  const { params, sources } = resolveParams(args.over, root);
  console.log("parameters", JSON.stringify(params), JSON.stringify(sources));
  const plan = buildPlan(params);
  fs.mkdirSync(dir, { recursive: true });
  const oldManifest = readJsonIfExists(path.join(dir, MANIFEST_FILE)) as Manifest | null;
  const oldDates = new Map((oldManifest?.requests ?? []).map((r) => [r.file, r.fetchedAt]));
  const today = new Date().toISOString().slice(0, 10);
  const done: Manifest["requests"] = [];
  for (const item of plan) {
    const file = path.join(dir, item.file);
    const cached = readJsonIfExists(file);
    const same = oldManifest && JSON.stringify(oldManifest.requests.find((r) => r.file === item.file)?.query) === JSON.stringify(item.query);
    let fetchedAt = oldDates.get(item.file) ?? today;
    let usable = false;
    if (cached && same && !args.force) { try { validateRaw(item, cached); usable = true; } catch { usable = false; } }
    if (usable) console.log(`cached  ${item.file}`);
    else {
      console.log(`fetch   ${item.file}  (${item.endpoint}, slope ${item.angle}, aspect ${item.aspect})`);
      const { text, json, attempts } = await fetchJsonWithRetry(requestUrl(item), { budgetMs: args.budgetMin * 60_000, log: console.log });
      validateRaw(item, json);
      fs.writeFileSync(file + ".tmp", text.trim() + "\n");
      fs.renameSync(file + ".tmp", file);
      fetchedAt = today;
      if (attempts > 1) console.log(`  ok after ${attempts} attempts`);
    }
    done.push({ file: item.file, endpoint: item.endpoint, kind: item.kind, facing: item.facing, angle: item.angle, aspect: item.aspect, query: item.query, fetchedAt });
  }
  const manifest: Manifest = { schema: "pvgis-raw/1", apiBase: API_BASE, radiationDb: RAD_DATABASE, params, paramSources: sources, requests: done };
  fs.writeFileSync(path.join(dir, MANIFEST_FILE), JSON.stringify(manifest, null, 1) + "\n");
  console.log(`done: ${done.length} files in ${RAW_DIR}. Next: npx tsx scripts/build-pvgis.ts`);
}

if (/fetch-pvgis\.[cm]?[jt]s$/.test(process.argv[1] ?? "")) {
  main().catch((e) => {
    console.error(String(e instanceof Error ? e.message : e));
    if (e instanceof PvgisUnavailableError) {
      console.error("PVGIS stayed unreachable. Nothing was invented. Fallback (clearly flagged source \"model\"): npx tsx scripts/build-pvgis.ts --model");
      process.exit(2);
    }
    process.exit(1);
  });
}
