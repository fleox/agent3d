import type { BehaviourImpl } from "../registry";
import { DEG, num, smoothFactor } from "../util";

// Turn toward the pointer (yaw + pitch), clamped to maxAngle.
export const lookAtPointer: BehaviourImpl = (def, ctx) => {
  const max = num(def.maxAngle, 35) * DEG, smoothing = num(def.smoothing, 0.85);
  let yaw = 0, pitch = 0;
  return {
    update(_t, dt) {
      const k = smoothFactor(smoothing, dt);
      yaw += (ctx.pointer.x * max - yaw) * k;
      pitch += (-ctx.pointer.y * max - pitch) * k;
      ctx.object.rotation.y += yaw;
      ctx.object.rotation.x += pitch;
    },
  };
};
