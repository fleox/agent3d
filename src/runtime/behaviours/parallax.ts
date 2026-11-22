import type { BehaviourImpl } from "../registry";
import { num, smoothFactor } from "../util";

// Depth layer: moves with the pointer and the page scroll in proportion to
// `depth` (0 = background, 1 = foreground; negative moves the other way).
// Give each layer of a scene a different depth for a parallax stack.
export const parallax: BehaviourImpl = (def, ctx) => {
  const depth = num(def.depth, 0.5), pointer = num(def.pointer, 0.3), scroll = num(def.scroll, 0), smoothing = num(def.smoothing, 0.9);
  let x = 0, y = 0;
  return {
    update(_t, dt) {
      const k = smoothFactor(smoothing, dt);
      const px = ctx.pointer.inside ? ctx.pointer.x : 0, py = ctx.pointer.inside ? ctx.pointer.y : 0;
      x += (px - x) * k;
      y += (py - y) * k;
      ctx.object.position.x += x * pointer * depth;
      ctx.object.position.y += y * pointer * depth * 0.6 + (ctx.scroll() - 0.5) * scroll * depth;
    },
  };
};
