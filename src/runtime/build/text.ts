// 3D text: three.js typeface fonts from the library (library/fonts/<id>.typeface.json).
//
// Layout (layout.ts-like pure part, `layoutText`): per-glyph advances + the
// font's kerning pairs (typeface JSON `kerning`, see scripts/convert-font.mjs),
// letterSpacing, explicit line breaks, `maxWidth` word-wrap, alignment and
// line height. Geometry: extruded glyphs with an inset bevel (keeps the
// font's silhouette), creased normals (smooth bevels and curved walls, sharp
// face edges), curve segments scaled with the size; optional `outline` (an
// offset back layer) and per-letter mode (`splitLetters` / `reveal`): each
// glyph becomes a child object "<id>/<n>" (n = index among non-space glyphs)
// that timeline tracks can target; `reveal` staggers an entrance per letter.

import * as THREE from "three";
import type { Font } from "three/addons/loaders/FontLoader.js";
import type { BehaviourDef, MaterialDef, TextObjectDef, TextRevealDef } from "../../core/types";
import { fetchJson } from "../assets";
import type { BehaviourImpl } from "../registry";
import { ease } from "../timeline/easing";
import { num } from "../util";
import type { RuntimeContext } from "./context";
import { sampleShape, smoothNormals, type GeometryUtils } from "./extrude";
import { createMaterial, type GradientUniforms } from "./materials";

const fontCache = new Map<string, Promise<Font>>();

export function loadFont(url: string): Promise<Font> {
  let p = fontCache.get(url);
  if (!p) {
    p = Promise.all([import("three/addons/loaders/FontLoader.js"), fetchJson<unknown>(url)]).then(([m, json]) =>
      new m.FontLoader().parse(json as Parameters<InstanceType<typeof m.FontLoader>["parse"]>[0]),
    );
    p.catch(() => fontCache.delete(url));
    fontCache.set(url, p);
  }
  return p;
}

export interface TypefaceData {
  resolution: number;
  boundingBox?: { yMin: number; yMax: number };
  glyphs: Record<string, { ha: number } | undefined>;
  capHeight?: number;
  kerning?: Record<string, Record<string, number> | undefined>;
}

// ─── Layout (pure) ──────────────────────────────────────────────────────

const baseChar = (c: string): string => {
  const d = c.normalize("NFD");
  return d.length > 1 ? d[0] : c;
};

// Kerning adjustment between two characters (glyph units). Accented letters
// are kerned like their base letter when the font has no pair for them.
export function kerningOf(data: Pick<TypefaceData, "kerning">, a: string, b: string): number {
  const k = data.kerning;
  if (!k) return 0;
  const v = k[a]?.[b];
  if (v !== undefined) return v;
  const ba = baseChar(a), bb = baseChar(b);
  if (ba === a && bb === b) return 0;
  return k[ba]?.[bb] ?? 0;
}

export interface LayoutOptions {
  text: string;
  em: number; // world units per font "size" unit (generateShapes size)
  letterSpacing?: number; // world units added between characters
  lineHeight?: number; // multiple of em (default 1.25)
  align?: "left" | "center" | "right";
  maxWidth?: number; // world units; wraps on spaces
  kerning?: boolean; // default true
}

export interface LaidGlyph {
  ch: string;
  x: number; // pen x (world units, alignment applied)
  line: number;
}

export interface TextLayout {
  glyphs: LaidGlyph[]; // non-space glyphs only
  lines: { width: number; y: number }[];
  lineHeight: number;
  width: number; // widest line
}

export function layoutText(data: TypefaceData, o: LayoutOptions): TextLayout {
  const scale = o.em / data.resolution;
  const spacing = num(o.letterSpacing, 0);
  const lineH = num(o.lineHeight, 1.25) * o.em;
  const kern = o.kerning !== false;
  const adv = (ch: string) => (data.glyphs[ch] ?? data.glyphs["?"])?.ha ?? data.resolution * 0.5;
  // Width of a run of characters + their pen positions.
  const measure = (chars: string[]) => {
    const xs: number[] = [];
    let x = 0;
    chars.forEach((ch, i) => {
      if (i > 0) x += spacing + (kern ? kerningOf(data, chars[i - 1], ch) * scale : 0);
      xs.push(x);
      x += adv(ch) * scale;
    });
    return { xs, width: x };
  };

  // Explicit lines, then word-wrap.
  const rows: string[][] = [];
  const maxW = typeof o.maxWidth === "number" && o.maxWidth > 0 ? o.maxWidth : Infinity;
  for (const raw of String(o.text ?? "").split("\n")) {
    if (maxW === Infinity) {
      rows.push(Array.from(raw));
      continue;
    }
    const words = raw.split(/ +/);
    let cur: string[] = [];
    for (const w of words) {
      const next = cur.length ? [...cur, " ", ...Array.from(w)] : Array.from(w);
      if (cur.length && measure(next).width > maxW) {
        rows.push(cur);
        cur = Array.from(w);
      } else cur = next;
    }
    rows.push(cur);
  }

  const glyphs: LaidGlyph[] = [];
  const lines: TextLayout["lines"] = [];
  let widest = 0;
  rows.forEach((row, li) => {
    while (row.length && row[row.length - 1] === " ") row.pop();
    const { xs, width } = measure(row);
    widest = Math.max(widest, width);
    const offset = o.align === "left" ? 0 : o.align === "right" ? -width : -width / 2;
    row.forEach((ch, i) => {
      if (ch.trim()) glyphs.push({ ch, x: xs[i] + offset, line: li });
    });
    lines.push({ width, y: -li * lineH });
  });
  return { glyphs, lines, lineHeight: lineH, width: widest };
}

// ─── Geometry ───────────────────────────────────────────────────────────

function capRatio(font: Font): number {
  const data = font.data as unknown as TypefaceData;
  if (data.capHeight && data.resolution) return data.capHeight / data.resolution;
  const shapes = font.generateShapes("H", 1);
  if (!shapes.length) return 0.72;
  const g = new THREE.ShapeGeometry(shapes);
  g.computeBoundingBox();
  const h = g.boundingBox!.max.y - g.boundingBox!.min.y;
  g.dispose();
  return h > 0 ? h : 0.72;
}

type TextGeoDef = Pick<TextObjectDef, "text" | "size" | "depth" | "bevel" | "align" | "letterSpacing" | "lineHeight" | "maxWidth" | "kerning" | "curveSegments">;

export interface TextMetrics {
  size: number;
  em: number;
  depth: number;
  bevel: number;
  curveSegments: number;
  layout: TextLayout;
  // Block offsets: y of the first baseline, z of the front face.
  offsetY: number;
  frontZ: number;
  backZ: number;
}

export function textMetrics(font: Font, def: TextGeoDef): TextMetrics {
  const data = font.data as unknown as TypefaceData;
  const size = num(def.size, 1);
  const em = size / capRatio(font);
  const depth = Math.max(0, num(def.depth, 0.2));
  // Default bevel grows with the size; never more than ~45 % of the depth.
  const bevel = depth > 0 ? Math.max(0, Math.min(num(def.bevel, Math.min(depth * 0.3, size * 0.035)), depth * 0.45, size * 0.08)) : 0;
  const curveSegments = Math.round(Math.max(2, Math.min(32, num(def.curveSegments, depth > 0 ? 5 + size * 3 : 8 + size * 4))));
  const layout = layoutText(data, { text: def.text, em, letterSpacing: def.letterSpacing, lineHeight: def.lineHeight, align: def.align ?? "center", maxWidth: def.maxWidth, kerning: def.kerning });
  // Vertical centring on the cap height of the whole block, depth centred on z = 0.
  const bottomY = layout.lines.length ? layout.lines[layout.lines.length - 1].y : 0;
  const offsetY = -(size + bottomY) / 2;
  return { size, em, depth, bevel, curveSegments, layout, offsetY, frontZ: depth / 2, backZ: -depth / 2 };
}

function extrudeOptions(m: TextMetrics): THREE.ExtrudeGeometryOptions {
  const b = m.bevel;
  return {
    depth: Math.max(m.depth - b * 2, 0.0001),
    curveSegments: m.curveSegments,
    bevelEnabled: b > 0,
    bevelThickness: b,
    // Outset only: an inset bevel collapses the hairlines of high-contrast fonts (Playfair).
    bevelSize: b * 0.6,
    bevelOffset: 0,
    bevelSegments: 3,
  };
}

type Utils = GeometryUtils;

// One glyph's body geometry (glyph-local: pen origin at x = 0, baseline y = 0, z from backZ to frontZ).
// Glyph outlines with adaptive curve sampling: up to `curveSegments` points per
// curve, fewer on the many short curves of TrueType outlines.
function glyphShapes(font: Font, ch: string, m: TextMetrics): THREE.Shape[] {
  const tol = m.em / (m.curveSegments * 5);
  return font.generateShapes(ch, m.em).map((s) => sampleShape(s, tol, 1, m.curveSegments));
}

function glyphGeometry(font: Font, ch: string, m: TextMetrics, utils: Utils): THREE.BufferGeometry | null {
  const shapes = glyphShapes(font, ch, m);
  if (!shapes.length) return null;
  if (m.depth <= 0) return new THREE.ShapeGeometry(shapes, m.curveSegments);
  const g = new THREE.ExtrudeGeometry(shapes, extrudeOptions(m));
  g.translate(0, 0, m.backZ + m.bevel);
  g.clearGroups();
  return smoothNormals(g, (50 * Math.PI) / 180, utils);
}

export interface OutlineSpec {
  width: number;
  frontZ: number;
  backZ: number;
  material?: MaterialDef;
  color: string;
}

export function outlineSpec(def: Pick<TextObjectDef, "outline" | "size">, m: TextMetrics): OutlineSpec | null {
  const o = def.outline;
  if (!o) return null;
  const cfg = o === true ? {} : o;
  const width = Math.max(1e-4, num(cfg.width, m.size * 0.06));
  // The outline sits behind the face: its front is recessed by half the depth
  // (a thin step behind flat text), its back a little behind the body.
  const inset = m.depth > 0 ? m.depth * 0.5 : m.size * 0.01;
  const frontZ = m.frontZ - inset;
  const thickness = Math.max(num(cfg.depth, m.depth > 0 ? m.depth * 0.6 : m.size * 0.01), 1e-4);
  return { width, frontZ, backZ: frontZ - thickness, material: cfg.material, color: cfg.color ?? "#111111" };
}

// ─── Outline offset polygon (round joins, clamped miters) ───────────────

type P2 = { x: number; y: number };

function signedArea(pts: P2[]): number {
  let a = 0;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) a += (pts[j].x - pts[i].x) * (pts[j].y + pts[i].y);
  return a / 2; // > 0 = counter-clockwise
}

/**
 * Offsets a closed ring by `width` to its right-hand side (outwards for a
 * counter-clockwise outer contour, into the hole for a clockwise hole). Convex
 * corners get a round join (no spikes however sharp the corner, unlike a
 * miter / three's bevelOffset); reflex corners use a miter clamped to
 * `miterLimit` × width.
 */
export function offsetRing(ring: P2[], width: number, miterLimit = 2): THREE.Vector2[] {
  const pts = ring.filter((p, i) => {
    const q = ring[(i + 1) % ring.length];
    return Math.hypot(q.x - p.x, q.y - p.y) > 1e-9;
  });
  const n = pts.length;
  const out: THREE.Vector2[] = [];
  if (n < 3) return pts.map((p) => new THREE.Vector2(p.x, p.y));
  const normal = (a: P2, b: P2) => {
    const dx = b.x - a.x, dy = b.y - a.y, l = Math.hypot(dx, dy) || 1;
    return { x: dy / l, y: -dx / l };
  };
  for (let i = 0; i < n; i++) {
    const prev = pts[(i - 1 + n) % n], p = pts[i], next = pts[(i + 1) % n];
    const n1 = normal(prev, p), n2 = normal(p, next);
    const cross = (p.x - prev.x) * (next.y - p.y) - (p.y - prev.y) * (next.x - p.x);
    const dot = n1.x * n2.x + n1.y * n2.y;
    if (cross > 0 && dot < 0.995) {
      // The offset edges open a gap on this side: round join (arc n1 → n2).
      const a1 = Math.atan2(n1.y, n1.x);
      let a2 = Math.atan2(n2.y, n2.x);
      // A left turn (cross > 0) rotates the normals counter-clockwise: sweep a1 → a2 upwards.
      while (a2 < a1) a2 += Math.PI * 2;
      while (a2 > a1 + Math.PI * 2) a2 -= Math.PI * 2;
      const steps = Math.max(1, Math.ceil(Math.abs(a2 - a1) / (Math.PI / 8)));
      for (let k = 0; k <= steps; k++) {
        const a = a1 + ((a2 - a1) * k) / steps;
        out.push(new THREE.Vector2(p.x + Math.cos(a) * width, p.y + Math.sin(a) * width));
      }
    } else {
      // Overlap side (or straight): miter, clamped.
      let mx = n1.x + n2.x, my = n1.y + n2.y;
      const ml = Math.hypot(mx, my) || 1;
      mx /= ml;
      my /= ml;
      const cosHalf = Math.max(mx * n1.x + my * n1.y, 1 / miterLimit);
      out.push(new THREE.Vector2(p.x + (mx * width) / cosHalf, p.y + (my * width) / cosHalf));
    }
  }
  return out;
}

/** Glyph shapes grown by `width` (outer contours outwards, holes shrunk; holes that vanish are dropped). */
export function offsetShapes(shapes: THREE.Shape[], width: number): THREE.Shape[] {
  const res: THREE.Shape[] = [];
  for (const sh of shapes) {
    const { shape, holes } = sh.extractPoints(1);
    let outer = shape.slice();
    if (signedArea(outer) < 0) outer = outer.reverse();
    const o = new THREE.Shape(offsetRing(outer, width));
    for (const h of holes) {
      let hole = h.slice();
      const area0 = Math.abs(signedArea(hole));
      if (signedArea(hole) > 0) hole = hole.reverse();
      // A hole narrower than the outline on either axis closes up (its offset
      // would turn inside out).
      const xs = hole.map((p) => p.x), ys = hole.map((p) => p.y);
      if (Math.max(...xs) - Math.min(...xs) <= 2 * width || Math.max(...ys) - Math.min(...ys) <= 2 * width) continue;
      const off = offsetRing(hole, width);
      // Still a clockwise hole of a sensible size after shrinking?
      const a = signedArea(off);
      if (a < 0 && -a > area0 * 0.02) o.holes.push(new THREE.Path(off));
    }
    res.push(o);
  }
  return res;
}

function outlineGeometry(font: Font, ch: string, m: TextMetrics, o: OutlineSpec, utils: Utils): THREE.BufferGeometry | null {
  const shapes = glyphShapes(font, ch, m);
  if (!shapes.length) return null;
  // The glyph outline offset outwards by `width` with round joins (three's
  // bevelOffset is a raw miter: long spikes at sharp corners for wide outlines).
  const g = new THREE.ExtrudeGeometry(offsetShapes(shapes, o.width), {
    depth: o.frontZ - o.backZ,
    curveSegments: 1,
    bevelEnabled: false,
  });
  g.translate(0, 0, o.backZ);
  g.clearGroups();
  return smoothNormals(g, (40 * Math.PI) / 180, utils);
}

// Merged geometry of a whole text block (used by the single-mesh mode, tests and budgets).
export function textGeometry(font: Font, def: TextGeoDef, utils: Utils): THREE.BufferGeometry {
  const m = textMetrics(font, def);
  return mergeGlyphs(m, (ch) => glyphGeometry(font, ch, m, utils), utils);
}

function mergeGlyphs(m: TextMetrics, make: (ch: string) => THREE.BufferGeometry | null, utils: Utils): THREE.BufferGeometry {
  const cache = new Map<string, THREE.BufferGeometry | null>();
  const parts: THREE.BufferGeometry[] = [];
  for (const g of m.layout.glyphs) {
    if (!cache.has(g.ch)) cache.set(g.ch, make(g.ch));
    const base = cache.get(g.ch);
    if (!base) continue;
    const geo = base.clone();
    geo.translate(g.x, m.layout.lines[g.line].y + m.offsetY, 0);
    parts.push(geo);
  }
  for (const g of cache.values()) g?.dispose();
  let geo: THREE.BufferGeometry;
  if (!parts.length) geo = new THREE.BufferGeometry();
  else {
    geo = (parts.length === 1 ? parts[0].clone() : utils.mergeGeometries(parts, false)) ?? new THREE.BufferGeometry();
    for (const p of parts) p.dispose();
  }
  geo.computeBoundingBox();
  geo.computeBoundingSphere();
  return geo;
}

// ─── Reveal (per-letter entrance) ───────────────────────────────────────

export const REVEAL_EFFECTS = ["rise", "fade", "scale", "spin", "drop"] as const;

// Delay of the letter at `index` (of `count`) for a reveal def.
export function revealDelay(r: TextRevealDef, index: number, count: number): number {
  const stagger = num(r.stagger, 0.04);
  let k = index;
  if (r.order === "reverse") k = count - 1 - index;
  else if (r.order === "center") k = Math.abs(index - (count - 1) / 2);
  else if (r.order === "random") {
    // Deterministic shuffle rank (hash of the index).
    let h = (index + 1) * 2654435761;
    h = (h ^ (h >>> 13)) >>> 0;
    k = (h % 1000) / 1000 * (count - 1);
  }
  return num(r.delay, 0) + k * stagger;
}

// Behaviour-shaped implementation driven by the runtime clock: t = seconds since the letter's own start.
export function revealImpl(r: TextRevealDef, size: number): BehaviourImpl {
  return (_def, ctx) => {
    const effect = r.effect ?? "rise";
    const duration = Math.max(num(r.duration, 0.6), 1e-3);
    const easeName = r.ease ?? (effect === "scale" || effect === "spin" ? "outBack" : "outCubic");
    const fades = effect !== "scale";
    const mats: THREE.Material[] = [];
    // Depth twins: while a letter fades, an invisible (colour-masked) opaque
    // copy of its body and outline writes depth first, so only the nearest
    // surface of the half-transparent letter is drawn — no back faces, side
    // walls or outline showing through it.
    const twins: THREE.Mesh[] = [];
    if (fades) {
      const meshes: THREE.Mesh[] = [];
      ctx.object.traverse((o) => {
        const mm = (o as THREE.Mesh).material;
        if (!mm || o.userData.depthTwin) return;
        meshes.push(o as THREE.Mesh);
        for (const m of Array.isArray(mm) ? mm : [mm]) {
          if (m.userData.baseOpacity === undefined) m.userData.baseOpacity = m.opacity;
          if (m.userData.baseTransparent === undefined) m.userData.baseTransparent = m.transparent;
          mats.push(m);
        }
      });
      for (const mesh of meshes) twins.push(depthTwin(mesh));
    }
    return {
      update(t) {
        const k = Math.min(Math.max(t / duration, 0), 1);
        const p = ease(easeName, k);
        const o = ctx.object;
        if (fades) {
          const a = ease("outCubic", Math.min(1, k * 1.6));
          for (const m of mats) {
            m.opacity = (m.userData.baseOpacity as number) * a;
            m.transparent = a < 1 || (m.userData.baseTransparent as boolean);
          }
          for (const tw of twins) tw.visible = a > 0 && a < 1;
        }
        if (k <= 0) o.visible = false;
        switch (effect) {
          case "rise":
            o.position.y -= (1 - p) * size * 0.6;
            break;
          case "drop":
            o.position.y += (1 - p) * size * 1.2;
            break;
          case "scale":
            o.scale.multiplyScalar(Math.max(1e-4, p));
            break;
          case "spin":
            o.rotation.y += (1 - p) * Math.PI;
            o.scale.multiplyScalar(Math.max(1e-4, Math.min(1, k * 2)));
            break;
          default:
            break;
        }
      },
    };
  };
}

let depthOnly: THREE.MeshBasicMaterial | null = null;
/** An opaque depth-only copy of `mesh` (same geometry, child at identity), hidden by default. */
export function depthTwin(mesh: THREE.Mesh): THREE.Mesh {
  depthOnly ??= new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: true });
  const twin = new THREE.Mesh(mesh.geometry, depthOnly);
  twin.name = `${mesh.name}#depth`;
  twin.visible = false;
  twin.castShadow = false;
  twin.receiveShadow = false;
  twin.renderOrder = -1;
  twin.userData.helper = true; // never picked / outlined / in the G-buffer
  twin.userData.depthTwin = true;
  mesh.add(twin);
  return twin;
}

// ─── Object builder ─────────────────────────────────────────────────────

export interface TextLetter {
  id: string; // "<textId>/<n>"
  object: THREE.Object3D;
  def: TextObjectDef;
  reveal?: { def: BehaviourDef; impl: BehaviourImpl };
}

export interface BuiltText {
  object: THREE.Object3D;
  letters: TextLetter[];
}

export function fontUrl(def: Pick<TextObjectDef, "font">, ctx: Pick<RuntimeContext, "resolveAsset">): string {
  const fontId = def.font ?? "sans-bold";
  return ctx.resolveAsset(fontId.includes("/") || fontId.includes(":") ? fontId : `library:fonts/${fontId}`);
}

function setGradientRange(mat: THREE.Material, min: number, max: number): void {
  const u = mat.userData.gradient as GradientUniforms | undefined;
  if (!u) return;
  u.uGradMin.value = min;
  u.uGradMax.value = max;
}

export async function buildText(def: TextObjectDef, ctx: RuntimeContext): Promise<BuiltText> {
  const [font, utils] = await Promise.all([loadFont(fontUrl(def, ctx)), import("three/addons/utils/BufferGeometryUtils.js")]);
  const m = textMetrics(font, def);
  const outline = outlineSpec(def, m);
  const split = !!def.splitLetters || !!def.reveal;
  const flat = m.depth <= 0;
  const material = () => createMaterial(def.material, ctx, { defaultColor: "#ffffff" });
  const outlineMaterial = () => (outline ? createMaterial(outline.material ?? { color: outline.color, roughness: 0.55 }, ctx) : null);
  // Gradient ramps span the whole block (cap top → last baseline).
  const gradMin = (m.layout.lines.length ? m.layout.lines[m.layout.lines.length - 1].y : 0) + m.offsetY;
  const gradMax = m.size + m.offsetY;
  const sideOf = (mat: THREE.Material) => {
    if (flat) mat.side = THREE.DoubleSide;
    return mat;
  };

  if (!split) {
    const geo = mergeGlyphs(m, (ch) => glyphGeometry(font, ch, m, utils), utils);
    const mat = sideOf(await material());
    setGradientRange(mat, gradMin, gradMax);
    const mesh = new THREE.Mesh(geo, mat);
    if (outline) {
      const og = mergeGlyphs(m, (ch) => outlineGeometry(font, ch, m, outline, utils), utils);
      const om = await outlineMaterial();
      if (om) {
        setGradientRange(om, gradMin, gradMax);
        const back = new THREE.Mesh(og, om);
        back.name = `${def.id}/outline`;
        mesh.add(back);
      }
    }
    return { object: mesh, letters: [] };
  }

  // Per-letter mode: a group of glyph meshes centred on their own pivot
  // (glyph box centre x, mid cap height y) so letters rotate / scale in place.
  const group = new THREE.Group();
  const bodies = new Map<string, THREE.BufferGeometry | null>();
  const backs = new Map<string, THREE.BufferGeometry | null>();
  const pivotY = m.size / 2;
  const letters: TextLetter[] = [];
  const count = m.layout.glyphs.length;
  let n = 0;
  for (const g of m.layout.glyphs) {
    if (!bodies.has(g.ch)) {
      const body = glyphGeometry(font, g.ch, m, utils);
      let cx = 0;
      if (body) {
        body.computeBoundingBox();
        cx = (body.boundingBox!.min.x + body.boundingBox!.max.x) / 2;
        body.translate(-cx, -pivotY, 0);
        body.computeBoundingSphere();
      }
      bodies.set(g.ch, body);
      if (outline) {
        const back = outlineGeometry(font, g.ch, m, outline, utils);
        back?.translate(-cx, -pivotY, 0);
        backs.set(g.ch, back);
      }
      if (body) body.userData.cx = cx;
    }
    const body = bodies.get(g.ch);
    if (!body) continue;
    const cx = body.userData.cx as number;
    const lineY = m.layout.lines[g.line].y + m.offsetY;
    const mat = sideOf(await material());
    setGradientRange(mat, gradMin - lineY - pivotY, gradMax - lineY - pivotY);
    const mesh = new THREE.Mesh(body, mat);
    mesh.position.set(g.x + cx, lineY + pivotY, 0);
    const id = `${def.id}/${n}`;
    mesh.name = id;
    mesh.userData.a3dId = id;
    const backGeo = backs.get(g.ch);
    if (backGeo) {
      const om = await outlineMaterial();
      if (om) {
        setGradientRange(om, gradMin - lineY - pivotY, gradMax - lineY - pivotY);
        const back = new THREE.Mesh(backGeo, om);
        back.name = `${id}/outline`;
        mesh.add(back);
      }
    }
    group.add(mesh);
    const letterDef = { id, kind: "text", text: g.ch } as TextObjectDef;
    const letter: TextLetter = { id, object: mesh, def: letterDef };
    if (def.reveal) {
      // Runs as an entrance behaviour ("appear" semantics: settled under reduced motion "static").
      letter.reveal = { def: { type: "appear", when: "visible", delay: revealDelay(def.reveal, n, count) }, impl: revealImpl(def.reveal, m.size) };
    }
    letters.push(letter);
    n++;
  }
  return { object: group, letters };
}

// Kept for callers that only need the merged geometry of a text block.
export async function buildTextGeometry(def: TextObjectDef, ctx: RuntimeContext): Promise<THREE.BufferGeometry> {
  const [font, utils] = await Promise.all([loadFont(fontUrl(def, ctx)), import("three/addons/utils/BufferGeometryUtils.js")]);
  return textGeometry(font, def, utils);
}
