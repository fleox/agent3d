import type { BehaviourImpl } from "../registry";
import { num, smoothFactor, str } from "../util";

// Lean / move toward the pointer (smoothed).
export const followPointer: BehaviourImpl = (def, ctx) => {
  const strength = num(def.strength, 0.5), smoothing = num(def.smoothing, 0.9), mode = str(def.mode, "rotate");
  let x = 0, y = 0;
  return {
    update(_t, dt) {
      const k = smoothFactor(smoothing, dt);
      x += (ctx.pointer.x - x) * k;
      y += (ctx.pointer.y - y) * k;
      if (mode === "move" || mode === "both") {
        ctx.object.position.x += x * strength;
        ctx.object.position.y += y * strength;
      }
      if (mode === "rotate" || mode === "both") {
        ctx.object.rotation.y += x * strength * 0.8;
        ctx.object.rotation.x += -y * strength * 0.8;
      }
    },
  };
};
