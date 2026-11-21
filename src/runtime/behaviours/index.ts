// Behaviour registry: one implementation per CATALOG.behaviours id.

import type { BehaviourImpl } from "../registry";
import { appear } from "./appear";
import { billboard } from "./billboard";
import { blink } from "./blink";
import { bob } from "./bob";
import { clickBounce } from "./clickBounce";
import { colorCycle } from "./colorCycle";
import { drift } from "./drift";
import { flicker } from "./flicker";
import { float } from "./float";
import { followPointer } from "./followPointer";
import { hoverLift } from "./hoverLift";
import { hoverScale } from "./hoverScale";
import { lookAtPointer } from "./lookAtPointer";
import { magnet } from "./magnet";
import { orbit } from "./orbit";
import { path } from "./path";
import { pulse } from "./pulse";
import { rotate } from "./rotate";
import { scrollMove } from "./scrollMove";
import { scrollRotate } from "./scrollRotate";
import { spinOnClick } from "./spinOnClick";
import { sway } from "./sway";
import { wobble } from "./wobble";

export const BEHAVIOUR_IMPLS: Record<string, BehaviourImpl> = {
  rotate,
  float,
  bob,
  pulse,
  wobble,
  sway,
  orbit,
  path,
  followPointer,
  lookAtPointer,
  hoverScale,
  hoverLift,
  clickBounce,
  spinOnClick,
  scrollRotate,
  scrollMove,
  drift,
  blink,
  colorCycle,
  flicker,
  billboard,
  appear,
  magnet,
};
