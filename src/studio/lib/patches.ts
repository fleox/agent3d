// Edits → PatchOps (src/ops/scene.ts). Every Studio edit is expressed as
// scene_patch operations so the engine validates it and agents watching the
// folder see a normal change.

import { GENERATORS, GEOMETRIES, type CatalogEntry } from "../../core/catalog";
import { uniqueId } from "../../core/ids";
import { clone, getAt, hasAt } from "../../core/jsonPath";
import type { BehaviourDef, ObjectDef, SceneDoc } from "../../core/types";
import type { PatchOp } from "../../ops/scene";
import { allObjectIds, findObject, walkObjects } from "../../ops/tree";

export const objPath = (id: string, field: string): string => `objects#${id}${field ? `.${field}` : ""}`;

export function readAt(scene: SceneDoc, path: string): unknown {
  try {
    return getAt(scene as never, path);
  } catch {
    return undefined;
  }
}

// value undefined → remove the key (only when present).
export function fieldOps(scene: SceneDoc, path: string, value: unknown): PatchOp[] {
  if (value === undefined) return hasAt(scene as never, path) ? [{ op: "remove", path }] : [];
  if (JSON.stringify(readAt(scene, path)) === JSON.stringify(value)) return [];
  return [{ op: "set", path, value }];
}

export function takenIds(scene: SceneDoc): Set<string> {
  return new Set([...allObjectIds(scene), ...(scene.lights ?? []).map((l) => l.id).filter((x): x is string => !!x), ...(scene.ui?.elements ?? []).map((e) => e.id)]);
}

function catalogDefaults(entry: CatalogEntry | undefined): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const p of entry?.params ?? []) if (p.required && p.default !== undefined) out[p.name] = clone(p.default);
  return out;
}

// Required params without defaults get a sensible sample so the object validates.
const REQUIRED_SAMPLES: Record<string, Record<string, unknown>> = {
  lathe: { points: [[0, 0], [0.4, 0], [0.5, 0.3], [0.3, 0.8], [0.35, 1.2], [0, 1.2]] },
  extrude: { shape: [[0, 0.5], [0.15, 0.15], [0.5, 0.1], [0.2, -0.12], [0.3, -0.5], [0, -0.25], [-0.3, -0.5], [-0.2, -0.12], [-0.5, 0.1], [-0.15, 0.15]] },
  tube: { points: [[-1.5, 0, 0], [-0.5, 0.6, 0.3], [0.5, -0.4, -0.3], [1.5, 0.2, 0]] },
};

export type NewObjectSpec =
  | { kind: "mesh"; geometry: string }
  | { kind: "text"; text?: string; font?: string }
  | { kind: "generator"; generator: string }
  | { kind: "particles"; preset: string }
  | { kind: "model"; src: string; name?: string }
  | { kind: "group" };

// A ready-to-add ObjectDef with a unique id, placed at `position`.
export function newObject(scene: SceneDoc, spec: NewObjectSpec, position: [number, number, number] = [0, 0, 0]): ObjectDef {
  const taken = takenIds(scene);
  switch (spec.kind) {
    case "mesh": {
      const entry = GEOMETRIES.find((g) => g.id === spec.geometry);
      return {
        id: uniqueId(spec.geometry, taken),
        kind: "mesh",
        position,
        geometry: { type: spec.geometry as never, ...catalogDefaults(entry), ...(REQUIRED_SAMPLES[spec.geometry] ?? {}) },
        material: { preset: "plastic", color: "#7c8cff" },
      };
    }
    case "text":
      return { id: uniqueId("text", taken), kind: "text", position, text: spec.text ?? "Hello", font: spec.font ?? "sans-bold", size: 0.6, depth: 0.15, material: { preset: "plastic", color: "#ffffff" } };
    case "generator": {
      const entry = GENERATORS.find((g) => g.id === spec.generator);
      const params = catalogDefaults(entry);
      return { id: uniqueId(spec.generator, taken), kind: "generator", generator: spec.generator, position, ...(Object.keys(params).length ? { params } : {}) };
    }
    case "particles":
      return { id: uniqueId(spec.preset, taken), kind: "particles", preset: spec.preset, position };
    case "model": {
      const base = (spec.name ?? spec.src.split(/[/:]/).pop() ?? "model").replace(/\.(glb|gltf)$/i, "");
      return { id: uniqueId(base, taken), kind: "model", src: spec.src, fit: 1.5, position };
    }
    case "group":
      return { id: uniqueId("group", taken), kind: "group", position, children: [] };
  }
}

// Deep copy with fresh ids for the whole subtree, offset a little.
export function duplicateObject(scene: SceneDoc, id: string): { ops: PatchOp[]; newId: string } | null {
  const loc = findObject(scene.objects, id);
  if (!loc) return null;
  const copy = clone(loc.object);
  const taken = takenIds(scene);
  walkObjects([copy], (o) => {
    const fresh = uniqueId(o.id.replace(/-\d+$/, ""), taken);
    taken.add(fresh);
    o.id = fresh;
  });
  const p = copy.position ?? [0, 0, 0];
  copy.position = [Math.round((p[0] + 0.5) * 1000) / 1000, p[1], p[2]];
  return { ops: [{ op: "addObject", object: copy, ...(loc.parent ? { parent: loc.parent.id } : {}), index: loc.index + 1 }], newId: copy.id };
}

// Drag & drop in the outliner: drop `id` before/after/inside `targetId`.
export function moveOps(scene: SceneDoc, id: string, targetId: string, where: "before" | "after" | "inside"): PatchOp[] {
  if (id === targetId) return [];
  const src = findObject(scene.objects, id);
  const dst = findObject(scene.objects, targetId);
  if (!src || !dst) return [];
  if (findObject(src.object.children, targetId)) return []; // into own descendant
  if (where === "inside") return [{ op: "moveObject", id, parent: targetId }];
  const parent = dst.parent ? dst.parent.id : null;
  let index = dst.index + (where === "after" ? 1 : 0);
  // Same container: removal shifts the indices after the source.
  if (src.container === dst.container && src.index < index) index -= 1;
  if (src.container === dst.container && src.index === index) return [];
  return [{ op: "moveObject", id, parent, index }];
}

export function behaviourFromEntry(entry: CatalogEntry): BehaviourDef {
  const b: BehaviourDef = { type: entry.id };
  for (const p of entry.params) if (p.required && p.default !== undefined) b[p.name] = clone(p.default);
  if (entry.id === "path") b.points = [[-1, 0, 0], [0, 0.5, 1], [1, 0, 0], [0, -0.5, -1]];
  return b;
}

// Kinds that carry a `material` field.
export const MATERIAL_KINDS = new Set(["mesh", "text", "model", "instances", "svg"]);
