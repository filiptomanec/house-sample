"use client";
import { useEffect, useRef, useState } from "react";
import { useFormat, useT } from "@/lib/i18n/client";
import type { Formatter } from "@/lib/i18n/format";
import type { GalleryVideo } from "./filter";

/** Length as the native player shows it, whole seconds rounded down: 9.7 s is 0:09. Formatter.clock reads minutes as h:mm, so seconds in give m:ss. */
export const mmss = (f: Formatter, seconds: number): string => f.clock(Math.floor(seconds));

/**
 * The orbit video: a poster with a play button of our own; the native controls (fullscreen, scrubbing, AirPlay) appear after
 * the first tap. `playsInline` keeps iPhone from jumping to fullscreen by itself, `preload="metadata"` loads only the head
 * of the file, and the length shown is the one from the file's metadata (the manifest value until it arrives).
 */
export function VideoPlayer({ video }: { video: GalleryVideo }) {
  const t = useT(), f = useFormat();
  const el = useRef<HTMLVideoElement>(null);
  const [started, setStarted] = useState(false);
  const [failed, setFailed] = useState(false);
  const [length, setLength] = useState(video.durationS);

  // metadata can arrive before hydration, when onLoadedMetadata is not attached yet
  useEffect(() => {
    const v = el.current;
    if (v && v.readyState >= 1 && Number.isFinite(v.duration)) setLength(v.duration);
  }, []);

  const play = () => {
    const v = el.current;
    setStarted(true);
    if (!v) return;
    v.controls = true;
    v.play().catch(() => { /* blocked or interrupted: the native controls are there now */ });
  };

  const title = t("gallery.video.title");
  return (
    <figure className="gal-video">
      <div className="gal-video-stage" style={{ aspectRatio: `${video.width} / ${video.height}` }}>
        <video ref={el} src={video.src} poster={video.poster} width={video.width} height={video.height} controls={started} playsInline preload="metadata"
          aria-label={title} onLoadedMetadata={(e) => { const d = e.currentTarget.duration; if (Number.isFinite(d)) setLength(d); }} onError={() => setFailed(true)} />
        {!started && (
          <button type="button" className="gal-play" onClick={play} aria-label={t("gallery.video.play", { title, length: mmss(f, length) })}>
            <span className="gal-play-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" width="26" height="26"><path d="M8 5.2v13.6L19 12z" fill="currentColor" /></svg>
            </span>
            <span className="gal-play-tag mono" aria-hidden="true">{t("gallery.video.tag")} · {mmss(f, length)}</span>
          </button>
        )}
        {failed && <p className="gal-video-error" role="alert">{t("gallery.video.error")}</p>}
      </div>
      <figcaption className="small">{title}</figcaption>
    </figure>
  );
}
