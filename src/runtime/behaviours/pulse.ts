import type { BehaviourImpl } from "../registry";
import { num } from "../util";
import { TAU } from "./common";

// Breathing uniform scale.
export const pulse: BehaviourImpl = (def, ctx) => {
  const amount = num(def.amount, 0.08), speed = num(def.speed, 1);
  return { update: (t) => void ctx.object.scale.multiplyScalar(1 + amount * Math.sin(TAU * speed * t)) };
};
