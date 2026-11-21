import type { BehaviourImpl } from "../registry";
import { num } from "../util";

// Damped squash-bounce after each click / tap.
export const clickBounce: BehaviourImpl = (def, ctx) => {
  const amount = num(def.amount, 0.25);
  let start = -1;
  return {
    update(t) {
      if (ctx.clicked()) start = t;
      if (start < 0) return;
      const tau = t - start;
      if (tau > 1.5) return;
      const s = amount * Math.exp(-5 * tau) * Math.sin(tau * 22);
      ctx.object.scale.y *= 1 - s;
      ctx.object.scale.x *= 1 + s * 0.5;
      ctx.object.scale.z *= 1 + s * 0.5;
    },
  };
};
