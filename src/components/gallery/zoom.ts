// Zoom and pan of the lightbox picture, as pure geometry (tested without a browser). The picture is transformed with
// `translate(x, y) scale(s)` about its centre; a point of the picture `q` (pixels from its centre, unscaled) is then on screen at
// `t + s * q`. Pinch keeps the point under the fingers still, double tap toggles 2x at the tapped point, and the pan is clamped so
// the zoomed picture always covers its own box (no empty margin can be dragged into view).

export interface Zoom {
  s: number;
  x: number;
  y: number;
}

export const ZOOM_MIN = 1;
export const ZOOM_MAX = 4;
/** The scale a double tap zooms to. */
export const ZOOM_TAP = 2;
/** Two taps within this time (ms) and distance (px) are a double tap. */
export const DOUBLE_TAP_MS = 300;
export const DOUBLE_TAP_PX = 30;

export const NO_ZOOM: Zoom = { s: 1, x: 0, y: 0 };

const clampTo = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

/** Keeps the scale in range and the pan inside the bounds of a `w` x `h` picture (its laid-out size, unscaled). */
export function clampZoom(z: Zoom, w: number, h: number): Zoom {
  const s = clampTo(z.s, ZOOM_MIN, ZOOM_MAX);
  const mx = (w * (s - 1)) / 2;
  const my = (h * (s - 1)) / 2;
  return { s, x: clampTo(z.x, -mx, mx) || 0, y: clampTo(z.y, -my, my) || 0 };
}

/**
 * Scales to `s` about the screen point `p` (pixels from the centre of the picture's box), keeping the picture point under `p`
 * where it is: t' = p - (s' / s) * (p - t).
 */
export function zoomAt(z: Zoom, s: number, p: { x: number; y: number }, w: number, h: number): Zoom {
  const target = clampTo(s, ZOOM_MIN, ZOOM_MAX);
  const k = target / z.s;
  return clampZoom({ s: target, x: p.x - k * (p.x - z.x), y: p.y - k * (p.y - z.y) }, w, h);
}

/** Double tap: zoom in to ZOOM_TAP at the tapped point, or back out when zoomed. */
export function toggleAt(z: Zoom, p: { x: number; y: number }, w: number, h: number): Zoom {
  return z.s > 1.01 ? NO_ZOOM : zoomAt(z, ZOOM_TAP, p, w, h);
}

/** Moves a zoomed picture by (dx, dy); a picture at scale 1 does not move. */
export function panBy(z: Zoom, dx: number, dy: number, w: number, h: number): Zoom {
  return clampZoom({ s: z.s, x: z.x + dx, y: z.y + dy }, w, h);
}

/**
 * One step of a two-finger pinch: from the fingers' previous midpoint and distance to the current ones. The picture follows the
 * midpoint (pan) and scales with the distance about it.
 */
export function pinchStep(z: Zoom, prev: { mid: { x: number; y: number }; dist: number }, next: { mid: { x: number; y: number }; dist: number }, w: number, h: number): Zoom {
  const moved = { s: z.s, x: z.x + next.mid.x - prev.mid.x, y: z.y + next.mid.y - prev.mid.y };
  return zoomAt(moved, z.s * (prev.dist > 0 ? next.dist / prev.dist : 1), next.mid, w, h);
}

export const isZoomed = (z: Zoom): boolean => z.s > 1.01;

/** The CSS transform of a zoom state. */
export const zoomTransform = (z: Zoom): string => (isZoomed(z) ? `translate(${z.x.toFixed(1)}px, ${z.y.toFixed(1)}px) scale(${z.s.toFixed(3)})` : "");
