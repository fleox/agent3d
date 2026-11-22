// Gizmo results → PatchOps. A finished drag becomes one store edit (one
// undo step, one scene_patch) in the scene's units (metres, degrees).

import type { SceneDoc } from "../../core/types";
import type { PatchOp } from "../../ops/scene";
import { findObject } from "../../ops/tree";
import { transformFields, type LocalTransform, type Vec3 } from "../../runtime/editor/math";
import { fieldOps, objPath } from "./patches";

// What the gizmo edits: an object (any depth), a light's position or a directional / spot / rect light's target.
export type GizmoTarget = { kind: "object"; id: string } | { kind: "light"; id: string; part: "position" | "target" };

// Light entries without an id are "light<index>" in the runtime.
export function lightIndex(scene: SceneDoc, id: string): number {
  const lights = scene.lights ?? [];
  const i = lights.findIndex((l) => l.id === id);
  if (i >= 0) return i;
  const m = /^light(\d+)$/.exec(id);
  return m && lights[Number(m[1])] && !lights[Number(m[1])].id ? Number(m[1]) : -1;
}

export function lightPath(scene: SceneDoc, id: string): string | null {
  const i = lightIndex(scene, id);
  if (i < 0) return null;
  const l = scene.lights![i];
  return l.id ? `lights#${l.id}` : `lights[${i}]`;
}

export function objectTransformOps(scene: SceneDoc, id: string, t: LocalTransform): PatchOp[] {
  const loc = findObject(scene.objects, id);
  if (!loc) return [];
  const f = transformFields(loc.object, t);
  return [...fieldOps(scene, objPath(id, "position"), f.position), ...fieldOps(scene, objPath(id, "rotation"), f.rotation), ...fieldOps(scene, objPath(id, "scale"), f.scale)];
}

export function lightMoveOps(scene: SceneDoc, id: string, part: "position" | "target", value: Vec3): PatchOp[] {
  const path = lightPath(scene, id);
  return path ? fieldOps(scene, `${path}.${part}`, value) : [];
}

export function cameraFromViewOps(scene: SceneDoc, position: Vec3, target: Vec3): PatchOp[] {
  const r = (v: Vec3) => v.map((x) => Math.round(x * 1000) / 1000 || 0) as Vec3;
  return [...fieldOps(scene, "camera.position", r(position)), ...fieldOps(scene, "camera.target", r(target))];
}

// Selection cycling on click: the first click picks the top-level ancestor;
// clicking again inside the current selection goes one level deeper.
// `chain` is the hit's id chain, deepest first (World.idsFor).
export function pickInChain(chain: string[], current: string | null): string | null {
  if (!chain.length) return null;
  const top = chain[chain.length - 1];
  if (!current) return top;
  const i = chain.indexOf(current);
  if (i < 0) return top;
  return i > 0 ? chain[i - 1] : current;
}
