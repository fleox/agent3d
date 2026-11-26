// Small shared helpers of the runtime core (no DOM).

import * as THREE from "three";
import type { CatalogEntry } from "../core/catalog";
import type { Color, Vec3 } from "../core/types";

import { clamp } from "./num";

export { DEG, clamp, lerp, num } from "./num";

export function bool(v: unknown, def: boolean): boolean {
  return typeof v === "boolean" ? v : def;
}

export function str(v: unknown, def: string): string {
  return typeof v === "string" ? v : def;
}

export function vec3(v: unknown, def: Vec3): Vec3 {
  if (Array.isArray(v) && v.length >= 3 && v.every((x) => typeof x === "number")) return [v[0], v[1], v[2]];
  return def;
}

export function colors(v: unknown, def: string[]): string[] {
  if (typeof v === "string") return [v];
  if (Array.isArray(v) && v.length && v.every((x) => typeof x === "string")) return v as string[];
  return def;
}

// CSS colour string → THREE.Color (in the working, linear colour space).
const colorCache = new Map<string, THREE.Color>();
export function toColor(c: Color | undefined | null, fallback = "#ffffff"): THREE.Color {
  const key = typeof c === "string" && c ? c : fallback;
  let col = colorCache.get(key);
  if (!col) {
    col = new THREE.Color();
    try {
      col.setStyle(key);
    } catch {
      col.setStyle(fallback);
    }
    if (colorCache.size > 512) colorCache.clear();
    colorCache.set(key, col);
  }
  return col.clone();
}

// Merge a catalog entry's parameter defaults under the given values.
export function withDefaults(entry: CatalogEntry | undefined, values: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (entry) for (const p of entry.params) if (p.default !== undefined) out[p.name] = p.default;
  for (const [k, v] of Object.entries(values)) if (v !== undefined) out[k] = v;
  return out;
}

// Exponential smoothing factor that is frame-rate independent:
// smoothing 0 = instant, 0.95 = very smooth (per 1/60 s frame).
export function smoothFactor(smoothing: number, dt: number): number {
  const s = clamp(smoothing, 0, 0.999);
  if (s <= 0) return 1;
  return 1 - Math.pow(s, dt * 60);
}

// Deterministic hash → [0,1) used where a full RNG is overkill.
export function hash1(n: number): number {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453123;
  return x - Math.floor(x);
}

export function disposeObject(root: THREE.Object3D): void {
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.geometry) m.geometry.dispose();
    const mat = m.material as THREE.Material | THREE.Material[] | undefined;
    if (mat) for (const x of Array.isArray(mat) ? mat : [mat]) disposeMaterial(x);
  });
}

export function disposeMaterial(m: THREE.Material): void {
  for (const v of Object.values(m)) if (v instanceof THREE.Texture) v.dispose();
  m.dispose();
}

export function meshMaterials(root: THREE.Object3D): THREE.Material[] {
  const out = new Set<THREE.Material>();
  root.traverse((o) => {
    const mat = (o as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
    if (!mat || o.userData.depthTwin) return; // text reveal depth twins (build/text.ts) share one internal material
    for (const x of Array.isArray(mat) ? mat : [mat]) out.add(x);
  });
  return [...out];
}
