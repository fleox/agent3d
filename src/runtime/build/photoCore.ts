// Three.js-free core of the "3D photo" objects (kind "photo"): sizing, the
// motion model (view offset from pointer / gyro / scroll / auto drift, live
// smoothing, reduced motion), the parallax parameters and the relief-mapping
// GLSL. Used by ./photo.ts (the full runtime builder) and by the photo-only
// lite runtime (src/runtime/lite/), so both render the same pixels from the
// same rules. No `three` import here: the lite bundle must not pull it in.

import type { PhotoObjectDef } from "../../core/types";
import { clamp, num } from "../num";

export const PHOTO_DEFAULTS = { width: 4, strength: 0.5, focus: 0.5, segments: 256, layers: 6, edgeCut: 0.08, speed: 1, smoothing: 0.9 } as const;

// World size of the photo: width (default 4) and the image aspect; an explicit
// height wins over the aspect (alone: width follows the aspect).
export function photoSize(def: Pick<PhotoObjectDef, "width" | "height">, imgW: number, imgH: number): { width: number; height: number } {
  const aspect = imgW > 0 && imgH > 0 ? imgW / imgH : 1;
  const w = typeof def.width === "number" && def.width > 0 ? def.width : undefined;
  const h = typeof def.height === "number" && def.height > 0 ? def.height : undefined;
  if (w !== undefined && h !== undefined) return { width: w, height: h };
  if (h !== undefined) return { width: h * aspect, height: h };
  const width = w ?? PHOTO_DEFAULTS.width;
  return { width, height: width / aspect };
}

export type PhotoAuto = NonNullable<NonNullable<PhotoObjectDef["motion"]>["auto"]>;

export interface ViewOffset {
  x: number; // -1..1 (right = view moves right: near things slide left)
  y: number; // -1..1 (up)
  zoom: number; // 0..1 (dolly in)
}

// Looping drift as a pure function of time. `speed` = cycles per 10 s.
// Every drift is neutral at t = 0 (poster frames show the photo as is).
export function autoDrift(auto: PhotoAuto | undefined, speed: number, t: number): ViewOffset {
  const w = (2 * Math.PI * Math.max(0, speed)) / 10;
  const a = w * t;
  switch (auto ?? "sway") {
    case "sway": // horizontal figure-eight (lissajous 1:2)
      return { x: 0.9 * Math.sin(a), y: 0.35 * Math.sin(2 * a), zoom: 0 };
    case "orbit": {
      // circle; the radius eases in over the first half cycle (neutral at t = 0)
      const k = Math.min(1, a / Math.PI);
      const r = 0.8 * k * k * (3 - 2 * k);
      return { x: r * Math.sin(a), y: r * Math.cos(a), zoom: 0 };
    }
    case "zoom":
      return { x: 0, y: 0, zoom: 0.5 - 0.5 * Math.cos(a) };
    default:
      return { x: 0, y: 0, zoom: 0 };
  }
}

export interface MotionSettings {
  pointer: number;
  scroll: number;
  gyro: boolean;
  auto: PhotoAuto;
  speed: number;
  smoothing: number;
}

export function motionSettings(m: PhotoObjectDef["motion"]): MotionSettings {
  const pointer = clamp(num(m?.pointer, 1), 0, 1);
  return {
    pointer,
    scroll: clamp(num(m?.scroll, 0), 0, 1),
    gyro: typeof m?.gyro === "boolean" ? m.gyro : pointer > 0,
    auto: m?.auto ?? "sway",
    speed: Math.max(0, num(m?.speed, PHOTO_DEFAULTS.speed)),
    smoothing: clamp(num(m?.smoothing, PHOTO_DEFAULTS.smoothing), 0, 0.99),
  };
}

export interface MotionFrame {
  t: number;
  // Smoothed pointer (normalised -1..1, y up) and how much it drives the view (0..1).
  pointer: { x: number; y: number; weight: number };
  gyro: { x: number; y: number } | null; // -1..1, live only
  scroll: number; // 0..1
  reduced: boolean;
}

// The view offset for a frame (pure).
export function viewOffset(s: MotionSettings, f: MotionFrame): ViewOffset {
  const drift = f.reduced ? { x: 0, y: 0, zoom: 0 } : autoDrift(s.auto, s.speed, f.t);
  const amount = s.pointer * (f.reduced ? 0.5 : 1);
  let ix = 0, iy = 0, w = 0;
  if (f.gyro && s.gyro && f.pointer.weight < 0.5) {
    ix = f.gyro.x;
    iy = f.gyro.y;
    w = amount > 0 ? 1 : 0;
  } else if (amount > 0) {
    ix = f.pointer.x;
    iy = f.pointer.y;
    w = clamp(f.pointer.weight, 0, 1);
  }
  const x = drift.x * (1 - w) + ix * amount * w;
  let y = drift.y * (1 - w) + iy * amount * w;
  if (s.scroll > 0) y += (clamp(f.scroll, 0, 1) * 2 - 1) * s.scroll;
  return { x: clamp(x, -1, 1), y: clamp(y, -1, 1), zoom: drift.zoom * (1 - w) };
}

// Frame-rate independent exponential smoothing (same convention as the
// timeline scroll smoothing: `smoothing` = share kept per 1/60 s).
export function smoothToward(current: number, target: number, dt: number, smoothing: number): number {
  if (smoothing <= 0 || dt <= 0) return dt <= 0 && smoothing > 0 ? current : target;
  const k = 1 - Math.pow(clamp(smoothing, 0, 0.99), dt * 60);
  const v = current + (target - current) * k;
  return Math.abs(target - v) < 1e-4 ? target : v;
}

// Parallax: max UV shift per axis for one unit of (depth - focus) at full
// view offset (≈ strength * 6 % of the short side), and the UV scale that
// keeps the shifted image inside the picture (edges never show).
export function parallaxParams(strength: number, width: number, height: number): { maxOffset: [number, number]; inset: [number, number] } {
  const s = clamp(strength, 0, 1);
  const short = Math.min(width, height);
  const ax = short / width, ay = short / height;
  return {
    maxOffset: [s * 0.06 * ax, s * 0.06 * ay],
    inset: [1 / (1 + s * 0.1 * ax), 1 / (1 + s * 0.1 * ay)],
  };
}

// Gyro: device tilt (degrees) relative to the first reading → -1..1 (±20°).
export function tiltToOffset(beta: number, gamma: number, base: { beta: number; gamma: number }, angle: number): { x: number; y: number } {
  let dx = gamma - base.gamma, dy = beta - base.beta;
  const a = ((Math.round(angle / 90) % 4) + 4) % 4;
  if (a === 1) [dx, dy] = [dy, -dx];
  else if (a === 2) [dx, dy] = [-dx, -dy];
  else if (a === 3) [dx, dy] = [-dy, dx];
  return { x: clamp(dx / 20, -1, 1), y: clamp(-dy / 20, -1, 1) };
}

// Relief-mapping march steps: the per-pixel cost of parallax mode. Weak
// devices (lower quality tiers) and gentle depth (low strength: smaller
// offsets, fewer layers to cross) get fewer steps; the binary refine after the
// march keeps edges clean either way.
export function parallaxSteps(quality: "low" | "medium" | "high" | "ultra" | undefined, strength: number): number {
  const base = quality === "low" ? 12 : quality === "medium" ? 20 : quality === "ultra" ? 48 : 32;
  return Math.max(8, Math.round(base * (0.5 + 0.5 * Math.min(1, Math.max(0, strength) / 0.6))));
}

// ─── Motion state (live smoothing + gyro) ──────────────────────────────

export interface PhotoPointer {
  x: number;
  y: number;
  inside: boolean;
}

export interface PhotoMotion {
  // View offset of the frame at time t (dt since the previous frame).
  offset(t: number, dt: number, input: { pointer: PhotoPointer; scroll: number; reduced: boolean }): ViewOffset;
  dispose(): void;
}

// Live players smooth the pointer (first frame instant) and listen to the
// device tilt; deterministic ones use the pointer as is (seek-safe, no
// frame-history state) and never read the gyro.
export function createPhotoMotion(motion: MotionSettings, opts: { live: boolean; flat: boolean }): PhotoMotion {
  const { live } = opts;
  const smoothed = { x: 0, y: 0, weight: 0, init: false };
  let gyro: { x: number; y: number } | null = null;
  let gyroBase: { beta: number; gamma: number } | null = null;
  let removeGyro: (() => void) | null = null;
  if (live && motion.gyro && motion.pointer > 0 && !opts.flat && typeof window !== "undefined" && typeof window.addEventListener === "function") {
    const onTilt = (e: DeviceOrientationEvent) => {
      if (e.beta === null || e.gamma === null) return;
      gyroBase ??= { beta: e.beta, gamma: e.gamma };
      const angle = (typeof screen !== "undefined" && screen.orientation?.angle) || 0;
      gyro = tiltToOffset(e.beta, e.gamma, gyroBase, angle);
    };
    window.addEventListener("deviceorientation", onTilt);
    removeGyro = () => window.removeEventListener("deviceorientation", onTilt);
  }
  return {
    offset(t, dt, input) {
      const p = input.pointer;
      const tx = p.inside ? clamp(p.x, -1, 1) : 0;
      const ty = p.inside ? clamp(p.y, -1, 1) : 0;
      const tw = p.inside ? 1 : 0;
      if (!live || !smoothed.init) {
        // Deterministic renders: no frame-history state (seek-safe).
        smoothed.x = tx;
        smoothed.y = ty;
        smoothed.weight = tw;
        smoothed.init = live;
      } else {
        smoothed.x = smoothToward(smoothed.x, tx, dt, motion.smoothing);
        smoothed.y = smoothToward(smoothed.y, ty, dt, motion.smoothing);
        smoothed.weight = smoothToward(smoothed.weight, tw, dt, motion.smoothing);
      }
      return viewOffset(motion, { t, pointer: smoothed, gyro: live ? gyro : null, scroll: input.scroll, reduced: input.reduced });
    },
    dispose() {
      removeGyro?.();
      removeGyro = null;
    },
  };
}

// ─── GLSL (GLSL ES 3.00 functions; no three.js chunks) ─────────────────

// Uniforms + tint / opacity shading shared by every photo shader.
export const PHOTO_COMMON_GLSL = /* glsl */ `
uniform sampler2D uMap;
uniform vec3 uTint;
uniform float uOpacity;
uniform float uIntensity;
vec4 shade(vec4 c, float a) {
  return vec4(c.rgb * uTint * uIntensity, c.a * a * uOpacity);
}
`;

// Parallax: find, along the view ray through the depth "height field", the
// first texel (from near to far) whose depth reaches the ray. `__STEPS__` is
// replaced by parallaxSteps(). parallaxTexel(vUv) returns the photo texel (not
// shaded); callers discard when c.a * uOpacity < 0.004, then shade(c, 1.0).
// The sampled UV is left in `pxUv` (depth-driven effects, ./photoFx.ts).
// Background plate (uPlateOn = 1; uPlate / uPlateDepth = the photo's `plate`
// + `plateDepth`): a ray that hits the wall of a depth edge continues behind
// it against the plate depth and shows the plate there (what the foreground
// uncovers) instead of probing for a nearby background texel.
export const PARALLAX_GLSL = /* glsl */ `
uniform sampler2D uDepth;
uniform sampler2D uPlate;
uniform sampler2D uPlateDepth;
uniform float uPlateOn;
uniform vec2 uView;
uniform float uZoom;
uniform vec2 uMaxOffset;
uniform vec2 uInset;
uniform float uFocus;
uniform float uWallSlope;
const int STEPS = __STEPS__;
vec2 pxUv;
// Depth-map value of the texel parallaxTexel() returned (read by occluding
// photos to write their true depth, ./photo.ts PHOTO_OCCLUDE).
float photoHitDepth = 0.0;
vec4 parallaxTexel(vec2 vUv) {
  // the zoom drift also pushes in slightly (stays inside the inset margin)
  vec2 base = 0.5 + (vUv - 0.5) * uInset * (1.0 - 0.06 * uZoom);
  vec2 v = uView - (vUv - 0.5) * 2.0 * uZoom;
  vec2 dir = v * uMaxOffset;
  vec2 uv = base;
  bool onPlate = false;
  if (dot(dir, dir) > 1e-10) {
    float stepH = 1.0 / float(STEPS);
    float h = 1.0;
    float prevH = 1.0 + stepH;
    bool hit = false;
    for (int i = 0; i <= STEPS; i++) {
      h = 1.0 - float(i) * stepH;
      float d = textureLod(uDepth, base + (h - uFocus) * dir, 0.0).r;
      if (d >= h) { hit = true; break; }
      prevH = h;
    }
    float lo = h, hi = min(prevH, 1.0);
    if (hit) {
      for (int j = 0; j < 6; j++) {
        float mid = 0.5 * (lo + hi);
        float d = textureLod(uDepth, base + (mid - uFocus) * dir, 0.0).r;
        if (d >= mid) lo = mid; else hi = mid;
      }
    }
    uv = base + (lo - uFocus) * dir;
    // Disocclusion: the ray hit the steep "wall" of a depth edge. Stretching
    // the foreground edge colour reads as a smear: take the colour from just
    // past the edge on the far side instead (the background continues).
    vec2 texel = 1.0 / vec2(textureSize(uDepth, 0));
    vec4 dh = textureLod(uDepth, uv, 0.0);
    vec2 grad = vec2(
      textureLod(uDepth, uv + vec2(texel.x * 1.5, 0.0), 0.0).r - textureLod(uDepth, uv - vec2(texel.x * 1.5, 0.0), 0.0).r,
      textureLod(uDepth, uv + vec2(0.0, texel.y * 1.5), 0.0).r - textureLod(uDepth, uv - vec2(0.0, texel.y * 1.5), 0.0).r) / 3.0;
    float g = length(grad);
    vec2 toNear = grad / max(g, 1e-6);
    float dNear = textureLod(uDepth, uv + toNear * texel * 3.0, 0.0).r;
    if (hit && (g > uWallSlope || dh.a < 0.5) && dNear > lo + 0.04 && uPlateOn > 0.5) {
      // continue the march below the wall against the plate (background) depth
      float ph = lo, pprev = lo;
      bool phit = false;
      for (int i = 0; i <= STEPS; i++) {
        ph = lo - float(i) * stepH;
        if (textureLod(uPlateDepth, base + (ph - uFocus) * dir, 0.0).r >= ph) { phit = true; break; }
        pprev = ph;
      }
      float plo = max(ph, 0.0), phi = pprev;
      if (phit) {
        for (int j = 0; j < 5; j++) {
          float mid = 0.5 * (plo + phi);
          if (textureLod(uPlateDepth, base + (mid - uFocus) * dir, 0.0).r >= mid) plo = mid; else phi = mid;
        }
      }
      uv = base + (plo - uFocus) * dir;
      onPlate = true;
    } else if (hit && (g > uWallSlope || dh.a < 0.5) && dNear > lo + 0.04) {
      vec2 away = -toNear;
      vec2 probe = uv;
      for (int k = 1; k <= 6; k++) {
        vec2 q = uv + away * texel * float(k * 2);
        probe = q;
        if (textureLod(uDepth, q, 0.0).r < lo - 0.05) break;
      }
      uv = probe + away * texel * 2.0;
    }
  }
  pxUv = uv;
  photoHitDepth = onPlate ? textureLod(uPlateDepth, uv, 0.0).r : textureLod(uDepth, uv, 0.0).r;
  vec2 gx = dFdx(base), gy = dFdy(base);
  return onPlate ? textureGrad(uPlate, uv, gx, gy) : textureGrad(uMap, uv, gx, gy);
}
`;

// Depth edge threshold of the parallax "wall" fix (depth change per texel).
export const PARALLAX_WALL_SLOPE = 0.02;
