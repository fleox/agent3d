// Timeline: binds tracks ("<selector>.<path>") to property accessors on the
// built scene and applies them for a timeline-local time. Playback (triggers,
// segments, speed, markers) lives in controller.ts, camera shots in shots.ts,
// interactions in interactions.ts; the player wires them.

import * as THREE from "three";
import type { TimelineDef, TrackDef, TrackKey } from "../../core/types";
import { envScaleUniform } from "../build/materials";
import { DEG, meshMaterials } from "../util";
import { resolveKeys, sampleKeys, splitTarget, staggerOrder, type AbsKey, type ColorSpace, type Sampled } from "./sample";

export { timelineTime, sampleKeys, interpolate, splitTarget, resolveKeys, staggerOrder } from "./sample";
export { ease, easeFn, EASINGS } from "./easing";

// Model animation hooks used by "<id>.animation.<clip>.<weight|speed|time>" tracks.
export interface ClipControl {
  weight(clip: string, w: number): void;
  speed(clip: string, s: number): void;
  time(clip: string, t: number): void;
}

export interface TimelineHost {
  object(id: string): THREE.Object3D | null;
  // Ids matching a multi-target selector ("tag:x", "children:id", "a,b,c"), in order.
  select?(selector: string): string[];
  camera: { position: THREE.Vector3; target: THREE.Vector3; fov: number; zoom?: number; focus?: number } | null;
  // Environment targets (fog, background, lighting intensity, exposure).
  scene?: THREE.Scene;
  renderer?: THREE.WebGLRenderer | null;
  // Post effect params: postfx.<type>.<param>.
  postfx?: { set(type: string, param: string, value: unknown): void; base(type: string, param: string): number | string | undefined };
  clips?(id: string): ClipControl | undefined;
  issue(code: string, message: string, path?: string): void;
  seed?: number;
}

type Setter = (v: Sampled) => void;
export interface Accessor {
  get(): Sampled | undefined;
  set: Setter;
}

function vecOf(v: Sampled): [number, number, number] | null {
  if (Array.isArray(v)) return v;
  if (typeof v === "number") return [v, v, v];
  return null;
}

function vecAccessor(vec: THREE.Vector3 | THREE.Euler, axis: string, k = 1): Accessor {
  const rec = vec as unknown as Record<string, number>;
  if (axis) {
    if (axis !== "x" && axis !== "y" && axis !== "z") return { get: () => undefined, set: () => undefined };
    return {
      get: () => rec[axis] / k,
      set: (v) => {
        if (typeof v === "number") rec[axis] = v * k;
      },
    };
  }
  return {
    get: () => [rec.x / k, rec.y / k, rec.z / k],
    set: (v) => {
      const a = vecOf(v);
      if (a) vec.set(a[0] * k, a[1] * k, a[2] * k);
    },
  };
}

function colorAccessor(c: () => THREE.Color | null | undefined): Accessor {
  return {
    get: () => c()?.clone(),
    set: (v) => {
      const cur = c();
      if (cur && v instanceof THREE.Color) cur.copy(v);
    },
  };
}

function numAccessor(rec: Record<string, unknown>, key: string, k = 1): Accessor {
  return {
    get: () => (typeof rec[key] === "number" ? (rec[key] as number) / k : undefined),
    set: (v) => {
      if (typeof v === "number") rec[key] = v * k;
      else if (typeof v === "boolean" && typeof rec[key] === "boolean") rec[key] = v;
    },
  };
}

function materialAccessor(obj: THREE.Object3D, prop: string): Accessor {
  let mats: THREE.Material[] | null = null;
  const all = () => (mats ??= meshMaterials(obj));
  if (prop.startsWith("uniforms.")) {
    const name = prop.slice(9);
    return {
      get() {
        const u = (all()[0] as THREE.ShaderMaterial | undefined)?.uniforms?.[name];
        if (!u) return undefined;
        if (u.value instanceof THREE.Color) return u.value.clone();
        if (u.value instanceof THREE.Vector3) return [u.value.x, u.value.y, u.value.z];
        return typeof u.value === "number" ? u.value : undefined;
      },
      set(v) {
        for (const m of all()) {
          const u = (m as THREE.ShaderMaterial).uniforms?.[name];
          if (!u) continue;
          if (v instanceof THREE.Color) {
            if (u.value instanceof THREE.Color) u.value.copy(v);
          } else if (Array.isArray(v) && u.value?.set) u.value.set(...v);
          else u.value = v;
        }
      },
    };
  }
  if (prop === "envMapIntensity") {
    // three ignores material.envMapIntensity under scene.environment: drive the env-scale patch.
    const lit = () => all().filter((m): m is THREE.MeshStandardMaterial => (m as THREE.MeshStandardMaterial).isMeshStandardMaterial);
    return {
      get: () => {
        const m = lit()[0];
        return m ? envScaleUniform(m).value : undefined;
      },
      set: (v) => {
        if (typeof v === "number") for (const m of lit()) envScaleUniform(m).value = v;
      },
    };
  }
  if (prop === "anisotropyRotation" || prop === "iridescenceIOR") {
    const k = prop === "anisotropyRotation" ? DEG : 1; // degrees in scenes, radians in three
    return {
      get() {
        const cur = (all()[0] as unknown as Record<string, unknown> | undefined)?.[prop];
        return typeof cur === "number" ? cur / k : undefined;
      },
      set(v) {
        if (typeof v !== "number") return;
        for (const m of all()) if (prop in m) (m as unknown as Record<string, number>)[prop] = v * k;
      },
    };
  }
  return {
    get() {
      const cur = (all()[0] as unknown as Record<string, unknown> | undefined)?.[prop];
      if (cur instanceof THREE.Color) return cur.clone();
      return typeof cur === "number" || typeof cur === "boolean" ? cur : undefined;
    },
    set(v) {
      for (const m of all()) {
        const rec = m as unknown as Record<string, unknown>;
        const cur = rec[prop];
        if (cur instanceof THREE.Color) {
          if (v instanceof THREE.Color) cur.copy(v);
        } else if ((typeof v === "number" || typeof v === "boolean") && prop in rec) {
          rec[prop] = v;
          if (prop === "opacity" && typeof v === "number" && v < 1 && !m.transparent) {
            m.transparent = true;
            m.needsUpdate = true;
          }
        }
      }
    },
  };
}

function morphAccessor(obj: THREE.Object3D, name: string): Accessor {
  let targets: { m: THREE.Mesh; i: number }[] | null = null;
  const all = () => {
    if (!targets) {
      targets = [];
      obj.traverse((o) => {
        const m = o as THREE.Mesh;
        const i = m.morphTargetDictionary?.[name];
        if (m.isMesh && i !== undefined && m.morphTargetInfluences) targets!.push({ m, i });
      });
    }
    return targets;
  };
  return {
    get: () => {
      const t = all()[0];
      return t ? t.m.morphTargetInfluences![t.i] : undefined;
    },
    set: (v) => {
      if (typeof v === "number") for (const t of all()) t.m.morphTargetInfluences![t.i] = v;
    },
  };
}

const NONE: Accessor = { get: () => undefined, set: () => undefined };

// Accessor of one property of one target id (no selectors).
export function bindProperty(id: string, path: string, host: TimelineHost, where = path): Accessor | null {
  const bad = (msg: string) => {
    host.issue("timeline-target", msg, where);
    return null;
  };
  if (id === "camera") {
    const cam = host.camera;
    if (!cam) return null;
    if (path.startsWith("position")) return vecAccessor(cam.position, path.slice(9));
    if (path.startsWith("target")) return vecAccessor(cam.target, path.slice(7));
    if (path === "fov" || path === "zoom" || path === "focus") return numAccessor(cam as unknown as Record<string, unknown>, path);
    return bad(`Camera property "${path}" is not animatable`);
  }
  if (id === "environment") {
    const scene = host.scene;
    if (!scene) return null;
    switch (path) {
      case "fog.color":
        return colorAccessor(() => scene.fog?.color);
      case "fog.near":
      case "fog.far":
      case "fog.density":
        return { get: () => (scene.fog as unknown as Record<string, number> | null)?.[path.slice(4)], set: (v) => scene.fog && typeof v === "number" && ((scene.fog as unknown as Record<string, number>)[path.slice(4)] = v) };
      case "lightingIntensity":
        return numAccessor(scene as unknown as Record<string, unknown>, "environmentIntensity");
      case "background":
        return colorAccessor(() => (scene.background instanceof THREE.Color ? scene.background : null));
      case "exposure":
        return host.renderer ? numAccessor(host.renderer as unknown as Record<string, unknown>, "toneMappingExposure") : NONE;
    }
    return bad(`Environment property "${path}" is not animatable`);
  }
  if (id === "postfx") {
    const [type, param] = path.split(".");
    const fx = host.postfx;
    if (!type || !param) return bad(`Post effect track "${path}" must be "postfx.<type>.<param>"`);
    let cur: Sampled | undefined;
    return {
      get: () => {
        if (cur !== undefined) return cur;
        const b = fx?.base(type, param);
        return typeof b === "number" ? b : undefined;
      },
      set: (v) => {
        cur = v;
        fx?.set(type, param, v instanceof THREE.Color ? `#${v.getHexString()}` : v);
      },
    };
  }
  const obj = host.object(id);
  if (!obj) return bad(`Timeline track targets unknown object "${id}"`);
  const [head, ...rest] = path.split(".");
  const sub = rest.join(".");
  switch (head) {
    case "position":
      return vecAccessor(obj.position, sub);
    case "rotation":
      return vecAccessor(obj.rotation, sub, DEG);
    case "scale":
      return vecAccessor(obj.scale, sub);
    case "visible":
      return { get: () => obj.visible, set: (v) => (obj.visible = typeof v === "boolean" ? v : typeof v === "number" ? v > 0.5 : obj.visible) };
    case "material":
      return materialAccessor(obj, sub);
    case "morph":
      return morphAccessor(obj, sub);
    case "animation": {
      const clips = host.clips?.(id);
      const prop = rest[rest.length - 1];
      const clip = rest.slice(0, -1).join(".");
      if (!clips) return bad(`"${id}" has no animation clips (animation tracks need a model with clips)`);
      if (!clip || !["weight", "speed", "time"].includes(prop)) return bad(`Animation track "${path}" must be "animation.<clip>.weight|speed|time"`);
      return { get: () => (prop === "weight" ? 0 : prop === "speed" ? 1 : 0), set: (v) => typeof v === "number" && clips[prop as "weight"](clip, v) };
    }
    case "target": {
      const lt = (obj as THREE.DirectionalLight).target;
      if (lt) return vecAccessor(lt.position, sub);
      break;
    }
    case "angle":
      if ((obj as THREE.SpotLight).isSpotLight) return numAccessor(obj as unknown as Record<string, unknown>, "angle", DEG);
      break;
  }
  // Light props (intensity, color, penumbra, distance, …) or any numeric / colour property.
  const rec = obj as unknown as Record<string, unknown>;
  if (!(head in rec)) return bad(`Unknown property "${path}" on "${id}"`);
  return {
    get() {
      const cur = rec[head];
      if (cur instanceof THREE.Color) return cur.clone();
      if (cur instanceof THREE.Vector3) return vecAccessor(cur, sub).get();
      return typeof cur === "number" || typeof cur === "boolean" ? cur : undefined;
    },
    set(v) {
      const cur = rec[head];
      if (cur instanceof THREE.Color && v instanceof THREE.Color) cur.copy(v);
      else if (cur instanceof THREE.Vector3) vecAccessor(cur, sub).set(v);
      else if (typeof cur === "number" && typeof v === "number") rec[head] = v;
      else if (typeof cur === "boolean" && typeof v === "boolean") rec[head] = v;
    },
  };
}

const SPECIAL = new Set(["camera", "environment", "postfx"]);

// Ids a selector stands for.
export function selectIds(selector: string, host: TimelineHost): string[] {
  if (SPECIAL.has(selector)) return [selector];
  if (selector.includes(",") || selector.startsWith("tag:") || selector.startsWith("children:")) {
    if (host.select) return host.select(selector);
    return selector.split(",").map((s) => s.trim()).filter(Boolean);
  }
  return [selector];
}

// One bound target of a track (multi-target selectors bind one per id).
export interface BoundTrack {
  id: string;
  keys: AbsKey[];
  ease?: string;
  colorSpace?: ColorSpace;
  set: Setter;
}

// Binds a track: resolves the selector, relative values (against each
// target's rest value) and the stagger offsets.
export function bindTrack(track: TrackDef, host: TimelineHost): BoundTrack[] {
  const { id: selector, path } = splitTarget(track.target);
  const ids = selectIds(selector, host);
  if (!ids.length) {
    host.issue("timeline-target", `Track selector "${selector}" matches no object`, `timeline.tracks[${track.target}]`);
    return [];
  }
  const order = staggerOrder(ids.length, track.staggerFrom, host.seed ?? 1);
  const stagger = typeof track.stagger === "number" ? track.stagger : 0;
  const out: BoundTrack[] = [];
  ids.forEach((id, i) => {
    const acc = bindProperty(id, path, host, `timeline.tracks[${track.target}]`);
    if (!acc) return;
    let keys = resolveKeys(track.keys as TrackKey[], acc.get());
    const offset = stagger * order[i];
    if (offset) keys = keys.map((k) => [k[0] + offset, k[1], k[2]] as AbsKey);
    out.push({ id, keys, ease: track.ease, colorSpace: track.colorSpace, set: acc.set });
  });
  return out;
}

export interface TimelineRunner {
  def: TimelineDef;
  // Apply at timeline-local time.
  apply(localT: number): void;
  // Object ids the timeline animates (reset to rest each frame).
  targets: Set<string>;
  // True when a track animates the camera.
  animatesCamera: boolean;
}

export function createTimeline(def: TimelineDef, host: TimelineHost): TimelineRunner {
  const bound = (def.tracks ?? []).flatMap((tr) => bindTrack(tr, host));
  const targets = new Set(bound.map((b) => b.id).filter((id) => !SPECIAL.has(id)));
  return {
    def,
    targets,
    animatesCamera: bound.some((b) => b.id === "camera"),
    apply(localT) {
      for (const b of bound) {
        const v = sampleKeys(b.keys, localT, b.ease, b.colorSpace);
        if (v !== undefined) b.set(v);
      }
    },
  };
}
