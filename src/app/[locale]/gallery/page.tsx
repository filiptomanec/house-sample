import { notFound } from "next/navigation";
import { Gallery } from "@/components/gallery/Gallery";
import { buildGalleryView } from "@/components/gallery/view";
import { splitTitle } from "@/components/home/title";
import { MethodNote, NextTool, ToolHead } from "@/components/ui/controls";
import { placeOf } from "@/lib/calc/sun";
import { media } from "@/lib/data/media";
import { buildMetadata } from "@/lib/i18n/metadata";
import { isLocale } from "@/lib/i18n/config";
import { I18n } from "@/lib/i18n/Provider";
import { getT } from "@/lib/i18n/server";
import { house } from "@/lib/model/instance";
import { ROUTES } from "@/lib/routes";
import { SITE } from "@/lib/site-config";
import "@/styles/pages/gallery.css";

type Props = { params: Promise<{ locale: string }> };

/** Method paragraphs a later copy pass adds (requested in the WP12 handoff); each shows once its key exists. */
const METHOD_KEYS = ["gallery.method.renders", "gallery.method.sun", "gallery.method.files"] as const;

export async function generateMetadata({ params }: Props) {
  const { locale } = await params;
  return isLocale(locale) ? buildMetadata(locale, "gallery") : {};
}

export default async function Page({ params }: Props) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const t = getT(locale);
  // Pictures, captions and the video come from the media manifest; the sun in the captions is computed for the house's place.
  const view = buildGalleryView(media, locale, placeOf(house));
  // after the last tool comes Home: its title is the house name in the two voices of the start page
  const [first, rest] = splitTitle(SITE.house.name[locale]);
  return (
    <div className="night gal-page">
      <ToolHead n={ROUTES.gallery.n} kicker={t("nav.items.gallery.label")} title={t("gallery.title")} lede={t(view.video ? "gallery.lede" : "gallery.ledeStills")} />
      <I18n locale={locale} namespaces={["gallery"]}>
        <Gallery view={view} />
      </I18n>
      <MethodNote title={t("common.method.title")}>
        <p>{t("gallery.note")}</p>
        {METHOD_KEYS.filter((k) => t.has(k)).map((k) => <p key={k}>{t.dyn(k)}</p>)}
      </MethodNote>
      <NextTool from="gallery" t={t} title={rest ? `${first} <q>${rest}</q>` : first} />
    </div>
  );
}
