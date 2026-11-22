// Scene ops: read, summarise, replace (with a diff plan) and patch.
//
// applyScene / patchScene are idempotent (same input twice → empty plan, no
// write) and atomic (the result is validated before anything is written; a
// result with errors is refused and returned with its issues).

import type { ProjectFs } from "../core/fs";
import { clone, deepEqual, getAt, mergePatch, parsePath, PathError, removeAt, setAt } from "../core/jsonPath";
import { isValidId } from "../core/ids";
import type { BehaviourDef, Issue, ObjectDef, SceneDoc, TrackDef } from "../core/types";
import { validateScene } from "../core/validate";
import { closest } from "../core/suggest";
import { OpsError, hasErrors } from "./context";
import { readSceneFile, saveScene, SCENE_FILE } from "./project";
import { allObjectIds, findObject, isDescendant, objectDetail, walkObjects } from "./tree";

export async function getScene(fs: ProjectFs): Promise<SceneDoc> {
  return readSceneFile(fs);
}

// ─── Summary ─────────────────────────────────────────────────────────────

export interface SummaryObject {
  id: string;
  kind: string;
  detail: string;
  position?: [number, number, number];
  behaviours?: string[];
  hidden?: true;
  children?: SummaryObject[];
}

export interface SceneSummary {
  id: string;
  title: string;
  target: { kind: string; aspect: string; budgetKb?: number };
  camera: { type: string; position: unknown; target?: unknown; fov?: number; controls?: string };
  background: string;
  lighting?: string;
  lights: { id?: string; type: string; intensity?: number; position?: unknown }[];
  objects: SummaryObject[];
  counts: { objects: number; lights: number; tracks: number; behaviours: number };
  timeline?: { duration: number; loop?: boolean | "pingpong"; trigger?: string; tracks: { target: string; keys: number; from: number; to: number }[] };
  postfx?: string[];
  scripts?: string[];
  ui?: string[];
  sounds?: string[];
}

function backgroundText(bg: unknown): string {
  if (typeof bg === "string") return bg;
  if (bg && typeof bg === "object") {
    const b = bg as Record<string, unknown>;
    if (Array.isArray(b.gradient)) return `gradient(${b.gradient.join(", ")})`;
    if (Array.isArray(b.radial)) return `radial(${b.radial.join(", ")})`;
    if (b.sky) return "sky";
    if (typeof b.hdri === "string") return `hdri ${b.hdri}`;
  }
  return "?";
}

export function summarizeScene(scene: SceneDoc): SceneSummary {
  let objects = 0;
  let behaviours = 0;
  const node = (o: ObjectDef): SummaryObject => {
    objects++;
    behaviours += o.behaviours?.length ?? 0;
    return {
      id: o.id,
      kind: o.kind,
      detail: objectDetail(o),
      ...(o.position ? { position: o.position } : {}),
      ...(o.behaviours?.length ? { behaviours: o.behaviours.map((b) => b.type) } : {}),
      ...(o.visible === false ? { hidden: true as const } : {}),
      ...(o.children?.length ? { children: o.children.map(node) } : {}),
    };
  };
  const tree = (scene.objects ?? []).filter((o) => o && typeof o === "object").map(node);
  const lighting = scene.environment?.lighting;
  return {
    id: scene.id,
    title: scene.title,
    target: { kind: scene.target?.kind, aspect: scene.target?.aspect, ...(scene.target?.budgetKb ? { budgetKb: scene.target.budgetKb } : {}) },
    camera: {
      type: scene.camera?.type,
      position: scene.camera?.position,
      ...(scene.camera?.target ? { target: scene.camera.target } : {}),
      ...(scene.camera?.fov !== undefined ? { fov: scene.camera.fov } : {}),
      ...(scene.camera?.controls ? { controls: scene.camera.controls } : {}),
    },
    background: backgroundText(scene.environment?.background),
    ...(lighting ? { lighting: typeof lighting === "string" ? lighting : `hdri ${lighting.hdri}` } : {}),
    lights: (scene.lights ?? []).map((l) => ({ ...(l.id ? { id: l.id } : {}), type: l.type, ...(l.intensity !== undefined ? { intensity: l.intensity } : {}), ...(l.position ? { position: l.position } : {}) })),
    objects: tree,
    counts: { objects, lights: scene.lights?.length ?? 0, tracks: scene.timeline?.tracks?.length ?? 0, behaviours },
    ...(scene.timeline
      ? {
          timeline: {
            duration: scene.timeline.duration,
            ...(scene.timeline.loop !== undefined ? { loop: scene.timeline.loop } : {}),
            ...(scene.timeline.trigger ? { trigger: scene.timeline.trigger } : {}),
            tracks: (scene.timeline.tracks ?? []).map((t) => ({ target: t.target, keys: t.keys?.length ?? 0, from: t.keys?.[0]?.[0] ?? 0, to: t.keys?.[t.keys.length - 1]?.[0] ?? 0 })),
          },
        }
      : {}),
    ...(scene.postfx?.length ? { postfx: scene.postfx.map((p) => p.type) } : {}),
    ...(scene.scripts?.length ? { scripts: scene.scripts } : {}),
    ...(scene.ui?.elements?.length ? { ui: scene.ui.elements.map((e) => e.id) } : {}),
    ...(scene.audio?.sounds ? { sounds: Object.keys(scene.audio.sounds) } : {}),
  };
}

// ─── Plan (diff) ─────────────────────────────────────────────────────────

export interface ScenePlan {
  empty: boolean;
  objects: {
    added: string[];
    removed: string[];
    changed: { id: string; fields: string[] }[];
    // Parent changes and reorders among siblings (from === to); index = new position among its siblings.
    moved: { id: string; from: string | null; to: string | null; index: number }[];
  };
  // Top-level sections (other than objects) that differ: "camera", "lights", "timeline", …
  sections: string[];
  summary: string;
}

interface FlatEntry {
  object: Record<string, unknown>;
  parent: string | null;
  index: number;
}

function flatMap(scene: Partial<SceneDoc> | null): Map<string, FlatEntry> {
  const map = new Map<string, FlatEntry>();
  const counters = new Map<string | null, number>();
  walkObjects(scene?.objects, (o, parent) => {
    const key = parent?.id ?? null;
    const index = counters.get(key) ?? 0;
    counters.set(key, index + 1);
    if (typeof o.id !== "string") return;
    const { children: _c, ...rest } = o as ObjectDef & { children?: unknown };
    map.set(o.id, { object: rest as Record<string, unknown>, parent: key, index });
  });
  return map;
}

// Ids that changed place among siblings kept under the same parent: the ones
// outside the longest subsequence whose relative order is unchanged.
function reorderedIds(a: Map<string, FlatEntry>, b: Map<string, FlatEntry>): Set<string> {
  const groups = new Map<string | null, string[]>();
  for (const [id, nb] of b) {
    const na = a.get(id);
    if (!na || na.parent !== nb.parent) continue;
    const list = groups.get(nb.parent) ?? [];
    list.push(id);
    groups.set(nb.parent, list);
  }
  const out = new Set<string>();
  for (const ids of groups.values()) {
    ids.sort((x, y) => b.get(x)!.index - b.get(y)!.index);
    const seq = ids.map((id) => a.get(id)!.index);
    // O(n²) LIS — sibling lists are small.
    const len = seq.map(() => 1);
    const prev = seq.map(() => -1);
    for (let i = 0; i < seq.length; i++)
      for (let j = 0; j < i; j++)
        if (seq[j] < seq[i] && len[j] + 1 > len[i]) {
          len[i] = len[j] + 1;
          prev[i] = j;
        }
    let best = -1;
    for (let i = 0; i < seq.length; i++) if (best < 0 || len[i] > len[best]) best = i;
    const keep = new Set<number>();
    for (let i = best; i >= 0; i = prev[i]) keep.add(i);
    ids.forEach((id, i) => {
      if (!keep.has(i)) out.add(id);
    });
  }
  return out;
}

export function diffScenes(before: Partial<SceneDoc> | null, after: Partial<SceneDoc>): ScenePlan {
  const a = flatMap(before);
  const b = flatMap(after);
  const added = [...b.keys()].filter((id) => !a.has(id));
  const removed = [...a.keys()].filter((id) => !b.has(id));
  const changed: ScenePlan["objects"]["changed"] = [];
  const moved: ScenePlan["objects"]["moved"] = [];
  for (const [id, nb] of b) {
    const na = a.get(id);
    if (!na) continue;
    const keys = new Set([...Object.keys(na.object), ...Object.keys(nb.object)]);
    const fields = [...keys].filter((k) => !deepEqual(na.object[k], nb.object[k])).sort();
    if (fields.length) changed.push({ id, fields });
    if (na.parent !== nb.parent) moved.push({ id, from: na.parent, to: nb.parent, index: nb.index });
  }
  for (const id of reorderedIds(a, b)) {
    const nb = b.get(id)!;
    moved.push({ id, from: nb.parent, to: nb.parent, index: nb.index });
  }
  // Order changes among siblings (same ids, same parents, different order).
  const orderOf = (s: Partial<SceneDoc> | null) => {
    const out: string[] = [];
    walkObjects(s?.objects, (o) => void out.push(String(o.id)));
    return out.join("|");
  };
  const reordered = !added.length && !removed.length && !moved.length && orderOf(before) !== orderOf(after);

  const sections: string[] = [];
  const keys = new Set([...Object.keys(before ?? {}), ...Object.keys(after)]);
  for (const k of [...keys].sort()) {
    if (k === "objects") continue;
    if (!deepEqual((before as Record<string, unknown> | null)?.[k], (after as Record<string, unknown>)[k])) sections.push(k);
  }
  if (reordered) sections.push("objects (order)");
  const empty = !added.length && !removed.length && !changed.length && !moved.length && !sections.length;
  const parts: string[] = [];
  if (added.length) parts.push(`add ${added.length} object${added.length > 1 ? "s" : ""} (${added.slice(0, 8).join(", ")}${added.length > 8 ? ", …" : ""})`);
  if (removed.length) parts.push(`remove ${removed.length} (${removed.slice(0, 8).join(", ")}${removed.length > 8 ? ", …" : ""})`);
  if (changed.length) parts.push(`change ${changed.length} (${changed.slice(0, 8).map((c) => c.id).join(", ")}${changed.length > 8 ? ", …" : ""})`);
  if (moved.length) parts.push(`move ${moved.length}`);
  if (sections.length) parts.push(`update ${sections.join(", ")}`);
  return { empty, objects: { added, removed, changed, moved }, sections, summary: empty ? "No changes." : `${parts.join("; ")}.` };
}

// ─── Apply (full replace) ───────────────────────────────────────────────

export interface ApplyResult {
  plan: ScenePlan;
  issues: Issue[];
  applied: boolean;
}

async function currentScene(fs: ProjectFs): Promise<SceneDoc | null> {
  if (!(await fs.exists(SCENE_FILE))) return null;
  return readSceneFile(fs);
}

export async function applyScene(fs: ProjectFs, next: SceneDoc, opts: { dryRun?: boolean } = {}): Promise<ApplyResult> {
  if (!next || typeof next !== "object" || Array.isArray(next)) throw new OpsError("invalid", "scene must be a JSON object (a full SceneDoc).", "Use scene_get to fetch the current scene, edit it, and pass the whole document; or use scene_patch for small edits.");
  const before = await currentScene(fs);
  const issues = validateScene(next);
  const plan = diffScenes(before, next);
  if (hasErrors(issues) || plan.empty || opts.dryRun) return { plan, issues, applied: false };
  await saveScene(fs, next);
  return { plan, issues, applied: true };
}

// ─── Patch ──────────────────────────────────────────────────────────────

export type PatchOp =
  | { op: "set"; path: string; value: unknown }
  | { op: "merge"; path: string; value: unknown }
  | { op: "remove"; path: string }
  | { op: "addObject"; object: ObjectDef; parent?: string; index?: number }
  | { op: "updateObject"; id: string; set: Partial<ObjectDef> | Record<string, unknown> }
  | { op: "removeObject"; id: string }
  | { op: "moveObject"; id: string; parent?: string | null; index?: number }
  | { op: "addBehaviour"; id: string; behaviour: BehaviourDef }
  | { op: "addTrack"; track: TrackDef }
  | { op: "removeTrack"; target: string };

export const PATCH_OPS = ["set", "merge", "remove", "addObject", "updateObject", "removeObject", "moveObject", "addBehaviour", "addTrack", "removeTrack"] as const;

export interface PatchResult extends ApplyResult {
  scene: SceneDoc;
}

function opError(i: number, op: unknown, message: string, hint?: string): OpsError {
  return new OpsError("invalid", `Patch op #${i} (${(op as { op?: string })?.op ?? "?"}) failed: ${message}`, hint, { opIndex: i, op });
}

function requireObject(scene: SceneDoc, id: unknown, i: number, op: unknown) {
  if (typeof id !== "string") throw opError(i, op, '"id" must be an object id string.');
  const loc = findObject(scene.objects, id);
  if (!loc) {
    const s = closest(id, allObjectIds(scene));
    throw opError(i, op, `No object with id "${id}".`, `${s ? `Did you mean "${s}"? ` : ""}List ids with scene_summary / object_list.`);
  }
  return loc;
}

// Collections (arrays of objects: objects, lights, children, behaviours,
// timeline tracks, ui elements, interactions…) that set / merge / remove ops
// replace wholesale — destructive like a removal (front doors confirm them).
// A collection replaced by an identical value is not reported.
export interface ReplacedCollection {
  opIndex: number;
  path: string;
  items: number; // elements in the current collection
}

export function replacedCollections(scene: SceneDoc, ops: PatchOp[]): ReplacedCollection[] {
  const out: ReplacedCollection[] = [];
  const isCollection = (v: unknown): v is unknown[] => Array.isArray(v) && v.length > 0 && v.some((x) => x !== null && typeof x === "object" && !Array.isArray(x));
  const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
  (Array.isArray(ops) ? ops : []).forEach((op, opIndex) => {
    if (!op || (op.op !== "set" && op.op !== "merge" && op.op !== "remove") || typeof op.path !== "string") return;
    let current: unknown;
    try {
      current = getAt(scene as unknown as Parameters<typeof getAt>[0], op.path);
    } catch {
      return;
    }
    const value = op.op === "remove" ? undefined : (op as { value: unknown }).value;
    if (isCollection(current)) {
      // merge on an array replaces it (RFC 7396), like set.
      if (!same(current, value)) out.push({ opIndex, path: op.path, items: current.length });
      return;
    }
    if (!current || typeof current !== "object" || Array.isArray(current)) return;
    for (const [k, v] of Object.entries(current as Record<string, unknown>)) {
      if (!isCollection(v)) continue;
      const next = value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>)[k] : undefined;
      // merge keeps the keys it does not mention.
      if (op.op === "merge" && value && typeof value === "object" && !Array.isArray(value) && !(k in (value as object))) continue;
      if (!same(v, next)) out.push({ opIndex, path: `${op.path}.${k}`, items: v.length });
    }
  });
  return out;
}

// Applies patch ops to a copy of the scene (pure). Throws OpsError("invalid") on the first failing op.
export function applyPatchOps(scene: SceneDoc, ops: PatchOp[]): SceneDoc {
  if (!Array.isArray(ops)) throw new OpsError("invalid", "ops must be an array of patch operations.", `Ops: ${PATCH_OPS.join(", ")}.`);
  const s = clone(scene);
  if (!Array.isArray(s.objects)) s.objects = [];
  ops.forEach((op, i) => {
    if (!op || typeof op !== "object" || !(PATCH_OPS as readonly string[]).includes((op as { op: string }).op)) {
      const name = (op as { op?: unknown })?.op;
      const sug = typeof name === "string" ? closest(name, PATCH_OPS) : undefined;
      throw opError(i, op, `Unknown op ${JSON.stringify(name)}.`, `${sug ? `Did you mean "${sug}"? ` : ""}Valid ops: ${PATCH_OPS.join(", ")}.`);
    }
    try {
      applyOne(s, op, i);
    } catch (e) {
      if (e instanceof PathError) throw opError(i, op, e.message, e.hint);
      throw e;
    }
  });
  return s;
}

function applyOne(s: SceneDoc, op: PatchOp, i: number): void {
  switch (op.op) {
    case "set":
      if (op.value === undefined) throw opError(i, op, '"value" is required (use op "remove" to delete).');
      if (parsePath(op.path).length === 0) throw opError(i, op, "Empty path.");
      setAt(s, op.path, clone(op.value));
      return;
    case "merge": {
      let current: unknown;
      try {
        current = getAt(s, op.path);
      } catch {
        current = undefined;
      }
      setAt(s, op.path, mergePatch(current, op.value));
      return;
    }
    case "remove":
      if (!removeAt(s, op.path)) throw opError(i, op, `Nothing to remove at "${op.path}".`);
      return;
    case "addObject": {
      const obj = op.object;
      if (!obj || typeof obj !== "object") throw opError(i, op, '"object" must be an ObjectDef.', 'Example: { "id": "box", "kind": "mesh", "geometry": { "type": "box" } }.');
      if (!isValidId(obj.id)) throw opError(i, op, `Invalid object id ${JSON.stringify(obj.id)}.`, 'Ids start with a letter: letters, digits, "_" or "-".');
      const taken = new Set([...allObjectIds(s), ...(s.lights ?? []).map((l) => l.id).filter(Boolean)]);
      const newIds: string[] = [];
      walkObjects([obj], (o) => void newIds.push(o.id));
      const dup = newIds.find((id) => taken.has(id));
      if (dup) throw new OpsError("conflict", `Patch op #${i} (addObject) failed: id "${dup}" is already used.`, `Pick another id (e.g. "${dup}-2"), or use updateObject to change the existing one.`, { opIndex: i });
      let container = s.objects;
      if (op.parent !== undefined && op.parent !== null) {
        const parent = requireObject(s, op.parent, i, op).object;
        parent.children = parent.children ?? [];
        container = parent.children;
      }
      const idx = op.index === undefined ? container.length : Math.max(0, Math.min(container.length, Math.floor(op.index)));
      container.splice(idx, 0, clone(obj));
      return;
    }
    case "updateObject": {
      const loc = requireObject(s, op.id, i, op);
      if (!op.set || typeof op.set !== "object") throw opError(i, op, '"set" must be an object of fields to change.', 'Example: { "position": [0, 1, 0], "material": { "color": "#ff0000" } } (objects merge, null deletes).');
      const set = op.set as Record<string, unknown>;
      if ("id" in set && set.id !== op.id) throw opError(i, op, "Changing an object id is not supported by updateObject.", "Remove the object and add it again with the new id (and update timeline tracks / camera.follow).");
      if ("children" in set) throw opError(i, op, "updateObject cannot replace children.", "Use addObject with parent, removeObject or moveObject.");
      loc.container[loc.index] = mergePatch(loc.object, set) as ObjectDef;
      return;
    }
    case "removeObject": {
      const loc = requireObject(s, op.id, i, op);
      const removedIds: string[] = [];
      walkObjects([loc.object], (o) => void removedIds.push(o.id));
      loc.container.splice(loc.index, 1);
      // Drop tracks animating removed objects (they would fail validation).
      if (s.timeline?.tracks) s.timeline.tracks = s.timeline.tracks.filter((t) => !removedIds.includes(String(t.target).split(".")[0]));
      return;
    }
    case "moveObject": {
      const loc = requireObject(s, op.id, i, op);
      let target: ObjectDef[];
      if (op.parent === undefined) target = loc.container;
      else if (op.parent === null) target = s.objects;
      else {
        if (op.parent === op.id || isDescendant(loc.object, op.parent)) throw opError(i, op, "Cannot move an object into itself or one of its descendants.");
        const parent = requireObject(s, op.parent, i, op).object;
        parent.children = parent.children ?? [];
        target = parent.children;
      }
      loc.container.splice(loc.index, 1);
      const idx = op.index === undefined ? target.length : Math.max(0, Math.min(target.length, Math.floor(op.index)));
      target.splice(idx, 0, loc.object);
      return;
    }
    case "addBehaviour": {
      if (!op.behaviour || typeof op.behaviour !== "object" || typeof op.behaviour.type !== "string") throw opError(i, op, '"behaviour" must be { "type": "<catalog behaviour>", …params }.');
      const loc = findObject(s.objects, op.id);
      const lightTarget = loc ? null : (s.lights ?? []).find((l) => l.id === op.id);
      const target = loc?.object ?? lightTarget;
      if (!target) requireObject(s, op.id, i, op);
      const list = (target!.behaviours = target!.behaviours ?? []);
      // Idempotent: an identical behaviour is not added twice.
      if (!list.some((b) => deepEqual(b, op.behaviour))) list.push(clone(op.behaviour));
      return;
    }
    case "addTrack": {
      const tr = op.track;
      if (!tr || typeof tr !== "object" || typeof tr.target !== "string" || !Array.isArray(tr.keys)) throw opError(i, op, '"track" must be { "target": "<id>.<property>", "keys": [[t, v], …] }.');
      const maxT = Math.max(0, ...tr.keys.map((k) => (Array.isArray(k) && typeof k[0] === "number" ? k[0] : 0)));
      if (!s.timeline) s.timeline = { duration: Math.max(1, maxT), loop: true, tracks: [] };
      s.timeline.tracks = s.timeline.tracks ?? [];
      const copy = clone(tr);
      copy.keys = [...copy.keys].sort((a, b) => (a?.[0] ?? 0) - (b?.[0] ?? 0));
      const existing = s.timeline.tracks.findIndex((t) => t.target === tr.target);
      if (existing >= 0) s.timeline.tracks[existing] = copy;
      else s.timeline.tracks.push(copy);
      if (maxT > s.timeline.duration) s.timeline.duration = maxT;
      return;
    }
    case "removeTrack": {
      const tracks = s.timeline?.tracks ?? [];
      const idx = tracks.findIndex((t) => t.target === op.target);
      if (idx < 0) {
        const sug = closest(String(op.target), tracks.map((t) => t.target));
        throw opError(i, op, `No track targets "${op.target}".`, sug ? `Did you mean "${sug}"?` : `Existing tracks: ${tracks.map((t) => t.target).join(", ") || "none"}.`);
      }
      tracks.splice(idx, 1);
      return;
    }
  }
}

export async function patchScene(fs: ProjectFs, ops: PatchOp[], opts: { dryRun?: boolean } = {}): Promise<PatchResult> {
  const before = await readSceneFile(fs);
  const after = applyPatchOps(before, ops);
  const issues = validateScene(after);
  const plan = diffScenes(before, after);
  if (hasErrors(issues) || plan.empty || opts.dryRun) return { plan, issues, applied: false, scene: hasErrors(issues) ? before : after };
  await saveScene(fs, after);
  return { plan, issues, applied: true, scene: after };
}
