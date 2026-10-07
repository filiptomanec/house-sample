// Everything the site says about itself, in one place: names, URLs, author, repository, credits, colours of the
// browser chrome. Pages, metadata, manifest, sitemap and footer read from here.

import type { Locale } from "./i18n/config";

const url = (process.env.NEXT_PUBLIC_SITE_URL ?? "https://house-sample.filiptomanec.cz").replace(/\/+$/, "");

export const SITE = {
  name: "House Sample",
  /** Production origin; override with NEXT_PUBLIC_SITE_URL for another domain. */
  url,
  author: { name: "Filip Tomanec", url: "https://github.com/filiptomanec" },
  repo: "https://github.com/filiptomanec/house-sample",
  license: "MIT",
  /** Year shown in the footer copyright line (a constant, so a static page never depends on the build date). */
  copyrightYear: "2026",
  /** The fictional house. */
  house: { name: { cs: "Dům Dlouhá střecha", en: "Long Roof House" } satisfies Record<Locale, string> },
  /** Colours of the browser chrome (meta theme-color, manifest). Must equal --bg of tokens.css; src/styles/tokens.test.ts checks it. */
  chrome: { light: "#f4f1e8", dark: "#14171a" },
  /** Third-party sources and licences named in the footer (labels live in the footer dictionary). */
  credits: {
    pvgis: "https://joint-research-centre.ec.europa.eu/photovoltaic-geographical-information-system-pvgis_en",
    polyhaven: "https://polyhaven.com/license",
    geist: "https://github.com/vercel/geist-font",
  },
} as const;

/** Absolute URL of a path on the site. */
export const absoluteUrl = (path: string) => new URL(path, `${SITE.url}/`).toString();
