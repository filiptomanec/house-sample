// Small pieces of the plan that both the server (drawing, SVG markup) and the browser (the interactive page) need. No model
// code is imported here, so the client bundle of the floor plan does not carry the geometry builder.
import type { RoomType } from "@/lib/model/catalog";

export type PlanPt = [number, number];
/** [x0, y0, x1, y1] in plan space with x0 < x1 and y0 < y1. */
export type PlanRect = [number, number, number, number];
export type PlanRing = PlanPt[];

/** Fill colour keys of the plan; the CSS token of each is `PLAN_FILL[key]`. */
export type FillKey = "day" | "night" | "service" | "circulation" | "garage" | "terrace" | "paving";

/** Token names (without `var()`) of the fills. */
export const PLAN_FILL: Record<FillKey, string> = {
  day: "--zone-day", night: "--zone-night", service: "--zone-service", circulation: "--zone-circulation",
  garage: "--zone-garage", terrace: "--zone-terrace", paving: "--map-paving",
};

/** Fill of a room by its type (the zone of the model groups hall and wardrobe with other rooms; the drawing separates circulation). */
export const ROOM_FILL: Record<RoomType, FillKey> = {
  living: "day", kitchen: "day", dining: "day", office: "day", guest: "day",
  bedroom: "night", kids: "night",
  bath: "service", wc: "service", utility: "service", pantry: "service", technical: "service",
  hall: "circulation", corridor: "circulation", wardrobe: "circulation",
  garage: "garage", storage: "garage",
};

/** Rounds to millimetres for compact path data ("+ 0" turns -0 into 0). */
export const mm = (v: number): number => Math.round(v * 1000) / 1000 + 0;

/** The `viewBox` attribute of a drawing. */
export const viewBoxOf = (d: { viewBox: { x: number; y: number; w: number; h: number } }): string => `${d.viewBox.x} ${d.viewBox.y} ${d.viewBox.w} ${d.viewBox.h}`;

/** Path data of rings: "M x,y L x,y ... Z" per ring (fill with fill-rule evenodd). */
export function pathOf(rings: readonly PlanRing[]): string {
  return rings.map((r) => `M${r.map(([x, y]) => `${mm(x)},${mm(y)}`).join("L")}Z`).join("");
}

/** Path data of a quarter-circle swing arc (from the open leaf to the closed one). */
export function arcPath(a: { from: PlanPt; to: PlanPt; r: number; sweep: 0 | 1 }): string {
  return `M${a.from[0]},${a.from[1]}A${a.r},${a.r} 0 0 ${a.sweep} ${a.to[0]},${a.to[1]}`;
}

export const esc = (s: string): string => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
