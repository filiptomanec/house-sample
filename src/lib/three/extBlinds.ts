// Exterior venetian blinds on the glazed openings that the shading rule gives a blind (`derived.openings[].blind`, rule in
// `house.shading.blinds`, docs/HOUSE-FORMAT.md section 4.4). Aluminium slats in guide rails; raised, the slats disappear into
// the head box (`boxHeight` high) above the opening and only the box and the rails stay visible.
//
//  * The product (slat width, pitch and thickness, rails, box, reveal, widest section) is the one blind of the model,
//    `house.shading.blinds.product` (`blindProduct(ctx)`), read by the renders too; `EXT_BLIND_SPEC` holds only drawing details
//    and the defaults of a model without a product.
//  * Sections: one per opening, split into equal parts when wider than the product's `maxSectionWidth`. Position and
//    direction come from the opening (`wallId`, `orient`, `cx`/`cy`, `w`, `sill`, `head`, `azimuth`) and the thickness of its
//    wall (`derived.walls`), nothing is typed in per opening. A section is *located* on the outer face of the wall
//    (`origin`); the curtain, the rails and the head box are drawn in the reveal, `EXT_BLIND_SPEC.reveal` behind that face,
//    so the blind never stands in front of the facade at any tilt (invariant in extBlinds.test.ts). The head box sits in the wall
//    above the opening and is not visible; with the blind raised only the guide rails show.
//  * `setDrop(0..1)`: 0 raised, 1 lowered over the whole opening. `setTilt(0..90)`: slat angle, 0 horizontal (open), 90 closed;
//    the outer edge goes down when tilting.
//  * Slats are one InstancedMesh. Farther than the LOD distance (`lodDistanceFactor` times the building diagonal from its
//    centre) the 3.5 mm slats would alias into streaks, so a flat curtain with the slat pattern painted into an alpha map
//    takes over (its mip levels average the stripes into an even tone).
//  * Occluders (for the sun analysis): the slats and the packs while lowered, none while raised.
import * as THREE from "three";
import { disposeTree } from "./dispose";
import type { HouseContext } from "./context";
import type { HouseScene } from "./house";
import { outwardNormalHouse } from "./frame";
import { generatedMaterial } from "./style";
import type { Viewer } from "./viewer";

/** Defaults of the blind product (a model without `shading.blinds.product`) and drawing details, metres. */
export const EXT_BLIND_SPEC = {
  slatPitch: 0.072,
  slatWidth: 0.08,
  slatThickness: 0.0035,
  /** Widest single blind; a wider opening gets several of equal width. */
  maxSectionWidth: 2.4,
  railWidth: 0.024,
  railDepth: 0.03,
  /** Depth of the head box. */
  boxDepth: 0.09,
  /**
   * Depth of the middle of the curtain behind the outer face of the wall. A slat (0.08 wide) reaches a little over 0.04 to
   * either side at its worst tilt, so with 0.051 it stays at least 1 cm behind the facade and, for the glazing frame set back
   * 0.1 m by the pipeline (`setback` in pipeline/blender/hb/params.py), 5 mm in front of it: the test reads that file.
   */
  reveal: 0.051,
  /** Switch distance to the painted curtain, as a multiple of the building diagonal. */
  lodDistanceFactor: 0.6,
  /** Stripes of the painted curtain (the pattern is fixed, not tied to the length). */
  curtainStripes: 35,
} as const;

/** The blind product of the model (`house.shading.blinds.product`), with the defaults for fields it does not give. */
export type BlindProduct = { -readonly [K in keyof typeof EXT_BLIND_SPEC]: number };
export function blindProduct(ctx: Pick<HouseContext, "house">): BlindProduct {
  const product = (ctx.house.shading.blinds as { product?: Partial<BlindProduct> }).product ?? {};
  const out = { ...EXT_BLIND_SPEC } as BlindProduct;
  for (const k of Object.keys(out) as (keyof BlindProduct)[]) {
    const v = product[k];
    if (typeof v === "number" && Number.isFinite(v) && v > 0) out[k] = v;
  }
  return out;
}

export interface BlindSection {
  /** `derived.openings[].id` this section belongs to (a join key, never a condition). */
  opening: string;
  /** Start of the section on the outer face of the wall, house frame (x, y). */
  origin: readonly [number, number];
  /** Unit vector along the wall (plan) and the outward normal. */
  along: readonly [number, number];
  normal: readonly [number, number];
  width: number;
  sill: number;
  head: number;
  /** Height of the head box above `head` (`house.shading.blinds.boxHeight`). */
  boxHeight: number;
}

/**
 * Pure: the sections for all openings with `blind: true`. The sections of one opening tile its width exactly; each lies on
 * the outer face of its wall (outward offset from the wall axis equals half the wall thickness).
 */
export function blindSections(ctx: HouseContext): BlindSection[] {
  const { derived, house } = ctx;
  const spec = blindProduct(ctx);
  const out: BlindSection[] = [];
  for (const o of derived.openings) {
    if (!o.blind || o.azimuth === null) continue;
    const wall = derived.walls.find((w) => w.id === o.wallId);
    if (!wall) continue;
    const n = outwardNormalHouse(o.azimuth);
    // looking at the facade from outside, "along" runs to the right
    const along: [number, number] = [-n[1], n[0]];
    // the opening spans from..to along the wall axis (x for a horizontal wall, y for a vertical one); start where `along` starts
    const axisDir: [number, number] = o.orient === "h" ? [1, 0] : [0, 1];
    const forward = along[0] * axisDir[0] + along[1] * axisDir[1] > 0;
    const s0 = forward ? o.from : o.to;
    const base: [number, number] = o.orient === "h" ? [s0, o.axis] : [o.axis, s0];
    const face: [number, number] = [base[0] + n[0] * (wall.t / 2), base[1] + n[1] * (wall.t / 2)];
    const parts = Math.max(1, Math.ceil(o.w / spec.maxSectionWidth - 1e-9));
    const width = o.w / parts;
    for (let k = 0; k < parts; k++) {
      out.push({
        opening: o.id,
        origin: [face[0] + along[0] * width * k, face[1] + along[1] * width * k],
        along, normal: n, width, sill: o.sill, head: o.head, boxHeight: house.shading.blinds.boxHeight,
      });
    }
  }
  return out;
}

export interface ExtBlinds {
  readonly group: THREE.Group;
  readonly sections: readonly BlindSection[];
  readonly drop: number;
  readonly tilt: number;
  setDrop(p: number): void;
  setTilt(deg: number): void;
  /** Level of detail from the camera position (scene frame). Returns true when it switched, so the caller can redraw. */
  lod(cameraPosition: Readonly<THREE.Vector3>): boolean;
  occluders(): THREE.Object3D[];
  dispose(): void;
}

/** The centre of a slat and its extents in the reveal, for one section (scene frame). Pure, used by the layout and the tests. */
export function slatHeights(section: Pick<BlindSection, "sill" | "head">, drop: number, spec: Pick<BlindProduct, "slatPitch"> = EXT_BLIND_SPEC): number[] {
  const { slatPitch } = spec;
  const travel = Math.max(0, drop * (section.head - section.sill - 0.1));
  const zs: number[] = [];
  for (let z = section.head - 0.1 - slatPitch / 2; z >= section.head - 0.1 - travel; z -= slatPitch) zs.push(z);
  return zs;
}

/**
 * Builds the blinds and adds them to the scene (`house.adopt`). The viewer's frame loop calls `lod` by itself; the page only
 * sets drop and tilt. Starts raised and open (drop 0, tilt 0).
 */
export function buildExtBlinds(viewer: Viewer, house: HouseScene): ExtBlinds {
  const ctx = house.ctx;
  const spec = blindProduct(ctx);
  const sections = blindSections(ctx);
  const group = new THREE.Group();
  group.name = "ext_blinds";

  const mat = (role: string) => {
    const m = generatedMaterial(ctx.style, role, "frame");
    return new THREE.MeshStandardMaterial({ color: m.color, roughness: m.roughness, metalness: m.metallic, side: THREE.DoubleSide });
  };
  const slatMat = mat("blind_slat"), railMat = mat("blind_rail");
  const maxSlats = sections.reduce((n, s) => n + Math.ceil((s.head - s.sill) / spec.slatPitch) + 1, 0);
  const box = new THREE.BoxGeometry(1, 1, 1), quad = new THREE.PlaneGeometry(1, 1);
  const slats = new THREE.InstancedMesh(box, slatMat, Math.max(1, maxSlats));
  const packs = new THREE.InstancedMesh(box, slatMat, Math.max(1, sections.length));
  const rails = new THREE.InstancedMesh(box, railMat, Math.max(1, sections.length * 2));
  slats.name = "ext_blind_slats"; packs.name = "ext_blind_packs"; rails.name = "ext_blind_rails";
  for (const m of [slats, packs, rails]) { m.castShadow = true; m.receiveShadow = true; m.frustumCulled = false; group.add(m); }

  // Far away the 3.5 mm slats fall below a pixel and alias into torn streaks: a flat curtain with the slat pattern painted into
  // an alpha map takes over (its mip levels average the stripes into an even tone); near and inside the real slats are drawn.
  const stripeCanvas = document.createElement("canvas");
  const stripeTex = new THREE.CanvasTexture(stripeCanvas);
  stripeTex.wrapS = stripeTex.wrapT = THREE.RepeatWrapping;
  stripeTex.repeat.set(1, spec.curtainStripes);
  stripeTex.anisotropy = viewer.settings.anisotropy;
  const curtainMat = new THREE.MeshStandardMaterial({
    color: slatMat.color, roughness: Math.max(slatMat.roughness, 0.5), metalness: slatMat.metalness * 0.7,
    transparent: true, depthWrite: false, side: THREE.DoubleSide, alphaMap: stripeTex,
  });
  const curtains = new THREE.InstancedMesh(quad, curtainMat, Math.max(1, sections.length));
  curtains.name = "ext_blind_curtains";
  curtains.frustumCulled = false;
  curtains.visible = false;
  group.add(curtains);
  const paintStripes = (tiltRad: number) => {
    const H = 32;
    stripeCanvas.width = 4;
    stripeCanvas.height = H;
    const g = stripeCanvas.getContext("2d");
    if (!g) return;
    const cover = 0.35 + 0.65 * Math.sin(tiltRad); // share of the view the slats cover
    g.fillStyle = "#000";
    g.fillRect(0, 0, 4, H);
    g.fillStyle = "#fff";
    g.fillRect(0, 0, 4, Math.max(2, Math.round(H * cover)));
    stripeTex.needsUpdate = true;
  };

  // geometry of each section in the scene frame: house (x, y, z) -> scene (x, z, -y)
  const up = new THREE.Vector3(0, 1, 0);
  const geo = sections.map((s) => {
    const dir = new THREE.Vector3(s.along[0], 0, -s.along[1]);
    const out = new THREE.Vector3(s.normal[0], 0, -s.normal[1]);
    // the curtain plane: on the outer face, moved into the reveal; `start` is its left end (looking from outside)
    const start = new THREE.Vector3(s.origin[0], 0, -s.origin[1]).addScaledVector(out, -spec.reveal);
    return { dir, out, start, centre: start.clone().addScaledVector(dir, s.width / 2) };
  });

  const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), S = new THREE.Vector3(), P = new THREE.Vector3();
  const basis = (x: THREE.Vector3, y: THREE.Vector3, z: THREE.Vector3) => Q.setFromRotationMatrix(M.makeBasis(x, y, z));
  // guide rails: always there, in the reveal next to the frame
  sections.forEach((s, i) => {
    const g = geo[i];
    for (const k of [0, 1]) {
      P.copy(g.start).addScaledVector(g.dir, k ? s.width - spec.railWidth / 2 : spec.railWidth / 2);
      P.y = (s.sill + s.head) / 2;
      rails.setMatrixAt(i * 2 + k, M.compose(P, basis(g.dir, up, g.out), S.set(spec.railWidth, s.head - s.sill, spec.railDepth)));
    }
  });
  rails.instanceMatrix.needsUpdate = true;
  rails.computeBoundingSphere();

  let drop = 0, tilt = 0, far = false;
  const slatLayer = new THREE.Vector3();
  // the slat's normal turns from up towards out: the outer edge goes down as the slats close
  const slatBasis = (dir: THREE.Vector3, out: THREE.Vector3, t: number) => {
    slatLayer.copy(up).multiplyScalar(Math.cos(t)).addScaledVector(out, Math.sin(t));
    return basis(dir, slatLayer, new THREE.Vector3().crossVectors(dir, slatLayer).normalize());
  };
  function layout() {
    let n = 0;
    const t = (tilt * Math.PI) / 180;
    sections.forEach((s, i) => {
      const g = geo[i];
      const len = Math.max(0, drop * (s.head - s.sill - 0.1));
      const innerWidth = s.width - 2 * spec.railWidth - 0.01;
      // the slat pack under the head (visible only while lowered)
      P.copy(g.centre); P.y = s.head - 0.05;
      packs.setMatrixAt(i, M.compose(P, basis(g.dir, up, g.out), S.set(drop > 0.001 ? innerWidth : 1e-4, 0.1, spec.boxDepth)));
      // the far curtain covers the same lowered part, in the plane of the slats
      P.copy(g.centre); P.y = s.head - 0.1 - len / 2;
      curtains.setMatrixAt(i, M.compose(P, basis(g.dir, up, g.out), S.set(len > 0.01 ? innerWidth : 1e-4, Math.max(len, 1e-4), 1)));
      for (const z of slatHeights(s, drop, spec)) {
        if (n >= maxSlats) break;
        P.copy(g.centre); P.y = z;
        slats.setMatrixAt(n++, M.compose(P, slatBasis(g.dir, g.out, t), S.set(innerWidth, spec.slatThickness, spec.slatWidth)));
      }
    });
    slats.count = n;
    for (const m of [slats, packs, curtains]) m.instanceMatrix.needsUpdate = true;
    paintStripes(t);
    // moving instances: the bounding spheres must follow or the meshes vanish from view
    slats.computeBoundingSphere();
    group.updateMatrixWorld(true);
    curtains.visible = far && drop > 0.001;
    viewer.requestRender();
  }
  layout();
  house.adopt(group);

  const centre = new THREE.Vector3((ctx.derived.bbox.x0 + ctx.derived.bbox.x1) / 2, ctx.derived.bbox.z1 / 2, -(ctx.derived.bbox.y0 + ctx.derived.bbox.y1) / 2);
  const switchDistance = Math.hypot(ctx.derived.bbox.w, ctx.derived.bbox.d) * spec.lodDistanceFactor;
  const lod = (cam: Readonly<THREE.Vector3>): boolean => {
    const next = cam.distanceTo(centre) > switchDistance;
    if (next === far) return false;
    far = next;
    slats.visible = !far;
    curtains.visible = far && drop > 0.001;
    return true;
  };
  const offFrame = viewer.onFrame(() => lod(viewer.camera.position));

  return {
    group, sections,
    get drop() { return drop; },
    get tilt() { return tilt; },
    setDrop(p) { drop = Math.min(1, Math.max(0, p)); layout(); },
    setTilt(deg) { tilt = Math.min(90, Math.max(0, deg)); layout(); },
    lod,
    occluders() { return drop > 0.001 ? [slats, packs] : []; },
    dispose() {
      offFrame();
      disposeTree(group);
      stripeTex.dispose();
      box.dispose();
      quad.dispose();
    },
  };
}
