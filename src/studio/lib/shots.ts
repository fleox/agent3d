// Camera shots (camera.shots) in the Studio: the fields each shot type uses
// (mirrors src/runtime/timeline/shots.ts) and a ready-to-add default.

import type { ParamSpec } from "../../core/catalog";
import type { CameraShotDef, SceneDoc } from "../../core/types";
import { SHOT_TYPES } from "../../core/validateMotion";

const n = (name: string, description: string, def?: number, min?: number, max?: number): ParamSpec => ({ name, type: "number", description, default: def, min, max });
const v3 = (name: string, description: string): ParamSpec => ({ name, type: "vec3", description });
const FOV = n("fov", "Field of view to reach (degrees).", undefined, 1, 179);

export const SHOT_PARAMS: Record<CameraShotDef["type"], ParamSpec[]> = {
  dolly: [n("distance", "Units along the view axis (+ = forward).", undefined), FOV],
  pushIn: [n("distance", "Units closer (default: 25 % of the distance).", undefined, 0), FOV],
  pullOut: [n("distance", "Units back (default: 33 % of the distance).", undefined, 0), FOV],
  truck: [n("distance", "Units sideways (+ = right).", 1), FOV],
  pedestal: [n("distance", "Units up (- = down); the target follows.", 1), FOV],
  crane: [n("height", "Rise (units) while the target stays.", 2), n("distance", "Units toward the target.", undefined), FOV],
  orbit: [n("angle", "Yaw around the target (degrees).", 90, -720, 720), n("elevation", "Elevation change (degrees).", 0, -89, 89), n("distance", "Distance change (units).", undefined), FOV],
  zoom: [{ ...FOV, required: true }],
  move: [v3("position", "Camera position to reach."), v3("target", "Look-at point to reach."), FOV],
  path: [n("lookAhead", "Look ahead along the path (0..0.5).", 0.05, 0, 0.5), FOV],
  lookAt: [v3("target", "Point to pan to (or pick an object)."), FOV],
  focus: [n("focus", "Focus distance (or pick an object).", undefined, 0)],
};

// Which shots take an object reference (lookAt / focus: `object`; path: `lookAt` id).
export const SHOT_OBJECT_FIELD: Partial<Record<CameraShotDef["type"], "object" | "lookAt">> = { lookAt: "object", focus: "object", path: "lookAt" };

export { SHOT_TYPES };

// A new shot starting after the last one (or at the playhead), valid on its own.
export function newShot(scene: SceneDoc, type: CameraShotDef["type"], at?: number): CameraShotDef {
  const shots = scene.camera.shots ?? [];
  const end = shots.reduce((m, s) => Math.max(m, (s.at ?? 0) + (s.duration ?? 0)), 0);
  const start = Math.round((at ?? end) * 100) / 100;
  const shot: CameraShotDef = { type, at: start, duration: 2 };
  const pos = scene.camera.position;
  switch (type) {
    case "zoom":
      shot.fov = Math.max(10, (scene.camera.fov ?? 45) - 15);
      break;
    case "move":
      shot.position = [pos[0] + 2, pos[1] + 1, pos[2]];
      break;
    case "path":
      shot.points = [
        [pos[0] + 2, pos[1] + 0.5, pos[2] - 1],
        [pos[0] + 3, pos[1] + 1, pos[2] - 3],
      ];
      break;
    case "lookAt":
      shot.target = scene.camera.target ?? [0, 0, 0];
      break;
    case "focus":
      shot.focus = 5;
      break;
  }
  return shot;
}

// Timeline span covered by the shots (for the scrubber).
export function shotsEnd(shots: readonly CameraShotDef[] | undefined): number {
  return (shots ?? []).reduce((m, s) => Math.max(m, (s.at ?? 0) + (s.duration ?? 0)), 0);
}
