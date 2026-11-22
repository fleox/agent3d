// Camera + controls: none, orbit (OrbitControls, disabled in deterministic
// mode), parallax (pointer drift), scroll (interpolates `scrollPath` by scroll
// progress), follow (smoothed tracking of an object), autoRotate.

import * as THREE from "three";
import type { CameraDef } from "../../core/types";
import { noise2D } from "../random";
import { DEG, clamp, num, smoothFactor } from "../util";

export function createCamera(def: CameraDef, aspect: number): THREE.PerspectiveCamera | THREE.OrthographicCamera {
  const near = num(def.near, 0.1);
  const far = num(def.far, 1000);
  let cam: THREE.PerspectiveCamera | THREE.OrthographicCamera;
  if (def.type === "orthographic") {
    const h = num(def.zoom, 10) / 2;
    cam = new THREE.OrthographicCamera(-h * aspect, h * aspect, h, -h, near, far);
  } else cam = new THREE.PerspectiveCamera(num(def.fov, 45), aspect, near, far);
  cam.position.set(...def.position);
  const t = def.target ?? [0, 0, 0];
  nudgeOffPlanes(cam.position, new THREE.Vector3(t[0], t[1], t[2]));
  cam.lookAt(t[0], t[1], t[2]);
  return cam;
}

// Responsive framing: when the canvas is narrower than the scene's design
// aspect (target.aspect — e.g. a 4:1 banner given a taller box on a phone),
// widen the view so the authored horizontal framing stays visible instead of
// cropping the sides. Capped so a perspective camera never exceeds ~100°.
export function fitScale(aspect: number, designAspect?: number): number {
  if (!designAspect || !(aspect > 0) || aspect >= designAspect) return 1;
  return Math.min(designAspect / aspect, 3);
}

export function fittedFov(fov: number, scale: number): number {
  if (scale <= 1) return fov;
  return Math.min(100, (2 * Math.atan(Math.tan((fov * DEG) / 2) * scale)) / DEG);
}

export function setCameraAspect(cam: THREE.Camera, def: CameraDef, aspect: number, designAspect?: number): void {
  const scale = fitScale(aspect, designAspect);
  cam.userData.fitScale = scale;
  if (cam instanceof THREE.PerspectiveCamera) {
    cam.aspect = aspect;
    cam.fov = fittedFov(num(cam.userData.restFov, num(def.fov, 45)), scale);
    cam.updateProjectionMatrix();
  } else if (cam instanceof THREE.OrthographicCamera) {
    const h = ((cam.userData.zoomHeight ?? num(def.zoom, 10)) / 2) * scale;
    cam.left = -h * aspect;
    cam.right = h * aspect;
    cam.top = h;
    cam.bottom = -h;
    cam.updateProjectionMatrix();
  }
}

export interface CameraRig {
  // Rest values (timeline / scripts write here; the controller derives the final camera).
  // zoom: orthographic view height; focus: depth-of-field distance (postfx dof).
  rest: { position: THREE.Vector3; target: THREE.Vector3; fov: number; zoom: number; focus?: number };
  update(t: number, dt: number, input: { pointer: { x: number; y: number }; scroll: number; followTarget?: THREE.Object3D | null; lookAt?: THREE.Vector3 | null }): void;
  // Extra offset applied after the controller (camera shake).
  shake: THREE.Vector3;
  orbit: { enabled: boolean; dispose(): void; update(): void } | null;
  dispose(): void;
}

// A vertex lying exactly in the plane through the camera perpendicular to its
// view axis gets clip w = 0; some rasterizers (SwiftShader — headless renders —
// and a few mobile GPUs) then draw its triangles as screen-filling garbage
// (a box floor whose front face is at the camera's z: wrong material, objects
// cut as if inside a volume). Authored scenes hit it with round numbers (camera
// z = 10, floor edge z = 10), so the camera is moved 1e-4 units back along its
// view axis — invisible, and never an exact authored value.
export const CAMERA_PLANE_NUDGE = 1e-4;
export function nudgeOffPlanes(pos: THREE.Vector3, target: THREE.Vector3): void {
  const dx = target.x - pos.x, dy = target.y - pos.y, dz = target.z - pos.z;
  const len = Math.hypot(dx, dy, dz);
  if (len < 1e-9) return;
  const k = -CAMERA_PLANE_NUDGE / len;
  pos.set(pos.x + dx * k, pos.y + dy * k, pos.z + dz * k);
}

export async function createRig(def: CameraDef, cam: THREE.PerspectiveCamera | THREE.OrthographicCamera, dom: HTMLElement | null, deterministic: boolean): Promise<CameraRig> {
  const target0 = new THREE.Vector3(...(def.target ?? [0, 0, 0]));
  const rest: CameraRig["rest"] = { position: new THREE.Vector3(...def.position), target: target0.clone(), fov: num(def.fov, 45), zoom: num(def.zoom, 10) };
  const controls = def.controls ?? "none";
  const smoothPos = rest.position.clone();
  const smoothTarget = rest.target.clone();
  const parallax = new THREE.Vector2();
  const shake = new THREE.Vector3();
  let first = true;
  let orbit: CameraRig["orbit"] = null;

  if (controls === "orbit" && dom && !deterministic) {
    const { OrbitControls } = await import("three/addons/controls/OrbitControls.js");
    const oc = new OrbitControls(cam, dom);
    oc.target.copy(rest.target);
    oc.enableDamping = true;
    oc.dampingFactor = 0.08;
    oc.enableZoom = def.orbitZoom !== false;
    oc.enablePan = false;
    const lim = def.orbitLimits ?? {};
    if (lim.minDistance !== undefined) oc.minDistance = lim.minDistance;
    if (lim.maxDistance !== undefined) oc.maxDistance = lim.maxDistance;
    if (lim.minPolar !== undefined) oc.minPolarAngle = lim.minPolar * DEG;
    if (lim.maxPolar !== undefined) oc.maxPolarAngle = lim.maxPolar * DEG;
    if (lim.minAzimuth !== undefined) oc.minAzimuthAngle = lim.minAzimuth * DEG;
    if (lim.maxAzimuth !== undefined) oc.maxAzimuthAngle = lim.maxAzimuth * DEG;
    if (def.autoRotate) {
      oc.autoRotate = true;
      oc.autoRotateSpeed = (def.autoRotate / 360) * 60; // OrbitControls: 2.0 = 30 s per orbit at 60fps
    }
    orbit = oc;
  }

  const tmp = new THREE.Vector3();
  const handheld = new THREE.Vector3();
  const rig: CameraRig = {
    rest,
    shake,
    orbit,
    update(t, dt, input) {
      if (cam instanceof THREE.PerspectiveCamera) {
        cam.userData.restFov = rest.fov;
        const fov = fittedFov(rest.fov, num(cam.userData.fitScale, 1));
        if (cam.fov !== fov) {
          cam.fov = fov;
          cam.updateProjectionMatrix();
        }
      } else if (cam instanceof THREE.OrthographicCamera && num(cam.userData.zoomHeight, num(def.zoom, 10)) !== rest.zoom) {
        cam.userData.zoomHeight = rest.zoom;
        const aspect = (cam.right - cam.left) / Math.max(cam.top - cam.bottom, 1e-6);
        const h = (rest.zoom / 2) * num(cam.userData.fitScale, 1);
        cam.left = -h * aspect;
        cam.right = h * aspect;
        cam.top = h;
        cam.bottom = -h;
        cam.updateProjectionMatrix();
      }
      if (orbit) {
        orbit.update();
        cam.position.add(shake);
        return;
      }
      let pos = tmp.copy(rest.position);
      const target = smoothTarget;
      if (controls === "scroll" && def.scrollPath?.length) {
        const path = def.scrollPath;
        const f = clamp(input.scroll, 0, 1) * (path.length - 1);
        const i = Math.min(Math.floor(f), path.length - 2);
        const k = path.length === 1 ? 0 : f - Math.max(i, 0);
        const e = k * k * (3 - 2 * k);
        const a = path[Math.max(i, 0)], b = path[Math.min(Math.max(i, 0) + 1, path.length - 1)];
        pos.set(...a.position).lerp(new THREE.Vector3(...b.position), e);
        const ta = new THREE.Vector3(...(a.target ?? def.target ?? [0, 0, 0]));
        const tb = new THREE.Vector3(...(b.target ?? def.target ?? [0, 0, 0]));
        target.copy(ta.lerp(tb, e));
      } else if (controls === "follow" && input.followTarget) {
        const f = def.follow ?? { target: "" };
        const wp = input.followTarget.getWorldPosition(new THREE.Vector3());
        const offset = new THREE.Vector3(...(f.offset ?? [0, 4, 8]));
        const want = wp.clone().add(offset);
        const lookAt = wp.clone().add(new THREE.Vector3(0, 0, -num(f.lookAhead, 0)));
        const k = first ? 1 : smoothFactor(num(f.smoothing, 0.85), dt);
        smoothPos.lerp(want, k);
        target.lerp(lookAt, k);
        pos = tmp.copy(smoothPos);
      } else target.copy(rest.target);
      if (input.lookAt) target.copy(input.lookAt);

      if (def.autoRotate && controls !== "follow") {
        const ang = def.autoRotate * DEG * t;
        const rel = pos.clone().sub(target);
        rel.applyAxisAngle(new THREE.Vector3(0, 1, 0), ang);
        pos.copy(target).add(rel);
      }
      if (controls === "parallax") {
        const p = def.parallax ?? {};
        const strength = num(p.strength, 0.5);
        const k = smoothFactor(num(p.smoothing, 0.92), dt);
        parallax.x += (input.pointer.x * strength - parallax.x) * k;
        parallax.y += (input.pointer.y * strength * 0.6 - parallax.y) * k;
        // Offset in the camera plane.
        const fwd = target.clone().sub(pos).normalize();
        const right = new THREE.Vector3().crossVectors(fwd, cam.up).normalize();
        const up = new THREE.Vector3().crossVectors(right, fwd).normalize();
        pos.addScaledVector(right, parallax.x).addScaledVector(up, parallax.y);
      }
      if (def.shake) {
        // Handheld: two octaves of smooth noise on position and aim.
        const sh = def.shake;
        const sp = num(sh.speed, 0.5), amt = num(sh.amount, 0.03), rot = num(sh.rotation, 0.4) * DEG;
        const seed = num(sh.seed, 1) * 17.31;
        const n = (ch: number) => noise2D(t * sp + seed, ch * 7.13) * 0.75 + noise2D(t * sp * 2.7 + seed, ch * 7.13 + 3.1) * 0.25;
        const fwd = target.clone().sub(pos);
        const d = fwd.length() || 1;
        fwd.divideScalar(d);
        const right = new THREE.Vector3().crossVectors(fwd, cam.up).normalize();
        const up = new THREE.Vector3().crossVectors(right, fwd).normalize();
        pos.addScaledVector(right, n(0) * amt).addScaledVector(up, n(1) * amt);
        handheld.copy(target).addScaledVector(right, Math.tan(n(2) * rot) * d).addScaledVector(up, Math.tan(n(3) * rot) * d);
      } else handheld.copy(target);
      cam.position.copy(pos).add(shake);
      nudgeOffPlanes(cam.position, handheld);
      cam.lookAt(handheld);
      first = false;
    },
    dispose() {
      orbit?.dispose();
    },
  };
  return rig;
}
