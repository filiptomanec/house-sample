// Smoke tests: the shell renders on the server in both languages without a Next runtime (router hooks are mocked).
import type { Metadata } from "next";
import { NextRequest } from "next/server";
import { createElement as h, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { proxy, config } from "../proxy";
import { I18nProvider, useLocale, useT } from "@/lib/i18n/client";
import { LOCALES, type Locale } from "@/lib/i18n/config";
import { messagesFor } from "@/lib/i18n/messages";
import { ROUTES, TOOL_KEYS } from "@/lib/routes";
import { SITE } from "@/lib/site-config";

let pathname = "/";
vi.mock("next/navigation", () => ({ usePathname: () => pathname, notFound: () => { throw new Error("NEXT_NOT_FOUND"); } }));

const provide = (locale: Locale, child: ReactElement, ns: Parameters<typeof messagesFor>[1] = ["common", "nav", "errors"]) =>
  h(I18nProvider, { locale, messages: messagesFor(locale, ns), children: child });
const html = (el: ReactElement) => renderToStaticMarkup(el);
const NBSP = "\u{a0}";

beforeEach(() => { pathname = "/"; });

describe("Footer", () => {
  it("names the author and repository, the fiction and the sources, in both languages", async () => {
    const { default: Footer } = await import("./Footer");
    const cs = html(h(Footer, { locale: "cs" })), en = html(h(Footer, { locale: "en" }));
    for (const out of [cs, en]) {
      expect(out).toContain(SITE.author.url);
      expect(out).toContain(SITE.repo);
      expect(out).toContain(SITE.author.name);
      expect(out).toContain("PVGIS");
      expect(out).toContain("Poly Haven");
      expect(out).toContain("Geist");
      expect(out).toContain('rel="noopener noreferrer"');
    }
    expect(cs).toContain("fiktivní");
    expect(en).toContain("fictional");
    expect(cs).toContain('href="/pudorys"');
    expect(en).toContain('href="/en/floor-plan"');
  });
});

describe("Nav and LanguageSwitch", () => {
  it("lists the seven tools with localised URLs and marks the current page", async () => {
    const { default: Nav } = await import("./Nav");
    pathname = "/en/floor-plan";
    const out = html(provide("en", h(Nav)));
    for (const k of TOOL_KEYS) expect(out).toContain(`href="${ROUTES[k].slugs.en === "" ? "/en" : `/en/${ROUTES[k].slugs.en}`}"`);
    expect(out).toMatch(/aria-current="page"[^>]*>Floor plan</);
    expect(out).toContain('aria-label="House Sample, home page"');
  });

  it("switches to the same page in the other language", async () => {
    const { default: LanguageSwitch } = await import("./LanguageSwitch");
    pathname = "/pudorys";
    const cs = html(provide("cs", h(LanguageSwitch)));
    expect(cs).toContain('href="/en/floor-plan"');
    expect(cs).toContain('href="/pudorys"');
    expect(cs).toMatch(/aria-current="true"[^>]*>CS</);
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
  it("renders 404, error and loading in both languages", async () => {
    const { NotFoundView, ErrorView, LoadingBar } = await import("./ui/StateViews");
    expect(html(provide("cs", h(NotFoundView)))).toContain(`Tahle stránka tu není.`);
    expect(html(provide("en", h(NotFoundView)))).toContain("This page does not exist.");
    const err = html(provide("en", h(ErrorView, { digest: "abc123", onRetry: () => {} })));
    expect(err).toContain("Try again");
    expect(err).toContain("Error code: abc123");
    expect(html(provide("cs", h(LoadingBar)))).toContain("Načítání…");
    // every tool is offered on the 404 page
    for (const k of TOOL_KEYS) expect(html(provide("cs", h(NotFoundView)))).toContain(`href="/${ROUTES[k].slugs.cs}"`);
  });
});

describe("i18n provider", () => {
  it("nests: a page adds namespaces to the layout's", () => {
    const Probe = () => h("p", null, `${useLocale()}|${useT()("common.close")}|${useT()("plan.lede")}`);
    const out = html(provide("cs", provide("cs", h(Probe), ["plan"])));
    expect(out).toBe("<p>cs|Zavřít|Místnosti, okna a" + NBSP + "rozměry domu, odvozené z" + NBSP + "datového modelu.</p>");
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
        expect(md.alternates?.languages).toMatchObject({ cs: `/${ROUTES[key].slugs.cs}`, en: `/en/${ROUTES[key].slugs.en}`, "x-default": `/${ROUTES[key].slugs.cs}` });
      }
    });
  }
  it("the home page lists all tools", async () => {
    const mod = await import("../app/[locale]/page");
    const out = html(await mod.default({ params: Promise.resolve({ locale: "en" }) }));
    expect(out).toContain("Long Roof House");
    for (const k of TOOL_KEYS) expect(out).toContain(`/en/${ROUTES[k].slugs.en}`);
    expect((await mod.generateMetadata({ params: Promise.resolve({ locale: "cs" }) })).title).toEqual({ absolute: "House Sample · Dům Dlouhá střecha" });
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
  it("sends unknown paths to the catch-all with status 404", () => {
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
