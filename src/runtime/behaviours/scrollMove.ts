import type { BehaviourImpl } from "../registry";
import { vec3 } from "../util";

// Move by `offset` across the scroll range (parallax depth).
export const scrollMove: BehaviourImpl = (def, ctx) => {
  const [x, y, z] = vec3(def.offset, [0, 2, 0]);
  return {
    update() {
      const s = ctx.scroll();
      ctx.object.position.x += x * s;
      ctx.object.position.y += y * s;
      ctx.object.position.z += z * s;
    },
  };
};
