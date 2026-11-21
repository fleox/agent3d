import * as THREE from "three";
import type { BehaviourImpl } from "../registry";
import { DEG, bool, num, vec3 } from "../util";
import { axisOf } from "./common";

// Circle around a centre (parent space) in the plane perpendicular to `axis`.
// The rest position's component along the axis is kept (orbit height).
export const orbit: BehaviourImpl = (def, ctx) => {
  const center = new THREE.Vector3(...vec3(def.center, [0, 0, 0]));
  const radius = num(def.radius, 2), speed = num(def.speed, 30) * DEG, phase = num(def.phase, 0) * DEG;
  const axis = axisOf(def.axis);
  const face = bool(def.faceDirection, false);
  const ref = Math.abs(axis.y) < 0.99 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
  const u = new THREE.Vector3().crossVectors(ref, axis).normalize();
  const v = new THREE.Vector3().crossVectors(axis, u).normalize();
  const tmp = new THREE.Vector3();
  return {
    update(t) {
      const a = phase + speed * t;
      const along = ctx.object.position.dot(axis) - center.dot(axis);
      tmp.copy(center).addScaledVector(u, Math.cos(a) * radius).addScaledVector(v, Math.sin(a) * radius).addScaledVector(axis, along);
      ctx.object.position.copy(tmp);
      if (face) {
        const dir = u.clone().multiplyScalar(-Math.sin(a)).addScaledVector(v, Math.cos(a)).multiplyScalar(Math.sign(speed) || 1);
        const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir.normalize());
        ctx.object.quaternion.premultiply(q);
      }
    },
  };
};
