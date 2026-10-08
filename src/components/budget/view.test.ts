// The headline figures of the Budget page are the calculation's own totals rounded to three significant digits (as the method
// says), in the order of currency and amount of the dictionary; the band marker has the stat's precision; unused lines are the
// zero lines of the model, and a line being edited does not jump between the lists.
import { describe, expect, it } from "vitest";
import { computeBudget, defaultBudgetSettings, defaultPricebook } from "@/lib/calc/budget";
import { modelQuantities } from "@/lib/calc/__tests__/budgetFixtures";
import { getFormatter, parseNum, roundSig } from "@/lib/i18n/format";
import { getT } from "@/lib/i18n/server";
import { withOverride } from "./store";
import { MILLION, isUnused, millionText, splitLines, summaryFigures } from "./view";

const book = defaultPricebook();
const q = modelQuantities();
const result = computeBudget(book, q);

for (const locale of ["cs", "en"] as const) {
  const t = getT(locale);
  const f = getFormatter(locale);
  describe(`budget figures (${locale})`, () => {
    const [total, house, perM2] = summaryFigures(result, t, f);

    it("are the calculation's totals rounded to three significant digits, the total in mint", () => {
      expect(parseNum(total.value, locale)).toBe(roundSig(result.total / MILLION));
      expect(parseNum(house.value, locale)).toBe(roundSig(result.coreWithVat / MILLION));
      expect(parseNum(perM2.value, locale)).toBe(roundSig(result.perM2!));
      expect([total.accent, house.accent, perM2.accent]).toEqual([true, undefined, undefined]);
    });

    it("place the currency as the dictionary does", () => {
      const norm = (x: string) => x.replace(/[\s\u{a0}\u{202f}]+/gu, " ").trim();
      for (const [s, v] of [[total, result.total], [house, result.coreWithVat]] as const) {
        const rebuilt = [s.prefix, `${s.value}${s.suffix ?? ""}`, s.unit].filter(Boolean).join(" ");
        expect(norm(rebuilt)).toBe(norm(millionText(t, f, v)));
      }
    });

    it("give the band marker the precision of the stat", () => {
      expect(millionText(t, f, result.coreWithVat)).toContain(house.value);
    });
  });
}

describe("unused lines", () => {
  it("are the zero lines of the model, and the default budget has some", () => {
    const unused = result.groups.flatMap((g) => g.lines.filter(isUnused));
    expect(unused.length).toBeGreaterThan(0);
    for (const l of unused) expect([l.defaultQuantity, l.quantityEdited]).toEqual([0, false]);
    for (const g of result.groups) {
      const { used, unused: u } = splitLines(g, null);
      expect(used.length + u.length).toBe(g.lines.length);
    }
  });

  it("move up once a quantity is entered, but not while the field is being edited", () => {
    const group = result.groups.find((g) => g.lines.some(isUnused))!;
    const line = group.lines.find(isUnused)!;
    const edited = computeBudget(book, q, withOverride(defaultBudgetSettings(book), line.id, "quantity", 12, line.defaultQuantity));
    const g2 = edited.groups.find((g) => g.id === group.id)!;
    expect(splitLines(g2, null).used.map((l) => l.id)).toContain(line.id);
    expect(splitLines(g2, { id: line.id, unused: true }).unused.map((l) => l.id)).toContain(line.id);
  });
});
