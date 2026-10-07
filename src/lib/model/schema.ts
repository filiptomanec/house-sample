// The single definition of the house/1 data model (zod 4). `model/house.schema.json` is exported from this file
// (`houseJsonSchema()`); TypeScript types are inferred from it (see types.ts).
import { z } from "zod";
import {
  CAMERA_USES,
  DIRS,
  FLOORS,
  FURNITURE_TYPES,
  LAYER_ROLES,
  OPENING_KINDS,
  OUTDOOR_TYPES,
  ROOM_ROLES,
  ROOM_TYPES,
  SCHEMA_ID,
} from "./catalog";

const num = z.number();
const pos = z.number().positive();
const nonneg = z.number().min(0);
const share = z.number().min(0).max(1);
const id = z.string().min(1);
const text = z.strictObject({ cs: z.string().min(1), en: z.string().min(1) });
const pt = z.tuple([num, num]);
const pt3 = z.tuple([num, num, num]);
const rect = z.tuple([num, num, num, num]);
const orient = z.enum(["h", "v"]);
const sign = z.enum(["+", "-"]);

export const LocalizedTextSchema = text;

// ------------------------------------------------------------------ plan (concept/1 keys)
export const RoomSchema = z.strictObject({
  id,
  name: text,
  type: z.enum(ROOM_TYPES),
  role: z.enum(ROOM_ROLES).optional(),
  floor: z.enum(FLOORS).optional(),
  /** Rectangles between wall axes; together they exactly tile the floor plan. */
  rects: z.array(rect).min(1),
});

export const OpeningSchema = z
  .strictObject({
    id,
    kind: z.enum(OPENING_KINDS),
    orient,
    /** Centre of the opening on the wall axis. */
    cx: num,
    cy: num,
    w: pos,
    sill: num,
    head: num,
    swing: sign.optional(),
    hinge: sign.optional(),
  })
  .superRefine((o, ctx) => {
    if (o.kind !== "door" && o.kind !== "entry") return;
    for (const k of ["swing", "hinge"] as const) {
      if (o[k] === undefined) ctx.addIssue({ code: "custom", path: [k], message: `required for kind "${o.kind}" ("+" or "-")` });
    }
  });

export const RoofSchema = z.strictObject({
  id,
  /** Outer faces of the walls the hip roof covers. */
  rect,
  /** Pitch in degrees. */
  pitch: z.number().gt(0).max(70),
  overhang: z.number().min(0).max(3).optional(),
  wallTop: pos.optional(),
});

export const OutdoorSchema = z.strictObject({
  id,
  type: z.enum(OUTDOOR_TYPES),
  covered: z.boolean().optional(),
  rect,
  posts: z.array(pt).optional(),
});

export const AccentSchema = z.strictObject({ id, type: z.literal("wood"), orient, cx: num, cy: num, w: pos });

export const FurnitureSchema = z.strictObject({
  type: z.enum(FURNITURE_TYPES),
  x: num,
  y: num,
  rot: z.union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)]),
  w: pos.optional(),
  d: pos.optional(),
});

export const ScreenSchema = z.discriminatedUnion("orient", [
  z.strictObject({ id, type: z.literal("slats"), orient: z.literal("v"), cx: num, y0: num, y1: num }),
  z.strictObject({ id, type: z.literal("slats"), orient: z.literal("h"), cy: num, x0: num, x1: num }),
]);

// ------------------------------------------------------------------ extensions of house/1
export const LocationSchema = z.strictObject({
  region: text,
  /** Rounded to 0.1 degree on purpose (privacy; the validator enforces it). */
  lat: z.number().min(-90).max(90),
  lon: z.number().min(-180).max(180),
  /** Metres above sea level. */
  elevation: num,
  /** IANA time zone. */
  tz: z.string().min(1),
  /** Azimuth (clockwise from true north) of the house +y axis. */
  houseAxisBearingDeg: z.number().min(0).lt(360),
});

const zoneOf = <T extends z.ZodType>(types: T) => z.strictObject({ label: text, types: z.array(types) });
export const ZonesSchema = z.strictObject({
  day: zoneOf(z.enum(ROOM_TYPES)),
  night: zoneOf(z.enum(ROOM_TYPES)),
  service: zoneOf(z.enum(ROOM_TYPES)),
  outdoor: zoneOf(z.enum(OUTDOOR_TYPES)),
});

export const LayerSchema = z
  .strictObject({
    id,
    name: text,
    /** Thickness, m. */
    t: pos,
    /** Thermal conductivity, W/(m K). Give either `lambda` or `r`. */
    lambda: pos.optional(),
    /** Fixed thermal resistance, m2 K/W (air gaps, membranes). */
    r: nonneg.optional(),
    role: z.enum(LAYER_ROLES).optional(),
    /** A ventilated layer: layers outside it are ignored and Rse is replaced by Rsi (EN ISO 6946). */
    ventilated: z.boolean().optional(),
  })
  .refine((l) => (l.lambda === undefined) !== (l.r === undefined), { message: 'give exactly one of "lambda" and "r"' });

export const AssemblySchema = z.strictObject({
  name: text,
  /** Surface resistances, m2 K/W. */
  rsi: nonneg,
  rse: nonneg,
  /** Layers listed from the outside to the inside of the heated volume (for the floor: from the ground upwards). */
  layers: z.array(LayerSchema).min(1),
});

export const AssembliesSchema = z.strictObject({
  exteriorWall: AssemblySchema,
  bearingWall: AssemblySchema,
  partitionWall: AssemblySchema,
  ceiling: AssemblySchema,
  roof: AssemblySchema,
  groundFloor: AssemblySchema,
});

const glazingSpec = z.strictObject({ Uw: pos, g: share, frameShare: share });
export const WindowsSchema = z.strictObject({
  /** Whole-window U-value, W/(m2 K). */
  Uw: pos,
  /** Glazing U-value. */
  Ug: pos,
  /** Total solar energy transmittance of the glazing. */
  g: share,
  /** Share of the frame in the window area. */
  frameShare: share,
  /** U-value of opaque doors (entry, garage door). */
  Ud: pos,
  /** Optional override for sliding walls. */
  slider: glazingSpec.optional(),
});

export const PvSchema = z.strictObject({
  /** Module data: rated power (Wp) and outer size (m, at least 0.1). */
  module: z.strictObject({ name: text, wp: pos, width: z.number().min(0.1), height: z.number().min(0.1) }),
  layout: z.strictObject({
    /** House-frame directions (N/E/S/W) of the roof planes that carry modules. */
    facings: z.array(z.enum(DIRS)).min(1),
    orientation: z.enum(["portrait", "landscape", "auto"]),
    /** Gap between modules, m. */
    gap: nonneg,
    /** Distance of the array from roof edges of each kind, m. */
    setback: z.strictObject({ eave: nonneg, ridge: nonneg, hip: nonneg, valley: nonneg, step: nonneg }),
    /** Clearance around roof penetrations (light pipes), m. */
    obstacleClearance: nonneg,
  }),
  inverter: z.strictObject({ ratedKw: pos }),
});

export const BatterySchema = z.strictObject({
  options: z.array(z.strictObject({ id, name: text, capacityKwh: nonneg, powerKw: nonneg })).min(1),
  default: id,
});

export const HeatingSchema = z.strictObject({
  type: z.enum(["air-water-heat-pump", "ground-water-heat-pump", "electric-panels"]),
  name: text,
  ratedPowerKw: pos,
  /** Seasonal coefficient of performance for space heating / for domestic hot water. */
  scop: pos,
  scopDhw: pos,
  emission: z.enum(["underfloor", "radiators"]),
  flowTemperatureC: pos,
  dhw: z.strictObject({ tankLiters: pos, setpointC: pos }),
});

export const VentilationSchema = z.strictObject({
  type: z.enum(["mvhr", "extract-only", "natural"]),
  name: text,
  /** Heat recovery efficiency (0..1). */
  heatRecoveryEfficiency: share,
  nominalAirflowM3h: pos,
  /** Specific fan power, W per m3/h. */
  specificFanPower: pos,
});

export const EquipmentSchema = z.strictObject({ pv: PvSchema, battery: BatterySchema, heating: HeatingSchema, ventilation: VentilationSchema });

export const ShadingSchema = z.strictObject({
  blinds: z.strictObject({
    type: z.enum(["external-venetian", "external-screen"]),
    name: text,
    /** Which openings get a blind: kinds and a range of TRUE azimuth (clockwise from north, from -> to). */
    kinds: z.array(z.enum(["window", "slider"])).min(1),
    azimuthFrom: z.number().min(0).max(360),
    azimuthTo: z.number().min(0).max(360),
    /** Height of the blind box above the head of the opening, m. */
    boxHeight: pos,
    /** Multiplier of the solar gain with the blind closed (g_tot / g). */
    closedFactor: share,
    /** The blind closes when the irradiance on the facade exceeds this, W/m2. */
    closeAboveIrradiance: pos,
  }),
  /** Style of the fixed `screens` of type "slats". */
  slats: z.strictObject({ pitch: pos, width: pos, depth: pos }),
});

export const RoofExtrasSchema = z.strictObject({
  covering: z.strictObject({ type: z.enum(["standing-seam-steel", "clay-tile", "concrete-tile"]), name: text }),
  /** Parameters of the light pipes listed in `lightpipes`. */
  lightpipes: z.strictObject({ diameter: pos, domeHeight: pos }),
  downpipes: z.array(z.strictObject({ x: num, y: num, diameter: pos })),
  /** Snow guards over openings of these kinds. */
  snowGuards: z.strictObject({ aboveOpeningKinds: z.array(z.enum(OPENING_KINDS)) }),
});

export const CameraSchema = z
  .strictObject({
    id,
    name: text,
    kind: z.enum(["perspective", "orthographic"]),
    /** House frame, metres. */
    position: pt3,
    target: pt3,
    /** Vertical field of view in degrees (perspective). */
    fov: z.number().min(5).max(120).optional(),
    /** Visible height in metres (orthographic). */
    orthoHeight: pos.optional(),
    use: z.array(z.enum(CAMERA_USES)).min(1),
  })
  .superRefine((c, ctx) => {
    if (c.kind === "perspective" && c.fov === undefined) ctx.addIssue({ code: "custom", path: ["fov"], message: 'required for a perspective camera' });
    if (c.kind === "orthographic" && c.orthoHeight === undefined) ctx.addIssue({ code: "custom", path: ["orthoHeight"], message: 'required for an orthographic camera' });
  });

// ------------------------------------------------------------------ the house
export const HouseSchema = z.strictObject({
  schema: z.literal(SCHEMA_ID),
  id,
  name: text,
  idea: text.optional(),
  fictional: z.literal(true),
  location: LocationSchema,
  wall: z.strictObject({ ext: pos.max(1.5), bearing: pos.max(1.5), part: pos.max(1.5) }),
  clearHeight: z.number().min(2).max(5),
  slab: z.number().min(0).max(1.5),
  bearingAxes: z.strictObject({ x: z.array(num), y: z.array(num) }),
  rooms: z.array(RoomSchema).min(1),
  zones: ZonesSchema,
  openings: z.array(OpeningSchema),
  roofs: z.array(RoofSchema),
  outdoor: z.array(OutdoorSchema),
  accents: z.array(AccentSchema),
  furniture: z.array(FurnitureSchema),
  lightpipes: z.array(pt),
  screens: z.array(ScreenSchema),
  assemblies: AssembliesSchema,
  windows: WindowsSchema,
  equipment: EquipmentSchema,
  shading: ShadingSchema,
  roof: RoofExtrasSchema,
  cameras: z.array(CameraSchema),
  notes: z.record(z.string().min(1), text),
});

/** JSON Schema (draft 2020-12) of house/1, exported to `model/house.schema.json`. */
export function houseJsonSchema(): Record<string, unknown> {
  const js = z.toJSONSchema(HouseSchema, { io: "input" }) as Record<string, unknown>;
  return {
    ...js,
    title: "house/1",
    description: "Data model of the House Sample project (superset of concept/1). Exported from src/lib/model/schema.ts; do not edit by hand.",
  };
}
