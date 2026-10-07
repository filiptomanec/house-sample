// Placeholder home page: the page agent replaces it. Keep the exports (generateMetadata, default).
import Link from "next/link";
import { notFound } from "next/navigation";
import { buildMetadata } from "@/lib/i18n/metadata";
import { isLocale } from "@/lib/i18n/config";
import { getT } from "@/lib/i18n/server";
import { navLinks } from "@/lib/links";
import { SITE } from "@/lib/site-config";

type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props) {
  const { locale } = await params;
  return isLocale(locale) ? buildMetadata(locale, "home") : {};
}

export default async function Home({ params }: Props) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const t = getT(locale);
  return (
    <div className="shell section-sm" style={{ paddingTop: "calc(var(--nav-h) + var(--section-y-sm))" }}>
      <p className="kicker"><span className="n">00</span><span className="label">{SITE.name}</span></p>
      <h1 className="display">{SITE.house.name[locale]}</h1>
      <p className="lede" style={{ marginBlock: "var(--sp-5) var(--sp-8)" }}>{t("home.lede")}</p>
      <ul className="index">
        {navLinks(locale, t).map((l) => (
          <li key={l.key}><Link href={l.href}><span className="n">{l.n}</span><b>{l.label}</b><span className="d">{l.desc}</span><span className="a" aria-hidden>→</span></Link></li>
        ))}
      </ul>
    </div>
  );
}
