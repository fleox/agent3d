import type { BehaviourImpl } from "../registry";
import { ease } from "../timeline/easing";
import { num, str } from "../util";
import { TAU, materialsOf } from "./common";

// Entrance animation (scale / fade / rise / drop / spin) once visible.
export const appear: BehaviourImpl = (def, ctx) => {
  const effect = str(def.effect, "scale"), duration = Math.max(num(def.duration, 0.8), 1e-3), easeName = str(def.ease, "outBack");
  const mats = effect === "fade" ? materialsOf(ctx.object) : [];
  for (const m of mats) {
    if (m.userData.baseOpacity === undefined) m.userData.baseOpacity = m.opacity;
    m.transparent = true;
  }
  return {
    update(t) {
      const k = Math.min(Math.max(t / duration, 0), 1);
      const p = ease(easeName, k);
      const o = ctx.object;
      switch (effect) {
        case "fade":
          for (const m of mats) m.opacity = (m.userData.baseOpacity as number) * ease("outCubic", k);
          break;
        case "rise":
          o.position.y -= (1 - p) * 1;
          o.scale.multiplyScalar(Math.max(1e-4, Math.min(1, k * 3)));
          break;
        case "drop":
          o.position.y += (1 - p) * 3;
          if (k <= 0) o.visible = false;
          break;
        case "spin":
          o.rotation.y += (1 - p) * TAU;
          o.scale.multiplyScalar(Math.max(1e-4, p));
          break;
        default:
          o.scale.multiplyScalar(Math.max(1e-4, p));
      }
    },
  };
};
