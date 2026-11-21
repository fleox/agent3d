import type { BehaviourImpl } from "../registry";
import { bool, hash1, num } from "../util";

// Periodic (or irregular) short hide: signs, lights, eyes.
export const blink: BehaviourImpl = (def, ctx) => {
  const interval = Math.max(num(def.interval, 3), 0.05), duration = num(def.duration, 0.15), random = bool(def.random, true);
  return {
    update(t) {
      const cycle = Math.floor(t / interval);
      const offset = random ? hash1(cycle + ctx.object.id) * (interval - duration) * 0.8 : interval - duration;
      const local = t - cycle * interval;
      if (local >= offset && local < offset + duration) ctx.object.visible = false;
    },
  };
};
