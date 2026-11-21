import * as THREE from "three";
import type { BehaviourImpl } from "../registry";
import { bool, colors, num, toColor } from "../util";
import { materialsOf } from "./common";

// Cycle material (or light) colour through a palette (linear-space blend).
export const colorCycle: BehaviourImpl = (def, ctx) => {
  const palette = colors(def.colors, ["#ff006e", "#8338ec", "#3a86ff"]).map((c) => toColor(c));
  const speed = num(def.speed, 0.5), emissive = bool(def.emissive, false);
  const mats = materialsOf(ctx.object);
  const col = new THREE.Color();
  return {
    update(t) {
      const f = (((t * speed) % palette.length) + palette.length) % palette.length;
      const i = Math.floor(f);
      const k = f - i;
      const e = k * k * (3 - 2 * k);
      col.copy(palette[i]).lerp(palette[(i + 1) % palette.length], e);
      const light = ctx.object as THREE.Light;
      if (light.isLight) light.color.copy(col);
      for (const m of mats) {
        const mm = m as THREE.MeshStandardMaterial;
        mm.color?.copy(col);
        if (emissive && mm.emissive) mm.emissive.copy(col);
      }
    },
  };
};
