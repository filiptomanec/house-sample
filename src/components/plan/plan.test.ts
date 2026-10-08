// Server render of the floor plan page parts in both languages: structure, roles, texts and numbers from the model.
import { createElement as h, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { derived, house, metrics } from "@/lib/model/instance";
import { I18nProvider } from "@/lib/i18n/client";
import type { Locale } from "@/lib/i18n/config";
import { getFormatter } from "@/lib/i18n/format";
import { messagesFor } from "@/lib/i18n/messages";
import { getT } from "@/lib/i18n/server";
import { buildAssemblyCards, buildMaterialLegend } from "@/lib/plan/assemblies";
import { buildPlanView, type StyleMaterials } from "@/lib/plan/view";
import style from "@model/style.json";
import { Assemblies } from "./Assemblies";
import { PlanTool } from "./PlanTool";

vi.mock("next/navigation", () => ({ usePathname: () => "/", notFound: () => { throw new Error("NEXT_NOT_FOUND"); } }));

const mat = style as unknown as StyleMaterials;
const html = (el: ReactElement) => renderToStaticMarkup(el);
const provide = (locale: Locale, child: ReactElement) => h(I18nProvider, { locale, messages: messagesFor(locale, ["common", "plan"]), children: child });
const count = (s: string, re: RegExp) => (s.match(re) ?? []).length;
const escaped = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;").replace(/'/g, "&#x27;");

describe.each(["cs", "en"] as const)("PlanTool (%s)", (locale) => {
  const view = buildPlanView(house, derived, metrics, mat, locale);
  const out = html(provide(locale, h(PlanTool, { view })));

  it("renders the drawing with one radio per room, one of them in the tab order and selected", () => {
    expect(out).toContain("<svg");
    expect(count(out, /role="radio"/g)).toBe(derived.rooms.length);
    expect(count(out, /aria-checked="true"/g)).toBe(1);
    expect(count(out, /<path[^>]*role="radio"[^>]*tabindex="0"/g)).toBe(1);
    expect(out).toContain('role="radiogroup"');
    for (const r of view.rooms) expect(out).toContain(`aria-label="${r.number} ${escaped(r.name)}, `);
  });

  it("shows the selected room's facts and a table row for every room plus head and the three totals", () => {
    const first = view.rooms.find((r) => r.id === view.initialRoom)!, f = getFormatter(locale);
    expect(out).toContain(escaped(first.name));
    expect(out).toContain(f.area(first.area, 2));
    const totals = 1 + (view.totals.garageArea > 0 ? 1 : 0) + 1;
    expect(count(out, /<tr[ >]/g)).toBe(derived.rooms.length + 1 + totals);
    // the shared metrics: floor area without the garage, the garage, everything; the note gives the built-up area
    expect(out).toContain(f.num(metrics.heatedArea, 2));
    expect(out).toContain(f.num(metrics.garageArea, 2));
    expect(out).toContain(f.num(view.totals.floorArea, 2));
    // the note: the built-up area of the Plot page once its sentence exists, until then the footprint the old sentence describes
    expect(out).toContain(escaped(f.area(getT(locale).has("plan.table.noteBuiltUp") ? metrics.builtUpArea : metrics.footprintArea, 1)));
    // display numbers, never ids
    for (const r of derived.rooms) expect(out).toContain(`>${r.displayNo}<`);
    // the unit of a table head keeps its case
    expect(out).toMatch(/<th[^>]*>[^<]*<span class="u">m²<\/span>/);
  });

  it("puts the legend inside the drawing card and links the sun page to the room", () => {
    const stage = out.slice(out.indexOf('class="pl-stage'), out.indexOf('class="pl-info'));
    expect(stage).toContain('class="pl-legend"');
    for (const k of view.legend) expect(stage).toContain(`data-fill="${k}"`);
    expect(out).toContain(`?room=${view.initialRoom}`);
    // the phone chip appears only after a tap (it is not in the server markup)
    expect(out).not.toContain('class="pl-jump"');
  });

  it("uses the language of the visitor and links to the sun page", () => {
    expect(out).toContain(locale === "cs" ? "Plocha" : "Area");
    expect(out).toContain(locale === "cs" ? "Zóny" : "Zones");
    expect(out).toContain(locale === "cs" ? 'href="/slunce?room=' : 'href="/en/sun?room=');
    expect(out).not.toMatch(/undefined|NaN|\[object|\[i18n\]|plan\.\w+\.\w+/);
  });

  it("draws colours through tokens only", () => {
    expect(out).toContain("var(--ink)");
    expect(out).toContain("var(--zone-day)");
    expect(out).not.toMatch(/#[0-9a-f]{6}/i);
  });
});

describe.each(["cs", "en"] as const)("Assemblies (%s)", (locale) => {
  const floors = derived.rooms.flatMap((r) => (r.floor ? [r.floor] : []));
  const cards = buildAssemblyCards(house, locale);
  const out = html(h(Assemblies, { locale, cards, materials: buildMaterialLegend(house, floors, mat, locale), windows: house.windows }));

  it("renders a card per construction in two groups, with a to-scale strip, its layers and its figure", () => {
    const f = getFormatter(locale);
    expect(count(out, /<article/g)).toBe(cards.length);
    expect(count(out, /class="pl-asm-group"/g)).toBe(new Set(cards.map((c) => c.envelope)).size);
    for (const c of cards) {
      expect(out).toContain(escaped(c.name));
      // the envelope shows its U-value as the figure, the rest its thickness (and the U-value small)
      expect(out).toContain(c.envelope ? `<b>${f.num(c.u, 3)}</b>` : `<b>${f.num(c.thickness * 1000, 0, 1)}</b>`);
      for (const l of c.layers) expect(out).toContain(escaped(l.name));
    }
    expect(count(out, /<li class="pl-layer"/g)).toBe(cards.reduce((s, c) => s + c.layers.length, 0));
    expect(count(out, /class="pl-strip-layer"/g)).toBe(cards.reduce((s, c) => s + c.layers.length, 0));
    // strip widths are the share of the thickness and add up to the whole bar
    const widths = [...out.matchAll(/--w:([\d.]+)%/g)].map((m) => Number(m[1]));
    expect(widths.reduce((a, b) => a + b, 0)).toBeCloseTo(100 * cards.length, 0);
  });

  it("lists the window U-values of the model with subscripts and links to the energy page", () => {
    const f = getFormatter(locale);
    expect(out).toContain(f.num(house.windows.Uw, 2));
    expect(out).toContain("U<sub>w</sub>");
    expect(out).toContain("U<sub>d</sub>");
    expect(out).toContain(locale === "cs" ? 'href="/energie"' : 'href="/en/energy"');
    expect(out).not.toMatch(/undefined|NaN|\[object|plan\.\w+\.\w+/);
  });
});
