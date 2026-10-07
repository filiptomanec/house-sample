// The Budget page: quantities measured from the house model, unit prices from the price book, editable by the visitor (see docs/CALC-API.md, section 8).
import { notFound } from "next/navigation";
import siteJson from "@model/site.json";
import BudgetTool from "@/components/budget/BudgetTool";
import { ToolHead } from "@/components/ui/controls";
import { deriveQuantities } from "@/lib/calc/budget";
import { isLocale } from "@/lib/i18n/config";
import { buildMetadata } from "@/lib/i18n/metadata";
import { I18n } from "@/lib/i18n/Provider";
import { getT } from "@/lib/i18n/server";
import { derived, house, metrics } from "@/lib/model/instance";
import { createSite } from "@/lib/model/site";
import { ROUTES } from "@/lib/routes";
import "@/styles/pages/budget.css";

type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props) {
  const { locale } = await params;
  return isLocale(locale) ? buildMetadata(locale, "budget") : {};
}

// The plot is only needed for the quantities of the plot (fences, planting, grading), so they are measured here on the server
// and the browser receives the finished numbers instead of the site code.
const quantities = deriveQuantities(house, derived, createSite(siteJson, house.location.houseAxisBearingDeg), { metrics });

export default async function Page({ params }: Props) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const t = getT(locale);
  return (
    <I18n locale={locale} namespaces={["budget"]}>
      <ToolHead n={ROUTES.budget.n} title={t("nav.items.budget.label")} lede={t("budget.lede")} />
      <BudgetTool base={quantities} />
    </I18n>
  );
}
