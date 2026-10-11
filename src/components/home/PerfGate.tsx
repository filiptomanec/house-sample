"use client";
// The hidden diagnostic mode of the home page: /?perf=1 shows a panel with what the scroll-driven hero costs on the device
// (PerfProbe.tsx). The query parameter is read after mount, so the server render never differs. Without it the gate renders
// nothing, loads nothing more and the player's reports go nowhere (perfSink.ts). DayHero renders the gate BEFORE its
// ScrollFrames, so this effect runs first (React runs the effects of earlier siblings first) and the recorder is in place when
// the player sets up its sequence; the probe chunk arrives later and drains what was recorded meanwhile.

import { useEffect, useState, type ComponentType } from "react";
import { createRecorder, type PerfRecorder } from "./perfSink";

type Probe = { Panel: ComponentType<{ recorder: PerfRecorder }>; recorder: PerfRecorder };

export default function PerfGate() {
  const [probe, setProbe] = useState<Probe | null>(null);
  useEffect(() => {
    if (new URLSearchParams(location.search).get("perf") !== "1") return;
    const recorder = createRecorder();
    globalThis.__hsPerf = recorder.sink;
    let alive = true;
    import("./PerfProbe").then((m) => { if (alive) setProbe({ Panel: m.default, recorder }); }, () => {});
    return () => {
      alive = false;
      if (globalThis.__hsPerf === recorder.sink) globalThis.__hsPerf = undefined;
    };
  }, []);
  return probe ? <probe.Panel recorder={probe.recorder} /> : null;
}
