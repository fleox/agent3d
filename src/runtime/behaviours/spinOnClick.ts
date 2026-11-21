import type { BehaviourImpl } from "../registry";
import { ease } from "../timeline/easing";
import { num } from "../util";
import { TAU, axisOf } from "./common";

// One full eased spin per click (trigger "hover": per pointer entry; a spin
// in progress is never restarted, so the object always ends facing front).
export const spinOnClick: BehaviourImpl = (def, ctx) => {
  const axis = axisOf(def.axis);
  const duration = Math.max(num(def.duration, 0.8), 1e-3);
  const onHover = def.trigger === "hover";
  let start = -1;
  let wasHovered = false;
  return {
    update(t) {
      const busy = start >= 0 && t - start < duration;
      if (onHover) {
        const h = ctx.hovered();
        if (h && !wasHovered && !busy) start = t;
        wasHovered = h;
      } else if (ctx.clicked() && !busy) start = t;
      if (start < 0) return;
      const k = (t - start) / duration;
      if (k >= 1) return;
      ctx.object.rotateOnAxis(axis, TAU * ease("inOutCubic", k));
    },
  };
};
