// Field specs for scene properties that aren't catalog entries (object kinds,
// material, lights, camera…) so they reuse the ParamSpec-driven controls.

import type { ParamSpec } from "../../core/catalog";
import { FONTS, PARTICLE_PRESETS } from "../../core/catalog";
import { MATERIAL_TYPES, TONE_MAPPINGS } from "../../core/validate";

const n = (name: string, def?: number, min?: number, max?: number, description = ""): ParamSpec => ({ name, type: "number", description, default: def, min, max });
const i = (name: string, def?: number, min?: number, max?: number, description = ""): ParamSpec => ({ name, type: "integer", description, default: def, min, max });
const b = (name: string, def?: boolean, description = ""): ParamSpec => ({ name, type: "boolean", description, default: def });
const c = (name: string, def?: string, description = ""): ParamSpec => ({ name, type: "color", description, default: def });
const e = (name: string, options: readonly string[], def?: string, description = ""): ParamSpec => ({ name, type: "enum", description, options, default: def });
const v3 = (name: string, def?: [number, number, number], description = ""): ParamSpec => ({ name, type: "vec3", description, default: def });
const s = (name: string, description = ""): ParamSpec => ({ name, type: "string", description });

export const TEXT_SPECS: ParamSpec[] = [
  e("font", FONTS.map((f) => f.id), "sans-bold", "Bundled font."),
  n("size", 1, 0, undefined, "Cap height in units."),
  n("depth", 0.2, 0, undefined, "Extrusion (0 = flat)."),
  n("bevel", 0.02, 0, undefined, "Bevel size."),
  e("align", ["left", "center", "right"], "center"),
  n("letterSpacing", 0, undefined, undefined, "Extra spacing between letters."),
  n("lineHeight", 1.2, 0),
];

export const MODEL_SPECS: ParamSpec[] = [s("src", "Project .glb/.gltf or library:<id>."), n("fit", undefined, 0, undefined, "Largest dimension (units)."), b("center", true, "Bottom-centre at the origin.")];
export const MODEL_ANIM_SPECS: ParamSpec[] = [s("clip", "Clip name or index."), b("loop", true), n("speed", 1, 0), n("crossfade", 0.3, 0)];

export const PARTICLE_SPECS: ParamSpec[] = [
  e("preset", PARTICLE_PRESETS.map((p) => p.id), undefined),
  i("count", undefined, 1, 100000),
  v3("area", undefined, "Emission box size."),
  n("size", undefined, 0),
  c("color", undefined),
  n("speed", undefined, 0),
  v3("direction", undefined),
  n("spread", undefined, 0, 1, "Randomness of direction."),
  n("lifetime", undefined, 0),
  n("opacity", undefined, 0, 1),
  e("blending", ["normal", "additive"], undefined),
  e("shape", ["point", "square", "circle", "star", "spark"], undefined),
  i("seed", undefined),
];

export const SVG_SPECS: ParamSpec[] = [n("size", 2, 0, undefined, "Width in units."), n("depth", 0.2, 0), n("bevel", 0, 0)];

export const MATERIAL_MAIN: ParamSpec[] = [
  c("color", "#ffffff"),
  n("metalness", 0, 0, 1),
  n("roughness", 0.5, 0, 1),
  c("emissive", "#000000"),
  n("emissiveIntensity", 1, 0),
  n("opacity", 1, 0, 1),
];
export const MATERIAL_MORE: ParamSpec[] = [
  b("transparent", false),
  b("wireframe", false),
  b("flatShading", false),
  e("side", ["front", "back", "double"], "front"),
  n("transmission", 0, 0, 1, "Glass-like transmission (physical)."),
  n("thickness", 0, 0),
  n("ior", 1.5, 1, 2.333),
  n("clearcoat", 0, 0, 1),
  n("iridescence", 0, 0, 1),
  n("sheen", 0, 0, 1),
  s("map", "Texture (project path or library:<id>)."),
  s("normalMap"),
  s("roughnessMap"),
];
export const MATERIAL_TYPE_SPEC = e("type", MATERIAL_TYPES, "standard");

export const BODY_SPECS: ParamSpec[] = [
  e("type", ["static", "dynamic", "kinematic", "trigger"], "static"),
  e("shape", ["box", "sphere", "auto"], "auto"),
  v3("size", undefined, "Box size override."),
  n("radius", undefined, 0),
  n("mass", 1, 0),
  n("restitution", 0, 0, 1, "Bounciness."),
  n("friction", 0.5, 0, 1),
  v3("velocity", undefined),
  b("fixedRotation", false),
];

export const OBJECT_FLAGS: ParamSpec[] = [b("castShadow", false), b("receiveShadow", false), s("href", "Clicking the object opens this URL.")];

export const TARGET_SPECS: ParamSpec[] = [
  { name: "aspect", type: "string", description: '"W:H", e.g. "4:1".' },
  s("height", 'Fixed CSS height instead of the aspect (e.g. "320px").'),
  b("transparent", false, "Transparent canvas (page shows through)."),
  i("budgetKb", undefined, 0, undefined, "Bundle budget (KB)."),
  e("reducedMotion", ["static", "slow", "ignore"], "static"),
  n("posterTime", 0, 0, undefined, "Time of the poster frame."),
  e("toneMapping", TONE_MAPPINGS, "aces"),
  n("exposure", 1, 0),
  n("maxDpr", 2, 0.5, 4),
  b("antialias", true),
  b("shadows", true),
  b("lazy", true, "Start when visible."),
  b("pauseOffscreen", true),
];

export const CAMERA_SPECS: ParamSpec[] = [
  e("type", ["perspective", "orthographic"], "perspective"),
  n("fov", 45, 1, 179),
  n("zoom", 10, 0),
  v3("position", [0, 0, 10]),
  v3("target", [0, 0, 0]),
  e("controls", ["none", "orbit", "parallax", "scroll", "follow"], "none"),
  n("autoRotate", 0, undefined, undefined, "deg/s"),
  b("orbitZoom", true),
  n("near", 0.1, 0),
  n("far", 1000, 0),
];

export const LIGHT_SPECS: Record<string, ParamSpec[]> = {
  ambient: [c("color", "#ffffff"), n("intensity", 1, 0)],
  hemisphere: [c("skyColor", "#ffffff"), c("groundColor", "#444444"), n("intensity", 1, 0)],
  directional: [c("color", "#ffffff"), n("intensity", 1, 0), v3("position", [5, 10, 5]), v3("target", [0, 0, 0]), b("castShadow", false)],
  point: [c("color", "#ffffff"), n("intensity", 1, 0), v3("position", [0, 2, 0]), n("distance", 0, 0), n("decay", 2, 0), b("castShadow", false)],
  spot: [c("color", "#ffffff"), n("intensity", 1, 0), v3("position", [0, 5, 0]), v3("target", [0, 0, 0]), n("angle", 30, 0, 90), n("penumbra", 0, 0, 1), n("distance", 0, 0), b("castShadow", false)],
  rect: [c("color", "#ffffff"), n("intensity", 1, 0), v3("position", [0, 3, 3]), v3("target", [0, 0, 0]), n("width", 1, 0), n("height", 1, 0)],
};

export const GROUND_SPECS: ParamSpec[] = [n("y", 0), n("size", 40, 0), c("color", "#888888"), b("shadowOnly", false), b("grid", false), n("roughness", 1, 0, 1)];
export const PHYSICS_SPECS: ParamSpec[] = [v3("gravity", [0, -9.81, 0]), n("step", 1 / 60, 0.001, 0.1)];
export const UI_THEME_SPECS: ParamSpec[] = [s("font", "CSS font-family (system stacks)."), c("color", "#ffffff"), c("accent", "#7c8cff")];
export const UI_ELEMENT_SPECS: ParamSpec[] = [
  e("type", ["text", "button", "bar"], "text"),
  s("text", "May contain {state.key} placeholders."),
  e("anchor", ["top-left", "top", "top-right", "left", "center", "right", "bottom-left", "bottom", "bottom-right"], "top-left"),
  e("style", ["plain", "pill", "title", "subtitle"], "plain"),
  s("value", "Bar: state key holding 0..1."),
  s("action", "Button: event emitted to scripts."),
];
export const SCENE_META_SPECS: ParamSpec[] = [s("title"), s("description"), s("ariaLabel", "Accessible label (defaults to the title)."), i("seed", undefined, 0, undefined, "Seed for generators / particles.")];
