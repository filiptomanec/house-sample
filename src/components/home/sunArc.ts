// Drawing the sun on a small arc: interpolation of the sun between the frames of the day sequence and the mapping of azimuth and
// altitude into a box. Pure and free of the calc modules, so the client component can import it without shipping the astronomy.

export interface SunSpot { az: number; alt: number }

/** Linear interpolation of the sun between the frames at a fractional frame index (the azimuth never wraps within a day's arc). */
export function sunAtFrame(sun: readonly SunSpot[], frame: number): SunSpot {
  const last = sun.length - 1;
  if (last < 0) return { az: 0, alt: 0 };
  const f = Math.min(last, Math.max(0, frame));
  const i = Math.min(last, Math.floor(f));
  const next = Math.min(last, i + 1);
  const k = f - i;
  return { az: sun[i].az + (sun[next].az - sun[i].az) * k, alt: sun[i].alt + (sun[next].alt - sun[i].alt) * k };
}

/** Drawing box of the sun arc (any unit; the SVG viewBox). */
export interface ArcBox { width: number; height: number; padX: number; padTop: number; padBottom: number }

/**
 * Maps the sun path into a box: azimuth across the width from the first to the last point of the path, altitude up from the
 * horizon line (at `height - padBottom`) to the highest point of the path. Returns the projector, the path as an SVG `d`, the
 * horizon y, the x of every cardinal direction that lies within the path (az 90, 180, 270), the x of the two ends (sunrise and
 * sunset, for their labels) and `travelled(spot)`: the part of the path the sun has already covered, ending at the sun.
 */
export function arcGeometry(path: readonly SunSpot[], box: ArcBox) {
  const azMin = path.length ? Math.min(...path.map((p) => p.az)) : 0;
  const azMax = path.length ? Math.max(...path.map((p) => p.az)) : 1;
  const altMax = path.length ? Math.max(...path.map((p) => p.alt), 1) : 1;
  const horizon = box.height - box.padBottom;
  const project = (az: number, alt: number): [number, number] => [
    box.padX + ((az - azMin) / Math.max(1e-6, azMax - azMin)) * (box.width - 2 * box.padX),
    horizon - (alt / altMax) * (horizon - box.padTop),
  ];
  const f = (v: number) => Math.round(v * 10) / 10;
  const d = path.map((p, i) => { const [x, y] = project(p.az, Math.max(0, p.alt)); return `${i ? "L" : "M"}${f(x)},${f(y)}`; }).join(" ");
  const cardinals = ([90, 180, 270] as const).filter((a) => a >= azMin && a <= azMax).map((a) => ({ az: a, x: f(project(a, 0)[0]) }));
  const ends = { start: f(project(azMin, 0)[0]), end: f(project(azMax, 0)[0]) };
  /** The path up to the sun (the azimuth grows through the day): empty before sunrise, the whole path after sunset. */
  const travelled = (spot: SunSpot): string => {
    const pts: [number, number][] = [];
    for (const p of path) if (p.az <= spot.az) pts.push(project(p.az, Math.max(0, p.alt)));
    if (pts.length && spot.alt > 0 && spot.az < azMax) pts.push(project(spot.az, spot.alt));
    return pts.length < 2 ? "" : pts.map(([x, y], i) => `${i ? "L" : "M"}${f(x)},${f(y)}`).join(" ");
  };
  return { project, d, horizon, cardinals, ends, travelled };
}
