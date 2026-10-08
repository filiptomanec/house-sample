// The stacked display title of the start page: the house name split after its first word, one-letter words glued forward.
import { describe, expect, it } from "vitest";
import { LOCALES } from "@/lib/i18n/config";
import { NBSP, nb } from "@/lib/i18n/format";
import { house } from "@/lib/model/instance";
import { localized } from "@/lib/model/metrics";
import { splitTitle } from "../title";

describe("splitTitle", () => {
  it("puts the first word on the first line and the rest on the second", () => {
    expect(splitTitle("Dům pod ořechem")).toEqual(["Dům", "pod ořechem"]);
    expect(splitTitle("Walnut House")).toEqual(["Walnut", "House"]);
    expect(splitTitle("Orchard House by the Lake")).toEqual(["Orchard", "House by the Lake"]);
  });

  it("never ends the first line with a one-letter word (a preposition or conjunction is glued to the next word)", () => {
    expect(splitTitle("V sadu u lesa")).toEqual(["V sadu", "u lesa"]);
    expect(splitTitle("A dům")).toEqual(["A dům", ""]);
    expect(splitTitle("Dům v sadu")).toEqual(["Dům", "v sadu"]);
  });

  it("breaks only at a plain space: a no-break space keeps its words together", () => {
    expect(splitTitle(`Dům v${NBSP}sadu`)).toEqual(["Dům", `v${NBSP}sadu`]);
    expect(splitTitle(nb("V sadu u lesa", "cs"))[0]).not.toContain(" ");
  });

  it("keeps a one-word name whole and trims the ends", () => {
    expect(splitTitle("Dům")).toEqual(["Dům", ""]);
    expect(splitTitle("  Dům  pod ořechem ")).toEqual(["Dům", "pod ořechem"]);
  });

  it("loses no character of the model's name in either language", () => {
    for (const l of LOCALES) {
      const name = localized(house.name, l);
      const [a, b] = splitTitle(name);
      expect(a.length).toBeGreaterThan(0);
      expect(b ? `${a} ${b}` : a).toBe(name.trim().replace(/ +/g, " "));
    }
  });
});
