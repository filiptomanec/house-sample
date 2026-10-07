// Room tags: HTML labels (CSS2D) at the label point of each room, 1.1 m above the floor. The text comes from the page
// (`formatTag`), so the engine owns no user-visible string. Tags are ordered by room area; whenever the camera moves, a
// tag is shown only if it does not overlap a tag that is already shown, so the big rooms win and the view stays readable.
import * as THREE from "three";
import { CSS2DObject } from "three/addons/renderers/CSS2DRenderer.js";
import type { DerivedRoom } from "@/lib/model";
import type { HouseContext } from "./context";
import type { RoomTag } from "./house";
import type { Viewer } from "./viewer";

/** Height of the tags above the floor, metres. */
export const TAG_HEIGHT = 1.1;
/** Size assumed for a tag that has not been on screen yet, px, and the gap kept between two tags, px. */
const TAG_DEFAULT = { width: 72, height: 34, gap: 3 } as const;

export interface RoomTags {
  readonly group: THREE.Group;
  setVisible(on: boolean): void;
  relabel(formatTag: (room: DerivedRoom) => RoomTag): void;
  dispose(): void;
}

function tagElement(tag: RoomTag): HTMLDivElement {
  const el = document.createElement("div");
  el.className = "room-tag";
  const b = document.createElement("b");
  b.textContent = tag.title;
  const span = document.createElement("span");
  span.textContent = tag.detail;
  el.append(b, span);
  return el;
}

function setTagText(el: HTMLElement, tag: RoomTag): void {
  const b = el.querySelector("b"), span = el.querySelector("span");
  if (b) b.textContent = tag.title;
  if (span) span.textContent = tag.detail;
}

/** The rooms in tag order: largest first, so they win when two tags would overlap. */
export const tagOrder = (rooms: readonly DerivedRoom[]): DerivedRoom[] => [...rooms].sort((a, b) => b.area - a.area);

export function createRoomTags(viewer: Viewer, ctx: HouseContext, formatTag: ((room: DerivedRoom) => RoomTag) | undefined, visible: boolean): RoomTags {
  const group = new THREE.Group();
  group.name = "labels";
  group.visible = visible;
  const tags: { room: DerivedRoom; object: CSS2DObject; w: number; h: number }[] = [];
  if (viewer.labels && formatTag) {
    for (const room of tagOrder(ctx.derived.rooms)) {
      const object = new CSS2DObject(tagElement(formatTag(room)));
      // house frame (x, y) -> scene (x, height, -y)
      object.position.set(room.label.x, TAG_HEIGHT, -room.label.y);
      object.element.style.display = visible ? "" : "none";
      group.add(object);
      tags.push({ room, object, w: 0, h: 0 });
    }
  }

  const lastView = new THREE.Matrix4(), lastProj = new THREE.Matrix4(), p = new THREE.Vector3();
  let lastW = 0, lastH = 0, ran = false;
  const off = viewer.labels
    ? viewer.onFrame(() => {
        if (!group.visible || !viewer.labels) { ran = false; return false; }
        const cam = viewer.camera;
        cam.updateMatrixWorld();
        const { width: W, height: H } = viewer.labels.getSize();
        const unmeasured = tags.some((t) => t.object.visible && !t.w && t.object.element.offsetWidth);
        if (ran && !unmeasured && W === lastW && H === lastH && cam.matrixWorld.equals(lastView) && cam.projectionMatrix.equals(lastProj)) return false;
        ran = true; lastW = W; lastH = H;
        lastView.copy(cam.matrixWorld);
        lastProj.copy(cam.projectionMatrix);
        group.updateMatrixWorld(true);
        const placed: [number, number, number, number][] = [];
        let changed = false;
        for (const t of tags) {
          const el = t.object.element;
          if (!t.w && el.offsetWidth) { t.w = el.offsetWidth; t.h = el.offsetHeight; }
          const hw = (t.w || TAG_DEFAULT.width) / 2 + TAG_DEFAULT.gap, hh = (t.h || TAG_DEFAULT.height) / 2 + TAG_DEFAULT.gap;
          p.setFromMatrixPosition(t.object.matrixWorld).project(cam);
          const x = (p.x * 0.5 + 0.5) * W, y = (0.5 - p.y * 0.5) * H;
          const r: [number, number, number, number] = [x - hw, y - hh, x + hw, y + hh];
          const show = p.z >= -1 && p.z <= 1 && !placed.some((q) => r[0] < q[2] && q[0] < r[2] && r[1] < q[3] && q[1] < r[3]);
          if (show) placed.push(r);
          if (t.object.visible !== show) { t.object.visible = show; changed = true; }
        }
        return changed;
      })
    : () => undefined;

  return {
    group,
    setVisible(on) {
      group.visible = on;
      for (const t of tags) t.object.element.style.display = on ? "" : "none";
      ran = false;
      viewer.requestRender({ shadows: false });
    },
    relabel(format) {
      for (const t of tags) { setTagText(t.object.element, format(t.room)); t.w = 0; t.h = 0; }
      ran = false;
      viewer.requestRender({ shadows: false });
    },
    dispose() {
      off();
      group.removeFromParent();
      group.clear();
      for (const t of tags) t.object.element.remove();
      tags.length = 0;
    },
  };
}
