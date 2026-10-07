"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { LOCALES, LOCALE_META } from "@/lib/i18n/config";
import { useLocale, useT } from "@/lib/i18n/client";
import { parseAnyPath, routePath } from "@/lib/routes";

/** Switches to the same page in the other language (the home page when the current URL is not a known page, e.g. a 404). */
export default function LanguageSwitch() {
  const path = usePathname();
  const locale = useLocale();
  const t = useT();
  const here = parseAnyPath(path);
  return (
    <div className="lang" role="group" aria-label={t("common.language.label")}>
      {LOCALES.map((l) => (
        <Link
          key={l}
          href={here ? routePath(l, here.key, here.tail) : routePath(l, "home")}
          lang={LOCALE_META[l].htmlLang}
          hrefLang={LOCALE_META[l].htmlLang}
          aria-label={t(`common.language.${l}`)}
          aria-current={l === locale ? "true" : undefined}
        >
          {LOCALE_META[l].short}
        </Link>
      ))}
    </div>
  );
}
