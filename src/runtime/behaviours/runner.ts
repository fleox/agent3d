// Gating of a behaviour instance by `when` and `delay`.
//   always / visible — behaviour time = scene time (the scene clock starts when
//                      the embed becomes visible) minus delay;
//   hover            — time only advances while the object is hovered;
//   click            — starts at the first click on the object;
//   scroll           — time follows the scroll progress (0..1 → 0..10 s).

import type { BehaviourDef } from "../../core/types";
import type { BehaviourContext, BehaviourImpl, BehaviourInstance } from "../registry";
import { num } from "../util";

export const SCROLL_TIME_RANGE = 10;

export interface BehaviourRunner {
  def: BehaviourDef;
  step(t: number, dt: number): void;
  dispose(): void;
}

// Entrance behaviours: with reduced motion "static" they are considered complete.
export const ENTRANCE_BEHAVIOURS = new Set(["appear"]);
const SETTLED_TIME = 1e6;

export function createRunner(def: BehaviourDef, impl: BehaviourImpl, ctx: BehaviourContext, opts: { settled?: () => boolean } = {}): BehaviourRunner {
  const inst: BehaviourInstance = impl(def, ctx);
  const when = def.when ?? "always";
  const delay = num(def.delay, 0);
  let hoverTime = 0;
  let clickAt = -1;
  return {
    def,
    step(t, dt) {
      if (opts.settled?.() && ENTRANCE_BEHAVIOURS.has(def.type) && (when === "always" || when === "visible")) {
        inst.update(SETTLED_TIME, dt);
        return;
      }
      let local: number;
      switch (when) {
        case "hover":
          if (ctx.hovered()) hoverTime += dt;
          local = hoverTime - delay;
          break;
        case "click":
          if (clickAt < 0 && ctx.clicked()) clickAt = t;
          if (clickAt < 0) return;
          local = t - clickAt - delay;
          break;
        case "scroll":
          local = ctx.scroll() * SCROLL_TIME_RANGE - delay;
          break;
        default:
          local = t - delay;
      }
      inst.update(Math.max(0, local), dt);
    },
    dispose() {
      inst.dispose?.();
    },
  };
}
