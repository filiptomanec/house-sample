"use client";
// The controls drawn over the 3D view: how a drag moves the camera, the walk button, and the readout (section height,
// walking help). The Stage places them as children; model.css positions them.
import { useT } from "@/lib/i18n/client";

export interface StageToolsProps {
  pan: boolean;
  onPan: (pan: boolean) => void;
  walking: boolean;
  onWalk: () => void;
  /** The 3D scene is ready (the walk needs it). */
  ready: boolean;
  /** Section height shown as a readout, or null without a section. */
  cutText: string | null;
}

export default function StageTools({ pan, onPan, walking, onWalk, ready, cutText }: StageToolsProps) {
  const t = useT();
  return (
    <>
      <div className="model-tools">
        {!walking && (
          <div className="seg" role="group" aria-label={t("model.mode.label")}>
            <button type="button" aria-pressed={!pan} onClick={() => onPan(false)}>{t("model.mode.rotate")}</button>
            <button type="button" aria-pressed={pan} onClick={() => onPan(true)}>{t("model.mode.pan")}</button>
          </div>
        )}
        <button type="button" className="btn sm model-walk" onClick={onWalk} disabled={!ready}>
          {walking ? t("model.walk.stop") : t("model.walk.start")}
        </button>
      </div>
      <div className="model-hud">
        {walking ? (
          <p role="status">
            <span className="only-fine">{t("model.walk.hintMouse")}</span>
            <span className="only-coarse">{t("model.walk.hintTouch")}</span>
          </p>
        ) : cutText ? (
          <p className="num">{cutText}</p>
        ) : null}
      </div>
    </>
  );
}
