// The Sun page: the sun's path and the shadows on the house for any day and hour, with hours of direct sun on the terraces and
// in the rooms from a ray-cast analysis. The scene and the analysis run in the browser (three.js is loaded by the Stage after
// the page shell has painted). The frame of every tool page: ToolHead, the instrument, MethodNote, NextTool.
// Texts: namespace "sun"; data: the house model, the site and the calc modules.
import "@/styles/pages/sun.css";
import { notFound } from "next/navigation";
import assumptions from "@model/assumptions.json";
import { ANALYSIS_STEP_MIN } from "@/components/sun/model";
import SunTool from "@/components/sun/SunTool";
import { MethodNote, NextTool, ToolHead } from "@/components/ui/controls";
import { buildMetadata } from "@/lib/i18n/metadata";
import { isLocale } from "@/lib/i18n/config";
import { getFormatter } from "@/lib/i18n/format";
import { I18n } from "@/lib/i18n/Provider";
import { getT } from "@/lib/i18n/server";
import { ROUTES } from "@/lib/routes";

type Props = { params: Promise<{ locale: string }> };

/** The calendar year of the climate data: the year whose days the page offers (leap years and clock changes follow from it). */
const YEAR: number = assumptions.climate.referenceYear;

export async function generateMetadata({ params }: Props) {
  const { locale } = await params;
  return isLocale(locale) ? buildMetadata(locale, "sun") : {};
}

export default async function Page({ params }: Props) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const t = getT(locale);
  const f = getFormatter(locale);
  return (
    <>
      <ToolHead n={ROUTES.sun.n} kicker={t("nav.items.sun.label")} title={t("sun.title")} lede={t("sun.lede")} />
      <I18n locale={locale} namespaces={["sun"]}>
        <SunTool year={YEAR} />
      </I18n>
      <MethodNote title={t("common.method.title")}>
        <p>{t("sun.method.body", { step: f.int(ANALYSIS_STEP_MIN) })}</p>
        <p>{t("sun.results.note")}</p>
        <p>{t("sun.results.note2")}</p>
      </MethodNote>
      <NextTool from="sun" t={t} />
    </>
  );
}
