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
    const v = params[p.name] !== undefined ? params[p.name] : p.default;
    if (typeof v === "number") vars[p.name] = v;
    else if (Array.isArray(v)) {
      vars[p.name] = v.length;
      // `<name>Cells`: leaf items of a nested array (bars3d grid data [[…], […]]).
      vars[`${p.name}Cells`] = v.reduce((a: number, x) => a + (Array.isArray(x) ? x.length : 1), 0);
    }
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

// 3D text, measured with the runtime (mixed-case sample "Hamburgefonstiv
// ABCDEFGHIJ"): triangles of a flat (depth 0) face per glyph and per curve
// segment. The runtime samples curves with `curveSegments` = 8 + 4 × size flat,
// 5 + 3 × size extruded (2…32, overridable). Extruding adds the side walls
// (×4.1 the face), the bevel (on by default when depth > 0) ×16.6; an outline
// adds ~4.8 faces (offset glyph layer).
export const TRIS_PER_GLYPH_SEGMENT: Record<string, number> = {
  "sans-bold": 9.9, sans: 10.4, "inter-black": 9.4, "montserrat-extrabold": 9.2, "space-grotesk-bold": 8.4, "bebas-neue": 5.1, anton: 6.5,
  "serif-bold": 18.3, serif: 18.1, mono: 8.4, display: 13.4, pacifico: 24, lobster: 14.9,
};
export const TRIS_PER_GLYPH_SEGMENT_DEFAULT = 12;

export function textCurveSegments(o: { size?: unknown; depth?: unknown; curveSegments?: unknown }): number {
  const size = typeof o.size === "number" ? o.size : 1;
  const depth = typeof o.depth === "number" ? o.depth : 0.2;
  const cs = typeof o.curveSegments === "number" ? o.curveSegments : depth > 0 ? 5 + size * 3 : 8 + size * 4;
  return Math.round(Math.max(2, Math.min(32, cs)));
}

export function textTriangles(o: { text?: unknown; font?: unknown; size?: unknown; depth?: unknown; bevel?: unknown; outline?: unknown; curveSegments?: unknown }): number {
  const chars = String(o.text ?? "").replace(/\s/g, "").length;
  const face = (TRIS_PER_GLYPH_SEGMENT[typeof o.font === "string" ? o.font : "sans-bold"] ?? TRIS_PER_GLYPH_SEGMENT_DEFAULT) * textCurveSegments(o);
  const depth = typeof o.depth === "number" ? o.depth : 0.2;
  const bevel = depth > 0 && (typeof o.bevel === "number" ? o.bevel : 1) > 0;
  const body = depth <= 0 ? 1 : bevel ? 16.6 : 4.1;
  return Math.round(chars * face * (body + (o.outline ? 4.8 : 0)));
}

// Triangles of a model file by its `src` (library index / parsed GLB), when known.
export type ModelTriangles = (src: string) => number | undefined;

export function objectTriangles(o: ObjectDef, models?: ModelTriangles): number {
  switch (o.kind) {
    case "mesh":
      return geometryTriangles(o.geometry);
    case "instances":
      return geometryTriangles(o.geometry) * instanceCount(o.layout);
    case "text":
      return textTriangles(o as unknown as Record<string, unknown>);
    case "model": {
      const src = (o as { src?: unknown }).src;
      return typeof src === "string" ? (models?.(src) ?? 0) : 0;
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
      return 0; // groups
  }
}

export interface TriangleEstimate {
  total: number;
  byObject: { id: string; triangles: number }[];
}

// Geometry triangles drawn once per frame. The runtime's stats count every
// render pass (shadow maps re-draw casters per shadow-casting light, post
// effects add full-screen quads), so measured numbers are higher: `check
// --render` prefers them.
export function estimateTriangles(scene: Pick<SceneDoc, "objects">, opts: { models?: ModelTriangles } = {}): TriangleEstimate {
  const byObject: { id: string; triangles: number }[] = [];
  walkObjects(scene.objects, (o) => {
    if (o.visible === false) return false;
    const t = objectTriangles(o, opts.models);
    if (t) byObject.push({ id: o.id, triangles: t });
  });
  byObject.sort((a, b) => b.triangles - a.triangles);
  return { total: byObject.reduce((a, b) => a + b.triangles, 0), byObject };
}

// ─── Per-frame estimate (every render pass) ─────────────────────────────
//
// What the runtime's stats count: the main pass, one shadow-map pass per
// shadow-casting light (point lights: 6 cube faces) re-drawing the casters,
// the normal / depth pre-pass of ao / dof / godrays / outline re-drawing the
// scene, and contact shadows re-drawing the casters from above. Measured on
// real scenes within ~10 %.
export interface FrameTriangleEstimate {
  perFrame: number;
  passes: { main: number; shadowMaps: number; prepass: number; contactShadows: number };
  shadowLights: number;
}

const PREPASS_EFFECTS = new Set(["ao", "dof", "godrays", "outline"]);
// `expandPostFx` expands look presets (src/core/postfx.ts expandPostFx).
export function frameTriangles(scene: Pick<SceneDoc, "objects" | "lights" | "environment" | "postfx" | "target">, geometry: TriangleEstimate, opts: { expandPostFx?: (defs: SceneDoc["postfx"]) => { type: string }[] } = {}): FrameTriangleEstimate {
  // Shadow casters: every mesh-like object unless castShadow: false (particles / generators default off,
  // generators decide themselves — counted as casters, most cast).
  const noCast = new Set<string>();
  walkObjects(scene.objects ?? [], (o) => {
    const d = o as { castShadow?: boolean; kind?: string };
    if (d.castShadow === false || d.kind === "particles") {
      noCast.add(o.id);
      if (d.castShadow === false) walkObjects(o.children ?? [], (c) => void noCast.add(c.id));
    }
  });
  const casters = geometry.byObject.filter((o) => !noCast.has(o.id)).reduce((a, o) => a + o.triangles, 0);
  const env = (scene.environment ?? {}) as { rig?: unknown; background?: unknown; contactShadows?: unknown };
  let shadowLights = 0;
  if (scene.target?.shadows !== false) {
    for (const l of scene.lights ?? []) if ((l as { castShadow?: boolean }).castShadow && ["directional", "spot", "point"].includes(l.type)) shadowLights += l.type === "point" ? 6 : 1;
    const rig = env.rig as { castShadow?: boolean } | string | undefined;
    if (rig && (typeof rig === "string" || rig.castShadow !== false)) shadowLights += 1;
    const sky = env.background && typeof env.background === "object" ? (env.background as { sky?: { physical?: boolean; preset?: string; sun?: false | { light?: boolean; castShadow?: boolean } } }).sky : undefined;
    if (sky && (sky.physical || sky.preset) && sky.sun !== false && sky.sun?.light !== false && sky.sun?.castShadow !== false) shadowLights += 1;
  }
  const fx = opts.expandPostFx ? opts.expandPostFx(scene.postfx) : (scene.postfx ?? []);
  const prepass = fx.some((d) => PREPASS_EFFECTS.has(d.type)) ? geometry.total : 0;
  const contact = env.contactShadows ? casters : 0;
  const passes = { main: geometry.total, shadowMaps: casters * shadowLights, prepass, contactShadows: contact };
  return { perFrame: passes.main + passes.shadowMaps + passes.prepass + passes.contactShadows, passes, shadowLights };
}

// "Aim for" per kind (the table in plugin/skills/agent3d-create/references/art-direction.md —
// keep both in sync): triangles per frame, ALL passes (main + one re-draw of the casters per
// shadow-casting light + the ao / dof / godrays / outline pre-pass + contact shadows +
// transmission / mirror re-renders), that keep a page fast on a mid-range phone.
// Calibration (0.2.0, measured with `check --render` on the 31 templates): a mid-range phone
// GPU (Adreno 6xx / Mali-G57 class) sustains roughly 1–1.5 M lit triangles per frame at 60 fps
// in WebGL; an embed should take a fraction of that, leaving the page (and other scenes) room:
// a strip banner or a card ~10 %, a square / inline block more, the one hero of a page ~1/3,
// a fullscreen piece ~half, a game less than a hero (60 fps sustained + scripts / physics CPU).
// A typical premium hero (one shadow light + the cinematic look) triples its geometry:
// 130 k of geometry is ~400 k per frame. check warns above it with runtime stats (info on the
// estimate); TRIANGLE_LIMIT is the ceiling.
export const TRIANGLE_AIM: Record<string, number> = {
  banner: 150_000,
  card: 150_000,
  square: 250_000,
  inline: 250_000,
  hero: 400_000,
  fullscreen: 600_000,
  game: 300_000,
};

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
