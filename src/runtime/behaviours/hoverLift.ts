import type { BehaviourImpl } from "../registry";
import { DEG, num, smoothFactor } from "../util";

// Rise and tilt toward the pointer when hovered.
export const hoverLift: BehaviourImpl = (def, ctx) => {
  const height = num(def.height, 0.2), tilt = num(def.tilt, 10) * DEG;
  let h = 0, px = 0, py = 0;
  return {
    update(_t, dt) {
      const k = smoothFactor(0.82, dt);
      h += ((ctx.hovered() ? 1 : 0) - h) * k;
      px += (ctx.pointer.x - px) * k;
      py += (ctx.pointer.y - py) * k;
      ctx.object.position.y += height * h;
      ctx.object.rotation.x += -py * tilt * h;
      ctx.object.rotation.y += px * tilt * h;
    },
  };
};
