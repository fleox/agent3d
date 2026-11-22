// Pure keyframe sampling. Numbers and vec3 interpolate through the segment's
// easing (the key's own ease, else the track ease), colours interpolate in
// linear space, booleans step (hold the last key reached). Relative values
// ("+=1", "-=0.5", "*=2") are resolved against a base with `resolveKeys`.

import * as THREE from "three";
import type { KeyValue, TimelineDef, TrackKey } from "../../core/types";
import { ease } from "./easing";

export type Sampled = number | [number, number, number] | THREE.Color | boolean;
// A key whose value is absolute (no relative strings except colours).
export type AbsKey = [number, number | [number, number, number] | string | boolean, string?];

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
export function parseColor(s: string): THREE.Color {
  let c = colorCache.get(s);
  if (!c) {
    c = new THREE.Color();
    try {
      c.setStyle(s);
    } catch {
      c.set(0xffffff);
    }
    if (colorCache.size < 1000) colorCache.set(s, c);
  }
  return c;
}

const REL = /^\s*([+\-*])=\s*(-?\d*\.?\d+(?:e[+-]?\d+)?)\s*$/i;

export function isRelative(v: unknown): v is string {
  return typeof v === "string" && REL.test(v);
}

function relNum(v: unknown, base: number): number {
  if (typeof v === "number") return v;
  const m = typeof v === "string" ? REL.exec(v) : null;
  if (!m) return base;
  const x = Number(m[2]);
  return m[1] === "+" ? base + x : m[1] === "-" ? base - x : base * x;
}

// Resolves relative values against `base` (the property's rest value).
export function resolveKeys(keys: TrackKey[], base: Sampled | undefined): AbsKey[] {
  const bv: [number, number, number] | null = Array.isArray(base) ? base : typeof base === "number" ? [base, base, base] : null;
  const bn = typeof base === "number" ? base : Array.isArray(base) ? base[0] : 0;
  return keys.map((k) => {
    const [t, v, e] = k as [number, KeyValue, string?];
    let out: AbsKey[1];
    if (Array.isArray(v)) out = [relNum(v[0], bv?.[0] ?? 0), relNum(v[1], bv?.[1] ?? 0), relNum(v[2], bv?.[2] ?? 0)];
    else if (isRelative(v)) {
      // A relative scalar on a vec3 property applies to every axis.
      out = bv && Array.isArray(base) ? [relNum(v, bv[0]), relNum(v, bv[1]), relNum(v, bv[2])] : relNum(v, bn);
    } else out = v as AbsKey[1];
    return e === undefined ? [t, out] : [t, out, e];
  });
}

function asVec(v: AbsKey[1]): [number, number, number] | null {
  if (Array.isArray(v)) return [Number(v[0]) || 0, Number(v[1]) || 0, Number(v[2]) || 0];
  if (typeof v === "number") return [v, v, v];
  return null;
}

export function interpolate(a: AbsKey[1], b: AbsKey[1], k: number): Sampled {
  if (typeof a === "boolean" || typeof b === "boolean") return k >= 1 ? (b as boolean) : (a as boolean);
  if (typeof a === "number" && typeof b === "number") return a + (b - a) * k;
  if (typeof a === "string" || typeof b === "string") {
    const ca = parseColor(String(a)), cb = parseColor(String(b));
    return ca.clone().lerp(cb, k);
  }
  const va = asVec(a)!, vb = asVec(b)!;
  return [va[0] + (vb[0] - va[0]) * k, va[1] + (vb[1] - va[1]) * k, va[2] + (vb[2] - va[2]) * k];
}

function toSampled(v: AbsKey[1]): Sampled {
  if (typeof v === "string") return parseColor(v).clone();
  if (Array.isArray(v)) return [v[0], v[1], v[2]];
  return v;
}

export function sampleKeys(keys: AbsKey[] | TrackKey[], t: number, easeName?: string): Sampled | undefined {
  const ks = keys as AbsKey[];
  if (!ks.length) return undefined;
  if (t <= ks[0][0]) return toSampled(ks[0][1]);
  const last = ks[ks.length - 1];
  if (t >= last[0]) return toSampled(last[1]);
  for (let i = 0; i < ks.length - 1; i++) {
    const [t0, v0] = ks[i];
    const [t1, v1, e1] = ks[i + 1];
    if (t >= t0 && t < t1) {
      if (typeof v0 === "boolean" || typeof v1 === "boolean") return v0 as boolean;
      const k = t1 > t0 ? ease(e1 ?? easeName ?? "linear", (t - t0) / (t1 - t0)) : 1;
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

// Stagger order: index of each of `n` targets in the stagger sequence.
export function staggerOrder(n: number, from: string | undefined, seed = 1): number[] {
  const idx = Array.from({ length: n }, (_, i) => i);
  switch (from) {
    case "end":
      return idx.map((i) => n - 1 - i);
    case "center": {
      const c = (n - 1) / 2;
      return idx.map((i) => Math.abs(i - c));
    }
    case "edges": {
      const c = (n - 1) / 2;
      return idx.map((i) => c - Math.abs(i - c));
    }
    case "random": {
      // Seeded Fisher-Yates.
      const order = [...idx];
      let s = (seed * 2654435761) >>> 0 || 1;
      for (let i = n - 1; i > 0; i--) {
        s = (s * 1664525 + 1013904223) >>> 0;
        const j = s % (i + 1);
        [order[i], order[j]] = [order[j], order[i]];
      }
      const pos = new Array<number>(n);
      order.forEach((target, k) => (pos[target] = k));
      return pos;
    }
    default:
      return idx;
  }
}
