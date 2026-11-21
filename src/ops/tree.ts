// Object tree helpers (pure): find / walk / flatten the objects of a scene.
// Re-exported by objects.ts.

import type { ObjectDef, SceneDoc } from "../core/types";

export interface ObjectLocation {
  object: ObjectDef;
  parent: ObjectDef | null;
  container: ObjectDef[]; // the array holding it (scene.objects or parent.children)
  index: number;
  depth: number;
}

export function findObject(objects: ObjectDef[] | undefined, id: string, parent: ObjectDef | null = null, depth = 0): ObjectLocation | null {
  if (!Array.isArray(objects)) return null;
  for (let i = 0; i < objects.length; i++) {
    const o = objects[i];
    if (o && o.id === id) return { object: o, parent, container: objects, index: i, depth };
  }
  for (const o of objects) {
    const found = o && Array.isArray(o.children) ? findObject(o.children, id, o, depth + 1) : null;
    if (found) return found;
  }
  return null;
}

// Depth-first, parents before children. Return false from `fn` to skip children.
export function walkObjects(objects: ObjectDef[] | undefined, fn: (object: ObjectDef, parent: ObjectDef | null, depth: number) => void | boolean, parent: ObjectDef | null = null, depth = 0): void {
  if (!Array.isArray(objects)) return;
  for (const o of objects) {
    if (!o || typeof o !== "object") continue;
    if (fn(o, parent, depth) === false) continue;
    walkObjects(o.children, fn, o, depth + 1);
  }
}

export function isDescendant(ancestor: ObjectDef, id: string): boolean {
  return !!findObject(ancestor.children, id);
}

// One-line description of what an object is ("mesh box", "generator terrain", "text \"Hello\"").
export function objectDetail(o: ObjectDef): string {
  switch (o.kind) {
    case "mesh":
      return `${o.geometry?.type ?? "?"}${o.material?.preset ? ` / ${o.material.preset}` : ""}`;
    case "instances":
      return `${o.geometry?.type ?? "?"} × ${o.layout?.type ?? "?"}`;
    case "text": {
      const t = String(o.text ?? "");
      return JSON.stringify(t.length > 40 ? `${t.slice(0, 37)}…` : t);
    }
    case "model":
      return String(o.src ?? "");
    case "generator":
      return String(o.generator ?? "");
    case "particles":
      return String(o.preset ?? "custom");
    case "svg":
      return typeof o.src === "string" && o.src.trim().startsWith("<") ? "inline svg" : String(o.src ?? "");
    case "group":
      return `${o.children?.length ?? 0} children`;
    default:
      return "";
  }
}

export interface FlatObject {
  id: string;
  kind: string;
  detail: string;
  parent: string | null;
  depth: number;
  name?: string;
  position?: [number, number, number];
  behaviours?: string[];
  hidden?: true;
}

export function flattenObjects(scene: Pick<SceneDoc, "objects">): FlatObject[] {
  const out: FlatObject[] = [];
  walkObjects(scene.objects, (o, parent, depth) => {
    out.push({
      id: o.id,
      kind: o.kind,
      detail: objectDetail(o),
      parent: parent ? parent.id : null,
      depth,
      ...(o.name ? { name: o.name } : {}),
      ...(o.position ? { position: o.position } : {}),
      ...(o.behaviours?.length ? { behaviours: o.behaviours.map((b) => b.type) } : {}),
      ...(o.visible === false ? { hidden: true as const } : {}),
    });
  });
  return out;
}

export function allObjectIds(scene: Pick<SceneDoc, "objects">): string[] {
  const ids: string[] = [];
  walkObjects(scene.objects, (o) => void ids.push(o.id));
  return ids;
}
