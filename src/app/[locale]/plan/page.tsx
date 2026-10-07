import { notFound } from "next/navigation";
import { Assemblies } from "@/components/plan/Assemblies";
import { PlanTool } from "@/components/plan/PlanTool";
import { ToolHead } from "@/components/ui/controls";
import { buildMetadata } from "@/lib/i18n/metadata";
import { isLocale } from "@/lib/i18n/config";
import { I18n } from "@/lib/i18n/Provider";
import { getT } from "@/lib/i18n/server";
import { derived, house, metrics } from "@/lib/model/instance";
import { buildAssemblyCards, buildMaterialLegend } from "@/lib/plan/assemblies";
import { buildPlanView, type StyleMaterials } from "@/lib/plan/view";
import { ROUTES } from "@/lib/routes";
import style from "@model/style.json";
import "@/styles/pages/plan.css";

type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props) {
  const { locale } = await params;
  return isLocale(locale) ? buildMetadata(locale, "plan") : {};
}

export default async function Page({ params }: Props) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const t = getT(locale);
  const materials = style as unknown as StyleMaterials;
  // Everything the page shows is computed here from the model; the client gets plain data in the language of the visitor.
  const view = buildPlanView(house, derived, metrics, materials, locale);
  const floors = derived.rooms.flatMap((r) => (r.floor ? [r.floor] : []));
  return (
    <>
      <ToolHead n={ROUTES.plan.n} title={t("plan.title", { rooms: t("common.count.rooms", { count: derived.rooms.length }) })} lede={t("plan.lede")} />
      <I18n locale={locale} namespaces={["plan"]}>
        <PlanTool view={view} />
      </I18n>
      <Assemblies locale={locale} cards={buildAssemblyCards(house, locale)} materials={buildMaterialLegend(house, floors, materials, locale)} windows={house.windows} />
    </>
  );
}
