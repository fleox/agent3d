// Camera shots (camera.shots): cinematic moves evaluated on the timeline
// clock. Shots apply in `at` order, each from the pose the previous ones left
// (overlapping shots blend), so the camera pose is a pure function of time.

import * as THREE from "three";
import type { CameraShotDef } from "../../core/types";
import { DEG } from "../util";
import { ease } from "./easing";

export interface CameraPose {
  position: THREE.Vector3;
  target: THREE.Vector3;
  fov: number;
  focus?: number;
}

export interface ShotHost {
  // World position of an object (lookAt / focus / path lookAt), or null.
  objectPosition(id: string): THREE.Vector3 | null;
}

const UP = new THREE.Vector3(0, 1, 0);

function v3(a: unknown): THREE.Vector3 | null {
  return Array.isArray(a) && a.length === 3 && a.every((x) => typeof x === "number") ? new THREE.Vector3(a[0], a[1], a[2]) : null;
}

const curveCache = new WeakMap<CameraShotDef, { key: string; curve: THREE.CatmullRomCurve3 }>();

function pathCurve(shot: CameraShotDef, start: THREE.Vector3): THREE.CatmullRomCurve3 | null {
  const pts = (shot.points ?? []).map(v3).filter((p): p is THREE.Vector3 => !!p);
  if (!pts.length) return null;
  const key = `${start.x},${start.y},${start.z}`;
  const hit = curveCache.get(shot);
  if (hit && hit.key === key) return hit.curve;
  const curve = new THREE.CatmullRomCurve3([start.clone(), ...pts], false, "centripetal");
  curveCache.set(shot, { key, curve });
  return curve;
}

// Applies one shot at eased progress k (0..1) to `pose` (mutated).
export function applyShot(shot: CameraShotDef, k: number, pose: CameraPose, host: ShotHost): void {
  const pos = pose.position, tgt = pose.target;
  const toTarget = tgt.clone().sub(pos);
  const dist = toTarget.length() || 1;
  const fwd = toTarget.clone().divideScalar(dist);
  const right = new THREE.Vector3().crossVectors(fwd, UP);
  if (right.lengthSq() < 1e-8) right.set(1, 0, 0);
  right.normalize();
  const fovTo = typeof shot.fov === "number" ? shot.fov : null;
  switch (shot.type) {
    case "dolly":
    case "pushIn":
    case "pullOut": {
      let d = typeof shot.distance === "number" ? shot.distance : shot.type === "pullOut" ? dist * 0.33 : dist * 0.25;
      if (shot.type === "pullOut") d = -Math.abs(d);
      // Never pass through the target.
      d = Math.min(d, dist - 0.05);
      pos.addScaledVector(fwd, d * k);
      break;
    }
    case "truck": {
      const d = (shot.distance ?? 1) * k;
      pos.addScaledVector(right, d);
      tgt.addScaledVector(right, d);
      break;
    }
    case "pedestal": {
      const d = (shot.distance ?? 1) * k;
      pos.y += d;
      tgt.y += d;
      break;
    }
    case "crane": {
      pos.y += (shot.height ?? 2) * k;
      if (typeof shot.distance === "number") {
        const flat = new THREE.Vector3(fwd.x, 0, fwd.z);
        if (flat.lengthSq() > 1e-8) pos.addScaledVector(flat.normalize(), shot.distance * k);
      }
      break;
    }
    case "orbit": {
      const rel = pos.clone().sub(tgt);
      rel.applyAxisAngle(UP, (shot.angle ?? 90) * DEG * k);
      if (shot.elevation) {
        const sph = new THREE.Spherical().setFromVector3(rel);
        sph.phi = Math.min(Math.max(sph.phi - shot.elevation * DEG * k, 0.01), Math.PI - 0.01);
        rel.setFromSpherical(sph);
      }
      if (typeof shot.distance === "number") rel.setLength(Math.max(0.05, rel.length() + shot.distance * k));
      pos.copy(tgt).add(rel);
      break;
    }
    case "move": {
      const p = v3(shot.position), t = v3(shot.target);
      if (p) pos.lerp(p, k);
      if (t) tgt.lerp(t, k);
      break;
    }
    case "path": {
      const curve = pathCurve(shot, pos);
      if (!curve) break;
      const at = curve.getPointAt(Math.min(Math.max(k, 0), 1));
      const look = typeof shot.lookAt === "string" ? host.objectPosition(shot.lookAt) : v3(shot.lookAt);
      if (look) tgt.lerp(look, Math.min(1, k * 4));
      else {
        const ahead = Math.min(Math.max(shot.lookAhead ?? 0.05, 0.001), 0.5);
        const u = Math.min(k + ahead, 1);
        const p = curve.getPointAt(u);
        if (u >= 1) p.add(curve.getTangentAt(1).multiplyScalar(ahead * curve.getLength()));
        // Blend from the previous target so the shot starts without a jump.
        tgt.lerp(p, Math.min(1, k * 6));
      }
      pos.copy(at);
      break;
    }
    case "lookAt": {
      const p = shot.object ? host.objectPosition(shot.object) : v3(shot.target);
      if (p) tgt.lerp(p, k);
      break;
    }
    case "focus": {
      let to = typeof shot.focus === "number" ? shot.focus : null;
      if (shot.object) {
        const p = host.objectPosition(shot.object);
        if (p) to = p.distanceTo(pos);
      }
      if (to !== null) pose.focus = (pose.focus ?? to) + (to - (pose.focus ?? to)) * k;
      break;
    }
    case "zoom":
      break;
  }
  if (fovTo !== null) pose.fov += (fovTo - pose.fov) * k;
}

export function sortShots(shots: CameraShotDef[] | undefined): CameraShotDef[] {
  return [...(shots ?? [])].filter((s) => s && typeof s.at === "number" && typeof s.duration === "number").sort((a, b) => a.at - b.at);
}

// Pose at time t from the base pose (sorted shots).
export function evaluateShots(shots: CameraShotDef[], t: number, base: CameraPose, host: ShotHost): CameraPose {
  const pose: CameraPose = { position: base.position.clone(), target: base.target.clone(), fov: base.fov, focus: base.focus };
  for (const s of shots) {
    if (t < s.at) break;
    const raw = s.duration > 0 ? (t - s.at) / s.duration : 1;
    applyShot(s, ease(s.ease ?? "inOutCubic", raw), pose, host);
  }
  return pose;
}
