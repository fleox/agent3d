import type { BehaviourImpl } from "../registry";
import { DEG, num } from "../util";
import { axisOf } from "./common";

// Rotate with the scroll progress of the embed through the viewport.
export const scrollRotate: BehaviourImpl = (def, ctx) => {
  const axis = axisOf(def.axis);
  const deg = num(def.degrees, 360) * DEG;
  return { update: () => void ctx.object.rotateOnAxis(axis, deg * ctx.scroll()) };
};
