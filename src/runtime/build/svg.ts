// SVG logos / icons → extruded 3D meshes, centred on the object and fitted to
// `size` (width by default, see `fit`).
//
// Parsed with three's SVGLoader: <path> <rect> <circle> <ellipse> <polygon>
// <polyline> <line> <use>, nested transforms, <style> classes, fill-rule
// nonzero / evenodd (holes), fill / stroke opacity. Fills are extruded shapes
// (inset bevel like 3D text); strokes (stroke-width, linejoin, linecap,
// miterlimit) become flat stroke outlines extruded into solids. Paths keep
// their own colours (`keepColors`, default true without `material`), later
// paths sit slightly in front (painter's order, `layerGap`). Consecutive paths
// sharing a colour are merged (fewer draw calls). <text> is not supported:
// convert text to paths in the design tool.

import * as THREE from "three";
import type { SVGResult } from "three/addons/loaders/SVGLoader.js";
import type { MaterialDef, SvgObjectDef } from "../../core/types";
import { fetchText } from "../assets";
import { num } from "../util";
import type { RuntimeContext } from "./context";
import { extrudeTriangles, samplePath, sampleShape, smoothNormals, type GeometryUtils } from "./extrude";
import { createMaterial, resolveMaterialDef } from "./materials";

interface SvgStyle {
  fill?: string;
  fillOpacity?: number;
  opacity?: number;
  stroke?: string;
  strokeOpacity?: number;
  strokeWidth?: number;
  strokeLineJoin?: string;
  strokeLineCap?: string;
  strokeMiterLimit?: number;
  visibility?: string;
}

type Path = SVGResult["paths"][number];

// One drawable part, in SVG units (y down).
export interface SvgPart {
  kind: "fill" | "stroke";
  color: string; // "#rrggbb"
  opacity: number;
  shapes?: THREE.Shape[]; // fill
  stroke?: THREE.BufferGeometry; // flat triangles (z = 0)
}

const isPaint = (v: string | undefined) => !!v && v !== "none" && v !== "transparent";

function paintColor(value: string, path: Path, fallback: string): string {
  if (value === "currentColor") return fallback;
  const url = /^url\(\s*['"]?#([^'")]+)['"]?\s*\)/.exec(value);
  if (url) {
    // Gradient paint: the mix of its end stops (gradients are not mapped onto 3D).
    const g = (path.userData?.gradients as Record<string, { stops?: { color: string }[] | null }> | undefined)?.[url[1]];
    const stops = g?.stops ?? [];
    if (!stops.length) return fallback;
    const a = new THREE.Color(stops[0].color), b = new THREE.Color(stops[stops.length - 1].color);
    return `#${a.lerp(b, 0.5).getHexString()}`;
  }
  try {
    const c = new THREE.Color();
    c.setStyle(value, THREE.SRGBColorSpace);
    return `#${c.getHexString(THREE.SRGBColorSpace)}`;
  } catch {
    return fallback;
  }
}

// Sampling tolerance for a document: ~1/120 of its larger side at the default curveSegments (12).
function tolerance(data: SVGResult, curveSegments: number): number {
  const b = new THREE.Box2();
  for (const p of data.paths) for (const sp of p.subPaths) for (const pt of sp.getPoints(4)) b.expandByPoint(pt);
  const span = b.isEmpty() ? 100 : Math.max(b.max.x - b.min.x, b.max.y - b.min.y, 1e-6);
  return span / (curveSegments * 10);
}

// Parse → drawable parts (pure apart from DOMParser, which SVGLoader needs).
export function svgParts(data: SVGResult, SVGLoader: typeof import("three/addons/loaders/SVGLoader.js").SVGLoader, opts: { strokes?: boolean; curveSegments?: number; currentColor?: string } = {}): SvgPart[] {
  const parts: SvgPart[] = [];
  const divisions = Math.max(1, Math.round(num(opts.curveSegments, 12)));
  const tol = tolerance(data, divisions);
  const current = opts.currentColor ?? "#1f2330";
  for (const path of data.paths) {
    const style = (path.userData?.style ?? {}) as SvgStyle;
    if (style.visibility === "hidden" || style.visibility === "collapse") continue;
    const alpha = num(style.opacity, 1);
    if (isPaint(style.fill)) {
      const shapes = path.toShapes().map((sh) => sampleShape(sh, tol));
      if (shapes.length) parts.push({ kind: "fill", color: paintColor(style.fill!, path, current), opacity: num(style.fillOpacity, 1) * alpha, shapes });
    }
    if (opts.strokes !== false && isPaint(style.stroke) && num(style.strokeWidth, 1) > 0) {
      const sw = SVGLoader.getStrokeStyle(num(style.strokeWidth, 1), "#000", style.strokeLineJoin ?? "miter", style.strokeLineCap ?? "butt", num(style.strokeMiterLimit, 4));
      const geos: THREE.BufferGeometry[] = [];
      for (const sub of path.subPaths) {
        const pts = samplePath(sub, tol);
        if (pts.length < 2) continue;
        const g = SVGLoader.pointsToStroke(pts, sw, divisions);
        if (g) geos.push(g);
      }
      if (geos.length) {
        const merged = geos.length === 1 ? geos[0] : mergeFlat(geos);
        parts.push({ kind: "stroke", color: paintColor(style.stroke!, path, current), opacity: num(style.strokeOpacity, 1) * alpha, stroke: merged });
      }
    }
  }
  return parts;
}

function mergeFlat(geos: THREE.BufferGeometry[]): THREE.BufferGeometry {
  let count = 0;
  for (const g of geos) count += g.getAttribute("position").count;
  const pos = new Float32Array(count * 3);
  let o = 0;
  for (const g of geos) {
    const a = g.getAttribute("position").array as Float32Array;
    pos.set(a, o);
    o += a.length;
    g.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  return out;
}

export function partsBounds(parts: SvgPart[], divisions = 12): THREE.Box2 {
  const b = new THREE.Box2();
  for (const p of parts) {
    if (p.shapes) for (const s of p.shapes) for (const pt of s.getPoints(divisions)) b.expandByPoint(pt);
    if (p.stroke) {
      const a = p.stroke.getAttribute("position");
      for (let i = 0; i < a.count; i++) b.expandByPoint(new THREE.Vector2(a.getX(i), a.getY(i)));
    }
  }
  return b;
}

function partGeometry(p: SvgPart, depth: number, bevel: number, curveSegments: number, utils: GeometryUtils): THREE.BufferGeometry | null {
  if (p.kind === "stroke") return p.stroke ? extrudeTriangles(p.stroke, depth) : null;
  if (!p.shapes?.length) return null;
  if (depth <= 0) return new THREE.ShapeGeometry(p.shapes, curveSegments);
  const b = Math.min(bevel, depth * 0.45);
  const g = new THREE.ExtrudeGeometry(p.shapes, {
    depth: Math.max(depth - b * 2, depth * 0.05),
    curveSegments,
    bevelEnabled: b > 0,
    bevelThickness: b,
    bevelSize: b * 0.6,
    bevelOffset: 0,
    bevelSegments: 3,
  });
  g.translate(0, 0, b);
  g.clearGroups();
  return smoothNormals(g, (50 * Math.PI) / 180, utils);
}

export async function buildSvg(def: SvgObjectDef, ctx: RuntimeContext): Promise<THREE.Group> {
  const [{ SVGLoader }, utils] = await Promise.all([import("three/addons/loaders/SVGLoader.js"), import("three/addons/utils/BufferGeometryUtils.js")]);
  const markup = def.src.trim().startsWith("<") ? def.src : await fetchText(ctx.resolveAsset(def.src));
  const data = new SVGLoader().parse(markup);
  const resolved = def.material ? resolveMaterialDef(def.material) : undefined;
  const materialColor = typeof resolved?.color === "string" ? resolved.color : undefined;
  const curveSegments = Math.max(1, Math.round(num(def.curveSegments, 12)));
  const parts = svgParts(data, SVGLoader, { strokes: def.strokes, curveSegments, currentColor: materialColor });

  const group = new THREE.Group();
  const bounds = partsBounds(parts, curveSegments);
  if (!parts.length || bounds.isEmpty()) return group;
  const size = num(def.size, 2);
  const w = Math.max(bounds.max.x - bounds.min.x, 1e-6), h = Math.max(bounds.max.y - bounds.min.y, 1e-6);
  const fit = def.fit ?? "width";
  const k = size / (fit === "height" ? h : fit === "max" ? Math.max(w, h) : w); // svg units → world units
  const depthW = Math.max(0, num(def.depth, 0.2));
  const depth = depthW / k;
  const bevel = num(def.bevel, 0) / k;
  const gapW = num(def.layerGap, depthW > 0 ? depthW * 0.02 : size * 0.002);

  // Materials: one per colour (keepColors) or a single override.
  const keepColors = def.keepColors ?? !def.material;
  const mats = new Map<string, THREE.Material>();
  const materialFor = async (color: string, opacity: number): Promise<THREE.Material> => {
    const key = keepColors ? `${color}|${opacity}` : `|${opacity}`;
    let m = mats.get(key);
    if (!m) {
      const mdef: MaterialDef | undefined = keepColors
        ? { roughness: 0.4, metalness: 0.1, ...(def.material ?? {}), color, ...(opacity < 1 ? { opacity } : {}) }
        : def.material
          ? { ...def.material, ...(opacity < 1 ? { opacity } : {}) }
          : { color: "#dddddd", roughness: 0.4, metalness: 0.1 };
      m = await createMaterial(mdef, ctx, { defaultColor: color });
      if (opacity < 1) m.transparent = true;
      if (depthW <= 0) m.side = THREE.DoubleSide;
      mats.set(key, m);
    }
    return m;
  };

  // Merge runs of consecutive parts with the same material (painter's order kept).
  const runs: { key: string; color: string; opacity: number; geos: THREE.BufferGeometry[] }[] = [];
  for (const p of parts) {
    const geo = partGeometry(p, depth, bevel, curveSegments, utils);
    if (!geo) continue;
    if (!geo.getAttribute("normal")) geo.computeVertexNormals();
    const key = keepColors ? `${p.color}|${p.opacity}` : `|${p.opacity}`;
    const last = runs[runs.length - 1];
    if (last && last.key === key) last.geos.push(geo);
    else runs.push({ key, color: p.color, opacity: p.opacity, geos: [geo] });
  }

  const inner = new THREE.Group();
  for (const [i, run] of runs.entries()) {
    for (const g of run.geos) {
      for (const name of Object.keys(g.attributes)) if (!["position", "normal", "uv"].includes(name)) g.deleteAttribute(name);
      if (!g.getAttribute("uv")) g.setAttribute("uv", new THREE.Float32BufferAttribute(new Float32Array(g.getAttribute("position").count * 2), 2));
    }
    const geo = run.geos.length === 1 ? run.geos[0] : (utils.mergeGeometries(run.geos.map((g) => (g.index ? g.toNonIndexed() : g)), false) ?? run.geos[0]);
    const mesh = new THREE.Mesh(geo, await materialFor(run.color, run.opacity));
    // Later paths sit slightly in front (SVG painter's order).
    mesh.position.z = (i * gapW) / k;
    inner.add(mesh);
  }
  // SVG Y is down: flip (three handles the mirrored winding), centre, scale, centre the depth.
  const cx = (bounds.min.x + bounds.max.x) / 2;
  const cy = (bounds.min.y + bounds.max.y) / 2;
  inner.scale.set(k, -k, k);
  inner.position.set(-cx * k, cy * k, -(depthW + Math.max(0, runs.length - 1) * gapW) / 2);
  group.add(inner);
  return group;
}
