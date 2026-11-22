import type { BehaviourImpl } from "../registry";
import { noise2D } from "../random";
import { DEG, num, vec3 } from "../util";

// Organic motion from smooth noise (two octaves): position wander + rotation
// wobble. Calmer and less repetitive than sine-based float / sway.
export const noise: BehaviourImpl = (def, ctx) => {
  const [ax, ay, az] = vec3(def.amplitude, [0.1, 0.1, 0.05]);
  const [rx, ry, rz] = vec3(def.rotation, [3, 3, 2]);
  const speed = num(def.speed, 0.3);
  const seed = num(def.seed, 1) * 13.37 + (ctx.rng.next() * 100);
  const n = (t: number, ch: number) => noise2D(t * speed + seed, ch * 5.17) * 0.8 + noise2D(t * speed * 2.3 + seed, ch * 5.17 + 2.9) * 0.2;
  return {
    update(t) {
      ctx.object.position.x += n(t, 0) * ax;
      ctx.object.position.y += n(t, 1) * ay;
      ctx.object.position.z += n(t, 2) * az;
      ctx.object.rotation.x += n(t, 3) * rx * DEG;
      ctx.object.rotation.y += n(t, 4) * ry * DEG;
      ctx.object.rotation.z += n(t, 5) * rz * DEG;
    },
  };
};
