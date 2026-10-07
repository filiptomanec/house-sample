// Trees, shrubs and hedges of the plot, from `site.trees`, `site.shrubs` and `site.hedges` (docs/SITE.md). Procedural, instanced
// (one draw call per material), standing on the analytic ground (`ctx.site.terrain.groundAt`, no ray casting).
//
//  * Crown shape follows the data, not the species name: an evergreen tree is a conical-ovoid crown, a deciduous tree a
//    rounded crown, a tall narrow crown (height / crown diameter above `COLUMNAR_RATIO`) a columnar one. Height, crown diameter
//    and crown base come from the tree, the colour from `style.generated` (`foliage_*`, `bark`) or derived from `lawn`.
//  * Deciduous crowns follow the season: `setDayOfYear(n)` fades the foliage with the same `leafFactor` the sun analysis uses
//    (leaves open 15 April to 15 May and fall 5 October to 5 November; evergreens constant), so what is drawn is what shades.
//  * Optional: `tree.glb` and `shrub.glb` entries in the models manifest replace the procedural shapes (none exist now).
//  * "low" tier draws `TIER_SETTINGS.low.vegetationDensity` of the foliage cards and no ground cover.
import * as THREE from "three";
import { leafFactor } from "@/lib/model/site";
import type { XY } from "@/lib/model/site";
import type { HouseContext } from "./context";
import { disposeTree } from "./dispose";
import { TIER_SETTINGS, type Tier } from "./tier";

/** Height / crown-diameter ratio above which a tree is drawn columnar. */
export const COLUMNAR_RATIO = 2.2;

export interface VegetationOptions {
  tier: Tier;
  /** Day of the year for the leaf state (default: 172, the summer solstice). */
  dayOfYear?: number;
  /** Seed of the pseudo-random variation (default 1); the same seed gives the same plants. */
  seed?: number;
}

export interface VegetationScene {
  readonly group: THREE.Group;
  readonly counts: { trees: number; shrubs: number; hedgeSegments: number };
  setVisible(visible: boolean): void;
  setDayOfYear(dayOfYear: number): void;
  dispose(): void;
}

/** Drawing conventions of the plants (nature and taste, not the house). */
export const PLANT = {
  /** Trunk radius per metre of tree height, and its lower bound, m. */
  trunkRadiusPerHeight: 0.018,
  trunkRadiusMin: 0.05,
  /** Blobs (ellipsoids) per crown shape. */
  blobsRounded: 7,
  blobsStacked: 4,
  /** Leaf cards per blob at full density, and their size as a share of the blob radius. */
  cardsPerBlob: 20,
  cardSize: 0.55,
  /** Hedges are cut into pieces of at most this length, m; leaf cards per square metre of their surface; card size, m. */
  hedgePiece: 1.5,
  hedgeCardsPerM2: 9,
  hedgeCardSize: 0.45,
  /** A hedge sinks this far into the ground, m. */
  hedgeSink: 0.1,
  /** Longest piece of branch (trunk top to a blob), as bark radius per metre. */
  branchRadiusPerMetre: 0.012,
  /** Colour variation per plant (HSL offsets). */
  hue: 0.025,
  lightness: 0.06,
  /** The evergreen foliage is this much darker than the deciduous. */
  evergreenDarken: 0.78,
  /** Foliage derived from the lawn colour (no `foliage_*` entry in the style) is this much darker. */
  derivedDarken: 0.6,
} as const;

const RNG_MUL = 1664525, RNG_ADD = 1013904223;
/** Small seeded pseudo-random generator (linear congruential), stable across platforms. */
export function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => ((s = (Math.imul(s, RNG_MUL) + RNG_ADD) >>> 0) / 0x100000000);
}
/** A seed from a position (centimetres), so a plant looks the same wherever it sits in the list. */
export const seedAt = (seed: number, x: number, y: number): number => (Math.imul(Math.round(x * 100) | 0, 73856093) ^ Math.imul(Math.round(y * 100) | 0, 19349663) ^ Math.imul(seed | 0, 83492791)) >>> 0;

export type CrownShape = "rounded" | "conical" | "columnar";
/** The crown shape follows the data, not the species name. */
export function crownShape(evergreen: boolean, height: number, crown: number): CrownShape {
  if (height / crown > COLUMNAR_RATIO) return "columnar";
  return evergreen ? "conical" : "rounded";
}

/** One ellipsoid of foliage: centre and radii (east, north, up) in the house frame. */
export interface Blob {
  centre: [number, number, number];
  radii: [number, number, number];
}

/**
 * The blobs of a tree crown standing at (x, y) with its foot at `z0`. Deterministic for a seed. Invariant (tested): every blob lies
 * inside the crown's cylinder: its horizontal reach is at most the crown radius and its vertical extent between the crown base
 * and the top of the tree, so the drawn crown never exceeds the data (it is also what the sun analysis shades with).
 */
export function treeBlobs(shape: CrownShape, x: number, y: number, z0: number, height: number, crown: number, crownBase: number, rand: () => number): Blob[] {
  const base = crownBase, ch = height - base, R = crown / 2;
  const blobs: Blob[] = [];
  if (shape === "rounded") {
    for (let i = 0; i < PLANT.blobsRounded; i++) {
      // the first blob is the heart of the crown, the others sit around it, all inside the cylinder
      const r = R * (i === 0 ? 0.72 : 0.42 + 0.16 * rand());
      const rz = Math.min(r * 0.85, ch / 2);
      const reach = i === 0 ? 0 : (0.25 + 0.75 * rand()) * (R - r);
      const a = rand() * Math.PI * 2;
      const dz = (rand() * 2 - 1) * (ch / 2 - rz);
      blobs.push({ centre: [x + Math.cos(a) * reach, y + Math.sin(a) * reach, z0 + base + ch / 2 + dz], radii: [r, r, rz] });
    }
  } else {
    const n = PLANT.blobsStacked;
    const rz = (ch / n) * 0.85;
    for (let i = 0; i < n; i++) {
      const k = n > 1 ? i / (n - 1) : 0.5; // 0 at the crown base, 1 at the tip
      const taper = shape === "conical" ? Math.pow(1 - k, 0.85) * 0.85 + 0.15 : 0.92 + 0.08 * rand();
      const r = R * taper;
      const wob = (R - r) * 0.5 * rand();
      const a = rand() * Math.PI * 2;
      blobs.push({ centre: [x + Math.cos(a) * wob, y + Math.sin(a) * wob, z0 + base + rz + k * (ch - 2 * rz)], radii: [r, r, rz] });
    }
  }
  return blobs;
}

/** A unit ellipsoid with a little irregularity, flat shaded: the building block of crowns and shrubs (low-poly). */
function blobGeometry(): THREE.BufferGeometry {
  const g = new THREE.IcosahedronGeometry(1, 1);
  const pos = g.attributes.position as THREE.BufferAttribute;
  const rand = rng(11);
  const jitter = new Map<string, number>();
  for (let i = 0; i < pos.count; i++) {
    // vertices with the same position share the same displacement, so the surface stays closed
    const key = `${pos.getX(i).toFixed(3)},${pos.getY(i).toFixed(3)},${pos.getZ(i).toFixed(3)}`;
    let j = jitter.get(key);
    if (j === undefined) { j = 0.88 + 0.22 * rand(); jitter.set(key, j); }
    pos.setXYZ(i, pos.getX(i) * j, pos.getY(i) * j, pos.getZ(i) * j);
  }
  // the icosahedron is already non-indexed: the normals computed here are flat per face
  g.computeVertexNormals();
  return g;
}

/**
 * A cluster of leaves on a transparent card, drawn in light greys so the instance colour tints it. A canvas cannot keep
 * colour under zero alpha, so the transparent texels would pull a dark fringe into the leaf edges when filtered; the texture
 * therefore goes to the GPU as raw data whose transparent texels carry the mean leaf colour.
 */
function leafTexture(): THREE.Texture {
  const size = 128, canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const g = canvas.getContext("2d", { willReadFrequently: true });
  const data = new Uint8Array(size * size * 4);
  if (g) {
    const rand = rng(5);
    for (let i = 0; i < 26; i++) {
      const x = size * (0.12 + 0.76 * rand()), y = size * (0.12 + 0.76 * rand()), a = rand() * Math.PI, l = 12 + rand() * 12;
      const shade = Math.round(205 + 50 * rand());
      g.fillStyle = `rgb(${shade}, ${shade}, ${shade})`;
      g.beginPath();
      g.ellipse(x, y, l, l * 0.42, a, 0, Math.PI * 2);
      g.fill();
    }
    const px = g.getImageData(0, 0, size, size).data;
    let sum = 0, n = 0;
    for (let i = 0; i < px.length; i += 4) if (px[i + 3] > 200) { sum += px[i]; n++; }
    const mean = n ? Math.round(sum / n) : 230;
    for (let i = 0; i < px.length; i += 4) {
      const opaque = px[i + 3] > 24;
      data[i] = data[i + 1] = data[i + 2] = opaque ? px[i] : mean;
      data[i + 3] = px[i + 3];
    }
  }
  const t = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.flipY = false;
  t.anisotropy = 4;
  t.needsUpdate = true;
  return t;
}

/**
 * Cut-out foliage: alpha test from the card's alpha, with the alpha raised by the mip level (B. Golus, "Anti-aliased alpha
 * test") so distant canopies do not thin out to specks. Alpha-to-coverage only with MSAA (the low tier).
 */
function foliageCardMaterial(map: THREE.Texture, msaa: boolean): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ map, roughness: 0.9, metalness: 0, side: THREE.DoubleSide, alphaTest: msaa ? 0.45 : 0.3, alphaToCoverage: msaa });
  m.onBeforeCompile = (sh) => {
    sh.fragmentShader = sh.fragmentShader.replace("#include <map_fragment>", `#include <map_fragment>
      #ifdef USE_MAP
        vec2 leafTexel = vMapUv * vec2( textureSize( map, 0 ) );
        vec2 leafDx = dFdx( leafTexel ), leafDy = dFdy( leafTexel );
        float leafMip = max( 0.0, 0.5 * log2( max( dot( leafDx, leafDx ), dot( leafDy, leafDy ) ) ) );
        diffuseColor.a *= 1.0 + leafMip * 0.4;
      #endif`);
  };
  m.customProgramCacheKey = () => "leaf-card-v1";
  return m;
}

interface Piece {
  mesh: THREE.InstancedMesh;
  index: number;
  position: THREE.Vector3;
  quaternion: THREE.Quaternion;
  scale: THREE.Vector3;
  /** Fraction of the scale that stays in winter (1 = evergreen, 0 = bare). */
  winterShare: number;
  seasonal: boolean;
}

/** Foliage colour of the style: `foliage_*` when present, else the lawn colour darkened. */
function foliageColor(ctx: HouseContext, role: string): THREE.Color {
  const own = ctx.style.generated?.[role];
  if (own) return new THREE.Color(own.color);
  return new THREE.Color(ctx.style.materials.lawn?.color ?? "#6f8f4a").multiplyScalar(PLANT.derivedDarken);
}

/** Builds the plants. Asynchronous only because an optional GLB may be fetched; without one it resolves in the same task. */
export async function buildVegetation(ctx: HouseContext, opts: VegetationOptions): Promise<VegetationScene> {
  const settings = TIER_SETTINGS[opts.tier];
  const low = opts.tier === "low";
  const seed = opts.seed ?? 1;
  const { site } = ctx;
  const ground = site.terrain.groundAt;
  const species = site.model.species;

  // ---- plan the instances first (pure), then fill the instanced meshes
  interface Want { kind: "blob" | "card" | "bark" | "hedge"; matrix: THREE.Matrix4; color: THREE.Color; seasonal: boolean; winterShare: number; position: THREE.Vector3; quaternion: THREE.Quaternion; scale: THREE.Vector3 }
  const wants: Want[] = [];
  const tmp = new THREE.Object3D();
  const up = new THREE.Vector3(0, 1, 0);
  const add = (kind: Want["kind"], pos: THREE.Vector3, quat: THREE.Quaternion, scale: THREE.Vector3, color: THREE.Color, seasonal: boolean, winterShare = 0) => {
    tmp.position.copy(pos); tmp.quaternion.copy(quat); tmp.scale.copy(scale); tmp.updateMatrix();
    wants.push({ kind, matrix: tmp.matrix.clone(), color, seasonal, winterShare, position: pos.clone(), quaternion: quat.clone(), scale: scale.clone() });
  };
  const sceneOf = (b: [number, number, number]) => new THREE.Vector3(b[0], b[2], -b[1]);
  const treeColor = foliageColor(ctx, "foliage_tree"), shrubColor = foliageColor(ctx, "foliage_shrub");
  const barkColor = new THREE.Color(ctx.style.generated?.bark?.color ?? ctx.style.materials.wood_cladding?.color ?? "#6b5a4a").multiplyScalar(ctx.style.generated?.bark ? 1 : 0.35);

  const vary = (base: THREE.Color, rand: () => number, evergreen: boolean) => {
    const c = base.clone();
    if (evergreen) c.multiplyScalar(PLANT.evergreenDarken);
    return c.offsetHSL((rand() - 0.5) * PLANT.hue, 0, (rand() - 0.5) * PLANT.lightness);
  };

  const cardCount = (n: number) => Math.max(0, Math.round(n * settings.vegetationDensity));
  const addCards = (blob: Blob, rand: () => number, color: THREE.Color, seasonal: boolean, winterShare: number) => {
    const n = cardCount(PLANT.cardsPerBlob);
    const R = Math.max(...blob.radii);
    for (let i = 0; i < n; i++) {
      // a direction on the blob surface, a card facing outwards with a random roll
      const u = rand() * 2 - 1, a = rand() * Math.PI * 2, r = Math.sqrt(1 - u * u);
      const dir = new THREE.Vector3(r * Math.cos(a), u, r * Math.sin(a));
      const centre = sceneOf(blob.centre);
      const pos = centre.clone().add(new THREE.Vector3(dir.x * blob.radii[0], dir.y * blob.radii[2], dir.z * blob.radii[1]).multiplyScalar(0.98));
      const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), rand() * Math.PI * 2));
      const sz = R * PLANT.cardSize * (0.8 + 0.5 * rand());
      add("card", pos, q, new THREE.Vector3(sz, sz, 1), color.clone().offsetHSL(0, 0, (rand() - 0.5) * PLANT.lightness), seasonal, winterShare);
    }
  };
  const addBlob = (blob: Blob, rand: () => number, color: THREE.Color, seasonal: boolean, winterShare: number) => {
    const q = new THREE.Quaternion().setFromAxisAngle(up, rand() * Math.PI * 2);
    add("blob", sceneOf(blob.centre), q, new THREE.Vector3(blob.radii[0], blob.radii[2], blob.radii[1]), color, seasonal, winterShare);
  };
  const addBark = (from: THREE.Vector3, to: THREE.Vector3, r0: number) => {
    const d = to.clone().sub(from), len = d.length();
    const q = new THREE.Quaternion().setFromUnitVectors(up, d.normalize());
    add("bark", from.clone().addScaledVector(d, len / 2), q, new THREE.Vector3(r0, len, r0), barkColor, false);
  };

  let trees = 0, shrubs = 0, hedgeSegments = 0;
  for (const t of site.model.trees) {
    const sp = species[t.species];
    const evergreen = sp?.evergreen ?? false;
    const rand = rng(seedAt(seed, t.pos[0], t.pos[1]));
    const z0 = ground(t.pos[0], t.pos[1]);
    const crownBase = t.crownBase ?? 0.3 * t.height;
    const shape = crownShape(evergreen, t.height, t.crown);
    const blobs = treeBlobs(shape, t.pos[0], t.pos[1], z0, t.height, t.crown, crownBase, rand);
    const color = vary(treeColor, rand, evergreen);
    const trunkTop = sceneOf([t.pos[0], t.pos[1], z0 + Math.max(crownBase, t.height * 0.45)]);
    const foot = sceneOf([t.pos[0], t.pos[1], z0 - 0.1]);
    const r = Math.max(PLANT.trunkRadiusMin, PLANT.trunkRadiusPerHeight * t.height);
    addBark(foot, trunkTop, r);
    for (const b of blobs) {
      addBlob(b, rand, color.clone().offsetHSL(0, 0, (rand() - 0.5) * PLANT.lightness), !evergreen, 0);
      addCards(b, rand, color, !evergreen, 0);
      // a branch from the trunk top towards the middle of the blob (visible when the tree is bare)
      const to = sceneOf(b.centre);
      if (to.distanceTo(trunkTop) > 0.2) addBark(trunkTop, to.lerp(trunkTop, 0.15), Math.max(0.02, PLANT.branchRadiusPerMetre * to.distanceTo(trunkTop) * 3));
    }
    trees++;
  }
  for (const sh of site.model.shrubs) {
    const sp = species[sh.species];
    const evergreen = sp?.evergreen ?? false;
    const rand = rng(seedAt(seed, sh.pos[0], sh.pos[1]));
    const z0 = ground(sh.pos[0], sh.pos[1]);
    const color = vary(shrubColor, rand, evergreen);
    const n = sh.width > 0.9 ? 2 : 1;
    for (let i = 0; i < n; i++) {
      const w = sh.width / 2 / (n > 1 ? 1.5 : 1), off = n > 1 ? (i - 0.5) * w * 1.1 : 0;
      const blob: Blob = { centre: [sh.pos[0] + off, sh.pos[1] + (rand() - 0.5) * 0.1, z0 + sh.height / 2 - 0.05], radii: [w, w, sh.height / 2] };
      addBlob(blob, rand, color, !evergreen, 0);
      addCards(blob, rand, color, !evergreen, 0);
    }
    shrubs++;
  }
  for (const h of site.hedges) {
    const sp = species[h.species];
    const evergreen = sp?.evergreen ?? false;
    const ratio = sp ? sp.extinction.leafOff / Math.max(1e-6, sp.extinction.leafOn) : 1;
    const winterShare = evergreen ? 1 : Math.cbrt(Math.min(1, ratio));
    const color = vary(treeColor, rng(seedAt(seed, h.path[0][0], h.path[0][1])), evergreen);
    for (let i = 0; i + 1 < h.path.length; i++) {
      const a = h.path[i], b = h.path[i + 1], len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const n = Math.max(1, Math.ceil(len / PLANT.hedgePiece));
      for (let k = 0; k < n; k++) {
        const mid: XY = [a[0] + ((b[0] - a[0]) * (k + 0.5)) / n, a[1] + ((b[1] - a[1]) * (k + 0.5)) / n];
        const pl = len / n, z0 = ground(mid[0], mid[1]) - PLANT.hedgeSink, hh = h.height + PLANT.hedgeSink;
        const yaw = Math.atan2(b[1] - a[1], b[0] - a[0]);
        // a house-frame direction at angle yaw from +x is the same angle about the scene's +y (the frames differ by a proper rotation)
        const q = new THREE.Quaternion().setFromAxisAngle(up, yaw);
        const centre = sceneOf([mid[0], mid[1], z0 + hh / 2]);
        add("hedge", centre, q, new THREE.Vector3(pl * 1.02, hh, h.width), color, !evergreen, winterShare);
        hedgeSegments++;
        // leaf cards over the top and the two long sides, facing outwards, so the cut hedge has a leafy surface
        const rand = rng(seedAt(seed, mid[0], mid[1]));
        const areaTop = pl * h.width, areaSide = pl * hh, total = areaTop + 2 * areaSide;
        const cards = cardCount(Math.round(PLANT.hedgeCardsPerM2 * total));
        for (let i = 0; i < cards; i++) {
          const pick = rand() * total;
          const rx = (rand() - 0.5) * pl, ry = (rand() - 0.5) * hh, rz = (rand() - 0.5) * h.width;
          // local frame of the piece: x along, y up, z across; the face a card sits on gives its normal
          const [local, normal] = pick < areaTop
            ? [new THREE.Vector3(rx, hh / 2, rz), new THREE.Vector3(0, 1, 0)]
            : pick < areaTop + areaSide
              ? [new THREE.Vector3(rx, ry, h.width / 2), new THREE.Vector3(0, 0, 1)]
              : [new THREE.Vector3(rx, ry, -h.width / 2), new THREE.Vector3(0, 0, -1)];
          const qc = q.clone().multiply(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal)).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), rand() * Math.PI * 2));
          const sz = PLANT.hedgeCardSize * (0.8 + 0.5 * rand());
          add("card", centre.clone().add(local.applyQuaternion(q)), qc, new THREE.Vector3(sz, sz, 1), color.clone().offsetHSL(0, 0, (rand() - 0.5) * PLANT.lightness), !evergreen, winterShare);
        }
      }
    }
  }

  // ---- instanced meshes
  const group = new THREE.Group();
  group.name = "vegetation";
  const cardTexture = leafTexture();
  const blobGeo = blobGeometry(), cardGeo = new THREE.PlaneGeometry(1, 1), barkGeo = new THREE.CylinderGeometry(0.6, 1, 1, 6, 1, false), hedgeGeo = new THREE.BoxGeometry(1, 1, 1);
  const foliage = new THREE.MeshStandardMaterial({ roughness: 0.92, metalness: 0, flatShading: true });
  const cardMaterial = foliageCardMaterial(cardTexture, settings.msaa);
  const bark = new THREE.MeshStandardMaterial({ roughness: 0.95, metalness: 0, flatShading: true });
  const setup: Record<Want["kind"], [string, THREE.BufferGeometry, THREE.Material, boolean]> = {
    blob: ["foliage_blobs", blobGeo, foliage, true],
    card: ["foliage_cards", cardGeo, cardMaterial, !low],
    bark: ["bark", barkGeo, bark, true],
    hedge: ["hedges", hedgeGeo, foliage, true],
  };
  const pieces: Piece[] = [];
  const meshes: THREE.InstancedMesh[] = [];
  for (const kind of Object.keys(setup) as Want["kind"][]) {
    const list = wants.filter((w) => w.kind === kind);
    if (!list.length) continue;
    const [name, geo, mat, cast] = setup[kind];
    const mesh = new THREE.InstancedMesh(geo, mat, list.length);
    mesh.name = name;
    mesh.castShadow = cast;
    mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    list.forEach((w, i) => {
      mesh.setMatrixAt(i, w.matrix);
      mesh.setColorAt(i, w.color);
      pieces.push({ mesh, index: i, position: w.position, quaternion: w.quaternion, scale: w.scale, winterShare: w.winterShare, seasonal: w.seasonal });
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    meshes.push(mesh);
    group.add(mesh);
  }

  const m4 = new THREE.Matrix4(), s3 = new THREE.Vector3();
  const touched = new Set<THREE.InstancedMesh>();
  function setDayOfYear(day: number) {
    const f = leafFactor(day, false);
    touched.clear();
    for (const p of pieces) {
      if (!p.seasonal) continue;
      const k = p.winterShare + (1 - p.winterShare) * f;
      s3.copy(p.scale).multiplyScalar(Math.max(k, 1e-4));
      p.mesh.setMatrixAt(p.index, m4.compose(p.position, p.quaternion, s3));
      touched.add(p.mesh);
    }
    for (const m of touched) m.instanceMatrix.needsUpdate = true;
  }
  setDayOfYear(opts.dayOfYear ?? 172);

  return {
    group,
    counts: { trees, shrubs, hedgeSegments },
    setVisible(v) { group.visible = v; },
    setDayOfYear,
    dispose() {
      disposeTree(group);
      cardTexture.dispose();
      for (const m of meshes) m.dispose();
    },
  };
}
