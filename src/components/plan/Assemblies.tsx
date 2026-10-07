import Link from "next/link";
import type { CSSProperties } from "react";
import type { Locale } from "@/lib/i18n/config";
import { getFormatter } from "@/lib/i18n/format";
import { rich } from "@/lib/i18n/rich";
import { getT } from "@/lib/i18n/server";
import type { AssemblyCard, MaterialRow } from "@/lib/plan/assemblies";
import { routePath } from "@/lib/routes";
import type { House } from "@/lib/model/types";

/** Cards of the constructions (layers, thickness, share of the resistance, U-value) and the legend of materials. Server component: no client code. */
export function Assemblies({ locale, cards, materials, windows }: { locale: Locale; cards: readonly AssemblyCard[]; materials: readonly MaterialRow[]; windows: House["windows"] }) {
  const t = getT(locale), f = getFormatter(locale);
  const uUnit = "W/(m²·K)";
  const specs: { label: string; value: string }[] = [
    { label: t("plan.asm.windows"), value: t("plan.asm.windowSpec", { uw: f.unit(windows.Uw, uUnit, 2), g: f.num(windows.g, 2) }) },
    ...(windows.slider ? [{ label: t("plan.asm.sliders"), value: t("plan.asm.windowSpec", { uw: f.unit(windows.slider.Uw, uUnit, 2), g: f.num(windows.slider.g, 2) }) }] : []),
    { label: t("plan.asm.doors"), value: t("plan.asm.doorSpec", { ud: f.unit(windows.Ud, uUnit, 2) }) },
  ];
  return (
    <section className="shell section-sm pl-section" aria-labelledby="plan-asm">
      <h2 className="h2" id="plan-asm">{t("plan.asm.title")}</h2>
      <p className="note pl-asm-intro">{t("plan.asm.intro")}</p>
      <div className="pl-asm-grid">
        {cards.map((c) => (
          <article key={c.key} className="panel panel-pad pl-asm">
            <h3 className="h3">{c.name}</h3>
            <p className="pl-asm-u">
              <span className="small">{t("plan.asm.u")}{" ="}</span><b>{f.num(c.u, 3)}</b><span className="small">{uUnit}</span>
              <span className="small">{t("plan.asm.r")}{" = "}{f.num(c.r, 2)}{" m²·K/W"}</span>
            </p>
            <ol className="pl-layers">
              {c.layers.map((l, i) => (
                <li key={i} className="pl-layer" data-ignored={l.ignored ? "true" : undefined}>
                  <span>{l.name}{l.ignored && <small> · {t("plan.asm.ignored")}</small>}</span>
                  <span className="mono">{f.num(l.thickness * 1000, l.thickness < 0.01 ? 1 : 0)}{" mm"}</span>
                  <span className="bar" aria-hidden="true"><i style={{ width: `${Math.round(l.share * 1000) / 10}%` }} /></span>
                </li>
              ))}
            </ol>
            <p className="note">{t("plan.asm.total", { thickness: f.unit(c.thickness * 1000, "mm") })}</p>
            {c.ventilated && <p className="note">{t("plan.asm.ventilated")}</p>}
            {c.key === "ceiling" && <p className="note">{t("plan.asm.ceilingNote")}</p>}
            {c.key === "groundFloor" && (
              <p className="note">{rich(t("plan.asm.floorNote"), { a: (x) => <Link className="link" href={routePath(locale, "energy")}>{x}</Link> })}</p>
            )}
          </article>
        ))}
      </div>
      <div className="pl-materials">
        <div>
          <h3 className="label">{t("plan.asm.materials")}</h3>
          <ul className="pl-swatches">
            {materials.map((m) => <li key={m.role}><span className="dot" style={{ "--dot": m.color } as CSSProperties} aria-hidden="true" />{m.name}</li>)}
          </ul>
        </div>
        <div className="kv">
          {specs.flatMap((s) => [<span key={`${s.label}-l`}>{s.label}</span>, <span key={`${s.label}-v`} className="pl-spec">{s.value}</span>])}
        </div>
      </div>
    </section>
  );
}
