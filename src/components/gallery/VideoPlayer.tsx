"use client";
import { useEffect, useRef, useState } from "react";
import { useFormat, useT } from "@/lib/i18n/client";
import type { Formatter } from "@/lib/i18n/format";
import type { GalleryVideo } from "./filter";

/** Length as the native player shows it, whole seconds rounded down: 9.7 s is 0:09. Formatter.clock reads minutes as h:mm, so seconds in give m:ss. */
export const mmss = (f: Formatter, seconds: number): string => f.clock(Math.floor(seconds));

/** Screens up to this width get the phone rendition (also any device that asks to save data). */
export const PHONE_VIDEO_MQ = "(max-width: 900px)";

/** The light rendition for phones (the narrowest), or null when the manifest has only one. */
export function phoneRendition(sources: GalleryVideo["sources"]): GalleryVideo["sources"][number] | null {
  return sources.length > 1 ? sources[sources.length - 1] : null;
}

/**
 * The orbit video: a responsive poster picture (the first frame, so the page paints quickly on a phone) with a play button of
 * our own; the native controls (fullscreen, scrubbing, AirPlay) appear after the first tap. Phones and Save-Data get the light
 * rendition (`<source media>` and a check at play time), `playsInline` keeps iPhone from jumping to fullscreen, `preload="none"`
 * fetches nothing before the tap, and the length shown is the one from the file's metadata once it is known (the manifest value
 * until then). The stage keeps the video's aspect ratio and is never letterboxed: on short screens it narrows instead.
 */
export function VideoPlayer({ video }: { video: GalleryVideo }) {
  const t = useT(), f = useFormat();
  const el = useRef<HTMLVideoElement>(null);
  const [started, setStarted] = useState(false);
  const [failed, setFailed] = useState(false);
  const [length, setLength] = useState(video.durationS);
  const phone = phoneRendition(video.sources);

  // metadata can arrive before hydration, when onLoadedMetadata is not attached yet
  useEffect(() => {
    const v = el.current;
    if (v && v.readyState >= 1 && Number.isFinite(v.duration)) setLength(v.duration);
  }, []);

  const play = () => {
    const v = el.current;
    setStarted(true);
    if (!v) return;
    const saveData = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData === true;
    if (phone && saveData && !matchMedia(PHONE_VIDEO_MQ).matches) {
      v.src = phone.src;
      v.load();
    }
    v.controls = true;
    v.play().catch(() => { /* blocked or interrupted: the native controls are there now */ });
  };

  const title = t("gallery.video.title");
  const poster = video.poster;
  return (
    <figure className="gal-video">
      <div className="gal-video-stage" data-started={started} style={{ aspectRatio: `${video.width} / ${video.height}` }}>
        <video ref={el} width={video.width} height={video.height} controls={started} playsInline preload="none" aria-label={title}
          onLoadedMetadata={(e) => { const d = e.currentTarget.duration; if (Number.isFinite(d)) setLength(d); }} onError={() => setFailed(true)}>
          {phone && <source src={phone.src} type="video/mp4" media={PHONE_VIDEO_MQ} />}
          <source src={video.src} type="video/mp4" />
        </video>
        {!started && (
          <>
            <picture className="gal-poster">
              {poster.sources.map((s) => <source key={s.type} type={s.type} srcSet={s.srcSet} sizes="(max-width: 1440px) 100vw, 1440px" />)}
              <img src={poster.src} srcSet={poster.srcSet} sizes="(max-width: 1440px) 100vw, 1440px" alt="" width={poster.width} height={poster.height} fetchPriority="high" decoding="async" />
            </picture>
            <button type="button" className="gal-play" onClick={play} aria-label={t("gallery.video.play", { title, length: mmss(f, length) })}>
              <span className="gal-play-icon" aria-hidden="true">
                <svg viewBox="0 0 24 24" width="26" height="26"><path d="M8 5.2v13.6L19 12z" fill="currentColor" /></svg>
              </span>
              <span className="gal-play-tag mono" aria-hidden="true">{t("gallery.video.tag")} · {mmss(f, length)}</span>
            </button>
          </>
        )}
        {failed && <p className="gal-video-error" role="alert">{t("gallery.video.error")}</p>}
      </div>
      <figcaption className="small">{title}</figcaption>
    </figure>
  );
}
