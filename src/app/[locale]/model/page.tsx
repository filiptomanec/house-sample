// The 3D model page: the interactive scene (three.js is loaded by the Stage after the page shell has painted), then the
// export section (STL for 3D printing, AR Quick Look, GLB). Texts: namespace "model"; data: the house model.
import "@/styles/pages/model.css";
import { notFound } from "next/navigation";
import ModelTool from "@/components/model/ModelTool";
import { ToolHead } from "@/components/ui/controls";
import { buildMetadata } from "@/lib/i18n/metadata";
import { isLocale } from "@/lib/i18n/config";
import { I18n } from "@/lib/i18n/Provider";
import { getT } from "@/lib/i18n/server";
import { ROUTES } from "@/lib/routes";

type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props) {
  const { locale } = await params;
  return isLocale(locale) ? buildMetadata(locale, "model") : {};
}

export default async function Page({ params }: Props) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const t = getT(locale);
  return (
    <>
      <ToolHead
        n={ROUTES.model.n}
        title={t("nav.items.model.label")}
        lede={t("model.lede")}
        aside={<a className="link-arrow" href="#export">{t("model.exportLink")}</a>}
      />
      <I18n locale={locale} namespaces={["model"]}>
        <ModelTool />
      </I18n>
    </>
  );
}
