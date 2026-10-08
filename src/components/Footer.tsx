import type { Locale } from "@/lib/i18n/config";
import { getT } from "@/lib/i18n/server";
import { rich } from "@/lib/i18n/rich";
import { aboutHref, navLink, navLinks } from "@/lib/links";
import { SITE } from "@/lib/site-config";
import IntentLink from "./ui/IntentLink";

/** "Dům pod ořechem" -> ["Dům", "pod ořechem"]: the first word speaks in Geist, the rest in the accent voice. */
export function splitName(name: string): [string, string] {
  const m = /^(\S+)\s+([\s\S]+)$/u.exec(name.trim());
  return m ? [m[1], m[2]] : [name, ""];
}

/**
 * Server component (its links are small client islands). Three columns on the 12-column grid: about the project, the
 * pages, the project and its sources; one line with the copyright and the single disclaimer; the house name (from the
 * model, through site-config) as the closing wordmark.
 */
export default function Footer({ locale }: { locale: Locale }) {
  const t = getT(locale);
  const house = SITE.house.name[locale];
  const [first, rest] = splitName(house);
  const pages = [navLink(locale, "home", t), ...navLinks(locale, t)];
  const external = { target: "_blank", rel: "noopener noreferrer" } as const;
  const newTab = <span className="sr-only"> {t("common.externalLink")}</span>;
  return (
    <footer className="footer" aria-label={t("footer.label")}>
      <div className="shell footer-grid">
        <div className="foot-about">
          <h2>{t("footer.about.title")}</h2>
          <p>{t("footer.about.text")}</p>
        </div>
        <nav className="foot-pages" aria-labelledby="foot-pages">
          <h2 id="foot-pages">{t("footer.pages")}</h2>
          <ul className="foot-links cols">
            {pages.map((l) => <li key={l.key}><IntentLink href={l.href} heavy={l.heavy}>{l.label}</IntentLink></li>)}
            <li><IntentLink href={aboutHref(locale)}>{t("nav.about.label")}</IntentLink></li>
          </ul>
        </nav>
        <div className="foot-project">
          <h2>{t("footer.project.title")}</h2>
          <ul className="foot-links">
            <li>{rich(t("footer.project.author", { name: SITE.author.name }), { a: (c) => <a className="link" href={SITE.author.url} {...external}>{c}{newTab}</a> })}</li>
            <li><a href={SITE.repo} {...external}>{t("footer.project.source")}{newTab}</a></li>
          </ul>
          <h2>{t("footer.credits.title")}</h2>
          <ul className="foot-links">
            <li><a href={SITE.credits.pvgis} {...external}>{t("footer.credits.pvgis")}{newTab}</a></li>
            <li><a href={SITE.credits.polyhaven} {...external}>{t("footer.credits.polyhaven")}{newTab}</a></li>
            <li><a href={SITE.credits.geist} {...external}>{t("footer.credits.geist")}{newTab}</a></li>
            <li><a href={SITE.credits.instrumentSerif} {...external}>{t("footer.credits.instrumentSerif")}{newTab}</a></li>
            <li><a href={`${SITE.repo}/blob/main/LICENSE`} {...external}>{t("footer.credits.code")}{newTab}</a></li>
          </ul>
        </div>
      </div>
      <div className="shell foot-note">
        <p className="note">{t("footer.rights", { year: SITE.copyrightYear, name: SITE.author.name })}</p>
        <p className="note">{t("footer.fiction")}</p>
      </div>
      {/* decorative: the name is the brand of the bar and the title of every page */}
      <div className="shell foot-mark" aria-hidden="true">
        <p>{first}{rest && <> <span className="accent">{rest}</span></>}</p>
      </div>
    </footer>
  );
}
