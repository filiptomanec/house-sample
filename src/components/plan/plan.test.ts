// Server render of the floor plan page parts in both languages: structure, roles, texts and numbers from the model.
import { createElement as h, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { derived, house, metrics } from "@/lib/model/instance";
import { I18nProvider } from "@/lib/i18n/client";
import type { Locale } from "@/lib/i18n/config";
import { getFormatter } from "@/lib/i18n/format";
import { messagesFor } from "@/lib/i18n/messages";
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

  it("shows the selected room's facts and a table row for every room plus head and total", () => {
    const first = view.rooms.find((r) => r.id === view.initialRoom)!, f = getFormatter(locale);
    expect(out).toContain(escaped(first.name));
    expect(out).toContain(f.area(first.area, 2));
    expect(count(out, /<tr[ >]/g)).toBe(derived.rooms.length + 2);
    expect(out).toContain(f.num(view.totals.floorArea, 1));
    expect(out).toContain(f.area(view.totals.footprint, 1));
  });

  it("uses the language of the visitor and links to the sun page", () => {
    expect(out).toContain(locale === "cs" ? "Plocha" : "Area");
    expect(out).toContain(locale === "cs" ? "Zóny" : "Zones");
    expect(out).toContain(locale === "cs" ? 'href="/slunce"' : 'href="/en/sun"');
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

  it("renders a card per construction with its layers and U-value", () => {
    const f = getFormatter(locale);
    expect(count(out, /<article/g)).toBe(cards.length);
    for (const c of cards) {
      expect(out).toContain(escaped(c.name));
      expect(out).toContain(f.num(c.u, 3));
      for (const l of c.layers) expect(out).toContain(escaped(l.name));
    }
    expect(count(out, /<li class="pl-layer"/g)).toBe(cards.reduce((s, c) => s + c.layers.length, 0));
  });

  it("lists the window U-values of the model and links to the energy page", () => {
    const f = getFormatter(locale);
    expect(out).toContain(f.num(house.windows.Uw, 2));
    expect(out).toContain(locale === "cs" ? 'href="/energie"' : 'href="/en/energy"');
    expect(out).not.toMatch(/undefined|NaN|\[object|plan\.\w+\.\w+/);
  });
});
