// Depth-driven effects of 3D photos (PhotoObjectDef.effects): the parameter
// table declared once. Validation (validate.ts photo(), validateMotion.ts
// effect tracks), the runtimes (src/runtime/build/photoFx.ts: defaults) and
// the Studio inspector derive from it. No prose here: this module ships in
// the photo-only lite runtime (descriptions live in docs/scene-format.md).
//
// Adding an effect: an entry here, its GLSL + uniforms in photoFx.ts, the type
// in types.ts PhotoEffectsDef, docs + skill recipe.

export type PhotoFxParamType = "number" | "color" | "vec2" | "enum";

export interface PhotoFxParam {
  type: PhotoFxParamType;
  default?: number | string | [number, number];
  min?: number;
  max?: number;
  options?: readonly string[];
  // false: not animatable from the timeline (enums)
  animatable?: boolean;
  // vec2 only: a single number is also accepted (both coordinates)
  scalar?: boolean;
}

export interface PhotoFxSpec {
  params: Record<string, PhotoFxParam>;
  // Needs a depth map: without one (flat photo) the effect is ignored.
  needsDepth: boolean;
  // Changes the photo's alpha: the photo is drawn blended.
  alpha?: boolean;
}

const num = (def: number | undefined, min?: number, max?: number): PhotoFxParam => ({ type: "number", default: def, min, max });

export const PHOTO_EFFECTS = {
  // Atmospheric haze accumulating with distance (depth below `start`).
  fog: {
    needsDepth: true,
    params: {
      color: { type: "color", default: "#ffffff" },
      amount: num(0.6, 0, 1),
      start: num(0.7, 0, 1),
      end: num(0, 0, 1),
      drift: num(0.3, 0),
    },
  },
  // Relighting: normals from the depth gradient, a light raking over the relief.
  light: {
    needsDepth: false,
    params: {
      color: { type: "color", default: "#ffffff" },
      intensity: num(1, 0),
      ambient: num(0.75, 0, 1),
      position: { type: "vec2", default: [0.4, 0.4], min: -1, max: 1 },
      height: num(0.6, 0),
      radius: num(0.8, 0),
      relief: num(1, 0),
      specular: num(0.25, 0, 1),
      follow: { type: "enum", default: "pointer", options: ["pointer", "auto", "none"], animatable: false },
    },
  },
  // Depth-sliced appearance (alpha), far → near (default) or near → far.
  reveal: {
    needsDepth: true,
    alpha: true,
    params: {
      progress: num(1, 0, 1),
      from: { type: "enum", default: "far", options: ["near", "far"], animatable: false },
      softness: num(0.15, 0, 1),
      duration: num(undefined, 0),
      delay: num(0, 0),
    },
  },
  // Rack focus / depth of field: depths away from `focus` (beyond `range`)
  // blur up to `amount` (% of the photo width). Flat photo: an even blur.
  // `to` + `duration`: the focus racks focus → to → focus (ping-pong loop).
  blur: {
    needsDepth: false,
    params: {
      focus: num(undefined, 0, 1),
      amount: num(0.6, 0, 5),
      range: num(0.1, 0, 1),
      to: num(undefined, 0, 1),
      duration: num(undefined, 0),
      delay: num(0, 0),
    },
  },
  // "Out of frame": the photo inside an inset frame (border), the near
  // subject (depth >= threshold) drawn outside it; the rest is transparent.
  frame: {
    needsDepth: false,
    alpha: true,
    params: {
      inset: { type: "vec2", default: [0.12, 0.12], min: 0, max: 0.45, scalar: true },
      threshold: num(0.6, 0, 1),
      softness: num(0.04, 0, 1),
      border: num(0.015, 0, 0.2),
      color: { type: "color", default: "#ffffff" },
      shadow: num(0.35, 0, 1),
    },
  },
} satisfies Record<string, PhotoFxSpec>;

export type PhotoEffectId = keyof typeof PHOTO_EFFECTS;
export const PHOTO_EFFECT_IDS = Object.keys(PHOTO_EFFECTS) as PhotoEffectId[];
