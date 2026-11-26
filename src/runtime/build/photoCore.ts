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
  zoom: number; // 0..~1 (dolly in: near content grows, far content shrinks)
  // Cinematic moves only (absent = 0):
  push?: number; // extra image magnification (0.1 = 10 % larger): a camera push / zoom-in
  vertigo?: number; // 0..1 dolly zoom: the `focus` plane keeps its size, the background stretches, the foreground recedes
}

// Moves played forth and back between their start (u = 0) and end (u = 1)
// poses when looping; sway / orbit are periodic paths.
const ONE_WAY_MOVES: readonly PhotoAuto[] = ["zoom", "dolly", "pan", "rise", "vertigo"];
// Moves that start mid-path when looping (neutral at t = 0, then to one end).
const CENTRED_MOVES: readonly PhotoAuto[] = ["pan", "rise"];

// Pose of a move at progress u (0..1, eased by the caller). Bounded so the
// parallax never shows the image edges at any strength.
export function movePose(auto: PhotoAuto | undefined, u: number): ViewOffset {
  const p = clamp(u, 0, 1);
  const a = 2 * Math.PI * p;
  switch (auto ?? "sway") {
    case "sway":
      return { x: 0.9 * Math.sin(a), y: 0.35 * Math.sin(2 * a), zoom: 0 };
    case "orbit":
      return { x: 0.8 * Math.sin(a), y: 0.8 * Math.cos(a), zoom: 0 };
    case "zoom":
      return { x: 0, y: 0, zoom: p };
    case "dolly": // push in toward the focus plane: a Ken Burns with depth
      return { x: 0, y: 0.12 * p, zoom: 1.1 * p, push: 0.12 * p };
    case "pan": // lateral truck, left → right
      return { x: 0.85 * (2 * p - 1), y: 0, zoom: 0.15, push: 0.03 };
    case "rise": // crane up, pushing in a little
      return { x: 0, y: 0.8 * (2 * p - 1), zoom: 0.2 + 0.25 * p, push: 0.03 + 0.03 * p };
    case "vertigo":
      return { x: 0, y: 0, zoom: 0, push: 0.03 * p, vertigo: p };
    default:
      return { x: 0, y: 0, zoom: 0 };
  }
}

// Looping drift as a pure function of time. `speed` = cycles per 10 s.
// loop (default): seamless — ping-pong for the one-way moves, a full cycle
// for sway / orbit; neutral at t = 0 (pan / rise start mid-path, the photo
// barely pushed in). loop false: one move over `duration` seconds (default
// 10 / speed), eased in and out, then held at its end pose.
export function autoDrift(auto: PhotoAuto | undefined, speed: number, t: number, opts: { loop?: boolean; duration?: number } = {}): ViewOffset {
  const move = auto ?? "sway";
  if (move === "none") return { x: 0, y: 0, zoom: 0 };
  const sp = Math.max(0, speed);
  if (opts.loop === false) {
    const d = opts.duration && opts.duration > 0 ? opts.duration : sp > 0 ? 10 / sp : 0;
    const k = d > 0 ? clamp(t / d, 0, 1) : 0;
    return movePose(move, 0.5 - 0.5 * Math.cos(Math.PI * k));
  }
  const a = ((2 * Math.PI * sp) / 10) * t;
  if (move === "orbit") {
    // circle; the radius eases in over the first half cycle (neutral at t = 0)
    const k = Math.min(1, a / Math.PI);
    const r = 0.8 * k * k * (3 - 2 * k);
    return { x: r * Math.sin(a), y: r * Math.cos(a), zoom: 0 };
  }
  if (!ONE_WAY_MOVES.includes(move)) return movePose(move, (a / (2 * Math.PI)) % 1);
  return movePose(move, CENTRED_MOVES.includes(move) ? 0.5 + 0.5 * Math.sin(a) : 0.5 - 0.5 * Math.cos(a));
}

// Seconds of one seamless loop of the auto move (videos: one full loop), or
// of the one-way move; 0 when the photo has no auto motion. Orbit eases its
// radius in over its first cycle: its seamless loop starts one period in.
export function motionPeriod(s: Pick<MotionSettings, "auto" | "speed" | "loop" | "duration">): { duration: number; start: number } {
  if (s.auto === "none") return { duration: 0, start: 0 };
  const p = s.speed > 0 ? 10 / s.speed : 0;
  if (!s.loop) return { duration: s.duration > 0 ? s.duration : p, start: 0 };
  return { duration: p, start: s.auto === "orbit" ? p : 0 };
}

export interface MotionSettings {
  pointer: number;
  scroll: number;
  gyro: boolean;
  auto: PhotoAuto;
  speed: number;
  smoothing: number;
  loop: boolean;
  duration: number; // one-way moves (loop false): seconds; 0 = 10 / speed
  progress: number | null; // fixed move progress 0..1 (a timeline track "<id>.motion.progress" drives it live)
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
    loop: m?.loop !== false,
    duration: Math.max(0, num(m?.duration, 0)),
    progress: typeof m?.progress === "number" && Number.isFinite(m.progress) ? clamp(m.progress, 0, 1) : null,
  };
}

export interface MotionFrame {
  t: number;
  // Smoothed pointer (normalised -1..1, y up) and how much it drives the view (0..1).
  pointer: { x: number; y: number; weight: number };
  gyro: { x: number; y: number } | null; // -1..1, live only
  scroll: number; // 0..1
  reduced: boolean;
  // Move progress 0..1 driven by a timeline track (null / absent: settings, then time).
  progress?: number | null;
}

// The view offset for a frame (pure).
export function viewOffset(s: MotionSettings, f: MotionFrame): ViewOffset {
  const progress = f.progress ?? s.progress;
  const driven = progress !== null;
  const drift: ViewOffset = f.reduced ? { x: 0, y: 0, zoom: 0 } : driven ? movePose(s.auto, progress) : autoDrift(s.auto, s.speed, f.t, s);
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
  // A driven move (scroll story) keeps its push / dolly while the pointer looks around.
  const keep = driven ? 1 : 1 - w;
  const out: ViewOffset = { x: clamp(x, -1, 1), y: clamp(y, -1, 1), zoom: drift.zoom * keep };
  if (drift.push) out.push = drift.push * keep;
  if (drift.vertigo) out.vertigo = drift.vertigo * keep;
  return out;
}

// Parallax / layers shader inputs of a view offset: the push and the dolly
// zoom compensation go through the UV inset (no shader change). The vertigo
// is a negative radial zoom (background grows, foreground shrinks) whose
// built-in 6 % push-out is cancelled, so the `focus` plane keeps its size.
export const VERTIGO_ZOOM = 1.5;
export function parallaxView(off: ViewOffset, inset: readonly [number, number]): { zoom: number; inset: [number, number] } {
  const zoom = off.zoom - VERTIGO_ZOOM * (off.vertigo ?? 0);
  const k = (1 - 0.06 * off.zoom) / ((1 + (off.push ?? 0)) * (1 - 0.06 * zoom));
  return { zoom, inset: [inset[0] * k, inset[1] * k] };
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
  offset(t: number, dt: number, input: { pointer: PhotoPointer; scroll: number; reduced: boolean; progress?: number | null }): ViewOffset;
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
      return viewOffset(motion, { t, pointer: smoothed, gyro: live ? gyro : null, scroll: input.scroll, reduced: input.reduced, progress: input.progress });
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
export const PARALLAX_GLSL = /* glsl */ `
uniform sampler2D uDepth;
uniform vec2 uView;
uniform float uZoom;
uniform vec2 uMaxOffset;
uniform vec2 uInset;
uniform float uFocus;
uniform float uWallSlope;
const int STEPS = __STEPS__;
vec4 parallaxTexel(vec2 vUv) {
  // the zoom drift also pushes in slightly (stays inside the inset margin)
  vec2 base = 0.5 + (vUv - 0.5) * uInset * (1.0 - 0.06 * uZoom);
  vec2 v = uView - (vUv - 0.5) * 2.0 * uZoom;
  vec2 dir = v * uMaxOffset;
  vec2 uv = base;
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
    if (hit && (g > uWallSlope || dh.a < 0.5) && dNear > lo + 0.04) {
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
  return textureGrad(uMap, uv, dFdx(base), dFdy(base));
}
`;

// Depth edge threshold of the parallax "wall" fix (depth change per texel).
export const PARALLAX_WALL_SLOPE = 0.02;
