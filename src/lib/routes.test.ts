import { describe, expect, it } from "vitest";
import { ROUTE_KEYS, ROUTES, TOOL_KEYS, alternatePaths, internalPath, keyForSlug, localeOfPath, parseAnyPath, parsePublicPath, resolveRequest, routePath } from "./routes";
import { LOCALES } from "./i18n/config";

describe("route table", () => {
  it("has eight routes, the home page first, seven tools in order with numbers 01-07", () => {
    expect(ROUTE_KEYS[0]).toBe("home");
    expect(TOOL_KEYS).toHaveLength(7);
    expect(TOOL_KEYS.map((k) => ROUTES[k].n)).toEqual(["01", "02", "03", "04", "05", "06", "07"]);
  });
  it("has the agreed localised slugs", () => {
    expect(TOOL_KEYS.map((k) => ROUTES[k].slugs.cs)).toEqual(["pudorys", "pozemek", "model", "slunce", "energie", "rozpocet", "galerie"]);
    expect(TOOL_KEYS.map((k) => ROUTES[k].slugs.en)).toEqual(["floor-plan", "plot", "model", "sun", "energy", "budget", "gallery"]);
  });
  it("has unique slugs within a language", () => {
    for (const l of LOCALES) {
      const slugs = TOOL_KEYS.map((k) => ROUTES[k].slugs[l]);
      expect(new Set(slugs).size).toBe(slugs.length);
    }
  });
});

describe("paths", () => {
  it("builds public paths: Czech on root URLs, English under /en", () => {
    expect(routePath("cs", "home")).toBe("/");
    expect(routePath("en", "home")).toBe("/en");
    expect(routePath("cs", "plan")).toBe("/pudorys");
    expect(routePath("en", "plan")).toBe("/en/floor-plan");
    expect(routePath("en", "model", ["export"])).toBe("/en/model/export");
  });
  it("builds internal paths named after the keys", () => {
    expect(internalPath("cs", "home")).toBe("/cs");
    expect(internalPath("cs", "plan")).toBe("/cs/plan");
    expect(internalPath("en", "budget")).toBe("/en/budget");
  });
  it("lists the alternates of a page", () => {
    expect(alternatePaths("sun")).toEqual({ cs: "/slunce", en: "/en/sun" });
  });
  it("finds the key of a slug in one language only", () => {
    expect(keyForSlug("cs", "pudorys")).toBe("plan");
    expect(keyForSlug("en", "pudorys")).toBeNull();
    expect(keyForSlug("en", "floor-plan")).toBe("plan");
  });
  it("parses public paths, ignoring a query or a hash", () => {
    expect(parsePublicPath("/")).toEqual({ locale: "cs", key: "home", tail: [] });
    expect(parsePublicPath("/en")).toEqual({ locale: "en", key: "home", tail: [] });
    expect(parsePublicPath("/pozemek/")).toEqual({ locale: "cs", key: "plot", tail: [] });
    expect(parsePublicPath("/en/energy?x=1#a")).toEqual({ locale: "en", key: "energy", tail: [] });
    expect(parsePublicPath("/en/pudorys")).toBeNull();
    expect(parsePublicPath("/nope")).toBeNull();
  });
  it("parseAnyPath also reads key URLs (when the router reports the rewritten path)", () => {
    expect(parseAnyPath("/pudorys")).toEqual({ locale: "cs", key: "plan", tail: [] });
    expect(parseAnyPath("/cs/plan")).toEqual({ locale: "cs", key: "plan", tail: [] });
    expect(parseAnyPath("/en/plan")).toEqual({ locale: "en", key: "plan", tail: [] });
    expect(parseAnyPath("/cs")).toEqual({ locale: "cs", key: "home", tail: [] });
    expect(parseAnyPath("/en/nope")).toBeNull();
    expect(parseAnyPath("/xx/plan")).toBeNull();
  });
  it("round-trips every route in every language", () => {
    for (const l of LOCALES) for (const k of ROUTE_KEYS) expect(parsePublicPath(routePath(l, k))).toEqual({ locale: l, key: k, tail: [] });
  });
  it("knows the language of any path", () => {
    expect(localeOfPath("/en/whatever")).toBe("en");
    expect(localeOfPath("/whatever")).toBe("cs");
    expect(localeOfPath("/english")).toBe("cs");
  });
});

describe("resolveRequest (proxy)", () => {
  it("rewrites canonical public URLs to the key URLs", () => {
    expect(resolveRequest("/")).toEqual({ type: "rewrite", to: "/cs" });
    expect(resolveRequest("/pudorys")).toEqual({ type: "rewrite", to: "/cs/plan" });
    expect(resolveRequest("/pudorys/")).toEqual({ type: "rewrite", to: "/cs/plan" });
    expect(resolveRequest("/en/floor-plan")).toEqual({ type: "rewrite", to: "/en/plan" });
    expect(resolveRequest("/en/floor-plan/x")).toEqual({ type: "rewrite", to: "/en/plan/x" });
  });
  it("lets URLs that already are key URLs through", () => {
    expect(resolveRequest("/en")).toEqual({ type: "next" });
    expect(resolveRequest("/en/model")).toEqual({ type: "next" });
    expect(resolveRequest("/en/model/export")).toEqual({ type: "next" });
  });
  it("redirects other spellings of a known page to the canonical URL", () => {
    expect(resolveRequest("/cs")).toEqual({ type: "redirect", to: "/" });
    expect(resolveRequest("/cs/pudorys")).toEqual({ type: "redirect", to: "/pudorys" });
    expect(resolveRequest("/cs/plan")).toEqual({ type: "redirect", to: "/pudorys" });
    expect(resolveRequest("/en/pudorys")).toEqual({ type: "redirect", to: "/en/floor-plan" });
    expect(resolveRequest("/en/plan")).toEqual({ type: "redirect", to: "/en/floor-plan" });
    expect(resolveRequest("/floor-plan")).toEqual({ type: "redirect", to: "/pudorys" });
    expect(resolveRequest("/plot")).toEqual({ type: "redirect", to: "/pozemek" });
    expect(resolveRequest("/budget")).toEqual({ type: "redirect", to: "/rozpocet" });
    expect(resolveRequest("/en/energie")).toEqual({ type: "redirect", to: "/en/energy" });
  });
  it("sends unknown paths to the catch-all of their language with status 404", () => {
    expect(resolveRequest("/nic")).toEqual({ type: "rewrite", to: "/cs/nic", status: 404 });
    expect(resolveRequest("/en/nothing/here")).toEqual({ type: "rewrite", to: "/en/nothing/here", status: 404 });
  });
  it("never produces a redirect loop: a redirect target resolves to a rewrite", () => {
    for (const p of ["/cs", "/cs/plan", "/en/plan", "/floor-plan", "/en/pudorys", "/budget"]) {
      const r = resolveRequest(p);
      if (r.type !== "redirect") throw new Error(`${p} should redirect`);
      expect(resolveRequest(r.to).type, `${p} -> ${r.to}`).toMatch(/rewrite|next/);
    }
  });
});
