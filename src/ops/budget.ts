// Triangle budget estimate from the catalog `cost` formulas
// ("segments*heightSegments*2", "20*4^detail", "~500", "count*~150") evaluated
// with the object's params (defaults from the catalog).

import { CATALOG, catalogEntry, type CatalogEntry } from "../core/catalog";
import type { ObjectDef, SceneDoc } from "../core/types";
import { walkObjects } from "./tree";

// Tiny expression evaluator: numbers, identifiers, + - * / ^, parentheses, "~" (approx, ignored).
export function evalCost(formula: string, vars: Record<string, number>): number {
  const src = formula.replace(/~/g, "");
  let i = 0;
  const peek = () => {
    while (src[i] === " ") i++;
    return src[i];
  };
  const expr = (): number => {
    let v = term();
    for (let c = peek(); c === "+" || c === "-"; c = peek()) {
      i++;
      v = c === "+" ? v + term() : v - term();
    }
    return v;
  };
  const term = (): number => {
    let v = power();
    for (let c = peek(); c === "*" || c === "/"; c = peek()) {
      i++;
      const r = power();
      v = c === "*" ? v * r : r === 0 ? 0 : v / r;
    }
    return v;
  };
  const power = (): number => {
    const b = atom();
    if (peek() === "^") {
      i++;
      return b ** power();
    }
    return b;
  };
  const atom = (): number => {
    const c = peek();
    if (c === "(") {
      i++;
      const v = expr();
      if (peek() === ")") i++;
      return v;
    }
    if (c === "-") {
      i++;
      return -atom();
    }
    const m = /^(\d+(?:\.\d+)?)|^([A-Za-z_]\w*)/.exec(src.slice(i));
    if (!m) {
      i = src.length;
      return 0;
    }
    i += m[0].length;
    if (m[1]) return Number(m[1]);
    const v = vars[m[2]];
    return typeof v === "number" && Number.isFinite(v) ? v : 0;
  };
  const v = expr();
  return Number.isFinite(v) ? Math.max(0, Math.round(v)) : 0;
}

function paramVars(entry: CatalogEntry, params: Record<string, unknown>): Record<string, number> {
  const vars: Record<string, number> = {};
  for (const p of entry.params) {
    const v = params[p.name];
    if (typeof v === "number") vars[p.name] = v;
    else if (Array.isArray(v)) vars[p.name] = v.length;
    else if (typeof p.default === "number") vars[p.name] = p.default;
  }
  return vars;
}

export function geometryTriangles(geometry: { type?: unknown; [k: string]: unknown } | undefined): number {
  const entry = typeof geometry?.type === "string" ? catalogEntry("geometries", geometry.type) : undefined;
  if (!entry?.cost) return 0;
  return evalCost(entry.cost, paramVars(entry, geometry as Record<string, unknown>));
}

function instanceCount(layout: unknown): number {
  const l = layout as { type?: string; count?: unknown; items?: unknown[] } | undefined;
  if (!l) return 0;
  if (l.type === "grid" && Array.isArray(l.count)) return (l.count as number[]).reduce((a, b) => a * (Number(b) || 0), 1);
  if (l.type === "list") return Array.isArray(l.items) ? l.items.length : 0;
  return typeof l.count === "number" ? l.count : 0;
}

export const TRIS_PER_TEXT_CHAR = 300;

export function objectTriangles(o: ObjectDef): number {
  switch (o.kind) {
    case "mesh":
      return geometryTriangles(o.geometry);
    case "instances":
      return geometryTriangles(o.geometry) * instanceCount(o.layout);
    case "text": {
      const chars = String(o.text ?? "").replace(/\s/g, "").length;
      const flat = o.depth === 0;
      return Math.round(chars * TRIS_PER_TEXT_CHAR * (flat ? 0.35 : 1));
    }
    case "generator": {
      const entry = typeof o.generator === "string" ? catalogEntry("generators", o.generator) : undefined;
      return entry?.cost ? evalCost(entry.cost, paramVars(entry, (o.params as Record<string, unknown>) ?? {})) : 0;
    }
    case "particles":
      return (o.count ?? 200) * 2; // sprites: two triangles each (worst case)
    case "svg":
      return 2000;
    default:
      return 0; // groups; models are measured by their file size (assets) and the runtime stats
  }
}

export interface TriangleEstimate {
  total: number;
  byObject: { id: string; triangles: number }[];
}

export function estimateTriangles(scene: Pick<SceneDoc, "objects">): TriangleEstimate {
  const byObject: { id: string; triangles: number }[] = [];
  walkObjects(scene.objects, (o) => {
    if (o.visible === false) return false;
    const t = objectTriangles(o);
    if (t) byObject.push({ id: o.id, triangles: t });
  });
  byObject.sort((a, b) => b.triangles - a.triangles);
  return { total: byObject.reduce((a, b) => a + b.triangles, 0), byObject };
}

// Triangle ceilings per target kind (estimate and runtime stats).
export const TRIANGLE_LIMIT: Record<string, number> = {
  banner: 500_000,
  card: 400_000,
  square: 500_000,
  inline: 500_000,
  hero: 1_000_000,
  fullscreen: 2_000_000,
  game: 2_000_000,
};

export const DRAW_CALL_LIMIT = 150;

// Every catalog section with costs — exported for docs.
export const COSTED_SECTIONS = { geometries: CATALOG.geometries, generators: CATALOG.generators };
