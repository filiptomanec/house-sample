// Trees, shrubs and hedges of the plot, from `site.trees`, `site.shrubs` and `site.hedges` (docs/SITE.md). Procedural, instanced
// (one draw call per material), standing on the analytic ground (`ctx.site.terrain.groundAt`, no ray casting).
//
//  * Crown shape follows the data, not the species name: an evergreen tree is a conical-ovoid crown, a deciduous tree a
//    rounded crown, a tall narrow crown (height / crown diameter above `COLUMNAR_RATIO`) a columnar one. Height, crown diameter
//    and crown base come from the tree, the colour from `style.generated` (`foliage_*`, `bark`) or derived from `lawn`.
//  * Deciduous crowns follow the season: `setDayOfYear(n)` fades the foliage with the same `leafFactor` the sun analysis uses
//    (leaves open 15 April to 15 May and fall 5 October to 5 November; evergreens constant), so what is drawn is what shades.
//  * Crowns read as one soft volume: smooth blobs whose normals lean towards the direction from the crown's centre, darker
//    inside and towards the bottom of the crown (a per-instance crown centre, shader patch), leaf cards over them. A large
//    rounded crown gets more blobs spread over a broad dome, so a big tree (the walnut) reads big and broad.
//  * Baked tree: when the models manifest lists `tree.glb` (pipeline/blender/vegetation_bake.py, from the CC0 tree of ASSETS.md,
//    docs/PIPELINE.md section 9: nodes `tree_bark` / `tree_foliage` with `extras.role` "bark" / "foliage", geometry normalised to
//    height 1 and crown 1, scene extras `crownBase` (share of the height) and `crownCentre`), the "high" tier draws every tree
//    with a rounded crown as an instance of it (two draw calls for all of them), scaled to the tree's height and crown, turned
//    by a seeded angle, the leaves tinted to the style's foliage colour per tree and shrunk towards the crown centre with the
//    season. Conical and columnar crowns, the "low" tier and a failed load use the procedural trees.
//  * Planted beds: every mulch bed of the site gets low perennial clumps on a jittered grid (`bedPlantings`, `BED_PLANTING`), clear
//    of the site's shrubs, like the planting mix of the renders, so a bed reads as planted and not as a bare patch.
//  * "low" tier draws `TIER_SETTINGS.low.vegetationDensity` of the foliage cards.
import * as THREE from "three";
import { mergeVertices } from "three/addons/utils/BufferGeometryUtils.js";
import { distToBoundary, leafFactor, pointInPolygon, polygonArea } from "@/lib/model/site";
import type { XY } from "@/lib/model/site";
import type { HouseContext } from "./context";
import { disposeTree } from "./dispose";
import { MODEL_MANIFEST, loadGltf } from "./glb";
import { TIER_SETTINGS, type Tier } from "./tier";

/** Height / crown-diameter ratio above which a tree is drawn columnar. */
export const COLUMNAR_RATIO = 2.2;

export interface VegetationOptions {
  tier: Tier;
  /** Day of the year for the leaf state (default: 172, the summer solstice). */
  dayOfYear?: number;
  /** Seed of the pseudo-random variation (default 1); the same seed gives the same plants. */
  seed?: number;
  /** Use the baked `tree.glb` for rounded crowns (default: on the "high" tier when the manifest lists it). */
  treeModel?: boolean;
  /** Abort loading the tree model (the build then resolves with procedural trees). */
  signal?: AbortSignal;
}

/** The baked tree of the models manifest (pipeline/blender/vegetation_bake.py). */
export const TREE_MODEL_FILE = "tree.glb";

/** A loaded tree model: bark and leaf geometry (trunk foot at the origin, scene frame Y-up), the leaf texture and its size. */
export interface TreeModel {
  bark: THREE.BufferGeometry;
  leaves: THREE.BufferGeometry;
  /** The leaf texture (base colour or emissive map of the leaf material) and the bark material of the file. */
  leafMap: THREE.Texture | null;
  barkMaterial: THREE.Material | null;
  height: number;
  crown: number;
  crownBase: number;
}

/** Scene extras of a baked tree. `sourceHeight` marks the normalised file of the pipeline (height 1, crown 1). */
interface TreeExtras { height?: number; crown?: number; crownBase?: number; crownCentre?: readonly number[] | { x: number; y: number }; sourceHeight?: number }

/**
 * The tree model of a loaded scene: the meshes with `userData.role` "bark" and "foliage" (or "leaves"), geometry baked into the
 * scene frame. The pipeline's file is normalised (scene extra `sourceHeight` present): height 1, crown diameter 1, `crownBase` a
 * share of the height. Other files give `height`, `crown` and `crownBase` in their own units, else the bounding boxes do. When the
 * extras carry `crownCentre` (plan offset of the crown from the trunk, house frame x / y, in crown diameters) the geometry is
 * moved so the crown, not the trunk, is centred on the origin: an instance then puts the crown on the site position, where
 * the sun analysis and the plot drawings have it. Null when either part is missing.
 */
export function treeModelOf(scene: THREE.Object3D): TreeModel | null {
  let bark: THREE.Mesh | null = null, leaves: THREE.Mesh | null = null;
  scene.updateMatrixWorld(true);
  scene.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    const role = m.userData.role ?? m.parent?.userData.role;
    if (role === "bark" && !bark) bark = m;
    if ((role === "leaves" || role === "foliage") && !leaves) leaves = m;
  });
  if (!bark || !leaves) return null;
  const b = bark as THREE.Mesh, l = leaves as THREE.Mesh;
  const barkGeo = b.geometry.clone().applyMatrix4(b.matrixWorld), leafGeo = l.geometry.clone().applyMatrix4(l.matrixWorld);
  leafGeo.computeBoundingBox(); barkGeo.computeBoundingBox();
  const lb = leafGeo.boundingBox!, bb = barkGeo.boundingBox!;
  const extras = scene.userData as TreeExtras;
  const normalised = typeof extras.sourceHeight === "number";
  const lm = (Array.isArray(l.material) ? l.material[0] : l.material) as THREE.MeshStandardMaterial;
  const height = extras.height ?? (normalised ? 1 : Math.max(lb.max.y, bb.max.y));
  const crown = extras.crown ?? (normalised ? 1 : Math.max(lb.max.x - lb.min.x, lb.max.z - lb.min.z));
  const crownBase = extras.crownBase === undefined ? lb.min.y : normalised ? extras.crownBase * height : extras.crownBase;
  const cc = extras.crownCentre;
  const [cx, cy] = Array.isArray(cc) ? [Number(cc[0]) || 0, Number(cc[1]) || 0] : cc && typeof cc === "object" ? [(cc as { x: number }).x || 0, (cc as { y: number }).y || 0] : [0, 0];
  if (cx || cy) {
    // house (x, y) is scene (x, -z): move the crown centre at house (cx, cy) × crown onto the vertical axis
    for (const g of [barkGeo, leafGeo]) { g.translate(-cx * crown, 0, cy * crown); g.computeBoundingBox(); }
  }
  return {
    bark: barkGeo, leaves: leafGeo,
    leafMap: lm?.map ?? lm?.emissiveMap ?? null,
    barkMaterial: (Array.isArray(b.material) ? b.material[0] : b.material) ?? null,
    height, crown, crownBase,
  };
}

/** Is a tree drawn with the baked model? Rounded crowns only (the model is a broadleaf tree). */
export const usesTreeModel = (shape: CrownShape): boolean => shape === "rounded";

/**
 * Pure: the instance matrix of the model for a site tree standing at `pos` (house frame) on the ground at `z0`: scaled to the
 * tree's height (vertical) and crown (horizontal), turned by `yaw` about the vertical (scene frame).
 */
export function treeInstanceMatrix(model: Pick<TreeModel, "height" | "crown">, tree: { pos: readonly [number, number]; height: number; crown: number }, z0: number, yaw: number): THREE.Matrix4 {
  const sx = tree.crown / Math.max(1e-6, model.crown), sy = tree.height / Math.max(1e-6, model.height);
  return new THREE.Matrix4().compose(
    new THREE.Vector3(tree.pos[0], z0, -tree.pos[1]),
    new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw),
    new THREE.Vector3(sx, sy, sx),
  );
}

/** The mean colour of the opaque texels of a texture image (linear), or null when it cannot be read (no DOM, tainted). */
function meanTexel(tex: THREE.Texture | null): THREE.Color | null {
  const img = tex?.image as CanvasImageSource & { width?: number; height?: number } | undefined;
  if (!img || typeof document === "undefined") return null;
  try {
    const c = document.createElement("canvas");
    c.width = c.height = 16;
    const g = c.getContext("2d", { willReadFrequently: true });
    if (!g) return null;
    g.drawImage(img, 0, 0, 16, 16);
    const px = g.getImageData(0, 0, 16, 16).data;
    let r = 0, gg = 0, b = 0, n = 0;
    for (let i = 0; i < px.length; i += 4) if (px[i + 3] > 128) { r += px[i]; gg += px[i + 1]; b += px[i + 2]; n++; }
    if (!n) return null;
    return new THREE.Color().setRGB(r / n / 255, gg / n / 255, b / n / 255, THREE.SRGBColorSpace);
  } catch {
    return null;
  }
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
  /** Blobs (ellipsoids) per crown shape; a rounded crown gets `blobsPerCrownMetre` more per metre of crown diameter. */
  blobsRounded: 7,
  blobsPerCrownMetre: 1.2,
  blobsStacked: 4,
  /** Leaf cards per blob at full density, and their size as a share of the blob radius. */
  cardsPerBlob: 26,
  cardSize: 0.42,
  /** How far the normals of the foliage lean towards the direction from the crown's centre (0 = per blob, 1 = one smooth crown). */
  crownNormal: 0.6,
  /** Shading inside the crown: the darkest share at the bottom and at the core. */
  crownShadeBottom: 0.55,
  crownShadeCore: 0.62,
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
  /** Saturation and brightness of the foliage against its style colour (the crowns read darker than the lawn from above). */
  foliageSaturation: 1.3,
  foliageCanopy: 0.82,
} as const;

/** The perennial clumps of a planted (mulch) bed: clumps per square metre, their width and height range (m), the clear edge. */
export const BED_PLANTING = { kinds: ["mulch"], perM2: 2.6, width: [0.28, 0.6], height: [0.22, 0.45], edge: 0.05, jitter: 0.4, winterShare: 0.35 } as const;

/** One perennial clump of a bed: plan position (house frame), width and height. */
export interface BedPlant { pos: XY; width: number; height: number }

/**
 * Pure: the perennial clumps of the planted beds. A jittered grid of about `1 / sqrt(perM2)` pitch, centred in each bed of a
 * planted kind (so a narrow bed gets a row down its middle); every clump wholly inside its bed (a clump near the edge is made
 * smaller, down to the least width, to keep `edge` from the outline) and outside the crowns of the site's shrubs.
 * Deterministic for a seed (each bed seeded by its position).
 */
export function bedPlantings(beds: readonly { kind: string; polygon: readonly XY[] }[], shrubs: readonly { pos: readonly [number, number]; width: number }[], seed = 1, spec = BED_PLANTING): BedPlant[] {
  const out: BedPlant[] = [];
  const pitch = 1 / Math.sqrt(spec.perM2);
  for (const bed of beds) {
    if (!(spec.kinds as readonly string[]).includes(bed.kind) || polygonArea(bed.polygon) <= 0) continue;
    const poly = bed.polygon as XY[];
    const xs = poly.map((q) => q[0]), ys = poly.map((q) => q[1]);
    const x0 = Math.min(...xs), y0 = Math.min(...ys), w = Math.max(...xs) - x0, h = Math.max(...ys) - y0;
    const nx = Math.max(1, Math.round(w / pitch)), ny = Math.max(1, Math.round(h / pitch));
    const px = w / nx, py = h / ny;
    const rand = rng(seedAt(seed, xs[0], ys[0]));
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        const want = spec.width[0] + (spec.width[1] - spec.width[0]) * rand();
        const height = spec.height[0] + (spec.height[1] - spec.height[0]) * rand();
        const pos: XY = [x0 + (i + 0.5 + (rand() - 0.5) * spec.jitter) * px, y0 + (j + 0.5 + (rand() - 0.5) * spec.jitter) * py];
        if (!pointInPolygon(pos, poly)) continue;
        const width = Math.min(want, 2 * (distToBoundary(pos, poly) - spec.edge));
        if (width < spec.width[0]) continue;
        if (shrubs.some((sh) => Math.hypot(sh.pos[0] - pos[0], sh.pos[1] - pos[1]) < (sh.width + width) / 2)) continue;
        out.push({ pos, width, height: Math.min(height, Math.max(spec.height[0], width)) });
      }
    }
  }
  return out;
}

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
    // a broad dome: a flattened heart, and blobs spread over the upper shell of the crown (more of them for a large crown)
    const n = Math.round(PLANT.blobsRounded + PLANT.blobsPerCrownMetre * Math.max(0, crown - 4));
    for (let i = 0; i < n; i++) {
      const heart = i === 0;
      const r = R * (heart ? 0.7 : 0.34 + 0.16 * rand());
      const rz = Math.min(r * (heart ? 0.72 : 0.8), ch / 2);
      // around the crown at an even spread of angles, the outer ring lower, the inner ring higher (a dome)
      const a = (i / Math.max(1, n - 1)) * Math.PI * 2 * 2.618 + rand() * 0.6;
      const outer = i % 3 !== 0;
      const reach = heart ? 0 : (outer ? 0.72 + 0.28 * rand() : 0.25 + 0.3 * rand()) * (R - r);
      const zMid = z0 + base + ch / 2;
      const span = ch / 2 - rz;
      // the outer ring hangs low (a broad tree's lower branches reach out near the crown base), the inner ring sits high
      const dz = heart ? -0.2 * span : (outer ? (rand() * 1.0 - 0.95) : (0.1 + 0.9 * rand())) * span;
      blobs.push({ centre: [x + Math.cos(a) * reach, y + Math.sin(a) * reach, zMid + Math.max(-span, Math.min(span, dz))], radii: [r, r, rz] });
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

/** A unit ellipsoid with a little irregularity and smooth normals: the building block of crowns and shrubs. */
function blobGeometry(): THREE.BufferGeometry {
  const g = mergeVertices(new THREE.IcosahedronGeometry(1, 2).deleteAttribute("normal").deleteAttribute("uv"), 1e-4);
  const pos = g.attributes.position as THREE.BufferAttribute;
  const rand = rng(11);
  // a shared vertex gets one displacement, so the surface stays closed
  for (let i = 0; i < pos.count; i++) {
    const j = 0.9 + 0.18 * rand();
    pos.setXYZ(i, pos.getX(i) * j, pos.getY(i) * j, pos.getZ(i) * j);
  }
  g.computeVertexNormals();
  return g;
}

/**
 * The crown shading patch of foliage materials: the per-instance attribute `aCrown` (crown centre in the scene frame, crown
 * radius) bends the normals towards the direction from the crown centre and darkens the inside and the bottom of the crown.
 */
function patchCrown(m: THREE.MeshStandardMaterial, key: string): void {
  const prev = m.onBeforeCompile;
  m.onBeforeCompile = (sh, r) => {
    prev.call(m, sh, r);
    sh.vertexShader = sh.vertexShader
      .replace("#include <common>", `#include <common>
        attribute vec4 aCrown;
        varying float vCrownShade;`)
      .replace("#include <defaultnormal_vertex>", `#include <defaultnormal_vertex>
        {
          vec4 crownW = modelMatrix * instanceMatrix * vec4( position, 1.0 );
          vec3 crownD = crownW.xyz - aCrown.xyz;
          float crownR = max( aCrown.w, 1e-3 );
          vec3 crownN = normalize( crownD + vec3( 0.0, 1e-4, 0.0 ) );
          transformedNormal = normalize( mix( transformedNormal, ( viewMatrix * vec4( crownN, 0.0 ) ).xyz, ${PLANT.crownNormal.toFixed(2)} ) );
          float crownH = crownD.y / crownR, crownQ = length( crownD ) / crownR;
          vCrownShade = mix( ${PLANT.crownShadeBottom.toFixed(2)}, 1.0, smoothstep( -0.95, 0.6, crownH ) ) * mix( ${PLANT.crownShadeCore.toFixed(2)}, 1.0, smoothstep( 0.3, 0.92, crownQ ) );
        }`);
    sh.fragmentShader = sh.fragmentShader
      .replace("#include <common>", `#include <common>
        varying float vCrownShade;`)
      .replace("#include <color_fragment>", `#include <color_fragment>
        diffuseColor.rgb *= vCrownShade;
        // leaves are a darker, more saturated green than their paint colour reads under AgX (a canopy shades itself)
        float crownY = dot( diffuseColor.rgb, vec3( 0.2126, 0.7152, 0.0722 ) );
        diffuseColor.rgb = max( vec3( 0.0 ), mix( vec3( crownY ), diffuseColor.rgb, ${PLANT.foliageSaturation.toFixed(2)} ) ) * ${PLANT.foliageCanopy.toFixed(2)};`);
  };
  const prevKey = m.customProgramCacheKey();
  m.customProgramCacheKey = () => `${prevKey}|crown-${key}-v2`;
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
  // the baked tree (high tier, when the manifest has it); any failure falls back to the procedural trees
  let model: TreeModel | null = null;
  let modelScene: THREE.Object3D | null = null;
  if ((opts.treeModel ?? (!low && TREE_MODEL_FILE in MODEL_MANIFEST.files)) && !opts.signal?.aborted) {
    try {
      const gltf = await loadGltf(TREE_MODEL_FILE, { tier: opts.tier, signal: opts.signal });
      modelScene = gltf.scene;
      model = treeModelOf(gltf.scene);
    } catch (e) {
      if (!opts.signal?.aborted) console.warn("tree model could not be loaded; procedural trees instead", e);
    }
  }
  const ground = site.terrain.groundAt;
  const species = site.model.species;

  // ---- plan the instances first (pure), then fill the instanced meshes
  interface Want { kind: "blob" | "card" | "bark" | "hedge"; matrix: THREE.Matrix4; color: THREE.Color; seasonal: boolean; winterShare: number; position: THREE.Vector3; quaternion: THREE.Quaternion; scale: THREE.Vector3; crown: THREE.Vector4 }
  const wants: Want[] = [];
  const tmp = new THREE.Object3D();
  const up = new THREE.Vector3(0, 1, 0);
  /** The crown the next foliage belongs to: centre (scene frame) and radius, for the crown shading. */
  let crown = new THREE.Vector4(0, 0, 0, 1);
  const add = (kind: Want["kind"], pos: THREE.Vector3, quat: THREE.Quaternion, scale: THREE.Vector3, color: THREE.Color, seasonal: boolean, winterShare = 0) => {
    tmp.position.copy(pos); tmp.quaternion.copy(quat); tmp.scale.copy(scale); tmp.updateMatrix();
    wants.push({ kind, matrix: tmp.matrix.clone(), color, seasonal, winterShare, position: pos.clone(), quaternion: quat.clone(), scale: scale.clone(), crown: crown.clone() });
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
  /** Trees drawn with the baked model: instance matrix, leaf tint, crown centre and radius (scene frame), seasonal. */
  const modelled: { matrix: THREE.Matrix4; tint: THREE.Color; crown: THREE.Vector4; seasonal: boolean; localCentre: THREE.Vector3 }[] = [];
  for (const t of site.model.trees) {
    const sp = species[t.species];
    const evergreen = sp?.evergreen ?? false;
    const rand = rng(seedAt(seed, t.pos[0], t.pos[1]));
    const z0 = ground(t.pos[0], t.pos[1]);
    const crownBase = t.crownBase ?? 0.3 * t.height;
    const shape = crownShape(evergreen, t.height, t.crown);
    if (model && usesTreeModel(shape)) {
      const yaw = rand() * Math.PI * 2;
      modelled.push({
        matrix: treeInstanceMatrix(model, t, z0, yaw),
        tint: vary(treeColor, rand, evergreen),
        crown: new THREE.Vector4(t.pos[0], z0 + crownBase + (t.height - crownBase) / 2, -t.pos[1], Math.max(t.crown / 2, (t.height - crownBase) / 2)),
        seasonal: !evergreen,
        localCentre: new THREE.Vector3(0, (model.crownBase + model.height) / 2, 0),
      });
      trees++;
      continue;
    }
    const blobs = treeBlobs(shape, t.pos[0], t.pos[1], z0, t.height, t.crown, crownBase, rand);
    const color = vary(treeColor, rand, evergreen);
    const trunkTop = sceneOf([t.pos[0], t.pos[1], z0 + Math.max(crownBase, t.height * 0.45)]);
    const foot = sceneOf([t.pos[0], t.pos[1], z0 - 0.1]);
    const r = Math.max(PLANT.trunkRadiusMin, PLANT.trunkRadiusPerHeight * t.height);
    addBark(foot, trunkTop, r);
    crown = new THREE.Vector4(t.pos[0], z0 + crownBase + (t.height - crownBase) / 2, -t.pos[1], Math.max(t.crown / 2, (t.height - crownBase) / 2));
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
      crown = new THREE.Vector4(sh.pos[0], z0 + sh.height / 2, -sh.pos[1], Math.max(sh.width / 2, sh.height / 2));
      addBlob(blob, rand, color, !evergreen, 0);
      addCards(blob, rand, color, !evergreen, 0);
    }
    shrubs++;
  }
  // the planted beds: low perennial clumps, a little lighter and more varied than the shrubs, dying back in winter
  for (const pl of bedPlantings(site.model.beds, site.model.shrubs, seed)) {
    const rand = rng(seedAt(seed + 7, pl.pos[0], pl.pos[1]));
    const z0 = ground(pl.pos[0], pl.pos[1]);
    const color = vary(shrubColor, rand, false).offsetHSL((rand() - 0.5) * PLANT.hue * 2, 0, PLANT.lightness * 0.5);
    const w = pl.width / 2;
    const blob: Blob = { centre: [pl.pos[0], pl.pos[1], z0 + pl.height * 0.4], radii: [w, w * (0.85 + 0.3 * rand()), pl.height * 0.6] };
    crown = new THREE.Vector4(pl.pos[0], z0 + pl.height / 2, -pl.pos[1], Math.max(w, pl.height / 2));
    addBlob(blob, rand, color, true, BED_PLANTING.winterShare);
    addCards(blob, rand, color, true, BED_PLANTING.winterShare);
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
  const foliage = new THREE.MeshStandardMaterial({ roughness: 0.92, metalness: 0 });
  patchCrown(foliage, "blob");
  const hedgeMaterial = new THREE.MeshStandardMaterial({ roughness: 0.92, metalness: 0 });
  const cardMaterial = foliageCardMaterial(cardTexture, settings.msaa);
  patchCrown(cardMaterial, "card");
  const bark = new THREE.MeshStandardMaterial({ roughness: 0.95, metalness: 0 });
  const setup: Record<Want["kind"], [string, THREE.BufferGeometry, THREE.Material, boolean]> = {
    blob: ["foliage_blobs", blobGeo, foliage, true],
    card: ["foliage_cards", cardGeo, cardMaterial, !low],
    bark: ["bark", barkGeo, bark, true],
    hedge: ["hedges", hedgeGeo, hedgeMaterial, true],
  };
  const crowned = new Set<Want["kind"]>(["blob", "card"]);
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
    if (crowned.has(kind)) {
      const data = new Float32Array(list.length * 4);
      list.forEach((w, i) => { data[i * 4] = w.crown.x; data[i * 4 + 1] = w.crown.y; data[i * 4 + 2] = w.crown.z; data[i * 4 + 3] = w.crown.w; });
      geo.setAttribute("aCrown", new THREE.InstancedBufferAttribute(data, 4));
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    meshes.push(mesh);
    group.add(mesh);
  }

  // ---- the baked trees: one instanced mesh for the bark, one for the leaves
  const modelOwned: { geometries: THREE.BufferGeometry[]; materials: THREE.Material[] } = { geometries: [], materials: [] };
  let modelLeaves: THREE.InstancedMesh | null = null;
  if (model && modelled.length) {
    const barkInst = new THREE.InstancedMesh(model.bark, bark, modelled.length);
    barkInst.name = "tree_model_bark";
    const leafMat = foliageCardMaterial(model.leafMap ?? cardTexture, false);
    patchCrown(leafMat, "tree-model");
    const leavesInst = new THREE.InstancedMesh(model.leaves, leafMat, modelled.length);
    leavesInst.name = "tree_model_leaves";
    // the leaf texture is tinted to the style's foliage: the instance colour divides out the texture's own mean colour
    const mean = meanTexel(model.leafMap);
    const crowns = new Float32Array(modelled.length * 4);
    modelled.forEach((t, i) => {
      barkInst.setMatrixAt(i, t.matrix);
      barkInst.setColorAt(i, barkColor);
      leavesInst.setMatrixAt(i, t.matrix);
      const tint = t.tint.clone();
      if (mean) tint.setRGB(Math.min(3, tint.r / Math.max(0.02, mean.r)), Math.min(3, tint.g / Math.max(0.02, mean.g)), Math.min(3, tint.b / Math.max(0.02, mean.b)));
      leavesInst.setColorAt(i, tint);
      crowns.set([t.crown.x, t.crown.y, t.crown.z, t.crown.w], i * 4);
    });
    model.leaves.setAttribute("aCrown", new THREE.InstancedBufferAttribute(crowns, 4));
    for (const m of [barkInst, leavesInst]) {
      m.castShadow = true;
      m.receiveShadow = true;
      m.frustumCulled = false;
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
      meshes.push(m);
      group.add(m);
    }
    modelLeaves = leavesInst;
    modelOwned.geometries.push(model.bark, model.leaves);
    modelOwned.materials.push(leafMat);
  }

  const m4 = new THREE.Matrix4(), s3 = new THREE.Vector3(), c4 = new THREE.Matrix4();
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
    if (modelLeaves) {
      // the leaves of a bare tree shrink towards the middle of the crown (in the model's own frame)
      modelled.forEach((t, i) => {
        const k = t.seasonal ? Math.max(f, 1e-4) : 1;
        c4.makeTranslation(t.localCentre.x, t.localCentre.y, t.localCentre.z).multiply(m4.makeScale(k, k, k)).multiply(new THREE.Matrix4().makeTranslation(-t.localCentre.x, -t.localCentre.y, -t.localCentre.z));
        modelLeaves!.setMatrixAt(i, t.matrix.clone().multiply(c4));
      });
      modelLeaves.instanceMatrix.needsUpdate = true;
    }
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
      for (const g of modelOwned.geometries) g.dispose();
      for (const m of modelOwned.materials) m.dispose();
      if (modelScene) disposeTree(modelScene);
      for (const m of meshes) m.dispose();
      // kinds without instances never got a mesh: free their geometry and material too
      for (const g of [blobGeo, cardGeo, barkGeo, hedgeGeo]) g.dispose();
      for (const m of [foliage, hedgeMaterial, cardMaterial, bark]) m.dispose();
      pieces.length = 0;
    },
  };
}
