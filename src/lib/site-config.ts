// Everything the site says about itself, in one place: names, URLs, author, repository, credits, colours of the
// browser chrome, the origins allowed to embed the site. Pages, metadata, manifest, sitemap, robots, footer and the
// security headers (next.config.ts) read from here.
//
// SERVER ONLY: this module imports model/house.json (the house name). Never import it from a "use client" file, or the
// whole model ships to the browser (scripts/check-bundles.mjs warns). Client components get what they need as props
// (for example the house name: layout.tsx passes it to Nav).

import type { Locale } from "./i18n/config";
import houseJson from "../../model/house.json";

/** Production origin when NEXT_PUBLIC_SITE_URL is not set. A host that resolves (the custom domain has no DNS record yet). */
const DEFAULT_SITE_URL = "https://house-sample.vercel.app";

/**
 * The canonical origin: NEXT_PUBLIC_SITE_URL (Vercel env, any http(s) URL) or the default above, without a trailing
 * slash. VERCEL_PROJECT_PRODUCTION_URL is deliberately not used: it resolves to the custom domain once one is attached,
 * even before that domain has DNS, which would put every share card on a dead host.
 */
export function siteUrl(env: string | undefined = process.env.NEXT_PUBLIC_SITE_URL): string {
  const raw = env?.trim();
  if (!raw) return DEFAULT_SITE_URL;
  const u = new URL(raw);
  if (u.protocol !== "https:" && u.protocol !== "http:") throw new Error(`NEXT_PUBLIC_SITE_URL must be an http(s) URL`);
  return u.origin;
}

export const SITE = {
  /** The project (repository) name: og:site_name, STL header, download names. The visible brand is the house name. */
  name: "House Sample",
  /** Canonical origin without a trailing slash; override with NEXT_PUBLIC_SITE_URL. */
  url: siteUrl(),
  author: { name: "Filip Tomanec", url: "https://github.com/filiptomanec" },
  repo: "https://github.com/filiptomanec/house-sample",
  license: "MIT",
  /** Year shown in the footer copyright line (a constant, so a static page never depends on the build date). */
  copyrightYear: "2026",
  /** The fictional house. The name comes from the model (model/house.json), the only source. */
  house: { name: houseJson.name satisfies Record<Locale, string> },
  /** Colours of the browser chrome (meta theme-color, manifest). Must equal --bg of tokens.css; src/styles/tokens.test.ts checks it. */
  chrome: { light: "#f4f1e8", dark: "#14171a" },
  /** Origins (besides the site itself) that may show the site in an iframe: CSP frame-ancestors in next.config.ts. */
  embedOrigins: ["https://filiptomanec.cz", "https://*.filiptomanec.cz"],
  /** Third-party sources and licences named in the footer (labels live in the footer dictionary). */
  credits: {
    pvgis: "https://joint-research-centre.ec.europa.eu/photovoltaic-geographical-information-system-pvgis_en",
    polyhaven: "https://polyhaven.com/license",
    geist: "https://github.com/vercel/geist-font",
    /** The accent face (SIL OFL 1.1); next/font self-hosts it from Google Fonts at build time (src/fonts/index.ts, ASSETS.md). */
    instrumentSerif: "https://github.com/Instrument/instrument-serif",
  },
} as const;

/** Absolute URL of a path on the site ("/" gives the origin with a slash; use canonicalUrl for page addresses). */
export const absoluteUrl = (path: string) => new URL(path, `${SITE.url}/`).toString();

/**
 * Absolute URL of a page in its one canonical form, the form Next writes into <link rel="canonical"> and hreflang:
 * no trailing slash, also for the home page (the bare origin, then "/en", "/pudorys" appended to it). The sitemap
 * uses it, so its <loc> entries equal the pages' canonical links character for character.
 */
export function canonicalUrl(path: string): string {
  const u = new URL(path, `${SITE.url}/`);
  return `${u.origin}${u.pathname.replace(/\/+$/, "")}${u.search}`;
}
