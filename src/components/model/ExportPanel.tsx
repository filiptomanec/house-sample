"use client";
// The export section of the 3D page: the model for 3D printing (STL), AR Quick Look and the GLB download.
// Anchors: #export for the whole section, #tisk for the printing card.
import { useT } from "@/lib/i18n/client";
import ArCard from "./ArCard";
import PrintCard from "./PrintCard";

export default function ExportPanel() {
  const t = useT();
  return (
    <section id="export" className="section-sm model-export" aria-labelledby="export-title">
      <p className="kicker"><span className="n">{t("model.export.kicker")}</span></p>
      <h2 id="export-title" className="h2">{t("model.export.title")}</h2>
      <div className="export-grid">
        <PrintCard />
        <ArCard />
      </div>
    </section>
  );
}
