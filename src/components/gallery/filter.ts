// Types of the gallery view and the filter predicate. Light on purpose: the client components import this file, so it must not
// pull in the manifest parser (zod) that view.ts needs on the server (type imports are erased).
import type { Picture, StillCategory } from "@/lib/data/media";

export interface GalleryItem {
  id: string;
  /** The responsive picture (AVIF and WebP sources, JPEG srcset); the lightbox picks its widest width. */
  picture: Picture;
  /** The main JPEG (the <img> fallback) and its size. */
  src: string;
  width: number;
  height: number;
  category: StillCategory;
  /** Local time of the light, minutes since midnight. */
  minutes: number;
  /** Rendered in the evening light (after noon, with the sun low or set). */
  evening: boolean;
  title: string;
  alt: string;
  /** "21. června, 20:15 · slunce 4° nad obzorem na severozápadě", typeset. */
  caption: string;
}

export interface GalleryVideo {
  /** Renditions, widest first; the narrower ones are for phones. */
  sources: { src: string; width: number; height: number }[];
  /** The widest rendition (also the first of `sources`). */
  src: string;
  /** The poster as a responsive picture (shown over the video until it plays). */
  poster: Picture;
  width: number;
  height: number;
  /** Length from the manifest; the player replaces it with the length from the file's metadata. */
  durationS: number;
}

/** A filter: "all", one of the categories, or "evening". `count` is how many stills it shows. */
export interface GalleryFilter {
  id: "all" | StillCategory | "evening";
  count: number;
}

export interface GalleryView {
  items: GalleryItem[];
  /** Filters worth offering; empty when there is nothing to choose (then the page shows no filter control). */
  filters: GalleryFilter[];
  video: GalleryVideo | null;
}

/** Does the item belong to the filter? */
export function matches(item: Pick<GalleryItem, "category" | "evening">, filter: GalleryFilter["id"]): boolean {
  return filter === "all" || (filter === "evening" ? item.evening : item.category === filter);
}
