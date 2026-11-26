// Scene validation — structural checks of every field of SceneDoc
// (src/core/types.ts) plus catalog checks (src/core/catalog.ts): unknown ids
// get a "did you mean" suggestion, params are checked for type / range /
// enum, unknown fields and params are warnings with suggestions.
//
// Messages are written for an AI agent to act on: they say what is wrong,
// what to change and list the valid options. Paths use the object id form
// ("objects#logo.material.roughness") whenever an object has a valid id.

import { isValidAspect } from "./aspect";
import { CATALOG, catalogEntry, materialPreset, PARTICLE_PARAMS, PARTICLE_SHAPES, type CatalogEntry, type CatalogSection, type ParamSpec } from "./catalog";
import { isValidColor } from "./color";
import { EASE_EXAMPLES, parseEase } from "./ease";
import { ID_RE, isValidId } from "./ids";
import { isLibraryRef, libraryId } from "./library";
import { PHOTO_EFFECTS, PHOTO_EFFECT_IDS, type PhotoFxParam } from "./photoEffects";
import { closest, didYouMean, listOptions } from "./suggest";
import { EASE_NAMES } from "./ease";
import { TIMELINE_TRIGGERS_ALL, validateMotion } from "./validateMotion";
import type { Issue, SceneDoc, TargetKind, ObjectDef, TrackDef } from "./types";
import { SCENE_VERSION } from "./types";

// ─── Enumerations (kept next to the validator; types.ts is the contract) ──

export const TARGET_KINDS: readonly TargetKind[] = ["banner", "hero", "card", "square", "fullscreen", "inline", "game"];
export const OBJECT_KINDS = ["mesh", "text", "model", "group", "generator", "particles", "instances", "svg", "photo"] as const;
export const LIGHT_TYPES = ["ambient", "directional", "point", "spot", "hemisphere", "rect"] as const;
export const MATERIAL_TYPES = ["standard", "physical", "basic", "lambert", "toon", "normal", "matcap", "gradient", "shader"] as const;
// Named easings (parametric ones too: "cubicBezier(…)", "spring(…)", "steps(n)" — src/core/ease.ts).
export const EASES = EASE_NAMES;
export const LIGHTING_PRESETS = ["studio", "soft", "sunset", "night", "neutral", "sky", "none"] as const;
export const SKY_PRESETS = ["sunrise", "morning", "noon", "afternoon", "golden-hour", "sunset", "dusk"] as const;
// Material texture slots (file path / library id, or { "procedural": "<catalog textures id>", … }).
export const MATERIAL_TEXTURE_SLOTS = ["map", "normalMap", "roughnessMap", "metalnessMap", "aoMap", "emissiveMap", "bumpMap", "displacementMap", "alphaMap"] as const;
export const CAMERA_CONTROLS = ["none", "orbit", "parallax", "scroll", "follow"] as const;
export const UI_ANCHORS = ["top-left", "top", "top-right", "left", "center", "right", "bottom-left", "bottom", "bottom-right"] as const;
export const BEHAVIOUR_WHEN = ["always", "hover", "click", "visible", "scroll"] as const;
export const TIMELINE_TRIGGERS = TIMELINE_TRIGGERS_ALL;
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
const PHOTO_EXT = [".jpg", ".jpeg", ".png", ".webp"];
export const PHOTO_MODES = ["parallax", "mesh", "layers"] as const;
export const PHOTO_AUTO_MOTIONS = ["none", "sway", "orbit", "zoom"] as const;
const PHOTO_MOTION_KEYS = ["pointer", "scroll", "gyro", "auto", "speed", "smoothing"];
const PHOTO_MATERIAL_KEYS = ["opacity", "color", "emissiveIntensity"];

// Allowed keys per section (unknown keys → warnings with suggestions).
const BASE_OBJECT_KEYS = ["id", "kind", "name", "visible", "castShadow", "receiveShadow", "behaviours", "children", "tags", "body", "href", "userData", "attach", "position", "rotation", "scale"];
const OBJECT_KEYS: Record<(typeof OBJECT_KINDS)[number], string[]> = {
  mesh: ["geometry", "material"],
  text: ["text", "font", "size", "depth", "bevel", "align", "letterSpacing", "lineHeight", "kerning", "maxWidth", "curveSegments", "outline", "splitLetters", "reveal", "material"],
  model: ["src", "fit", "center", "animation", "morph", "material"],
  group: [],
  generator: ["generator", "params", "seed", "material"],
  particles: ["preset", ...PARTICLE_PARAMS.map((x) => x.name)],
  instances: ["geometry", "material", "layout", "colors"],
  svg: ["src", "size", "fit", "depth", "bevel", "keepColors", "strokes", "curveSegments", "layerGap", "material"],
  photo: ["src", "depth", "mode", "width", "height", "strength", "focus", "segments", "layers", "edgeCut", "motion", "material", "effects"],
};
const SCENE_KEYS = ["version", "id", "title", "description", "target", "camera", "environment", "lights", "objects", "timeline", "interactions", "postfx", "physics", "scripts", "ui", "audio", "data", "ariaLabel", "seed"];
const TARGET_KEYS = ["kind", "aspect", "budgetKb", "height", "transparent", "lazy", "pauseOffscreen", "maxDpr", "reducedMotion", "posterTime", "antialias", "shadows", "toneMapping", "exposure", "quality"];
// Geometry parameter names from three.js → the catalog's name (first one the entry has).
const PARAM_ALIASES: Record<string, string[]> = {
  radialSegments: ["segments"],
  widthSegments: ["segments"],
  capSegments: ["segments"],
  heightSegments: ["segments"],
  tubularSegments: ["segments"],
  thetaLength: ["arc"],
};

const CAMERA_KEYS = ["type", "fov", "zoom", "position", "target", "near", "far", "controls", "autoRotate", "orbitZoom", "orbitLimits", "parallax", "scrollPath", "follow", "lookAt", "shake", "shots"];
const ENV_KEYS = ["background", "lighting", "lightingIntensity", "fog", "ground", "rig", "contactShadows", "shadows"];
const LIGHT_KEYS = ["id", "type", "color", "intensity", "position", "target", "castShadow", "skyColor", "groundColor", "distance", "decay", "angle", "penumbra", "width", "height", "panel", "volumetric", "shadow", "behaviours"];
const MATERIAL_KEYS = [
  "preset", "type", "color", "metalness", "roughness", "emissive", "emissiveIntensity", "opacity", "transparent", "wireframe", "flatShading", "side",
  "transmission", "thickness", "ior", "clearcoat", "iridescence", "sheen", "map", "normalMap", "roughnessMap", "repeat", "gradient", "shader", "uniforms",
  "clearcoatRoughness", "sheenColor", "sheenRoughness", "anisotropy", "anisotropyRotation", "attenuationColor", "attenuationDistance", "specularIntensity", "specularColor",
  "dispersion", "iridescenceIOR", "iridescenceThicknessRange", "envMapIntensity", "metalnessMap", "aoMap", "emissiveMap", "bumpMap", "displacementMap", "alphaMap",
  "normalScale", "bumpScale", "aoMapIntensity", "displacementScale", "triplanar", "gradientEmissive",
];
const BODY_KEYS = ["type", "shape", "size", "radius", "height", "shapes", "offset", "mass", "restitution", "friction", "material", "velocity", "angularVelocity", "linearDamping", "angularDamping", "gravityScale", "fixedRotation", "character", "sleep", "ccd", "layer", "collidesWith"];
export const BODY_TYPES = ["static", "dynamic", "kinematic", "trigger"] as const;
export const BODY_SHAPES = ["box", "sphere", "auto", "cylinder", "capsule", "convex", "trimesh", "heightfield", "compound"] as const;
export const COLLIDER_SHAPES = ["box", "sphere", "cylinder", "capsule"] as const;
export const JOINT_TYPES = ["hinge", "point", "distance", "lock", "spring"] as const;
const PHYSICS_KEYS = ["gravity", "step", "substeps", "iterations", "sleep", "debug", "materials", "contacts", "layers", "joints"];
const JOINT_KEYS = ["id", "type", "a", "b", "pivot", "axis", "distance", "restLength", "stiffness", "damping", "motor", "limits", "maxForce", "collideConnected"];
// Bodies seen while walking objects (joints / materials / layers are checked in physics()).
const bodiesSeen = new WeakMap<object, { id: string; path: string; body: Record<string, unknown> }[]>();
const UI_ELEMENT_KEYS = ["id", "type", "text", "anchor", "style", "value", "action", "visible", "color", "background"];

// Animatable track properties: src/core/validateMotion.ts.

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
  letterTexts = new Set<string>(); // text ids split into letters ("<id>/<n>" track targets)
  letterCounts = new Map<string, number>(); // their letter counts (non-space characters)

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
      // Generator params bound to scene data ("{data.values}" → the raw value at
      // runtime, src/runtime/data.ts): the type is only known once bound.
      if (section === "generators" && JSON.stringify(v).includes("{data.")) continue;
      this.param(`${section}.${entry.id}.${spec.name}`, spec, v, p, entry.id);
    }
    for (const k of Object.keys(params)) {
      if (names.includes(k) || reserved.includes(k)) continue;
      // three.js parameter names agents carry over (radialSegments on a cylinder…).
      const alias = section === "geometries" ? PARAM_ALIASES[k]?.find((x) => names.includes(x)) : undefined;
      if (alias) {
        this.warn("unknown-param", join(path, k), `"${k}" is not a parameter of ${sectionLabel(section)} "${entry.id}": it is called "${alias}" here (the value is ignored as written).`, `Rename "${k}" to "${alias}".`);
        continue;
      }
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
        // Arrays of ids (e.g. character accessories): every item must be a listed option.
        if (spec.options) return v.every((item, i) => this.enumOf(item, spec.options ?? [], `${path}[${i}]`));
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
      instanceLayouts: "instance layout",
      postfx: "post effect",
      fonts: "font",
      sounds: "sound",
      textures: "procedural texture",
      lightRigs: "light rig",
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
  topLevelObjects.set(v, new Set(objects.filter(isObj)));
  objects.forEach((o, i) => object(v, o, `objects[${i}]`));

  // References now that every id is known.
  cameraRefs(v, s.camera);
  v.issues.push(...validateMotion(s, { objects: v.objectIds, lights: v.lightIds, letters: v.letterTexts, letterCounts: v.letterCounts }));
  if (s.postfx !== undefined) postfx(v, s.postfx);
  if (s.physics !== undefined) physics(v, s.physics);
  if (s.scripts !== undefined) scripts(v, s.scripts);
  if (s.ui !== undefined) ui(v, s.ui);
  if (s.audio !== undefined) audio(v, s.audio);

  const envLit = isObj(s.environment) && (s.environment.rig !== undefined || (isObj(s.environment.background) && isObj(s.environment.background.sky) && (s.environment.background.sky.preset !== undefined || s.environment.background.sky.physical === true) && s.environment.lighting !== "none"));
  if (lights.length === 0 && !envLit && isObj(s.environment) && (s.environment.lighting === "none" || s.environment.lighting === undefined) && needsLight(objects)) {
    v.warn("no-lights", "lights", "The scene has no lights and no environment lighting: lit materials (standard, physical, toon…) will render black.", 'Add lights (e.g. { "type": "hemisphere", "intensity": 1 } and a directional key light) or set environment.lighting to "studio".');
  }
  return v.issues;
}

// Photos are unlit and groups draw nothing: a scene of 3D photos needs no lights.
function needsLight(objects: unknown[]): boolean {
  return objects.some((o) => isObj(o) && ((o.kind !== "photo" && o.kind !== "group") || (Array.isArray(o.children) && needsLight(o.children))));
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
  v.enumOf(t.quality, ["auto", "low", "medium", "high", "ultra"], "target.quality");
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
      v.unknownKeys(c.orbitLimits, ["minDistance", "maxDistance", "minPolar", "maxPolar", "minAzimuth", "maxAzimuth"], `${path}.orbitLimits`, "orbitLimits");
      v.number(c.orbitLimits.minDistance, `${path}.orbitLimits.minDistance`, { min: 0 });
      v.number(c.orbitLimits.maxDistance, `${path}.orbitLimits.maxDistance`, { min: 0 });
      v.number(c.orbitLimits.minPolar, `${path}.orbitLimits.minPolar`, { min: 0, max: 180 });
      v.number(c.orbitLimits.maxPolar, `${path}.orbitLimits.maxPolar`, { min: 0, max: 180 });
      v.number(c.orbitLimits.minAzimuth, `${path}.orbitLimits.minAzimuth`, { min: -360, max: 360 });
      v.number(c.orbitLimits.maxAzimuth, `${path}.orbitLimits.maxAzimuth`, { min: -360, max: 360 });
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
      v.unknownKeys(e.lighting, ["hdri", "intensity", "rotation"], "environment.lighting", "environment.lighting");
      v.number(e.lighting.rotation, "environment.lighting.rotation");
      if (v.required(e.lighting, "hdri", "environment.lighting", "an .hdr/.exr path or library id")) v.assetPath(e.lighting.hdri, "environment.lighting.hdri", HDRI_EXT, "an HDRI");
      v.number(e.lighting.intensity, "environment.lighting.intensity", { min: 0 });
    } else v.error("type", "environment.lighting", `Invalid lighting ${show(e.lighting)}.`, `Use a preset (${listOptions(LIGHTING_PRESETS)}) or { "hdri": "assets/hdris/x.hdr" }.`);
  }
  v.number(e.lightingIntensity, "environment.lightingIntensity", { min: 0 });
  if (e.fog !== undefined) {
    const f = e.fog;
    if (!isObj(f)) v.error("type", "environment.fog", "fog must be an object.", 'Use { "color": "#ccd", "near": 10, "far": 50 } (linear) or { "color": "#ccd", "density": 0.03 } (exponential).');
    else {
      v.unknownKeys(f, ["color", "near", "far", "density", "height", "falloff"], "environment.fog", "fog");
      v.color(f.color, "environment.fog.color");
      if (f.density !== undefined) v.number(f.density, "environment.fog.density", { min: 0, max: 1 });
      v.number(f.height, "environment.fog.height");
      v.number(f.falloff, "environment.fog.falloff", { min: 0, exclusiveMin: true });
      if ((f.height !== undefined || f.falloff !== undefined) && f.density === undefined) v.warn("ignored", "environment.fog.height", "Height fog needs an exponential fog (density).", 'Use { "density": 0.04, "height": 0, "falloff": 0.3 }.');
      v.number(f.near, "environment.fog.near", { min: 0 });
      v.number(f.far, "environment.fog.far", { min: 0 });
      if (isNum(f.near) && isNum(f.far) && f.far <= f.near) v.error("range", "environment.fog.far", "fog.far must be greater than fog.near.");
    }
  }
  if (e.ground !== undefined) {
    const g = e.ground;
    if (!isObj(g)) v.error("type", "environment.ground", "ground must be an object.", 'Example: { "y": 0, "shadowOnly": true }.');
    else {
      v.unknownKeys(g, ["y", "size", "color", "shadowOnly", "grid", "roughness", "opacity"], "environment.ground", "ground");
      v.number(g.opacity, "environment.ground.opacity", { min: 0, max: 1 });
      v.number(g.y, "environment.ground.y");
      v.number(g.size, "environment.ground.size", { min: 0, exclusiveMin: true });
      v.color(g.color, "environment.ground.color");
      v.boolean(g.shadowOnly, "environment.ground.shadowOnly");
      v.boolean(g.grid, "environment.ground.grid");
      v.number(g.roughness, "environment.ground.roughness", { min: 0, max: 1 });
    }
  }
  if (e.rig !== undefined) {
    const r = e.rig;
    const ids = CATALOG.lightRigs.map((x) => x.id);
    const id = typeof r === "string" ? r : isObj(r) ? r.preset : undefined;
    if (!(typeof r === "string" || isObj(r))) v.error("type", "environment.rig", `Invalid rig ${show(r)}.`, `Use a rig id (${listOptions(ids)}) or { "preset": "softbox", "intensity": 1 }.`);
    else if (typeof id !== "string") v.error("required", "environment.rig.preset", 'rig needs a "preset" id.', `One of ${listOptions(ids)}.`);
    else {
      const entry = catalogRef(v, "lightRigs", id, typeof r === "string" ? "environment.rig" : "environment.rig.preset");
      if (entry && isObj(r)) v.params("lightRigs", entry, r, "environment.rig", ["preset"]);
    }
  }
  if (e.contactShadows !== undefined && typeof e.contactShadows !== "boolean") {
    const c = e.contactShadows;
    const cp = "environment.contactShadows";
    if (!isObj(c)) v.error("type", cp, "contactShadows must be true or an object.", 'Example: { "opacity": 0.6, "blur": 2.5 }.');
    else {
      v.unknownKeys(c, ["y", "size", "center", "opacity", "blur", "far", "resolution", "color", "frames"], cp, "contactShadows");
      v.vec(c.center, 2, `${cp}.center`);
      v.number(c.y, `${cp}.y`);
      v.number(c.size, `${cp}.size`, { min: 0, exclusiveMin: true });
      v.number(c.opacity, `${cp}.opacity`, { min: 0, max: 1 });
      v.number(c.blur, `${cp}.blur`, { min: 0, max: 20 });
      v.number(c.far, `${cp}.far`, { min: 0, exclusiveMin: true });
      v.number(c.resolution, `${cp}.resolution`, { min: 64, max: 2048, integer: true });
      v.color(c.color, `${cp}.color`);
      v.number(c.frames, `${cp}.frames`, { min: 0, integer: true });
    }
  }
  if (e.shadows !== undefined) {
    const sh = e.shadows;
    if (!isObj(sh)) v.error("type", "environment.shadows", "shadows must be an object.", 'Example: { "type": "vsm", "softness": 6 }.');
    else {
      v.unknownKeys(sh, ["type", "softness", "mapSize", "intensity"], "environment.shadows", "shadows");
      v.enumOf(sh.type, ["pcf", "vsm"], "environment.shadows.type");
      shadowParams(v, sh, "environment.shadows");
    }
  }
}

function shadowParams(v: V, sh: Obj, p: string) {
  v.number(sh.softness, `${p}.softness`, { min: 0, max: 30 });
  v.number(sh.mapSize, `${p}.mapSize`, { min: 256, max: 4096, integer: true });
  v.number(sh.intensity, `${p}.intensity`, { min: 0, max: 1 });
}

function background(v: V, b: unknown) {
  const p = "environment.background";
  if (typeof b === "string") {
    if (b !== "transparent") v.color(b, p);
    return;
  }
  if (!isObj(b)) return v.error("type", p, `Invalid background ${show(b)}.`, 'Use a colour ("#101020"), "transparent", { "gradient": ["#a", "#b"], "angle": 0 }, { "radial": [...] }, { "meshGradient": [...] }, { "sky": {...} } or { "hdri": "assets/hdris/x.hdr" }.');
  const keys = Object.keys(b);
  const kind = ["gradient", "radial", "meshGradient", "sky", "hdri"].find((k) => k in b);
  if (!kind) return v.error("type", p, `Background object needs one of "gradient", "radial", "meshGradient", "sky" or "hdri" (got keys ${listOptions(keys)}).`, 'Example: { "gradient": ["#0f0c29", "#302b63", "#24243e"], "angle": 0 }.');
  if (kind === "gradient") {
    v.unknownKeys(b, ["gradient", "angle", "grain"], p, "a gradient background");
    v.colors(b.gradient, `${p}.gradient`, 2);
    v.number(b.angle, `${p}.angle`);
    v.number(b.grain, `${p}.grain`, { min: 0, max: 1 });
  } else if (kind === "radial") {
    v.unknownKeys(b, ["radial", "center", "radius", "grain"], p, "a radial background");
    v.colors(b.radial, `${p}.radial`, 2);
    v.vec(b.center, 2, `${p}.center`);
    v.number(b.radius, `${p}.radius`, { min: 0, exclusiveMin: true });
    v.number(b.grain, `${p}.grain`, { min: 0, max: 1 });
  } else if (kind === "meshGradient") {
    v.unknownKeys(b, ["meshGradient", "speed", "scale", "seed", "grain"], p, "a mesh-gradient background");
    v.colors(b.meshGradient, `${p}.meshGradient`, 2);
    if (Array.isArray(b.meshGradient) && b.meshGradient.length > 6) v.warn("ignored", `${p}.meshGradient`, "Only the first 6 colours are used.");
    v.number(b.speed, `${p}.speed`, { min: 0 });
    v.number(b.scale, `${p}.scale`, { min: 0.05 });
    v.number(b.seed, `${p}.seed`);
    v.number(b.grain, `${p}.grain`, { min: 0, max: 1 });
  } else if (kind === "sky") {
    v.unknownKeys(b, ["sky"], p, "a sky background");
    const sky = b.sky;
    if (!isObj(sky)) return v.error("type", `${p}.sky`, "sky must be an object.", 'Example: { "top": "#4a90d9", "horizon": "#f6d6a8", "sun": { "direction": [1, 0.4, 0.2] } }.');
    v.unknownKeys(sky, ["top", "horizon", "bottom", "sun", "stars", "physical", "preset", "turbidity", "rayleigh", "mieCoefficient", "mieDirectionalG", "exposure", "clouds"], `${p}.sky`, "sky");
    v.boolean(sky.physical, `${p}.sky.physical`);
    v.enumOf(sky.preset, SKY_PRESETS, `${p}.sky.preset`);
    v.number(sky.turbidity, `${p}.sky.turbidity`, { min: 0, max: 30 });
    v.number(sky.rayleigh, `${p}.sky.rayleigh`, { min: 0, max: 6 });
    v.number(sky.mieCoefficient, `${p}.sky.mieCoefficient`, { min: 0, max: 0.1 });
    v.number(sky.mieDirectionalG, `${p}.sky.mieDirectionalG`, { min: 0, max: 0.999 });
    v.number(sky.exposure, `${p}.sky.exposure`, { min: 0 });
    v.number(sky.clouds, `${p}.sky.clouds`, { min: 0, max: 1 });
    const physical = sky.physical === true || sky.preset !== undefined || sky.turbidity !== undefined || sky.rayleigh !== undefined;
    if (physical) for (const k of ["top", "horizon", "bottom"]) if (sky[k] !== undefined) v.warn("ignored", `${p}.sky.${k}`, `"${k}" is ignored by the physical sky (preset / physical).`, "Remove it, or drop preset/physical for a colour-gradient sky.");
    v.color(sky.top, `${p}.sky.top`);
    v.color(sky.horizon, `${p}.sky.horizon`);
    v.color(sky.bottom, `${p}.sky.bottom`);
    v.number(sky.stars, `${p}.sky.stars`, { min: 0, integer: true, max: 100000 });
    if (sky.sun !== undefined && sky.sun !== false) {
      if (!isObj(sky.sun)) v.error("type", `${p}.sky.sun`, "sun must be an object or false.");
      else {
        v.unknownKeys(sky.sun, ["direction", "elevation", "azimuth", "color", "size", "light", "intensity", "castShadow"], `${p}.sky.sun`, "sun");
        v.vec(sky.sun.direction, 3, `${p}.sky.sun.direction`);
        v.number(sky.sun.elevation, `${p}.sky.sun.elevation`, { min: -90, max: 90 });
        v.number(sky.sun.azimuth, `${p}.sky.sun.azimuth`);
        v.color(sky.sun.color, `${p}.sky.sun.color`);
        v.number(sky.sun.size, `${p}.sky.sun.size`, { min: 0 });
        v.boolean(sky.sun.light, `${p}.sky.sun.light`);
        v.number(sky.sun.intensity, `${p}.sky.sun.intensity`, { min: 0 });
        v.boolean(sky.sun.castShadow, `${p}.sky.sun.castShadow`);
        if (!physical) for (const k of ["light", "intensity", "castShadow"]) if (sky.sun[k] !== undefined) v.warn("ignored", `${p}.sky.sun.${k}`, `sun.${k} only applies to the physical sky (it adds a sun light).`, 'Set "preset" (e.g. "golden-hour") or "physical": true, or add a directional light yourself.');
      }
    }
  } else {
    v.unknownKeys(b, ["hdri", "blur", "intensity", "rotation", "groundProjection"], p, "an HDRI background");
    v.assetPath(b.hdri, `${p}.hdri`, HDRI_EXT, "an HDRI");
    v.number(b.blur, `${p}.blur`, { min: 0, max: 1 });
    v.number(b.intensity, `${p}.intensity`, { min: 0 });
    v.number(b.rotation, `${p}.rotation`);
    const gp = b.groundProjection;
    if (gp !== undefined && typeof gp !== "boolean") {
      if (!isObj(gp)) v.error("type", `${p}.groundProjection`, "groundProjection must be true or { height, radius }.");
      else {
        v.unknownKeys(gp, ["height", "radius"], `${p}.groundProjection`, "groundProjection");
        v.number(gp.height, `${p}.groundProjection.height`, { min: 0, exclusiveMin: true });
        v.number(gp.radius, `${p}.groundProjection.radius`, { min: 0, exclusiveMin: true });
      }
    }
    if (gp && b.blur) v.warn("ignored", `${p}.blur`, "blur is ignored with groundProjection (the photo is projected sharp).");
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
  v.boolean(l.panel, `${p}.panel`);
  if (l.panel && l.type !== "rect") v.warn("ignored", `${p}.panel`, "panel only applies to rect lights.");
  if (l.volumetric !== undefined && typeof l.volumetric !== "boolean") {
    if (!isObj(l.volumetric)) v.error("type", `${p}.volumetric`, "volumetric must be true or { intensity, length, color }.");
    else {
      v.unknownKeys(l.volumetric, ["intensity", "length", "color"], `${p}.volumetric`, "volumetric");
      v.number(l.volumetric.intensity, `${p}.volumetric.intensity`, { min: 0 });
      v.number(l.volumetric.length, `${p}.volumetric.length`, { min: 0, exclusiveMin: true });
      v.color(l.volumetric.color, `${p}.volumetric.color`);
    }
  }
  if (l.volumetric && l.type !== "spot") v.warn("ignored", `${p}.volumetric`, "volumetric only applies to spot lights.", 'Use "type": "spot" (with "angle" and "target") for a light cone.');
  if (l.shadow !== undefined) {
    if (!isObj(l.shadow)) v.error("type", `${p}.shadow`, "shadow must be an object.", 'Example: { "softness": 6, "mapSize": 2048 }.');
    else {
      v.unknownKeys(l.shadow, ["softness", "mapSize", "bias", "normalBias", "intensity"], `${p}.shadow`, "shadow");
      shadowParams(v, l.shadow, `${p}.shadow`);
      v.number(l.shadow.bias, `${p}.shadow.bias`, { min: -0.1, max: 0.1 });
      v.number(l.shadow.normalBias, `${p}.shadow.normalBias`, { min: 0, max: 1 });
      if (!l.castShadow) v.info("ignored", `${p}.shadow`, "shadow settings only apply when castShadow is true.");
    }
  }
  if ((l.type === "directional" || l.type === "spot" || l.type === "point" || l.type === "rect") && l.position === undefined) {
    v.info("default", `${p}.position`, `This ${l.type} light has no position (the runtime uses a default).`, "Set position [x, y, z] explicitly so lighting is predictable, e.g. [5, 8, 5].");
  }
  if (l.castShadow && (l.type === "ambient" || l.type === "hemisphere" || l.type === "rect")) v.warn("ignored", `${p}.castShadow`, `${l.type} lights cannot cast shadows.`, "Use a directional, spot or point light for shadows.");
  behaviours(v, l.behaviours, `${p}.behaviours`);
}

function objectPath(o: Obj, fallback: string): string {
  return isValidId(o.id) ? `objects#${o.id}` : fallback;
}

// Root entries of objects[] (attach: "camera" is only valid there).
const topLevelObjects = new WeakMap<V, Set<unknown>>();

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
  if (o.attach !== undefined) {
    v.enumOf(o.attach, ["camera"], `${p}.attach`);
    if (o.attach === "camera") {
      if (!topLevelObjects.get(v)?.has(o)) v.error("invalid", `${p}.attach`, 'Only top-level objects can be attached to the camera.', "Move the object (or its group) to the root of objects[] and set attach there.");
      const pos = o.position;
      if (Array.isArray(pos) && isNum(pos[2]) && (pos[2] as number) > -0.2)
        v.warn("framing", `${p}.position`, `A camera-attached object at z = ${String(pos[2])} is behind or inside the lens: camera space looks down -z.`, `Use a negative z, e.g. [${isNum(pos[0]) ? pos[0] : 0}, ${isNum(pos[1]) ? pos[1] : 0}, -6] (6 units in front of the camera).`);
      else if (pos === undefined) v.warn("framing", `${p}.position`, "A camera-attached object without position sits inside the lens.", "Set position in camera space, e.g. [0, -1.5, -6] (6 units in front, a bit below centre).");
    }
  }
  if (o.body !== undefined) {
    body(v, o.body, `${p}.body`);
    bodySizeFrame(v, o, `${p}.body`);
    if (isObj(o.body) && typeof o.id === "string") {
      const list = bodiesSeen.get(v) ?? [];
      list.push({ id: o.id, path: `${p}.body`, body: o.body });
      bodiesSeen.set(v, list);
    }
  }
  behaviours(v, o.behaviours, `${p}.behaviours`);

  switch (k) {
    case "mesh":
      if (v.required(o, "geometry", p, '{ "type": "box" } (see catalog geometries)')) geometry(v, o.geometry, `${p}.geometry`);
      material(v, o.material, `${p}.material`);
      break;
    case "text":
      if (v.required(o, "text", p, "the text to display")) v.string(o.text, `${p}.text`, { nonEmpty: true });
      // A catalog font id, or a custom three.js typeface JSON (project path / library ref).
      if (typeof o.font === "string" && (o.font.includes("/") || o.font.includes(":"))) v.assetPath(o.font, `${p}.font`, [".json"], "a three.js typeface JSON font (scripts/convert-font.mjs)");
      else if (o.font !== undefined) catalogRef(v, "fonts", o.font, `${p}.font`);
      v.number(o.size, `${p}.size`, { min: 0, exclusiveMin: true });
      v.number(o.depth, `${p}.depth`, { min: 0 });
      v.number(o.bevel, `${p}.bevel`, { min: 0 });
      v.enumOf(o.align, ["left", "center", "right"], `${p}.align`);
      v.number(o.letterSpacing, `${p}.letterSpacing`);
      v.number(o.lineHeight, `${p}.lineHeight`, { min: 0, exclusiveMin: true });
      textExtras(v, o, p);
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
          v.unknownKeys(a, ["clip", "loop", "speed", "crossfade", "offset", "blend"], `${p}.animation`, "animation");
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
      v.enumOf(o.shape, PARTICLE_SHAPES, `${p}.shape`);
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
      v.enumOf(o.fit, ["width", "height", "max"], `${p}.fit`);
      v.boolean(o.keepColors, `${p}.keepColors`);
      v.boolean(o.strokes, `${p}.strokes`);
      v.number(o.curveSegments, `${p}.curveSegments`, { integer: true, min: 1, max: 64 });
      v.number(o.layerGap, `${p}.layerGap`, { min: 0 });
      material(v, o.material, `${p}.material`);
      break;
    case "photo":
      photo(v, o, p);
      break;
  }

  if (o.children !== undefined) {
    if (!Array.isArray(o.children)) v.error("type", `${p}.children`, "children must be an array of objects.");
    else o.children.forEach((c, i) => object(v, c, `${p}.children[${i}]`));
  }
}

// A 3D photo: an image + an optional depth map (white = near, alpha 0 = cut edge).
function photo(v: V, o: Obj, p: string) {
  if (v.required(o, "src", p, 'an image path ("assets/textures/photo.jpg") or "library:<id>" (.jpg / .png / .webp)')) v.assetPath(o.src, `${p}.src`, PHOTO_EXT, "an image (.jpg / .png / .webp)");
  v.assetPath(o.depth, `${p}.depth`, PHOTO_EXT, "a depth map image (grayscale PNG, white = near)");
  v.enumOf(o.mode, PHOTO_MODES, `${p}.mode`);
  v.number(o.width, `${p}.width`, { min: 0, exclusiveMin: true });
  v.number(o.height, `${p}.height`, { min: 0, exclusiveMin: true });
  for (const k of ["strength", "focus", "edgeCut"]) v.number(o[k], `${p}.${k}`, { min: 0, max: 1 });
  v.number(o.segments, `${p}.segments`, { integer: true, min: 8, max: 1024 });
  v.number(o.layers, `${p}.layers`, { integer: true, min: 2, max: 16 });
  const mode = typeof o.mode === "string" ? o.mode : "parallax";
  if (o.segments !== undefined && mode !== "mesh") v.info("ignored", `${p}.segments`, `segments only applies to mode "mesh" (this photo is "${mode}").`, 'Set mode: "mesh", or remove segments.');
  if (o.layers !== undefined && mode !== "layers") v.info("ignored", `${p}.layers`, `layers only applies to mode "layers" (this photo is "${mode}").`, 'Set mode: "layers", or remove layers.');
  if (o.depth === undefined && typeof o.src === "string" && (PHOTO_MODES as readonly string[]).includes(mode)) {
    v.warn("photo-flat", p, `Photo "${String(o.id)}" has no depth map: it renders flat (mode "${mode}" needs one).`, `Run \`agent3d assets depth ${o.src}\` (writes a depth PNG next to it), then set ${p}.depth to its path.`);
  }
  if (o.motion !== undefined) {
    const m = o.motion;
    if (!isObj(m)) v.error("type", `${p}.motion`, "motion must be an object.", 'Example: { "pointer": 1, "scroll": 0, "auto": "sway", "speed": 1 }.');
    else {
      v.unknownKeys(m, PHOTO_MOTION_KEYS, `${p}.motion`, "photo motion");
      v.number(m.pointer, `${p}.motion.pointer`, { min: 0, max: 1 });
      v.number(m.scroll, `${p}.motion.scroll`, { min: 0, max: 1 });
      v.boolean(m.gyro, `${p}.motion.gyro`);
      v.enumOf(m.auto, PHOTO_AUTO_MOTIONS, `${p}.motion.auto`);
      v.number(m.speed, `${p}.motion.speed`, { min: 0 });
      v.number(m.smoothing, `${p}.motion.smoothing`, { min: 0, max: 1 });
    }
  }
  if (o.effects !== undefined) photoEffects(v, o.effects, `${p}.effects`, o.depth !== undefined);
  if (o.material !== undefined) {
    const m = o.material;
    if (!isObj(m)) v.error("type", `${p}.material`, "material must be an object.", 'A photo material only takes { "opacity", "color", "emissiveIntensity" }, e.g. { "opacity": 0.9 }.');
    else {
      for (const k of Object.keys(m)) {
        if (PHOTO_MATERIAL_KEYS.includes(k)) continue;
        const s = closest(k, PHOTO_MATERIAL_KEYS);
        v.warn("unknown-field", `${p}.material.${k}`, `"${k}" is not supported on a photo material (ignored by the runtime).`, `${s ? `Did you mean "${s}"? ` : ""}A photo is unlit: only ${listOptions(PHOTO_MATERIAL_KEYS)} apply.`);
      }
      v.number(m.opacity, `${p}.material.opacity`, { min: 0, max: 1 });
      v.color(m.color, `${p}.material.color`);
      v.number(m.emissiveIntensity, `${p}.material.emissiveIntensity`, { min: 0 });
    }
  }
}

// Depth-driven photo effects (src/core/photoEffects.ts).
const EFFECT_EXAMPLE = '{ "fog": { "color": "#dfe8f2", "amount": 0.6 }, "light": { "follow": "pointer" }, "reveal": { "duration": 2 } }';
function photoEffects(v: V, fx: unknown, p: string, hasDepth: boolean) {
  if (!isObj(fx)) return v.error("type", p, "effects must be an object.", `Example: ${EFFECT_EXAMPLE}.`);
  v.unknownKeys(fx, PHOTO_EFFECT_IDS, p, "photo effects");
  for (const id of PHOTO_EFFECT_IDS) {
    const e = fx[id];
    if (e === undefined) continue;
    const ep = `${p}.${id}`;
    if (!isObj(e)) {
      v.error("type", ep, `effects.${id} must be an object (use {} for the defaults).`, `Example: ${EFFECT_EXAMPLE}.`);
      continue;
    }
    const spec = PHOTO_EFFECTS[id];
    const params = spec.params as Record<string, PhotoFxParam>;
    v.unknownKeys(e, Object.keys(params), ep, `the ${id} effect`);
    for (const [k, ps] of Object.entries(params)) {
      const val = e[k];
      if (val === undefined) continue;
      const at = `${ep}.${k}`;
      const sp = ps;
      if (sp.type === "number") v.number(val, at, { min: sp.min, max: sp.max });
      else if (sp.type === "color") v.color(val, at);
      else if (sp.type === "enum") v.enumOf(val, sp.options ?? [], at);
      else if (sp.type === "vec2" && v.vec(val, 2, at)) {
        const a = val as number[];
        if (a.some((x) => x < (sp.min ?? -Infinity) || x > (sp.max ?? Infinity))) v.error("range", at, `${JSON.stringify(val)} is out of range (each coordinate in ${sp.min}..${sp.max}, photo space: -1 left / bottom, 1 right / top).`);
      }
    }
    if (spec.needsDepth && !hasDepth) v.info("ignored", ep, `The ${id} effect needs a depth map: this photo has none, so it is ignored.`, `Set the photo's depth (agent3d assets depth <image>), or remove effects.${id}.`);
  }
  const r = fx.reveal;
  if (isObj(r) && r.duration !== undefined && r.progress !== undefined) v.info("ignored", `${p}.reveal.progress`, "reveal.progress is ignored when reveal.duration is set (progress animates 0 → 1 from delay).", "Remove duration to drive progress yourself (e.g. a timeline track on effects.reveal.progress).");
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
  for (const k of MATERIAL_TEXTURE_SLOTS) textureRef(v, m[k], `${path}.${k}`);
  v.vec(m.repeat, 2, `${path}.repeat`);
  for (const k of ["clearcoatRoughness", "sheenRoughness", "anisotropy", "specularIntensity", "aoMapIntensity"]) v.number(m[k], `${path}.${k}`, { min: 0, max: 1 });
  for (const k of ["sheenColor", "attenuationColor", "specularColor"]) v.color(m[k], `${path}.${k}`);
  v.number(m.anisotropyRotation, `${path}.anisotropyRotation`);
  v.number(m.attenuationDistance, `${path}.attenuationDistance`, { min: 0, exclusiveMin: true });
  v.number(m.dispersion, `${path}.dispersion`, { min: 0, max: 10 });
  v.number(m.iridescenceIOR, `${path}.iridescenceIOR`, { min: 1, max: 2.333 });
  v.vec(m.iridescenceThicknessRange, 2, `${path}.iridescenceThicknessRange`);
  v.number(m.envMapIntensity, `${path}.envMapIntensity`, { min: 0 });
  v.number(m.normalScale, `${path}.normalScale`, { min: -10, max: 10 });
  v.number(m.bumpScale, `${path}.bumpScale`, { min: -10, max: 10 });
  v.number(m.displacementScale, `${path}.displacementScale`);
  if (m.triplanar !== undefined && typeof m.triplanar !== "boolean") v.number(m.triplanar, `${path}.triplanar`, { min: 0, exclusiveMin: true });
  v.boolean(m.gradientEmissive, `${path}.gradientEmissive`);
  const PHYSICAL_ONLY = ["transmission", "thickness", "ior", "clearcoat", "iridescence", "sheen", "clearcoatRoughness", "sheenColor", "sheenRoughness", "anisotropy", "anisotropyRotation", "attenuationColor", "attenuationDistance", "specularIntensity", "specularColor", "dispersion", "iridescenceIOR", "iridescenceThicknessRange"];
  const resolvedType = m.type ?? (typeof m.preset === "string" ? (materialPreset(m.preset)?.props.type as string | undefined) : undefined);
  if (resolvedType !== undefined && resolvedType !== "physical") {
    for (const k of PHYSICAL_ONLY) if (m[k] !== undefined) v.warn("ignored", `${path}.${k}`, `"${k}" needs a physical material (type is ${show(resolvedType)}).`, 'Set "type": "physical".');
  }
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

function textureRef(v: V, t: unknown, path: string) {
  if (t === undefined) return;
  if (isObj(t)) {
    if (!v.required(t, "procedural", path, `a procedural texture id (${listOptions(CATALOG.textures.map((x) => x.id))})`)) return;
    const entry = catalogRef(v, "textures", t.procedural, `${path}.procedural`);
    if (entry) v.params("textures", entry, t, path, ["procedural"]);
    return;
  }
  v.assetPath(t, path, TEXTURE_EXT, "a texture image");
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

// Instance layouts are declared in the catalog (CATALOG.instanceLayouts):
// field names, types, ranges and required fields come from there; unknown
// fields get a "did you mean".
function layout(v: V, l: unknown, path: string) {
  if (!isObj(l)) return v.error("type", path, "layout must be an object.", 'Example: { "type": "grid", "count": [5, 1, 5], "spacing": [1.2, 0, 1.2] }. See `agent3d catalog instanceLayouts`.');
  const types = CATALOG.instanceLayouts.map((x) => x.id);
  if (!v.required(l, "type", path, listOptions(types)) || !v.enumOf(l.type, types, `${path}.type`)) return;
  const entry = catalogEntry("instanceLayouts", l.type as string)!;
  v.params("instanceLayouts", entry, l, path, ["type"]);
  switch (l.type) {
    case "grid":
      if (Array.isArray(l.count) && l.count.length === 3 && !(l.count as unknown[]).every((x) => Number.isInteger(x) && (x as number) >= 1)) v.error("range", `${path}.count`, "grid count values must be integers ≥ 1.", "Use 1 for a flat axis, e.g. [8, 1, 8].");
      break;
    case "scatter":
      if (isNum(l.minScale) && isNum(l.maxScale) && l.minScale > l.maxScale) v.warn("range", `${path}.minScale`, `minScale (${l.minScale}) is larger than maxScale (${l.maxScale}).`, "Swap them.");
      break;
    case "list":
      if (!Array.isArray(l.items)) break;
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

// body.size is in the object's own frame (before its rotation). A floor made
// of a plane rotated [-90, 0, 0] has its thin axis on local z: a size written
// in world terms ([10, 0.2, 10]) turns into a wall. Warn when the size's thin
// axis is not the geometry's thin axis.
function bodySizeFrame(v: V, o: Obj, path: string) {
  const b = o.body;
  const g = o.geometry;
  if (!isObj(b) || !Array.isArray(b.size) || b.size.length !== 3 || !b.size.every(isNum) || !isObj(g)) return;
  const n = (x: unknown, d: number) => (isNum(x) ? x : d);
  const dims = g.type === "plane" ? [n(g.width, 1), n(g.height, 1), 0] : g.type === "box" ? [n(g.width, 1), n(g.height, 1), n(g.depth, 1)] : null;
  if (!dims) return;
  const thin = (d: number[]) => {
    const i = d.indexOf(Math.min(...d));
    const others = d.filter((_, k) => k !== i);
    return d[i] <= 0.5 * Math.min(...others) ? i : -1;
  };
  const gi = thin(dims), si = thin(b.size as number[]);
  if (gi < 0 || si < 0 || gi === si) return;
  const axes = ["x", "y", "z"];
  const fixed = [...(b.size as number[])];
  [fixed[gi], fixed[si]] = [fixed[si], fixed[gi]];
  const rotated = Array.isArray(o.rotation) && o.rotation.some((r) => isNum(r) && Math.abs(r) > 1);
  v.warn(
    "body-frame",
    `${path}.size`,
    `body.size ${JSON.stringify(b.size)} is thin on ${axes[si]}, but this ${g.type}'s own thin axis is ${axes[gi]}: the size is applied in the object's frame${rotated ? " (before its rotation)" : ""}, so the collider ${g.type === "plane" && rotated ? "stands up like a wall" : "does not match the mesh"}.`,
    `Write it in the object's frame: "size": ${JSON.stringify(fixed)} — or drop size to fit the geometry automatically.`,
  );
}

// HUD `visible` expressions (src/runtime/game/expr.ts): a bare word on the
// right of a comparison is read as a state path, so `phase == attract`
// compares phase with state.attract (undefined) — almost always a missing quote.
const EXPR_LITERALS = new Set(["true", "false", "null", "undefined"]);
export function lintStateExpr(v: V, src: string, path: string): void {
  const re = /([A-Za-z_$][\w$.]*)\s*(===|!==|==|!=)\s*([A-Za-z_$][\w$.]*)/g;
  // Ignore quoted strings.
  const bare = src.replace(/'[^']*'|"[^"]*"/g, (m) => " ".repeat(m.length));
  for (let m = re.exec(bare); m; m = re.exec(bare)) {
    const [, left, op, right] = m;
    if (EXPR_LITERALS.has(right) || EXPR_LITERALS.has(left) || right.startsWith("state.")) continue;
    v.warn(
      "expr-bare-word",
      path,
      `"${left} ${op} ${right}" compares two state values: "${right}" is read as state.${right.replace(/^state\./, "")} (probably undefined), not as the text "${right}".`,
      `Quote the text: ${JSON.stringify(src.replace(m[0], `${left} ${op} '${right}'`))} (or write state.${right.replace(/^state\./, "")} to compare two state keys on purpose).`,
    );
  }
}

function body(v: V, b: unknown, path: string) {
  if (!isObj(b)) return v.error("type", path, "body must be an object.", 'Example: { "type": "dynamic", "shape": "box", "mass": 1 }.');
  v.unknownKeys(b, BODY_KEYS, path, "a physics body");
  if (v.required(b, "type", path, '"static" | "dynamic" | "kinematic" | "trigger"')) v.enumOf(b.type, BODY_TYPES, `${path}.type`);
  v.enumOf(b.shape, BODY_SHAPES, `${path}.shape`);
  v.vec(b.size, 3, `${path}.size`);
  v.number(b.radius, `${path}.radius`, { min: 0, exclusiveMin: true });
  v.number(b.height, `${path}.height`, { min: 0, exclusiveMin: true });
  v.vec(b.offset, 3, `${path}.offset`);
  v.number(b.mass, `${path}.mass`, { min: 0 });
  v.number(b.restitution, `${path}.restitution`, { min: 0, max: 1 });
  v.number(b.friction, `${path}.friction`, { min: 0 });
  v.string(b.material, `${path}.material`, { nonEmpty: true });
  v.vec(b.velocity, 3, `${path}.velocity`);
  v.vec(b.angularVelocity, 3, `${path}.angularVelocity`);
  v.number(b.linearDamping, `${path}.linearDamping`, { min: 0, max: 1 });
  v.number(b.angularDamping, `${path}.angularDamping`, { min: 0, max: 1 });
  v.number(b.gravityScale, `${path}.gravityScale`);
  v.boolean(b.fixedRotation, `${path}.fixedRotation`);
  v.boolean(b.character, `${path}.character`);
  v.boolean(b.sleep, `${path}.sleep`);
  v.boolean(b.ccd, `${path}.ccd`);
  v.string(b.layer, `${path}.layer`, { nonEmpty: true });
  v.stringArray(b.collidesWith, `${path}.collidesWith`);
  if (b.shapes !== undefined) {
    if (!Array.isArray(b.shapes) || b.shapes.length === 0) v.error("type", `${path}.shapes`, "shapes must be a non-empty array of colliders.", 'Example: [{ "shape": "box", "size": [1, 0.2, 1] }, { "shape": "sphere", "radius": 0.3, "offset": [0, 0.5, 0] }].');
    else
      b.shapes.forEach((c, i) => {
        const cp = `${path}.shapes[${i}]`;
        if (!isObj(c)) return v.error("type", cp, "A collider must be an object.", 'Example: { "shape": "box", "size": [1, 1, 1], "offset": [0, 0.5, 0] }.');
        v.unknownKeys(c, ["shape", "size", "radius", "height", "offset", "rotation"], cp, "a collider");
        if (v.required(c, "shape", cp, listOptions(COLLIDER_SHAPES))) v.enumOf(c.shape, COLLIDER_SHAPES, `${cp}.shape`);
        v.vec(c.size, 3, `${cp}.size`);
        v.number(c.radius, `${cp}.radius`, { min: 0, exclusiveMin: true });
        v.number(c.height, `${cp}.height`, { min: 0, exclusiveMin: true });
        v.vec(c.offset, 3, `${cp}.offset`);
        v.vec(c.rotation, 3, `${cp}.rotation`);
      });
    if (b.shape !== undefined && b.shape !== "compound") v.warn("ignored", `${path}.shapes`, `shapes is only used with shape "compound" (shape is ${show(b.shape)}).`, 'Set "shape": "compound" or remove "shapes".');
  }
  if (b.shape === "compound" && b.shapes === undefined) v.error("required", `${path}.shapes`, 'shape "compound" needs a "shapes" array.', 'Example: "shapes": [{ "shape": "box", "size": [1, 0.2, 1] }, { "shape": "sphere", "radius": 0.3, "offset": [0, 0.5, 0] }].');
  if ((b.shape === "trimesh" || b.shape === "heightfield") && b.type === "dynamic") {
    v.error("invalid", `${path}.shape`, `shape "${b.shape}" only works for static (or kinematic) bodies.`, 'Use "convex" (hull of the mesh) or "box" / "compound" for dynamic bodies.');
  }
  if (b.mass !== undefined && b.type !== undefined && b.type !== "dynamic") v.info("ignored", `${path}.mass`, `mass is ignored on ${show(b.type)} bodies (they have infinite mass).`);
}

function joint(v: V, j: unknown, p: string, bodies: Map<string, Record<string, unknown>>) {
  if (!isObj(j)) return v.error("type", p, "A joint must be an object.", 'Example: { "type": "hinge", "a": "door", "pivot": [1, 1, 0], "axis": [0, 1, 0] }.');
  v.unknownKeys(j, JOINT_KEYS, p, "a joint");
  if (v.required(j, "type", p, listOptions(JOINT_TYPES))) v.enumOf(j.type, JOINT_TYPES, `${p}.type`);
  v.string(j.id, `${p}.id`, { nonEmpty: true });
  const ref = (key: "a" | "b") => {
    const id = j[key];
    if (id === undefined) return;
    if (typeof id !== "string") return v.error("type", `${p}.${key}`, `${key} must be an object id.`);
    if (!v.objectIds.has(id)) return v.error("unknown-ref", `${p}.${key}`, `Joint ${key} "${id}" is not an object id.`, `${didYouMean(id, v.objectIds)}Object ids: ${listOptions([...v.objectIds])}.`);
    if (!bodies.has(id)) return v.error("invalid", `${p}.${key}`, `Object "${id}" has no body: joints connect physics bodies.`, `Add "body": { "type": "dynamic" } to "${id}".`);
  };
  if (v.required(j, "a", p, "the id of an object with a body")) ref("a");
  ref("b");
  if (typeof j.a === "string" && j.a === j.b) v.error("invalid", `${p}.b`, "A joint needs two different bodies.", "Omit b to anchor the body to the world.");
  const ta = typeof j.a === "string" ? bodies.get(j.a)?.type : undefined;
  const tb = typeof j.b === "string" ? bodies.get(j.b)?.type : undefined;
  if (ta && ta !== "dynamic" && (j.b === undefined || (tb && tb !== "dynamic"))) v.warn("no-dynamic", p, "This joint connects no dynamic body: it will have no visible effect.", 'Make "a" (or "b") a dynamic body.');
  v.vec(j.pivot, 3, `${p}.pivot`);
  v.vec(j.axis, 3, `${p}.axis`);
  if (Array.isArray(j.axis) && j.axis.every(isNum) && j.axis.every((x) => x === 0)) v.error("range", `${p}.axis`, "axis must not be [0, 0, 0].", "Example: [0, 1, 0] (vertical hinge, a door) or [0, 0, 1] (a pendulum swinging in the XY plane).");
  v.number(j.distance, `${p}.distance`, { min: 0 });
  v.number(j.restLength, `${p}.restLength`, { min: 0 });
  v.number(j.stiffness, `${p}.stiffness`, { min: 0 });
  v.number(j.damping, `${p}.damping`, { min: 0 });
  v.number(j.maxForce, `${p}.maxForce`, { min: 0, exclusiveMin: true });
  v.boolean(j.collideConnected, `${p}.collideConnected`);
  if (j.motor !== undefined) {
    if (!isObj(j.motor)) v.error("type", `${p}.motor`, "motor must be an object.", 'Example: { "speed": 90, "maxForce": 50 } (degrees / s).');
    else {
      v.unknownKeys(j.motor, ["speed", "maxForce"], `${p}.motor`, "a motor");
      if (v.required(j.motor, "speed", `${p}.motor`, "degrees / s")) v.number(j.motor.speed, `${p}.motor.speed`);
      v.number(j.motor.maxForce, `${p}.motor.maxForce`, { min: 0, exclusiveMin: true });
    }
    if (j.type !== "hinge") v.warn("ignored", `${p}.motor`, `motor only drives hinge joints (this one is ${show(j.type)}).`);
  }
  if (j.limits !== undefined) {
    const l = j.limits;
    if (!Array.isArray(l) || l.length !== 2 || !l.every(isNum)) v.error("type", `${p}.limits`, "limits must be [minDegrees, maxDegrees].", "Example: [0, 110] (a door opening one way) or [-45, 45] (a flipper).");
    else if (l[0] > l[1]) v.error("range", `${p}.limits`, `limits min (${l[0]}) is greater than max (${l[1]}).`, `Write [${l[1]}, ${l[0]}].`);
    else if (l[0] < -360 || l[1] > 360) v.error("range", `${p}.limits`, "limits must stay within -360 … 360 degrees.", "Angles are relative to the start pose, e.g. [-90, 90].");
  }
  const only: Record<string, string[]> = { distance: ["distance"], restLength: ["spring"], stiffness: ["spring"], damping: ["spring"], axis: ["hinge"], limits: ["hinge"] };
  for (const [k, types] of Object.entries(only)) if (j[k] !== undefined && typeof j.type === "string" && !types.includes(j.type)) v.warn("ignored", `${p}.${k}`, `${k} is ignored on ${show(j.type)} joints (used by ${types.join(", ")}).`);
}

// Text options beyond the basics: kerning, wrap, outline, letters, reveal.
const TEXT_REVEAL_EFFECTS = ["rise", "fade", "scale", "spin", "drop"];
function textExtras(v: V, o: Obj, p: string) {
  v.boolean(o.kerning, `${p}.kerning`);
  v.number(o.maxWidth, `${p}.maxWidth`, { min: 0, exclusiveMin: true });
  v.number(o.curveSegments, `${p}.curveSegments`, { integer: true, min: 1, max: 32 });
  v.boolean(o.splitLetters, `${p}.splitLetters`);
  if (o.outline !== undefined && typeof o.outline !== "boolean") {
    if (!isObj(o.outline)) v.error("type", `${p}.outline`, "outline must be true or an object.", 'Example: { "width": 0.06, "color": "#1a1033" }.');
    else {
      const ol = o.outline;
      v.unknownKeys(ol, ["width", "color", "depth", "material"], `${p}.outline`, "outline");
      v.number(ol.width, `${p}.outline.width`, { min: 0, exclusiveMin: true });
      v.color(ol.color, `${p}.outline.color`);
      v.number(ol.depth, `${p}.outline.depth`, { min: 0, exclusiveMin: true });
      material(v, ol.material, `${p}.outline.material`);
    }
  }
  if (o.reveal !== undefined) {
    if (!isObj(o.reveal)) v.error("type", `${p}.reveal`, "reveal must be an object.", 'Example: { "effect": "rise", "stagger": 0.04, "duration": 0.6 }.');
    else {
      const r = o.reveal;
      v.unknownKeys(r, ["effect", "stagger", "duration", "delay", "ease", "order"], `${p}.reveal`, "reveal");
      v.enumOf(r.effect, TEXT_REVEAL_EFFECTS, `${p}.reveal.effect`);
      v.number(r.stagger, `${p}.reveal.stagger`, { min: 0 });
      v.number(r.duration, `${p}.reveal.duration`, { min: 0, exclusiveMin: true });
      v.number(r.delay, `${p}.reveal.delay`, { min: 0 });
      v.enumOf(r.order, ["forward", "reverse", "center", "random"], `${p}.reveal.order`);
      if (r.ease !== undefined) {
        const e = typeof r.ease === "string" ? parseEase(r.ease) : { error: "ease must be a string." };
        if ("error" in e) v.error("enum", `${p}.reveal.ease`, `Invalid easing ${show(r.ease)}: ${e.error}`, `Examples: ${EASE_EXAMPLES.join(", ")}.`);
      }
    }
  }
  if ((o.splitLetters === true || isObj(o.reveal)) && typeof o.id === "string") {
    v.letterTexts.add(o.id);
    // Placeholders ({data.title}) change the text at runtime: no count then.
    if (typeof o.text === "string" && !/\{data\./.test(o.text)) v.letterCounts.set(o.id, Array.from(o.text).filter((ch) => ch.trim()).length);
  }
}

// ─── Timeline, interactions, camera shots: src/core/validateMotion.ts ────

export { trackValueKind } from "./validateMotion";

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
    if (fx.type === "dof" && typeof fx.focusOn === "string" && !v.objectIds.has(fx.focusOn))
      v.error("unknown-ref", `${p}.focusOn`, `dof.focusOn "${fx.focusOn}" is not an object id.`, `${didYouMean(fx.focusOn, v.objectIds)}Object ids: ${listOptions([...v.objectIds])}.`);
    if (fx.type === "godrays" && typeof fx.source === "string" && fx.source !== "auto" && fx.source !== "sun" && !v.lightIds.has(fx.source))
      v.error("unknown-ref", `${p}.source`, `godrays.source "${fx.source}" is not "auto", "sun" or a light id.`, `${didYouMean(fx.source, v.lightIds)}Light ids: ${listOptions([...v.lightIds])}.`);
  });
  const types = list.map((fx) => (isObj(fx) ? fx.type : undefined));
  if (types.includes("fxaa") && types.includes("smaa")) v.warn("duplicate", "postfx", "Both fxaa and smaa are set: they do the same job.", "Keep smaa (sharper) or fxaa (cheaper).");
}

function physics(v: V, ph: unknown) {
  if (!isObj(ph)) return v.error("type", "physics", "physics must be an object.", 'Example: { "gravity": [0, -9.81, 0] }.');
  v.unknownKeys(ph, PHYSICS_KEYS, "physics", "physics");
  v.vec(ph.gravity, 3, "physics.gravity");
  v.number(ph.step, "physics.step", { min: 0, exclusiveMin: true, max: 0.1 });
  v.number(ph.substeps, "physics.substeps", { min: 1, max: 8, integer: true });
  v.number(ph.iterations, "physics.iterations", { min: 1, max: 100, integer: true });
  v.boolean(ph.sleep, "physics.sleep");
  v.boolean(ph.debug, "physics.debug");
  const seen = bodiesSeen.get(v) ?? [];
  const bodies = new Map(seen.map((b) => [b.id, b.body]));
  const materials = new Set<string>();
  if (ph.materials !== undefined) {
    if (!isObj(ph.materials)) v.error("type", "physics.materials", "materials must be an object { name: { friction, restitution } }.", 'Example: { "ice": { "friction": 0.02 }, "rubber": { "friction": 0.9, "restitution": 0.8 } }.');
    else
      for (const [name, m] of Object.entries(ph.materials)) {
        const mp = `physics.materials.${name}`;
        materials.add(name);
        if (!isObj(m)) {
          v.error("type", mp, "A physics material must be an object.", 'Example: { "friction": 0.4, "restitution": 0.2 }.');
          continue;
        }
        v.unknownKeys(m, ["friction", "restitution"], mp, "a physics material");
        v.number(m.friction, `${mp}.friction`, { min: 0 });
        v.number(m.restitution, `${mp}.restitution`, { min: 0, max: 1 });
      }
  }
  if (ph.contacts !== undefined) {
    if (!Array.isArray(ph.contacts)) v.error("type", "physics.contacts", "contacts must be an array.", 'Example: [{ "a": "ice", "b": "rubber", "friction": 0.05 }].');
    else
      ph.contacts.forEach((c, i) => {
        const cp = `physics.contacts[${i}]`;
        if (!isObj(c)) return v.error("type", cp, "A contact must be an object.", 'Example: { "a": "ice", "b": "rubber", "friction": 0.05, "restitution": 0 }.');
        v.unknownKeys(c, ["a", "b", "friction", "restitution"], cp, "a contact material");
        for (const k of ["a", "b"] as const) {
          if (!v.required(c, k, cp, "a physics.materials name")) continue;
          if (typeof c[k] !== "string" || !materials.has(c[k] as string)) v.error("unknown-ref", `${cp}.${k}`, `Unknown physics material ${show(c[k])}.`, materials.size ? `${didYouMean(String(c[k]), materials)}Materials: ${listOptions([...materials])}.` : 'Declare it in physics.materials first, e.g. "materials": { "ice": { "friction": 0.02 } }.');
        }
        v.number(c.friction, `${cp}.friction`, { min: 0 });
        v.number(c.restitution, `${cp}.restitution`, { min: 0, max: 1 });
      });
  }
  if (ph.layers !== undefined) {
    if (v.stringArray(ph.layers, "physics.layers") && Array.isArray(ph.layers) && new Set(["default", ...ph.layers]).size > 16) v.error("range", "physics.layers", "At most 16 collision layers (including \"default\").");
  }
  const layers = new Set<string>(["default", ...(Array.isArray(ph.layers) ? ph.layers.filter((x): x is string => typeof x === "string") : [])]);
  for (const b of seen) {
    if (typeof b.body.material === "string" && !materials.has(b.body.material)) v.error("unknown-ref", `${b.path}.material`, `Unknown physics material "${b.body.material}".`, materials.size ? `${didYouMean(b.body.material, materials)}Materials: ${listOptions([...materials])}.` : 'Declare it in physics.materials, e.g. "materials": { "ice": { "friction": 0.02 } }.');
    if (typeof b.body.layer === "string") layers.add(b.body.layer);
  }
  if (layers.size > 16) v.error("range", "physics.layers", `Too many collision layers (${layers.size}, max 16).`, "Reuse layer names: a layer is a group like \"player\", \"enemy\", \"debris\".");
  for (const b of seen) {
    if (Array.isArray(b.body.collidesWith))
      b.body.collidesWith.forEach((l, i) => {
        if (typeof l === "string" && !layers.has(l)) v.warn("unknown-ref", `${b.path}.collidesWith[${i}]`, `Layer "${l}" is not used by any body.`, `${didYouMean(l, layers)}Layers: ${listOptions([...layers])}.`);
      });
  }
  if (ph.joints !== undefined) {
    if (!Array.isArray(ph.joints)) v.error("type", "physics.joints", "joints must be an array.", 'Example: [{ "type": "hinge", "a": "door", "pivot": [1, 1, 0], "axis": [0, 1, 0] }].');
    else ph.joints.forEach((j, i) => joint(v, j, `physics.joints[${i}]`, bodies));
  }
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
  v.unknownKeys(u, ["elements", "font", "color", "accent", "buttonText"], "ui", "ui");
  v.string(u.font, "ui.font");
  if (typeof u.font === "string" && /url\(|@import|https?:/i.test(u.font)) v.error("forbidden", "ui.font", "ui.font must be a CSS font-family list (no web fonts).", 'Use a system stack, e.g. "system-ui, sans-serif".');
  v.color(u.color, "ui.color");
  v.color(u.accent, "ui.accent");
  v.color(u.buttonText, "ui.buttonText");
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
    v.enumOf(el.style, ["plain", "pill", "title", "subtitle", "panel"], `${p}.style`);
    v.color(el.color, `${p}.color`);
    v.color(el.background, `${p}.background`);
    v.string(el.value, `${p}.value`);
    v.string(el.action, `${p}.action`);
    if (el.visible !== undefined && typeof el.visible !== "boolean" && typeof el.visible !== "string") v.error("type", `${p}.visible`, "visible must be a boolean or a state expression string.");
    if (typeof el.visible === "string") lintStateExpr(v, el.visible, `${p}.visible`);
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
