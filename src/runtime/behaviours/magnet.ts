import * as THREE from "three";
import type { BehaviourImpl } from "../registry";
import { num, smoothFactor } from "../util";

// Pulled toward the pointer when close (screen space), springs back.
export const magnet: BehaviourImpl = (def, ctx) => {
  const radius = Math.max(num(def.radius, 0.25), 1e-3), strength = num(def.strength, 0.4);
  const off = new THREE.Vector3();
  const want = new THREE.Vector3();
  const wp = new THREE.Vector3();
  const ndc = new THREE.Vector3();
  const target = new THREE.Vector3();
  return {
    update(_t, dt) {
      want.set(0, 0, 0);
      if (ctx.pointer.inside) {
        ctx.object.getWorldPosition(wp);
        ndc.copy(wp).project(ctx.camera);
        const dx = (ctx.pointer.x - ndc.x) / 2, dy = (ctx.pointer.y - ndc.y) / 2;
        const d = Math.hypot(dx, dy);
        if (d < radius) {
          target.set(ctx.pointer.x, ctx.pointer.y, ndc.z).unproject(ctx.camera);
          want.copy(target).sub(wp);
          const len = want.length();
          if (len > 1e-6) want.multiplyScalar((Math.min(len, strength) * (1 - d / radius)) / len);
        }
      }
      off.lerp(want, smoothFactor(0.85, dt));
      ctx.object.position.add(off);
    },
  };
};
