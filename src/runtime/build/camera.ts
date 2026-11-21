// Camera + controls: none, orbit (OrbitControls, disabled in deterministic
// mode), parallax (pointer drift), scroll (interpolates `scrollPath` by scroll
// progress), follow (smoothed tracking of an object), autoRotate.

import * as THREE from "three";
import type { CameraDef } from "../../core/types";
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
  cam.lookAt(t[0], t[1], t[2]);
  return cam;
}

export function setCameraAspect(cam: THREE.Camera, def: CameraDef, aspect: number): void {
  if (cam instanceof THREE.PerspectiveCamera) {
    cam.aspect = aspect;
    cam.updateProjectionMatrix();
  } else if (cam instanceof THREE.OrthographicCamera) {
    const h = (cam.userData.zoomHeight ?? num(def.zoom, 10)) / 2;
    cam.left = -h * aspect;
    cam.right = h * aspect;
    cam.top = h;
    cam.bottom = -h;
    cam.updateProjectionMatrix();
  }
}

export interface CameraRig {
  // Rest values (timeline / scripts write here; the controller derives the final camera).
  rest: { position: THREE.Vector3; target: THREE.Vector3; fov: number };
  update(t: number, dt: number, input: { pointer: { x: number; y: number }; scroll: number; followTarget?: THREE.Object3D | null }): void;
  // Extra offset applied after the controller (camera shake).
  shake: THREE.Vector3;
  orbit: { enabled: boolean; dispose(): void; update(): void } | null;
  dispose(): void;
}

export async function createRig(def: CameraDef, cam: THREE.PerspectiveCamera | THREE.OrthographicCamera, dom: HTMLElement | null, deterministic: boolean): Promise<CameraRig> {
  const target0 = new THREE.Vector3(...(def.target ?? [0, 0, 0]));
  const rest = { position: new THREE.Vector3(...def.position), target: target0.clone(), fov: num(def.fov, 45) };
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
    if (def.autoRotate) {
      oc.autoRotate = true;
      oc.autoRotateSpeed = (def.autoRotate / 360) * 60; // OrbitControls: 2.0 = 30 s per orbit at 60fps
    }
    orbit = oc;
  }

  const tmp = new THREE.Vector3();
  const rig: CameraRig = {
    rest,
    shake,
    orbit,
    update(t, dt, input) {
      if (cam instanceof THREE.PerspectiveCamera && cam.fov !== rest.fov) {
        cam.fov = rest.fov;
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
      cam.position.copy(pos).add(shake);
      cam.lookAt(target);
      first = false;
    },
    dispose() {
      orbit?.dispose();
    },
  };
  return rig;
}
