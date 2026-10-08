// Photovoltaics in the 3D model: the modules where the energy calculation puts them, and the wall-mounted battery with its
// inverter in the plant room. Everything is generated from data; nothing is in the GLB.
//
//  * Modules: a `PvConfig` carries the list of kernel `PvPanel`s to draw (four 3D corners each, counter-clockwise from above;
//    `derived.pv.panels` for the default layout, the visitor's layout from `calc/roofLayout.layoutPanels`). Each module is
//    one box instance lifted above the roof tiles along the roof face normal (`derived.roofPlanes[].frame.n`); the cell
//    pattern is a canvas texture on the top face, the long side of the module runs along the long side of the texture.
//  * Battery: modules of the smallest battery option's capacity (`batteryModuleKWh`) stacked on a wall of the room with
//    `role: "plant"` (`batteryMount`), the inverter above them at eye level, conduits to the roof. Count = round(kWh / module).
//  * Settings: `readPvConfig(ctx)` reads what the Energy page saved (`calc/storageKeys` `readStoredPv`) and falls back to
//    `defaultPvConfig(ctx)`; the page decides whether to follow later changes (`update`).
//  * Panels hide with the roof (they would float without it); the battery stays.
import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { currentPvSelection, defaultPvSelection, groupRoofPlanes, layoutPanels, lightpipeObstacles } from "@/lib/calc/roofLayout";
import { doorSwing, rectHitsSwing, type Pt, type Pt3, type PvPanel } from "@/lib/model";
import type { HouseContext } from "./context";
import { disposeTree } from "./dispose";
import type { HouseScene } from "./house";
import { mergeMeshes } from "./merge";
import { generatedMaterial } from "./style";
import { readToken } from "./theme";
import type { Viewer } from "./viewer";

export interface PvConfig {
  /** Modules to draw (a subset or the whole of a layout). */
  panels: readonly PvPanel[];
  /** Battery capacity in kWh (0 = none). */
  batteryKWh: number;
}

/** Capacity of the smallest real battery option: the size of one stacked module, kWh. */
export function batteryModuleKWh(ctx: HouseContext): number {
  const caps = ctx.house.equipment.battery.options.map((o) => o.capacityKwh).filter((c) => c > 0);
  return caps.length ? Math.min(...caps) : 0;
}

/** Number of battery modules for a capacity (rounded to whole modules). */
export function batteryModules(ctx: HouseContext, kWh: number): number {
  const m = batteryModuleKWh(ctx);
  return m > 0 ? Math.max(0, Math.round(kWh / m)) : 0;
}

/** The layout of the model (`derived.pv.panels`) and the default battery option. */
export function defaultPvConfig(ctx: HouseContext): PvConfig {
  const { options, default: def } = ctx.house.equipment.battery;
  return { panels: ctx.derived.pv.panels, batteryKWh: options.find((o) => o.id === def)?.capacityKwh ?? 0 };
}

/**
 * The visitor's choice (Energy page) as modules, by this recipe (all pure functions of calc/roofLayout and calc/storageKeys):
 *
 *     const planes = groupRoofPlanes(derived.roofPlanes);
 *     const defaults = defaultPvSelection(house, planes, derived);
 *     const sel = currentPvSelection(defaults, planes, house.equipment.battery.options.map((o) => o.id));
 *     const layout = layoutPanels(planes, house.equipment.pv, { count: sel.panelCount, enabledPlanes: sel.enabledPlanes, obstacles: lightpipeObstacles(derived) });
 *     return { panels: layout.panels, batteryKWh: capacity of the battery option with id sel.batteryId };
 *
 * Browser only (reads storage; on the server it returns the defaults); never throws. Falls back to `defaultPvConfig`.
 */
export function readPvConfig(ctx: HouseContext): PvConfig {
  try {
    const { house, derived } = ctx;
    const planes = groupRoofPlanes(derived.roofPlanes);
    const defaults = defaultPvSelection(house, planes, derived);
    const sel = currentPvSelection(defaults, planes, house.equipment.battery.options.map((o) => o.id));
    const layout = layoutPanels(planes, house.equipment.pv, { count: sel.panelCount, enabledPlanes: sel.enabledPlanes, obstacles: lightpipeObstacles(derived) });
    const battery = house.equipment.battery.options.find((o) => o.id === sel.batteryId);
    return { panels: layout.panels, batteryKWh: battery?.capacityKwh ?? defaultPvConfig(ctx).batteryKWh };
  } catch {
    return defaultPvConfig(ctx);
  }
}

/** The battery product (equipment specification, not the house), metres. */
export const BATTERY_SPEC = {
  /** One stackable module. */
  moduleWidth: 0.51, moduleHeight: 0.46, moduleDepth: 0.21, moduleGap: 0.012,
  /** Plinth under the stack and cable cover on top. */
  baseHeight: 0.1, coverHeight: 0.07,
  /** The hybrid inverter above the stack, its centre at eye level at least. */
  inverterWidth: 0.45, inverterHeight: 0.62, inverterDepth: 0.19, inverterMinBottom: 1.25, inverterGap: 0.3,
  /** Conduits. */
  conduit: 0.06,
} as const;

/** The PV module as mounted: the frame depth, and how far the rails lift it above the tiles. */
export const PV_SPEC = { thickness: 0.035, lift: 0.11 } as const;

/** Where the battery stands: a stretch of a wall in the plant room, free of openings and furniture. House frame. */
export interface BatteryMount {
  /** `derived.rooms[].id` of the room with role "plant". */
  room: string;
  wallId: string;
  /** Centre of the stretch on the wall face, and the unit vectors along the wall and into the room (plan). */
  origin: Pt;
  along: Pt;
  normal: Pt;
  /** Length of the free stretch, metres. */
  length: number;
}

const SLICE = 0.01;
/** Clearance kept to an opening or a piece of furniture along the wall, metres. */
const MOUNT_CLEARANCE = 0.05;

type RectT = [number, number, number, number];
const overlap = (a: RectT, b: RectT): boolean => a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3];

/**
 * Pure: chooses the stretch. Of the walls of the room with role "plant" it takes the longest opening-free stretch that is
 * at least one module wide, preferring an interior wall, ties broken by the distance to the room's door. Null when the
 * model has no such room or no free stretch (the battery is then left out).
 */
export function batteryMount(ctx: HouseContext): BatteryMount | null {
  const { derived } = ctx;
  const room = derived.rooms.find((r) => r.role === "plant");
  if (!room) return null;
  const depth = BATTERY_SPEC.moduleDepth + MOUNT_CLEARANCE;
  const doors = derived.openings.filter((o) => o.room === room.id || o.connects?.includes(room.id));
  const swings = doors.flatMap((o) => {
    if (o.swingRoom !== room.id) return [];
    const wall = derived.walls.find((w) => w.id === o.wallId);
    const sw = wall ? doorSwing(o, wall.t) : null;
    return sw ? [sw] : [];
  });
  const furniture = derived.furniture.filter((f) => f.room === room.id).map((f) => f.rect as RectT);

  interface Candidate { wallId: string; interior: boolean; from: number; to: number; along: Pt; normal: Pt; face: number; orient: "h" | "v"; doorDistance: number }
  const found: Candidate[] = [];
  const doorCentres = doors.filter((o) => o.kind === "door" || o.kind === "entry").map((o): Pt => [o.cx, o.cy]);

  for (const r of room.cleanRects) {
    const [x0, y0, x1, y1] = r;
    // the four faces of the net rectangle: wall coordinate, direction into the room, extent along the wall
    const sides: { orient: "h" | "v"; face: number; into: Pt; lo: number; hi: number }[] = [
      { orient: "h", face: y0, into: [0, 1], lo: x0, hi: x1 },
      { orient: "h", face: y1, into: [0, -1], lo: x0, hi: x1 },
      { orient: "v", face: x0, into: [1, 0], lo: y0, hi: y1 },
      { orient: "v", face: x1, into: [-1, 0], lo: y0, hi: y1 },
    ];
    for (const side of sides) {
      const wall = derived.walls.find((w) => w.orient === side.orient && Math.abs(Math.abs(w.at - side.face) - w.t / 2) < 1e-3 && w.from < side.hi && w.to > side.lo);
      if (!wall) continue;
      // the strip the stack would occupy at position s along the wall (a thin slice of it)
      const slice = (s: number): RectT => (side.orient === "h"
        ? [s, side.face + (side.into[1] > 0 ? 0 : -depth), s + SLICE, side.face + (side.into[1] > 0 ? depth : 0)]
        : [side.face + (side.into[0] > 0 ? 0 : -depth), s, side.face + (side.into[0] > 0 ? depth : 0), s + SLICE]);
      const blocked = (s: number): boolean => {
        const q = slice(s);
        if (furniture.some((f) => overlap(q, [f[0] - MOUNT_CLEARANCE, f[1] - MOUNT_CLEARANCE, f[2] + MOUNT_CLEARANCE, f[3] + MOUNT_CLEARANCE]))) return true;
        if (swings.some((sw) => rectHitsSwing(q, sw))) return true;
        // an opening in this wall: its extent along the wall, with clearance
        return doors.some((o) => o.orient === side.orient && Math.abs(o.axis - wall.at) < 1e-3 && s + SLICE > o.from - MOUNT_CLEARANCE && s < o.to + MOUNT_CLEARANCE);
      };
      let start: number | null = null;
      const n = Math.floor((side.hi - side.lo) / SLICE);
      for (let i = 0; i <= n; i++) {
        const s = side.lo + i * SLICE;
        const free = i < n && !blocked(s);
        if (free && start === null) start = s;
        if (!free && start !== null) {
          found.push({ wallId: wall.id, interior: !wall.ext, from: start, to: s, along: [-side.into[1], side.into[0]], normal: side.into, face: side.face, orient: side.orient, doorDistance: 0 });
          start = null;
        }
      }
    }
  }
  const usable = found.filter((c) => c.to - c.from >= BATTERY_SPEC.moduleWidth - 1e-9);
  for (const c of usable) {
    const mid = (c.from + c.to) / 2;
    const p: Pt = c.orient === "h" ? [mid, c.face] : [c.face, mid];
    c.doorDistance = doorCentres.length ? Math.min(...doorCentres.map((d) => Math.hypot(d[0] - p[0], d[1] - p[1]))) : 0;
  }
  usable.sort((a, b) => Number(b.interior) - Number(a.interior) || Math.round((b.to - b.from) * 100) - Math.round((a.to - a.from) * 100) || a.doorDistance - b.doorDistance);
  const best = usable[0];
  if (!best) return null;
  const mid = (best.from + best.to) / 2;
  return {
    room: room.id, wallId: best.wallId,
    origin: best.orient === "h" ? [mid, best.face] : [best.face, mid],
    along: best.orient === "h" ? [1, 0] : [0, 1],
    normal: best.normal, length: best.to - best.from,
  };
}

export interface PvScene {
  readonly group: THREE.Group;
  readonly info: { panels: number; kwp: number; batteryModules: number; batteryKWh: number };
  setVisible(visible: boolean): void;
  /** Show or hide the modules only (with the roof switch). */
  setPanelsVisible(visible: boolean): void;
  update(config: PvConfig): void;
  /** The modules as occluders (they shade the roof; the sun analysis may ignore them). */
  occluders(): THREE.Object3D[];
  dispose(): void;
}

const sub3 = (a: Readonly<Pt3>, b: Readonly<Pt3>): Pt3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross3 = (a: Readonly<Pt3>, b: Readonly<Pt3>): Pt3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len3 = (a: Readonly<Pt3>): number => Math.hypot(a[0], a[1], a[2]);
const unit3 = (a: Readonly<Pt3>): Pt3 => { const l = len3(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

/**
 * The placement of one module from its four corners (house frame, counter-clockwise seen from above): centre lifted along the
 * normal, the unit axis of the long side, the normal, and the two side lengths. Pure.
 */
export function moduleFrame(corners: readonly Pt3[], lift: number): { centre: Pt3; long: Pt3; normal: Pt3; length: number; width: number } {
  const e01 = sub3(corners[1], corners[0]), e12 = sub3(corners[2], corners[1]);
  const normal = unit3(cross3(e01, e12));
  const centre: Pt3 = [0, 0, 0];
  for (const c of corners) { centre[0] += c[0] / corners.length; centre[1] += c[1] / corners.length; centre[2] += c[2] / corners.length; }
  const l01 = len3(e01), l12 = len3(e12);
  const longIs01 = l01 >= l12;
  return {
    centre: [centre[0] + normal[0] * lift, centre[1] + normal[1] * lift, centre[2] + normal[2] * lift],
    long: unit3(longIs01 ? e01 : e12), normal, length: Math.max(l01, l12), width: Math.min(l01, l12),
  };
}

/** Cell pattern of a monocrystalline half-cut module: 6 x 18 cells, thin busbars, a frame edge (long side along canvas x). */
function cellTexture(cell: THREE.Color, frame: THREE.Color): THREE.CanvasTexture {
  const W = 576, H = 384, canvas = document.createElement("canvas");
  canvas.width = W; canvas.height = H;
  const g = canvas.getContext("2d");
  const css = (c: THREE.Color) => `#${c.getHexString()}`;
  if (g) {
    const dark = cell.clone().multiplyScalar(0.7), bus = cell.clone().lerp(new THREE.Color(1, 1, 1), 0.55);
    g.fillStyle = css(dark); g.fillRect(0, 0, W, H);
    const fr = 8, cols = 18, rows = 6, cw = (W - 2 * fr) / cols, ch = (H - 2 * fr) / rows;
    for (let i = 0; i < cols; i++) {
      for (let j = 0; j < rows; j++) {
        const x = fr + i * cw + 1.2, y = fr + j * ch + 1.2, w = cw - 2.4, h = ch - 2.4;
        const grad = g.createLinearGradient(x, y, x + w, y + h);
        grad.addColorStop(0, css(cell)); grad.addColorStop(1, css(cell.clone().multiplyScalar(0.8)));
        g.fillStyle = grad; g.fillRect(x, y, w, h);
        g.strokeStyle = css(bus); g.globalAlpha = 0.35; g.lineWidth = 0.8;
        for (let k = 1; k <= 3; k++) { g.beginPath(); g.moveTo(x, y + (h * k) / 4); g.lineTo(x + w, y + (h * k) / 4); g.stroke(); }
        g.globalAlpha = 1;
      }
    }
    g.strokeStyle = css(frame); g.lineWidth = fr * 2; g.strokeRect(0, 0, W, H);
  }
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/**
 * A unit box whose faces form two groups: the five frame faces (group 0) and the +z face with the cells (group 1). A plain
 * BoxGeometry has six groups, so an instanced module would cost six draw calls instead of two.
 */
export function cellBox(): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(1, 1, 1);
  const index = g.getIndex()!;
  // BoxGeometry: faces +x, -x, +y, -y, +z, -z, six indices each, in that order
  const faces = [0, 1, 2, 3, 5, 4].flatMap((f) => Array.from({ length: 6 }, (_, k) => index.getX(f * 6 + k)));
  g.setIndex(faces);
  g.clearGroups();
  g.addGroup(0, 30, 0);
  g.addGroup(30, 6, 1);
  return g;
}

/** Builds the modules and the battery and adds them to the house scene (`house.adopt`). Initially hidden. */
export function buildPv(viewer: Viewer, house: HouseScene, config?: PvConfig): PvScene {
  const { ctx } = house;
  const group = new THREE.Group();
  group.name = "pv";
  group.visible = false;
  const high = viewer.tier === "high";

  const style = (role: string, fallback: string) => generatedMaterial(ctx.style, role, fallback);
  const cellStyle = style("pv_cell", "frame"), frameStyle = style("pv_frame", "frame");
  const cellTex = cellTexture(new THREE.Color(cellStyle.color), new THREE.Color(frameStyle.color));
  const top = high
    ? new THREE.MeshPhysicalMaterial({ map: cellTex, roughness: 0.18, metalness: 0.1, clearcoat: 1, clearcoatRoughness: 0.06, envMapIntensity: 1.4 })
    : new THREE.MeshStandardMaterial({ map: cellTex, roughness: 0.25, metalness: 0.2, envMapIntensity: 1.3 });
  const frame = new THREE.MeshStandardMaterial({ color: frameStyle.color, roughness: frameStyle.roughness, metalness: frameStyle.metallic });
  const box = cellBox(); // the +z face carries the cells (group 1), the other five faces the frame (group 0): two draw calls
  const faceMaterials = [frame, top];

  const up = new THREE.Vector3(0, 1, 0);
  let panels: THREE.InstancedMesh | null = null;
  let panelsOn = true;
  let battery: THREE.Group | null = null;
  const info = { panels: 0, kwp: 0, batteryModules: 0, batteryKWh: 0 };

  function layPanels(list: readonly PvPanel[]) {
    if (panels) { group.remove(panels); panels.dispose(); panels = null; }
    info.panels = list.length;
    info.kwp = list.reduce((s, p) => s + p.wp, 0) / 1000;
    if (!list.length) return;
    const mesh = new THREE.InstancedMesh(box, faceMaterials, list.length);
    mesh.name = "pv_panels";
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
    const x = new THREE.Vector3(), y = new THREE.Vector3(), z = new THREE.Vector3();
    list.forEach((panel, i) => {
      const f = moduleFrame(panel.corners, PV_SPEC.lift);
      // house frame -> scene frame: (x, y, z) -> (x, z, -y); the long side along the texture's x, the normal is the +z face
      x.set(f.long[0], f.long[2], -f.long[1]);
      z.set(f.normal[0], f.normal[2], -f.normal[1]);
      y.crossVectors(z, x).normalize();
      q.setFromRotationMatrix(m.makeBasis(x, y, z));
      p.set(f.centre[0], f.centre[2], -f.centre[1]);
      mesh.setMatrixAt(i, m.compose(p, q, s.set(f.length, f.width, PV_SPEC.thickness)));
    });
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
    mesh.visible = panelsOn;
    panels = mesh;
    group.add(mesh);
  }

  function layBattery(kWh: number) {
    if (battery) { disposeTree(battery); battery = null; }
    const modules = batteryModules(ctx, kWh);
    info.batteryModules = modules;
    info.batteryKWh = modules * batteryModuleKWh(ctx);
    const mount = modules > 0 ? batteryMount(ctx) : null;
    if (!mount) { info.batteryModules = 0; info.batteryKWh = 0; return; }
    const B = BATTERY_SPEC;
    const g = new THREE.Group();
    g.name = "pv_battery";
    const caseM = style("battery_case", "plaster"), trimM = style("battery_trim", "frame");
    const white = new THREE.MeshStandardMaterial({ color: caseM.color, roughness: Math.min(caseM.roughness, 0.5), metalness: caseM.metallic });
    const grey = new THREE.MeshStandardMaterial({ color: trimM.color, roughness: trimM.roughness, metalness: trimM.metallic });
    const led = new THREE.MeshStandardMaterial({ color: readToken("--mint", "#5fd6ae"), emissive: readToken("--mint", "#5fd6ae"), emissiveIntensity: 1.1 });
    const screen = new THREE.MeshStandardMaterial({ color: trimM.color, roughness: 0.15, emissive: readToken("--info", "#2f64bd"), emissiveIntensity: 0.35 });
    const along = new THREE.Vector3(mount.along[0], 0, -mount.along[1]), normal = new THREE.Vector3(mount.normal[0], 0, -mount.normal[1]);
    const o = new THREE.Vector3(mount.origin[0], 0, -mount.origin[1]);
    const qd = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(along, up, normal));
    // a box of width w (along the wall), height h, depth d (into the room) whose back stands on the wall face at height z0 and offset s along it
    const part = (w: number, h: number, d: number, mat: THREE.Material, z0: number, s = 0, off = 0, r = 0.02) => {
      const mesh = new THREE.Mesh(new RoundedBoxGeometry(w, h, d, 3, Math.min(r, d / 2.1, w / 2.1, h / 2.1)), mat);
      mesh.position.copy(o).addScaledVector(along, s).addScaledVector(normal, d / 2 + off).setY(z0 + h / 2);
      mesh.quaternion.copy(qd);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      g.add(mesh);
      return mesh;
    };
    part(B.moduleWidth, B.baseHeight, B.moduleDepth + 0.02, grey, 0, 0, -0.005, 0.015);
    for (let k = 0; k < modules; k++) {
      const z0 = B.baseHeight + k * (B.moduleHeight + B.moduleGap);
      part(B.moduleWidth, B.moduleHeight, B.moduleDepth, white, z0);
      part(0.012, B.moduleHeight * 0.6, 0.004, led, z0 + B.moduleHeight * 0.2, -B.moduleWidth / 2 + 0.05, B.moduleDepth, 0.002);
    }
    const stackTop = B.baseHeight + modules * (B.moduleHeight + B.moduleGap);
    part(B.moduleWidth * 0.92, B.coverHeight, B.moduleDepth, grey, stackTop);
    const iz = Math.max(stackTop + B.inverterGap, B.inverterMinBottom);
    part(B.inverterWidth, B.inverterHeight, B.inverterDepth, white, iz);
    part(B.inverterWidth * 0.4, 0.1, 0.004, screen, iz + B.inverterHeight * 0.65, 0, B.inverterDepth, 0.004);
    part(B.conduit, iz - stackTop - B.coverHeight, B.conduit, grey, stackTop + B.coverHeight, B.moduleWidth * 0.3, 0, 0.01);
    part(B.conduit, ctx.house.clearHeight - iz - B.inverterHeight, B.conduit, grey, iz + B.inverterHeight, -B.moduleWidth * 0.3, 0, 0.01);
    // a dozen small parts in four materials: one mesh per material (fewer draw calls on every tier)
    const parts: THREE.Mesh[] = [];
    g.traverse((o) => { if ((o as THREE.Mesh).isMesh) parts.push(o as THREE.Mesh); });
    mergeMeshes(parts, (m) => (m.material as THREE.Material).uuid);
    battery = g;
    group.add(g);
  }

  const cfg = config ?? readPvConfig(ctx);
  layPanels(cfg.panels);
  layBattery(cfg.batteryKWh);
  house.adopt(group);
  viewer.requestRender();

  return {
    group, info,
    setVisible(v) { group.visible = v; viewer.requestRender(); },
    setPanelsVisible(v) { panelsOn = v; if (panels) panels.visible = v; viewer.requestRender(); },
    update(c) { layPanels(c.panels); layBattery(c.batteryKWh); group.updateMatrixWorld(true); viewer.requestRender(); },
    occluders() { return panels && panelsOn && group.visible ? [panels] : []; },
    dispose() {
      if (battery) disposeTree(battery);
      panels?.dispose();
      group.removeFromParent();
      box.dispose();
      cellTex.dispose();
      for (const m of [top, frame]) m.dispose();
    },
  };
}
