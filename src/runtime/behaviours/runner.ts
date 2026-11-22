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
  // Runs after the camera update (reads the camera pose of THIS frame).
  late: boolean;
  // Carries state across frames whose result depends on how time was cut into
  // frames (smoothing toward a moving target, springs): deterministic seeks
  // advance it on a fixed grid (World.hasStatefulMotion).
  stateful: boolean;
  step(t: number, dt: number): void;
  dispose(): void;
}

// Entrance behaviours: with reduced motion "static" they are considered complete.
export const ENTRANCE_BEHAVIOURS = new Set(["appear"]);
const SETTLED_TIME = 1e6;

// Behaviours that read the camera: evaluated after the camera rig so they use
// this frame's pose (otherwise they lag one frame, and a lone deterministic
// seek reads the t = 0 camera).
export const LATE_BEHAVIOURS = new Set(["billboard", "lookAt"]);
// Behaviours whose state depends on the frame history beyond a constant input
// (smoothing toward a moving target, spring integration). Pointer smoothing
// toward a fixed pointer (followPointer, parallax, tilt…) is exponential, so
// it gives the same result however the time is split: not listed.
export const STATEFUL_BEHAVIOURS = new Set(["lookAt", "magnet", "spring"]);

// Fixed time grid used by deterministic seeks over stateful motion: the grid
// points strictly between `from` and `to` (the seek target itself is the final
// frame). Seeking 0 → 9 walks exactly the same points as 0 → 1 → 5 → 9.
export const MOTION_GRID_STEP = 1 / 30;
export function motionGrid(from: number, to: number, h = MOTION_GRID_STEP): number[] {
  const out: number[] = [];
  for (let k = Math.floor(from / h + 1e-6) + 1; k * h < to - 1e-6; k++) out.push(k * h);
  return out;
}

export function createRunner(def: BehaviourDef, impl: BehaviourImpl, ctx: BehaviourContext, opts: { settled?: () => boolean } = {}): BehaviourRunner {
  const inst: BehaviourInstance = impl(def, ctx);
  const when = def.when ?? "always";
  const delay = num(def.delay, 0);
  let hoverTime = 0;
  let clickAt = -1;
  return {
    def,
    late: LATE_BEHAVIOURS.has(def.type),
    stateful: STATEFUL_BEHAVIOURS.has(def.type),
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
