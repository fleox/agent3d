import * as THREE from "three";
import type { BehaviourImpl } from "../registry";
import { bool, num } from "../util";

// Follow a smooth Catmull-Rom path through points (parent space).
export const path: BehaviourImpl = (def, ctx) => {
  const raw = Array.isArray(def.points) ? (def.points as unknown[]) : [];
  const pts = raw.filter((p): p is number[] => Array.isArray(p) && p.length >= 3).map((p) => new THREE.Vector3(p[0], p[1], p[2]));
  const loop = bool(def.loop, true), face = bool(def.faceDirection, true);
  const duration = Math.max(num(def.duration, 5), 1e-3);
  if (pts.length < 2) return { update() {} };
  const curve = new THREE.CatmullRomCurve3(pts, loop, "catmullrom", 0.5);
  const tan = new THREE.Vector3();
  const fwd = new THREE.Vector3(0, 0, 1);
  return {
    update(t) {
      const u = loop ? (t / duration) % 1 : Math.min(t / duration, 1);
      curve.getPointAt(u, ctx.object.position);
      if (face) {
        curve.getTangentAt(Math.min(u, 0.9999), tan).normalize();
        ctx.object.quaternion.setFromUnitVectors(fwd, tan);
      }
    },
  };
};
