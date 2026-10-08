// The zod schema of `model/pricebook.json` (format `pricebook/1`). It lives apart from budgetCore.ts on purpose: budgetCore.ts is
// loaded by the browser (the Budget page edits and recalculates there) and imports only the *types* from here, so the validator
// (zod, about 100 KB gzipped) stays out of the page's bundle. Tests, scripts and the server may import the schema.
import { z } from "zod";
import { QUANTITY_KEYS, UNIT_KEYS, type QuantityKey } from "./budgetCore";

const share = z.number().min(0).max(1);
const text = z.strictObject({ cs: z.string().min(1), en: z.string().min(1) });
const id = z.string().min(1);

/** Where the quantity of a line comes from: a model quantity (`ref`, scaled by `factor` and shifted by `offset`) or a constant. */
export const QuantityRuleSchema = z.union([
  z.strictObject({ ref: z.enum(QUANTITY_KEYS as [QuantityKey, ...QuantityKey[]]), factor: z.number().min(0).optional(), offset: z.number().optional() }),
  z.strictObject({ value: z.number().min(0) }),
]);
export type QuantityRule = z.infer<typeof QuantityRuleSchema>;

export const PriceLineSchema = z.strictObject({
  /** Stable id; the key of the visitor's edits. A label, never logic. */
  id,
  name: text,
  unit: z.enum(UNIT_KEYS),
  quantity: QuantityRuleSchema,
  /** Unit price in CZK without VAT, >= 0. */
  price: z.number().min(0),
  /**
   * Allowance for offcuts and breakage when the material is ordered (0.1 = 10 %), for the "how much material" cards. The unit
   * price already includes it, so it never changes the amount. A line without `waste` is not listed as a material.
   */
  waste: share.optional(),
  note: text.optional(),
});
export type PriceLine = z.infer<typeof PriceLineSchema>;

export const PriceGroupSchema = z.strictObject({
  id,
  name: text,
  note: text.optional(),
  /** Optional groups can be switched off by the visitor and are not part of the house price (and of the price per m2). */
  optional: z.boolean(),
  /** Initial state of an optional group; must be true for a group that is not optional. */
  defaultOn: z.boolean(),
  /** Key of `vat.classes`. */
  vat: id,
  /** Do the lines of this group form the basis of the site-overhead line (construction work, not design and fees)? */
  siteOverheadBasis: z.boolean(),
  lines: z.array(PriceLineSchema).min(1),
});
export type PriceGroup = z.infer<typeof PriceGroupSchema>;

/**
 * Schema of `model/pricebook.json` (format `pricebook/1`). Prices are the book's data: nothing else in the code carries a price.
 * `meta.status` says whether the numbers were reviewed against the cited sources.
 */
export const PricebookSchema = z
  .strictObject({
    schema: z.literal("pricebook/1"),
    meta: z.strictObject({
      status: z.enum(["starter", "reviewed"]),
      region: z.string().min(1),
      currency: z.literal("CZK"),
      priceYear: z.int(),
      sources: z.array(z.string().min(1)),
    }),
    /** VAT classes as shares (0.12 = 12 %) and the class of groups that name none. */
    vat: z.strictObject({ default: id, classes: z.record(id, share) }),
    /** Contingency on the net sum: default and the range of the slider. */
    reserve: z.strictObject({ default: share, min: share, max: share, step: z.number().positive() }),
    /**
     * Site facilities and ancillary costs as a share of the construction work (the groups with `siteOverheadBasis`), rounded to
     * `roundTo` CZK. It is a computed line of group `groupId` (id, name, unit "set", quantity 1); null = none.
     */
    siteOverhead: z
      .strictObject({ id, name: text, groupId: id, share: z.number().min(0).max(0.2), roundTo: z.number().positive() })
      .nullable(),
    /**
     * A typical range of the finished house price per m2 of heated floor, CZK with VAT: the orientation band the page compares
     * the house price with. Not a quote and not derived from the lines (so it is an independent check); omit for no band.
     */
    benchmark: z.strictObject({ perM2Low: z.number().positive(), perM2High: z.number().positive() }).refine((b) => b.perM2Low < b.perM2High, { message: "low < high" }).optional(),
    groups: z.array(PriceGroupSchema).min(1),
  })
  .superRefine((b, ctx) => {
    const seen = new Set<string>();
    const dup = (v: string, path: (string | number)[]) => {
      if (seen.has(v)) ctx.addIssue({ code: "custom", path, message: `duplicate id "${v}"` });
      seen.add(v);
    };
    b.groups.forEach((g, gi) => {
      dup(g.id, ["groups", gi, "id"]);
      if (!(g.vat in b.vat.classes)) ctx.addIssue({ code: "custom", path: ["groups", gi, "vat"], message: `unknown VAT class "${g.vat}"` });
      if (!g.optional && !g.defaultOn) ctx.addIssue({ code: "custom", path: ["groups", gi, "defaultOn"], message: "a group that is not optional is always on" });
      g.lines.forEach((l, li) => dup(l.id, ["groups", gi, "lines", li, "id"]));
    });
    if (!(b.vat.default in b.vat.classes)) ctx.addIssue({ code: "custom", path: ["vat", "default"], message: "unknown default VAT class" });
    if (!(b.reserve.min <= b.reserve.default && b.reserve.default <= b.reserve.max)) ctx.addIssue({ code: "custom", path: ["reserve"], message: "min <= default <= max" });
    const oh = b.siteOverhead;
    if (oh) {
      dup(oh.id, ["siteOverhead", "id"]);
      const g = b.groups.find((x) => x.id === oh.groupId);
      if (!g) ctx.addIssue({ code: "custom", path: ["siteOverhead", "groupId"], message: "unknown group" });
      else if (g.optional) ctx.addIssue({ code: "custom", path: ["siteOverhead", "groupId"], message: "the overhead line belongs to a group that is not optional" });
    }
  });
export type Pricebook = z.infer<typeof PricebookSchema>;

/** Parses and validates `model/pricebook.json`; throws a ZodError with a readable path on a bad file. */
export function parsePricebook(json: unknown): Pricebook {
  return PricebookSchema.parse(json);
}
