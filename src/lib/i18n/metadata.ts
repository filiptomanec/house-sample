// Page metadata from the dictionaries and site-config: title, description, canonical, hreflang, Open Graph, Twitter.
// Titles: the home page "{house} · studie přízemního domu" (home.meta.titleFull), every other page "{Page} · {house}"
// (common.meta.pageTitle with <key>.meta.title). The house name comes from the model through SITE, never from a dictionary.
// og:site_name stays the project name (SITE.name). The share images are the files src/app/opengraph-image.jpg and
// twitter-image.jpg; their sizes and alt text come from the media manifest (docs/MEDIA.md).

import type { Metadata } from "next";
import { LOCALES, LOCALE_META, type Locale } from "./config";
import { media } from "../data/media";
import { alternatePaths, routePath, type RouteKey } from "../routes";
import { SITE } from "../site-config";
import { plainText } from "./rich";
import { getT } from "./server";

/** The full <title> of a page in one language (plain text, no accent markup). */
export function pageTitle(locale: Locale, key: RouteKey): string {
  const t = getT(locale);
  const house = SITE.house.name[locale];
  const text = key === "home" ? t("home.meta.titleFull", { house }) : t("common.meta.pageTitle", { page: t(`${key}.meta.title`), house });
  return plainText(text);
}

/** Alt text of the share image: the manifest's og.alt once the media build writes it, otherwise a line with the house name. */
function shareImageAlt(locale: Locale): string {
  const fromManifest = (media.og as Record<string, unknown>).alt as Partial<Record<Locale, string>> | undefined;
  return fromManifest?.[locale] ?? getT(locale)("common.meta.ogAlt", { house: SITE.house.name[locale] });
}

/** Metadata of one page in one language. Needs `<key>.meta.title` and `<key>.meta.description` in the page's namespace. */
export function buildMetadata(locale: Locale, key: RouteKey): Metadata {
  const t = getT(locale);
  const house = SITE.house.name[locale];
  const title = pageTitle(locale, key);
  const description = plainText(t(`${key}.meta.description`, { house }));
  const alt = alternatePaths(key);
  const imageAlt = shareImageAlt(locale);
  const og = media.og;
  const tw = og.twitter ?? og;
  return {
    // absolute: the layout's "%s · House Sample" template must not apply, the house name is the brand
    title: { absolute: title },
    description,
    alternates: {
      canonical: routePath(locale, key),
      languages: { ...Object.fromEntries(LOCALES.map((l) => [LOCALE_META[l].hreflang, alt[l]])), "x-default": alt.cs },
    },
    openGraph: {
      type: "website", siteName: SITE.name, title, description, url: routePath(locale, key),
      locale: LOCALE_META[locale].og, alternateLocale: LOCALES.filter((l) => l !== locale).map((l) => LOCALE_META[l].og),
      // the share images are files in src/app (served at /opengraph-image.jpg and /twitter-image.jpg); the file convention
      // does not attach to pages below the [locale] root layout, so they are named here (metadataBase makes the URLs absolute)
      images: [{ url: "/opengraph-image.jpg", width: og.width, height: og.height, alt: imageAlt }],
    },
    twitter: { card: "summary_large_image", title, description, images: [{ url: "/twitter-image.jpg", width: tw.width, height: tw.height, alt: imageAlt }] },
    robots: { index: true, follow: true },
  };
}
