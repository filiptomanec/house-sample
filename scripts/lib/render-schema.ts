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
const focal = z.number().min(8).max(300);
const angle90 = z.number().min(0).max(90);

/**
 * A camera. `position` is `[x, y, z]` in the house frame, or `[x, y]` together with `aboveGround` (the eye height above the
 * graded terrain, resolved with `groundAt`). `level` (default: true for a camera less than `LEVEL_BELOW_M` above the ground)
 * keeps the viewing axis horizontal and moves the target into place with the vertical lens shift, so verticals stay vertical;
 * `shift` is added on top of that.
 */
export const cameraSchema = z
  .object({
    position: z.union([vec3, vec2]),
    aboveGround: z.number().min(0.3).max(80).optional(),
    target: vec3,
    focalMm: focal,
    /** Blender lens shift, fractions of the longer image side (added to the shift of a level camera). */
    shift: vec2.optional(),
    /** Roll about the viewing axis, degrees. */
    roll: z.number().min(-45).max(45).optional(),
    level: z.boolean().optional(),
  })
  .strict()
  .superRefine((c, ctx) => {
    if (c.aboveGround !== undefined && c.position.length !== 2) ctx.addIssue({ code: "custom", message: "with aboveGround the position is [x, y]" });
    if (c.aboveGround === undefined && c.position.length !== 3) ctx.addIssue({ code: "custom", message: "the position is [x, y, z] (or [x, y] with aboveGround)" });
  });

/** Cameras lower than this above the ground are level unless `level: false`. */
export const LEVEL_BELOW_M = 5;

/** Lamp groups of a shot: a mode, or explicit levels of the two groups. */
export const lightsRequest = z.union([
  z.enum(["auto", "on", "off"]),
  z.object({ interior: level, exterior: level }).strict(),
]);
/** External blinds of a shot: the rule (`auto`), raised, lowered with closed slats, or one explicit state for every blind. */
export const blindsRequest = z.union([
  z.enum(["auto", "open", "closed"]),
  z.object({ drop: level, slatAngleDeg: angle90 }).strict(),
]);
/** Louvre walls of a shot: the cut-off rule (`auto`), open (90), closed (the stop), rest (the static model) or an angle. */
export const screensRequest = z.union([z.enum(["auto", "open", "closed", "rest"]), z.object({ angleDeg: angle90 }).strict()]);
/** Open fraction of the gates (0 closed, 1 open: the sliding leaf parked, the swing leaf turned into the plot). */
export const gatesRequest = z.object({ driveway: level.optional(), walkway: level.optional() }).strict();

/** The moving parts of a shot; every field is optional (gates closed, garage door closed, louvres `auto`). */
const shotState = {
  gates: gatesRequest.optional(),
  /** Open fraction of the garage door (0 closed, 1 fully raised). */
  garageDoor: level.optional(),
  screens: screensRequest.optional(),
};

/**
 * What must be visible in a frame (checked by the tests: projected inside the frame, facing the camera, not behind a crown).
 * Words for features of the model, never ids: outdoor types (`terrace`, `pool`, `drive`, `path`, `deck`), opening kinds
 * (`entry`, `garage`, `slider`, `window`), `louvres`, `pv`, `gate-drive`, `gate-walk`, `pillar`, a tree species (`walnut`)
 * and furniture types (`island`, `bed180`, `bath`, ...).
 */
const subjects = z.array(z.string().regex(/^[a-z][a-zA-Z0-9-]*$/)).max(8);

const stepSchedule = z.object({ offAboveElevationDeg: z.number(), fullBelowElevationDeg: z.number() }).strict();
const lampBase = { kelvin: z.number().min(1800).max(6500), radiusM: z.number().min(0).max(1) };
const fixture = z
  .object({ lumens: z.number().positive(), ...lampBase, coneDeg: z.number().min(10).max(180), blend: z.number().min(0).max(1) })
  .strict();

const shotTexts = { label: text, alt: text };

export const renderSchema = z
  .object({
    schema: z.literal("render/1"),
    fictional: z.literal(true),
    date: isoDate,
    sensorWidthMm: z.number().positive(),
    sky: z
      .object({
        model: z.enum(["SINGLE_SCATTERING", "MULTIPLE_SCATTERING"]),
        airDensity: z.number().positive(),
        aerosolDensity: z.number().min(0),
        ozoneDensity: z.number().min(0),
        /**
         * Clouds from a partly cloudy sky photo (CC0 HDRI in the git-ignored `assets/`), seen only by the ray types listed;
         * the sun and the sky light still come from the sky model. The render scripts skip it when the file is missing.
         */
        clouds: z
          .object({
            hdri: z.string().regex(/^assets\/[A-Za-z0-9_./-]+\.(exr|hdr)$/, "a repo-relative path below assets/"),
            strength: z.number().min(0).max(4),
            rotationDeg: z.number().min(0).max(360),
            visibleTo: z.array(z.enum(["camera", "glossy", "transmission"])).min(1),
          })
          .strict()
          .optional(),
      })
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
        /** Uplights in the ground beside the trees marked `uplight` in site.json, aimed into the crown. */
        uplight: fixture.extend({ offsetM: z.number().min(0), aimHeightFraction: z.number().min(0).max(1) }).strict(),
        /** Step lights along the edges of raised deck areas (outdoor types listed), facing the lawn. */
        step: z
          .object({ outdoorTypes: z.array(z.string()).min(1), spacingM: z.number().positive(), height: z.number().min(0), lumens: z.number().positive(), ...lampBase })
          .strict(),
        /** Underwater lights in the long walls of the pools. */
        pool: fixture.extend({ spacingM: z.number().positive(), depthM: z.number().positive() }).strict(),
        /** The light of a technical pillar that carries the item `light` (site.json pillars). */
        pillar: z.object({ lumens: z.number().positive(), ...lampBase, insetM: z.number().min(0) }).strict(),
        decor: z.record(
          z.string(),
          z.object({ group: z.enum(["interior", "exterior"]), lumens: z.number().positive(), ...lampBase, lift: z.number().min(0).optional() }).strict(),
        ),
      })
      .strict(),
    /** The state rule of the external blinds; the product itself is `house.json` `shading.blinds.product`. */
    blinds: z
      .object({
        /** Lowered fraction used by the `auto` rule when the sunlit glazing gets more than the threshold. */
        autoDrop: z.number().min(0).max(1),
        /** Lowered fraction of a `closed` request. */
        maxDrop: z.number().min(0).max(1),
        cutoffMarginDeg: z.number().min(0).max(45),
        closedSlatAngleDeg: angle90,
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
            ...shotTexts,
            category: z.enum(["exterior", "interior", "evening", "aerial"]),
            date: isoDate.optional(),
            time: clock,
            size,
            camera: cameraSchema,
            lights: lightsRequest,
            blinds: blindsRequest,
            ...shotState,
            subjects: subjects.optional(),
            notes: z.string().optional(),
          })
          .strict(),
      )
      .min(8)
      .max(12),
    day: z
      .object({
        date: isoDate.optional(),
        ranges: z.array(z.object({ from: clock, to: clock, stepMin: z.number().int().min(1) }).strict()).min(1),
        size,
        camera: cameraSchema,
        /**
         * The phone version: its own camera and size (rendered, not cropped). `aspect` and `centerX` are deprecated (the old
         * crop of the landscape frame); their defaults only keep older readers compiling.
         */
        portrait: z
          .object({
            size,
            camera: cameraSchema,
            aspect: z.tuple([z.number().int().positive(), z.number().int().positive()]).default([2, 3]),
            centerX: z.number().min(0).max(1).default(0.5),
          })
          .strict(),
        stillTime: clock,
        lights: lightsRequest,
        blinds: blindsRequest,
        ...shotState,
        subjects: subjects.optional(),
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
        focalMm: focal,
        fitMargin: z.number().min(-0.5).max(0.4),
        radiusSlack: z.number().min(1).max(3),
        breathing: z.object({ heightM: z.number().min(0), radiusFraction: z.number().min(0).max(0.3) }).strict(),
        /**
         * Smooth rises of the camera over a sector of the loop (a crane move over a tree that would hide the house from the
         * low orbit): around camera azimuth `azimuthDeg` the elevation rises to `elevationDeg` with a raised-cosine profile
         * that is back to the variant's elevation `halfWidthDeg` away. Lower than the variant's elevation has no effect.
         */
        lifts: z.array(z.object({ azimuthDeg: z.number().min(0).max(360), halfWidthDeg: z.number().min(10).max(180), elevationDeg: z.number().min(0).max(80) }).strict()).optional(),
        lights: lightsRequest,
        blinds: blindsRequest,
        ...shotState,
        /**
         * The features the home page names while the orbit plays, and how far (degrees of camera azimuth) on either side of a
         * feature's azimuth its caption shows. Feature words as in `subjects`.
         */
        captions: z.object({ halfWindowDeg: z.number().min(5).max(90), features: z.array(z.string().regex(/^[a-z][a-z0-9-]*$/)).min(1) }).strict(),
        variants: z
          .array(
            z
              .object({
                id: slug,
                size,
                frameSelection: z.enum(["all", "scroll"]),
                focalMm: focal.optional(),
                fitMargin: z.number().min(-0.5).max(0.4).optional(),
                elevationDeg: z.number().min(0).max(80).optional(),
              })
              .strict(),
          )
          .min(1),
      })
      .strict(),
    compare: z
      .object({
        id: slug,
        size,
        camera: cameraSchema,
        /** One sentence for the slider (both halves). */
        alt: text,
        before: z
          .object({
            time: clock,
            lights: lightsRequest,
            blinds: blindsRequest,
            ...shotState,
            /** The chip on the slider. */
            label: text,
            /** Title and alt of this half as a picture of its own (gallery, lightbox). */
            title: text,
            alt: text,
            /** false: the half is only part of the slider, not a gallery picture. Default true. */
            gallery: z.boolean().optional(),
          })
          .strict(),
        after: z
          .object({
            time: clock,
            lights: lightsRequest,
            blinds: blindsRequest,
            ...shotState,
            label: text,
            title: text,
            alt: text,
            gallery: z.boolean().optional(),
          })
          .strict(),
        subjects: subjects.optional(),
      })
      .strict(),
    og: z
      .object({ id: slug, size, time: clock, camera: cameraSchema, lights: lightsRequest, blinds: blindsRequest, ...shotState, alt: text, subjects: subjects.optional() })
      .strict(),
  })
  .strict();

export type RenderConfig = z.infer<typeof renderSchema>;
export type CameraSpec = z.infer<typeof cameraSchema>;
export type LightsRequest = z.infer<typeof lightsRequest>;
export type BlindsRequest = z.infer<typeof blindsRequest>;
export type ScreensRequest = z.infer<typeof screensRequest>;
export type GatesRequest = z.infer<typeof gatesRequest>;
export type Vec3 = [number, number, number];
export type Vec2 = [number, number];

/** Parses model/render.json; throws a readable error listing every problem. */
export function parseRenderConfig(raw: unknown): RenderConfig {
  const r = renderSchema.safeParse(raw);
  if (r.success) return r.data;
  const lines = r.error.issues.map((i) => `  ${i.path.join(".") || "(root)"}: ${i.message}`);
  throw new Error(`model/render.json is invalid:\n${lines.join("\n")}`);
}
