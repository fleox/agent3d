// Interactions (scene.interactions) in the Studio (pure): action kinds,
// defaults, the fields each trigger uses, and URL checks (same rule as
// validation: http(s) or page-relative).

import type { InteractionAction, InteractionDef, SceneDoc } from "../../core/types";
import { INTERACTION_ACTIONS, INTERACTION_ON, isAllowedUrl } from "../../core/validateMotion";
import { walkObjects } from "../../ops/tree";

export type ActionKind = (typeof INTERACTION_ACTIONS)[number];
export type OnKind = (typeof INTERACTION_ON)[number];
export { INTERACTION_ACTIONS, INTERACTION_ON, isAllowedUrl };

export function actionKind(a: InteractionAction): ActionKind | null {
  const k = INTERACTION_ACTIONS.filter((x) => x in a);
  return k.length === 1 ? k[0] : null;
}

export const TARGETED: readonly OnKind[] = ["click", "hover", "hoverEnd"];
export const GESTURE: readonly OnKind[] = ["click", "key"];

export function segmentNames(scene: SceneDoc): string[] {
  return ["timeline", ...Object.keys(scene.timeline?.segments ?? {})];
}

export function modelIds(scene: SceneDoc): string[] {
  const out: string[] = [];
  walkObjects(scene.objects, (o) => void (o.kind === "model" && out.push(o.id)));
  return out;
}

export function defaultAction(kind: ActionKind, scene: SceneDoc): InteractionAction {
  const segs = segmentNames(scene);
  switch (kind) {
    case "play":
      return { play: segs[1] ?? "timeline" };
    case "toggle":
      return { toggle: segs[1] ?? "timeline" };
    case "seek":
      return { seek: Object.keys(scene.timeline?.markers ?? {})[0] ?? 0 };
    case "set": {
      let id = scene.objects[0]?.id ?? "camera";
      walkObjects(scene.objects, (o) => void (o.kind !== "group" && id === scene.objects[0]?.id && (id = o.id)));
      return { set: { path: `${id}.scale`, value: 1.1 }, duration: 0.3, ease: "outCubic" };
    }
    case "emit":
      return { emit: "clicked" };
    case "openUrl":
      return { openUrl: "https://example.com", newTab: true };
    case "playClip":
      return { playClip: 0, target: modelIds(scene)[0] ?? "" };
  }
}

export function defaultInteraction(scene: SceneDoc, on: OnKind = "click"): InteractionDef {
  const target = scene.objects[0]?.id;
  const it: InteractionDef = { on, do: [defaultAction(scene.timeline?.segments ? "play" : "emit", scene)] };
  if (TARGETED.includes(on) && target) it.target = target;
  if (on === "key") it.key = "Space";
  if (on === "event") it.event = Object.keys(scene.timeline?.markers ?? {})[0] ?? "clicked";
  if (on === "scroll") it.at = 0.5;
  return it;
}

// Switching the trigger keeps the actions; drops fields the new trigger ignores, adds required ones.
export function withTrigger(it: InteractionDef, on: OnKind, scene: SceneDoc): InteractionDef {
  const next: InteractionDef = { on, do: it.do, ...(it.once !== undefined ? { once: it.once } : {}) };
  if (TARGETED.includes(on) && it.target) next.target = it.target;
  if (on === "key") next.key = it.key ?? "Space";
  if (on === "event") next.event = it.event ?? Object.keys(scene.timeline?.markers ?? {})[0] ?? "clicked";
  if (on === "scroll") next.at = it.at ?? 0.5;
  return next;
}

// Problems shown next to an action before the engine refuses it.
export function actionProblem(a: InteractionAction, on: OnKind): "url" | "gesture" | null {
  if ("openUrl" in a) {
    if (!isAllowedUrl(a.openUrl)) return "url";
    if (!GESTURE.includes(on)) return "gesture";
  }
  return null;
}

// Common property paths for "set" actions on an object id.
export function setPathSuggestions(scene: SceneDoc): string[] {
  const out: string[] = [];
  walkObjects(scene.objects, (o) => {
    out.push(`${o.id}.position`, `${o.id}.rotation`, `${o.id}.scale`, `${o.id}.visible`);
    if ("material" in o || o.kind === "mesh" || o.kind === "text") out.push(`${o.id}.material.color`, `${o.id}.material.emissiveIntensity`, `${o.id}.material.opacity`);
  });
  for (const l of scene.lights ?? []) if (l.id) out.push(`${l.id}.intensity`, `${l.id}.color`);
  out.push("camera.position", "camera.target", "camera.fov");
  return out;
}
