// Typed reader over untyped catalog params: every value falls back to the
// default declared in src/core/catalog.ts (never duplicated here).

import * as THREE from "three";
import { GENERATORS, SHADERS, type CatalogEntry } from "../../core/catalog";
import type { BuildContext } from "../registry";

export interface Params {
  num(name: string): number;
  // null when the scene explicitly sets the param to null (e.g. "no water").
  numOrNull(name: string): number | null;
  int(name: string): number;
  bool(name: string): boolean;
  str<T extends string = string>(name: string): T;
  color(name: string): THREE.Color;
  colors(name: string): THREE.Color[];
  vec3(name: string): [number, number, number];
  raw(name: string): unknown;
}

const toColor = (ctx: Pick<BuildContext, "color"> | undefined, c: string): THREE.Color => {
  try {
    return ctx ? ctx.color(c).clone() : new THREE.Color(c);
  } catch {
    return new THREE.Color(c);
  }
};

export function readParams(entry: CatalogEntry, raw: Record<string, unknown> | undefined, ctx?: Pick<BuildContext, "color">): Params {
  const values = raw ?? {};
  const spec = (name: string) => {
    const s = entry.params.find((p) => p.name === name);
    if (!s) throw new Error(`${entry.id}: no catalog param "${name}"`);
    return s;
  };
  const get = (name: string): unknown => {
    const s = spec(name);
    const v = values[name];
    return v === undefined ? s.default : v;
  };
  const clamp = (name: string, v: number): number => {
    const s = spec(name);
    if (s.min !== undefined && v < s.min) v = s.min;
    if (s.max !== undefined && v > s.max) v = s.max;
    return v;
  };
  const num = (name: string): number => {
    let v = get(name);
    if (typeof v === "string") v = Number(v);
    if (typeof v !== "number" || !Number.isFinite(v)) v = spec(name).default;
    return clamp(name, typeof v === "number" ? v : 0);
  };
  return {
    num,
    numOrNull: (name) => (values[name] === null ? null : num(name)),
    int: (name) => Math.round(num(name)),
    bool: (name) => {
      const v = get(name);
      return typeof v === "boolean" ? v : Boolean(spec(name).default);
    },
    str: <T extends string>(name: string) => {
      const s = spec(name);
      const v = get(name);
      if (typeof v === "string" && (!s.options || s.options.includes(v))) return v as T;
      return s.default as T;
    },
    color: (name) => {
      const v = get(name);
      return toColor(ctx, typeof v === "string" ? v : String(spec(name).default ?? "#ffffff"));
    },
    colors: (name) => {
      let v = get(name);
      if (typeof v === "string") v = [v];
      if (!Array.isArray(v) || v.length === 0) v = spec(name).default as unknown[];
      return (v as unknown[]).map((c) => toColor(ctx, typeof c === "string" ? c : "#ffffff"));
    },
    vec3: (name) => {
      const v = get(name);
      const d = (spec(name).default as [number, number, number] | undefined) ?? [0, 0, 0];
      if (!Array.isArray(v)) return [...d];
      return [0, 1, 2].map((k) => (typeof v[k] === "number" ? (v[k] as number) : d[k]!)) as [number, number, number];
    },
    raw: (name) => get(name),
  };
}

const byId = (list: CatalogEntry[], id: string): CatalogEntry => {
  const e = list.find((x) => x.id === id);
  if (!e) throw new Error(`unknown catalog id ${id}`);
  return e;
};

export const generatorParams = (id: string, raw: Record<string, unknown>, ctx?: Pick<BuildContext, "color">): Params => readParams(byId(GENERATORS, id), raw, ctx);
export const shaderParams = (id: string, raw: Record<string, unknown>, ctx?: Pick<BuildContext, "color">): Params => readParams(byId(SHADERS, id), raw, ctx);
