// The Sun page: the sun's path and the shadows on the house for any day and hour, with hours of direct sun on the terraces and
// in the rooms from a ray-cast analysis. The scene and the analysis run in the browser (three.js is loaded by the Stage after
// the page shell has painted). Texts: namespace "sun"; data: the house model, the site and the calc modules.
import "@/styles/pages/sun.css";
import { notFound } from "next/navigation";
import assumptions from "@model/assumptions.json";
import SunTool from "@/components/sun/SunTool";
import { ToolHead } from "@/components/ui/controls";
import { buildMetadata } from "@/lib/i18n/metadata";
import { isLocale } from "@/lib/i18n/config";
import { getFormatter } from "@/lib/i18n/format";
import { I18n } from "@/lib/i18n/Provider";
import { getT } from "@/lib/i18n/server";
import { house } from "@/lib/model/instance";
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
      <ToolHead
        n={ROUTES.sun.n}
        title={t("sun.title")}
        lede={t("sun.lede")}
      />
      <I18n locale={locale} namespaces={["sun"]}>
        <SunTool year={YEAR} />
      </I18n>
    </>
  );
}
