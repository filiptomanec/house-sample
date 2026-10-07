"use client";
import { useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { Chips } from "@/components/ui/controls";
import { useFormat, useT } from "@/lib/i18n/client";
import { bento } from "./bento";
import { Lightbox } from "./Lightbox";
import { morph } from "./morph";
import { VideoPlayer } from "./VideoPlayer";
import { matches, type GalleryFilter, type GalleryView } from "./filter";

/** The first tiles are fetched at once (they are in view or just below); the rest load as they approach the screen. */
const EAGER = 3;

/** Filter chips, the orbit video, the bento grid of stills and the lightbox. Everything comes from the manifest through `view`. */
export function Gallery({ view }: { view: GalleryView }) {
  const t = useT(), f = useFormat();
  const [filter, setFilter] = useState<GalleryFilter["id"]>("all");
  const [open, setOpen] = useState<number | null>(null);
  const tiles = useRef<(HTMLButtonElement | null)[]>([]);

  const list = useMemo(() => view.items.filter((i) => matches(i, filter)), [view.items, filter]);
  const layout = useMemo(() => bento(list.length), [list.length]);

  const show = (i: number) => morph(() => flushSync(() => setOpen(i)), tiles.current[i]?.querySelector("img"), "open");
  const close = () => {
    if (open === null) return;
    const tile = tiles.current[open];
    morph(() => {
      flushSync(() => setOpen(null));
      // back to the tile of the image that was on screen, scrolled into view if the viewer moved on
      tile?.focus({ preventScroll: true });
      tile?.scrollIntoView({ block: "nearest" });
    }, tile?.querySelector("img"), "close");
  };
  const go = (d: number) => setOpen((o) => (o === null ? o : (o + d + list.length) % list.length));

  const options = view.filters.map((x) => ({ value: x.id, label: <>{t(`gallery.filter.${x.id}`)}<span className="gal-n mono">{x.count}</span></> }));

  return (
    <div className="shell gal">
      {view.video && <VideoPlayer video={view.video} />}
      <Chips ariaLabel={t("gallery.filter.label")} options={options} selected={[filter]} onToggle={(id) => { setOpen(null); setFilter(id); }} />
      <p className="sr-only" aria-live="polite">{t("gallery.shown", { count: list.length })}</p>
      <div className="gal-wrap">
        <div className="gal-grid">
          {list.map((it, i) => (
            <button key={it.id} ref={(el) => { tiles.current[i] = el; }} type="button" className="gal-item" data-size={layout[i].size} data-mirror={layout[i].mirror}
              aria-label={t("gallery.open", { title: it.title, n: i + 1, total: list.length })} onClick={() => show(i)}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={it.src} alt={it.alt} width={it.width} height={it.height} loading={i < EAGER ? "eager" : "lazy"} decoding="async" draggable={false} />
              <span className="gal-cap"><b>{it.title}</b><span className="mono">{f.clock(it.minutes)}</span></span>
            </button>
          ))}
        </div>
      </div>
      <p className="note gal-note">{t("gallery.note")}</p>
      {open !== null && list[open] && <Lightbox items={list} index={open} onClose={close} onGo={go} />}
    </div>
  );
}
