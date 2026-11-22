// Scene validation — structural checks of every field of SceneDoc
// (src/core/types.ts) plus catalog checks (src/core/catalog.ts): unknown ids
// get a "did you mean" suggestion, params are checked for type / range /
// enum, unknown fields and params are warnings with suggestions.
//
// Messages are written for an AI agent to act on: they say what is wrong,
// what to change and list the valid options. Paths use the object id form
// ("objects#logo.material.roughness") whenever an object has a valid id.

import { isValidAspect } from "./aspect";
import { CATALOG, catalogEntry, materialPreset, type CatalogEntry, type CatalogSection, type ParamSpec } from "./catalog";
import { isValidColor } from "./color";
import { ID_RE, isValidId } from "./ids";
import { isLibraryRef, libraryId } from "./library";
import { closest, didYouMean, listOptions } from "./suggest";
import type { Issue, SceneDoc, TargetKind, ObjectDef, TrackDef } from "./types";
import { SCENE_VERSION } from "./types";

// ─── Enumerations (kept next to the validator; types.ts is the contract) ──

export const TARGET_KINDS: readonly TargetKind[] = ["banner", "hero", "card", "square", "fullscreen", "inline", "game"];
export const OBJECT_KINDS = ["mesh", "text", "model", "group", "generator", "particles", "instances", "svg"] as const;
export const LIGHT_TYPES = ["ambient", "directional", "point", "spot", "hemisphere", "rect"] as const;
export const MATERIAL_TYPES = ["standard", "physical", "basic", "lambert", "toon", "normal", "matcap", "gradient", "shader"] as const;
export const EASES = [
  "linear", "inQuad", "outQuad", "inOutQuad", "inCubic", "outCubic", "inOutCubic", "inSine", "outSine", "inOutSine",
  "inExpo", "outExpo", "inOutExpo", "inBack", "outBack", "inOutBack", "outElastic", "outBounce", "step",
] as const;
export const LIGHTING_PRESETS = ["studio", "soft", "sunset", "night", "neutral", "none"] as const;
export const CAMERA_CONTROLS = ["none", "orbit", "parallax", "scroll", "follow"] as const;
export const UI_ANCHORS = ["top-left", "top", "top-right", "left", "center", "right", "bottom-left", "bottom", "bottom-right"] as const;
export const BEHAVIOUR_WHEN = ["always", "hover", "click", "visible", "scroll"] as const;
export const TIMELINE_TRIGGERS = ["load", "visible", "hover", "click", "scroll"] as const;
export const TONE_MAPPINGS = ["none", "aces", "agx", "neutral", "reinhard"] as const;

export const DEFAULT_ASPECT: Record<TargetKind, string> = {
  banner: "4:1",
  hero: "16:9",
  card: "4:5",
  square: "1:1",
  inline: "16:9",
  fullscreen: "16:9",
  game: "16:9",
};

// Bundle budget (KB, runtime excluded) per target kind — `check` warns above.
export const DEFAULT_BUDGET_KB: Record<TargetKind, number> = {
  banner: 600,
  hero: 1500,
  card: 400,
  square: 600,
  inline: 600,
  fullscreen: 4000,
  game: 4000,
};

const MODEL_EXT = [".glb", ".gltf"];
const TEXTURE_EXT = [".png", ".jpg", ".jpeg", ".webp", ".ktx2", ".avif"];
const HDRI_EXT = [".hdr", ".exr", ".jpg", ".jpeg", ".png", ".webp"];
const AUDIO_EXT = [".mp3", ".ogg", ".wav", ".m4a", ".aac", ".opus", ".webm"];
const SVG_EXT = [".svg"];

// Allowed keys per section (unknown keys → warnings with suggestions).
const BASE_OBJECT_KEYS = ["id", "kind", "name", "visible", "castShadow", "receiveShadow", "behaviours", "children", "tags", "body", "href", "userData", "position", "rotation", "scale"];
const OBJECT_KEYS: Record<(typeof OBJECT_KINDS)[number], string[]> = {
  mesh: ["geometry", "material"],
  text: ["text", "font", "size", "depth", "bevel", "align", "letterSpacing", "lineHeight", "material"],
  model: ["src", "fit", "center", "animation", "material"],
  group: [],
  generator: ["generator", "params", "seed", "material"],
  particles: ["preset", "count", "area", "size", "color", "speed", "direction", "spread", "lifetime", "opacity", "blending", "shape", "seed"],
  instances: ["geometry", "material", "layout", "colors"],
  svg: ["src", "size", "depth", "bevel", "material"],
};
const SCENE_KEYS = ["version", "id", "title", "description", "target", "camera", "environment", "lights", "objects", "timeline", "postfx", "physics", "scripts", "ui", "audio", "data", "ariaLabel", "seed"];
const TARGET_KEYS = ["kind", "aspect", "budgetKb", "height", "transparent", "lazy", "pauseOffscreen", "maxDpr", "reducedMotion", "posterTime", "antialias", "shadows", "toneMapping", "exposure"];
const CAMERA_KEYS = ["type", "fov", "zoom", "position", "target", "near", "far", "controls", "autoRotate", "orbitZoom", "orbitLimits", "parallax", "scrollPath", "follow"];
const ENV_KEYS = ["background", "lighting", "lightingIntensity", "fog", "ground"];
const LIGHT_KEYS = ["id", "type", "color", "intensity", "position", "target", "castShadow", "skyColor", "groundColor", "distance", "decay", "angle", "penumbra", "width", "height", "behaviours"];
const MATERIAL_KEYS = [
  "preset", "type", "color", "metalness", "roughness", "emissive", "emissiveIntensity", "opacity", "transparent", "wireframe", "flatShading", "side",
  "transmission", "thickness", "ior", "clearcoat", "iridescence", "sheen", "map", "normalMap", "roughnessMap", "repeat", "gradient", "shader", "uniforms",
];
const BODY_KEYS = ["type", "shape", "size", "radius", "mass", "restitution", "friction", "velocity", "fixedRotation"];
const TIMELINE_KEYS = ["duration", "loop", "autoplay", "trigger", "tracks"];
const UI_ELEMENT_KEYS = ["id", "type", "text", "anchor", "style", "value", "action", "visible"];

// Animatable track properties.
const VEC3_PROPS = ["position", "rotation", "scale"];
const AXIS = ["x", "y", "z"];
const MATERIAL_TRACK_PROPS: Record<string, "number" | "color" | "boolean"> = {
  opacity: "number",
  color: "color",
  emissive: "color",
  emissiveIntensity: "number",
  metalness: "number",
  roughness: "number",
  transmission: "number",
  iridescence: "number",
  clearcoat: "number",
  wireframe: "boolean",
};
const CAMERA_TRACK_PROPS: Record<string, "vec3" | "number"> = { position: "vec3", target: "vec3", fov: "number", zoom: "number" };
const LIGHT_TRACK_PROPS: Record<string, "vec3" | "number" | "color" | "boolean"> = { intensity: "number", color: "color", position: "vec3", target: "vec3", visible: "boolean", angle: "number", distance: "number" };

// Array-of-points params (element shape).
const POINT_PARAMS: Record<string, { dims: 2 | 3; min: number }> = {
  "geometries.lathe.points": { dims: 2, min: 2 },
  "geometries.extrude.shape": { dims: 2, min: 3 },
  "geometries.tube.points": { dims: 3, min: 2 },
  "behaviours.path.points": { dims: 3, min: 2 },
};

// ─── Validator state ─────────────────────────────────────────────────────

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === "object" && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const typeName = (v: unknown) => (v === null ? "null" : Array.isArray(v) ? "array" : typeof v);
const show = (v: unknown) => {
  const s = JSON.stringify(v);
  return s === undefined ? String(v) : s.length > 60 ? `${s.slice(0, 57)}…` : s;
};

class V {
  issues: Issue[] = [];
  ids = new Map<string, string>(); // id → path where first declared
  objectIds = new Set<string>();
  lightIds = new Set<string>();

  add(severity: Issue["severity"], code: string, path: string, message: string, hint?: string) {
    this.issues.push(hint ? { severity, code, path, message, hint } : { severity, code, path, message });
  }
  error(code: string, path: string, message: string, hint?: string) {
    this.add("error", code, path, message, hint);
  }
  warn(code: string, path: string, message: string, hint?: string) {
    this.add("warning", code, path, message, hint);
  }
  info(code: string, path: string, message: string, hint?: string) {
    this.add("info", code, path, message, hint);
  }

  // ── primitive checks (return true when the value is valid) ──

  required(o: Obj, key: string, path: string, what: string): boolean {
    if (o[key] === undefined || o[key] === null) {
      this.error("required", join(path, key), `Missing required field "${key}" (${what}).`, `Add "${key}": ${what}.`);
      return false;
    }
    return true;
  }

  number(v: unknown, path: string, opts: { min?: number; max?: number; integer?: boolean; exclusiveMin?: boolean } = {}): boolean {
    if (v === undefined) return true;
    if (!isNum(v)) {
      this.error("type", path, `Expected a number, got ${typeName(v)} ${show(v)}.`, `Set ${lastKey(path)} to a number${rangeText(opts)}.`);
      return false;
    }
    if (opts.integer && !Number.isInteger(v)) {
      this.error("type", path, `Expected an integer, got ${v}.`, `Use a whole number, e.g. ${Math.round(v)}.`);
      return false;
    }
    if (opts.min !== undefined && (opts.exclusiveMin ? v <= opts.min : v < opts.min)) {
      this.error("range", path, `${v} is below the minimum (${opts.exclusiveMin ? ">" : "≥"} ${opts.min}).`, `Use a value${rangeText(opts)}.`);
      return false;
    }
    if (opts.max !== undefined && v > opts.max) {
      this.error("range", path, `${v} is above the maximum (${opts.max}).`, `Use a value${rangeText(opts)}.`);
      return false;
    }
    return true;
  }

  boolean(v: unknown, path: string): boolean {
    if (v === undefined || typeof v === "boolean") return true;
    this.error("type", path, `Expected true or false, got ${typeName(v)} ${show(v)}.`, `Set ${lastKey(path)} to true or false.`);
    return false;
  }

  string(v: unknown, path: string, opts: { nonEmpty?: boolean } = {}): boolean {
    if (v === undefined) return true;
    if (typeof v !== "string") {
      this.error("type", path, `Expected a string, got ${typeName(v)} ${show(v)}.`);
      return false;
    }
    if (opts.nonEmpty && !v.trim()) {
      this.error("required", path, "Must not be empty.");
      return false;
    }
    return true;
  }

  enumOf(v: unknown, options: readonly string[], path: string): boolean {
    if (v === undefined) return true;
    if (typeof v === "string" && options.includes(v)) return true;
    const dym = typeof v === "string" ? didYouMean(v, options) : "";
    this.error("enum", path, `Invalid value ${show(v)}.`, `${dym}Valid values: ${listOptions(options)}.`);
    return false;
  }

  color(v: unknown, path: string): boolean {
    if (v === undefined) return true;
    if (isValidColor(v)) return true;
    this.error("color", path, `Invalid colour ${show(v)}.`, 'Use a CSS colour: "#ff8800", "#f80", "rgb(255,136,0)", "hsl(30 100% 50%)" or a CSS name like "tomato".');
    return false;
  }

  colors(v: unknown, path: string, min = 1): boolean {
    if (v === undefined) return true;
    if (!Array.isArray(v)) {
      this.error("type", path, `Expected an array of colours, got ${typeName(v)}.`, 'Example: ["#ff006e", "#3a86ff"].');
      return false;
    }
    if (v.length < min) this.error("required", path, `Needs at least ${min} colour${min > 1 ? "s" : ""}.`, 'Example: ["#ff006e", "#3a86ff"].');
    let ok = v.length >= min;
    v.forEach((c, i) => (ok = this.color(c, `${path}[${i}]`) && ok));
    return ok;
  }

  vec(v: unknown, dims: 2 | 3, path: string): boolean {
    if (v === undefined) return true;
    if (!Array.isArray(v) || v.length !== dims || !v.every(isNum)) {
      const ex = dims === 3 ? "[0, 1.5, 0]" : "[1, 1]";
      this.error("vec", path, `Expected [${dims === 3 ? "x, y, z" : "x, y"}] (${dims} numbers), got ${show(v)}.`, `Write it as an array of ${dims} numbers, e.g. ${ex}.`);
      return false;
    }
    return true;
  }

  stringArray(v: unknown, path: string): boolean {
    if (v === undefined) return true;
    if (!Array.isArray(v) || !v.every((x) => typeof x === "string")) {
      this.error("type", path, `Expected an array of strings, got ${show(v)}.`);
      return false;
    }
    return true;
  }

  unknownKeys(o: Obj, allowed: readonly string[], path: string, what: string) {
    for (const k of Object.keys(o)) {
      if (allowed.includes(k)) continue;
      const s = closest(k, allowed);
      this.warn("unknown-field", join(path, k), `Unknown field "${k}" on ${what} (ignored by the runtime).`, s ? `Did you mean "${s}"? Otherwise remove it.` : `Remove it. Valid fields: ${listOptions(allowed)}.`);
    }
  }

  assetPath(v: unknown, path: string, exts: readonly string[], what: string): boolean {
    if (v === undefined) return true;
    if (typeof v !== "string" || !v.trim()) {
      this.error("type", path, `Expected an asset path string for ${what}, got ${show(v)}.`, 'Use a project path like "assets/models/fox.glb" or a library id like "library:models/nature/pine-tree.glb".');
      return false;
    }
    const problem = assetPathProblem(v);
    if (problem) {
      this.error("asset-path", path, `Invalid asset path "${v}": ${problem.message}`, problem.hint);
      return false;
    }
    if (!isLibraryRef(v)) {
      const lower = v.toLowerCase().split("?")[0];
      if (!exts.some((e) => lower.endsWith(e))) {
        this.error("asset-path", path, `"${v}" does not look like ${what} (expected ${exts.join(", ")}).`, `Point ${lastKey(path)} at a ${exts.join(" / ")} file.`);
        return false;
      }
    }
    return true;
  }

  declareId(id: unknown, path: string, what: "object" | "light" | "ui"): boolean {
    if (typeof id !== "string" || !ID_RE.test(id)) {
      this.error("invalid-id", path, `Invalid ${what} id ${show(id)}.`, `Ids start with a letter and use letters, digits, "_" or "-" (regex ${ID_RE.source}), e.g. "logo" or "tree-1".`);
      return false;
    }
    if (what !== "ui") {
      const prev = this.ids.get(id);
      if (prev) {
        this.error("duplicate-id", path, `Duplicate id "${id}" (already used at ${prev}).`, `Ids are unique across objects (including children) and lights. Rename this one, e.g. "${id}-2".`);
        return false;
      }
      this.ids.set(id, path);
      (what === "object" ? this.objectIds : this.lightIds).add(id);
    }
    return true;
  }

  // ── catalog params ──

  params(section: CatalogSection, entry: CatalogEntry, params: Obj, path: string, reserved: readonly string[] = []) {
    const names = entry.params.map((p) => p.name);
    for (const spec of entry.params) {
      const v = params[spec.name];
      const p = join(path, spec.name);
      if (v === undefined) {
        if (spec.required) this.error("required", p, `${sectionLabel(section)} "${entry.id}" requires "${spec.name}" (${spec.description}).`, `Add "${spec.name}" (${spec.type}).`);
        continue;
      }
      this.param(`${section}.${entry.id}.${spec.name}`, spec, v, p, entry.id);
    }
    for (const k of Object.keys(params)) {
      if (names.includes(k) || reserved.includes(k)) continue;
      const s = closest(k, names);
      this.warn(
        "unknown-param",
        join(path, k),
        `Unknown parameter "${k}" for ${sectionLabel(section)} "${entry.id}" (ignored).`,
        `${s ? `Did you mean "${s}"? ` : ""}${names.length ? `Valid parameters: ${listOptions(names)}.` : `"${entry.id}" takes no parameters — remove it.`}`,
      );
    }
  }

  param(key: string, spec: ParamSpec, v: unknown, path: string, entryId: string): boolean {
    if (v === null && /null/.test(spec.description)) return true;
    const pts = POINT_PARAMS[key];
    if (pts) return this.points(v, pts.dims, pts.min, path);
    switch (spec.type) {
      case "number":
        return this.number(v, path, { min: spec.min, max: spec.max });
      case "integer":
        return this.number(v, path, { min: spec.min, max: spec.max, integer: true });
      case "boolean":
        return this.boolean(v, path);
      case "string":
        return this.string(v, path);
      case "color":
        return this.color(v, path);
      case "colors":
        return this.colors(v, path);
      case "vec2":
        return this.vec(v, 2, path);
      case "vec3":
        return this.vec(v, 3, path);
      case "enum":
        if (!this.enumOf(v, spec.options ?? [], path)) return false;
        return true;
      case "object":
        if (!isObj(v)) {
          this.error("type", path, `Expected an object for "${spec.name}" of "${entryId}", got ${typeName(v)}.`);
          return false;
        }
        return true;
      case "array":
        if (!Array.isArray(v)) {
          this.error("type", path, `Expected an array for "${spec.name}" of "${entryId}", got ${typeName(v)}.`, spec.description);
          return false;
        }
        return true;
    }
    return true;
  }

  points(v: unknown, dims: 2 | 3, min: number, path: string): boolean {
    if (!Array.isArray(v)) {
      this.error("type", path, `Expected an array of [${dims === 2 ? "x, y" : "x, y, z"}] points, got ${typeName(v)}.`, dims === 2 ? "Example: [[0, 0], [0.5, 0.2], [0.3, 1]]." : "Example: [[0, 0, 0], [1, 1, 0], [2, 0, 1]].");
      return false;
    }
    if (v.length < min) this.error("required", path, `Needs at least ${min} points, got ${v.length}.`);
    let ok = v.length >= min;
    v.forEach((p, i) => (ok = this.vec(p, dims, `${path}[${i}]`) && ok));
    return ok;
  }
}

function join(path: string, key: string): string {
  return path ? `${path}.${key}` : key;
}
function lastKey(path: string): string {
  const m = /([^.#[\]]+)(?:\[\d+\])*$/.exec(path);
  return m ? `"${m[1]}"` : "the value";
}
function rangeText(o: { min?: number; max?: number; exclusiveMin?: boolean }): string {
  if (o.min !== undefined && o.max !== undefined) return ` between ${o.min} and ${o.max}`;
  if (o.min !== undefined) return o.exclusiveMin ? ` greater than ${o.min}` : ` ≥ ${o.min}`;
  if (o.max !== undefined) return ` ≤ ${o.max}`;
  return "";
}
function sectionLabel(s: CatalogSection): string {
  return (
    {
      geometries: "geometry",
      materialPresets: "material preset",
      shaders: "shader",
      behaviours: "behaviour",
      generators: "generator",
      particlePresets: "particle preset",
      postfx: "post effect",
      fonts: "font",
      sounds: "sound",
    } as const
  )[s];
}

// Asset path syntax: project-relative ("assets/x.glb") or "library:<id>".
export function assetPathProblem(p: string): { message: string; hint: string } | null {
  if (isLibraryRef(p)) {
    const id = libraryId(p);
    if (!/^[a-z0-9][a-z0-9._/-]*$/i.test(id) || id.includes("..") || id.endsWith("/")) {
      return { message: "library ids look like \"library:<path in the library>\".", hint: 'List valid ids with library_list (CLI: agent3d assets library), e.g. "library:models/nature/pine-tree.glb".' };
    }
    return null;
  }
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(p) || p.startsWith("//")) {
    return { message: "remote URLs are not allowed (exports never hotlink).", hint: "Download the file into the project first (assets_search + assets_add, CLI: agent3d assets search|add) and use its assets/… path." };
  }
  if (p.startsWith("data:") || p.startsWith("blob:")) {
    return { message: "inline data URIs are not allowed in scene.json.", hint: "Save the file under assets/ and reference its path." };
  }
  if (p.startsWith("/") || /^[a-zA-Z]:/.test(p) || p.includes("\\")) {
    return { message: "paths must be relative to the project folder, with forward slashes.", hint: 'Use e.g. "assets/textures/wood.jpg".' };
  }
  if (p.split("/").includes("..")) return { message: '".." is not allowed: assets must live inside the project.', hint: "Copy the file into assets/ and reference it from there." };
  return null;
}

// ─── Scene walk ──────────────────────────────────────────────────────────

export function validateScene(scene: unknown): Issue[] {
  const v = new V();
  if (!isObj(scene)) {
    v.error("type", "", `A scene must be a JSON object, got ${typeName(scene)}.`, "Start from scene_get / `agent3d scene get` or a template.");
    return v.issues;
  }
  const s = scene as Obj;
  v.unknownKeys(s, SCENE_KEYS, "", "the scene");

  if (s.version !== SCENE_VERSION) v.error(s.version === undefined ? "required" : "enum", "version", `Scene "version" must be ${SCENE_VERSION}, got ${show(s.version)}.`, `Set "version": ${SCENE_VERSION}.`);
  if (v.required(s, "id", "", 'a short identifier, e.g. "spring-banner"')) v.string(s.id, "id", { nonEmpty: true });
  if (v.required(s, "title", "", "a human title")) v.string(s.title, "title", { nonEmpty: true });
  v.string(s.description, "description");
  v.string(s.ariaLabel, "ariaLabel");
  v.number(s.seed, "seed", { integer: true });
  if (s.data !== undefined && !isObj(s.data)) v.error("type", "data", "scene.data must be an object.", 'Example: "data": { "levels": [] }.');

  if (v.required(s, "target", "", '{ "kind": "banner", "aspect": "4:1" }')) target(v, s.target);
  if (v.required(s, "camera", "", '{ "type": "perspective", "position": [0, 0, 8] }')) camera(v, s.camera, "camera");
  if (v.required(s, "environment", "", '{ "background": "#101020" }')) environment(v, s.environment);

  // Declare ids first (lights + objects) so references resolve regardless of order.
  if (s.lights === undefined) v.error("required", "lights", 'Missing "lights" array.', 'Add "lights": [] (or lights like { "type": "directional", "position": [5, 8, 5] }).');
  else if (!Array.isArray(s.lights)) v.error("type", "lights", "lights must be an array.");
  if (s.objects === undefined) v.error("required", "objects", 'Missing "objects" array.', 'Add "objects": [].');
  else if (!Array.isArray(s.objects)) v.error("type", "objects", "objects must be an array.");

  const lights = Array.isArray(s.lights) ? s.lights : [];
  lights.forEach((l, i) => light(v, l, `lights[${i}]`));
  const objects = Array.isArray(s.objects) ? s.objects : [];
  objects.forEach((o, i) => object(v, o, `objects[${i}]`));

  // References now that every id is known.
  cameraRefs(v, s.camera);
  if (s.timeline !== undefined) timeline(v, s.timeline);
  if (s.postfx !== undefined) postfx(v, s.postfx);
  if (s.physics !== undefined) physics(v, s.physics);
  if (s.scripts !== undefined) scripts(v, s.scripts);
  if (s.ui !== undefined) ui(v, s.ui);
  if (s.audio !== undefined) audio(v, s.audio);

  if (lights.length === 0 && isObj(s.environment) && (s.environment.lighting === "none" || s.environment.lighting === undefined) && objects.length > 0) {
    v.warn("no-lights", "lights", "The scene has no lights and no environment lighting: lit materials (standard, physical, toon…) will render black.", 'Add lights (e.g. { "type": "hemisphere", "intensity": 1 } and a directional key light) or set environment.lighting to "studio".');
  }
  return v.issues;
}

function target(v: V, t: unknown) {
  if (!isObj(t)) return v.error("type", "target", "target must be an object.", 'Example: { "kind": "banner", "aspect": "4:1" }.');
  v.unknownKeys(t, TARGET_KEYS, "target", "target");
  if (v.required(t, "kind", "target", `one of ${listOptions(TARGET_KINDS)}`)) v.enumOf(t.kind, TARGET_KINDS, "target.kind");
  if (v.required(t, "aspect", "target", '"W:H", e.g. "4:1"')) {
    if (!isValidAspect(t.aspect)) v.error("aspect", "target.aspect", `Invalid aspect ${show(t.aspect)}.`, `Use "W:H" with positive numbers, e.g. "4:1" (banner), "16:9" (hero), "1:1" (square)${typeof t.kind === "string" && t.kind in DEFAULT_ASPECT ? `; default for ${t.kind}: "${DEFAULT_ASPECT[t.kind as TargetKind]}"` : ""}.`);
  }
  v.number(t.budgetKb, "target.budgetKb", { min: 0, exclusiveMin: true });
  if (t.height !== undefined && (typeof t.height !== "string" || !/^\d+(\.\d+)?(px|vh|vw|rem|em|%|svh|dvh|lvh)$/.test(t.height.trim()))) {
    v.error("type", "target.height", `Invalid CSS height ${show(t.height)}.`, 'Use a CSS length like "320px", "60vh" or "20rem" — or remove it to keep the aspect ratio.');
  }
  for (const k of ["transparent", "lazy", "pauseOffscreen", "antialias", "shadows"]) v.boolean(t[k], `target.${k}`);
  v.number(t.maxDpr, "target.maxDpr", { min: 0.5, max: 4 });
  v.enumOf(t.reducedMotion, ["static", "slow", "ignore"], "target.reducedMotion");
  v.number(t.posterTime, "target.posterTime", { min: 0 });
  v.enumOf(t.toneMapping, TONE_MAPPINGS, "target.toneMapping");
  v.number(t.exposure, "target.exposure", { min: 0, exclusiveMin: true, max: 10 });
}

function camera(v: V, c: unknown, path: string) {
  if (!isObj(c)) return v.error("type", path, "camera must be an object.", 'Example: { "type": "perspective", "fov": 40, "position": [0, 1, 8], "target": [0, 0, 0] }.');
  v.unknownKeys(c, CAMERA_KEYS, path, "the camera");
  if (v.required(c, "type", path, '"perspective" or "orthographic"')) v.enumOf(c.type, ["perspective", "orthographic"], `${path}.type`);
  if (v.required(c, "position", path, "[x, y, z] in units")) v.vec(c.position, 3, `${path}.position`);
  v.vec(c.target, 3, `${path}.target`);
  v.number(c.fov, `${path}.fov`, { min: 1, max: 179 });
  if (c.fov !== undefined && c.type === "orthographic") v.warn("ignored", `${path}.fov`, "fov is ignored by an orthographic camera.", 'Use "zoom" (world units visible vertically) instead.');
  v.number(c.zoom, `${path}.zoom`, { min: 0, exclusiveMin: true });
  v.number(c.near, `${path}.near`, { min: 0, exclusiveMin: true });
  v.number(c.far, `${path}.far`, { min: 0, exclusiveMin: true });
  if (isNum(c.near) && isNum(c.far) && c.far <= c.near) v.error("range", `${path}.far`, `far (${c.far}) must be greater than near (${c.near}).`, "Typical values: near 0.1, far 1000.");
  if (Array.isArray(c.position) && Array.isArray(c.target) && c.position.length === 3 && c.target.length === 3 && c.position.every((x, i) => x === (c.target as unknown[])[i])) {
    v.error("range", `${path}.position`, "camera.position equals camera.target: the camera has no direction.", "Move the camera back, e.g. position [0, 1, 8] looking at [0, 0, 0].");
  }
  v.enumOf(c.controls, CAMERA_CONTROLS, `${path}.controls`);
  v.number(c.autoRotate, `${path}.autoRotate`);
  v.boolean(c.orbitZoom, `${path}.orbitZoom`);
  if (c.orbitLimits !== undefined) {
    if (!isObj(c.orbitLimits)) v.error("type", `${path}.orbitLimits`, "orbitLimits must be an object.");
    else {
      v.unknownKeys(c.orbitLimits, ["minDistance", "maxDistance", "minPolar", "maxPolar"], `${path}.orbitLimits`, "orbitLimits");
      v.number(c.orbitLimits.minDistance, `${path}.orbitLimits.minDistance`, { min: 0 });
      v.number(c.orbitLimits.maxDistance, `${path}.orbitLimits.maxDistance`, { min: 0 });
      v.number(c.orbitLimits.minPolar, `${path}.orbitLimits.minPolar`, { min: 0, max: 180 });
      v.number(c.orbitLimits.maxPolar, `${path}.orbitLimits.maxPolar`, { min: 0, max: 180 });
    }
  }
  if (c.parallax !== undefined) {
    if (!isObj(c.parallax)) v.error("type", `${path}.parallax`, "parallax must be an object.", 'Example: { "strength": 0.5, "smoothing": 0.9 }.');
    else {
      v.unknownKeys(c.parallax, ["strength", "smoothing"], `${path}.parallax`, "parallax");
      v.number(c.parallax.strength, `${path}.parallax.strength`, { min: 0 });
      v.number(c.parallax.smoothing, `${path}.parallax.smoothing`, { min: 0, max: 0.99 });
    }
  }
  if (c.scrollPath !== undefined) {
    if (!Array.isArray(c.scrollPath)) v.error("type", `${path}.scrollPath`, "scrollPath must be an array of { position, target? }.");
    else
      c.scrollPath.forEach((p, i) => {
        const pp = `${path}.scrollPath[${i}]`;
        if (!isObj(p)) return v.error("type", pp, "Expected { position: [x,y,z], target?: [x,y,z] }.");
        if (v.required(p, "position", pp, "[x, y, z]")) v.vec(p.position, 3, `${pp}.position`);
        v.vec(p.target, 3, `${pp}.target`);
      });
  }
  if (c.controls === "scroll" && (!Array.isArray(c.scrollPath) || c.scrollPath.length < 2)) {
    v.error("required", `${path}.scrollPath`, 'controls "scroll" needs a scrollPath with at least 2 points.', 'Add "scrollPath": [{ "position": [0, 1, 8] }, { "position": [4, 2, 4], "target": [0, 0, 0] }].');
  }
  if (c.follow !== undefined) {
    if (!isObj(c.follow)) v.error("type", `${path}.follow`, "follow must be an object.", 'Example: { "target": "player", "offset": [0, 3, 6] }.');
    else {
      v.unknownKeys(c.follow, ["target", "offset", "smoothing", "lookAhead"], `${path}.follow`, "follow");
      if (v.required(c.follow, "target", `${path}.follow`, "the id of the object to follow")) v.string(c.follow.target, `${path}.follow.target`);
      v.vec(c.follow.offset, 3, `${path}.follow.offset`);
      v.number(c.follow.smoothing, `${path}.follow.smoothing`, { min: 0, max: 0.99 });
      v.number(c.follow.lookAhead, `${path}.follow.lookAhead`, { min: 0 });
    }
  }
  if (c.controls === "follow" && c.follow === undefined) v.error("required", `${path}.follow`, 'controls "follow" needs camera.follow.', 'Add "follow": { "target": "<object id>", "offset": [0, 3, 6] }.');
}

function cameraRefs(v: V, c: unknown) {
  if (!isObj(c) || !isObj(c.follow) || typeof c.follow.target !== "string") return;
  if (!v.objectIds.has(c.follow.target)) {
    v.error("unknown-ref", "camera.follow.target", `camera.follow.target "${c.follow.target}" is not an object id.`, `${didYouMean(c.follow.target, v.objectIds)}Object ids: ${listOptions([...v.objectIds])}.`);
  }
}

function environment(v: V, e: unknown) {
  if (!isObj(e)) return v.error("type", "environment", "environment must be an object.", 'Example: { "background": { "gradient": ["#0f0c29", "#302b63"] }, "lighting": "studio" }.');
  v.unknownKeys(e, ENV_KEYS, "environment", "environment");
  if (v.required(e, "background", "environment", 'a colour, "transparent", { gradient: [...] }, { radial: [...] }, { sky: {...} } or { hdri: "assets/…" }')) background(v, e.background);
  if (e.lighting !== undefined) {
    if (typeof e.lighting === "string") v.enumOf(e.lighting, LIGHTING_PRESETS, "environment.lighting");
    else if (isObj(e.lighting)) {
      v.unknownKeys(e.lighting, ["hdri", "intensity"], "environment.lighting", "environment.lighting");
      if (v.required(e.lighting, "hdri", "environment.lighting", "an .hdr/.exr path or library id")) v.assetPath(e.lighting.hdri, "environment.lighting.hdri", HDRI_EXT, "an HDRI");
      v.number(e.lighting.intensity, "environment.lighting.intensity", { min: 0 });
    } else v.error("type", "environment.lighting", `Invalid lighting ${show(e.lighting)}.`, `Use a preset (${listOptions(LIGHTING_PRESETS)}) or { "hdri": "assets/hdris/x.hdr" }.`);
  }
  v.number(e.lightingIntensity, "environment.lightingIntensity", { min: 0 });
  if (e.fog !== undefined) {
    const f = e.fog;
    if (!isObj(f)) v.error("type", "environment.fog", "fog must be an object.", 'Use { "color": "#ccd", "near": 10, "far": 50 } (linear) or { "color": "#ccd", "density": 0.03 } (exponential).');
    else {
      v.unknownKeys(f, ["color", "near", "far", "density"], "environment.fog", "fog");
      v.color(f.color, "environment.fog.color");
      if (f.density !== undefined) v.number(f.density, "environment.fog.density", { min: 0, max: 1 });
      v.number(f.near, "environment.fog.near", { min: 0 });
      v.number(f.far, "environment.fog.far", { min: 0 });
      if (isNum(f.near) && isNum(f.far) && f.far <= f.near) v.error("range", "environment.fog.far", "fog.far must be greater than fog.near.");
    }
  }
  if (e.ground !== undefined) {
    const g = e.ground;
    if (!isObj(g)) v.error("type", "environment.ground", "ground must be an object.", 'Example: { "y": 0, "shadowOnly": true }.');
    else {
      v.unknownKeys(g, ["y", "size", "color", "shadowOnly", "grid", "roughness"], "environment.ground", "ground");
      v.number(g.y, "environment.ground.y");
      v.number(g.size, "environment.ground.size", { min: 0, exclusiveMin: true });
      v.color(g.color, "environment.ground.color");
      v.boolean(g.shadowOnly, "environment.ground.shadowOnly");
      v.boolean(g.grid, "environment.ground.grid");
      v.number(g.roughness, "environment.ground.roughness", { min: 0, max: 1 });
    }
  }
}

function background(v: V, b: unknown) {
  const p = "environment.background";
  if (typeof b === "string") {
    if (b !== "transparent") v.color(b, p);
    return;
  }
  if (!isObj(b)) return v.error("type", p, `Invalid background ${show(b)}.`, 'Use a colour ("#101020"), "transparent", { "gradient": ["#a", "#b"], "angle": 0 }, { "radial": [...] }, { "sky": {...} } or { "hdri": "assets/hdris/x.hdr" }.');
  const keys = Object.keys(b);
  const kind = ["gradient", "radial", "sky", "hdri"].find((k) => k in b);
  if (!kind) return v.error("type", p, `Background object needs one of "gradient", "radial", "sky" or "hdri" (got keys ${listOptions(keys)}).`, 'Example: { "gradient": ["#0f0c29", "#302b63", "#24243e"], "angle": 0 }.');
  if (kind === "gradient") {
    v.unknownKeys(b, ["gradient", "angle"], p, "a gradient background");
    v.colors(b.gradient, `${p}.gradient`, 2);
    v.number(b.angle, `${p}.angle`);
  } else if (kind === "radial") {
    v.unknownKeys(b, ["radial"], p, "a radial background");
    v.colors(b.radial, `${p}.radial`, 2);
  } else if (kind === "sky") {
    v.unknownKeys(b, ["sky"], p, "a sky background");
    const sky = b.sky;
    if (!isObj(sky)) return v.error("type", `${p}.sky`, "sky must be an object.", 'Example: { "top": "#4a90d9", "horizon": "#f6d6a8", "sun": { "direction": [1, 0.4, 0.2] } }.');
    v.unknownKeys(sky, ["top", "horizon", "bottom", "sun", "stars"], `${p}.sky`, "sky");
    v.color(sky.top, `${p}.sky.top`);
    v.color(sky.horizon, `${p}.sky.horizon`);
    v.color(sky.bottom, `${p}.sky.bottom`);
    v.number(sky.stars, `${p}.sky.stars`, { min: 0, integer: true, max: 100000 });
    if (sky.sun !== undefined && sky.sun !== false) {
      if (!isObj(sky.sun)) v.error("type", `${p}.sky.sun`, "sun must be an object or false.");
      else {
        v.unknownKeys(sky.sun, ["direction", "color", "size"], `${p}.sky.sun`, "sun");
        v.vec(sky.sun.direction, 3, `${p}.sky.sun.direction`);
        v.color(sky.sun.color, `${p}.sky.sun.color`);
        v.number(sky.sun.size, `${p}.sky.sun.size`, { min: 0 });
      }
    }
  } else {
    v.unknownKeys(b, ["hdri", "blur"], p, "an HDRI background");
    v.assetPath(b.hdri, `${p}.hdri`, HDRI_EXT, "an HDRI");
    v.number(b.blur, `${p}.blur`, { min: 0, max: 1 });
  }
}

function light(v: V, l: unknown, path: string) {
  if (!isObj(l)) return v.error("type", path, "A light must be an object.", 'Example: { "type": "directional", "position": [5, 8, 5], "intensity": 2 }.');
  const p = l.id !== undefined && isValidId(l.id) ? `lights#${l.id}` : path;
  if (l.id !== undefined) v.declareId(l.id, `${p}.id`, "light");
  v.unknownKeys(l, LIGHT_KEYS, p, `a ${typeof l.type === "string" ? l.type : ""} light`.replace("  ", " "));
  if (v.required(l, "type", p, `one of ${listOptions(LIGHT_TYPES)}`)) v.enumOf(l.type, LIGHT_TYPES, `${p}.type`);
  v.color(l.color, `${p}.color`);
  v.number(l.intensity, `${p}.intensity`, { min: 0 });
  v.vec(l.position, 3, `${p}.position`);
  v.vec(l.target, 3, `${p}.target`);
  v.boolean(l.castShadow, `${p}.castShadow`);
  v.color(l.skyColor, `${p}.skyColor`);
  v.color(l.groundColor, `${p}.groundColor`);
  v.number(l.distance, `${p}.distance`, { min: 0 });
  v.number(l.decay, `${p}.decay`, { min: 0 });
  v.number(l.angle, `${p}.angle`, { min: 0, max: 90 });
  v.number(l.penumbra, `${p}.penumbra`, { min: 0, max: 1 });
  v.number(l.width, `${p}.width`, { min: 0 });
  v.number(l.height, `${p}.height`, { min: 0 });
  if ((l.type === "directional" || l.type === "spot" || l.type === "point" || l.type === "rect") && l.position === undefined) {
    v.info("default", `${p}.position`, `This ${l.type} light has no position (the runtime uses a default).`, "Set position [x, y, z] explicitly so lighting is predictable, e.g. [5, 8, 5].");
  }
  if (l.castShadow && (l.type === "ambient" || l.type === "hemisphere" || l.type === "rect")) v.warn("ignored", `${p}.castShadow`, `${l.type} lights cannot cast shadows.`, "Use a directional, spot or point light for shadows.");
  behaviours(v, l.behaviours, `${p}.behaviours`);
}

function objectPath(o: Obj, fallback: string): string {
  return isValidId(o.id) ? `objects#${o.id}` : fallback;
}

function object(v: V, o: unknown, fallback: string) {
  if (!isObj(o)) return v.error("type", fallback, "An object must be a JSON object.", 'Example: { "id": "box", "kind": "mesh", "geometry": { "type": "box" } }.');
  const p = objectPath(o, fallback);
  v.declareId(o.id, `${p}.id`, "object");
  const kind = o.kind;
  if (!v.required(o, "kind", p, `one of ${listOptions(OBJECT_KINDS)}`)) return;
  if (!OBJECT_KINDS.includes(kind as never)) {
    v.error("enum", `${p}.kind`, `Unknown object kind ${show(kind)}.`, `${typeof kind === "string" ? didYouMean(kind, OBJECT_KINDS) : ""}Valid kinds: ${listOptions(OBJECT_KINDS)}.`);
    return;
  }
  const k = kind as (typeof OBJECT_KINDS)[number];
  v.unknownKeys(o, [...BASE_OBJECT_KEYS, ...OBJECT_KEYS[k]], p, `a "${k}" object`);
  // Common fields.
  v.string(o.name, `${p}.name`);
  v.boolean(o.visible, `${p}.visible`);
  v.boolean(o.castShadow, `${p}.castShadow`);
  v.boolean(o.receiveShadow, `${p}.receiveShadow`);
  v.vec(o.position, 3, `${p}.position`);
  v.vec(o.rotation, 3, `${p}.rotation`);
  if (Array.isArray(o.rotation) && o.rotation.every(isNum) && o.rotation.some((x) => x !== 0) && o.rotation.every((x) => Math.abs(x as number) <= 2 * Math.PI + 1e-6) && o.rotation.some((x) => !Number.isInteger(x))) {
    v.warn("radians", `${p}.rotation`, `rotation ${show(o.rotation)} looks like radians.`, `Angles are in DEGREES. E.g. ${show((o.rotation as number[]).map((x) => Math.round((x * 180) / Math.PI)))}.`);
  }
  if (o.scale !== undefined) {
    if (isNum(o.scale)) v.number(o.scale, `${p}.scale`, { min: 0, exclusiveMin: true });
    else v.vec(o.scale, 3, `${p}.scale`);
  }
  v.stringArray(o.tags, `${p}.tags`);
  if (o.href !== undefined) {
    if (typeof o.href !== "string" || !o.href.trim()) v.error("type", `${p}.href`, "href must be a URL string.");
    else if (/^\s*javascript:/i.test(o.href)) v.error("forbidden", `${p}.href`, "javascript: links are not allowed.", 'Use an http(s) URL, a relative page path or "#anchor".');
  }
  if (o.userData !== undefined && !isObj(o.userData)) v.error("type", `${p}.userData`, "userData must be an object.");
  if (o.body !== undefined) body(v, o.body, `${p}.body`);
  behaviours(v, o.behaviours, `${p}.behaviours`);

  switch (k) {
    case "mesh":
      if (v.required(o, "geometry", p, '{ "type": "box" } (see catalog geometries)')) geometry(v, o.geometry, `${p}.geometry`);
      material(v, o.material, `${p}.material`);
      break;
    case "text":
      if (v.required(o, "text", p, "the text to display")) v.string(o.text, `${p}.text`, { nonEmpty: true });
      if (o.font !== undefined) catalogRef(v, "fonts", o.font, `${p}.font`);
      v.number(o.size, `${p}.size`, { min: 0, exclusiveMin: true });
      v.number(o.depth, `${p}.depth`, { min: 0 });
      v.number(o.bevel, `${p}.bevel`, { min: 0 });
      v.enumOf(o.align, ["left", "center", "right"], `${p}.align`);
      v.number(o.letterSpacing, `${p}.letterSpacing`);
      v.number(o.lineHeight, `${p}.lineHeight`, { min: 0, exclusiveMin: true });
      material(v, o.material, `${p}.material`);
      break;
    case "model":
      if (v.required(o, "src", p, 'a .glb/.gltf path ("assets/models/fox.glb") or "library:<id>"')) v.assetPath(o.src, `${p}.src`, MODEL_EXT, "a glTF model");
      v.number(o.fit, `${p}.fit`, { min: 0, exclusiveMin: true });
      v.boolean(o.center, `${p}.center`);
      if (o.animation !== undefined) {
        const a = o.animation;
        if (!isObj(a)) v.error("type", `${p}.animation`, "animation must be an object.", 'Example: { "clip": "Walk", "loop": true }.');
        else {
          v.unknownKeys(a, ["clip", "loop", "speed", "crossfade"], `${p}.animation`, "animation");
          if (a.clip !== undefined && typeof a.clip !== "string" && !(isNum(a.clip) && Number.isInteger(a.clip) && a.clip >= 0)) v.error("type", `${p}.animation.clip`, "clip must be a clip name or a clip index (integer ≥ 0).");
          v.boolean(a.loop, `${p}.animation.loop`);
          v.number(a.speed, `${p}.animation.speed`);
          v.number(a.crossfade, `${p}.animation.crossfade`, { min: 0 });
        }
      }
      material(v, o.material, `${p}.material`);
      break;
    case "group":
      if (!Array.isArray(o.children) || !o.children.length) v.info("empty-group", p, `Group "${String(o.id)}" has no children.`, "Add children or remove the group.");
      break;
    case "generator": {
      if (!v.required(o, "generator", p, `a catalog generator id (${listOptions(CATALOG.generators.map((g) => g.id))})`)) break;
      const entry = catalogRef(v, "generators", o.generator, `${p}.generator`);
      if (o.params !== undefined && !isObj(o.params)) v.error("type", `${p}.params`, "params must be an object.");
      else if (entry) v.params("generators", entry, (o.params as Obj) ?? {}, `${p}.params`);
      v.number(o.seed, `${p}.seed`, { integer: true });
      if (o.material !== undefined) {
        material(v, o.material, `${p}.material`);
        if (entry && !entry.material) {
          const ok = CATALOG.generators.filter((g) => g.material).map((g) => g.id);
          v.warn("ignored", `${p}.material`, `The "${entry.id}" generator ignores "material" (it uses its colour params).`, `Use its colour params (agent3d catalog generators ${entry.id}); material overrides work on: ${listOptions(ok)}.`);
        }
      }
      break;
    }
    case "particles":
      if (o.preset !== undefined) catalogRef(v, "particlePresets", o.preset, `${p}.preset`);
      v.number(o.count, `${p}.count`, { integer: true, min: 1, max: 200000 });
      v.vec(o.area, 3, `${p}.area`);
      v.number(o.size, `${p}.size`, { min: 0, exclusiveMin: true });
      if (Array.isArray(o.color)) v.colors(o.color, `${p}.color`);
      else v.color(o.color, `${p}.color`);
      v.number(o.speed, `${p}.speed`, { min: 0 });
      v.vec(o.direction, 3, `${p}.direction`);
      v.number(o.spread, `${p}.spread`, { min: 0, max: 1 });
      v.number(o.lifetime, `${p}.lifetime`, { min: 0, exclusiveMin: true });
      v.number(o.opacity, `${p}.opacity`, { min: 0, max: 1 });
      v.enumOf(o.blending, ["normal", "additive"], `${p}.blending`);
      v.enumOf(o.shape, ["point", "square", "circle", "star", "spark"], `${p}.shape`);
      v.number(o.seed, `${p}.seed`, { integer: true });
      if (o.preset === undefined && o.count === undefined) v.info("default", p, "Particles without preset or count use runtime defaults.", `Set a preset (${listOptions(CATALOG.particlePresets.map((x) => x.id))}) and/or count.`);
      break;
    case "instances":
      if (v.required(o, "geometry", p, '{ "type": "box" }')) geometry(v, o.geometry, `${p}.geometry`);
      material(v, o.material, `${p}.material`);
      if (v.required(o, "layout", p, '{ "type": "grid" | "scatter" | "circle" | "list", … }')) layout(v, o.layout, `${p}.layout`);
      v.colors(o.colors, `${p}.colors`);
      break;
    case "svg":
      if (v.required(o, "src", p, 'inline "<svg …>" markup or a project .svg path')) {
        if (typeof o.src !== "string") v.error("type", `${p}.src`, "src must be a string.");
        else if (!/^\s*(<svg|<\?xml)/i.test(o.src)) v.assetPath(o.src, `${p}.src`, SVG_EXT, "an SVG file");
      }
      v.number(o.size, `${p}.size`, { min: 0, exclusiveMin: true });
      v.number(o.depth, `${p}.depth`, { min: 0 });
      v.number(o.bevel, `${p}.bevel`, { min: 0 });
      material(v, o.material, `${p}.material`);
      break;
  }

  if (o.children !== undefined) {
    if (!Array.isArray(o.children)) v.error("type", `${p}.children`, "children must be an array of objects.");
    else o.children.forEach((c, i) => object(v, c, `${p}.children[${i}]`));
  }
}

function catalogRef(v: V, section: Exclude<CatalogSection, "materialPresets">, id: unknown, path: string): CatalogEntry | undefined {
  const ids = (CATALOG[section] as CatalogEntry[]).map((x) => x.id);
  if (typeof id !== "string") {
    v.error("type", path, `Expected a ${sectionLabel(section)} id string, got ${typeName(id)}.`, `Valid ids: ${listOptions(ids)}.`);
    return undefined;
  }
  const entry = catalogEntry(section, id);
  if (!entry) v.error("unknown-id", path, `Unknown ${sectionLabel(section)} "${id}".`, `${didYouMean(id, ids)}Valid ids: ${listOptions(ids)} (catalog_get section "${section}").`);
  return entry;
}

function geometry(v: V, g: unknown, path: string) {
  if (!isObj(g)) return v.error("type", path, "geometry must be an object.", 'Example: { "type": "sphere", "radius": 0.5 }.');
  if (!v.required(g, "type", path, `a catalog geometry (${listOptions(CATALOG.geometries.map((x) => x.id))})`)) return;
  const entry = catalogRef(v, "geometries", g.type, `${path}.type`);
  if (entry) v.params("geometries", entry, g, path, ["type"]);
}

function material(v: V, m: unknown, path: string) {
  if (m === undefined) return;
  if (typeof m === "string") {
    // Convenience the runtime doesn't support: tell the agent the right shape.
    const preset = materialPreset(m);
    return v.error("type", path, `material must be an object, got the string ${show(m)}.`, preset ? `Write { "preset": "${m}" }.` : isValidColor(m) ? `Write { "color": "${m}" }.` : 'Write { "preset": "plastic", "color": "#ff8800" }.');
  }
  if (!isObj(m)) return v.error("type", path, "material must be an object.", 'Example: { "preset": "gold" } or { "color": "#ff8800", "roughness": 0.4 }.');
  v.unknownKeys(m, MATERIAL_KEYS, path, "a material");
  if (m.preset !== undefined) {
    const ids = CATALOG.materialPresets.map((x) => x.id);
    if (typeof m.preset !== "string" || !materialPreset(m.preset)) {
      v.error("unknown-id", `${path}.preset`, `Unknown material preset ${show(m.preset)}.`, `${typeof m.preset === "string" ? didYouMean(m.preset, ids) : ""}Valid presets: ${listOptions(ids)}.`);
    }
  }
  v.enumOf(m.type, MATERIAL_TYPES, `${path}.type`);
  v.color(m.color, `${path}.color`);
  v.color(m.emissive, `${path}.emissive`);
  v.number(m.emissiveIntensity, `${path}.emissiveIntensity`, { min: 0 });
  for (const k of ["metalness", "roughness", "opacity", "transmission", "clearcoat", "iridescence", "sheen"]) v.number(m[k], `${path}.${k}`, { min: 0, max: 1 });
  v.number(m.thickness, `${path}.thickness`, { min: 0 });
  v.number(m.ior, `${path}.ior`, { min: 1, max: 2.333 });
  for (const k of ["transparent", "wireframe", "flatShading"]) v.boolean(m[k], `${path}.${k}`);
  v.enumOf(m.side, ["front", "back", "double"], `${path}.side`);
  for (const k of ["map", "normalMap", "roughnessMap"]) v.assetPath(m[k], `${path}.${k}`, TEXTURE_EXT, "a texture image");
  v.vec(m.repeat, 2, `${path}.repeat`);
  if (m.gradient !== undefined) v.colors(m.gradient, `${path}.gradient`, 2);
  if (m.type === "gradient" && m.gradient === undefined) v.error("required", `${path}.gradient`, 'material type "gradient" needs a "gradient" colour list.', 'Add "gradient": ["#ff7eb3", "#7afcff"].');
  if (isNum(m.opacity) && m.opacity < 1 && m.transparent !== true && !(m.transmission !== undefined)) {
    v.info("opacity", `${path}.opacity`, `opacity ${m.opacity} has no effect unless "transparent": true.`, 'Add "transparent": true to the material.');
  }
  const isShader = m.type === "shader";
  if (m.shader !== undefined) {
    const entry = catalogRef(v, "shaders", m.shader, `${path}.shader`);
    if (!isShader) v.warn("ignored", `${path}.shader`, `"shader" is only used when material.type is "shader" (type is ${show(m.type ?? "unset")}).`, 'Set "type": "shader".');
    if (entry && m.uniforms !== undefined) {
      if (!isObj(m.uniforms)) v.error("type", `${path}.uniforms`, "uniforms must be an object.");
      else v.params("shaders", entry, m.uniforms, `${path}.uniforms`);
    }
  } else if (isShader) {
    v.error("required", `${path}.shader`, 'material type "shader" needs a "shader" id.', `Add "shader": one of ${listOptions(CATALOG.shaders.map((x) => x.id))}.`);
  } else if (m.uniforms !== undefined) {
    v.warn("ignored", `${path}.uniforms`, "uniforms are only used by shader materials.", 'Set "type": "shader" and "shader": "<id>", or remove uniforms.');
  }
}

function behaviours(v: V, list: unknown, path: string) {
  if (list === undefined) return;
  if (!Array.isArray(list)) return v.error("type", path, "behaviours must be an array.", 'Example: [{ "type": "rotate", "speed": 30 }].');
  list.forEach((b, i) => {
    const p = `${path}[${i}]`;
    if (!isObj(b)) return v.error("type", p, "A behaviour must be an object.", 'Example: { "type": "float", "amplitude": 0.2 }.');
    if (!v.required(b, "type", p, `a catalog behaviour (${listOptions(CATALOG.behaviours.map((x) => x.id))})`)) return;
    const entry = catalogRef(v, "behaviours", b.type, `${p}.type`);
    v.enumOf(b.when, BEHAVIOUR_WHEN, `${p}.when`);
    v.number(b.delay, `${p}.delay`, { min: 0 });
    if (entry) v.params("behaviours", entry, b, p, ["type", "when", "delay"]);
  });
}

function layout(v: V, l: unknown, path: string) {
  if (!isObj(l)) return v.error("type", path, "layout must be an object.", 'Example: { "type": "grid", "count": [5, 1, 5], "spacing": [1.2, 0, 1.2] }.');
  const types = ["grid", "scatter", "circle", "list"];
  if (!v.required(l, "type", path, listOptions(types)) || !v.enumOf(l.type, types, `${path}.type`)) return;
  switch (l.type) {
    case "grid":
      v.unknownKeys(l, ["type", "count", "spacing"], path, "a grid layout");
      if (v.required(l, "count", path, "[nx, ny, nz]") && v.vec(l.count, 3, `${path}.count`)) {
        if (!(l.count as number[]).every((x) => Number.isInteger(x) && x >= 1)) v.error("range", `${path}.count`, "grid count values must be integers ≥ 1.", "Use 1 for a flat axis, e.g. [8, 1, 8].");
      }
      if (v.required(l, "spacing", path, "[sx, sy, sz]")) v.vec(l.spacing, 3, `${path}.spacing`);
      break;
    case "scatter":
      v.unknownKeys(l, ["type", "count", "area", "minScale", "maxScale", "randomRotation", "seed"], path, "a scatter layout");
      if (v.required(l, "count", path, "number of instances")) v.number(l.count, `${path}.count`, { integer: true, min: 1, max: 200000 });
      if (v.required(l, "area", path, "[x, y, z] box size")) v.vec(l.area, 3, `${path}.area`);
      v.number(l.minScale, `${path}.minScale`, { min: 0 });
      v.number(l.maxScale, `${path}.maxScale`, { min: 0 });
      v.boolean(l.randomRotation, `${path}.randomRotation`);
      v.number(l.seed, `${path}.seed`, { integer: true });
      break;
    case "circle":
      v.unknownKeys(l, ["type", "count", "radius"], path, "a circle layout");
      if (v.required(l, "count", path, "number of instances")) v.number(l.count, `${path}.count`, { integer: true, min: 1, max: 200000 });
      if (v.required(l, "radius", path, "circle radius")) v.number(l.radius, `${path}.radius`, { min: 0 });
      break;
    case "list":
      v.unknownKeys(l, ["type", "items"], path, "a list layout");
      if (!v.required(l, "items", path, "[{ position, rotation?, scale? }, …]")) break;
      if (!Array.isArray(l.items)) v.error("type", `${path}.items`, "items must be an array of transforms.");
      else
        l.items.forEach((it, i) => {
          const ip = `${path}.items[${i}]`;
          if (!isObj(it)) return v.error("type", ip, "Expected { position?, rotation?, scale? }.");
          v.unknownKeys(it, ["position", "rotation", "scale"], ip, "a transform");
          v.vec(it.position, 3, `${ip}.position`);
          v.vec(it.rotation, 3, `${ip}.rotation`);
          if (it.scale !== undefined && !isNum(it.scale)) v.vec(it.scale, 3, `${ip}.scale`);
        });
      break;
  }
}

function body(v: V, b: unknown, path: string) {
  if (!isObj(b)) return v.error("type", path, "body must be an object.", 'Example: { "type": "dynamic", "shape": "box", "mass": 1 }.');
  v.unknownKeys(b, BODY_KEYS, path, "a physics body");
  if (v.required(b, "type", path, '"static" | "dynamic" | "kinematic" | "trigger"')) v.enumOf(b.type, ["static", "dynamic", "kinematic", "trigger"], `${path}.type`);
  v.enumOf(b.shape, ["box", "sphere", "auto"], `${path}.shape`);
  v.vec(b.size, 3, `${path}.size`);
  v.number(b.radius, `${path}.radius`, { min: 0, exclusiveMin: true });
  v.number(b.mass, `${path}.mass`, { min: 0 });
  v.number(b.restitution, `${path}.restitution`, { min: 0, max: 1 });
  v.number(b.friction, `${path}.friction`, { min: 0 });
  v.vec(b.velocity, 3, `${path}.velocity`);
  v.boolean(b.fixedRotation, `${path}.fixedRotation`);
}

// ─── Timeline ────────────────────────────────────────────────────────────

type ValueKind = "vec3" | "number" | "color" | "boolean" | "number|vec3";

// Resolves a track target to the kind of value its keys must hold.
export function trackValueKind(target: string, ids: { objects: Set<string>; lights: Set<string> }): { kind?: ValueKind; error?: { message: string; hint: string } } {
  const dot = target.indexOf(".");
  if (dot < 1) return { error: { message: `Track target "${target}" must be "<id>.<property>".`, hint: 'Examples: "logo.position", "logo.rotation.y", "logo.material.opacity", "camera.position", "key.intensity".' } };
  const head = target.slice(0, dot);
  const prop = target.slice(dot + 1);
  const parts = prop.split(".");
  if (head === "camera") {
    const k = CAMERA_TRACK_PROPS[prop];
    if (prop.match(/^(position|target)\.[xyz]$/)) return { kind: "number" };
    if (!k) return { error: { message: `Camera property "${prop}" is not animatable.`, hint: `${didYouMean(prop, Object.keys(CAMERA_TRACK_PROPS))}Use one of: ${listOptions(Object.keys(CAMERA_TRACK_PROPS))} (or position.x …).` } };
    return { kind: k };
  }
  if (ids.lights.has(head) && !ids.objects.has(head)) {
    const k = LIGHT_TRACK_PROPS[prop];
    if (prop.match(/^(position|target)\.[xyz]$/)) return { kind: "number" };
    if (!k) return { error: { message: `Light property "${prop}" is not animatable.`, hint: `${didYouMean(prop, Object.keys(LIGHT_TRACK_PROPS))}Use one of: ${listOptions(Object.keys(LIGHT_TRACK_PROPS))}.` } };
    return { kind: k };
  }
  if (!ids.objects.has(head)) {
    const all = [...ids.objects, ...ids.lights, "camera"];
    return { error: { message: `Track target "${target}" refers to "${head}", which is not an object id, a light id or "camera".`, hint: `${didYouMean(head, all)}Known ids: ${listOptions(all)}.` } };
  }
  if (VEC3_PROPS.includes(parts[0])) {
    if (parts.length === 1) return { kind: parts[0] === "scale" ? "number|vec3" : "vec3" };
    if (parts.length === 2 && AXIS.includes(parts[1])) return { kind: "number" };
  }
  if (prop === "visible") return { kind: "boolean" };
  if (parts[0] === "material") {
    if (parts.length === 2 && MATERIAL_TRACK_PROPS[parts[1]]) return { kind: MATERIAL_TRACK_PROPS[parts[1]] };
    if (parts.length === 3 && parts[1] === "uniforms") return { kind: "number" };
  }
  const options = ["position", "position.x", "rotation", "rotation.y", "scale", "visible", ...Object.keys(MATERIAL_TRACK_PROPS).map((k) => `material.${k}`), "material.uniforms.<name>"];
  return { error: { message: `Property "${prop}" of "${head}" is not animatable.`, hint: `${didYouMean(prop, options)}Animatable: ${listOptions(options)}.` } };
}

function keyValueOk(kind: ValueKind, value: unknown): boolean {
  switch (kind) {
    case "vec3":
      return Array.isArray(value) && value.length === 3 && value.every(isNum);
    case "number":
      return isNum(value);
    case "color":
      return isValidColor(value);
    case "boolean":
      return typeof value === "boolean";
    case "number|vec3":
      return isNum(value) || (Array.isArray(value) && value.length === 3 && value.every(isNum));
  }
}

const KIND_EXAMPLE: Record<ValueKind, string> = { vec3: "[0, 1, 0]", number: "1.5", color: '"#ff8800"', boolean: "true", "number|vec3": "1.2 or [1, 2, 1]" };

function timeline(v: V, t: unknown) {
  if (!isObj(t)) return v.error("type", "timeline", "timeline must be an object.", 'Example: { "duration": 4, "loop": true, "tracks": [] }.');
  v.unknownKeys(t, TIMELINE_KEYS, "timeline", "the timeline");
  if (v.required(t, "duration", "timeline", "length in seconds")) v.number(t.duration, "timeline.duration", { min: 0, exclusiveMin: true });
  if (t.loop !== undefined && typeof t.loop !== "boolean" && t.loop !== "pingpong") v.error("enum", "timeline.loop", `Invalid loop ${show(t.loop)}.`, 'Use true, false or "pingpong".');
  v.boolean(t.autoplay, "timeline.autoplay");
  v.enumOf(t.trigger, TIMELINE_TRIGGERS, "timeline.trigger");
  if (!v.required(t, "tracks", "timeline", "an array of tracks")) return;
  if (!Array.isArray(t.tracks)) return v.error("type", "timeline.tracks", "tracks must be an array.");
  const duration = isNum(t.duration) ? t.duration : Infinity;
  const seen = new Set<string>();
  t.tracks.forEach((tr, i) => track(v, tr, `timeline.tracks[${i}]`, duration, seen));
}

function track(v: V, tr: unknown, path: string, duration: number, seen: Set<string>) {
  if (!isObj(tr)) return v.error("type", path, "A track must be an object.", 'Example: { "target": "logo.rotation.y", "keys": [[0, 0], [4, 360]], "ease": "inOutSine" }.');
  v.unknownKeys(tr, ["target", "keys", "ease"], path, "a track");
  v.enumOf(tr.ease, EASES, `${path}.ease`);
  let kind: ValueKind | undefined;
  if (v.required(tr, "target", path, '"<id>.<property>"') && v.string(tr.target, `${path}.target`)) {
    const target = tr.target as string;
    if (seen.has(target)) v.warn("duplicate-track", `${path}.target`, `Another track already animates "${target}"; the last one wins.`, "Merge the keys into a single track.");
    seen.add(target);
    const r = trackValueKind(target, { objects: v.objectIds, lights: v.lightIds });
    if (r.error) v.error("track-target", `${path}.target`, r.error.message, r.error.hint);
    kind = r.kind;
  }
  if (!v.required(tr, "keys", path, "[[time, value], …]")) return;
  if (!Array.isArray(tr.keys) || tr.keys.length === 0) return v.error("type", `${path}.keys`, "keys must be a non-empty array of [time, value].", "Example: [[0, [0, 0, 0]], [2, [0, 1, 0]]].");
  let prev = -Infinity;
  let sorted = true;
  (tr.keys as unknown[]).forEach((k, i) => {
    const kp = `${path}.keys[${i}]`;
    if (!Array.isArray(k) || k.length !== 2 || !isNum(k[0])) return v.error("type", kp, `Expected [time, value], got ${show(k)}.`, `Example: [1.5, ${kind ? KIND_EXAMPLE[kind] : "1"}].`);
    const time = k[0] as number;
    if (time < 0) v.error("range", `${kp}[0]`, `Key time ${time} is negative.`, "Times are seconds from 0.");
    if (time < prev) sorted = false;
    prev = Math.max(prev, time);
    if (time > duration) v.warn("range", `${kp}[0]`, `Key time ${time}s is after timeline.duration (${duration}s) and is never reached.`, `Increase timeline.duration to ≥ ${time} or move the key.`);
    if (kind && !keyValueOk(kind, k[1])) v.error("track-value", `${kp}[1]`, `Value ${show(k[1])} does not match "${String(tr.target)}" (expects ${kind}).`, `Use a value like ${KIND_EXAMPLE[kind]}${kind === "vec3" && String(tr.target).match(/rotation$/) ? " (degrees)" : ""}.`);
  });
  if (!sorted) v.error("track-order", `${path}.keys`, "Keys are not sorted by time.", "Sort the [time, value] pairs by ascending time.");
}

// ─── Other sections ──────────────────────────────────────────────────────

function postfx(v: V, list: unknown) {
  if (!Array.isArray(list)) return v.error("type", "postfx", "postfx must be an array.", 'Example: [{ "type": "bloom", "strength": 0.8 }].');
  const seen = new Set<string>();
  list.forEach((fx, i) => {
    const p = `postfx[${i}]`;
    if (!isObj(fx)) return v.error("type", p, "A post effect must be an object.");
    if (!v.required(fx, "type", p, `a catalog post effect (${listOptions(CATALOG.postfx.map((x) => x.id))})`)) return;
    const entry = catalogRef(v, "postfx", fx.type, `${p}.type`);
    if (typeof fx.type === "string") {
      if (seen.has(fx.type)) v.warn("duplicate", `${p}.type`, `Post effect "${fx.type}" appears twice.`, "Keep a single entry.");
      seen.add(fx.type);
    }
    if (entry) v.params("postfx", entry, fx, p, ["type"]);
  });
}

function physics(v: V, ph: unknown) {
  if (!isObj(ph)) return v.error("type", "physics", "physics must be an object.", 'Example: { "gravity": [0, -9.81, 0] }.');
  v.unknownKeys(ph, ["gravity", "step"], "physics", "physics");
  v.vec(ph.gravity, 3, "physics.gravity");
  v.number(ph.step, "physics.step", { min: 0, exclusiveMin: true, max: 0.1 });
}

function scripts(v: V, list: unknown) {
  if (!Array.isArray(list)) return v.error("type", "scripts", "scripts must be an array of paths.", 'Example: ["scripts/game.js"].');
  const seen = new Set<string>();
  list.forEach((s, i) => {
    const p = `scripts[${i}]`;
    if (typeof s !== "string") return v.error("type", p, "A script entry must be a path string.", 'Example: "scripts/game.js".');
    if (!/^scripts\/[A-Za-z0-9_\-./]+\.(m?js)$/.test(s) || s.split("/").includes("..")) {
      return v.error("script-path", p, `Invalid script path "${s}".`, 'Scripts live under scripts/ and end with .js or .mjs, e.g. "scripts/game.js".');
    }
    if (seen.has(s)) v.warn("duplicate", p, `Script "${s}" is listed twice (it would run twice).`, "Remove the duplicate.");
    seen.add(s);
  });
}

function ui(v: V, u: unknown) {
  if (!isObj(u)) return v.error("type", "ui", "ui must be an object.", 'Example: { "elements": [{ "id": "score", "type": "text", "text": "Score: {score}", "anchor": "top-left" }] }.');
  v.unknownKeys(u, ["elements", "font", "color", "accent"], "ui", "ui");
  v.string(u.font, "ui.font");
  if (typeof u.font === "string" && /url\(|@import|https?:/i.test(u.font)) v.error("forbidden", "ui.font", "ui.font must be a CSS font-family list (no web fonts).", 'Use a system stack, e.g. "system-ui, sans-serif".');
  v.color(u.color, "ui.color");
  v.color(u.accent, "ui.accent");
  if (!v.required(u, "elements", "ui", "an array of HUD elements")) return;
  if (!Array.isArray(u.elements)) return v.error("type", "ui.elements", "elements must be an array.");
  const ids = new Set<string>();
  u.elements.forEach((el, i) => {
    let p = `ui.elements[${i}]`;
    if (!isObj(el)) return v.error("type", p, "A UI element must be an object.");
    if (isValidId(el.id)) p = `ui.elements#${el.id}`;
    if (v.declareId(el.id, `${p}.id`, "ui")) {
      if (ids.has(el.id as string)) v.error("duplicate-id", `${p}.id`, `Duplicate UI element id "${String(el.id)}".`, "Give each HUD element a unique id.");
      ids.add(el.id as string);
    }
    v.unknownKeys(el, UI_ELEMENT_KEYS, p, "a UI element");
    if (v.required(el, "type", p, '"text" | "button" | "bar"')) v.enumOf(el.type, ["text", "button", "bar"], `${p}.type`);
    v.string(el.text, `${p}.text`);
    v.enumOf(el.anchor, UI_ANCHORS, `${p}.anchor`);
    v.enumOf(el.style, ["plain", "pill", "title", "subtitle"], `${p}.style`);
    v.string(el.value, `${p}.value`);
    v.string(el.action, `${p}.action`);
    if (el.visible !== undefined && typeof el.visible !== "boolean" && typeof el.visible !== "string") v.error("type", `${p}.visible`, "visible must be a boolean or a state expression string.");
    if (el.type === "bar" && el.value === undefined) v.error("required", `${p}.value`, 'A "bar" needs "value": the state key holding 0..1.', 'Add "value": "health" and set api.state.health in a script.');
    if (el.type === "button" && el.action === undefined) v.error("required", `${p}.action`, 'A "button" needs "action": the event name sent to scripts.', 'Add "action": "start" and handle it with api.on("start", …).');
    if ((el.type === "text" || el.type === "button") && el.text === undefined) v.warn("required", `${p}.text`, `A "${String(el.type)}" element without text shows nothing.`, 'Add "text", e.g. "Score: {score}".');
  });
}

function audio(v: V, a: unknown) {
  if (!isObj(a)) return v.error("type", "audio", "audio must be an object.", 'Example: { "sounds": { "coin": { "preset": "coin" } } }.');
  v.unknownKeys(a, ["sounds", "music", "muted"], "audio", "audio");
  v.boolean(a.muted, "audio.muted");
  const soundIds = CATALOG.sounds.map((s) => s.id);
  const sound = (s: unknown, p: string, music: boolean) => {
    if (!isObj(s)) return v.error("type", p, 'Expected { "preset": "coin" } or { "src": "assets/audio/x.mp3" }.');
    v.unknownKeys(s, music ? ["src", "preset", "volume", "loop"] : ["src", "preset", "volume"], p, music ? "music" : "a sound");
    if (s.preset === undefined && s.src === undefined) return v.error("required", p, 'Needs "preset" (synth) or "src" (audio file).', `Synth presets: ${listOptions(soundIds)}.`);
    if (s.preset !== undefined && s.src !== undefined) v.warn("ambiguous", p, 'Both "preset" and "src" are set; "src" wins.', "Keep only one.");
    if (s.preset !== undefined) catalogRef(v, "sounds", s.preset, `${p}.preset`);
    if (s.src !== undefined) v.assetPath(s.src, `${p}.src`, AUDIO_EXT, "an audio file");
    v.number(s.volume, `${p}.volume`, { min: 0, max: 1 });
    if (music) v.boolean(s.loop, `${p}.loop`);
  };
  if (a.sounds !== undefined) {
    if (!isObj(a.sounds)) v.error("type", "audio.sounds", "sounds must be an object keyed by sound name.");
    else for (const [name, s] of Object.entries(a.sounds)) sound(s, `audio.sounds.${name}`, false);
  }
  if (a.music !== undefined) sound(a.music, "audio.music", true);
}

// ─── Defaults ────────────────────────────────────────────────────────────

// Structural defaults only (never invents lights or content): version, empty
// lights / objects arrays, empty timeline tracks and UI elements. Returns a copy.
export function normalizeScene(scene: unknown): SceneDoc {
  if (!isObj(scene)) return scene as SceneDoc;
  const s = JSON.parse(JSON.stringify(scene)) as Obj;
  if (s.version === undefined) s.version = SCENE_VERSION;
  if (s.lights === undefined) s.lights = [];
  if (s.objects === undefined) s.objects = [];
  if (isObj(s.timeline) && s.timeline.tracks === undefined) s.timeline.tracks = [];
  if (isObj(s.ui) && s.ui.elements === undefined) s.ui.elements = [];
  return s as unknown as SceneDoc;
}

export interface DefaultSceneOptions {
  id?: string;
  title?: string;
  kind?: TargetKind;
  aspect?: string;
}

// A minimal valid scene: camera, gradient background, soft studio lighting, no objects.
export function defaultScene(opts: DefaultSceneOptions = {}): SceneDoc {
  const kind = opts.kind ?? "banner";
  return {
    version: SCENE_VERSION,
    id: opts.id ?? "scene",
    title: opts.title ?? "Untitled scene",
    target: { kind, aspect: opts.aspect ?? DEFAULT_ASPECT[kind] },
    camera: { type: "perspective", fov: 35, position: [0, 0.5, 9], target: [0, 0, 0] },
    environment: { background: { gradient: ["#141e30", "#243b55"], angle: 0 }, lighting: "studio" },
    lights: [
      { id: "fill", type: "hemisphere", skyColor: "#ffffff", groundColor: "#445066", intensity: 0.8 },
      { id: "key", type: "directional", position: [4, 6, 5], intensity: 2, castShadow: false },
    ],
    objects: [],
  };
}

// Every object id in the tree (depth-first) — handy for hints.
export function collectObjectIds(objects: readonly ObjectDef[] | undefined): string[] {
  const out: string[] = [];
  const walk = (list: readonly ObjectDef[] | undefined) => {
    for (const o of list ?? []) {
      if (o && typeof o.id === "string") out.push(o.id);
      walk(o?.children);
    }
  };
  walk(objects);
  return out;
}

// Sorted copy of a track's keys (agents can call it before writing).
export function sortTrackKeys(track: TrackDef): TrackDef {
  return { ...track, keys: [...track.keys].sort((a, b) => a[0] - b[0]) };
}
