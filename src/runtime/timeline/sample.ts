// Pure keyframe sampling. Numbers and vec3 interpolate linearly through the
// track's easing (per segment), colours interpolate in linear space,
// booleans step (hold the last key reached).

import * as THREE from "three";
import type { EaseName, KeyValue, TimelineDef } from "../../core/types";
import { ease } from "./easing";

export type Sampled = number | [number, number, number] | THREE.Color | boolean;

// Timeline-local time for a running clock `t`.
export function timelineTime(t: number, duration: number, loop: TimelineDef["loop"]): number {
  if (duration <= 0) return 0;
  if (t <= 0) return 0;
  if (loop === "pingpong") {
    const c = t % (2 * duration);
    return c <= duration ? c : 2 * duration - c;
  }
  if (loop) return t % duration;
  return Math.min(t, duration);
}

const colorCache = new Map<string, THREE.Color>();
function parseColor(s: string): THREE.Color {
  let c = colorCache.get(s);
  if (!c) {
    c = new THREE.Color();
    try {
      c.setStyle(s);
    } catch {
      c.set(0xffffff);
    }
    colorCache.set(s, c);
  }
  return c;
}

function asVec(v: KeyValue): [number, number, number] | null {
  if (Array.isArray(v)) return [Number(v[0]) || 0, Number(v[1]) || 0, Number(v[2]) || 0];
  if (typeof v === "number") return [v, v, v];
  return null;
}

export function interpolate(a: KeyValue, b: KeyValue, k: number): Sampled {
  if (typeof a === "boolean" || typeof b === "boolean") return k >= 1 ? (b as boolean) : (a as boolean);
  if (typeof a === "number" && typeof b === "number") return a + (b - a) * k;
  if (typeof a === "string" || typeof b === "string") {
    const ca = parseColor(String(a)), cb = parseColor(String(b));
    return ca.clone().lerp(cb, k);
  }
  const va = asVec(a)!, vb = asVec(b)!;
  return [va[0] + (vb[0] - va[0]) * k, va[1] + (vb[1] - va[1]) * k, va[2] + (vb[2] - va[2]) * k];
}

function toSampled(v: KeyValue): Sampled {
  if (typeof v === "string") return parseColor(v).clone();
  if (Array.isArray(v)) return [v[0], v[1], v[2]];
  return v;
}

export function sampleKeys(keys: [number, KeyValue][], t: number, easeName?: EaseName): Sampled | undefined {
  if (!keys.length) return undefined;
  if (t <= keys[0][0]) return toSampled(keys[0][1]);
  const last = keys[keys.length - 1];
  if (t >= last[0]) return toSampled(last[1]);
  for (let i = 0; i < keys.length - 1; i++) {
    const [t0, v0] = keys[i];
    const [t1, v1] = keys[i + 1];
    if (t >= t0 && t < t1) {
      if (typeof v0 === "boolean" || typeof v1 === "boolean") return v0 as boolean;
      const k = t1 > t0 ? ease(easeName ?? "linear", (t - t0) / (t1 - t0)) : 1;
      return interpolate(v0, v1, k);
    }
  }
  return toSampled(last[1]);
}

// "<id>.<path>" → { id, path }. "camera.position" → { id: "camera", path: "position" }.
export function splitTarget(target: string): { id: string; path: string } {
  const i = target.indexOf(".");
  if (i < 0) return { id: target, path: "" };
  return { id: target.slice(0, i), path: target.slice(i + 1) };
}
