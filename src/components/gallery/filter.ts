// Types of the gallery view and the filter predicate. Light on purpose: the client components import this file, so it must not
// pull in the manifest parser (zod) that view.ts needs on the server.
import type { StillCategory } from "@/lib/data/media";

export interface GalleryItem {
  id: string;
  src: string;
  width: number;
  height: number;
  category: StillCategory;
  /** Local time of the light, minutes since midnight (shown with the formatter's clock). */
  minutes: number;
  evening: boolean;
  title: string;
  alt: string;
}

export interface GalleryVideo {
  src: string;
  poster: string;
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
  filters: GalleryFilter[];
  video: GalleryVideo | null;
}

/** Does the item belong to the filter? */
export function matches(item: Pick<GalleryItem, "category" | "evening">, filter: GalleryFilter["id"]): boolean {
  return filter === "all" || (filter === "evening" ? item.evening : item.category === filter);
}
