// Field specs for scene properties that aren't catalog entries (object kinds,
// material, lights, camera…) so they reuse the ParamSpec-driven controls.

import type { ParamSpec } from "../../core/catalog";
import { FONTS, PARTICLE_PRESETS } from "../../core/catalog";
import { QUALITY_TIERS } from "../../core/postfx";
import { BODY_SHAPES, BODY_TYPES, COLLIDER_SHAPES, JOINT_TYPES, MATERIAL_TYPES, PHOTO_AUTO_MOTIONS, PHOTO_MODES, SKY_PRESETS, TONE_MAPPINGS } from "../../core/validate";

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
  b("kerning", true, "Apply the font's kerning pairs."),
  n("letterSpacing", 0, -0.5, 2, "Units added between characters (on top of kerning)."),
  n("lineHeight", 1.25, 0.5, 3, "Multiple of the font size."),
  n("maxWidth", undefined, 0, undefined, "Wrap lines on spaces to this width (units)."),
  i("curveSegments", undefined, 1, 32, "Points per glyph curve (default grows with the size)."),
  b("splitLetters", false, 'One child per glyph ("<id>/0", "<id>/1"…) that tracks can target.'),
];

export const TEXT_OUTLINE_SPECS: ParamSpec[] = [n("width", undefined, 0, undefined, "Units (default size × 0.06)."), c("color", "#111111"), n("depth", undefined, 0, undefined, "Thickness (default depth × 0.6).")];

export const TEXT_REVEAL_SPECS: ParamSpec[] = [
  e("effect", ["rise", "fade", "scale", "spin", "drop"], "rise"),
  n("stagger", 0.04, 0, 1, "Seconds between letters."),
  n("duration", 0.6, 0, 5, "Seconds per letter."),
  n("delay", 0, 0, 10, "Seconds before the first letter."),
  e("order", ["forward", "reverse", "center", "random"], "forward"),
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

export const SVG_SPECS: ParamSpec[] = [
  n("size", 2, 0, undefined, "Size in units (see fit)."),
  e("fit", ["width", "height", "max"], "width", "Which dimension `size` sets."),
  n("depth", 0.2, 0, undefined, "Extrusion (0 = flat)."),
  n("bevel", 0, 0),
  b("keepColors", undefined, "Keep the SVG's own fill / stroke colours (default: true without a material)."),
  b("strokes", true, "Extrude stroked paths (stroke-width, joins, caps)."),
  i("curveSegments", 12, 1, 64, "Points per curve."),
  n("layerGap", undefined, 0, 0.5, "Z step between successive paths (default depth × 0.02)."),
];

// 3D photo (kind "photo"); src / depth have their own image pickers.
export const PHOTO_MODE_SPEC: ParamSpec = e("mode", PHOTO_MODES, "parallax", "parallax: flat quad with shader relief (small motions). mesh: displaced grid (larger camera moves). layers: depth slices, a pop-up book look.");
export const PHOTO_SPECS: ParamSpec[] = [
  n("width", 4, 0, undefined, "World width in units (height follows the image aspect)."),
  n("height", undefined, 0, undefined, "World height (overrides the aspect when both are set)."),
  n("strength", 0.5, 0, 1, "Depth effect amount."),
  n("focus", 0.5, 0, 1, "Depth that stays still while the view moves (0 far, 1 near)."),
  i("segments", 256, 8, 1024, "Grid cells on the long side."),
  i("layers", 6, 2, 16, "Number of depth slices."),
  n("edgeCut", 0.08, 0, 1, "Hide stretched edges where depth jumps more than this (0 = off)."),
];
export const PHOTO_MOTION_SPECS: ParamSpec[] = [
  n("pointer", 1, 0, 1, "How much the pointer moves the view."),
  n("scroll", 0, 0, 1, "How much page scroll moves the view."),
  b("gyro", true, "Tilt on phones (when pointer > 0)."),
  e("auto", PHOTO_AUTO_MOTIONS, "sway", "Looping drift or cinematic camera move (dolly, pan, rise, vertigo) for renders, videos and touch screens."),
  n("speed", 1, 0, undefined, "Auto drift cycles per 10 s."),
  b("loop", true, "Seamless loop (off: one move over `duration`, then held)."),
  n("duration", undefined, 0.1, 600, "One-way move length in seconds (loop off)."),
  n("smoothing", undefined, 0, 1, "Easing of the view towards the pointer."),
];
export const PHOTO_MATERIAL_SPECS: ParamSpec[] = [c("color", "#ffffff", "Tint."), n("opacity", 1, 0, 1), n("emissiveIntensity", undefined, 0, undefined, "Self-lit amount (photos are unlit by default).")];

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
  n("envMapIntensity", 1, 0, 5, "Reflection strength of the environment lighting."),
];

// Physical material parameter groups (shown for physical materials / presets).
export const MATERIAL_GROUPS: { id: string; specs: ParamSpec[] }[] = [
  { id: "clearcoat", specs: [n("clearcoat", 0, 0, 1, "Glossy varnish layer."), n("clearcoatRoughness", 0, 0, 1)] },
  { id: "sheen", specs: [n("sheen", 0, 0, 1, "Fabric sheen (velvet, satin)."), c("sheenColor", "#ffffff"), n("sheenRoughness", 1, 0, 1)] },
  {
    id: "transmission",
    specs: [
      n("transmission", 0, 0, 1, "Glass-like transmission."),
      n("thickness", 0, 0, 10, "Volume thickness (refraction)."),
      n("ior", 1.5, 1, 2.333, "Index of refraction."),
      c("attenuationColor", "#ffffff", "Colour picked up through the volume."),
      n("attenuationDistance", undefined, 0, undefined, "Distance for the attenuation colour."),
      n("dispersion", 0, 0, 10, "Rainbow fire (gems)."),
    ],
  },
  { id: "iridescence", specs: [n("iridescence", 0, 0, 1, "Thin-film rainbow (soap, pearl)."), n("iridescenceIOR", 1.3, 1, 2.333), { name: "iridescenceThicknessRange", type: "vec2", description: "Film thickness range (nm).", default: [100, 400] }] },
  { id: "anisotropy", specs: [n("anisotropy", 0, 0, 1, "Stretched highlights (brushed metal)."), n("anisotropyRotation", 0, -180, 180, "Degrees.")] },
  { id: "specular", specs: [n("specularIntensity", 1, 0, 1), c("specularColor", "#ffffff")] },
];

// Texture slots and the scale params that go with them.
export const TEXTURE_SLOT_SCALES: Record<string, ParamSpec | undefined> = {
  normalMap: n("normalScale", 1, 0, 5),
  bumpMap: n("bumpScale", 1, 0, 5),
  aoMap: n("aoMapIntensity", 1, 0, 2),
  displacementMap: n("displacementScale", 1, 0, 5),
};
export const TEXTURE_MAPPING_SPECS: ParamSpec[] = [{ name: "repeat", type: "vec2", description: "Texture repeats (U, V).", default: [1, 1] }];
export const MATERIAL_TYPE_SPEC = e("type", MATERIAL_TYPES, "standard");

export const BODY_SPECS: ParamSpec[] = [
  e("type", BODY_TYPES, "static"),
  e("shape", BODY_SHAPES, "box", "auto: primitive → matching shape, terrain → heightfield."),
  v3("size", undefined, "Box size override."),
  n("radius", undefined, 0, undefined, "Sphere / cylinder / capsule radius."),
  n("height", undefined, 0, undefined, "Cylinder / capsule height."),
  v3("offset", undefined, "Collider centre offset."),
];
export const BODY_MOTION_SPECS: ParamSpec[] = [
  n("mass", 1, 0, undefined, "Dynamic bodies only."),
  n("friction", 0.5, 0, 2),
  n("restitution", 0, 0, 1, "Bounciness."),
  s("material", "physics.materials name (friction / restitution defaults)."),
  n("linearDamping", 0.01, 0, 1),
  n("angularDamping", 0.01, 0, 1),
  n("gravityScale", 1, -5, 5),
  v3("velocity", undefined, "Initial velocity."),
  v3("angularVelocity", undefined, "Initial spin (deg/s)."),
];
export const BODY_FLAG_SPECS: ParamSpec[] = [
  b("fixedRotation", false, "No rotation (players)."),
  b("character", false, "Character controller: fixed rotation, no friction, never sleeps."),
  b("sleep", true, "Allow resting bodies to sleep."),
  b("ccd", false, "Fast object: extra sub-steps against tunnelling."),
  s("layer", 'Collision layer (default "default").'),
];
export const COLLIDER_SPECS: ParamSpec[] = [e("shape", COLLIDER_SHAPES, "box"), v3("size", [1, 1, 1]), n("radius", 0.5, 0), n("height", 1, 0), v3("offset", [0, 0, 0]), v3("rotation", [0, 0, 0], "Degrees.")];
export const JOINT_SPECS: ParamSpec[] = [
  e("type", JOINT_TYPES, "hinge"),
  v3("pivot", undefined, "World anchor (default: b's centre)."),
  v3("axis", [0, 1, 0], "Hinge axis."),
  n("distance", undefined, 0, undefined, "Distance joint (default: current)."),
  n("restLength", undefined, 0, undefined, "Spring (default: current distance)."),
  n("stiffness", 50, 0, undefined, "Spring."),
  n("damping", 1, 0, undefined, "Spring."),
  n("maxForce", 1e6, 0),
  b("collideConnected", false),
];

// Top-level objects only: ride with the camera (position / rotation in camera space, -z forward).
export const ATTACH_SPEC: ParamSpec = e("attach", ["none", "camera"], "none", "camera: the object rides with the camera (position / rotation in camera space: x right, y up, -z forward). Captions and labels that stay on screen during camera moves.");
export const OBJECT_FLAGS: ParamSpec[] = [b("castShadow", false), b("receiveShadow", false), s("href", "Clicking the object opens this URL.")];

export const TARGET_SPECS: ParamSpec[] = [
  { name: "aspect", type: "string", description: '"W:H", e.g. "4:1".' },
  s("height", 'Fixed CSS height instead of the aspect (e.g. "320px").'),
  b("transparent", false, "Transparent canvas (page shows through)."),
  i("budgetKb", undefined, 0, undefined, "Bundle budget (KB)."),
  e("reducedMotion", ["static", "slow", "ignore"], "static"),
  n("posterTime", 0, 0, undefined, "Time of the poster frame."),
  e("quality", ["auto", ...QUALITY_TIERS], "auto", "Rendering quality tier (auto: from the device, steps down when slow)."),
  e("toneMapping", TONE_MAPPINGS, "aces"),
  n("exposure", 1, 0, 4),
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
  ambient: [c("color", "#ffffff"), n("intensity", 1, 0, 10)],
  hemisphere: [c("skyColor", "#ffffff"), c("groundColor", "#444444"), n("intensity", 1, 0, 10)],
  directional: [c("color", "#ffffff"), n("intensity", 1, 0, 20), v3("position", [5, 10, 5]), v3("target", [0, 0, 0]), b("castShadow", false)],
  point: [c("color", "#ffffff"), n("intensity", 1, 0, 100), v3("position", [0, 2, 0]), n("distance", 0, 0), n("decay", 2, 0, 4), b("castShadow", false)],
  spot: [c("color", "#ffffff"), n("intensity", 1, 0, 100), v3("position", [0, 5, 0]), v3("target", [0, 0, 0]), n("angle", 30, 0, 90), n("penumbra", 0, 0, 1), n("distance", 0, 0), n("decay", 2, 0, 4), b("castShadow", false)],
  rect: [c("color", "#ffffff"), n("intensity", 1, 0, 50), v3("position", [0, 3, 3]), v3("target", [0, 0, 0]), n("width", 1, 0), n("height", 1, 0), b("panel", false, "Draw the glowing panel (visible in the frame and reflections).")],
};
export const LIGHT_SHADOW_SPECS: ParamSpec[] = [n("softness", 3, 0, 30), i("mapSize", 2048, 256, 4096), n("bias", 0, -0.01, 0.01), n("normalBias", 0, 0, 1), n("intensity", 1, 0, 1, "Shadow darkness.")];
export const VOLUMETRIC_SPECS: ParamSpec[] = [n("intensity", 1, 0, 5), n("length", undefined, 0, undefined, "Cone length (default: to the target)."), c("color", undefined, "Default: the light colour.")];

// ─── Environment ───
export const SKY_GRADIENT_SPECS: ParamSpec[] = [c("top", "#3a7bd5"), c("horizon", "#f6d5a8"), c("bottom", "#d1d7e0"), i("stars", 0, 0, 5000)];
export const SKY_PHYSICAL_SPECS: ParamSpec[] = [
  e("preset", SKY_PRESETS, undefined, "Time-of-day preset (implies a physical sky)."),
  n("turbidity", undefined, 0, 30, "Haze."),
  n("rayleigh", undefined, 0, 6, "Blue scattering."),
  n("mieCoefficient", undefined, 0, 0.1),
  n("mieDirectionalG", undefined, 0, 0.999),
  n("exposure", 1, 0, 4),
  n("clouds", 0, 0, 1, "Cloud coverage."),
  i("stars", 0, 0, 5000),
];
export const SKY_SUN_SPECS: ParamSpec[] = [
  n("elevation", undefined, -90, 90, "Degrees above the horizon."),
  n("azimuth", undefined, -180, 180, "Degrees, 0 = +Z (towards the default camera)."),
  c("color", undefined),
  n("size", undefined, 0, 10),
  b("light", true, "Add the matching directional sun light."),
  n("intensity", undefined, 0, 20),
  b("castShadow", true),
];
export const HDRI_BG_SPECS: ParamSpec[] = [n("intensity", 1, 0, 5), n("rotation", 0, -180, 180, "Degrees around Y."), n("blur", 0, 0, 1)];
export const GROUND_PROJECTION_SPECS: ParamSpec[] = [n("height", 15, 0, undefined, "Camera height of the photo."), n("radius", 100, 0, undefined, "Ground disc radius.")];
export const MESH_GRADIENT_SPECS: ParamSpec[] = [n("speed", 0, 0, 2, "Animation speed (0 = static)."), n("scale", 1, 0.05, 5), i("seed", undefined), n("grain", 0, 0, 1)];
export const CONTACT_SHADOW_SPECS: ParamSpec[] = [n("opacity", 0.6, 0, 1), n("blur", 2.5, 0, 20), n("far", 1.5, 0, undefined, "How high above the plane objects still cast."), n("y", undefined, undefined, undefined, "Plane height (default: ground.y or 0)."), n("size", undefined, 0, undefined, "Square side (default: fitted)."), i("resolution", 512, 64, 2048), c("color", "#000000"), i("frames", 0, 0, undefined, "Re-render only the first N frames (0 = always).")];
export const SHADOW_SETTINGS_SPECS: ParamSpec[] = [e("type", ["pcf", "vsm"], "pcf", "vsm = smooth blurred shadows."), n("softness", 3, 0, 30), i("mapSize", 2048, 256, 4096), n("intensity", 1, 0, 1)];
export const FOG_LINEAR_SPECS: ParamSpec[] = [c("color", "#ffffff"), n("near", undefined, 0), n("far", undefined, 0)];
export const FOG_EXP_SPECS: ParamSpec[] = [c("color", "#ffffff"), n("density", undefined, 0, 0.5), n("height", undefined, undefined, undefined, "Height fog: thick below this y."), n("falloff", undefined, 0, 5, "Height fog falloff.")];
export const RIG_LIGHTING_SPECS: ParamSpec[] = [n("intensity", 1, 0, 5), n("rotation", 0, -180, 180)];

export const GROUND_SPECS: ParamSpec[] = [n("y", 0), n("size", 40, 0), c("color", "#888888"), b("shadowOnly", false), b("grid", false), n("roughness", 1, 0, 1), n("opacity", 1, 0, 1)];
export const PHYSICS_SPECS: ParamSpec[] = [
  v3("gravity", [0, -9.81, 0]),
  n("step", 1 / 60, 0.001, 0.1, "Fixed step (s)."),
  i("substeps", 1, 1, 8, "Solver sub-steps per step."),
  i("iterations", 10, 1, 100, "Constraint solver iterations."),
  b("sleep", true, "Let resting bodies sleep."),
  b("debug", false, "Draw collider wireframes."),
];
export const UI_THEME_SPECS: ParamSpec[] = [s("font", "CSS font-family (system stacks)."), c("color", "#ffffff"), c("accent", "#7c8cff"), c("buttonText", undefined, "Button label colour (default: white or near-black, whichever contrasts best with the accent).")];
export const UI_ELEMENT_SPECS: ParamSpec[] = [
  e("type", ["text", "button", "bar"], "text"),
  s("text", "May contain {state.key} placeholders."),
  e("anchor", ["top-left", "top", "top-right", "left", "center", "right", "bottom-left", "bottom", "bottom-right"], "top-left"),
  e("style", ["plain", "pill", "title", "subtitle", "panel"], "plain", "panel = a backdrop card (game-over / pause screens; \\n breaks lines)."),
  s("value", "Bar: state key holding 0..1."),
  s("action", "Button: event emitted to scripts."),
  c("color", undefined, "Text colour of this element."),
  c("background", undefined, "Background of a button / pill / panel / bar track."),
];
export const SCENE_META_SPECS: ParamSpec[] = [s("title"), s("description"), s("ariaLabel", "Accessible label (defaults to the title)."), i("seed", undefined, 0, undefined, "Seed for generators / particles.")];
