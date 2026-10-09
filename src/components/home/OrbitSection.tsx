"use client";
// The camera circles the house as the page scrolls: one frame per scroll position, shown whole (a moving camera must not be
// cross-faded). A caption is bound to the camera azimuth of the frame ON THE CANVAS: it names a feature (terrace, roof, entrance,
// garage, pool) only while the camera looks at it (captionAt, timeline.ts), and nothing in between. The last part of the turn
// offers the 3D tour. Reduced motion lists every caption under the first frame.

import IntentLink from "@/components/ui/IntentLink";
import type { FrameSet } from "@/lib/data/media";
import ScrollFrames, { type FrameSetX } from "./ScrollFrames";
import { captionAt, type OrbitPath } from "./timeline";

/** Height of the pinned section in svh. */
const ORBIT_HEIGHT = 380;
/** Progress from which the link to the 3D tour shows (the end of the turn). */
const CTA_FROM = 0.86;

export interface OrbitCaption {
  key: string;
  title: string;
  text: string;
  /** House azimuth from which the camera sees the feature best (homeFacts.features). */
  az: number;
}

export default function OrbitSection({ frames, captions, alt, path, cta }: {
  frames: FrameSet | FrameSetX;
  /** In the order the camera meets them (orbitOrder). */
  captions: OrbitCaption[];
  alt: string;
  path: OrbitPath;
  /** The 3D tour; `heavy` routes are prefetched on intent only. */
  cta: { href: string; label: string; heavy?: boolean };
}) {
  // made once per render of OrbitSection, not per scroll frame: React skips the unchanged text and the link (see DayHero)
  const bodies = captions.map((c) => <><h3 className="h2">{c.title}</h3><p className="lede">{c.text}</p></>);
  const link = (on: boolean) => <IntentLink className="btn ghost sm orbit-cta" href={cta.href} heavy={cta.heavy} data-on={on}>{cta.label}</IntentLink>;
  const ctaOn = link(true), ctaOff = link(false);
  return (
    <ScrollFrames frames={frames} stillIndex={0} height={ORBIT_HEIGHT} blend={false} alt={alt} className="orbit-sf" navTone="clear">
      {({ progress, drawn, still }) => {
        const active = still ? -1 : captionAt(drawn, captions, path);
        const end = still || progress >= CTA_FROM;
        return (
          <div className="orbit-caps">
            <div className="orbit-list">
              {captions.map((c, i) => (
                <div key={c.key} className="orbit-cap shell" data-on={i === active}>{bodies[i]}</div>
              ))}
            </div>
            <div className="orbit-foot shell">
              <div className="orbit-bar" aria-hidden><i style={{ transform: `scaleX(${progress})` }} /></div>
              {end ? ctaOn : ctaOff}
            </div>
          </div>
        );
      }}
    </ScrollFrames>
  );
}
