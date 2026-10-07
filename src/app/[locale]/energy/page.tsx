// The Energy page: heat demand, photovoltaics and savings of the house from adjustable assumptions (see docs/CALC-API.md).
import { notFound } from "next/navigation";
import EnergyTool from "@/components/energy/EnergyTool";
import { ToolHead } from "@/components/ui/controls";
import { isLocale } from "@/lib/i18n/config";
import { buildMetadata } from "@/lib/i18n/metadata";
import { I18n } from "@/lib/i18n/Provider";
import { getT } from "@/lib/i18n/server";
import { ROUTES } from "@/lib/routes";
import "@/styles/pages/energy.css";

type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props) {
  const { locale } = await params;
  return isLocale(locale) ? buildMetadata(locale, "energy") : {};
}

export default async function Page({ params }: Props) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const t = getT(locale);
  return (
    <I18n locale={locale} namespaces={["energy"]}>
      <ToolHead n={ROUTES.energy.n} title={t("nav.items.energy.label")} lede={t("energy.lede")} />
      <EnergyTool />
    </I18n>
  );
}
