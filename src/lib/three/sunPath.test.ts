// The in-scene sun path: its samples are the sun of calc/sun for the day, its points lie on the arc in the direction of the
// light, the disc sits on the arc at the current minute (hidden at night), the travelled part is marked, and it cleans up.
import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { localToUtc, placeOf, sunPosition, sunTimes, type CalendarDate } from "@/lib/calc/sun";
import { getHouseContext } from "./context";
import { sunDirectionScene } from "./frame";
import { SUN_PATH, addSunPath, arcPoint, nearestOnScreen, sampleAt, sunPathSamples } from "./sunPath";
import type { SunPositionFn } from "./sunAnalysis";
import type { Viewer } from "./viewer";
import { sceneExtent } from "./context";

const ctx = getHouseContext();
const place = placeOf(ctx.house);
const sunAt: SunPositionFn = (date, minute) => sunPosition(localToUtc(place.tz, date, minute / 60), place);
const JUNE: CalendarDate = { year: 2026, month: 5, day: 21 };
const DEC: CalendarDate = { year: 2026, month: 11, day: 21 };

function fakeViewer() {
  const scene = new THREE.Scene();
  const container = new EventTarget() as unknown as HTMLElement;
  const camera = new THREE.PerspectiveCamera(40, 1.5, 0.1, 2000);
  camera.position.set(-20, 40, 30);
  camera.lookAt(10, 0, -5);
  let renders = 0;
  const viewer = {
    scene, container, camera, extent: sceneExtent(ctx, "house"), labels: null, bearingDeg: ctx.bearingDeg,
    controls: { enabled: true }, renderer: { domElement: container },
    requestRender: () => { renders++; },
  } as unknown as Viewer;
  return { viewer, scene, renders: () => renders };
}

describe("sunPathSamples", () => {
  for (const date of [JUNE, DEC]) {
    it(`samples the sun above the horizon every ${SUN_PATH.step} minutes on ${date.month + 1}/${date.day}, ends at sunrise and sunset`, () => {
      const s = sunPathSamples(date, sunAt);
      expect(s.length).toBeGreaterThan(20);
      for (let i = 1; i < s.length; i++) expect(s[i].minute).toBeGreaterThan(s[i - 1].minute);
      for (const x of s.slice(1, -1)) {
        expect(x.altitude).toBeGreaterThan(0);
        const p = sunAt(date, x.minute);
        expect(x.azimuth).toBeCloseTo(p.azimuth, 9);
        expect(x.hour).toBe(x.minute % 60 === 0);
      }
      // the ends are where the sun crosses the horizon (calc/sun's sunrise and sunset use the apparent disc: within a few minutes)
      const t = sunTimes(place, date);
      expect(Math.abs(s[0].minute / 60 - t.sunrise!)).toBeLessThan(0.1);
      expect(Math.abs(s[s.length - 1].minute / 60 - t.sunset!)).toBeLessThan(0.1);
      expect(Math.abs(s[0].altitude)).toBeLessThan(0.05);
      expect(s.length).toBeLessThanOrEqual(SUN_PATH.maxSamples);
    });
  }

  it("is empty when the sun never rises, and rejects a step that is not positive", () => {
    expect(sunPathSamples(JUNE, () => ({ azimuth: 0, altitude: -10 }))).toEqual([]);
    expect(() => sunPathSamples(JUNE, sunAt, 0)).toThrow(RangeError);
  });
});

describe("arcPoint", () => {
  it("lies at the radius from the centre, in the direction of the light", () => {
    const c: [number, number, number] = [10, 0, -5];
    for (const [az, alt] of [[90, 10], [180, 64], [270, 3]]) {
      const p = arcPoint(c, 16, az, alt, ctx.bearingDeg);
      const d = sunDirectionScene(az, alt, ctx.bearingDeg);
      expect(Math.hypot(p[0] - c[0], p[1] - c[1], p[2] - c[2])).toBeCloseTo(16, 9);
      [0, 1, 2].forEach((k) => expect((p[k] - c[k]) / 16).toBeCloseTo(d[k], 9));
    }
  });
});

describe("helpers", () => {
  it("finds the nearest sample in time and the nearest point on screen", () => {
    const s = sunPathSamples(JUNE, sunAt);
    expect(sampleAt(s, 13 * 60 + 2)!.minute).toBe(13 * 60);
    expect(sampleAt([], 100)).toBeNull();
    expect(nearestOnScreen([[0, 0], [10, 10], [5, 1]], [6, 2])).toBe(2);
    expect(nearestOnScreen([], [0, 0])).toBe(-1);
  });
});

describe("addSunPath", () => {
  const centreOf = (v: Viewer) => new THREE.Vector3(v.extent.center[0], v.extent.center[2], -v.extent.center[1]);

  it("draws a dot per sample, the disc on the arc at the minute, the travelled part marked", () => {
    const { viewer, scene } = fakeViewer();
    const path = addSunPath(viewer, { ctx, date: JUNE, minute: 13 * 60 });
    expect(scene.children).toContain(path.group);
    const dots = path.group.getObjectByName("sun_path_dots") as THREE.InstancedMesh;
    const disc = path.group.getObjectByName("sun_path_disc") as THREE.Mesh;
    expect(dots.count).toBe(path.samples.length);
    expect(disc.visible).toBe(true);
    const r = viewer.extent.radius * SUN_PATH.radiusShare;
    expect(disc.position.distanceTo(centreOf(viewer))).toBeCloseTo(r, 6);
    const p = sunAt(JUNE, 13 * 60);
    const d = sunDirectionScene(p.azimuth, p.altitude, ctx.bearingDeg);
    const dir = disc.position.clone().sub(centreOf(viewer)).normalize();
    expect(dir.x).toBeCloseTo(d[0], 6); expect(dir.y).toBeCloseTo(d[1], 6); expect(dir.z).toBeCloseTo(d[2], 6);
    // travelled dots differ in colour from the rest
    const c = new THREE.Color(), first = new THREE.Color(), last = new THREE.Color();
    dots.getColorAt(0, first); dots.getColorAt(path.samples.length - 1, last);
    expect(first.equals(last)).toBe(false);
    path.samples.forEach((sm, i) => { dots.getColorAt(i, c); expect(c.equals(sm.minute <= 13 * 60 ? first : last)).toBe(true); });
    // every dot is on the arc
    const m = new THREE.Matrix4(), q = new THREE.Vector3();
    for (let i = 0; i < dots.count; i++) { dots.getMatrixAt(i, m); q.setFromMatrixPosition(m); expect(q.distanceTo(centreOf(viewer))).toBeCloseTo(r, 4); }
    path.dispose();
  });

  it("hides the disc while the sun is down and follows a new day", () => {
    const { viewer } = fakeViewer();
    const path = addSunPath(viewer, { ctx, date: JUNE, minute: 12 * 60 });
    const disc = path.group.getObjectByName("sun_path_disc") as THREE.Mesh;
    path.setMinute(60);
    expect(disc.visible).toBe(false);
    path.setMinute(12 * 60);
    expect(disc.visible).toBe(true);
    const june = path.samples.length;
    path.setDay(DEC);
    expect(path.samples.length).toBeLessThan(june);
    expect(path.minute).toBe(12 * 60);
    path.dispose();
  });

  it("registers and removes drag listeners, hides on request and leaves the scene on dispose", () => {
    const { viewer, scene } = fakeViewer();
    const path = addSunPath(viewer, { ctx, date: JUNE, minute: 600 });
    const off = path.onDrag(() => undefined);
    off();
    path.setVisible(false);
    expect(path.group.visible).toBe(false);
    path.dispose();
    expect(scene.children).not.toContain(path.group);
  });
});
