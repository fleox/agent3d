// Pure transform math for the Studio gizmos: world ↔ local (objects nested
// in groups), Euler continuity (degrees, XYZ order like the runtime), grid /
// angle / scale snapping and rounding to the scene's units. Tested in
// math.test.ts; no DOM.

import * as THREE from "three";

export type Vec3 = [number, number, number];
export type GizmoMode = "translate" | "rotate" | "scale";

const DEG = Math.PI / 180;

export interface SnapSettings {
  translate: number; // metres (grid step)
  rotate: number; // degrees
  scale: number; // scale factor step
}
export const DEFAULT_SNAP: SnapSettings = { translate: 0.25, rotate: 15, scale: 0.1 };

export const round = (v: number, step = 1e-3): number => {
  const r = Math.round(v / step) * step;
  // Kill float noise (0.30000000000000004) and negative zero.
  const out = Number(r.toFixed(Math.max(0, Math.ceil(-Math.log10(step)) + 1)));
  return Object.is(out, -0) ? 0 : out;
};

export const snapTo = (v: number, step: number): number => (step > 0 ? round(Math.round(v / step) * step, Math.min(step, 1e-3)) : v);

// Snaps only the components that moved during the drag (an axis-constrained
// drag never re-snaps the other axes' hand-typed values).
export function snapChanged(next: Vec3, start: Vec3, step: number, eps = 1e-5): Vec3 {
  return next.map((v, i) => (Math.abs(v - start[i]) > eps ? snapTo(v, step) : start[i])) as Vec3;
}

// Wraps `a` (degrees) by multiples of 360 to be as close as possible to `ref`.
export function nearestAngle(a: number, ref: number): number {
  return a + Math.round((ref - a) / 360) * 360;
}

// Euler (degrees, XYZ) for a quaternion, chosen among the equivalent
// representations to stay closest to `prev` (no 180° flips, no ±360 jumps
// while rotating past ±90° on Y).
export function eulerDegreesNear(q: THREE.Quaternion, prev: Vec3): Vec3 {
  const e = new THREE.Euler().setFromQuaternion(q, "XYZ");
  const a: Vec3 = [e.x / DEG, e.y / DEG, e.z / DEG];
  const b: Vec3 = [a[0] + 180, 180 - a[1], a[2] + 180];
  const fit = (c: Vec3): Vec3 => c.map((v, i) => nearestAngle(v, prev[i])) as Vec3;
  const fa = fit(a), fb = fit(b);
  const dist = (c: Vec3) => Math.abs(c[0] - prev[0]) + Math.abs(c[1] - prev[1]) + Math.abs(c[2] - prev[2]);
  return dist(fb) + 1e-6 < dist(fa) ? fb : fa;
}

export interface LocalTransform {
  position: Vec3;
  rotation: Vec3; // degrees
  scale: Vec3;
}

export function quaternionFromDegrees(r: Vec3): THREE.Quaternion {
  return new THREE.Quaternion().setFromEuler(new THREE.Euler(r[0] * DEG, r[1] * DEG, r[2] * DEG, "XYZ"));
}

export function matrixFromLocal(t: LocalTransform): THREE.Matrix4 {
  return new THREE.Matrix4().compose(new THREE.Vector3(...t.position), quaternionFromDegrees(t.rotation), new THREE.Vector3(...t.scale));
}

// Local transform (in the parent's space) of something whose world matrix is
// `world`, given the parent's world matrix. `prev` keeps Euler continuity.
export function localFromWorld(world: THREE.Matrix4, parentWorld: THREE.Matrix4 | null, prev: LocalTransform): LocalTransform {
  const m = parentWorld ? new THREE.Matrix4().copy(parentWorld).invert().multiply(world) : world.clone();
  const p = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3();
  m.decompose(p, q, s);
  return { position: [p.x, p.y, p.z], rotation: eulerDegreesNear(q, prev.rotation), scale: [s.x, s.y, s.z] };
}

export function readTransform(def: { position?: number[]; rotation?: number[]; scale?: number | number[] }): LocalTransform {
  const s = def.scale;
  return {
    position: [def.position?.[0] ?? 0, def.position?.[1] ?? 0, def.position?.[2] ?? 0],
    rotation: [def.rotation?.[0] ?? 0, def.rotation?.[1] ?? 0, def.rotation?.[2] ?? 0],
    scale: typeof s === "number" ? [s, s, s] : [s?.[0] ?? 1, s?.[1] ?? 1, s?.[2] ?? 1],
  };
}

// Finalises a dragged transform: only the gizmo mode's channel changes, snapped
// (translate / scale, when on) and rounded to scene units (mm, 0.01°, 0.001 scale).
export function finishTransform(start: LocalTransform, next: LocalTransform, mode: GizmoMode, snap: SnapSettings | null): LocalTransform {
  const out: LocalTransform = { position: [...start.position], rotation: [...start.rotation], scale: [...start.scale] };
  if (mode === "translate") out.position = (snap ? snapChanged(next.position, start.position, snap.translate) : next.position).map((v) => round(v)) as Vec3;
  // Rotation snapping is a delta around the gizmo axis (applied by the gizmo itself):
  // re-snapping each Euler component would jump on multi-axis rotations.
  else if (mode === "rotate") out.rotation = next.rotation.map((v) => round(v, 0.01)) as Vec3;
  else out.scale = (snap ? snapChanged(next.scale, start.scale, snap.scale) : next.scale).map((v) => Math.max(round(v), 0.001)) as Vec3;
  return out;
}

// The scene.json values for a transform: scale stays a number when uniform
// and it was a number (or absent); defaults (0 position / rotation, scale 1)
// are left out when the field was absent.
export function transformFields(def: { position?: number[]; rotation?: number[]; scale?: number | number[] }, t: LocalTransform): { position?: Vec3; rotation?: Vec3; scale?: number | Vec3 } {
  const isZero = (v: Vec3) => v.every((x) => x === 0);
  const out: { position?: Vec3; rotation?: Vec3; scale?: number | Vec3 } = {};
  out.position = def.position === undefined && isZero(t.position) ? undefined : t.position;
  out.rotation = def.rotation === undefined && isZero(t.rotation) ? undefined : t.rotation;
  const uniform = t.scale[0] === t.scale[1] && t.scale[1] === t.scale[2];
  if (def.scale === undefined && uniform && t.scale[0] === 1) out.scale = undefined;
  else out.scale = uniform && (def.scale === undefined || typeof def.scale === "number") ? t.scale[0] : t.scale;
  return out;
}

// Camera framing: a position looking at `center` from the current direction,
// far enough to see a sphere of `radius` with a vertical field of view `fovDeg`.
export function frameSphere(center: Vec3, radius: number, from: Vec3, fovDeg: number, aspect = 1): { position: Vec3; target: Vec3 } {
  const dir = new THREE.Vector3(from[0] - center[0], from[1] - center[1], from[2] - center[2]);
  if (dir.lengthSq() < 1e-9) dir.set(0, 0.3, 1);
  dir.normalize();
  const vfov = Math.max(fovDeg, 1) * DEG;
  const hfov = 2 * Math.atan(Math.tan(vfov / 2) * Math.max(aspect, 0.1));
  const r = Math.max(radius, 0.05);
  const dist = (r / Math.sin(Math.min(vfov, hfov) / 2)) * 1.4;
  return { position: [center[0] + dir.x * dist, center[1] + dir.y * dist, center[2] + dir.z * dist], target: [...center] };
}
