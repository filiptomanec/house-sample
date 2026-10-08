// Root layout. The [locale] segment is the root parameter: "cs" serves the root URLs (proxy.ts rewrites "/pudorys" to
// "/cs/plan"), "en" lives under /en. Everything below is statically generated for both languages.

import type { Metadata, Viewport } from "next";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import Footer from "@/components/Footer";
import Nav from "@/components/Nav";
import Reveal from "@/components/Reveal";
import { THEME_SCRIPT } from "@/components/ui/themeScript";
import { fontVariables } from "@/fonts";
import { I18n } from "@/lib/i18n/Provider";
import { LOCALES, LOCALE_META, isLocale } from "@/lib/i18n/config";
import { getT } from "@/lib/i18n/server";
import { SITE } from "@/lib/site-config";
import "@/styles/index.css";

type Props = { children: ReactNode; params: Promise<{ locale: string }> };

export const generateStaticParams = () => LOCALES.map((locale) => ({ locale }));
// Only the two languages exist: an address whose first segment is not one (/index.html, /pudorys.html, /favicon.png,
// /wp-login.php) would otherwise match [locale] with a bogus value and render this layout up to notFound() below (an
// empty client-rendered __next_error__ shell). With false it is a miss of the router like any unknown address, so it gets
// the static global 404 (app/global-not-found.tsx). The isLocale() guard below stays for the types.
export const dynamicParams = false;

// Site-wide defaults. Pages add title, description, canonical and hreflang through buildMetadata().
// The share images are named in buildMetadata() (files app/opengraph-image.jpg and twitter-image.jpg), icons come from app/icon.svg and apple-icon.png.
export const metadata: Metadata = {
  metadataBase: new URL(SITE.url),
  title: { default: SITE.name, template: `%s · ${SITE.name}` },
  applicationName: SITE.name,
  authors: [{ name: SITE.author.name, url: SITE.author.url }],
  creator: SITE.author.name,
  formatDetection: { telephone: false, address: false, email: false },
  appleWebApp: { title: SITE.name, statusBarStyle: "black-translucent" },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: SITE.chrome.light },
    { media: "(prefers-color-scheme: dark)", color: SITE.chrome.dark },
  ],
  colorScheme: "light dark",
  viewportFit: "cover",
};

export default async function RootLayout({ children, params }: Props) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const t = getT(locale);
  // the brand: read here on the server and handed to the client Nav, so no client file imports the model
  const houseName = SITE.house.name[locale];
  return (
    // data-theme is set before paint by THEME_SCRIPT, so the server markup and the client may differ on <html>
    <html lang={LOCALE_META[locale].htmlLang} className={fontVariables} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body>
        <I18n locale={locale} namespaces={["common", "nav", "errors"]}>
          <a className="skip-link" href="#content">{t("common.skip")}</a>
          <Nav houseName={houseName} />
          <main id="content" tabIndex={-1}>{children}</main>
          <Footer locale={locale} />
          <Reveal />
        </I18n>
      </body>
    </html>
  );
}
