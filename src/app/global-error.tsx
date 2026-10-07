"use client";

// Last resort: an error in the root layout itself. It replaces the layout, so it brings its own <html>, styles, font
// and texts (both languages, chosen by the /en prefix of the address).

import { GeistMono } from "geist/font/mono";
import { GeistSans } from "geist/font/sans";
import { useSyncExternalStore } from "react";
import errors from "@/lib/i18n/messages/errors";
import { LOCALE_META, type Locale } from "@/lib/i18n/config";
import { localeOfPath } from "@/lib/routes";
import "@/styles/index.css";

const subscribe = () => () => {};
const clientLocale = (): Locale => localeOfPath(location.pathname);

export default function GlobalError({ error, retry, reset }: { error: Error & { digest?: string }; retry?: () => void; reset?: () => void }) {
  const locale = useSyncExternalStore(subscribe, clientLocale, () => "cs" as Locale);
  const m = errors[locale].error;
  const again = retry ?? reset;
  return (
    <html lang={LOCALE_META[locale].htmlLang} className={`${GeistSans.variable} ${GeistMono.variable}`} suppressHydrationWarning>
      <body>
        <main className="shell state" role="alert">
          <p className="kicker" style={{ margin: 0 }}><span className="n">{m.code}</span></p>
          <h1 className="h1">{m.title}</h1>
          <p className="lede">{m.text}</p>
          <p className="state-actions">
            {again && <button type="button" className="btn" onClick={() => again()}>{m.retry}</button>}
            {/* a plain link on purpose: the router may be what failed */}
            <a className="btn ghost" href={locale === "en" ? "/en" : "/"}>{m.home}</a>
          </p>
          {error.digest && <p className="state-digest">{m.digest.replace("{digest}", error.digest)}</p>}
        </main>
      </body>
    </html>
  );
}
