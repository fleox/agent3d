import type { BehaviourImpl } from "../registry";
import { ease } from "../timeline/easing";
import { num } from "../util";
import { TAU, axisOf } from "./common";

// One full eased spin per click.
export const spinOnClick: BehaviourImpl = (def, ctx) => {
  const axis = axisOf(def.axis);
  const duration = Math.max(num(def.duration, 0.8), 1e-3);
  let start = -1;
  return {
    update(t) {
      if (ctx.clicked()) start = t;
      if (start < 0) return;
      const k = (t - start) / duration;
      if (k >= 1) return;
      ctx.object.rotateOnAxis(axis, TAU * ease("inOutCubic", k));
    },
  };
};
