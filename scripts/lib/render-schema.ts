// Schema of model/render.json (what to shoot) and the types of generated/render-inputs.json (what the render scripts read).
// See docs/RENDER-INPUTS.md. zod 4, strict objects: a typo in render.json is an error.
import { z } from "zod";

const text = z.object({ cs: z.string().min(1), en: z.string().min(1) }).strict();
const vec3 = z.tuple([z.number(), z.number(), z.number()]);
const vec2 = z.tuple([z.number(), z.number()]);
const clock = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "time must be HH:MM");
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "date must be YYYY-MM-DD");
const size = z.tuple([z.number().int().min(64).max(8192), z.number().int().min(64).max(8192)]);
const slug = z.string().regex(/^[a-z][a-z0-9-]*$/, "id must be kebab-case");
const level = z.number().min(0).max(1);

export const cameraSchema = z
  .object({
    position: vec3,
    target: vec3,
    focalMm: z.number().min(8).max(300),
    /** Blender lens shift, fractions of the longer image side. */
    shift: vec2.optional(),
    /** Roll about the viewing axis, degrees. */
    roll: z.number().min(-45).max(45).optional(),
  })
  .strict();

/** Lamp groups of a shot: a mode, or explicit levels of the two groups. */
export const lightsRequest = z.union([
  z.enum(["auto", "on", "off"]),
  z.object({ interior: level, exterior: level }).strict(),
]);
export const blindsRequest = z.enum(["auto", "open", "closed"]);

const stepSchedule = z.object({ offAboveElevationDeg: z.number(), fullBelowElevationDeg: z.number() }).strict();
const lampBase = { kelvin: z.number().min(1800).max(6500), radiusM: z.number().min(0).max(1) };
const fixture = z
  .object({ lumens: z.number().positive(), ...lampBase, coneDeg: z.number().min(10).max(180), blend: z.number().min(0).max(1) })
  .strict();

export const renderSchema = z
  .object({
    schema: z.literal("render/1"),
    fictional: z.literal(true),
    date: isoDate,
    sensorWidthMm: z.number().positive(),
    sky: z
      .object({ model: z.enum(["SINGLE_SCATTERING", "MULTIPLE_SCATTERING"]), airDensity: z.number().positive(), aerosolDensity: z.number().min(0), ozoneDensity: z.number().min(0) })
      .strict(),
    terrain: z.object({ extentM: z.number().min(20).max(400), stepM: z.number().min(0.1).max(5) }).strict(),
    lights: z
      .object({
        schedule: z.object({ interior: stepSchedule, exterior: stepSchedule }).strict(),
        ceiling: fixture.extend({ spacingM: z.number().positive(), marginM: z.number().min(0) }).strict(),
        terrace: fixture.extend({ spacingM: z.number().positive(), marginM: z.number().min(0) }).strict(),
        wall: fixture
          .extend({
            kinds: z.record(z.string(), z.number().int().min(1).max(2)),
            height: z.number().positive(),
            offsetM: z.number().min(0),
            sideOffsetM: z.number().min(0),
          })
          .strict(),
        bollard: z
          .object({
            outdoorTypes: z.array(z.string()).min(1),
            spacingM: z.number().positive(),
            height: z.number().positive(),
            sideOffsetM: z.number().min(0),
            lumens: z.number().positive(),
            ...lampBase,
          })
          .strict(),
        decor: z.record(
          z.string(),
          z.object({ group: z.enum(["interior", "exterior"]), lumens: z.number().positive(), ...lampBase, lift: z.number().min(0).optional() }).strict(),
        ),
      })
      .strict(),
    blinds: z
      .object({
        boxDepth: z.number().positive(),
        railWidth: z.number().positive(),
        railDepth: z.number().positive(),
        slatPitch: z.number().positive(),
        slatWidth: z.number().positive(),
        slatThickness: z.number().positive(),
        standoff: z.number().min(0),
        maxDrop: z.number().min(0).max(1),
        cutoffMarginDeg: z.number().min(0).max(45),
        closedSlatAngleDeg: z.number().min(0).max(90),
      })
      .strict(),
    pv: z.object({ thicknessM: z.number().positive(), frameM: z.number().positive(), standoffM: z.number().min(0) }).strict(),
    vegetation: z
      .object({
        species: z.record(z.string(), z.object({ form: z.string().min(1), leaf: z.string().regex(/^#[0-9a-f]{6}$/i), flower: z.string().regex(/^#[0-9a-f]{6}$/i).optional() }).strict()),
      })
      .strict(),
    stills: z
      .array(
        z
          .object({
            id: slug,
            label: text,
            alt: text,
            category: z.enum(["exterior", "interior", "evening", "aerial"]),
            date: isoDate.optional(),
            time: clock,
            size,
            camera: cameraSchema,
            lights: lightsRequest,
            blinds: blindsRequest,
            notes: z.string().optional(),
          })
          .strict(),
      )
      .min(8)
      .max(10),
    day: z
      .object({
        date: isoDate.optional(),
        ranges: z.array(z.object({ from: clock, to: clock, stepMin: z.number().int().min(1) }).strict()).min(1),
        size,
        camera: cameraSchema,
        portrait: z.object({ aspect: z.tuple([z.number().int().positive(), z.number().int().positive()]), centerX: z.number().min(0).max(1) }).strict(),
        stillTime: clock,
        lights: lightsRequest,
        blinds: blindsRequest,
      })
      .strict(),
    orbit: z
      .object({
        date: isoDate.optional(),
        time: clock,
        frameCount: z.number().int().min(12),
        fps: z.number().int().min(1).max(120),
        scrollStep: z.number().int().min(1),
        targetZ: z.number(),
        startAzimuthDeg: z.number(),
        direction: z.enum(["clockwise", "counterclockwise"]),
        elevationDeg: z.number().min(0).max(80),
        focalMm: z.number().min(8).max(300),
        fitMargin: z.number().min(-0.5).max(0.4),
        radiusSlack: z.number().min(1).max(3),
        breathing: z.object({ heightM: z.number().min(0), radiusFraction: z.number().min(0).max(0.3) }).strict(),
        lights: lightsRequest,
        blinds: blindsRequest,
        variants: z
          .array(z
              .object({ id: slug, size, frameSelection: z.enum(["all", "scroll"]), focalMm: z.number().min(8).max(300).optional(), fitMargin: z.number().min(-0.5).max(0.4).optional() })
              .strict())
          .min(1),
      })
      .strict(),
    compare: z
      .object({
        id: slug,
        size,
        camera: cameraSchema,
        alt: text,
        before: z.object({ time: clock, lights: lightsRequest, blinds: blindsRequest, label: text }).strict(),
        after: z.object({ time: clock, lights: lightsRequest, blinds: blindsRequest, label: text }).strict(),
      })
      .strict(),
    og: z
      .object({ id: slug, size, time: clock, camera: cameraSchema, lights: lightsRequest, blinds: blindsRequest, alt: text })
      .strict(),
  })
  .strict();

export type RenderConfig = z.infer<typeof renderSchema>;
export type CameraSpec = z.infer<typeof cameraSchema>;
export type LightsRequest = z.infer<typeof lightsRequest>;
export type BlindsRequest = z.infer<typeof blindsRequest>;
export type Vec3 = [number, number, number];
export type Vec2 = [number, number];

/** Parses model/render.json; throws a readable error listing every problem. */
export function parseRenderConfig(raw: unknown): RenderConfig {
  const r = renderSchema.safeParse(raw);
  if (r.success) return r.data;
  const lines = r.error.issues.map((i) => `  ${i.path.join(".") || "(root)"}: ${i.message}`);
  throw new Error(`model/render.json is invalid:\n${lines.join("\n")}`);
}
