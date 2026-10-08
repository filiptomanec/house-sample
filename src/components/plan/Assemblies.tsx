import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";
import type { Locale } from "@/lib/i18n/config";
import { NBSP, getFormatter } from "@/lib/i18n/format";
import { accent, rich } from "@/lib/i18n/rich";
import { getT } from "@/lib/i18n/server";
import type { AssemblyCard, MaterialRow } from "@/lib/plan/assemblies";
import { routePath } from "@/lib/routes";
import type { House } from "@/lib/model/types";

/** A dictionary string that a later copy pass adds (requested in the WP13 handoff): shown once it exists, else nothing. */
const optional = (t: ReturnType<typeof getT>, key: string): string | null => (t.has(key) ? t.dyn(key) : null);

/**
 * The constructions in two groups: the thermal envelope (the U-value is the figure that matters) and the rest (internal
 * walls, the roof over a cold loft: their thickness is the figure, the U-value is small print). Each card has a to-scale
 * section strip (every layer as wide as it is thick, insulation hatched, layers outside a ventilated gap outlined), the
 * layers and their thicknesses, and its notes. Below: the materials of the plan and facade and the window and door specs.
 * Server component: no client code.
 */
export function Assemblies({ locale, cards, materials, windows }: { locale: Locale; cards: readonly AssemblyCard[]; materials: readonly MaterialRow[]; windows: House["windows"] }) {
  const t = getT(locale), f = getFormatter(locale);
  const uUnit = t("energy.units.u"), rUnit = t("plan.asm.rUnit");
  const sub = { sub: (x: ReactNode) => <sub>{x}</sub> };
  const specs: { label: string; value: ReactNode }[] = [
    { label: t("plan.asm.windows"), value: rich(t("plan.asm.windowSpecRich", { uw: f.unit(windows.Uw, uUnit, 2), g: f.num(windows.g, 2) }), sub) },
    ...(windows.slider ? [{ label: t("plan.asm.sliders"), value: rich(t("plan.asm.windowSpecRich", { uw: f.unit(windows.slider.Uw, uUnit, 2), g: f.num(windows.slider.g, 2) }), sub) }] : []),
    { label: t("plan.asm.doors"), value: rich(t("plan.asm.doorSpecRich", { ud: f.unit(windows.Ud, uUnit, 2) }), sub) },
  ];
  const mm = (m: number) => f.unit(m * 1000, "mm", 0, 1);

  const card = (c: AssemblyCard) => {
    const total = c.layers.reduce((s, l) => s + l.thickness, 0) || 1;
    return (
      <article key={c.key} className="panel panel-pad pl-asm" data-envelope={c.envelope}>
        <h3 className="pl-asm-name">{c.name}</h3>
        <div className="pl-strip" role="img" aria-label={t("plan.asm.total", { thickness: mm(c.thickness) })}>
          <div className="pl-strip-bar">
            {c.layers.map((l, i) => (
              <span key={i} className="pl-strip-layer" data-role={l.role ?? "other"} data-ignored={l.ignored ? "true" : undefined}
                style={{ "--w": `${Math.round((l.thickness / total) * 10000) / 100}%` } as CSSProperties} />
            ))}
          </div>
          <span className="pl-strip-total mono">{mm(c.thickness)}</span>
        </div>
        {c.envelope ? (
          <p className="pl-asm-fig">
            <span className="pl-asm-k">{t("plan.asm.u")}{" ="}</span><b>{f.num(c.u, 3)}</b><span className="pl-asm-unit">{NBSP}{uUnit}</span>
            <span className="pl-asm-r">{t("plan.asm.r")}{" = "}{f.unit(c.r, rUnit, 2)}</span>
          </p>
        ) : (
          <p className="pl-asm-fig">
            <b>{f.num(c.thickness * 1000, 0, 1)}</b><span className="pl-asm-unit">{NBSP}mm</span>
            <span className="pl-asm-r">{t("plan.asm.u")}{" = "}{f.unit(c.u, uUnit, 3)}</span>
          </p>
        )}
        <ol className="pl-layers">
          {c.layers.map((l, i) => (
            <li key={i} className="pl-layer" data-ignored={l.ignored ? "true" : undefined}>
              <span className="pl-layer-sw" data-role={l.role ?? "other"} aria-hidden="true" />
              <span>{l.name}{l.ignored && <small> · {t("plan.asm.ignored")}</small>}</span>
              <span className="mono">{mm(l.thickness)}</span>
            </li>
          ))}
        </ol>
        {c.ventilated && <p className="note">{t("plan.asm.ventilated")}</p>}
        {c.key === "ceiling" && c.envelope && <p className="note">{t("plan.asm.ceilingNote")}</p>}
        {c.key === "groundFloor" && (
          <p className="note">{rich(t("plan.asm.floorNote"), { a: (x) => <Link className="link" href={routePath(locale, "energy")}>{x}</Link> })}</p>
        )}
      </article>
    );
  };

  const groups = [
    { key: "envelope", title: optional(t, "plan.asm.envelope"), note: optional(t, "plan.asm.envelopeNote"), cards: cards.filter((c) => c.envelope) },
    { key: "other", title: optional(t, "plan.asm.other"), note: optional(t, "plan.asm.otherNote"), cards: cards.filter((c) => !c.envelope) },
  ].filter((g) => g.cards.length > 0);

  return (
    <section className="shell pl-section pl-asm-section" aria-labelledby="plan-asm">
      <h2 className="h2" id="plan-asm">{accent(t("plan.asm.title"))}</h2>
      {groups.map((g) => (
        <div key={g.key} className="pl-asm-group" data-group={g.key}>
          {(g.title || g.note) && (
            <div className="pl-asm-group-head">
              {g.title && <h3 className="label">{g.title}</h3>}
              {g.note && <p className="note">{g.note}</p>}
            </div>
          )}
          <div className="pl-asm-grid">{g.cards.map(card)}</div>
        </div>
      ))}
      <div className="pl-materials">
        <h3 className="label">{t("plan.asm.materials")}</h3>
        <ul className="pl-swatches">
          {materials.map((m) => <li key={m.role}><span className="pl-swatch" style={{ "--sw": m.color } as CSSProperties} aria-hidden="true" />{m.name}</li>)}
        </ul>
        <dl className="pl-specs">
          {specs.map((s) => <div key={s.label}><dt>{s.label}</dt><dd>{s.value}</dd></div>)}
        </dl>
      </div>
    </section>
  );
}
