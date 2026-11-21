import type { BehaviourImpl } from "../registry";
import { num } from "../util";
import { TAU } from "./common";

// Gentle sine float on Y.
export const float: BehaviourImpl = (def, ctx) => {
  const amp = num(def.amplitude, 0.15), speed = num(def.speed, 0.5), phase = num(def.phase, 0);
  return { update: (t) => void (ctx.object.position.y += amp * Math.sin(TAU * (speed * t + phase))) };
};
