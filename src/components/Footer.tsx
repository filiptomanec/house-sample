import Link from "next/link";
import type { Locale } from "@/lib/i18n/config";
import { getT } from "@/lib/i18n/server";
import { rich } from "@/lib/i18n/rich";
import { navLink, navLinks } from "@/lib/links";
import { SITE } from "@/lib/site-config";

/** Server component: no client JavaScript. Names the author, the repository, the fictional nature of the project and the sources. */
export default function Footer({ locale }: { locale: Locale }) {
  const t = getT(locale);
  const pages = [navLink(locale, "home", t), ...navLinks(locale, t)];
  const external = { target: "_blank", rel: "noopener noreferrer" } as const;
  const newTab = <span className="sr-only"> {t("common.externalLink")}</span>;
  return (
    <footer className="footer" aria-label={t("footer.label")}>
      <div className="shell footer-grid">
        <div className="foot-about">
          <h2>{t("footer.about.title")}</h2>
          <p>{t("footer.about.text")}</p>
          <p>{t("footer.fiction")}</p>
        </div>
        <nav aria-labelledby="foot-pages">
          <h2 id="foot-pages">{t("footer.pages")}</h2>
          <ul className="foot-links">
            {pages.map((l) => <li key={l.key}><Link href={l.href}>{l.label}</Link></li>)}
          </ul>
        </nav>
        <div>
          <h2>{t("footer.project.title")}</h2>
          <ul className="foot-links">
            <li>{rich(t("footer.project.author", { name: SITE.author.name }), { a: (c) => <a className="link" href={SITE.author.url} {...external}>{c}{newTab}</a> })}</li>
            <li><a href={SITE.repo} {...external}>{t("footer.project.source")}{newTab}</a></li>
          </ul>
        </div>
        <div>
          <h2>{t("footer.credits.title")}</h2>
          <ul className="foot-links">
            <li><a href={SITE.credits.pvgis} {...external}>{t("footer.credits.pvgis")}{newTab}</a></li>
            <li><a href={SITE.credits.polyhaven} {...external}>{t("footer.credits.polyhaven")}{newTab}</a></li>
            <li><a href={SITE.credits.geist} {...external}>{t("footer.credits.geist")}{newTab}</a></li>
            <li><a href={`${SITE.repo}/blob/main/LICENSE`} {...external}>{t("footer.credits.code")}{newTab}</a></li>
          </ul>
        </div>
      </div>
      <div className="shell foot-note">
        <p className="note">{t("footer.rights", { year: SITE.copyrightYear, name: SITE.author.name })}</p>
        <p className="note">{t("common.fiction")}</p>
      </div>
    </footer>
  );
}
