// Root layout. The [locale] segment is the root parameter: "cs" serves the root URLs (proxy.ts rewrites "/pudorys" to
// "/cs/plan"), "en" lives under /en. Everything below is statically generated for both languages.

import type { Metadata, Viewport } from "next";
import { GeistMono } from "geist/font/mono";
import { GeistSans } from "geist/font/sans";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import Footer from "@/components/Footer";
import Nav from "@/components/Nav";
import Reveal from "@/components/Reveal";
import { THEME_SCRIPT } from "@/components/ui/themeScript";
import { I18n } from "@/lib/i18n/Provider";
import { LOCALES, LOCALE_META, isLocale } from "@/lib/i18n/config";
import { getT } from "@/lib/i18n/server";
import { SITE } from "@/lib/site-config";
import "@/styles/index.css";

type Props = { children: ReactNode; params: Promise<{ locale: string }> };

export const generateStaticParams = () => LOCALES.map((locale) => ({ locale }));

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
  return (
    // data-theme is set before paint by THEME_SCRIPT, so the server markup and the client may differ on <html>
    <html lang={LOCALE_META[locale].htmlLang} className={`${GeistSans.variable} ${GeistMono.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body>
        <I18n locale={locale} namespaces={["common", "nav", "errors"]}>
          <a className="skip-link" href="#content">{t("common.skip")}</a>
          <Nav />
          <main id="content" tabIndex={-1}>{children}</main>
          <Footer locale={locale} />
          <Reveal />
        </I18n>
      </body>
    </html>
  );
}
