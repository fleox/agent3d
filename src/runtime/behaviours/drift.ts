import type { BehaviourImpl } from "../registry";
import { hash1, num, vec3 } from "../util";

// Slow pseudo-random wandering inside a box — a sum of incommensurate sines
// (deterministic function of t and seed).
export const drift: BehaviourImpl = (def, ctx) => {
  const [ax, ay, az] = vec3(def.area, [1, 1, 1]);
  const speed = num(def.speed, 0.3), seed = num(def.seed, 1) + ctx.object.id * 0.137;
  const ph = Array.from({ length: 6 }, (_, i) => hash1(seed * 13.1 + i) * Math.PI * 2);
  const fr = Array.from({ length: 6 }, (_, i) => 0.6 + hash1(seed * 7.7 + i * 3.3) * 0.8);
  const w = (i: number, t: number) => 0.65 * Math.sin(t * fr[i] + ph[i]) + 0.35 * Math.sin(t * fr[i + 3] * 2.3 + ph[i + 3]);
  return {
    update(t) {
      const s = t * speed;
      ctx.object.position.x += (ax / 2) * w(0, s);
      ctx.object.position.y += (ay / 2) * w(1, s * 0.9);
      ctx.object.position.z += (az / 2) * w(2, s * 1.1);
    },
  };
};
