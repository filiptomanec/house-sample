"use client";
// AR Quick Look (iPhone and iPad) and the download of the light GLB.
import { useSyncExternalStore } from "react";
import { useFormat, useT } from "@/lib/i18n/client";
import { AR_FILE, GLB_FILE, fileBytes, filePath } from "./files";

const noSubscribe = () => () => {};
/** Safari on iOS and iPadOS announces AR Quick Look through `rel="ar"` support; other browsers would only download the file. */
const arSupported = () => {
  try {
    return document.createElement("a").relList.supports("ar");
  } catch {
    return false;
  }
};

/** "0,9 MB" / "307 kB". */
function sizeText(f: ReturnType<typeof useFormat>, bytes: number | null): string {
  if (bytes === null) return "";
  return bytes >= 1e6 ? f.unit(bytes / 1e6, "MB", 1) : f.unit(bytes / 1e3, "kB", 0);
}

export default function ArCard() {
  const t = useT(), f = useFormat();
  // the server and the first client render say "not supported"; useSyncExternalStore switches after hydration
  const ar = useSyncExternalStore(noSubscribe, arSupported, () => false);
  return (
    <div className="panel panel-pad stack">
      <h3 className="h3">{t("model.export.ar.title")}</h3>
      <p className="small">{t("model.export.ar.text")}</p>
      {ar ? (
        <a rel="ar" href={filePath(AR_FILE, false)} className="btn ar-link">
          {/* AR Quick Look takes the first child of the link, which must be an <img>, as the preview */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/icons/icon-192.png" alt="" width={28} height={28} />
          {t("model.export.ar.open")}
          <span className="ar-size">{sizeText(f, fileBytes(AR_FILE))}</span>
        </a>
      ) : (
        <p className="note">{t("model.export.ar.unavailable")}</p>
      )}
      <a className={ar ? "btn ghost" : "btn"} href={filePath(GLB_FILE, true)} download="house-sample.glb">
        {t("model.export.ar.glb")}
        <span className="ar-size">{t("model.export.ar.glbSize", { size: sizeText(f, fileBytes(GLB_FILE)) })}</span>
      </a>
      <p className="note">{t("model.export.ar.glbNote")}</p>
    </div>
  );
}
