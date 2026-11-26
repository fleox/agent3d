// Depth-driven effects of 3D photos (PhotoObjectDef.effects: fog, light,
// reveal). Three.js-free: shared by ./photo.ts (full runtime, every mode) and
// the photo-only lite player (../lite/player.ts), like ./photoCore.ts.
//
// Each effect = uniforms + a GLSL block run by `photoFx(c, uv, d)` after the
// photo texel is found: `c` the texel, `uv` the final sampled UV (parallax:
// the relief-mapping hit, `pxUv`), `d` its depth (0 far .. 1 near, from the
// depth map at `uv`), plus the photo-space position q (-1..1 on y, ± aspect
// on x) and the player time `uFxTime` (deterministic: the player clock).
// Without effects nothing is added: `glsl` and `call()` are "" and the photo
// shaders are unchanged.
//
// Parameters, defaults and ranges: src/core/photoEffects.ts. Live values
// (timeline tracks "<id>.effects.<effect>.<param>") go through set() and reach
// the uniforms on the next uniforms() read.

import { PHOTO_EFFECTS, PHOTO_EFFECT_IDS, type PhotoEffectId } from "../../core/photoEffects";
import type { PhotoEffectsDef } from "../../core/types";
import { clamp, num } from "../num";
import { smoothToward } from "./photoCore";

export type Rgb = [number, number, number];
export type FxValue = number | string | number[];
export type PhotoFxState = Partial<Record<PhotoEffectId, Record<string, FxValue>>>;

export interface PhotoFxOptions {
  depth: boolean; // a depth map is bound (uDepth); false = flat photo
  color: (c: string) => Rgb; // colour → linear RGB
  aspect: number; // photo width / height
  live?: boolean; // smooth the pointer (live players); deterministic = as is
  smoothing?: number; // pointer smoothing (photo motion.smoothing)
  speed?: number; // auto light path: cycles per 10 s (photo motion.speed)
}

// Effect params with their defaults, colours as linear RGB. Effects that need
// a depth map are dropped on a flat photo (validate reports it).
export function resolvePhotoEffects(def: PhotoEffectsDef | undefined, opts: Pick<PhotoFxOptions, "depth" | "color">): PhotoFxState {
  const out: PhotoFxState = {};
  for (const id of PHOTO_EFFECT_IDS) {
    const src = (def as Record<string, Record<string, unknown> | undefined> | undefined)?.[id];
    const spec = PHOTO_EFFECTS[id];
    if (!src || typeof src !== "object" || (spec.needsDepth && !opts.depth)) continue;
    const vals: Record<string, FxValue> = {};
    for (const [k, p] of Object.entries(spec.params)) {
      const v = src[k] ?? p.default;
      if (v === undefined) continue;
      if (p.type === "color") vals[k] = opts.color(typeof v === "string" ? v : String(p.default));
      else if (p.type === "vec2") vals[k] = Array.isArray(v) ? [num(v[0], 0), num(v[1], 0)] : [...(p.default as number[])];
      else if (p.type === "enum") vals[k] = typeof v === "string" && p.options?.includes(v) ? v : (p.default as string);
      else vals[k] = num(v, num(p.default, 0));
    }
    out[id] = vals;
  }
  return out;
}

// ─── GLSL ───────────────────────────────────────────────────────────────

const FX_HEAD = /* glsl */ `
uniform float uFxTime;
uniform float uFxAspect;
`;

const LIGHT_UNIFORMS = /* glsl */ `
uniform vec3 uLightColor;
uniform vec3 uLightPos;
uniform vec4 uLight;
`;
// photo-space height of the surface (near = 0, far = -relief / 2)
const LIGHT_DEPTH_FN = /* glsl */ `
float fxZ(vec2 p) { return (textureLod(uDepth, p, 0.0).r - 1.0) * 0.5 * uLight.z; }
`;
// uLightColor = colour × intensity; uLightPos = x, y (photo space), height;
// uLight = ambient, radius, relief, specular. Lambert + Blinn specular from
// the depth-gradient normal, a short shadow march towards the light, a soft
// shoulder so lit highlights never clip to white.
const lightBlock = (depth: boolean) => /* glsl */ `
  {
    vec3 L = vec3(uLightPos.xy * vec2(uFxAspect, 1.0), uLightPos.z);
    vec3 n = vec3(0.0, 0.0, 1.0);
    vec3 S = vec3(q, 0.0);
    float sh = 0.0;
    ${depth ? FX_LIGHT_RELIEF : ""}
    vec3 tl = L - S;
    vec3 l = normalize(tl);
    float att = 1.0 / (1.0 + max(dot(tl, tl) - L.z * L.z, 0.0) / max(uLight.y * uLight.y, 1e-4));
    att *= att * 1.6;
    float df = max(dot(n, l), 0.0) * (1.0 - 0.6 * sh);
    float sp = pow(max(dot(n, normalize(l + vec3(0.0, 0.0, 1.0))), 0.0), 40.0) * uLight.w * (1.0 - sh);
    vec3 lit = c.rgb * (uLight.x + df * att * uLightColor) + uLightColor * sp * att * 0.35;
    vec3 k = vec3(0.78);
    c.rgb = mix(lit, k + (1.0 - k) * (1.0 - exp((k - lit) / (1.0 - k))), step(k, lit));
  }
`;
const FX_LIGHT_RELIEF = /* glsl */ `
    vec2 e = 2.5 / vec2(textureSize(uDepth, 0));
    S.z = fxZ(uv);
    // normals exaggerated 3× over the true slope: depth maps are smooth
    n = normalize(vec3(3.0 * (fxZ(uv - vec2(e.x, 0.0)) - fxZ(uv + vec2(e.x, 0.0))) / (4.0 * e.x * uFxAspect), 3.0 * (fxZ(uv - vec2(0.0, e.y)) - fxZ(uv + vec2(0.0, e.y))) / (4.0 * e.y), 1.0));
    vec3 sd = normalize(L - S);
    for (int i = 1; i <= 8; i++) {
      vec3 P = S + sd * (float(i) * 0.035);
      // local relief only: a big depth jump (a facade against the sky) casts no shadow
      float dz = fxZ(P.xy / vec2(uFxAspect, 1.0) * 0.5 + 0.5) - P.z;
      sh = max(sh, clamp(dz * 24.0, 0.0, 1.0) * (1.0 - smoothstep(0.03, 0.08, dz / max(uLight.z, 1e-3))));
    }
`;

// uFog = amount, start, 1 / (start - end), drift. Value-noise wisps drift
// with time (static when drift = 0).
const FOG_UNIFORMS = /* glsl */ `
uniform vec3 uFogColor;
uniform vec4 uFog;
float fxHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float fxNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(fxHash(i), fxHash(i + vec2(1.0, 0.0)), f.x), mix(fxHash(i + vec2(0.0, 1.0)), fxHash(i + 1.0), f.x), f.y);
}
`;
const FOG_BLOCK = /* glsl */ `
  {
    float k = clamp((uFog.y - d) * uFog.z, 0.0, 1.0);
    float s = uFxTime * uFog.w;
    float w = 0.65 * fxNoise(q * vec2(1.4, 2.6) + vec2(s * 0.4, s * 0.06)) + 0.35 * fxNoise(q * vec2(3.6, 6.0) - vec2(s * 0.7, -s * 0.1));
    c.rgb = mix(c.rgb, uFogColor, clamp(uFog.x * k * k * (3.0 - 2.0 * k) * (0.6 + 0.8 * w), 0.0, 1.0));
  }
`;

// uReveal = threshold (from progress), from near (1) / far (0), softness.
const REVEAL_UNIFORMS = /* glsl */ `
uniform vec3 uReveal;
`;
const REVEAL_BLOCK = /* glsl */ `
  c.a *= 1.0 - smoothstep(uReveal.x - uReveal.z, uReveal.x + uReveal.z, uReveal.y > 0.5 ? 1.0 - d : d);
`;

// GLSL for the active effects ("" when none). Needs PHOTO_COMMON_GLSL (and
// uDepth when opts.depth) declared before it.
export function photoFxGlsl(state: PhotoFxState, depth: boolean): string {
  if (!hasEffects(state)) return "";
  let head = FX_HEAD, body = "";
  if (state.light) {
    head += LIGHT_UNIFORMS + (depth ? LIGHT_DEPTH_FN : "");
    body += lightBlock(depth);
  }
  if (state.fog) {
    head += FOG_UNIFORMS;
    body += FOG_BLOCK;
  }
  if (state.reveal) {
    head += REVEAL_UNIFORMS;
    body += REVEAL_BLOCK;
  }
  return `${head}vec4 photoFx(vec4 c, vec2 uv, float d) {
  vec2 q = (uv * 2.0 - 1.0) * vec2(uFxAspect, 1.0);
${body}  return c;
}
`;
}

export const hasEffects = (state: PhotoFxState): boolean => !!(state.fog || state.light || state.reveal);

// ─── Live state ─────────────────────────────────────────────────────────

export interface PhotoFxInput {
  pointer: { x: number; y: number; inside: boolean };
  reduced: boolean;
}

export interface PhotoFx {
  state: PhotoFxState;
  glsl: string; // "" without effects
  alpha: boolean; // changes the alpha (draw blended)
  // GLSL statement applying the effects to `c` ("" without effects).
  call(uv: string, depth: string): string;
  frame(t: number, dt: number, input: PhotoFxInput): void;
  // Uniform values for the last frame (name → 1..4 floats).
  uniforms(): Record<string, number[]>;
  get(effect: string, param: string): FxValue | undefined;
  set(effect: string, param: string, value: number | number[]): boolean;
}

// Auto light path (pure function of t): a slow loop around `position`,
// starting on it at t = 0.
export function autoLightPath(pos: number[], speed: number, t: number): [number, number] {
  const a = ((2 * Math.PI * Math.max(0, speed)) / 10) * t;
  return [clamp(pos[0] - 0.7 * Math.sin(a), -1, 1), clamp(pos[1] - 0.35 * (1 - Math.cos(2 * a)), -1, 1)];
}

// Reveal threshold for a progress (depth below it shows).
export function revealThreshold(progress: number, softness: number): number {
  const s = Math.max(softness, 1e-3);
  return -s + clamp(progress, 0, 1) * (1 + 2 * s);
}

export function createPhotoFx(def: PhotoEffectsDef | undefined, opts: PhotoFxOptions): PhotoFx {
  const state = resolvePhotoEffects(def, opts);
  const on = hasEffects(state);
  const live = !!opts.live;
  const sm = { x: 0, y: 0, w: 0, init: false };
  let t = 0, reduced = false;
  const frame = (time: number, dt: number, input: PhotoFxInput) => {
    t = time;
    reduced = input.reduced;
    const p = input.pointer;
    const tx = p.inside ? clamp(p.x, -1, 1) : sm.x, ty = p.inside ? clamp(p.y, -1, 1) : sm.y, tw = p.inside ? 1 : 0;
    if (!live || !sm.init) {
      sm.x = tx;
      sm.y = ty;
      sm.w = tw;
      sm.init = live;
    } else {
      const s = clamp(num(opts.smoothing, 0.9), 0, 0.99);
      sm.x = smoothToward(sm.x, tx, dt, s);
      sm.y = smoothToward(sm.y, ty, dt, s);
      sm.w = smoothToward(sm.w, tw, dt, s);
    }
  };
  const uniforms = (): Record<string, number[]> => {
    const u: Record<string, number[]> = { uFxTime: [t], uFxAspect: [opts.aspect] };
    const L = state.light;
    if (L) {
      const c = L.color as number[], k = L.intensity as number, pos = L.position as number[];
      let xy: number[] = pos;
      if (!reduced && L.follow !== "none") {
        const auto = autoLightPath(pos, num(opts.speed, 1), t);
        xy = L.follow === "auto" ? auto : [auto[0] + (sm.x - auto[0]) * sm.w, auto[1] + (sm.y - auto[1]) * sm.w];
      }
      u.uLightColor = [c[0] * k, c[1] * k, c[2] * k];
      u.uLightPos = [xy[0], xy[1], Math.max(0.02, L.height as number)];
      u.uLight = [clamp(L.ambient as number, 0, 1), Math.max(1e-3, L.radius as number), L.relief as number, clamp(L.specular as number, 0, 1)];
    }
    const F = state.fog;
    if (F) {
      const start = F.start as number, span = start - (F.end as number);
      u.uFogColor = (F.color as number[]).slice(0, 3);
      u.uFog = [clamp(F.amount as number, 0, 1), start, 1 / (Math.abs(span) < 1e-3 ? (span < 0 ? -1e-3 : 1e-3) : span), Math.max(0, F.drift as number)];
    }
    const R = state.reveal;
    if (R) {
      const dur = R.duration as number | undefined;
      let p = R.progress as number;
      if (typeof dur === "number") {
        const k = reduced || dur <= 0 ? 1 : clamp((t - (R.delay as number)) / dur, 0, 1);
        p = k * k * (3 - 2 * k);
      }
      const soft = Math.max(1e-3, R.softness as number);
      u.uReveal = [revealThreshold(p, soft), R.from === "near" ? 1 : 0, soft];
    }
    return u;
  };
  return {
    state,
    glsl: photoFxGlsl(state, opts.depth),
    alpha: !!state.reveal,
    call: (uv, depth) => (on ? `c = photoFx(c, ${uv}, ${opts.depth ? depth : "0.5"});` : ""),
    frame,
    uniforms,
    get(effect, param) {
      const s = state[effect as PhotoEffectId];
      const [name, axis] = param.split(".");
      const v = s?.[name];
      if (axis && Array.isArray(v)) return v[axis === "y" ? 1 : 0];
      return Array.isArray(v) ? [...v] : v;
    },
    set(effect, param, value) {
      const s = state[effect as PhotoEffectId];
      const [name, axis] = param.split(".");
      if (!s || !(name in s) && !(name in (PHOTO_EFFECTS[effect as PhotoEffectId]?.params ?? {}))) return false;
      const cur = s[name];
      if (axis && Array.isArray(cur) && typeof value === "number") cur[axis === "y" ? 1 : 0] = value;
      else if (Array.isArray(value)) s[name] = value.slice(0, Array.isArray(cur) ? cur.length : value.length);
      else if (typeof value === "number" && Number.isFinite(value)) s[name] = value;
      else return false;
      return true;
    },
  };
}
