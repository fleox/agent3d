import * as THREE from "three";
import type { BehaviourImpl } from "../registry";
import { bool } from "../util";

// Always face the camera (world-space; assumes an unrotated parent).
export const billboard: BehaviourImpl = (def, ctx) => {
  const lockY = bool(def.lockY, true);
  const wp = new THREE.Vector3();
  const cp = new THREE.Vector3();
  return {
    update() {
      ctx.object.getWorldPosition(wp);
      ctx.camera.getWorldPosition(cp);
      if (lockY) ctx.object.rotation.set(0, Math.atan2(cp.x - wp.x, cp.z - wp.z), 0);
      else ctx.camera.getWorldQuaternion(ctx.object.quaternion);
    },
  };
};
