"use client";

// Views for a 404 inside a real page ([locale]/not-found.tsx) and for runtime errors (error.tsx). Client components because
// they read the language from the provider. Route loading has no view: the loading line under the bar shows it (LoadingLine.tsx).

import Link from "next/link";
import { useLocale, useT } from "@/lib/i18n/client";
import { navLinks } from "@/lib/links";
import { routePath } from "@/lib/routes";
import { accentPhrase } from "./display";

export function NotFoundView() {
  const t = useT();
  const locale = useLocale();
  return (
    <section className="shell state" aria-labelledby="state-title">
      <p className="kicker" style={{ margin: 0 }}><span className="n">{t("errors.notFound.code")}</span><span className="kicker-label">{t("errors.notFound.label")}</span></p>
      <h1 id="state-title" className="h1">{accentPhrase(t("errors.notFound.title"))}</h1>
      <p className="lede">{t("errors.notFound.text")}</p>
      <p className="state-actions"><Link className="btn" href={routePath(locale, "home")}>{t("errors.notFound.home")}</Link></p>
      <nav aria-label={t("errors.notFound.pages")}>
        <ul className="state-links">
          {navLinks(locale, t).map((l) => (
            <li key={l.key}><Link href={l.href}><b>{l.label}</b><span>{l.desc}</span></Link></li>
          ))}
        </ul>
      </nav>
    </section>
  );
}

export function ErrorView({ digest, onRetry }: { digest?: string; onRetry?: () => void }) {
  const t = useT();
  const locale = useLocale();
  return (
    <section className="shell state" aria-labelledby="state-title" role="alert">
      <p className="kicker" style={{ margin: 0 }}><span className="n">{t("errors.error.code")}</span></p>
      <h1 id="state-title" className="h1">{accentPhrase(t("errors.error.title"))}</h1>
      <p className="lede">{t("errors.error.text")}</p>
      <p className="state-actions">
        {onRetry && <button type="button" className="btn" onClick={onRetry}>{t("errors.error.retry")}</button>}
        <Link className="btn ghost" href={routePath(locale, "home")}>{t("errors.error.home")}</Link>
      </p>
      {digest && <p className="state-digest">{t("errors.error.digest", { digest })}</p>}
    </section>
  );
}
