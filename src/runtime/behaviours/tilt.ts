import type { BehaviourImpl } from "../registry";
import { DEG, bool, num, smoothFactor } from "../util";

// Card tilt: the object leans toward the pointer (like a hovered product
// card), lifts toward the camera and scales up a little. `hoverOnly` tilts
// only while the object is hovered; `reverse` leans away.
export const tilt: BehaviourImpl = (def, ctx) => {
  const max = num(def.maxAngle, 12) * DEG, scale = num(def.scale, 1.04), lift = num(def.lift, 0.1), smoothing = num(def.smoothing, 0.86);
  const hoverOnly = bool(def.hoverOnly, true), dir = bool(def.reverse, false) ? -1 : 1;
  let x = 0, y = 0, h = 0;
  return {
    update(_t, dt) {
      const active = hoverOnly ? ctx.hovered() : ctx.pointer.inside;
      const k = smoothFactor(smoothing, dt);
      h += ((active ? 1 : 0) - h) * k;
      x += ((active ? ctx.pointer.x : 0) - x) * k;
      y += ((active ? ctx.pointer.y : 0) - y) * k;
      ctx.object.rotation.y += x * max * dir;
      ctx.object.rotation.x += -y * max * dir;
      ctx.object.position.z += lift * h;
      ctx.object.scale.multiplyScalar(1 + (scale - 1) * h);
    },
  };
};
