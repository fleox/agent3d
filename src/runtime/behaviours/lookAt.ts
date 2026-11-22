import * as THREE from "three";
import type { BehaviourImpl } from "../registry";
import { bool, num, smoothFactor } from "../util";

// Turn to face another object, the camera ("camera") or a `point` [x, y, z]
// (smoothed). lockY: only turn around the vertical axis. The object's front is +Z.
export const lookAt: BehaviourImpl = (def, ctx) => {
  const smoothing = num(def.smoothing, 0.85), lockY = bool(def.lockY, false);
  const point = Array.isArray(def.point) && def.point.length === 3 ? new THREE.Vector3(...(def.point as [number, number, number])) : null;
  const id = typeof def.target === "string" ? def.target : "camera";
  const want = new THREE.Quaternion();
  const cur = new THREE.Quaternion();
  const wp = new THREE.Vector3();
  const tp = new THREE.Vector3();
  const m = new THREE.Matrix4();
  const parentQ = new THREE.Quaternion();
  let first = true;
  return {
    update(_t, dt) {
      const target = point ?? (id === "camera" ? ctx.camera : ctx.find?.(id));
      if (!target) return;
      if (target instanceof THREE.Vector3) tp.copy(target);
      else target.getWorldPosition(tp);
      ctx.object.getWorldPosition(wp);
      if (lockY) tp.y = wp.y;
      if (tp.distanceToSquared(wp) < 1e-10) return;
      // Object3D.lookAt points -Z at the target for cameras only; build a +Z-facing basis.
      m.lookAt(tp, wp, THREE.Object3D.DEFAULT_UP);
      want.setFromRotationMatrix(m);
      if (ctx.object.parent) want.premultiply(ctx.object.parent.getWorldQuaternion(parentQ).invert());
      cur.slerp(want, first ? 1 : smoothFactor(smoothing, dt));
      first = false;
      ctx.object.quaternion.copy(cur);
    },
  };
};
