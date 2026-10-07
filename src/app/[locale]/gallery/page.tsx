import { notFound } from "next/navigation";
import { Gallery } from "@/components/gallery/Gallery";
import { buildGalleryView } from "@/components/gallery/view";
import { ToolHead } from "@/components/ui/controls";
import { media } from "@/lib/data/media";
import { buildMetadata } from "@/lib/i18n/metadata";
import { isLocale } from "@/lib/i18n/config";
import { I18n } from "@/lib/i18n/Provider";
import { getT } from "@/lib/i18n/server";
import { ROUTES } from "@/lib/routes";
import "@/styles/pages/gallery.css";

type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props) {
  const { locale } = await params;
  return isLocale(locale) ? buildMetadata(locale, "gallery") : {};
}

export default async function Page({ params }: Props) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const t = getT(locale);
  // Pictures, captions and the video come from the media manifest; the page names no file.
  const view = buildGalleryView(media, locale);
  return (
    <div className="night gal-page">
      <ToolHead n={ROUTES.gallery.n} title={t("nav.items.gallery.label")} lede={t("gallery.lede")} />
      <I18n locale={locale} namespaces={["gallery"]}>
        <Gallery view={view} />
      </I18n>
    </div>
  );
}
