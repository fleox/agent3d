// Timeline: binds tracks ("<id>.<path>") to setters on the built scene and
// applies them for a timeline-local time. Trigger logic (load / visible /
// hover / click / scroll) lives in the player, which turns its clock into a
// local time with `timelineTime`.

import * as THREE from "three";
import type { TimelineDef, TrackDef } from "../../core/types";
import { DEG, meshMaterials } from "../util";
import { sampleKeys, splitTarget, type Sampled } from "./sample";

export { timelineTime, sampleKeys, interpolate, splitTarget } from "./sample";
export { ease, EASINGS } from "./easing";

export interface TimelineHost {
  object(id: string): THREE.Object3D | null;
  camera: { position: THREE.Vector3; target: THREE.Vector3; fov: number } | null;
  issue(code: string, message: string, path?: string): void;
}

type Setter = (v: Sampled) => void;

function vecOf(v: Sampled): [number, number, number] | null {
  if (Array.isArray(v)) return v;
  if (typeof v === "number") return [v, v, v];
  return null;
}

function setVector(vec: THREE.Vector3 | THREE.Euler, axis: string, v: Sampled, k = 1): void {
  if (axis) {
    if (typeof v === "number" && (axis === "x" || axis === "y" || axis === "z")) (vec as unknown as Record<string, number>)[axis] = v * k;
    return;
  }
  const a = vecOf(v);
  if (a) vec.set(a[0] * k, a[1] * k, a[2] * k);
}

function setMaterialProp(mats: THREE.Material[], prop: string, v: Sampled): void {
  for (const m of mats) {
    const rec = m as unknown as Record<string, unknown>;
    if (prop.startsWith("uniforms.")) {
      const u = (m as THREE.ShaderMaterial).uniforms?.[prop.slice(9)];
      if (!u) continue;
      if (v instanceof THREE.Color) {
        if (u.value instanceof THREE.Color) u.value.copy(v);
      } else if (Array.isArray(v) && u.value?.set) u.value.set(...v);
      else u.value = v;
      continue;
    }
    const cur = rec[prop];
    if (cur instanceof THREE.Color) {
      if (v instanceof THREE.Color) cur.copy(v);
    } else if (typeof v === "number" || typeof v === "boolean") {
      if (prop in rec) {
        rec[prop] = v;
        if (prop === "opacity" && typeof v === "number" && v < 1 && !m.transparent) {
          m.transparent = true;
          m.needsUpdate = true;
        }
      }
    }
  }
}

export function bindTrack(track: TrackDef, host: TimelineHost): Setter | null {
  const { id, path } = splitTarget(track.target);
  if (id === "camera") {
    const cam = host.camera;
    if (!cam) return null;
    if (path.startsWith("position")) return (v) => setVector(cam.position, path.slice(9), v);
    if (path.startsWith("target")) return (v) => setVector(cam.target, path.slice(7), v);
    if (path === "fov") return (v) => typeof v === "number" && (cam.fov = v);
    return null;
  }
  const obj = host.object(id);
  if (!obj) {
    host.issue("timeline-target", `Timeline track targets unknown object "${id}"`, `timeline.tracks[${track.target}]`);
    return null;
  }
  const [head, ...rest] = path.split(".");
  const sub = rest.join(".");
  switch (head) {
    case "position":
      return (v) => setVector(obj.position, sub, v);
    case "rotation":
      return (v) => setVector(obj.rotation, sub, v, DEG);
    case "scale":
      return (v) => setVector(obj.scale, sub, v);
    case "visible":
      return (v) => (obj.visible = typeof v === "boolean" ? v : typeof v === "number" ? v > 0.5 : obj.visible);
    case "material": {
      let mats: THREE.Material[] | null = null;
      return (v) => {
        mats ??= meshMaterials(obj);
        setMaterialProp(mats, sub, v);
      };
    }
    default: {
      // Light props (intensity, color, …) or any numeric/colour property of the object.
      const rec = obj as unknown as Record<string, unknown>;
      if (!(head in rec)) {
        host.issue("timeline-target", `Unknown property "${path}" on "${id}"`, `timeline.tracks[${track.target}]`);
        return null;
      }
      return (v) => {
        const cur = rec[head];
        if (cur instanceof THREE.Color && v instanceof THREE.Color) cur.copy(v);
        else if (cur instanceof THREE.Vector3) setVector(cur, sub, v);
        else if (typeof cur === "number" && typeof v === "number") rec[head] = v;
        else if (typeof cur === "boolean" && typeof v === "boolean") rec[head] = v;
      };
    }
  }
}

export interface TimelineRunner {
  def: TimelineDef;
  // Apply at timeline-local time.
  apply(localT: number): void;
  // Object ids the timeline animates (reset to rest each frame).
  targets: Set<string>;
}

export function createTimeline(def: TimelineDef, host: TimelineHost): TimelineRunner {
  const bound = def.tracks.map((tr) => ({ tr, set: bindTrack(tr, host) })).filter((b) => b.set) as { tr: TrackDef; set: Setter }[];
  const targets = new Set(def.tracks.map((t) => splitTarget(t.target).id));
  return {
    def,
    targets,
    apply(localT) {
      for (const { tr, set } of bound) {
        const v = sampleKeys(tr.keys, localT, tr.ease);
        if (v !== undefined) set(v);
      }
    },
  };
}
