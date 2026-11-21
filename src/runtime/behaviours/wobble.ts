import type { BehaviourImpl } from "../registry";
import { num } from "../util";
import { TAU } from "./common";

// Jelly squash & stretch (volume-ish preserving).
export const wobble: BehaviourImpl = (def, ctx) => {
  const a = num(def.amount, 0.08), speed = num(def.speed, 2);
  return {
    update(t) {
      const s = Math.sin(TAU * speed * t * 0.5);
      const c = Math.sin(TAU * speed * t * 0.5 + Math.PI / 2);
      ctx.object.scale.x *= 1 + a * s;
      ctx.object.scale.y *= 1 - a * s;
      ctx.object.scale.z *= 1 + a * c * 0.5;
    },
  };
};
