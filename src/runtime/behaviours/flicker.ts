import type * as THREE from "three";
import type { BehaviourImpl } from "../registry";
import { clamp, hash1, num } from "../util";
import { materialsOf } from "./common";

// Smooth value noise in [0,1] (deterministic).
function vnoise(x: number, seed: number): number {
  const i = Math.floor(x), f = x - i;
  const a = hash1(i + seed * 31.7), b = hash1(i + 1 + seed * 31.7);
  return a + (b - a) * f * f * (3 - 2 * f);
}

// Random intensity flicker on lights (intensity) or emissive materials.
export const flicker: BehaviourImpl = (def, ctx) => {
  const amount = clamp(num(def.amount, 0.3), 0, 1), speed = num(def.speed, 8);
  const seed = ctx.object.id;
  const mats = materialsOf(ctx.object) as THREE.MeshStandardMaterial[];
  for (const m of mats) if (m.userData.baseEmissiveIntensity === undefined) m.userData.baseEmissiveIntensity = m.emissiveIntensity ?? 1;
  return {
    update(t) {
      const n = 0.6 * vnoise(t * speed, seed) + 0.4 * vnoise(t * speed * 2.7, seed + 3);
      const f = 1 - amount * n;
      const light = ctx.object as THREE.Light;
      if (light.isLight) light.intensity *= f;
      for (const m of mats) if (m.emissiveIntensity !== undefined) m.emissiveIntensity = m.userData.baseEmissiveIntensity * f;
    },
  };
};
