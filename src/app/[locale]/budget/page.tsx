// The Budget page: quantities measured from the house model, unit prices from the price book, editable by the visitor (see
// docs/CALC-API.md, section 8). The frame of every tool page: ToolHead, the instrument (BudgetTool, a client component),
// MethodNote (rendered here on the server) and NextTool.
import { notFound } from "next/navigation";
import siteJson from "@model/site.json";
import BudgetTool from "@/components/budget/BudgetTool";
import { BudgetMethod } from "@/components/budget/Method";
import { MethodNote, NextTool, ToolHead } from "@/components/ui/controls";
import { defaultPricebook, deriveQuantities } from "@/lib/calc/budget";
import { isLocale } from "@/lib/i18n/config";
import { getFormatter } from "@/lib/i18n/format";
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

// The plot is only needed for the quantities of the plot (fences, gates, planting, grading), so they are measured here on the
// server and the browser receives the finished numbers instead of the site code.
const quantities = deriveQuantities(house, derived, createSite(siteJson, house.location.houseAxisBearingDeg), { metrics });

export default async function Page({ params }: Props) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const t = getT(locale);
  const f = getFormatter(locale);
  return (
    <>
      <ToolHead n={ROUTES.budget.n} kicker={t("nav.items.budget.label")} title={t("budget.title")} lede={t("budget.lede")} />
      <I18n locale={locale} namespaces={["budget"]}>
        <BudgetTool base={quantities} />
      </I18n>
      <MethodNote title={t("common.method.title")}>
        <BudgetMethod book={defaultPricebook()} t={t} f={f} />
      </MethodNote>
      <NextTool from="budget" t={t} />
    </>
  );
}
