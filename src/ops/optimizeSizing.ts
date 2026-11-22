// Smart texture sizing for `assets optimize`: how many pixels does each
// texture actually need, given how the scene uses it?
//
// For every use of a texture (material maps, models' embedded images, HDRI
// backgrounds) we estimate the object's size on screen (in device pixels):
//   canvas height = reference CSS width of the target kind / aspect × DPR
//   projected px  = object size × canvas height / visible height at the
//                   object's distance (perspective fov or orthographic zoom)
// then divide by the texture repeat, multiply by a role factor (colour 1,
// normal 0.75, roughness / metalness / AO 0.5) and a model atlas factor
// (an atlas wraps the whole model: ~1.5× the projected size), and round up
// to a tier (256 / 512 / 1024 / 2048; 4096 for equirect backgrounds). Camera
// moves (orbit zoom, scroll paths, timeline keys, follow) use the closest
// distance. Pure: no Three.js, no DOM.

import { CATALOG } from "../core/catalog";
import type { LibraryIndex } from "../core/library";
import { findLibraryAsset, isLibraryRef, libraryId } from "../core/library";
import type { ProjectFs } from "../core/fs";
import type { MaterialDef, ObjectDef, SceneDoc, TargetKind, Vec3 } from "../core/types";
import { DEFAULT_ASPECT } from "../core/validate";
import { glbJson, modelFileBounds } from "./gltf";

export type TextureRole = "color" | "normal" | "data" | "background" | "lighting";

export const TEXTURE_TIERS = [256, 512, 1024, 2048] as const;
const BACKGROUND_TIERS = [512, 1024, 2048, 4096];
// Used when nothing in scene.json tells how a texture is shown (scripts, unused files).
export const FALLBACK_MAX_SIZE = 1024;

// Typical CSS width of each target kind on a page (desktop), in CSS pixels.
const REF_CSS_WIDTH: Record<TargetKind, number> = { banner: 1440, hero: 1440, fullscreen: 1920, inline: 800, card: 400, square: 600, game: 1280 };
// Smallest tier for colour maps: heroes are looked at closely, never go below.
const MIN_COLOR_TIER: Record<TargetKind, number> = { banner: 256, hero: 512, fullscreen: 512, inline: 256, card: 256, square: 256, game: 256 };
// Largest tier for object textures (backgrounds excepted).
const MAX_TIER: Record<TargetKind, number> = { banner: 2048, hero: 2048, fullscreen: 2048, inline: 2048, card: 1024, square: 2048, game: 1024 };
const ROLE_FACTOR: Record<TextureRole, number> = { color: 1, normal: 0.75, data: 0.5, background: 1, lighting: 1 };
const MODEL_ATLAS_FACTOR = 1.5;
const MARGIN = 1.15; // texel per pixel safety margin

export interface TextureUse {
  at: string; // scene path ("objects#crate.material.map", "objects#fox.src")
  role: TextureRole;
  pixels: number; // recommended longest side for this use
  why: string;
}

export interface SizeDecision {
  maxSize: number;
  reason: string;
  uses: TextureUse[];
}

export interface Viewport {
  width: number; // device pixels
  height: number;
  dpr: number;
  kind: TargetKind;
}

export function sceneViewport(scene: SceneDoc): Viewport {
  const kind: TargetKind = scene.target?.kind && scene.target.kind in REF_CSS_WIDTH ? scene.target.kind : "hero";
  const dpr = Math.min(2, Math.max(1, Number(scene.target?.maxDpr) || 2));
  const [aw, ah] = String(scene.target?.aspect ?? DEFAULT_ASPECT[kind]).split(":").map(Number);
  const aspect = aw > 0 && ah > 0 ? aw / ah : 16 / 9;
  const cssW = REF_CSS_WIDTH[kind];
  let cssH = cssW / aspect;
  const h = /^(\d+(?:\.\d+)?)(px|vh|svh|dvh|lvh)$/.exec(String(scene.target?.height ?? "").trim());
  if (h) cssH = h[2] === "px" ? Number(h[1]) : (900 * Number(h[1])) / 100;
  return { width: Math.round(cssW * dpr), height: Math.round(cssH * dpr), dpr, kind };
}

export function pickTier(pixels: number, tiers: readonly number[], min: number, max: number): number {
  const need = pixels / 1.12; // a texture ~10% short of the need still looks the same
  const t = tiers.find((x) => x >= need) ?? tiers[tiers.length - 1];
  return Math.max(min, Math.min(max, t));
}

// ─── Object size / placement estimates ──────────────────────────────────

const v3 = (v: unknown, d: number): Vec3 => (Array.isArray(v) && v.length === 3 && v.every((x) => typeof x === "number") ? (v as Vec3) : [d, d, d]);
const scaleOf = (s: unknown): number => (typeof s === "number" ? Math.abs(s) : Array.isArray(s) ? Math.max(...s.map((x) => Math.abs(Number(x) || 0))) || 1 : 1);
const dist = (a: Vec3, b: Vec3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

const GEOMETRY_DEFAULTS = new Map(CATALOG.geometries.map((g) => [g.id, Object.fromEntries(g.params.map((p) => [p.name, p.default]))]));

export function geometrySize(geometry: { type?: string; [k: string]: unknown } | undefined): number {
  if (!geometry) return 1;
  const p = { ...(GEOMETRY_DEFAULTS.get(String(geometry.type)) ?? {}), ...geometry } as Record<string, unknown>;
  const n = (k: string) => (typeof p[k] === "number" ? (p[k] as number) : 0);
  const s = Math.max(n("width"), n("height"), n("depth"), n("length") + 2 * n("radius"), 2 * n("radius") + 2 * n("tube"), 2 * n("outerRadius"), 2 * n("radiusTop"), 2 * n("radiusBottom"), n("size"));
  return s > 0 ? s : 1;
}

interface Placed {
  object: ObjectDef;
  world: Vec3; // world position (parent rotations ignored)
  scale: number; // accumulated uniform-ish scale
}

function placeObjects(scene: SceneDoc): Placed[] {
  const out: Placed[] = [];
  const visit = (objects: ObjectDef[] | undefined, origin: Vec3, parentScale: number) => {
    for (const o of objects ?? []) {
      if (!o || typeof o !== "object") continue;
      const p = v3(o.position, 0);
      const world: Vec3 = [origin[0] + p[0] * parentScale, origin[1] + p[1] * parentScale, origin[2] + p[2] * parentScale];
      const scale = parentScale * scaleOf(o.scale);
      out.push({ object: o, world, scale });
      visit(o.children, world, scale);
    }
  };
  visit(scene.objects, [0, 0, 0], 1);
  return out;
}

// Timeline keys that move / scale objects or the camera.
function trackValues(scene: SceneDoc, target: string): unknown[] {
  return (scene.timeline?.tracks ?? []).filter((t) => t?.target === target).flatMap((t) => (t.keys ?? []).map((k) => k?.[1]));
}

// Every camera position the scene can show (fixed, scroll path, timeline keys).
function cameraPositions(scene: SceneDoc): Vec3[] {
  const cam = scene.camera;
  const list: Vec3[] = [v3(cam?.position, 5)];
  for (const s of cam?.scrollPath ?? []) if (Array.isArray(s?.position)) list.push(v3(s.position, 5));
  for (const v of trackValues(scene, "camera.position")) if (Array.isArray(v) && v.length === 3) list.push(v as Vec3);
  return list;
}

// Closest camera distance to a point, with zoom-in controls taken into account.
function closestDistance(scene: SceneDoc, point: Vec3, objectId: string, radius: number): { d: number; note?: string } {
  const cam = scene.camera;
  let d = Math.min(...cameraPositions(scene).map((c) => dist(c, point)));
  let note: string | undefined;
  if (cam?.controls === "follow" && cam.follow) {
    const off = v3(cam.follow.offset, 0);
    const f = Math.hypot(...off) || d;
    if (cam.follow.target === objectId) d = f;
    else d = Math.min(d, f);
    note = "follow camera";
  }
  if (cam?.controls === "orbit" && cam.orbitZoom !== false) {
    const min = Number(cam.orbitLimits?.minDistance);
    const zoomed = Number.isFinite(min) && min > 0 ? min : d * 0.6;
    if (zoomed < d) {
      d = zoomed;
      note = "orbit zoom";
    }
  }
  if (cam?.controls === "parallax") d *= 0.9;
  // Distance to the nearest surface, not the centre.
  return { d: Math.max(d - radius * 0.5, radius * 0.35, Number(cam?.near) || 0.1), note };
}

function projectedPixels(scene: SceneDoc, vp: Viewport, size: number, d: number): number {
  const cam = scene.camera;
  if (cam?.type === "orthographic") {
    const visible = Number(cam.zoom) > 0 ? Number(cam.zoom) : 10;
    return (size * vp.height) / visible;
  }
  const fovs = [Number(cam?.fov) || 45, ...trackValues(scene, "camera.fov").map(Number).filter((x) => x > 0)];
  const fov = Math.min(...fovs);
  const visible = 2 * d * Math.tan(((fov * Math.PI) / 180) / 2);
  return (size * vp.height) / Math.max(visible, 1e-3);
}

// ─── Planning ───────────────────────────────────────────────────────────

export interface SizingContext {
  library?: LibraryIndex;
  // Also plan "library:<id>" textures / models (export --optimize sizes the exported copies).
  includeLibrary?: boolean;
}

export interface SizingPlan {
  viewport: Viewport;
  // Project path → decision (standalone textures and .glb models).
  files: Map<string, SizeDecision>;
  // .glb path → per-role decision for its embedded images (colour / normal / data).
  modelRoles: Map<string, Partial<Record<TextureRole, SizeDecision>>>;
}

async function objectSize(fs: ProjectFs, o: ObjectDef, ctx: SizingContext): Promise<number> {
  switch (o.kind) {
    case "mesh":
      return geometrySize(o.geometry);
    case "text":
      return Math.max(1, (Number(o.size) || 1) * Math.max(1, String(o.text ?? "").split("\n").reduce((m, l) => Math.max(m, l.length), 0)) * 0.65);
    case "model": {
      if (typeof o.fit === "number" && o.fit > 0) return o.fit;
      if (isLibraryRef(o.src)) {
        const s = findLibraryAsset(ctx.library, libraryId(o.src))?.size;
        if (s) return Math.max(...s);
      } else {
        const b = await modelFileBounds(fs, String(o.src ?? "")).catch(() => null);
        if (b) return Math.max(...b.size);
      }
      return 1;
    }
    default:
      return 1;
  }
}

// Merges one more use into a decision (the largest need wins).
function decide(cur: SizeDecision | undefined, use: TextureUse, tiers: readonly number[], min: number, max: number): SizeDecision {
  const tier = pickTier(use.pixels, tiers, min, max);
  if (!cur) return { maxSize: tier, reason: `${use.why} → ${tier} px`, uses: [use] };
  const uses = [...cur.uses, use];
  const head = tier > cur.maxSize ? `${use.why} → ${tier} px` : cur.reason.replace(/ \(largest of \d+ uses\)$/, "");
  return { maxSize: Math.max(tier, cur.maxSize), reason: `${head} (largest of ${uses.length} uses)`, uses };
}

function addUse(map: Map<string, SizeDecision>, path: string, use: TextureUse, tiers: readonly number[], min: number, max: number) {
  map.set(path, decide(map.get(path), use, tiers, min, max));
}

const round = (n: number) => Math.round(n);

export async function planTextureSizes(fs: ProjectFs, scene: SceneDoc, ctx: SizingContext = {}): Promise<SizingPlan> {
  const vp = sceneViewport(scene);
  const files = new Map<string, SizeDecision>();
  const modelRoles = new Map<string, Partial<Record<TextureRole, SizeDecision>>>();
  const max = MAX_TIER[vp.kind];
  const where = `${vp.kind} ${vp.width}x${vp.height}`;

  for (const { object: o, world, scale } of placeObjects(scene)) {
    const base = (await objectSize(fs, o, ctx)) * scale;
    // Timeline scale keys can grow the object.
    const scaleKeys = trackValues(scene, `${o.id}.scale`).map(scaleOf);
    const grown = base * Math.max(1, ...scaleKeys);
    // Timeline position keys can bring it closer.
    const points: Vec3[] = [world, ...trackValues(scene, `${o.id}.position`).filter((v) => Array.isArray(v) && v.length === 3).map((v) => v as Vec3)];
    let best: { d: number; note?: string } = { d: Infinity };
    for (const p of points) {
      const c = closestDistance(scene, p, o.id, grown);
      if (c.d < best.d) best = c;
    }
    const projected = Math.min(projectedPixels(scene, vp, grown, best.d), Math.max(vp.width, vp.height) * 1.5);
    const dist = `${grown.toFixed(2)} u at ${best.d.toFixed(1)} u${best.note ? ` (${best.note})` : ""}`;

    if (o.kind === "model" && typeof o.src === "string" && (ctx.includeLibrary || !isLibraryRef(o.src)) && /\.glb$/i.test(o.src)) {
      const roles = modelRoles.get(o.src) ?? {};
      for (const role of ["color", "normal", "data"] as TextureRole[]) {
        const pixels = projected * MODEL_ATLAS_FACTOR * ROLE_FACTOR[role] * MARGIN;
        const use: TextureUse = { at: `objects#${o.id}.src`, role, pixels: round(pixels), why: `${role} atlas of model "${o.id}", ${dist} ≈ ${round(projected)} px on a ${where} canvas` };
        roles[role] = decide(roles[role], use, TEXTURE_TIERS, role === "color" ? MIN_COLOR_TIER[vp.kind] : 256, max);
      }
      modelRoles.set(o.src, roles);
      // The file-level decision is the colour one (reported in plans).
      addUse(files, o.src, { at: `objects#${o.id}.src`, role: "color", pixels: round(projected * MODEL_ATLAS_FACTOR * MARGIN), why: `model "${o.id}", ${dist} ≈ ${round(projected)} px on a ${where} canvas` }, TEXTURE_TIERS, MIN_COLOR_TIER[vp.kind], max);
    }

    const mat = (o as { material?: MaterialDef }).material;
    if (mat && typeof mat === "object") {
      const rep = Array.isArray(mat.repeat) ? Math.max(1, ...mat.repeat.map((x) => Math.abs(Number(x) || 1))) : 1;
      const maps: [keyof MaterialDef, TextureRole][] = [["map", "color"], ["normalMap", "normal"], ["roughnessMap", "data"]];
      for (const [k, role] of maps) {
        const path = mat[k];
        if (typeof path !== "string" || (isLibraryRef(path) && !ctx.includeLibrary)) continue;
        const pixels = (projected / rep) * ROLE_FACTOR[role] * MARGIN;
        addUse(files, path, { at: `objects#${o.id}.material.${k}`, role, pixels: round(pixels), why: `${k} of "${o.id}", ${dist}${rep > 1 ? `, repeat ${rep}` : ""} ≈ ${round(projected / rep)} px per tile on a ${where} canvas` }, TEXTURE_TIERS, role === "color" ? MIN_COLOR_TIER[vp.kind] : 256, max);
      }
    }
  }

  // Equirect backgrounds / lighting images (.hdr / .exr are never re-encoded).
  const env = scene.environment;
  const bg = env?.background as { hdri?: unknown; blur?: unknown } | undefined;
  if (bg && typeof bg === "object" && typeof bg.hdri === "string" && (ctx.includeLibrary || !isLibraryRef(bg.hdri))) {
    const fov = Number(scene.camera?.fov) || 45;
    const hfov = (2 * Math.atan(Math.tan(((fov * Math.PI) / 180) / 2) * (vp.width / vp.height)) * 180) / Math.PI;
    const blur = Math.max(0, Number(bg.blur) || 0);
    const pixels = ((vp.width * 360) / Math.max(hfov, 10)) / (1 + blur * 8);
    addUse(files, bg.hdri, { at: "environment.background.hdri", role: "background", pixels: round(pixels), why: `equirect background seen ${round(hfov)}° wide on a ${where} canvas${blur ? `, blur ${blur}` : ""} needs ≈ ${round(pixels)} px` }, BACKGROUND_TIERS, 1024, 4096);
  }
  const lighting = env?.lighting as { hdri?: unknown } | undefined;
  if (lighting && typeof lighting === "object" && typeof lighting.hdri === "string" && (ctx.includeLibrary || !isLibraryRef(lighting.hdri))) {
    addUse(files, lighting.hdri, { at: "environment.lighting.hdri", role: "lighting", pixels: 1024, why: "image-based lighting only (prefiltered to a 256 px cube map)" }, BACKGROUND_TIERS, 1024, 1024);
  }
  return { viewport: vp, files, modelRoles };
}

// ─── Image headers (size + alpha capability without decoding) ──────────

export interface ImageHeader {
  width: number;
  height: number;
  mimeType: "image/png" | "image/jpeg" | "image/webp";
  alpha: boolean | "maybe"; // PNG colour type / WebP flags; JPEG never
}

export function imageHeader(bytes: Uint8Array): ImageHeader | null {
  const b = bytes;
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  if (b.byteLength > 24 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) {
    const colorType = b[25];
    return { width: dv.getUint32(16), height: dv.getUint32(20), mimeType: "image/png", alpha: colorType === 4 || colorType === 6 ? "maybe" : colorType === 3 ? "maybe" : false };
  }
  if (b.byteLength > 4 && b[0] === 0xff && b[1] === 0xd8) {
    let off = 2;
    while (off + 9 < b.byteLength) {
      if (b[off] !== 0xff) {
        off++;
        continue;
      }
      const marker = b[off + 1];
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
        off += 2;
        continue;
      }
      const len = dv.getUint16(off + 2);
      if ((marker >= 0xc0 && marker <= 0xcf) && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { height: dv.getUint16(off + 5), width: dv.getUint16(off + 7), mimeType: "image/jpeg", alpha: false };
      }
      off += 2 + len;
    }
    return null;
  }
  if (b.byteLength > 30 && String.fromCharCode(b[0], b[1], b[2], b[3]) === "RIFF" && String.fromCharCode(b[8], b[9], b[10], b[11]) === "WEBP") {
    const chunk = String.fromCharCode(b[12], b[13], b[14], b[15]);
    if (chunk === "VP8 ") return { width: dv.getUint16(26, true) & 0x3fff, height: dv.getUint16(28, true) & 0x3fff, mimeType: "image/webp", alpha: false };
    if (chunk === "VP8L") {
      const v = dv.getUint32(21, true);
      return { width: (v & 0x3fff) + 1, height: ((v >> 14) & 0x3fff) + 1, mimeType: "image/webp", alpha: (v >> 28) & 1 ? "maybe" : false };
    }
    if (chunk === "VP8X") {
      const w = 1 + (b[24] | (b[25] << 8) | (b[26] << 16));
      const h = 1 + (b[27] | (b[28] << 8) | (b[29] << 16));
      return { width: w, height: h, mimeType: "image/webp", alpha: b[20] & 0x10 ? "maybe" : false };
    }
  }
  return null;
}

// ─── Suggestions for `check` ────────────────────────────────────────────

export interface OptimizeSuggestions {
  // Project .glb models over 50 KB without meshopt geometry compression.
  models: { path: string; kb: number }[];
  // Textures at least twice as large (longest side) as the scene needs.
  textures: { path: string; size: number; maxSize: number; kb: number }[];
}

const kb = (n: number) => Math.round(n / 102.4) / 10;

// Cheap (image headers + GLB JSON only, no meshoptimizer): which project
// assets `assets optimize` would clearly shrink.
export async function optimizeSuggestions(fs: ProjectFs, scene: SceneDoc, opts: SizingContext = {}): Promise<OptimizeSuggestions> {
  const out: OptimizeSuggestions = { models: [], textures: [] };
  const files = (await fs.list("assets/")).filter((f) => /\.(png|jpe?g|webp|glb)$/i.test(f));
  if (!files.length) return out;
  const sizing = await planTextureSizes(fs, scene, opts);
  for (const path of files) {
    const bytes = await fs.readBytes(path);
    if (/\.glb$/i.test(path)) {
      if (bytes.byteLength < 50 * 1024) continue;
      const json = glbJson(bytes) as { extensionsUsed?: string[]; meshes?: unknown[]; accessors?: { sparse?: unknown }[] } | null;
      const used = json?.extensionsUsed ?? [];
      if (json && json.meshes?.length && !used.includes("EXT_meshopt_compression") && !used.includes("KHR_draco_mesh_compression") && !(json.accessors ?? []).some((a) => a.sparse)) out.models.push({ path, kb: kb(bytes.byteLength) });
      continue;
    }
    const h = imageHeader(bytes);
    const d = sizing.files.get(path);
    if (h && d && Math.max(h.width, h.height) >= d.maxSize * 2) out.textures.push({ path, size: Math.max(h.width, h.height), maxSize: d.maxSize, kb: kb(bytes.byteLength) });
  }
  return out;
}
