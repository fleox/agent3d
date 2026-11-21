import type { BehaviourImpl } from "../registry";
import { DEG, num } from "../util";
import { TAU, axisOf } from "./common";

// Pendulum rotation back and forth.
export const sway: BehaviourImpl = (def, ctx) => {
  const axis = axisOf(def.axis, [0, 0, 1]);
  const angle = num(def.angle, 8) * DEG, speed = num(def.speed, 0.5);
  return { update: (t) => void ctx.object.rotateOnAxis(axis, angle * Math.sin(TAU * speed * t)) };
};
