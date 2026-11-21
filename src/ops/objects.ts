// Object ops (thin wrappers over patchScene so every rule lives in one place)
// + the pure tree helpers.

import type { ProjectFs } from "../core/fs";
import type { BehaviourDef, ObjectDef } from "../core/types";
import { closest } from "../core/suggest";
import { OpsError } from "./context";
import { readSceneFile } from "./project";
import { patchScene, type PatchResult } from "./scene";
import { allObjectIds, findObject, flattenObjects, type FlatObject } from "./tree";

export * from "./tree";

type Opts = { dryRun?: boolean };

export async function listObjects(fs: ProjectFs): Promise<FlatObject[]> {
  return flattenObjects(await readSceneFile(fs));
}

export async function getObject(fs: ProjectFs, id: string): Promise<{ object: ObjectDef; parent: string | null }> {
  const scene = await readSceneFile(fs);
  const loc = findObject(scene.objects, id);
  if (!loc) {
    const s = closest(id, allObjectIds(scene));
    throw new OpsError("notFound", `No object with id "${id}".`, s ? `Did you mean "${s}"?` : "List ids with object_list / `agent3d object list`.");
  }
  return { object: loc.object, parent: loc.parent?.id ?? null };
}

export function addObject(fs: ProjectFs, object: ObjectDef, opts: Opts & { parent?: string; index?: number } = {}): Promise<PatchResult> {
  return patchScene(fs, [{ op: "addObject", object, parent: opts.parent, index: opts.index }], opts);
}

export function updateObject(fs: ProjectFs, id: string, set: Record<string, unknown>, opts: Opts = {}): Promise<PatchResult> {
  return patchScene(fs, [{ op: "updateObject", id, set }], opts);
}

export function removeObject(fs: ProjectFs, id: string, opts: Opts = {}): Promise<PatchResult> {
  return patchScene(fs, [{ op: "removeObject", id }], opts);
}

export function moveObject(fs: ProjectFs, id: string, to: { parent?: string | null; index?: number }, opts: Opts = {}): Promise<PatchResult> {
  return patchScene(fs, [{ op: "moveObject", id, parent: to.parent, index: to.index }], opts);
}

export function addBehaviour(fs: ProjectFs, id: string, behaviour: BehaviourDef, opts: Opts = {}): Promise<PatchResult> {
  return patchScene(fs, [{ op: "addBehaviour", id, behaviour }], opts);
}
