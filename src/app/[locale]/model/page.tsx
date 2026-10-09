// The 3D model page: the frame of every tool page (ToolHead, the instrument, MethodNote, NextTool) around the interactive
// scene (three.js is loaded by the Stage after the page shell has painted) and the export section (STL for 3D printing,
// AR Quick Look, GLB). Texts: namespace "model"; data: the house model.
import "@/styles/pages/model.css";
import { notFound } from "next/navigation";
import ModelTool from "@/components/model/ModelTool";
import { MethodNote, NextTool, ToolHead } from "@/components/ui/controls";
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
        kicker={t("nav.items.model.label")}
        title={t("model.title")}
        lede={t("model.lede")}
        aside={<a className="link-arrow" href="#export">{t("model.exportLink")}</a>}
      />
      <I18n locale={locale} namespaces={["model"]}>
        <ModelTool />
      </I18n>
      <MethodNote title={t("common.method.title")}>
        <p>{t("model.method.data")}</p>
        <p>{t("model.method.light")}</p>
      </MethodNote>
      <NextTool from="model" t={t} />
    </>
  );
}
