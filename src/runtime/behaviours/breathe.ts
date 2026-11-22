import type { BehaviourImpl } from "../registry";
import { num } from "../util";

// Organic breathing: a slow inhale (ease-in-out) then a shorter exhale, the
// chest (Y) expanding more than the sides, with a slight rise. Idle
// characters, mascots, soft blobs.
export const breathe: BehaviourImpl = (def, ctx) => {
  const amount = num(def.amount, 0.04), period = Math.max(num(def.period, 4), 0.1), phase = num(def.phase, 0), rise = num(def.rise, 0.02);
  return {
    update(t) {
      const u = (t / period + phase) % 1;
      // 60 % inhale, 40 % exhale, smooth at both ends.
      const s = u < 0.6 ? 0.5 - 0.5 * Math.cos((u / 0.6) * Math.PI) : 0.5 + 0.5 * Math.cos(((u - 0.6) / 0.4) * Math.PI);
      ctx.object.scale.x *= 1 + amount * 0.5 * s;
      ctx.object.scale.z *= 1 + amount * 0.5 * s;
      ctx.object.scale.y *= 1 + amount * s;
      ctx.object.position.y += rise * s;
    },
  };
};
