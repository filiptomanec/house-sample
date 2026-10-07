// The house scene: house(-lite).glb, the ground of the plot, its surroundings and vegetation, furniture (loaded on request),
// room tags, the plot boundary, material looks and the section cut. Everything is in the house frame mapped to Y-up; the
// scene root has no transform. Add-ons (blinds, PV, ...) are handed to `adopt()` so they are cut and lit like the house.
// Specification: docs/THREE-API.md section 6.
import * as THREE from "three";
import { acceleratedRaycast, computeBoundsTree, disposeBoundsTree } from "three-mesh-bvh";
import type { DerivedRoom, Derived } from "@/lib/model";
import type { HouseContext } from "./context";
import { disposeMaterial, disposeTree } from "./dispose";
import { prepareFurniture } from "./furniture";
import { GlbError, checkHouseContract, createProgressGroup, extrasOf, isGroundRole, isOccluderRole, loadFurnitureGltf, loadHouseGltf, modelFile, type LoadProgress } from "./glb";
import { interiorRegionOf, shadeBoxesOf } from "./interior";
import { createRoomTags } from "./roomTags";
import { effectiveRole, resolveLook, type LookSelection } from "./style";
import { buildSurroundings, type SurroundingsScene } from "./surroundings";
import { onSchemeChange, readToken } from "./theme";
import { buildTerrain, type TerrainScene } from "./terrain";
import { buildVegetation, type VegetationScene } from "./vegetation";
import type { Viewer } from "./viewer";

export type FurnitureState = "idle" | "loading" | "ready" | "error";
export type VegetationState = "idle" | "loading" | "ready" | "error";

/** Changes the UI wants to hear about. */
export type HouseEvent =
  | { type: "furniture"; state: FurnitureState; error?: Error }
  | { type: "vegetation"; state: VegetationState; error?: Error }
  | { type: "look"; selection: LookSelection };

/** Content of a room tag: both strings come from the page (translated, formatted with `useFormat`). */
export interface RoomTag {
  title: string;
  detail: string;
}

export interface BuildHouseOptions {
  /** Initial look (group -> option id). Unknown ids fall back to the defaults. */
  look?: Partial<LookSelection>;
  /** Show the room tags from the start. Needs `labels: true` in the viewer options and `formatTag`. */
  labels?: boolean;
  /** Text of a room tag. Required for tags to exist at all (the engine owns no user-visible text). */
  formatTag?: (room: DerivedRoom) => RoomTag;
  /** Initial states of the switches. Defaults: roof on, furniture on (loaded lazily), boundary on, vegetation on, surroundings on. */
  roof?: boolean;
  furniture?: boolean;
  boundary?: boolean;
  vegetation?: boolean;
  /** Start loading the furniture GLB this long after the house is on screen, ms (default 200; `null` waits for `loadFurniture()`). */
  furnitureDelayMs?: number | null;
  /** Progress of the house GLB, 0..1 (weights come from the manifest). */
  onProgress?: (fraction: number, detail: LoadProgress) => void;
  /** Abort the build (the page was left). The promise rejects with a GlbError of kind "aborted"; nothing stays in the scene. */
  signal?: AbortSignal;
}

export interface HouseScene {
  readonly ctx: HouseContext;
  /** Parent of everything below; a child of `viewer.scene`. No transform. */
  readonly root: THREE.Group;
  /** Content of house(-lite).glb. */
  readonly building: THREE.Group;
  readonly terrain: TerrainScene;
  readonly surroundings: SurroundingsScene;
  /** Null until the vegetation is first shown (it is built on demand). */
  readonly vegetation: VegetationScene | null;
  /** Dashed outline of the plot, lying on the ground. */
  readonly boundary: THREE.Line;
  /** CSS2D room tags (children are CSS2DObjects), at 1.1 m above the floor, ordered by room area, de-cluttered while the camera moves. */
  readonly labels: THREE.Group;
  /** The section plane (normal -Y, constant = cut height). Hand it to add-ons only through `adopt()`. */
  readonly clip: readonly THREE.Plane[];
  /** Materials of the GLB by role; glass is the shared transparent glass material. */
  readonly materials: ReadonlyMap<string, THREE.Material>;
  /**
   * Meshes that block direct sun: every house mesh whose role passes `isOccluderRole`, never furniture. Fixed at build
   * time; movable shading (slat screens, exterior blinds) reports its own occluders.
   */
  readonly occluders: readonly THREE.Mesh[];
  /** Meshes with a ground role (`isGroundRole`) plus the terrain mesh: what a ray cast from above lands on. */
  readonly ground: readonly THREE.Mesh[];
  readonly look: LookSelection;
  readonly cut: number | null;
  readonly furnitureState: FurnitureState;
  readonly vegetationState: VegetationState;
  /** Current switches. */
  readonly roof: boolean;
  readonly furniture: boolean;
  readonly labelsVisible: boolean;
  readonly boundaryVisible: boolean;
  readonly vegetationVisible: boolean;

  /** Changes the look of some groups (`Partial` keeps the others). Persisting it (localStorage) is the page's job. */
  setLook(partial: Partial<LookSelection>): void;
  /** Hides or shows every node with `userData.toggle === "roof"`. */
  setRoof(on: boolean): void;
  /** Hides or shows the furniture; loads it first if needed (see `loadFurniture`). */
  setFurniture(on: boolean): void;
  /**
   * Loads furniture(-lite).glb into the scene (once; later calls return the same promise; a failed load can be retried by
   * calling again). Furniture follows the section cut and the interior fill, never blocks the sun and is not ground.
   */
  loadFurniture(): Promise<void>;
  setLabels(on: boolean): void;
  /** Rewrites the tags, e.g. after a language change without rebuilding the scene. */
  relabel(formatTag: (room: DerivedRoom) => RoomTag): void;
  setBoundary(on: boolean): void;
  /** Shows or hides the trees, shrubs and hedges (built on the first `true`). */
  setVegetation(on: boolean): void;
  /** Day of the year for the leaves of deciduous trees. */
  setDayOfYear(dayOfYear: number): void;
  /** Cut height in metres above the floor; `null` (or a value at or above the ridge, see `normalizeCut`) means no cut. Terrain and plants are not cut. */
  setCut(height: number | null): void;
  /**
   * Hands an add-on object to the scene: parents it to `root` and gives all its materials the section plane
   * (`clipShadows` on) and, for standard opaque ones, the interior fill. Add-ons built from `ctx` need nothing else.
   */
  adopt(object: THREE.Object3D): void;
  subscribe(listener: (event: HouseEvent) => void): () => void;
  /** Removes `root` from the viewer and disposes geometries, materials, textures and the BVH of everything it built. Idempotent. */
  dispose(): void;
}

type BvhGeometry = THREE.BufferGeometry & { computeBoundsTree: typeof computeBoundsTree; disposeBoundsTree: typeof disposeBoundsTree };
// Ray casting against the house (sun analysis, planting) goes through the BVH of each mesh that has one.
(THREE.BufferGeometry.prototype as BvhGeometry).computeBoundsTree = computeBoundsTree;
(THREE.BufferGeometry.prototype as BvhGeometry).disposeBoundsTree = disposeBoundsTree;
THREE.Mesh.prototype.raycast = acceleratedRaycast;

/** Details of the house scene (conventions of the renderer, not of the house). */
export const HOUSE_SCENE = {
  /** The plot boundary is drawn this far above the ground, dashed with this dash and gap, metres. */
  boundaryLift: 0.06,
  boundaryDash: 0.8,
  boundaryGap: 0.45,
  /** Points of the boundary line are at most this far apart so it follows the slope, metres. */
  boundaryStep: 1.5,
  /** The cut plane when there is no cut (above everything). */
  noCut: 1e4,
  /** The fog starts at this share of the distance to the far edge of the ground and ends at the second. */
  fogStart: 0.8,
  fogEnd: 2.0,
} as const;

const strictContract = process.env.NODE_ENV !== "production";

const abortError = (file: string) => new GlbError(`building the scene was aborted (${file})`, file, "aborted");

/** Materials of a mesh as a list. */
const materialsOf = (o: THREE.Object3D): THREE.Material[] => {
  const m = (o as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
  return m ? (Array.isArray(m) ? m : [m]) : [];
};

function boundaryLine(ctx: HouseContext): THREE.Line {
  const ring = [...ctx.site.plot, ctx.site.plot[0]];
  const g = ctx.site.terrain.groundAt;
  const pts: THREE.Vector3[] = [];
  for (let i = 0; i + 1 < ring.length; i++) {
    const a = ring[i], b = ring[i + 1];
    const n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / HOUSE_SCENE.boundaryStep));
    for (let k = 0; k < n; k++) {
      const x = a[0] + ((b[0] - a[0]) * k) / n, y = a[1] + ((b[1] - a[1]) * k) / n;
      pts.push(new THREE.Vector3(x, g(x, y) + HOUSE_SCENE.boundaryLift, -y));
    }
  }
  pts.push(pts[0].clone());
  const material = new THREE.LineDashedMaterial({ color: readToken("--on-media", "#ffffff"), dashSize: HOUSE_SCENE.boundaryDash, gapSize: HOUSE_SCENE.boundaryGap });
  const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), material);
  line.computeLineDistances();
  line.name = "plot-boundary";
  line.renderOrder = 2;
  return line;
}

/**
 * Builds the scene into `viewer.scene`: loads house(-lite).glb for the viewer's tier, checks the node contract, sets the
 * interior region, builds terrain, surroundings and the boundary, applies the look and the switches, and (after the delay)
 * starts loading the furniture. Rejects with a GlbError (network, parse, contract, aborted); the viewer stays usable.
 */
export async function buildHouse(viewer: Viewer, ctx: HouseContext, opts: BuildHouseOptions = {}): Promise<HouseScene> {
  const { signal } = opts;
  const tier = viewer.tier;
  const settings = viewer.settings;
  const houseFile = modelFile("house", tier);
  if (signal?.aborted) throw abortError(houseFile);

  // ---- the house GLB (nothing is added to the viewer before it is complete)
  const progress = createProgressGroup([houseFile], (f) => opts.onProgress?.(f, { file: houseFile, loaded: 0, total: 0, fraction: f }));
  const track = progress.track(houseFile);
  const gltf = await loadHouseGltf(tier, { signal, onProgress: (p) => { track(p); opts.onProgress?.(p.fraction, p); } });
  const building = gltf.scene;
  building.name = "building";
  if (signal?.aborted) { disposeTree(building); throw abortError(houseFile); }
  const report = checkHouseContract(building);
  if (!report.ok) {
    const message = `${houseFile} violates the GLB contract: ${report.problems.slice(0, 5).join("; ")}`;
    if (strictContract) { disposeTree(building); throw new GlbError(message, houseFile, "contract"); }
    console.warn(message);
  }

  // ---- state
  const root = new THREE.Group();
  root.name = "house";
  const clip: THREE.Plane[] = [new THREE.Plane(new THREE.Vector3(0, -1, 0), HOUSE_SCENE.noCut)];
  const listeners = new Set<(e: HouseEvent) => void>();
  const emit = (e: HouseEvent) => { for (const l of [...listeners]) l(e); };
  const abort = new AbortController();
  let disposed = false;
  let lookSel: LookSelection = {};
  let cut: number | null = null;
  let roofOn = opts.roof !== false;
  let furnitureOn = opts.furniture !== false;
  let furnitureState: FurnitureState = "idle";
  let furnitureRoot: THREE.Object3D | null = null;
  let furniturePromise: Promise<void> | null = null;
  let boundaryOn = opts.boundary !== false;
  let vegetationOn = opts.vegetation !== false;
  let vegetationState: VegetationState = "idle";
  let vegetation: VegetationScene | null = null;
  let dayOfYear = 172;
  let delayTimer: ReturnType<typeof setTimeout> | undefined;

  // ---- interior light, materials by role
  viewer.interior.setRegion(interiorRegionOf(ctx));
  viewer.interior.setShade(shadeBoxesOf(ctx));
  const materials = new Map<string, THREE.Material>();
  const meshes: THREE.Mesh[] = [];
  const glass = new THREE.MeshPhysicalMaterial({ roughness: 0.03, metalness: 0, transparent: true, depthWrite: false, side: THREE.DoubleSide, envMapIntensity: 1.6 });
  glass.name = "glass";
  building.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const role = extrasOf(mesh).role ?? "";
    mesh.userData.role = role;
    if (role === "glass") {
      mesh.material = glass;
      materials.set(role, glass);
    } else {
      const m = mesh.material as THREE.MeshStandardMaterial;
      if (!materials.has(role)) {
        m.envMapIntensity = 1;
        // the style decides roughness and metalness; the textures of the file stay neutral and are tinted by the colour
        m.roughnessMap = null; m.metalnessMap = null;
        if (m.map) m.map.anisotropy = settings.anisotropy;
        if (m.normalMap) m.normalMap.anisotropy = settings.anisotropy;
        materials.set(role, m);
        viewer.interior.patch(m);
      }
    }
    mesh.castShadow = role !== "glass" && !isGroundRole(role);
    mesh.receiveShadow = true;
    meshes.push(mesh);
  });
  for (const m of materials.values()) { m.clippingPlanes = clip; m.clipShadows = true; }

  // BVH for ray casting where it is needed: what blocks the sun and what a person can stand on
  const occluders = meshes.filter((m) => isOccluderRole(m.userData.role as string));
  const groundMeshes = meshes.filter((m) => isGroundRole(m.userData.role as string));
  for (const m of new Set([...occluders, ...groundMeshes])) (m.geometry as BvhGeometry).computeBoundsTree();

  // ---- look
  const rolesOf = (role: string) => meshes.filter((m) => m.userData.role === role);
  function applyLook(selection: Partial<LookSelection>) {
    const resolved = resolveLook(ctx.style, selection);
    lookSel = resolved.selection;
    for (const [role, material] of materials) {
      const r = resolved.materials[role];
      if (!r) continue;
      const m = material as THREE.MeshStandardMaterial;
      m.color.set(r.color);
      m.roughness = r.roughness;
      m.metalness = r.metallic;
      if (role === "glass") { m.opacity = r.alpha; m.needsUpdate = true; }
    }
    // a substituted role is drawn with the material of the other role
    for (const role of materials.keys()) {
      const eff = effectiveRole(resolved, role);
      const target = materials.get(eff) ?? materials.get(role);
      for (const mesh of rolesOf(role)) if (target && mesh.material !== target) mesh.material = target;
    }
  }
  applyLook(opts.look ?? {});

  // ---- ground, surroundings, boundary, labels
  const terrain = buildTerrain(ctx, { tier });
  const surroundings = buildSurroundings(ctx, { tier });
  const boundary = boundaryLine(ctx);
  boundary.visible = boundaryOn;
  const tags = createRoomTags(viewer, ctx, opts.formatTag, !!opts.labels);
  root.add(building, terrain.group, surroundings.group, boundary, tags.group);
  const offScheme = onSchemeChange(() => {
    terrain.repaint();
    (boundary.material as THREE.LineDashedMaterial).color.set(readToken("--on-media", "#ffffff"));
    viewer.requestRender();
  });
  // the fog hides the edge of the ground: it starts shortly before the farthest corner of the ground seen from the middle of the plot
  {
    const b = ctx.site.bounds, [cx, cy] = viewer.extent.center;
    const far = Math.max(...[[b.x0, b.y0], [b.x1, b.y0], [b.x1, b.y1], [b.x0, b.y1]].map(([x, y]) => Math.hypot(x - cx, y - cy)));
    viewer.setFog(far * HOUSE_SCENE.fogStart, far * HOUSE_SCENE.fogEnd);
  }

  // ---- the switches
  function setRoof(on: boolean) {
    roofOn = on;
    building.traverse((o) => { if (extrasOf(o).toggle === "roof" && (o as THREE.Mesh).isMesh) o.visible = on; });
    viewer.requestRender();
  }
  setRoof(roofOn);

  function setCut(height: number | null) {
    cut = normalizeCut(height, ctx.derived);
    clip[0].constant = cut ?? HOUSE_SCENE.noCut;
    viewer.requestRender();
  }

  function loadFurniture(): Promise<void> {
    if (furniturePromise) return furniturePromise;
    furnitureState = "loading";
    emit({ type: "furniture", state: "loading" });
    furniturePromise = loadFurnitureGltf(tier, { signal: abort.signal })
      .then((g) => {
        if (disposed) { disposeTree(g.scene); return; }
        furnitureRoot = prepareFurniture(g.scene, { settings, interior: viewer.interior, clip });
        furnitureRoot.visible = furnitureOn;
        root.add(furnitureRoot);
        furnitureState = "ready";
        emit({ type: "furniture", state: "ready" });
        viewer.requestRender();
      })
      .catch((e: unknown) => {
        furniturePromise = null; // a later call may try again
        if (disposed) return;
        furnitureState = "error";
        const error = e instanceof Error ? e : new Error(String(e));
        emit({ type: "furniture", state: "error", error });
        throw error;
      });
    return furniturePromise;
  }

  function loadVegetation() {
    if (vegetation || vegetationState === "loading") return;
    vegetationState = "loading";
    emit({ type: "vegetation", state: "loading" });
    buildVegetation(ctx, { tier, dayOfYear })
      .then((v) => {
        if (disposed) { v.dispose(); return; }
        vegetation = v;
        v.setVisible(vegetationOn);
        root.add(v.group);
        vegetationState = "ready";
        emit({ type: "vegetation", state: "ready" });
        viewer.requestRender();
      })
      .catch((e: unknown) => {
        if (disposed) return;
        vegetationState = "error";
        emit({ type: "vegetation", state: "error", error: e instanceof Error ? e : new Error(String(e)) });
      });
  }

  viewer.scene.add(root);
  if (vegetationOn) loadVegetation();
  if (furnitureOn && opts.furnitureDelayMs !== null) {
    delayTimer = setTimeout(() => { loadFurniture().catch(() => undefined); }, opts.furnitureDelayMs ?? 200);
  }
  viewer.requestRender();

  const scene: HouseScene = {
    ctx, root, building, terrain, surroundings, boundary, labels: tags.group, clip, materials, occluders,
    ground: [...groundMeshes, terrain.mesh],
    get vegetation() { return vegetation; },
    get look() { return { ...lookSel }; },
    get cut() { return cut; },
    get furnitureState() { return furnitureState; },
    get vegetationState() { return vegetationState; },
    get roof() { return roofOn; },
    get furniture() { return furnitureOn; },
    get labelsVisible() { return tags.group.visible; },
    get boundaryVisible() { return boundaryOn; },
    get vegetationVisible() { return vegetationOn; },
    setLook(partial) {
      applyLook({ ...lookSel, ...partial });
      emit({ type: "look", selection: { ...lookSel } });
      viewer.requestRender();
    },
    setRoof,
    setFurniture(on) {
      furnitureOn = on;
      if (furnitureRoot) furnitureRoot.visible = on;
      else if (on) loadFurniture().catch(() => undefined);
      viewer.requestRender();
    },
    loadFurniture,
    setLabels: (on) => tags.setVisible(on),
    relabel: (fn) => tags.relabel(fn),
    setBoundary(on) { boundaryOn = on; boundary.visible = on; viewer.requestRender({ shadows: false }); },
    setVegetation(on) {
      vegetationOn = on;
      if (vegetation) vegetation.setVisible(on);
      else if (on) loadVegetation();
      viewer.requestRender();
    },
    setDayOfYear(n) { dayOfYear = n; vegetation?.setDayOfYear(n); viewer.requestRender(); },
    setCut,
    adopt(object) {
      root.add(object);
      object.traverse((o) => {
        for (const m of materialsOf(o)) {
          m.clippingPlanes = clip;
          m.clipShadows = true;
          viewer.interior.patch(m);
        }
      });
      viewer.requestRender();
    },
    subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    dispose() {
      if (disposed) return;
      disposed = true;
      clearTimeout(delayTimer);
      abort.abort();
      offScheme();
      listeners.clear();
      tags.dispose();
      vegetation?.dispose();
      surroundings.dispose();
      terrain.dispose();
      (boundary.geometry as THREE.BufferGeometry).dispose();
      disposeMaterial(boundary.material as THREE.Material);
      if (furnitureRoot) disposeTree(furnitureRoot);
      disposeTree(building);
      glass.dispose();
      root.removeFromParent();
      root.clear();
      viewer.requestRender();
    },
  };
  setCut(null);
  return scene;
}

/** A cut at or above the ridge (`derived.bbox.z1`) is no cut: returns `null`, else the height itself. */
export function normalizeCut(height: number | null, derived: Pick<Derived, "bbox">): number | null {
  return height === null || !Number.isFinite(height) || height >= derived.bbox.z1 ? null : height;
}
