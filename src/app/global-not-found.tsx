// Global 404 (experimental.globalNotFound in next.config.ts): the page for every URL that matches no route. There is no
// catch-all route on purpose, so every unknown address is a miss of the router and gets this static page with status
// 404 and complete server HTML: unknown pages inside a language (the proxy rewrites them to /cs/... or /en/... with
// status 404), addresses that look like files (/en/index.html, /cs/x.y, /models/x.glb) and the platform's own 404 on Vercel.
// A page that is streamed or rendered on the client could answer 200 or show nothing without JavaScript; this one cannot.
//
// It bypasses the layout, so it brings its own document: styles, fonts, the theme script and the texts. The page is
// static and cannot know the address on the server, so it carries every language; LOCALE_SCRIPT picks one from the
// path before first paint (sets <html lang> and data-locale) and LOCALE_CSS shows only that one. Without JavaScript the
// default language shows. A client component could only switch the language after hydration (a flash of the wrong
// language on /en/...), so there is none: the page ships no JavaScript of its own (and nothing of the 3D engine).
// [locale]/not-found.tsx stays for notFound() calls inside real pages.

import type { Metadata, Viewport } from "next";
import { THEME_SCRIPT } from "@/components/ui/themeScript";
import { DEFAULT_LOCALE, LOCALES, LOCALE_META, localePrefix, type Locale } from "@/lib/i18n/config";
import { accent } from "@/lib/i18n/rich";
import { getT } from "@/lib/i18n/server";
import { navLinks } from "@/lib/links";
import { routePath } from "@/lib/routes";
import { SITE } from "@/lib/site-config";
import { fontVariables } from "@/fonts";
import "@/styles/index.css";

/** Locales served under a path prefix ("/en"), for the script that reads the address. */
const PREFIXED = LOCALES.filter((l) => localePrefix(l)).map((l) => ({ prefix: localePrefix(l), locale: l, lang: LOCALE_META[l].htmlLang }));

/** Runs in <head> before paint: the locale of the address ("/en/..." -> en), the same rule as routes.ts localeOfPath. */
const LOCALE_SCRIPT = `(function(){var p=location.pathname,m=${JSON.stringify(PREFIXED)};for(var i=0;i<m.length;i++){var x=m[i];if(p===x.prefix||p.indexOf(x.prefix+"/")===0){var h=document.documentElement;h.lang=x.lang;h.setAttribute("data-locale",x.locale);return}}})()`;

/** Every language block is a transparent wrapper (its children lay out in the page grid); only the active one shows. */
const LOCALE_CSS = [
  "[data-nf]{display:contents}",
  ".state>[data-nf]>nav{justify-self:stretch}",
  ...LOCALES.map((l) => `html:not([data-locale="${l}"]) [data-nf="${l}"]{display:none}`),
].join("");

export const metadata: Metadata = {
  // absolute URLs of the share images on the canonical host (without it they would point at localhost)
  metadataBase: new URL(SITE.url),
  // "Stránka nenalezena · Page not found"; Next adds robots noindex to every 404 response by itself
  title: LOCALES.map((l) => getT(l)("errors.notFound.label")).join(" · "),
  applicationName: SITE.name,
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: SITE.chrome.light },
    { media: "(prefers-color-scheme: dark)", color: SITE.chrome.dark },
  ],
  colorScheme: "light dark",
  viewportFit: "cover",
};

/** The bar: the house name (home link) and the language choice. */
function Bar({ locale }: { locale: Locale }) {
  const t = getT(locale);
  const house = SITE.house.name[locale];
  return (
    <>
      <a className="skip-link" href="#content">{t("common.skip")}</a>
      <header className="nav" data-solid="false" data-tone="dark">
        <div className="shell nav-in">
          <a href={routePath(locale, "home")} className="brand" aria-label={t("nav.brandAria", { house })}><b>{house}</b></a>
          <div className="lang" role="group" aria-label={t("common.language.label")} style={{ marginLeft: "auto" }}>
            {LOCALES.map((l) => (
              <a
                key={l}
                href={routePath(l, "home")}
                lang={LOCALE_META[l].htmlLang}
                hrefLang={LOCALE_META[l].hreflang}
                aria-label={t(`common.language.${l}`)}
                aria-current={l === locale ? "true" : undefined}
              >
                {LOCALE_META[l].short}
              </a>
            ))}
          </div>
        </div>
      </header>
    </>
  );
}

/** The message: code, title, text, the way home and every page of the site. Plain links: no router needed. */
function Message({ locale }: { locale: Locale }) {
  const t = getT(locale);
  return (
    <>
      <p className="kicker" style={{ margin: 0 }}><span className="n">{t("errors.notFound.code")}</span><span className="kicker-label">{t("errors.notFound.label")}</span></p>
      {/* a heading may carry the two-voice accent phrase as <q>…</q>: the site's one rendering rule (rich.tsx accent()) */}
      <h1 className="h1">{accent(t("errors.notFound.title"))}</h1>
      <p className="lede">{t("errors.notFound.text")}</p>
      <p className="state-actions"><a className="btn" href={routePath(locale, "home")}>{t("errors.notFound.home")}</a></p>
      <nav aria-label={t("errors.notFound.pages")}>
        <ul className="state-links">
          {navLinks(locale, t).map((l) => (
            <li key={l.key}><a href={l.href}><b>{l.label}</b><span>{l.desc}</span></a></li>
          ))}
        </ul>
      </nav>
    </>
  );
}

export default function GlobalNotFound() {
  return (
    // data-theme and lang/data-locale are set before paint by the two scripts, so the server markup and the client may differ on <html>
    <html lang={LOCALE_META[DEFAULT_LOCALE].htmlLang} data-locale={DEFAULT_LOCALE} className={fontVariables} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
        <script dangerouslySetInnerHTML={{ __html: LOCALE_SCRIPT }} />
        <style dangerouslySetInnerHTML={{ __html: LOCALE_CSS }} />
      </head>
      <body>
        {LOCALES.map((l) => <div key={l} data-nf={l} lang={LOCALE_META[l].htmlLang}><Bar locale={l} /></div>)}
        <main id="content" tabIndex={-1} className="shell state">
          {LOCALES.map((l) => <div key={l} data-nf={l} lang={LOCALE_META[l].htmlLang}><Message locale={l} /></div>)}
        </main>
      </body>
    </html>
  );
}
