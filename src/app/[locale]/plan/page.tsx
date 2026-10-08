import { notFound } from "next/navigation";
import { Assemblies } from "@/components/plan/Assemblies";
import { PlanTool } from "@/components/plan/PlanTool";
import { MethodNote, NextTool, Stat, ToolHead } from "@/components/ui/controls";
import { buildMetadata } from "@/lib/i18n/metadata";
import { isLocale } from "@/lib/i18n/config";
import { NBSP, getFormatter } from "@/lib/i18n/format";
import { I18n } from "@/lib/i18n/Provider";
import { getT } from "@/lib/i18n/server";
import { derived, house, metrics, siteModel } from "@/lib/model/instance";
import { plotPolygon, polygonArea } from "@/lib/model/site";
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

/** Method paragraphs a later copy pass adds (requested in the WP13 handoff); each shows once its key exists. */
const METHOD_KEYS = ["plan.method.areas", "plan.method.numbers"] as const;

export default async function Page({ params }: Props) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const t = getT(locale), f = getFormatter(locale);
  const materials = style as unknown as StyleMaterials;
  // Everything the page shows is computed here from the model; the client gets plain data in the language of the visitor.
  const view = buildPlanView(house, derived, metrics, materials, locale);
  const floors = derived.rooms.flatMap((r) => (r.floor ? [r.floor] : []));
  const size = metrics.footprintBBox;
  return (
    <>
      <ToolHead n={ROUTES.plan.n} kicker={t("nav.items.plan.label")} title={t("plan.title")} lede={t("plan.lede")} />
      <div className="shell">
        {/* the shared metrics of the house: the same numbers as on Home, Energy and Budget */}
        <div className="stats-4 pl-stats">
          <Stat value={f.num(metrics.heatedArea, 1)} unit={t("plan.table.areaUnit")} label={t("plan.table.totalHeated")} accent />
          <Stat value={metrics.layoutCode} label={t("home.numbers.layout.label")} />
          <Stat value={f.num(metrics.garageArea, 1)} unit={t("plan.table.areaUnit")} label={t("plan.table.garage")} />
          <Stat value={`${f.num(size.w, 1)}${NBSP}×${NBSP}${f.num(size.d, 1)}`} unit={t("home.numbers.size.unit")} label={t("home.numbers.size.label")} />
        </div>
      </div>
      <I18n locale={locale} namespaces={["plan"]}>
        <PlanTool view={view} />
      </I18n>
      <Assemblies locale={locale} cards={buildAssemblyCards(house, locale)} materials={buildMaterialLegend(house, floors, materials, locale)} windows={house.windows} />
      <MethodNote title={t("common.method.title")}>
        {METHOD_KEYS.filter((k) => t.has(k)).map((k) => <p key={k}>{t.dyn(k)}</p>)}
        <p>{t("plan.asm.intro")}</p>
      </MethodNote>
      <NextTool from="plan" t={t} title={t("plot.title", { area: f.area(polygonArea(plotPolygon(siteModel)), 0) })} />
    </>
  );
}
