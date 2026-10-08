// Smoke tests: the shell renders on the server in both languages without a Next runtime (router hooks are mocked).
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { Metadata } from "next";
import { NextRequest } from "next/server";
import { createElement as h, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { proxy, config } from "../proxy";
import { I18nProvider, useLocale, useT } from "@/lib/i18n/client";
import { LOCALES, LOCALE_META, type Locale } from "@/lib/i18n/config";
import { messagesFor } from "@/lib/i18n/messages";
import { getT } from "@/lib/i18n/server";
import { ROUTES, TOOL_KEYS } from "@/lib/routes";
import { SITE } from "@/lib/site-config";

let pathname = "/";
vi.mock("next/navigation", () => ({
  usePathname: () => pathname,
  useRouter: () => ({ prefetch: () => {}, push: () => {}, replace: () => {}, back: () => {}, refresh: () => {} }),
  notFound: () => { throw new Error("NEXT_NOT_FOUND"); },
}));

const provide = (locale: Locale, child: ReactElement, ns: Parameters<typeof messagesFor>[1] = ["common", "nav", "errors"]) =>
  h(I18nProvider, { locale, messages: messagesFor(locale, ns), children: child });
const html = (el: ReactElement) => renderToStaticMarkup(el);
/** Visible text of server markup: tags dropped, entities of the no-break space and the apostrophe decoded. */
const text = (markup: string) => markup.replace(/<[^>]+>/g, "").replace(/&nbsp;|&#xa0;|&#160;/g, "\u{a0}").replace(/&#x27;|&#39;/g, "'").replace(/&amp;/g, "&");
/** The house name, read from model/house.json through site-config: the only source of the brand. */
const houseJson = JSON.parse(readFileSync(join(__dirname, "..", "..", "model", "house.json"), "utf8")) as { name: Record<Locale, string> };

beforeEach(() => { pathname = "/"; });

describe("Footer", () => {
  it("names the house (from house.json), the author and repository, the fiction and the sources, in both languages", async () => {
    const { default: Footer, splitName } = await import("./Footer");
    const cs = html(h(Footer, { locale: "cs" })), en = html(h(Footer, { locale: "en" }));
    for (const [locale, out] of [["cs", cs], ["en", en]] as const) {
      const name = houseJson.name[locale];
      expect(SITE.house.name[locale]).toBe(name);
      expect(text(out)).toContain(name);
      // the wordmark: the first word in Geist, the rest in the accent voice, hidden from assistive technology
      const [first, rest] = splitName(name);
      expect(out).toMatch(new RegExp(`class="shell foot-mark" aria-hidden="true"><p>${first}`));
      if (rest) expect(out).toContain(`<span class="accent">${rest}</span>`);
      // one disclaimer line, not three
      expect(out.match(/class="note"/g)?.length).toBe(2);
    }
    for (const out of [cs, en]) {
      expect(out).toContain(SITE.author.url);
      expect(out).toContain(SITE.repo);
      expect(out).toContain(SITE.author.name);
      expect(out).toContain("PVGIS");
      expect(out).toContain("Poly Haven");
      expect(out).toContain("Geist");
      // the accent face is credited with its source (SIL OFL)
      expect(out).toContain("Instrument Serif");
      expect(out).toContain(`href="${SITE.credits.instrumentSerif}"`);
      expect(out).toContain('rel="noopener noreferrer"');
    }
    // the one disclaimer line
    expect(text(cs)).toContain(getT("cs")("footer.fiction"));
    expect(text(en)).toContain(getT("en")("footer.fiction"));
    expect(cs).toContain('href="/pudorys"');
    expect(en).toContain('href="/en/floor-plan"');
  });
});

describe("Nav and LanguageSwitch", () => {
  it("lists the seven tools with localised URLs, marks the current page and carries the house name as the brand", async () => {
    const { default: Nav } = await import("./Nav");
    pathname = "/en/floor-plan";
    const out = html(provide("en", h(Nav, { houseName: SITE.house.name.en })));
    for (const k of TOOL_KEYS) expect(out).toContain(`href="${ROUTES[k].slugs.en === "" ? "/en" : `/en/${ROUTES[k].slugs.en}`}"`);
    expect(out).toMatch(new RegExp(`aria-current="page"[^>]*>${getT("en")("nav.items.plan.label")}<`));
    expect(out).toMatch(new RegExp(`class="brand"[^>]*><b>${houseJson.name.en}</b>`));
    // the loading line under the bar, and a pending marker in every link
    expect(out).toContain('class="loading-line"');
    expect(out.match(/<span hidden=""><\/span>/g)?.length).toBeGreaterThanOrEqual(TOOL_KEYS.length + 1);
  });

  it("keeps the shell's client files free of the model and of site-config (the brand comes in as a prop)", () => {
    const dir = __dirname;
    const client = ["Nav.tsx", "LanguageSwitch.tsx", "Reveal.tsx", "LoadingLine.tsx", ...readdirSync(join(dir, "ui")).filter((f) => /\.tsx?$/.test(f) && !f.includes(".test.")).map((f) => `ui/${f}`)]
      .map((f) => ({ f, src: readFileSync(join(dir, f), "utf8") }))
      .filter(({ src }) => src.startsWith('"use client"'));
    expect(client.length).toBeGreaterThan(4);
    for (const { f, src } of client) expect(src, f).not.toMatch(/from\s+["'](@\/lib\/site-config|@model\/|[./]*model\/|@\/lib\/model\/instance|@\/lib\/i18n\/(server|messages)["'])/);
  });

  it("switches to the same page in the other language", async () => {
    const { default: LanguageSwitch } = await import("./LanguageSwitch");
    pathname = "/pudorys";
    const cs = html(provide("cs", h(LanguageSwitch)));
    expect(cs).toContain('href="/en/floor-plan"');
    expect(cs).toContain('href="/pudorys"');
    expect(cs).toMatch(/aria-current="true"[^>]*>CS</);
    // lang is the dialect of the text (en-GB), hreflang the bare language, as in the metadata and the sitemap
    for (const l of LOCALES) {
      expect(cs).toMatch(new RegExp(`\\slang="${LOCALE_META[l].htmlLang}"`));
      expect(cs).toMatch(new RegExp(`\\shreflang="${LOCALE_META[l].hreflang}"`, "i"));
    }
    expect(cs).not.toMatch(/hreflang="en-GB"/i);
    pathname = "/en/energy";
    const en = html(provide("en", h(LanguageSwitch)));
    expect(en).toContain('href="/energie"');
  });

  it("falls back to the home page on an unknown address", async () => {
    const { default: LanguageSwitch } = await import("./LanguageSwitch");
    pathname = "/nothing/here";
    const out = html(provide("cs", h(LanguageSwitch)));
    expect(out).toContain('href="/en"');
  });

  it("also understands key URLs (if the router reports the rewritten path)", async () => {
    const { default: LanguageSwitch } = await import("./LanguageSwitch");
    pathname = "/cs/plan";
    expect(html(provide("cs", h(LanguageSwitch)))).toContain('href="/en/floor-plan"');
  });
});

describe("states", () => {
  it("renders 404 and error in both languages", async () => {
    const { NotFoundView, ErrorView } = await import("./ui/StateViews");
    for (const locale of LOCALES) expect(text(html(provide(locale, h(NotFoundView))))).toContain(getT(locale)("errors.notFound.title").replace(/<\/?q>/g, ""));
    const err = html(provide("en", h(ErrorView, { digest: "abc123", onRetry: () => {} })));
    expect(text(err)).toContain(getT("en")("errors.error.retry"));
    expect(text(err)).toContain(getT("en")("errors.error.digest", { digest: "abc123" }));
    // every tool is offered on the 404 page
    for (const k of TOOL_KEYS) expect(html(provide("cs", h(NotFoundView)))).toContain(`href="/${ROUTES[k].slugs.cs}"`);
  });
});

describe("two-voice headings and the closing blocks", () => {
  it("renders the accent phrase by one rule: accentPhrase() is rich.tsx accent()", async () => {
    const { accentPhrase, plainHeading } = await import("./ui/controls");
    const { accent, plainText } = await import("@/lib/i18n/rich");
    for (const locale of LOCALES) {
      const title = getT(locale)("errors.notFound.title");
      const out = html(h("h1", null, accentPhrase(title)));
      expect(out).toBe(html(h("h1", null, accent(title))));
      expect(out).toMatch(/<span class="accent">[^<]+<\/span>/);
      expect(plainHeading(title)).toBe(plainText(title));
    }
  });

  it("NextTool leads to the next page with the common kicker word and names its landmark", async () => {
    const { NextTool, nextRoute } = await import("./ui/controls");
    for (const locale of LOCALES) {
      const t = getT(locale);
      const next = nextRoute("plot");
      const out = html(h(NextTool, { from: "plot", t }));
      expect(text(out)).toContain(t("common.next.label"));
      expect(out).toContain(`aria-label="${t("common.next.aria", { page: t.dyn(`nav.items.${next}.label`) })}"`);
      expect(out).toContain(`href="${locale === "cs" ? `/${ROUTES[next].slugs.cs}` : `/en/${ROUTES[next].slugs.en}`}"`);
    }
  });

  it("NextTool never shows a raw placeholder: a title that needs a value comes from the page", async () => {
    const { NextTool, nextRoute } = await import("./ui/controls");
    const t = getT("cs");
    const next = nextRoute("plan"); // plot: its title takes {area}
    const fallback = text(html(h(NextTool, { from: "plan", t })));
    expect(fallback).not.toMatch(/\{\w+\}/);
    expect(fallback).toContain(t.dyn(`nav.items.${next}.label`));
    const given = html(h(NextTool, { from: "plan", t, title: t("plot.title", { area: "1 200 m²" }) }));
    expect(given).toMatch(/200\s*m²\s*<span class="accent">[^<]+<\/span>/); // \s also matches the no-break spaces of nb()
  });
});

describe("i18n provider", () => {
  it("nests: a page adds namespaces to the layout's", () => {
    const Probe = () => h("p", null, `${useLocale()}|${useT()("common.close")}|${useT()("plan.lede")}`);
    const out = html(provide("cs", provide("cs", h(Probe), ["plan"])));
    expect(text(out)).toBe(`cs|${getT("cs")("common.close")}|${getT("cs")("plan.lede")}`);
  });
  it("fails loudly without a provider", () => {
    const Probe = () => h("p", null, useT()("common.close"));
    expect(() => html(h(Probe))).toThrow(/I18nProvider/);
  });
});

describe("placeholder pages", () => {
  const pages = {
    plan: () => import("../app/[locale]/plan/page"),
    plot: () => import("../app/[locale]/plot/page"),
    model: () => import("../app/[locale]/model/page"),
    sun: () => import("../app/[locale]/sun/page"),
    energy: () => import("../app/[locale]/energy/page"),
    budget: () => import("../app/[locale]/budget/page"),
    gallery: () => import("../app/[locale]/gallery/page"),
  } as const;
  for (const key of Object.keys(pages) as (keyof typeof pages)[]) {
    it(`/${key} renders heading, number and lede in both languages and has metadata`, async () => {
      const mod = await pages[key]();
      for (const locale of LOCALES) {
        const params = Promise.resolve({ locale });
        const out = html(await mod.default({ params }));
        expect(out).toContain(`<h1 class="h1">`);
        expect(out).toContain(ROUTES[key].n);
        const md = (await mod.generateMetadata({ params })) as Metadata;
        expect(md.description?.length).toBeGreaterThan(20);
        expect(md.alternates?.canonical).toBe(locale === "cs" ? `/${ROUTES[key].slugs.cs}` : `/en/${ROUTES[key].slugs.en}`);
        const languages = md.alternates?.languages as Record<string, string>;
        expect(Object.values(languages)).toEqual(expect.arrayContaining([`/${ROUTES[key].slugs.cs}`, `/en/${ROUTES[key].slugs.en}`]));
        expect(languages["x-default"]).toBe(`/${ROUTES[key].slugs.cs}`);
      }
    });
  }
  it("the home page lists all tools", async () => {
    const mod = await import("../app/[locale]/page");
    const out = html(await mod.default({ params: Promise.resolve({ locale: "en" }) }));
    expect(text(out)).toContain(houseJson.name.en);
    for (const k of TOOL_KEYS) expect(out).toContain(`/en/${ROUTES[k].slugs.en}`);
    const title = (await mod.generateMetadata({ params: Promise.resolve({ locale: "cs" }) })).title as { absolute: string };
    expect(title.absolute).toContain(houseJson.name.cs);
  });
  it("an unknown locale is a 404", async () => {
    const mod = await import("../app/[locale]/plan/page");
    await expect(mod.default({ params: Promise.resolve({ locale: "xx" }) })).rejects.toThrow("NEXT_NOT_FOUND");
  });
});

describe("proxy", () => {
  const run = (path: string) => proxy(new NextRequest(`http://localhost:3400${path}?q=1`));
  it("rewrites Czech root URLs and English slugs to the key URLs, keeping the query", () => {
    expect(run("/pudorys").headers.get("x-middleware-rewrite")).toBe("http://localhost:3400/cs/plan?q=1");
    expect(run("/").headers.get("x-middleware-rewrite")).toBe("http://localhost:3400/cs?q=1");
    expect(run("/en/floor-plan").headers.get("x-middleware-rewrite")).toBe("http://localhost:3400/en/plan?q=1");
  });
  it("lets key URLs under /en through", () => {
    expect(run("/en/model").headers.get("x-middleware-next")).toBe("1");
    expect(run("/en").headers.get("x-middleware-next")).toBe("1");
  });
  it("redirects other spellings permanently", () => {
    const r = run("/cs/plan");
    expect(r.status).toBe(308);
    expect(r.headers.get("location")).toBe("http://localhost:3400/pudorys?q=1");
  });
  it("rewrites unknown paths into their language with status 404 (no route matches, so the global 404 page answers)", () => {
    const r = run("/nic");
    expect(r.status).toBe(404);
    expect(r.headers.get("x-middleware-rewrite")).toBe("http://localhost:3400/cs/nic?q=1");
  });
  it("matches pages only, not build output or files with an extension", () => {
    const re = new RegExp(`^${config.matcher[0]}$`);
    for (const p of ["/", "/pudorys", "/en", "/en/floor-plan", "/model/export"]) expect(re.test(p), p).toBe(true);
    for (const p of ["/_next/static/chunks/a.js", "/icons/icon-192.png", "/models/house.glb", "/robots.txt", "/sitemap.xml", "/manifest.webmanifest", "/opengraph-image.jpg", "/favicon.ico", "/api/x"]) expect(re.test(p), p).toBe(false);
  });
});
