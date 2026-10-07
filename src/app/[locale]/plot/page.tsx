import { notFound } from "next/navigation";
import { PlotFacts } from "@/components/plot/PlotFacts";
import { PlotRules } from "@/components/plot/PlotRules";
import { PlotTool } from "@/components/plot/PlotTool";
import { buildPlotView } from "@/components/plot/view";
import { ToolHead } from "@/components/ui/controls";
import { buildMetadata } from "@/lib/i18n/metadata";
import { isLocale } from "@/lib/i18n/config";
import { I18n } from "@/lib/i18n/Provider";
import { getT } from "@/lib/i18n/server";
import { derived, house } from "@/lib/model/instance";
import { ROUTES } from "@/lib/routes";
import siteJson from "@model/site.json";
import "@/styles/pages/plot.css";

type Props = { params: Promise<{ locale: string }> };

// Everything on the page is computed from the house model and model/site.json when the page is built; the client gets plain data.
const view = buildPlotView(house, derived, siteJson);

export async function generateMetadata({ params }: Props) {
  const { locale } = await params;
  return isLocale(locale) ? buildMetadata(locale, "plot") : {};
}

export default async function Page({ params }: Props) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const t = getT(locale);
  return (
    <>
      <ToolHead n={ROUTES.plot.n} title={t("nav.items.plot.label")} lede={t("plot.lede")} />
      <I18n locale={locale} namespaces={["plot"]}>
        <PlotTool view={view} facts={<PlotFacts view={view} locale={locale} />} />
      </I18n>
      <PlotRules view={view} locale={locale} />
    </>
  );
}
