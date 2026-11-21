import type { BehaviourImpl } from "../registry";
import { num, smoothFactor } from "../util";

// Grow when hovered.
export const hoverScale: BehaviourImpl = (def, ctx) => {
  const target = num(def.scale, 1.15), smoothing = num(def.smoothing, 0.8);
  let s = 1;
  return {
    update(_t, dt) {
      s += ((ctx.hovered() ? target : 1) - s) * smoothFactor(smoothing, dt);
      ctx.object.scale.multiplyScalar(s);
    },
  };
};
