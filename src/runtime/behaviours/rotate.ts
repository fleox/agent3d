import type { BehaviourImpl } from "../registry";
import { DEG, num } from "../util";
import { axisOf } from "./common";

// Spin continuously around a local axis (deg/s).
export const rotate: BehaviourImpl = (def, ctx) => {
  const axis = axisOf(def.axis);
  const speed = num(def.speed, 45) * DEG;
  return { update: (t) => void ctx.object.rotateOnAxis(axis, speed * t) };
};
