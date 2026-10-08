// The zod schema of `model/assumptions.json` (format `assumptions/1`). It lives apart from energy.ts on purpose: energy.ts is
// loaded by the browser (the Energy page runs the calculation there) and imports only the *type* `Assumptions` from here, so the
// validator (zod, about 100 KB gzipped) stays out of the page's bundle. Tests, scripts and the server may import the schema.
import { z } from "zod";
import { ROOM_TYPES } from "@/lib/model/catalog";
import { DAY_TYPE_KEYS, NUMERIC_INPUT_KEYS, type NumericInputKey } from "./energy";

const share = z.number().min(0).max(1);
const positive = z.number().positive();
const hour = z.int().min(0).max(23);
const profile24 = z.array(z.number().min(0)).length(24);

/** Range of one input. `default` is optional: `scop`, `scopDhw` take their default from the model's `equipment.heating`. */
export const InputRangeSchema = z
  .strictObject({ default: z.number().optional(), min: z.number(), max: z.number(), step: positive })
  .refine((r) => r.min < r.max && (r.default === undefined || (r.default >= r.min && r.default <= r.max)), { message: "need min < max and min <= default <= max" });

const inputsShape = Object.fromEntries(NUMERIC_INPUT_KEYS.map((k) => [k, InputRangeSchema])) as Record<NumericInputKey, typeof InputRangeSchema>;

/**
 * Schema of `model/assumptions.json` (format `assumptions/1`). Every number the calculation needs that is neither in the house
 * model nor in the climate data nor a physical/normative constant (those are named constants in the code with the standard
 * quoted) lives here. The energy agent fills in and reviews the values; `meta.status` says whether anybody has.
 */
export const AssumptionsSchema = z
  .strictObject({
    schema: z.literal("assumptions/1"),
    meta: z.strictObject({
      /** "starter": generic placeholder values; "reviewed": checked against the cited sources. */
      status: z.enum(["starter", "reviewed"]),
      region: z.string().min(1),
      currency: z.literal("CZK"),
      /** Year of the prices. */
      priceYear: z.int(),
      /** Where the numbers come from (standards, statistics); shown on the Energy page's "what is calculated" panel. */
      sources: z.array(z.string().min(1)),
    }),
    climate: z.strictObject({
      /** Calendar year used for time-zone rules (daylight saving) of the typical year. */
      referenceYear: z.int(),
      /** Outdoor design temperature of EN 12831 for the region, deg C. */
      designOutdoorC: z.number(),
    }),
    /** Ranges and defaults of the adjustable inputs. */
    inputs: z.strictObject({
      ...inputsShape,
      /** Defaults of the switches. Heat recovery defaults to the model (`ventilation.type === "mvhr"`). */
      flags: z.strictObject({ evChargeDaytime: z.boolean(), dhwDaytime: z.boolean() }),
    }),
    thermal: z.strictObject({
      /** Allowance for thermal bridges, W/(m2 K), added to the area of the envelope that borders the outside air. */
      thermalBridgeDeltaU: z.number().min(0),
      /** Internal heat capacity per m2 of heated floor, kJ/(m2 K) (EN ISO 13790, 12.3.1: light 80, medium 165, heavy 260...; masonry with a concrete ceiling and screed is heavy). */
      internalHeatCapacityKjPerM2K: positive,
      /** Reference time constant a0 of the utilisation factor, hours (15 for the monthly method). */
      utilisationReferenceTimeH: positive,
      /** Volumetric heat capacity of air, Wh/(m3 K). */
      airHeatCapacityWhPerM3K: positive,
      /** Reduction for the angle of incidence and dirt of glazing (about 0.9). */
      solarCorrection: share,
      /** Share of the irradiation on a vertical facade that is direct (the roof overhang and the blinds act on this part only). */
      verticalBeamShare: share,
      /** Temperature reduction factor b (EN ISO 13789) of a heated room's wall to an unheated room of that type. */
      unheatedB: z.partialRecord(z.enum(ROOM_TYPES), share),
      /**
       * Temperature reduction factor b of the ceiling under a cold, ventilated roof space (`roof.attic === "cold"`; EN ISO 13789:
       * about 0.9 for a ventilated roof space with a membrane under the covering).
       */
      atticB: share,
      /** U-value of a door between a heated and an unheated room (a fire-rated door to the garage), W/(m2 K). */
      doorToUnheatedU: positive,
    }),
    ground: z.strictObject({
      /** Thermal conductivity of the soil, W/(m K) (EN ISO 13370: 2.0 for sand or gravel, the default for unknown soil; clay or silt 1.5). */
      soilLambda: positive,
      /** Periodic penetration depth, m (3.2 for sand or gravel; clay or silt 2.2). */
      periodicDepthM: positive,
      /** Correction for the annual outdoor temperature variation in the design load (EN 12831 f_g1, about 1.45). */
      fg1: positive,
    }),
    ventilation: z.strictObject({
      /** Shielding coefficient e for infiltration: n_inf = e * n50 (EN ISO 13789 / 13790, 0.07 for moderate shielding). */
      shielding: positive,
      /** Hygienic fresh air per person, m3/h, and the minimum air change rate of the building, 1/h. */
      airflowPerPersonM3h: positive,
      minAirChangeRate: positive,
    }),
    gains: z.strictObject({
      /** Metabolic heat per person, W (averaged over presence), and the share of household electricity that becomes heat. */
      personW: positive,
      applianceHeatShare: share,
    }),
    ev: z.strictObject({
      /** Electricity per km driven, kWh/km, and the share lost in charging. */
      kwhPerKm: positive,
      chargingLossShare: z.number().min(0).max(0.5),
    }),
    /**
     * Electricity of a pool of the model (an outdoor area of type `pool`): its own row, never part of the house's heat demand.
     * In the months of the season the filtration pump runs `filtrationHoursPerDay` at `filtrationKw` (per pool), and the pool heat
     * pump uses `heatPumpKwhPerM2Season` per m2 of water surface over the season, spread by days. Both run at `hours` (local).
     */
    pool: z.strictObject({
      /** 0-based months of the swimming season. */
      seasonMonths: z.array(z.int().min(0).max(11)).min(1),
      filtrationKw: z.number().min(0),
      filtrationHoursPerDay: z.number().min(0).max(24),
      heatPumpKwhPerM2Season: z.number().min(0),
      hours: z.array(hour).min(1),
    }),
    heating: z.strictObject({
      /** Losses of distribution and storage as a share of the heat need. */
      distributionLossShare: z.number().min(0).max(0.5),
      /**
       * COP by month follows the Carnot ratio between a sink at `flowTemperatureC + sinkApproachK` and a source at the monthly
       * outdoor temperature `- sourceApproachK`; its efficiency factor is solved so that the heat-weighted seasonal COP equals
       * the SCOP input exactly.
       */
      copCurve: z.strictObject({ sinkApproachK: z.number().min(0), sourceApproachK: z.number().min(0) }),
      /**
       * Output of the heat pump at the design outdoor temperature (A-12/W35) as a share of its nominal rating
       * (`equipment.heating.ratedPowerKw`, A7/W35); the coverage of the design load uses this output.
       */
      designCapacityShare: z.number().positive().max(1.5),
    }),
    dhw: z.strictObject({
      coldWaterC: z.number(),
      /** Losses of storage and circulation as a share of the useful energy. */
      lossShare: z.number().min(0).max(1),
      /** Local hours (0..23) when the heat pump heats the water: daytime (follows PV) or default (morning and evening). */
      daytimeHours: z.array(hour).min(1),
      defaultHours: z.array(hour).min(1),
    }),
    profiles: z.strictObject({
      /** Relative shape of the household electricity over the day (24 values, normalised by the code). */
      appliances: profile24,
      evDaytimeHours: z.array(hour).min(1),
      evNightHours: z.array(hour).min(1),
      /** Share of the daily heating electricity spread evenly; the rest follows degree-hours. */
      heatingBaseShare: share,
    }),
    pv: z.strictObject({
      /**
       * Typical days of a month: production relative to the monthly mean day (`factor`) and the share of days (`weight`).
       * Weights sum to 1 and the weighted mean of the factors is 1 (checked), so the month total is the PVGIS value.
       */
      dayTypes: z
        .array(z.strictObject({ key: z.enum(DAY_TYPE_KEYS), factor: z.number().min(0), weight: share }))
        .length(DAY_TYPE_KEYS.length),
      /** Clip the production at the inverter's rated power (`equipment.pv.inverter.ratedKw`). */
      inverterClipping: z.boolean(),
    }),
    battery: z.strictObject({
      /** Usable share of the nominal capacity and round-trip efficiency (the half of the losses on each way). */
      usableShare: share,
      roundTripEfficiency: share,
    }),
    economy: z.strictObject({
      /** A payback longer than this is reported as "does not pay back" (status key), years. */
      paybackCapYears: positive,
      /**
       * Fixed charges of the household connection per year, CZK with VAT (supplier's monthly fee, the distributor's charge for the
       * circuit breaker). They are paid with and without PV, so they raise both annual costs and leave the saving unchanged; they
       * keep the bill of a big PV system from falling below what a connected household always pays.
       */
      fixedChargesPerYear: z.number().min(0),
      /** Life of the PV system (modules, mounting) and of the battery, years: a payback beyond it has the status "beyondLife". */
      pvLifeYears: positive,
      batteryLifeYears: positive,
      /** Yearly loss of PV output (0.005 = 0.5 % a year); the savings of later years shrink with it. */
      pvDegradationPerYear: z.number().min(0).max(0.05),
      /** One replacement of the inverter in `year` (1-based), costing `shareOfPvInvestment` of the gross PV price. */
      inverterReplacement: z.strictObject({ year: z.int().min(1), shareOfPvInvestment: share }),
    }),
  })
  .superRefine((a, ctx) => {
    const dt = a.pv.dayTypes;
    const keys = new Set(dt.map((d) => d.key));
    const w = dt.reduce((s, d) => s + d.weight, 0);
    const mean = dt.reduce((s, d) => s + d.weight * d.factor, 0);
    if (keys.size !== dt.length) ctx.addIssue({ code: "custom", path: ["pv", "dayTypes"], message: "day type keys must be unique" });
    if (Math.abs(w - 1) > 0.005) ctx.addIssue({ code: "custom", path: ["pv", "dayTypes"], message: "weights must sum to 1" });
    if (Math.abs(mean - 1) > 0.01) ctx.addIssue({ code: "custom", path: ["pv", "dayTypes"], message: "the weighted mean of the factors must be 1" });
  });

export type Assumptions = z.infer<typeof AssumptionsSchema>;

/** Parses and validates `model/assumptions.json`; throws a ZodError with a readable path on a bad file. */
export function parseAssumptions(json: unknown): Assumptions {
  return AssumptionsSchema.parse(json);
}
