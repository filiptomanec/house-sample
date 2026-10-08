// Page metadata from the dictionaries and site-config: title, description, canonical, hreflang, Open Graph, Twitter.
// The share image comes from the file convention (src/app/opengraph-image.jpg), so it is not set here.

import type { Metadata } from "next";
import { LOCALES, LOCALE_META, type Locale } from "./config";
import { alternatePaths, routePath, type RouteKey } from "../routes";
import { SITE } from "../site-config";
import { getT } from "./server";

/** Metadata of one page in one language. Needs `<key>.meta.title` and `<key>.meta.description` in the page's namespace. */
export function buildMetadata(locale: Locale, key: RouteKey): Metadata {
  const t = getT(locale);
  const description = t(`${key}.meta.description`);
  const house = SITE.house.name[locale];
  const pageTitle = t(`${key}.meta.title`);
  const full = key === "home" ? `${SITE.name} · ${house}` : `${pageTitle} · ${SITE.name}`;
  const alt = alternatePaths(key);
  return {
    title: key === "home" ? { absolute: full } : pageTitle,
    description,
    alternates: { canonical: routePath(locale, key), languages: { ...Object.fromEntries(LOCALES.map((l) => [LOCALE_META[l].htmlLang, alt[l]])), "x-default": alt.cs } },
    openGraph: {
      type: "website", siteName: SITE.name, title: full, description, url: routePath(locale, key),
      locale: LOCALE_META[locale].og, alternateLocale: LOCALES.filter((l) => l !== locale).map((l) => LOCALE_META[l].og),
      // the share images are files in src/app (served at /opengraph-image.jpg and /twitter-image.jpg); the file convention
      // does not attach to pages below the [locale] root layout, so they are named here (metadataBase makes the URLs absolute)
      images: [{ url: "/opengraph-image.jpg", width: 1200, height: 630, alt: house }],
    },
    twitter: { card: "summary_large_image", title: full, description, images: [{ url: "/twitter-image.jpg", width: 1200, height: 600, alt: house }] },
    robots: { index: true, follow: true },
  };
}
