import type { BehaviourImpl } from "../registry";
import { DEG, num, str } from "../util";

// Damped spring integration (semi-implicit Euler, fixed 1/240 s sub-steps so
// big deterministic seeks stay stable). Returns the new [x, v].
export function springStep(x: number, v: number, target: number, dt: number, stiffness: number, damping: number, mass = 1): [number, number] {
  const h = 1 / 240;
  let left = Math.min(Math.max(dt, 0), 2);
  while (left > 1e-9) {
    const s = Math.min(h, left);
    const a = (-stiffness * (x - target) - damping * v) / mass;
    v += a * s;
    x += v * s;
    left -= s;
  }
  return [x, v];
}

// Follow the pointer with spring physics (overshoot + settle): lively cards,
// mascots, floating UI. move: translate; rotate: lean toward the pointer.
export const spring: BehaviourImpl = (def, ctx) => {
  const strength = num(def.strength, 0.4), stiffness = Math.max(num(def.stiffness, 120), 1), damping = Math.max(num(def.damping, 12), 0), mass = Math.max(num(def.mass, 1), 0.01);
  const mode = str(def.mode, "move");
  const angle = num(def.angle, 15) * DEG;
  const st = { x: 0, vx: 0, y: 0, vy: 0 };
  return {
    update(_t, dt) {
      const tx = ctx.pointer.inside ? ctx.pointer.x : 0, ty = ctx.pointer.inside ? ctx.pointer.y : 0;
      [st.x, st.vx] = springStep(st.x, st.vx, tx, dt, stiffness, damping, mass);
      [st.y, st.vy] = springStep(st.y, st.vy, ty, dt, stiffness, damping, mass);
      if (mode === "move" || mode === "both") {
        ctx.object.position.x += st.x * strength;
        ctx.object.position.y += st.y * strength;
      }
      if (mode === "rotate" || mode === "both") {
        ctx.object.rotation.y += st.x * angle;
        ctx.object.rotation.x += -st.y * angle;
      }
    },
  };
};
