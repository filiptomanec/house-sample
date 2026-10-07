// Photovoltaic panels on the roof planes of the house: capacity per plane, the visitor's choice (how many panels, on
// which planes) and the resulting 3D panels and statistics. One module feeds Energy (kWp per plane), Model (3D panels),
// Home and Budget (kWp), so there is exactly one answer to "where are the panels".
//
// Contract: docs/CALC-API.md, section 5. Pure functions, no DOM, no three.js, no text.
//
// The geometry comes from the kernel: `derived.roofPlanes` (convex faces with a local (u, v) frame) and the layout rule
// `layoutPv` (src/lib/model/pv.ts). This module adds grouping of faces into planes, a stable plane key, the allocation of a
// requested number of panels to planes, and the validation of saved choices.
import type { Dir } from "@/lib/model/catalog";
import { layoutPv, type Obstacle, type PvSpec } from "@/lib/model/pv";
import type { Derived, House, PvLayout, PvPanel, RoofFace, RoofFrame } from "@/lib/model/types";
import { readStoredPv, type StoredPv } from "./storageKeys";

// ------------------------------------------------------------------------------------------------ roof planes

/**
 * A roof plane: all faces of the kernel that share one `plane` id (a plane cut by a valley has several faces, but one
 * frame, so panels of the faces are comparable). `id` is a label from the model; never persist it, persist `key`.
 */
export interface RoofPlane {
  /** Stable key from the geometry (`planeKey`). Safe to store; changes only when the plane itself moves. */
  key: string;
  /** Kernel plane id ("T1.S"). A label for humans and for tests; do not branch on it, do not store it. */
  id: string;
  roofId: string;
  /** House-frame direction the plane descends to. */
  side: Dir;
  /** Slope angle, degrees. */
  pitch: number;
  /** True azimuth of the downslope direction (includes the house axis bearing). */
  azimuthTrue: number;
  /** PVGIS aspect: 0 = south, east negative, west positive, degrees. */
  aspect: number;
  /** Local frame of the plane (origin on the eave line, u along the eave, v up the slope, n the upward normal). */
  frame: RoofFrame;
  /** Faces of the plane in the kernel order. */
  faces: RoofFace[];
  /** Sloped area of all faces, m2. */
  area: number;
}

/**
 * Stable key of a roof plane, built from its geometry only: `<side><true azimuth>.<pitch>@<eave origin x>,<y>` with the
 * origin in decimetres, for example "S192.22@12,-8". It does not depend on the order of the planes, on ids or on the
 * splitting of a plane into faces (all faces of a plane share the frame). Two planes never get the same key.
 */
export function planeKey(face: Pick<RoofFace, "side" | "azimuthTrue" | "pitch" | "frame">): string {
  const dm = (v: number): number => Math.round(v * 10) + 0; // "+ 0" turns -0 into 0
  const { origin } = face.frame;
  return `${face.side}${Math.round(face.azimuthTrue)}.${Math.round(face.pitch)}@${dm(origin[0])},${dm(origin[1])}`;
}

/**
 * Groups the faces of `derived.roofPlanes` into planes, sorted by key (deterministic, independent of the kernel order).
 * Faces of one plane are kept in the kernel order. Throws if two different `plane` ids produce the same key.
 */
export function groupRoofPlanes(faces: readonly RoofFace[]): RoofPlane[] {
  const byId = new Map<string, RoofFace[]>();
  for (const f of faces) {
    const list = byId.get(f.plane);
    if (list) list.push(f);
    else byId.set(f.plane, [f]);
  }
  const planes: RoofPlane[] = [];
  const idOfKey = new Map<string, string>();
  for (const [id, list] of byId) {
    const first = list[0];
    const key = planeKey(first);
    const clash = idOfKey.get(key);
    if (clash !== undefined) throw new Error(`groupRoofPlanes: planes "${clash}" and "${id}" produce the same key "${key}"`);
    idOfKey.set(key, id);
    planes.push({
      key,
      id,
      roofId: first.roofId,
      side: first.side,
      pitch: first.pitch,
      azimuthTrue: first.azimuthTrue,
      aspect: first.aspect,
      frame: first.frame,
      faces: list,
      area: list.reduce((s, f) => s + f.area, 0),
    });
  }
  return planes.sort(byKey);
}

const byKey = (a: { key: string }, b: { key: string }): number => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0);

/** Roof penetrations (light pipes) as circular obstacles in plan, radius = diameter / 2. Pass them to `layoutPanels`. */
export function lightpipeObstacles(derived: Pick<Derived, "lightpipes">): Obstacle[] {
  return derived.lightpipes.map((l) => ({ x: l.x, y: l.y, radius: l.diameter / 2 }));
}

// ------------------------------------------------------------------------------------------------ layout

export interface LayoutOptions {
  /**
   * Number of panels wanted. Rounded to an integer, negative values count as 0, more than the capacity of the enabled
   * planes is clamped (`PanelLayout.clamped`). Default: the full capacity of the enabled planes (with the default planes
   * that is exactly `derived.pv.count`).
   */
  count?: number;
  /**
   * Keys (`planeKey`) of the planes that may carry panels. Unknown keys are ignored. Default: the planes whose `side` is in
   * `pv.layout.facings`.
   */
  enabledPlanes?: readonly string[];
  /**
   * How the count is spread over the enabled planes.
   *  - "fill" (default): planes in order of their |aspect| (closest to south first; ties by area, then key), each filled to
   *    its capacity before the next one gets a panel;
   *  - "spread": one panel at a time round-robin over the planes in that order (even production over the day on E/W roofs).
   * Within a plane the panels are taken row by row from the eave; in an incomplete row those nearest to the row centre
   * come first, so the array stays symmetric.
   */
  strategy?: "fill" | "spread";
  /** Roof penetrations to avoid, see `lightpipeObstacles`. Default none. */
  obstacles?: readonly Obstacle[];
}

/** The result for one roof plane. */
export interface PlaneLayout {
  key: string;
  /** Kernel plane id, label only. */
  id: string;
  side: Dir;
  azimuthTrue: number;
  aspect: number;
  pitch: number;
  /** Sloped area of the plane, m2. */
  area: number;
  /** Is the plane allowed to carry panels? */
  enabled: boolean;
  /** Module orientation chosen by the layout rule; null when nothing fits. */
  orientation: "portrait" | "landscape" | null;
  /** Panels that fit on the plane by the layout rule, whatever the requested count and whether the plane is enabled. */
  capacity: number;
  /** Panels placed for the requested count. */
  placed: number;
  /** Installed power of the placed panels, kWp. */
  kwp: number;
  /** Panels per row (bottom to top) of the full layout. */
  rows: number[];
}

/** A placed panel: the kernel panel plus the stable plane key and the side of its plane. */
export interface PlacedPanel extends PvPanel {
  planeKey: string;
  side: Dir;
}

export interface PanelLayout {
  /** Placed panels with 3D corners in the house frame (z up). Order: plane order, then the order of placement. */
  panels: PlacedPanel[];
  /** All planes (also the disabled ones, with `enabled: false`), sorted by key. */
  planes: PlaneLayout[];
  /** Count as requested (after rounding and negative -> 0) and as placed. */
  requested: number;
  count: number;
  /** Sum of the capacities of the enabled planes. */
  capacity: number;
  /** True when `requested` exceeded `capacity`. */
  clamped: boolean;
  /** Module rated power, Wp, installed power, kWp, and module area, m2. */
  moduleWp: number;
  kwp: number;
  area: number;
  /** Installed power and panel count per house-frame side (zeros for sides without panels). */
  kwpBySide: Record<Dir, number>;
  countBySide: Record<Dir, number>;
}

/**
 * Places `opts.count` panels on the enabled planes. Pure and deterministic.
 *
 * Capacity per plane is the kernel rule (`layoutPv` of src/lib/model/pv.ts applied to the faces of that plane with
 * `facings: [plane.side]`, i.e. the same setbacks, gaps, orientation and obstacle clearance as the model). Hence:
 *  - with default options the result equals `derived.pv` (same panels, same kWp);
 *  - panels never leave their face and never overlap (the kernel guarantees both);
 *  - `kwp === count * module.wp / 1000`, `count <= capacity`, `Σ planes.placed === count`.
 * `pv.module` and `pv.layout` are read from the model's `equipment.pv`; pass a modified copy for what-if layouts.
 */
export function layoutPanels(planes: readonly RoofPlane[], pv: PvSpec, opts: LayoutOptions = {}): PanelLayout {
  const obstacles = opts.obstacles ?? [];
  const sorted = [...planes].sort(byKey);
  const enabledKeys = enabledSet(sorted, pv, opts.enabledPlanes);
  const full = new Map(sorted.map((p) => [p.key, orderedPanels(p, pv, obstacles)]));
  const capacityOf = (p: RoofPlane): number => full.get(p.key)?.panels.length ?? 0;

  const order = sorted.filter((p) => enabledKeys.has(p.key)).sort((a, b) => Math.abs(a.aspect) - Math.abs(b.aspect) || b.area - a.area || byKey(a, b));
  const capacity = order.reduce((s, p) => s + capacityOf(p), 0);
  const requested = requestedCount(opts.count, capacity);
  const count = Math.min(requested, capacity);

  // how many panels each enabled plane gets
  const share = new Map<string, number>();
  let left = count;
  if ((opts.strategy ?? "fill") === "fill") {
    for (const p of order) {
      const n = Math.min(left, capacityOf(p));
      share.set(p.key, n);
      left -= n;
    }
  } else {
    for (const p of order) share.set(p.key, 0);
    while (left > 0) {
      let moved = false;
      for (const p of order) {
        if (left > 0 && (share.get(p.key) ?? 0) < capacityOf(p)) {
          share.set(p.key, (share.get(p.key) ?? 0) + 1);
          left--;
          moved = true;
        }
      }
      if (!moved) break;
    }
  }

  const panels: PlacedPanel[] = [];
  const kwpBySide: Record<Dir, number> = { N: 0, E: 0, S: 0, W: 0 };
  const countBySide: Record<Dir, number> = { N: 0, E: 0, S: 0, W: 0 };
  const planeLayouts: PlaneLayout[] = sorted.map((p) => {
    const f = full.get(p.key) as OrderedPlane;
    const placed = enabledKeys.has(p.key) ? (share.get(p.key) ?? 0) : 0;
    for (const panel of f.panels.slice(0, placed)) panels.push(placedCopy(panel, p));
    countBySide[p.side] += placed;
    kwpBySide[p.side] += (placed * pv.module.wp) / 1000;
    return {
      key: p.key,
      id: p.id,
      side: p.side,
      azimuthTrue: p.azimuthTrue,
      aspect: p.aspect,
      pitch: p.pitch,
      area: p.area,
      enabled: enabledKeys.has(p.key),
      orientation: f.orientation,
      capacity: f.panels.length,
      placed,
      kwp: (placed * pv.module.wp) / 1000,
      rows: f.rows,
    };
  });
  return {
    panels,
    planes: planeLayouts,
    requested,
    count,
    capacity,
    clamped: requested > capacity,
    moduleWp: pv.module.wp,
    kwp: (count * pv.module.wp) / 1000,
    area: count * pv.module.width * pv.module.height,
    kwpBySide,
    countBySide,
  };
}

/** Requested number of panels: rounded, negative or NaN becomes 0, undefined means "as many as fit". */
function requestedCount(count: number | undefined, capacity: number): number {
  if (count === undefined) return capacity;
  if (Number.isNaN(count)) return 0;
  return Math.max(0, Math.round(count));
}

/** Keys of the planes that may carry panels: the given keys that exist, or the planes of the sides the model puts panels on. */
function enabledSet(planes: readonly RoofPlane[], pv: PvSpec, enabled: readonly string[] | undefined): Set<string> {
  if (enabled === undefined) return new Set(planes.filter((p) => pv.layout.facings.includes(p.side)).map((p) => p.key));
  const known = new Set(planes.map((p) => p.key));
  return new Set(enabled.filter((k) => known.has(k)));
}

interface OrderedPlane {
  /** All panels that fit on the plane, in placement order (row by row from the eave, each row from its centre outwards). */
  panels: PvPanel[];
  orientation: "portrait" | "landscape" | null;
  rows: number[];
}

/** A copy of a cached panel that the caller may keep or change without touching the cache. */
function placedCopy(panel: PvPanel, plane: RoofPlane): PlacedPanel {
  return {
    ...panel,
    uv: [...panel.uv],
    center: [...panel.center],
    corners: panel.corners.map((c) => [...c]) as PvPanel["corners"],
    planeKey: plane.key,
    side: plane.side,
  };
}

const layoutCache = new WeakMap<RoofPlane, Map<string, OrderedPlane>>();

/** The kernel layout of one plane (memoised per plane object and layout rule) put into placement order. */
function orderedPanels(plane: RoofPlane, pv: PvSpec, obstacles: readonly Obstacle[]): OrderedPlane {
  const sig = JSON.stringify([pv.module, { ...pv.layout, facings: null }, obstacles]);
  let perPlane = layoutCache.get(plane);
  if (!perPlane) layoutCache.set(plane, (perPlane = new Map()));
  const hit = perPlane.get(sig);
  if (hit) return hit;
  const layout = planeFullLayout(plane, pv, obstacles);
  const faceOrder = new Map(plane.faces.map((f, i) => [f.id, i]));
  // groups of one strip of one face; the strips are ordered by their height above the eave, the panels of a strip from its middle
  const rowKey = (p: PvPanel): string => `${p.face}#${p.row}`;
  const groups = new Map<string, PvPanel[]>();
  for (const p of layout.panels) {
    const list = groups.get(rowKey(p));
    if (list) list.push(p);
    else groups.set(rowKey(p), [p]);
  }
  const mid = (list: PvPanel[]): number => list.reduce((s, p) => s + (p.uv[0] + p.uv[2]) / 2, 0) / list.length;
  const ordered = [...groups.values()]
    .sort((a, b) => a[0].uv[1] - b[0].uv[1] || (faceOrder.get(a[0].face) ?? 0) - (faceOrder.get(b[0].face) ?? 0))
    .flatMap((list) => {
      const m = mid(list);
      return [...list].sort((a, b) => Math.abs((a.uv[0] + a.uv[2]) / 2 - m) - Math.abs((b.uv[0] + b.uv[2]) / 2 - m) || a.uv[0] - b.uv[0]);
    })
    .map((p) => ({ ...p, id: `${p.face}#${p.row}.${p.col}` }));
  // rows of the plane: panels per distinct height above the eave (1 mm resolution), bottom to top
  const levels = new Map<number, number>();
  for (const p of layout.panels) {
    const level = Math.round(p.uv[1] * 1000);
    levels.set(level, (levels.get(level) ?? 0) + 1);
  }
  const rows = [...levels.entries()].sort((a, b) => a[0] - b[0]).map(([, n]) => n);
  // the orientation of the face that carries most panels
  const best = [...layout.byFace].sort((a, b) => b.count - a.count)[0];
  const result: OrderedPlane = { panels: ordered, orientation: best && best.count > 0 ? best.orientation : null, rows };
  perPlane.set(sig, result);
  return result;
}

/** Capacity (panels that fit) of the given planes, without choosing any. Used for slider limits. */
export function panelCapacity(planes: readonly RoofPlane[], pv: PvSpec, enabledPlanes?: readonly string[], obstacles?: readonly Obstacle[]): number {
  const enabled = enabledSet(planes, pv, enabledPlanes);
  return planes.filter((p) => enabled.has(p.key)).reduce((s, p) => s + orderedPanels(p, pv, obstacles ?? []).panels.length, 0);
}

// ------------------------------------------------------------------------------------------------ the visitor's choice

/** What the visitor chooses about the PV system; shared by Energy, Model, Home and Budget through storage. */
export interface PvSelection {
  panelCount: number;
  /** Plane keys. */
  enabledPlanes: string[];
  /** Id of one of `house.equipment.battery.options` (a value, not logic: the "none" option has capacity 0). */
  batteryId: string;
}

/** The number of panels the model itself places: `derived.pv.count`. */
export function defaultPanelCount(derived: Pick<Derived, "pv">): number {
  return derived.pv.count;
}

/**
 * The model's own choice: `derived.pv.count` panels on the planes whose side is in `equipment.pv.layout.facings`, with the
 * battery `equipment.battery.default`.
 */
export function defaultPvSelection(house: Pick<House, "equipment">, planes: readonly RoofPlane[], derived: Pick<Derived, "pv">): PvSelection {
  const facings: readonly Dir[] = house.equipment.pv.layout.facings;
  return {
    panelCount: defaultPanelCount(derived),
    enabledPlanes: planes.filter((p) => facings.includes(p.side)).map((p) => p.key),
    batteryId: house.equipment.battery.default,
  };
}

/**
 * Turns a stored (untrusted) choice into a valid one: plane keys that no longer exist are dropped; if the stored list
 * becomes empty although it was not, or was null, the default planes are used; a panel count that is not a finite number >= 0
 * falls back to the default (a count above the capacity is kept: `layoutPanels` clamps it); an unknown battery id falls
 * back to the default. Never throws, and never uses the order of the stored planes.
 */
export function resolvePvSelection(stored: StoredPv | null, defaults: PvSelection, planes: readonly RoofPlane[], batteryIds: readonly string[]): PvSelection {
  const count = stored?.panelCount;
  const panelCount = typeof count === "number" && Number.isFinite(count) && count >= 0 ? Math.round(count) : defaults.panelCount;
  const asked = Array.isArray(stored?.enabledPlanes) ? stored.enabledPlanes.filter((k): k is string => typeof k === "string") : null;
  let enabledPlanes = defaults.enabledPlanes;
  if (asked) {
    const wanted = new Set(asked);
    const valid = [...planes].sort(byKey).filter((p) => wanted.has(p.key)).map((p) => p.key);
    // a list that was empty on purpose stays empty; a list that no longer names any plane of this model is dropped
    if (valid.length > 0 || asked.length === 0) enabledPlanes = valid;
  }
  const batteryId = typeof stored?.batteryId === "string" && batteryIds.includes(stored.batteryId) ? stored.batteryId : defaults.batteryId;
  return { panelCount, enabledPlanes: [...enabledPlanes], batteryId };
}

/**
 * Client only, call after mount: `resolvePvSelection(readStoredPv(), ...)`. On the server (no storage) it returns the defaults,
 * so server markup and first client render agree.
 */
export function currentPvSelection(defaults: PvSelection, planes: readonly RoofPlane[], batteryIds: readonly string[]): PvSelection {
  return resolvePvSelection(readStoredPv(), defaults, planes, batteryIds);
}

/** The kernel layout of one plane without any selection (all panels that fit), for drawing the "available" outline. */
export function planeFullLayout(plane: RoofPlane, pv: PvSpec, obstacles?: readonly Obstacle[]): PvLayout {
  return layoutPv(plane.faces, { ...pv, layout: { ...pv.layout, facings: [plane.side] } }, [...(obstacles ?? [])]);
}
