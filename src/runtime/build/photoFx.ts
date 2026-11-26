// Depth-driven effects of 3D photos (PhotoObjectDef.effects: fog, light,
// reveal, blur, frame). Three.js-free: shared by ./photo.ts (full runtime, every mode) and
// the photo-only lite player (../lite/player.ts), like ./photoCore.ts.
//
// Each effect = uniforms + a GLSL block run by `photoFx(c, uv, d, s)` after
// the photo texel is found: `c` the texel, `uv` the final sampled UV
// (parallax: the relief-mapping hit, `pxUv`), `d` its depth (0 far .. 1 near,
// from the depth map at `uv`), `s` the UV on the photo's quad / surface (what
// stays put while the view moves: the frame is drawn there), plus the
// photo-space position q (-1..1 on y, ± aspect on x) and the player time
// `uFxTime` (deterministic: the player clock). The blur re-samples uMap /
// uDepth (shared sampler names) around `uv`. Block order: blur (replaces the
// colour), light, fog, reveal, frame (composes the frame over transparency).
// Without effects nothing is added: `glsl` and `call()` are "" and the photo
// shaders are unchanged.
//
// Parameters, defaults and ranges: src/core/photoEffects.ts. Live values
// (timeline tracks "<id>.effects.<effect>.<param>") go through set() and reach
// the uniforms on the next uniforms() read.

import { PHOTO_EFFECTS, PHOTO_EFFECT_IDS, type PhotoEffectId, type PhotoFxSpec } from "../../core/photoEffects";
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
  focus?: number; // the photo's focus (default of blur.focus; 0.5)
  quality?: "low" | "medium" | "high" | "ultra"; // blur taps (low 8, medium 12, else 16)
  parallax?: boolean; // parallax mode: PARALLAX_GLSL's uniforms are declared (blur centring)
  inset?: [number, number]; // parallax UV inset (texture UV = 0.5 + (quad UV - 0.5) × inset; default 1)
}

// Effect params with their defaults, colours as linear RGB. Effects that need
// a depth map are dropped on a flat photo (validate reports it).
export function resolvePhotoEffects(def: PhotoEffectsDef | undefined, opts: Pick<PhotoFxOptions, "depth" | "color" | "focus">): PhotoFxState {
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
      else if (p.type === "vec2") vals[k] = Array.isArray(v) ? [num(v[0], 0), num(v[1], 0)] : typeof v === "number" ? [v, v] : [...(p.default as number[])];
      else if (p.type === "enum") vals[k] = typeof v === "string" && p.options?.includes(v) ? v : (p.default as string);
      else vals[k] = num(v, num(p.default, 0));
    }
    if (id === "blur") vals.focus ??= clamp(num(opts.focus, 0.5), 0, 1);
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

// uBlur = focus, range, max radius (UV x), 1 / falloff. Circle of confusion
// 0..1 from the distance to the focus beyond the sharp range.
const BLUR_UNIFORMS = /* glsl */ `
uniform vec4 uBlur;
float fxCoc(float z) { return clamp((abs(z - uBlur.x) - uBlur.y) * uBlur.w, 0.0, 1.0); }
`;
// Lens-like gather blur: N taps on a Vogel (golden-angle) disc, sampled from
// a mip level matching the tap spacing (smooth, no box / ring look), bright
// taps weigh more (bokeh). Scatter-as-gather: a tap counts when its own blur
// reaches this pixel; a tap farther than the centre spreads no further than
// the centre's blur (a blurred background never haloes over a sharp
// subject), a nearer one may (a blurred foreground bleeds over a sharp
// background). The gather radius is at least ~1/3 of the max for that bleed.
// Depth-edge texels (depth-map alpha 0: their depth is a blend of both
// sides) never count as taps, and a centre on one belongs to the nearer side
// (the nearest depth 2 texels around).
// Parallax mode: the taps are centred where the centre's depth sits without
// occlusion (parallaxTexel's formula, ./photoCore.ts): equal to the hit UV,
// except in disocclusion strips, whose UV jumps past the depth edge — there
// a gather around the jump would draw a thin line of the far side's colour.
const BLUR_PARALLAX_CENTRE = /* glsl */ `
    vec2 gc = 0.5 + (s - 0.5) * uInset * (1.0 - 0.06 * uZoom) + (d - uFocus) * (uView - (s - 0.5) * 2.0 * uZoom) * uMaxOffset;
`;
const BLUR_EDGE = /* glsl */ `
    if (textureLod(uDepth, uv, 0.0).a < 0.5) {
      vec2 de = 2.0 / vec2(textureSize(uDepth, 0));
      dc = max(max(textureLod(uDepth, uv + vec2(de.x, 0.0), 0.0).r, textureLod(uDepth, uv - vec2(de.x, 0.0), 0.0).r), max(textureLod(uDepth, uv + vec2(0.0, de.y), 0.0).r, textureLod(uDepth, uv - vec2(0.0, de.y), 0.0).r));
    }
`;
const blurBlock = (depth: boolean, taps: number, parallax: boolean) => /* glsl */ `
  {
    ${parallax ? BLUR_PARALLAX_CENTRE : "vec2 gc = uv;"}
    float dc = d;
    ${depth ? BLUR_EDGE : ""}
    float cc = fxCoc(dc);
    vec2 R = vec2(uBlur.z, uBlur.z * uFxAspect);
    float rs = max(cc, 0.35);
    float lod = log2(max(rs * uBlur.z * float(textureSize(uMap, 0).x) * ${(0.6 * (3.14159265 / taps) ** 0.5).toFixed(3)}, 1.0));
    vec3 acc = mix(c.rgb, textureLod(uMap, gc, lod * cc).rgb, cc);
    float ws = 1.0;
    for (int i = 0; i < ${taps}; i++) {
      float fi = float(i) + 0.5;
      float r = sqrt(fi / ${taps}.0) * rs;
      vec2 p = gc + vec2(cos(fi * 2.39996), sin(fi * 2.39996)) * r * R;
      vec2 dt = ${depth ? "textureLod(uDepth, p, 0.0).ra" : "vec2(d, 1.0)"};
      float ct = fxCoc(dt.x);
      float w = clamp(((dt.x < dc - 0.03 ? min(ct, cc) : ct) - r) * 20.0 + 0.5, 0.0, 1.0) * step(0.5, dt.y);
      vec3 sc = textureLod(uMap, p, lod).rgb;
      w *= 1.0 + 3.0 * max(dot(sc, vec3(0.2126, 0.7152, 0.0722)) - 0.7, 0.0);
      acc += sc * w;
      ws += w;
    }
    c.rgb = acc / ws;
  }
`;

// uFrame = inner half size (photo space, x incl. aspect), border width,
// softness; uFrameB = threshold, shadow, parallax UV inset (x, y). Layers,
// back to front: drop shadow
// (frame + popped subject) on the page, border, picture, the popped subject
// (depth >= threshold) over everything. Outside the frame: transparent.
const FRAME_UNIFORMS = /* glsl */ `
uniform vec4 uFrame;
uniform vec4 uFrameB;
uniform vec3 uFrameColor;
float fxBox(vec2 p, vec2 h) { vec2 e = abs(p) - h; return length(max(e, 0.0)) + min(max(e.x, e.y), 0.0); }
// popped content fades out near the photo's own edges (no hard photo cut on the page)
float fxEdge(vec2 p, float w) { return smoothstep(0.0, w, -fxBox(p, vec2(uFxAspect, 1.0))); }
`;
// the popped subject's shadow on the page: its depth one shadow offset back,
// 8 taps on a small Vogel disc (a soft penumbra), read at the photo's rest
// position (the quad UV, continuous: the parallax UV jumps at depth edges)
const FRAME_SUBJECT_SHADOW = /* glsl */ `
    float ks = 0.0;
    // per-pixel rotation (interleaved gradient noise): grain, not banded copies
    float jr = 6.2832 * fract(52.9829 * fract(dot(gl_FragCoord.xy, vec2(0.06711, 0.00584))));
    for (int i = 0; i < 8; i++) {
      float fi = float(i) + 0.5;
      vec2 o = so + 0.04 * sqrt(fi / 8.0) * vec2(cos(fi * 2.39996 + jr), sin(fi * 2.39996 + jr));
      ks += fxEdge(qs - o, 0.25) * smoothstep(uFrameB.x - uFrame.w, uFrameB.x + uFrame.w, textureLod(uDepth, 0.5 + (s - 0.5 - o / vec2(2.0 * uFxAspect, 2.0)) * uFrameB.zw, 0.0).r);
    }
    sh = max(sh, 0.1 * ks);
`;
// the pop-out mask eroded by 3 depth texels: depth maps are softer than the
// photo, so a depth edge spills a little onto the background colour (a pale
// halo around the popped subject without it)
const FRAME_ERODE = /* glsl */ `
    vec2 et = 3.0 / vec2(textureSize(uDepth, 0));
    dp = min(dp, min(min(textureLod(uDepth, uv + vec2(et.x, 0.0), 0.0).r, textureLod(uDepth, uv - vec2(et.x, 0.0), 0.0).r), min(textureLod(uDepth, uv + vec2(0.0, et.y), 0.0).r, textureLod(uDepth, uv - vec2(0.0, et.y), 0.0).r)));
`;
const frameBlock = (depth: boolean) => /* glsl */ `
  {
    vec2 qs = (s * 2.0 - 1.0) * vec2(uFxAspect, 1.0);
    float aa = max(length(fwidth(qs)), 1e-5);
    float din = fxBox(qs, uFrame.xy);
    float inner = clamp(0.5 - din / aa, 0.0, 1.0);
    float outer = clamp(0.5 - (din - uFrame.z) / aa, 0.0, 1.0);
    float dp = d;
    ${depth ? FRAME_ERODE : ""}
    float pop = smoothstep(uFrameB.x - uFrame.w, uFrameB.x + uFrame.w, dp) * fxEdge(qs, 0.08);
    vec2 so = vec2(0.03, -0.045);
    float sh = 1.0 - smoothstep(-0.03, 0.1, fxBox(qs - so, uFrame.xy + uFrame.z));
    ${depth ? FRAME_SUBJECT_SHADOW : ""}
    vec4 o = mix(vec4(0.0, 0.0, 0.0, uFrameB.y * sh * fxEdge(qs, 0.25)), vec4(uFrameColor, 1.0), outer);
    // composed premultiplied (coverage cross-fades), back to straight alpha
    vec4 cp = vec4(c.rgb * c.a, c.a);
    o = mix(mix(o, cp, inner), cp, pop);
    c = vec4(o.rgb / max(o.a, 1e-4), o.a);
  }
`;

// Blur taps per quality tier.
export const blurTaps = (quality: PhotoFxOptions["quality"]): number => (quality === "low" ? 8 : quality === "medium" ? 12 : 16);

// GLSL for the active effects ("" when none). Needs PHOTO_COMMON_GLSL (and
// uDepth when opts.depth) declared before it.
export function photoFxGlsl(state: PhotoFxState, depth: boolean, quality?: PhotoFxOptions["quality"], parallax = false): string {
  if (!hasEffects(state)) return "";
  let head = FX_HEAD, body = "";
  if (state.blur) {
    head += BLUR_UNIFORMS;
    body += blurBlock(depth, blurTaps(quality), parallax && depth);
  }
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
  if (state.frame) {
    head += FRAME_UNIFORMS;
    body += frameBlock(depth);
  }
  return `${head}vec4 photoFx(vec4 c, vec2 uv, float d, vec2 s) {
  vec2 q = (uv * 2.0 - 1.0) * vec2(uFxAspect, 1.0);
${body}  return c;
}
`;
}

export const hasEffects = (state: PhotoFxState): boolean => PHOTO_EFFECT_IDS.some((id) => state[id]);

// Depth distance (beyond the sharp range) at which the blur is full.
export const BLUR_FALLOFF = 0.3;

// ─── Live state ─────────────────────────────────────────────────────────

export interface PhotoFxInput {
  pointer: { x: number; y: number; inside: boolean };
  reduced: boolean;
}

export interface PhotoFx {
  state: PhotoFxState;
  glsl: string; // "" without effects
  alpha: boolean; // changes the alpha (draw blended)
  // GLSL statement applying the effects to `c` ("" without effects); `quad`:
  // the UV on the photo's surface (default `uv`).
  call(uv: string, depth: string, quad?: string): string;
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

// Blur focus at t: with `to` + `duration`, a smooth ping-pong focus → to →
// focus (`duration` s per leg) from t = delay; else (or reduced motion) focus.
export function blurFocus(focus: number, to: number | undefined, duration: number | undefined, delay: number, t: number, reduced = false): number {
  if (typeof to !== "number" || typeof duration !== "number" || duration <= 0 || reduced) return focus;
  const k = Math.max(0, t - delay) / duration;
  return focus + (to - focus) * (0.5 - 0.5 * Math.cos(Math.PI * k));
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
    const B = state.blur;
    if (B) {
      const range = clamp(B.range as number, 0, 1);
      u.uBlur = [blurFocus(B.focus as number, B.to as number | undefined, B.duration as number | undefined, B.delay as number, t, reduced), range, Math.max(0, B.amount as number) / 100, 1 / BLUR_FALLOFF];
    }
    const Fr = state.frame;
    if (Fr) {
      const ins = Fr.inset as number[], a = opts.aspect;
      u.uFrame = [Math.max(0, 1 - 2 * clamp(ins[0], 0, 0.5)) * a, Math.max(0, 1 - 2 * clamp(ins[1], 0, 0.5)), Math.max(0, Fr.border as number) * 2 * a, Math.max(1e-3, Fr.softness as number)];
      u.uFrameB = [Fr.threshold as number, clamp(Fr.shadow as number, 0, 1), ...(opts.inset ?? [1, 1])];
      u.uFrameColor = (Fr.color as number[]).slice(0, 3);
    }
    return u;
  };
  return {
    state,
    glsl: photoFxGlsl(state, opts.depth, opts.quality, opts.parallax),
    alpha: PHOTO_EFFECT_IDS.some((id) => state[id] && (PHOTO_EFFECTS[id] as PhotoFxSpec).alpha),
    call: (uv, depth, quad = uv) => (on ? `c = photoFx(c, ${uv}, ${opts.depth ? depth : "0.5"}, ${quad});` : ""),
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
      else if (Array.isArray(cur) && typeof value === "number") s[name] = cur.map(() => value);
      else if (Array.isArray(value)) s[name] = value.slice(0, Array.isArray(cur) ? cur.length : value.length);
      else if (typeof value === "number" && Number.isFinite(value)) s[name] = value;
      else return false;
      return true;
    },
  };
}
