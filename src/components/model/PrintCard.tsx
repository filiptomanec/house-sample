"use client";
// The printable model: scale, base, what to include, the size of the print and the STL download. The mesh is built from the
// model data (calc/printModel.ts), not from the GLB; this component only chooses options and shows the report.
import { useMemo, useState } from "react";
import { Segmented, Switch } from "@/components/ui/controls";
import { useFormat, useT } from "@/lib/i18n/client";
import { derived } from "@/lib/model/instance";
import { getHouseContext } from "@/lib/three/context";
import {
  PRINT_DEFAULTS, PRINT_SCALES, PRINT_SCALE_RANGE, buildPrintMesh, checkBedFit, reportOfMesh, toBinaryStl, type PrintGround,
} from "@/lib/calc/printModel";
import { downloadBlob } from "./download";

const GROUNDS: PrintGround[] = ["plate", "terrain", "none"];
/** Starting scale: the largest preset on which the default print fits the bed is found below; this is only the preference. */
const PREFERRED_SCALE: number = PRINT_SCALES[1];

type Result = { kind: "done" | "failed" | "building"; name?: string } | null;

export default function PrintCard() {
  const t = useT(), f = useFormat();
  const [preferred, setPreferred] = useState(PREFERRED_SCALE);
  const [ground, setGround] = useState<PrintGround>("plate");
  const [outdoor, setOutdoor] = useState(true);
  const [result, setResult] = useState<Result>(null);

  // The mesh depends on the base and the outdoor areas only; the scale just divides it (a few milliseconds, with terrain a few tens).
  const mesh = useMemo(() => buildPrintMesh(derived, getHouseContext().site, { ground, outdoor }), [ground, outdoor]);

  // the smallest preset at or above the preferred scale on which the print fits the bed; none: the largest denominator
  const fitting = PRINT_SCALES.find((s) => s >= preferred && checkBedFit(mesh, s).fits);
  const scale = fitting ?? PRINT_SCALE_RANGE.max;
  const report = reportOfMesh(mesh, { scale });
  const bed = f.unit(report.bedMm, "mm");
  const scaleText = (s: number) => t("model.export.print.scaleOption", { scale: s });
  const kb = report.bytes >= 1e6 ? f.unit(report.bytes / 1e6, "MB", 1) : f.unit(report.bytes / 1e3, "kB", 0);
  const groundLabel: Record<PrintGround, string> = {
    none: t("model.export.print.groundNone"), plate: t("model.export.print.groundPlate"), terrain: t("model.export.print.groundTerrain"),
  };

  const download = () => {
    setResult({ kind: "building" });
    // let the status paint before the (short) synchronous work
    setTimeout(() => {
      const name = `house-sample-1-${scale}.stl`;
      try {
        downloadBlob(toBinaryStl(mesh, scale), name, "model/stl");
        setResult({ kind: "done", name });
      } catch (error) {
        console.error("STL export failed", error);
        setResult({ kind: "failed" });
      }
    }, 0);
  };

  return (
    <div id="tisk" className="panel panel-pad stack">
      <h3 className="h3">{t("model.export.print.title")}</h3>
      <p className="small">{t("model.export.print.text")}</p>
      <Segmented
        label={t("model.export.print.scale")} value={scale}
        options={PRINT_SCALES.map((s) => ({ value: s as number, label: scaleText(s) }))}
        onChange={setPreferred}
      />
      <Segmented
        label={t("model.export.print.ground")} value={ground}
        options={GROUNDS.map((g) => ({ value: g, label: groundLabel[g] }))}
        onChange={(g) => { setGround(g); setResult(null); }}
      />
      <p className="note">{t("model.export.print.groundHint", { margin: f.length(PRINT_DEFAULTS.terrainMarginM, 0) })}</p>
      <Switch label={t("model.export.print.outdoor")} checked={outdoor} onChange={(o) => { setOutdoor(o); setResult(null); }} />

      <dl className="kv">
        <dt>{t("model.export.print.size")}</dt>
        <dd>{t("model.export.print.sizeValue", { x: f.num(report.sizeMm[0]), y: f.num(report.sizeMm[1]), z: f.num(report.sizeMm[2]) })}</dd>
        <dt>{t("model.export.print.triangles")}</dt>
        <dd>{f.int(report.triangles)}</dd>
        <dt>{t("model.export.print.fileSize")}</dt>
        <dd>{kb}</dd>
        <dt>{t("model.export.print.bed")}</dt>
        <dd>{bed}</dd>
      </dl>

      <div aria-live="polite">
        {!report.fits && <p className="note warn">{t("model.export.print.tooBig", { bed, scale: scaleText(scale) })}</p>}
        {report.fits && scale !== preferred && <p className="note">{t("model.export.print.autoScaled", { bed, scale: scaleText(scale) })}</p>}
        {result?.kind === "building" && <p className="note">{t("model.export.print.building")}</p>}
        {result?.kind === "done" && <p className="note">{t("model.export.print.done", { name: result.name ?? "" })}</p>}
        {result?.kind === "failed" && <p className="note warn">{t("model.export.print.failed")}</p>}
      </div>
      <button type="button" className="btn" onClick={download}>{t("model.export.print.download")}</button>
    </div>
  );
}
