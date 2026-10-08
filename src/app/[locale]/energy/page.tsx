// The Energy page: heat demand, photovoltaics and savings of the house from adjustable assumptions (see docs/CALC-API.md).
// The frame of every tool page: ToolHead, the instrument (EnergyTool, a client component with the figure strip, the settings
// rail and the results), MethodNote and NextTool. The method text is rendered here on the server.
import { notFound } from "next/navigation";
import EnergyTool from "@/components/energy/EnergyTool";
import { EnergyMethod } from "@/components/energy/Method";
import { MethodNote, NextTool, ToolHead } from "@/components/ui/controls";
import { defaultEnergyContext } from "@/lib/calc/energy";
import { isLocale } from "@/lib/i18n/config";
import { getFormatter } from "@/lib/i18n/format";
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
  const f = getFormatter(locale);
  return (
    <>
      <ToolHead n={ROUTES.energy.n} kicker={t("nav.items.energy.label")} title={t("energy.title")} lede={t("energy.lede")} />
      <I18n locale={locale} namespaces={["energy"]}>
        <EnergyTool />
      </I18n>
      <MethodNote title={t("common.method.title")}>
        <EnergyMethod ctx={defaultEnergyContext()} t={t} f={f} />
      </MethodNote>
      <NextTool from="energy" t={t} />
    </>
  );
}
