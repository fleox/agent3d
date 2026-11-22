// Timeline helpers (pure): which properties can be keyed, current values,
// key insertion / moves.

import { getAt } from "../../core/jsonPath";
import type { KeyValue, ObjectDef, SceneDoc, TrackDef } from "../../core/types";
import { findObject } from "../../ops/tree";

export const OBJECT_TRACK_PROPS = ["position", "rotation", "scale", "visible", "material.opacity", "material.color", "material.emissiveIntensity"] as const;
export const CAMERA_TRACK_PROPS = ["camera.position", "camera.target", "camera.fov"] as const;
export const LIGHT_TRACK_PROPS = ["intensity", "color"] as const;

const DEFAULTS: Record<string, KeyValue> = {
  position: [0, 0, 0],
  rotation: [0, 0, 0],
  scale: 1,
  visible: true,
  "material.opacity": 1,
  "material.color": "#ffffff",
  "material.emissiveIntensity": 1,
  "camera.target": [0, 0, 0],
  "camera.fov": 45,
  intensity: 1,
  color: "#ffffff",
};

function readPath(obj: unknown, path: string): unknown {
  try {
    return getAt(obj as never, path);
  } catch {
    return undefined;
  }
}

// Splits "logo.material.color" → { id: "logo", prop: "material.color" }; camera tracks keep "camera".
export function splitTarget(target: string): { id: string; prop: string } {
  const dot = target.indexOf(".");
  return dot < 0 ? { id: target, prop: "" } : { id: target.slice(0, dot), prop: target.slice(dot + 1) };
}

// The value a key added now would hold: the property as the scene declares it.
export function currentValue(scene: SceneDoc, target: string): KeyValue | undefined {
  const { id, prop } = splitTarget(target);
  if (id === "camera") {
    const v = readPath(scene.camera, prop);
    return (v as KeyValue | undefined) ?? DEFAULTS[target];
  }
  const obj: ObjectDef | undefined = findObject(scene.objects, id)?.object;
  const src: unknown = obj ?? (scene.lights ?? []).find((l) => l.id === id);
  if (!src) return undefined;
  // Axis tracks: position.x → position[0]
  const axis = /^(position|rotation|scale)\.([xyz])$/.exec(prop);
  if (axis) {
    const base = readPath(src, axis[1]);
    const i = "xyz".indexOf(axis[2]);
    if (Array.isArray(base)) return base[i] as number;
    if (typeof base === "number") return base;
    return axis[1] === "scale" ? 1 : 0;
  }
  let v = readPath(src, prop);
  if (prop === "scale" && Array.isArray(v)) v = v[0];
  return (v as KeyValue | undefined) ?? DEFAULTS[prop];
}

const EPS = 1e-3;
const round = (t: number) => Math.round(t * 1000) / 1000;

// Adds (or replaces, within 1 ms) a key at time t; keys stay sorted.
export function upsertKey(track: TrackDef, t: number, value: KeyValue): TrackDef {
  const time = round(Math.max(0, t));
  const prev = track.keys.find((k) => Math.abs(k[0] - time) <= EPS);
  const keys = track.keys.filter((k) => Math.abs(k[0] - time) > EPS);
  keys.push(prev?.length === 3 ? [time, value, prev[2]] : [time, value]);
  keys.sort((a, b) => a[0] - b[0]);
  return { ...track, keys };
}

// Moves key `index` to time t; returns the new track and the key's new index.
export function moveKey(track: TrackDef, index: number, t: number): { track: TrackDef; index: number } {
  const key = track.keys[index];
  if (!key) return { track, index };
  const moved: TrackDef["keys"][number] = key.length === 3 ? [round(Math.max(0, t)), key[1], key[2]] : [round(Math.max(0, t)), key[1]];
  const rest = track.keys.filter((_, i) => i !== index);
  rest.push(moved);
  rest.sort((a, b) => a[0] - b[0]);
  return { track: { ...track, keys: rest }, index: rest.indexOf(moved) };
}

export function removeKey(track: TrackDef, index: number): TrackDef {
  return { ...track, keys: track.keys.filter((_, i) => i !== index) };
}

// Snaps to a grid step (e.g. 0.05 s) unless `free`.
export function snapTime(t: number, step = 0.05, free = false): number {
  return free ? round(t) : round(Math.round(t / step) * step);
}

// Ruler ticks for a duration: a step that gives 6–16 major ticks.
export function rulerStep(duration: number): number {
  for (const s of [0.1, 0.25, 0.5, 1, 2, 5, 10, 30, 60]) if (duration / s <= 16) return s;
  return 120;
}
