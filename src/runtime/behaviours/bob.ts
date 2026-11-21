import type { BehaviourImpl } from "../registry";
import { num } from "../util";

// Bouncy hop: |sin| on Y with a tiny squash at contact.
export const bob: BehaviourImpl = (def, ctx) => {
  const h = num(def.height, 0.3), speed = num(def.speed, 1.5);
  return {
    update(t) {
      const s = Math.abs(Math.sin(Math.PI * speed * t));
      ctx.object.position.y += h * s;
      const squash = (1 - s) * (1 - s) * 0.08;
      ctx.object.scale.y *= 1 - squash;
      ctx.object.scale.x *= 1 + squash * 0.5;
      ctx.object.scale.z *= 1 + squash * 0.5;
    },
  };
};
