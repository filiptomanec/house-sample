// Placeholder page: the page agent replaces it. Keep generateMetadata (title, description, hreflang).
import { notFound } from "next/navigation";
import { ToolHead } from "@/components/ui/controls";
import { buildMetadata } from "@/lib/i18n/metadata";
import { isLocale } from "@/lib/i18n/config";
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
  return <ToolHead n={ROUTES.model.n} title={t("nav.items.model.label")} lede={t("model.lede")} />;
}
