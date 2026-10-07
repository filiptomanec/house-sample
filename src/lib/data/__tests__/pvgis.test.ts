// Shape, ranges and provenance of src/lib/data/pvgis.json, plus the scripts that produce it (offline: no network).
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import pvgisJson from "../pvgis.json";
import { DAYS, assemble, checkRanges, modelData, pvgisSchema, serialize, type PvgisData } from "../../../../scripts/build-pvgis";
import {
  FACINGS, HOUSE_AZIMUTH, MANIFEST_FILE, PvgisRequestError, PvgisUnavailableError, RAW_DIR, buildPlan, fetchJsonWithRetry, findRoot,
  makeLimiter, pvgisAspect, requestUrl, resolveParams, trueAzimuth, type HttpResponse,
} from "../../../../scripts/fetch-pvgis";

const root = findRoot();
const rawDir = path.join(root, RAW_DIR);
const data: PvgisData = pvgisSchema.parse(pvgisJson);
const sum = (a: number[]) => a.reduce((s, v) => s + v, 0);
const argmax = (a: number[]) => a.indexOf(Math.max(...a));
const mean = (a: number[]) => sum(a) / a.length;

describe("pvgis.json shape", () => {
  it("matches the pvgis/1 schema", () => {
    expect(data.schema).toBe("pvgis/1");
    expect(["pvgis", "model"]).toContain(data.source);
  });

  it("has 12 months for every per-facing series and 24 hourly values per month", () => {
    for (const f of FACINGS) {
      expect(data.monthly[f]).toHaveLength(12);
      expect(data.vertical[f]).toHaveLength(12);
      expect(data.profileUTC[f]).toHaveLength(12);
      for (const row of data.profileUTC[f]) expect(row).toHaveLength(24);
    }
    expect(data.tempUTC).toHaveLength(12);
    for (const row of data.tempUTC) expect(row).toHaveLength(24);
  });

  it("serialises to exactly the committed bytes (stable formatting)", () => {
    expect(JSON.parse(serialize(data))).toEqual(data);
    expect(fs.readFileSync(path.join(root, "src/lib/data/pvgis.json"), "utf8")).toBe(serialize(data) + "\n");
  });
});

describe("pvgis.json values", () => {
  it("passes the physical range checks", () => {
    expect(checkRanges(data)).toEqual([]);
  });

  it("yields 1000-1250 kWh/kWp a year on the facing closest to south", () => {
    const best = [...FACINGS].sort((a, b) => Math.abs(data.facings[a].pvgisAspect) - Math.abs(data.facings[b].pvgisAspect))[0];
    expect(data.yearly[best]).toBeGreaterThanOrEqual(1000);
    expect(data.yearly[best]).toBeLessThanOrEqual(1250);
  });

  it("sums the months to the year", () => {
    for (const f of FACINGS) expect(Math.abs(sum(data.monthly[f]) - data.yearly[f])).toBeLessThan(0.25);
  });

  it("orders yields by orientation: south > east/west > north", () => {
    const y = data.yearly;
    expect(y.S).toBeGreaterThan(Math.max(y.E, y.W));
    expect(Math.min(y.E, y.W)).toBeGreaterThan(y.N);
    const v = data.vertical;
    expect(sum(v.S)).toBeGreaterThan(Math.max(sum(v.E), sum(v.W)));
    expect(Math.min(sum(v.E), sum(v.W))).toBeGreaterThan(sum(v.N));
  });

  it("has summer yields above winter yields and dark nights", () => {
    for (const f of FACINGS) {
      expect(data.monthly[f][5]).toBeGreaterThan(data.monthly[f][11]);
      for (const m of [5, 11]) for (const h of [21, 22, 23, 0]) expect(data.profileUTC[f][m][h]).toBe(0);
    }
  });

  it("puts the daily peak of the east plane before the south plane and the west plane after it (June)", () => {
    const peak = (f: "N" | "E" | "S" | "W") => argmax(data.profileUTC[f][5]);
    expect(peak("E")).toBeLessThan(peak("S"));
    expect(peak("S")).toBeLessThanOrEqual(peak("W"));
    expect(peak("E")).toBeLessThan(peak("W"));
  });

  it("has plausible temperatures", () => {
    const monthMean = data.tempUTC.map(mean);
    expect(monthMean[0]).toBeLessThan(monthMean[6]);
    expect(Math.min(...monthMean)).toBeGreaterThan(-10);
    expect(Math.max(...monthMean)).toBeLessThan(28);
    const july = data.tempUTC[6];
    expect(argmax(july)).toBeGreaterThanOrEqual(10);
    expect(argmax(july)).toBeLessThanOrEqual(16);
    expect(Math.max(...july)).toBeGreaterThan(Math.min(...july) + 3);
  });

  it("the range check can fail (sanity of the check itself)", () => {
    const bad = structuredClone(data);
    bad.yearly.S = 5000;
    bad.tempUTC[0][3] = 80;
    expect(checkRanges(bad).length).toBeGreaterThanOrEqual(2);
  });

  it("uses a calendar with 365 days", () => {
    expect(sum(DAYS)).toBe(365);
  });
});

describe("orientation and parameters", () => {
  it("converts true azimuths to PVGIS aspects (0 = south, +90 = west, -90 = east)", () => {
    expect(pvgisAspect(192)).toBe(12);
    expect(pvgisAspect(282)).toBe(102);
    expect(pvgisAspect(12)).toBe(-168);
    expect(pvgisAspect(102)).toBe(-78);
    expect(pvgisAspect(180)).toBe(0);
    expect(pvgisAspect(90)).toBe(-90);
    expect(pvgisAspect(270)).toBe(90);
    expect(pvgisAspect(0)).toBe(180);
    expect(pvgisAspect(360 + 192)).toBe(12);
  });

  it("derives the four plane directions from the house axis bearing", () => {
    for (const f of FACINGS) {
      const az = (HOUSE_AZIMUTH[f] + data.houseAxisBearingDeg) % 360;
      expect(trueAzimuth(f, data.houseAxisBearingDeg)).toBe(az);
      expect(data.facings[f].azimuthDeg).toBe(az);
      expect(data.facings[f].pvgisAspect).toBe(pvgisAspect(az));
      expect(data.facings[f].houseAzimuthDeg).toBe(HOUSE_AZIMUTH[f]);
    }
  });

  it("is consistent with the house model (pitch, axis bearing, rounded position) when model files exist", () => {
    const { params } = resolveParams({}, root);
    expect(data.slope).toBe(params.pitch);
    expect(data.houseAxisBearingDeg).toBe(params.bearing);
    expect(data.meta.lat).toBe(params.lat);
    expect(data.meta.lon).toBe(params.lon);
  });

  it("keeps the published position rounded to 0.1 degree", () => {
    for (const v of [data.meta.lat, data.meta.lon]) expect(Math.abs(v * 10 - Math.round(v * 10))).toBeLessThan(1e-9);
  });

  it("plans 12 requests with the right slopes and aspects", () => {
    const plan = buildPlan({ lat: 49.2, lon: 16.6, pitch: 22, bearing: 12, loss: 14 });
    expect(plan).toHaveLength(12);
    const key = (kind: string, f: string) => plan.find((p) => p.kind === kind && p.facing === f)!;
    for (const [f, aspect] of [["S", 12], ["W", 102], ["N", -168], ["E", -78]] as const) {
      expect(key("pvcalc", f)).toMatchObject({ angle: 22, aspect, endpoint: "PVcalc" });
      expect(key("dr-roof", f)).toMatchObject({ angle: 22, aspect, endpoint: "DRcalc" });
      expect(key("dr-vertical", f)).toMatchObject({ angle: 90, aspect, endpoint: "DRcalc" });
    }
    const url = requestUrl(key("pvcalc", "S"));
    expect(url.startsWith("https://re.jrc.ec.europa.eu/api/v5_3/PVcalc?")).toBe(true);
    expect(url).toContain("raddatabase=PVGIS-SARAH3");
    expect(new Set(plan.map((p) => p.file)).size).toBe(12);
  });
});

describe.skipIf(!fs.existsSync(path.join(rawDir, MANIFEST_FILE)))("raw PVGIS responses", () => {
  it("rebuild to exactly the committed pvgis.json (deterministic, idempotent)", () => {
    const a = assemble(rawDir), b = assemble(rawDir);
    expect(serialize(a)).toBe(serialize(b));
    if (data.source === "pvgis") expect(serialize(a) + "\n").toBe(fs.readFileSync(path.join(root, "src/lib/data/pvgis.json"), "utf8"));
  });

  it("carry only the rounded fictional position", () => {
    for (const file of fs.readdirSync(rawDir).filter((f) => /^(pvcalc|dr|dr90)-[NESW]\.json$/.test(f))) {
      const loc = (JSON.parse(fs.readFileSync(path.join(rawDir, file), "utf8")) as { inputs: { location: { latitude: number; longitude: number } } }).inputs.location;
      for (const v of [loc.latitude, loc.longitude]) expect(Math.abs(v * 10 - Math.round(v * 10))).toBeLessThan(1e-9);
    }
  });

  it("record the database in the metadata", () => {
    if (data.source !== "pvgis") return;
    expect(data.meta.radiationDb).toMatch(/^PVGIS-(SARAH3|ERA5)$/);
    expect(data.meta.years?.[0]).toBeLessThan(data.meta.years?.[1] ?? 0);
    expect(data.meta.retrieved).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe("offline fallback model", () => {
  const params = { lat: 49.2, lon: 16.6, pitch: 22, bearing: 12, loss: 14 };
  const model = modelData(params);

  it("is flagged as a model, valid and deterministic", () => {
    expect(model.source).toBe("model");
    expect(pvgisSchema.safeParse(model).success).toBe(true);
    expect(checkRanges(model)).toEqual([]);
    expect(serialize(modelData(params))).toBe(serialize(model));
  });

  it("gives plausible yields (1000-1250 kWh/kWp towards the south) and the same orientation order", () => {
    expect(model.yearly.S).toBeGreaterThanOrEqual(1000);
    expect(model.yearly.S).toBeLessThanOrEqual(1250);
    expect(model.yearly.S).toBeGreaterThan(Math.max(model.yearly.E, model.yearly.W));
    expect(Math.min(model.yearly.E, model.yearly.W)).toBeGreaterThan(model.yearly.N);
    expect(argmax(model.profileUTC.E[5])).toBeLessThan(argmax(model.profileUTC.W[5]));
  });
});

describe("fetchJsonWithRetry", () => {
  const ok = (body: string): HttpResponse => ({ status: 200, headers: { get: () => null }, text: async () => body });
  const status = (code: number, body = "", retryAfter?: string): HttpResponse => ({ status: code, headers: { get: (n) => (n === "retry-after" ? (retryAfter ?? null) : null) }, text: async () => body });
  const clock = () => {
    const c = { t: 0, sleeps: [] as number[] };
    return { c, now: () => c.t, sleep: async (ms: number) => { c.sleeps.push(ms); c.t += ms; } };
  };

  it("retries transient failures with exponential backoff and then succeeds", async () => {
    const { c, now, sleep } = clock();
    const replies: (HttpResponse | Error)[] = [new TypeError("fetch failed"), status(529), status(503, "", "10"), ok('{"outputs":{}}')];
    let calls = 0;
    const res = await fetchJsonWithRetry("https://example.test/x", {
      now, sleep, minGapMs: 0, fetchFn: async () => { const r = replies[calls++]; if (r instanceof Error) throw r; return r; },
    });
    expect(res.attempts).toBe(4);
    expect(res.json).toEqual({ outputs: {} });
    expect(c.sleeps.filter((ms) => ms > 0)).toEqual([2000, 4000, 10000]);
  });

  it("retries a broken JSON body", async () => {
    const { now, sleep } = clock();
    const replies = [ok('{"outputs":'), ok('{"a":1}')];
    let calls = 0;
    const res = await fetchJsonWithRetry("https://example.test/x", { now, sleep, minGapMs: 0, fetchFn: async () => replies[calls++] });
    expect(res.json).toEqual({ a: 1 });
  });

  it("does not retry a client error", async () => {
    const { now, sleep } = clock();
    let calls = 0;
    await expect(fetchJsonWithRetry("https://example.test/x", { now, sleep, minGapMs: 0, fetchFn: async () => { calls++; return status(400, '{"message":"bad"}'); } })).rejects.toBeInstanceOf(PvgisRequestError);
    expect(calls).toBe(1);
  });

  it("gives up when the time budget is spent", async () => {
    const { c, now, sleep } = clock();
    await expect(fetchJsonWithRetry("https://example.test/x", {
      now, sleep, minGapMs: 0, budgetMs: 30 * 60_000, fetchFn: async () => { throw new TypeError("fetch failed"); },
    })).rejects.toBeInstanceOf(PvgisUnavailableError);
    expect(c.t).toBeLessThanOrEqual(30 * 60_000);
    expect(c.t).toBeGreaterThan(20 * 60_000); // kept trying for most of the 30 minutes
    expect(Math.max(...c.sleeps)).toBeLessThanOrEqual(120_000);
  });

  it("spaces request starts by at least 250 ms", async () => {
    const { now, sleep } = clock();
    const limiter = makeLimiter(250, now, sleep);
    const starts: number[] = [];
    for (let i = 0; i < 5; i++) { await limiter(); starts.push(now()); }
    for (let i = 1; i < starts.length; i++) expect(starts[i] - starts[i - 1]).toBeGreaterThanOrEqual(250);
  });
});
