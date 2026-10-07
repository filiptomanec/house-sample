"use client";
// The camera circles the house as the page scrolls: one frame per scroll position, shown whole (a moving camera must not be
// cross-faded), with captions spread evenly over the turn.

import type { FrameSet } from "@/lib/data/media";
import ScrollFrames from "./ScrollFrames";
import { captionIndex } from "./timeline";

/** Height of the pinned section in svh. */
const ORBIT_HEIGHT = 380;

export interface OrbitCaption { key: string; title: string; text: string }

export default function OrbitSection({ frames, captions, alt }: { frames: FrameSet; captions: OrbitCaption[]; alt: string }) {
  return (
    <ScrollFrames frames={frames} stillIndex={0} height={ORBIT_HEIGHT} blend={false} alt={alt} className="orbit-sf">
      {({ progress }) => {
        const active = captionIndex(progress, captions.length);
        return (
          <div className="orbit-caps">
            <div className="orbit-list">
              {captions.map((c, i) => (
                <div key={c.key} className="orbit-cap shell" data-on={i === active}>
                  <h3 className="h2">{c.title}</h3>
                  <p className="lede">{c.text}</p>
                </div>
              ))}
            </div>
            <div className="orbit-bar" aria-hidden><i style={{ transform: `scaleX(${progress})` }} /></div>
          </div>
        );
      }}
    </ScrollFrames>
  );
}
