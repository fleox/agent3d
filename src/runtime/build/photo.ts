// "3D photo" objects (kind "photo"): a picture + its depth map turned into a
// small moving 3D scene, unlit so the colours match the source.
//
// Depth maps: grayscale RGB, white = near, black = far; alpha 0 marks depth
// discontinuities (cut edges), 255 elsewhere (no alpha = all 255).
//
// Modes:
//   parallax (default) — one quad; the fragment shader ray-marches the depth
//     map (steep parallax + binary refine) for a per-frame view offset. The
//     `focus` depth stays still; UVs are inset so the image edges never show.
//   mesh — a grid (`segments` cells on the long side) displaced in the vertex
//     shader (range = strength * width * 0.25, centred on `focus`), along the
//     line to the camera's rest position so the rest view is the source photo.
//     The geometry is non-indexed and every vertex knows its triangle's two
//     other UVs, so the three vertices take the same cut decision (depth jump
//     inside the triangle > edgeCut, or an alpha-0 texel); the stretched
//     fragments of cut triangles are dropped as soon as they would move on
//     screen, and a coarser backing mesh at the local farthest depth fills
//     the gap with background. The view offset tilts the grid (± strength * 8°).
//   layers — `layers` stacked planes, each showing the photo where depth is at
//     or above its band (soft edges), continuing its own surface under nearer
//     content; the farthest one is the opaque background. Layers sit at small
//     z offsets (scale-compensated for the camera so they line up at rest) and
//     slide with the view offset.
//
// Motion (pure function of t for the auto drift; seek-safe): the view offset
// (-1..1) mixes the pointer (smoothed live, instant in deterministic mode),
// device tilt (live only, when the page receives deviceorientation events),
// scroll and the `auto` drift ("sway" / "orbit" / "zoom"), which fades out
// while the pointer / gyro drives the view. Reduced motion: no auto drift,
// half pointer amount.

import * as THREE from "three";
import type { PhotoObjectDef } from "../../core/types";
import { loadTexture } from "../assets";
import { DEG, clamp, num } from "../util";
import type { RuntimeContext } from "./context";

// ─── Pure helpers (unit-tested) ─────────────────────────────────────────

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

// Mesh: grid cells per axis (`segments` on the long side).
export function meshSegments(segments: number, width: number, height: number): [number, number] {
  const n = Math.round(clamp(num(segments, PHOTO_DEFAULTS.segments), 2, 1024));
  if (width >= height) return [n, Math.max(1, Math.round((n * height) / width))];
  return [Math.max(1, Math.round((n * width) / height)), n];
}

// Mesh: depth displacement range (world units).
export function meshRange(strength: number, width: number): number {
  return clamp(strength, 0, 1) * width * 0.25;
}

// Mesh: does a triangle collapse? (mirror of the vertex shader test.)
// depths / alphas of its three vertices (0..1).
export function triangleCut(depths: [number, number, number], alphas: [number, number, number], edgeCut: number): boolean {
  if (Math.min(alphas[0], alphas[1], alphas[2]) < 0.5) return true;
  if (edgeCut <= 0) return false;
  const jump = Math.max(Math.abs(depths[0] - depths[1]), Math.abs(depths[1] - depths[2]), Math.abs(depths[0] - depths[2]));
  return jump > edgeCut;
}

export interface LayerBand {
  lo: number; // depth where the layer starts (0 for the background)
  hi: number;
  center: number; // depth the layer moves with
  feather: number; // soft edge half-width (depth units)
  z: number; // local z offset (world units)
  background: boolean;
}

// Layers: `n` equal depth slices, far (index 0, opaque background) to near.
export function layerBands(n: number, focus: number, strength: number, width: number): LayerBand[] {
  const count = Math.round(clamp(num(n, PHOTO_DEFAULTS.layers), 2, 16));
  const out: LayerBand[] = [];
  const zRange = clamp(strength, 0, 1) * width * 0.1;
  for (let i = 0; i < count; i++) {
    const lo = i / count, hi = (i + 1) / count;
    const center = (lo + hi) / 2;
    out.push({ lo, hi, center, feather: 0.35 / count, z: (center - focus) * zRange + i * 1e-3 * width, background: i === 0 });
  }
  return out;
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

// ─── Shaders ────────────────────────────────────────────────────────────

const COMMON_FRAG = /* glsl */ `
uniform sampler2D uMap;
uniform vec3 uTint;
uniform float uOpacity;
uniform float uIntensity;
vec4 shade(vec4 c, float a) {
  return vec4(c.rgb * uTint * uIntensity, c.a * a * uOpacity);
}
`;

const QUAD_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

// Parallax: find, along the view ray through the depth "height field", the
// first texel (from near to far) whose depth reaches the ray.
const PARALLAX_FRAG = /* glsl */ `
${COMMON_FRAG}
uniform sampler2D uDepth;
uniform vec2 uView;
uniform float uZoom;
uniform vec2 uMaxOffset;
uniform vec2 uInset;
uniform float uFocus;
uniform float uWallSlope;
varying vec2 vUv;
const int STEPS = __STEPS__;
void main() {
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
  vec4 c = textureGrad(uMap, uv, dFdx(base), dFdy(base));
  if (c.a * uOpacity < 0.004) discard;
  gl_FragColor = shade(c, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

// Mesh: displaced grid. Vertices move along the line to the camera's rest
// position (uCam, object space, captured on the first frame) so the view at
// rest is exactly the source photo, and real camera moves / the tilt reveal
// the relief. A triangle straddling a depth jump (> edgeCut, or touching an
// alpha-0 texel) is flagged the same way by its three vertices (each knows
// the triangle's other UVs). Its fragments whose texel depth disagrees with
// the stretched surface are dropped once that disagreement moves them on
// screen (vMotion = screen shift per unit of depth, from the real matrices):
// at rest nothing is dropped; in motion the rubber sheet disappears and the
// backing below shows background instead.
const MESH_VERT = /* glsl */ `
uniform sampler2D uDepth;
uniform float uRange;
uniform float uFocus;
uniform float uEdgeCut;
uniform vec3 uCam;
uniform float uPerspective;
attribute vec4 uvOther;
varying vec2 vUv;
varying float vDepth;
varying float vCut;
varying float vMotion;
vec3 displaced(vec3 p, float z) {
  if (uPerspective > 0.5 && uCam.z > z + 1e-3) p.xy = mix(p.xy, uCam.xy, z / uCam.z);
  p.z = z;
  return p;
}
void main() {
  vUv = uv;
  vec4 d0 = textureLod(uDepth, uv, 0.0);
  vec4 d1 = textureLod(uDepth, uvOther.xy, 0.0);
  vec4 d2 = textureLod(uDepth, uvOther.zw, 0.0);
  float jump = max(max(abs(d0.r - d1.r), abs(d1.r - d2.r)), abs(d0.r - d2.r));
  bool cut = min(d0.a, min(d1.a, d2.a)) < 0.5 || (uEdgeCut > 0.0 && jump > uEdgeCut);
  vCut = cut ? 1.0 : 0.0;
  vDepth = d0.r;
  vec4 c = projectionMatrix * modelViewMatrix * vec4(displaced(position, (d0.r - uFocus) * uRange), 1.0);
  vMotion = 0.0;
  if (cut) {
    vec4 a = projectionMatrix * modelViewMatrix * vec4(displaced(position, -uFocus * uRange), 1.0);
    vec4 b = projectionMatrix * modelViewMatrix * vec4(displaced(position, (1.0 - uFocus) * uRange), 1.0);
    vMotion = length(b.xy / b.w - a.xy / a.w);
  }
  gl_Position = c;
}
`;

const MESH_FRAG = /* glsl */ `
${COMMON_FRAG}
uniform sampler2D uDepth;
varying vec2 vUv;
varying float vDepth;
varying float vCut;
varying float vMotion;
void main() {
  if (vCut > 0.5) {
    float d = textureLod(uDepth, vUv, 0.0).r;
    if (abs(d - vDepth) * vMotion > 0.004) discard;
  }
  vec4 c = texture2D(uMap, vUv);
  if (c.a * uOpacity < 0.004) discard;
  gl_FragColor = shade(c, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

// Mesh backing: a coarser copy behind the mesh, at the local farthest depth
// (min over a few cells), so the gaps a foreground edge opens when the view
// moves show background, not the page. Texels of the foreground that land on
// it are replaced by the nearest background texel (same "wall" fix as the
// parallax shader).
const BACKING_VERT = /* glsl */ `
uniform sampler2D uDepth;
uniform float uRange;
uniform float uFocus;
uniform vec3 uCam;
uniform float uPerspective;
uniform vec2 uReach;
varying vec2 vUv;
varying float vDepth;
void main() {
  vUv = uv;
  float d = textureLod(uDepth, uv, 0.0).r;
  for (int i = 1; i <= 2; i++) {
    vec2 r = uReach * float(i) * 0.5;
    d = min(d, textureLod(uDepth, uv + vec2(r.x, 0.0), 0.0).r);
    d = min(d, textureLod(uDepth, uv - vec2(r.x, 0.0), 0.0).r);
    d = min(d, textureLod(uDepth, uv + vec2(0.0, r.y), 0.0).r);
    d = min(d, textureLod(uDepth, uv - vec2(0.0, r.y), 0.0).r);
    d = min(d, textureLod(uDepth, uv + r, 0.0).r);
    d = min(d, textureLod(uDepth, uv - r, 0.0).r);
    d = min(d, textureLod(uDepth, uv + vec2(r.x, -r.y), 0.0).r);
    d = min(d, textureLod(uDepth, uv + vec2(-r.x, r.y), 0.0).r);
  }
  vDepth = d;
  float z = (d - uFocus) * uRange - uRange * 0.02;
  vec3 p = position;
  if (uPerspective > 0.5 && uCam.z > z + 1e-3) p.xy = mix(p.xy, uCam.xy, z / uCam.z);
  p.z = z;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
}
`;

const BACKING_FRAG = /* glsl */ `
${COMMON_FRAG}
uniform sampler2D uDepth;
varying vec2 vUv;
varying float vDepth;
void main() {
  vec2 uv = vUv;
  float d = textureLod(uDepth, uv, 0.0).r;
  if (d > vDepth + 0.04) {
    vec2 texel = 1.0 / vec2(textureSize(uDepth, 0));
    vec2 grad = vec2(
      textureLod(uDepth, uv + vec2(texel.x * 2.0, 0.0), 0.0).r - textureLod(uDepth, uv - vec2(texel.x * 2.0, 0.0), 0.0).r,
      textureLod(uDepth, uv + vec2(0.0, texel.y * 2.0), 0.0).r - textureLod(uDepth, uv - vec2(0.0, texel.y * 2.0), 0.0).r);
    vec2 away = length(grad) > 1e-5 ? -normalize(grad) : vec2(0.0);
    // walk towards the background until the depth reaches this surface's
    for (int k = 1; k <= 24; k++) {
      uv = vUv + away * texel * float(k * 3);
      if (textureLod(uDepth, uv, 0.0).r <= vDepth + 0.04) break;
    }
    uv += away * texel * 2.0;
  }
  vec4 c = texture2D(uMap, uv);
  if (c.a * uOpacity < 0.004) discard;
  gl_FragColor = shade(c, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

// Layers: the photo where depth >= the layer's lower edge (soft), shifted
// with the layer's depth. Where nearer content covers the layer (depth above
// its band), the layer continues its own surface: the colour comes from the
// first texel of the band found by walking along the view shift — exactly
// the strip a nearer layer uncovers when it slides — so no ghost copies.
const LAYER_FRAG = /* glsl */ `
${COMMON_FRAG}
uniform sampler2D uDepth;
uniform vec2 uView;
uniform float uZoom;
uniform vec2 uMaxOffset;
uniform vec2 uInset;
uniform float uFocus;
uniform float uCenter;
uniform float uLo;
uniform float uHi;
uniform float uFeather;
uniform float uBackground;
varying vec2 vUv;
void main() {
  // the zoom drift also pushes in slightly (stays inside the inset margin)
  vec2 base = 0.5 + (vUv - 0.5) * uInset * (1.0 - 0.06 * uZoom);
  vec2 v = uView - (vUv - 0.5) * 2.0 * uZoom;
  // Each layer moves with the depth it shows, clamped to its band: a smooth
  // surface crossing two bands stays continuous (no tear at the band edge);
  // only real depth jumps separate the layers. Fixed-point solve, from the
  // band centre.
  vec2 dir = v * uMaxOffset;
  vec2 uv = base + (uCenter - uFocus) * dir;
  for (int i = 0; i < 3; i++) {
    float di = clamp(textureLod(uDepth, uv, 0.0).r, uLo, uHi);
    uv = base + (di - uFocus) * dir;
  }
  vec4 dd = textureLod(uDepth, uv, 0.0);
  float d = dd.r;
  // soft slice edges, but hard on marked depth edges (alpha 0): a blend of
  // two layers there would draw a thin double outline
  float a = uBackground > 0.5 ? 1.0 : dd.a < 0.5 ? step(uLo, d) : smoothstep(uLo - uFeather, uLo + uFeather, d);
  if (a < 0.004) discard;
  vec2 cuv = uv;
  // covered by nearer content
  if (d > uHi + uFeather) {
    bool found = false;
    vec2 reach = v * uMaxOffset * 1.25;
    for (int k = 1; k <= 16; k++) {
      vec2 q = uv + reach * (float(k) / 16.0);
      vec4 dq = textureLod(uDepth, q, 0.0);
      if (dq.r <= uHi && dq.a >= 0.5 && (uBackground > 0.5 || dq.r >= uLo - uFeather)) {
        // step past the edge's blended texels
        vec2 texel = 1.0 / vec2(textureSize(uMap, 0));
        cuv = q + normalize(reach) * texel * 3.0;
        found = true;
        break;
      }
    }
    // Nothing of this band to extend: let the layers below show (the
    // background keeps the source texel).
    if (!found && uBackground < 0.5) discard;
  }
  vec4 c = textureGrad(uMap, cuv, dFdx(base), dFdy(base));
  gl_FragColor = shade(c, a);
  if (gl_FragColor.a < 0.004) discard;
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

// ─── Builder ────────────────────────────────────────────────────────────

export interface PhotoFrameInput {
  pointer: { x: number; y: number; inside: boolean };
  scroll: number;
  camera: THREE.Camera | null;
  reduced: boolean;
}

export interface BuiltPhoto {
  object: THREE.Object3D;
  update(t: number, dt: number, input: PhotoFrameInput): void;
  dispose(): void;
}

interface Size {
  w: number;
  h: number;
}

function imageSize(tex: THREE.Texture): Size {
  const img = tex.image as { naturalWidth?: number; naturalHeight?: number; width?: number; height?: number } | undefined;
  return { w: img?.naturalWidth || img?.width || 1, h: img?.naturalHeight || img?.height || 1 };
}

function baseUniforms(map: THREE.Texture, def: PhotoObjectDef, ctx: RuntimeContext) {
  const m = def.material ?? {};
  return {
    uMap: { value: map },
    uTint: { value: m.color ? ctx.color(m.color) : new THREE.Color(1, 1, 1) },
    uOpacity: { value: clamp(num(m.opacity, 1), 0, 1) },
    uIntensity: { value: Math.max(0, num(m.emissiveIntensity, 1)) },
  };
}

function shaderMaterial(vertex: string, fragment: string, uniforms: Record<string, THREE.IUniform>, transparent: boolean): THREE.ShaderMaterial {
  const mat = new THREE.ShaderMaterial({ vertexShader: vertex, fragmentShader: fragment, uniforms, transparent, toneMapped: false, fog: false, side: THREE.FrontSide });
  mat.depthWrite = !transparent;
  return mat;
}

// Non-indexed grid whose vertices carry their triangle's two other UVs.
export function buildMeshGeometry(width: number, height: number, sx: number, sy: number): THREE.BufferGeometry {
  const tris = sx * sy * 2;
  const pos = new Float32Array(tris * 9);
  const uv = new Float32Array(tris * 6);
  const other = new Float32Array(tris * 12);
  let v = 0;
  const put = (a: [number, number], b: [number, number], c: [number, number]) => {
    const tri = [a, b, c];
    for (let k = 0; k < 3; k++) {
      const [u, w] = tri[k];
      const o1 = tri[(k + 1) % 3], o2 = tri[(k + 2) % 3];
      pos.set([(u - 0.5) * width, (w - 0.5) * height, 0], v * 3);
      uv.set([u, w], v * 2);
      other.set([o1[0], o1[1], o2[0], o2[1]], v * 4);
      v++;
    }
  };
  for (let j = 0; j < sy; j++) {
    for (let i = 0; i < sx; i++) {
      const u0 = i / sx, u1 = (i + 1) / sx, w0 = j / sy, w1 = (j + 1) / sy;
      put([u0, w0], [u1, w0], [u1, w1]);
      put([u0, w0], [u1, w1], [u0, w1]);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  g.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
  g.setAttribute("uvOther", new THREE.BufferAttribute(other, 4));
  return g;
}

// Relief-mapping march steps: the per-pixel cost of parallax mode. Weak
// devices (lower quality tiers) and gentle depth (low strength: smaller
// offsets, fewer layers to cross) get fewer steps; the binary refine after the
// march keeps edges clean either way.
export function parallaxSteps(quality: "low" | "medium" | "high" | "ultra" | undefined, strength: number): number {
  const base = quality === "low" ? 12 : quality === "medium" ? 20 : quality === "ultra" ? 48 : 32;
  return Math.max(8, Math.round(base * (0.5 + 0.5 * Math.min(1, Math.max(0, strength) / 0.6))));
}

export async function buildPhoto(def: PhotoObjectDef, ctx: RuntimeContext): Promise<BuiltPhoto> {
  const [map, depth] = await Promise.all([
    loadTexture(ctx.resolveAsset(def.src)),
    def.depth ? loadTexture(ctx.resolveAsset(def.depth)).catch((err: Error) => {
      ctx.issue("asset-load", `${def.id}: depth map: ${err.message} — showing the photo flat`, `objects#${def.id}.depth`);
      return null;
    }) : Promise.resolve(null),
  ]);
  map.colorSpace = THREE.SRGBColorSpace;
  map.wrapS = map.wrapT = THREE.MirroredRepeatWrapping;
  map.anisotropy = 4;
  map.needsUpdate = true;
  if (depth) {
    // Grey (+ alpha mask) data: no colour conversion, no premultiplication
    // (grey must survive where alpha is 0).
    depth.colorSpace = THREE.NoColorSpace;
    depth.premultiplyAlpha = false;
    depth.wrapS = depth.wrapT = THREE.MirroredRepeatWrapping;
    depth.generateMipmaps = false;
    depth.minFilter = THREE.LinearFilter;
    depth.magFilter = THREE.LinearFilter;
    depth.needsUpdate = true;
  }
  const img = imageSize(map);
  const { width, height } = photoSize(def, img.w, img.h);
  const strength = clamp(num(def.strength, PHOTO_DEFAULTS.strength), 0, 1);
  const focus = clamp(num(def.focus, PHOTO_DEFAULTS.focus), 0, 1);
  const opacity = clamp(num(def.material?.opacity, 1), 0, 1);
  const transparent = opacity < 1 || /\.(png|webp)$/i.test(def.src);
  const motion = motionSettings(def.motion);
  const mode = depth ? def.mode ?? "parallax" : "flat";

  const root = new THREE.Group();
  const holder = new THREE.Group(); // mesh mode tilts this (the root keeps the scene transform)
  root.add(holder);
  const materials: THREE.Material[] = [];
  const geometries: THREE.BufferGeometry[] = [];
  const views: { uniforms: Record<string, THREE.IUniform> }[] = [];
  const layerMeshes: { mesh: THREE.Mesh; band: LayerBand }[] = [];
  let meshUniforms: Record<string, THREE.IUniform> | null = null;

  const quad = () => {
    const g = new THREE.PlaneGeometry(width, height);
    geometries.push(g);
    return g;
  };

  if (mode === "flat") {
    const m = def.material ?? {};
    const mat = new THREE.MeshBasicMaterial({ map, transparent, opacity, toneMapped: false, fog: false });
    if (m.color) mat.color.copy(ctx.color(m.color));
    mat.color.multiplyScalar(Math.max(0, num(m.emissiveIntensity, 1)));
    if (transparent) mat.alphaTest = opacity < 1 ? 0 : 0.004;
    materials.push(mat);
    holder.add(new THREE.Mesh(quad(), mat));
  } else if (mode === "parallax") {
    const pp = parallaxParams(strength, width, height);
    const uniforms = {
      ...baseUniforms(map, def, ctx),
      uDepth: { value: depth },
      uView: { value: new THREE.Vector2() },
      uZoom: { value: 0 },
      uMaxOffset: { value: new THREE.Vector2(...pp.maxOffset) },
      uInset: { value: new THREE.Vector2(...pp.inset) },
      uFocus: { value: focus },
      // depth change per texel above which a hit is a depth-edge wall
      uWallSlope: { value: 0.02 },
    };
    const mat = shaderMaterial(QUAD_VERT, PARALLAX_FRAG.replace("__STEPS__", String(parallaxSteps(ctx.quality, strength))), uniforms, transparent);
    materials.push(mat);
    views.push(mat);
    holder.add(new THREE.Mesh(quad(), mat));
  } else if (mode === "mesh") {
    const [sx, sy] = meshSegments(num(def.segments, PHOTO_DEFAULTS.segments), width, height);
    const range = meshRange(strength, width);
    const geo = buildMeshGeometry(width, height, sx, sy);
    // Displacement happens on the GPU: give culling / editor bounds the real depth.
    geo.boundingBox = new THREE.Box3(new THREE.Vector3(-width / 2, -height / 2, -focus * range), new THREE.Vector3(width / 2, height / 2, (1 - focus) * range));
    geo.boundingSphere = geo.boundingBox.getBoundingSphere(new THREE.Sphere());
    geometries.push(geo);
    const uniforms = {
      ...baseUniforms(map, def, ctx),
      uDepth: { value: depth },
      uRange: { value: range },
      uFocus: { value: focus },
      uEdgeCut: { value: clamp(num(def.edgeCut, PHOTO_DEFAULTS.edgeCut), 0, 1) },
      uCam: { value: new THREE.Vector3(0, 0, 1e6) },
      uPerspective: { value: 0 },
    };
    meshUniforms = uniforms;
    const mat = shaderMaterial(MESH_VERT, MESH_FRAG, uniforms, opacity < 1);
    mat.side = THREE.DoubleSide;
    materials.push(mat);
    const main = new THREE.Mesh(geo, mat);
    main.renderOrder = 1;
    holder.add(main);
    // Backing (hidden at rest, fills the gaps behind moving foreground edges).
    {
      const bgeo = new THREE.PlaneGeometry(width, height, Math.max(1, Math.round(sx / 2)), Math.max(1, Math.round(sy / 2)));
      bgeo.boundingBox = geo.boundingBox.clone();
      bgeo.boundingSphere = geo.boundingSphere.clone();
      geometries.push(bgeo);
      const reach = new THREE.Vector2(6 / sx, 6 / sy);
      const bmat = shaderMaterial(BACKING_VERT, BACKING_FRAG, { ...uniforms, uReach: { value: reach } }, opacity < 1);
      bmat.side = THREE.DoubleSide;
      materials.push(bmat);
      const back = new THREE.Mesh(bgeo, bmat);
      back.renderOrder = 0;
      back.raycast = () => undefined; // selection / picking hit the photo itself
      holder.add(back);
    }
  } else {
    const pp = parallaxParams(strength, width, height);
    const geo = quad();
    const bands = layerBands(num(def.layers, PHOTO_DEFAULTS.layers), focus, strength, width);
    const edgeCut = clamp(num(def.edgeCut, PHOTO_DEFAULTS.edgeCut), 0, 1);
    bands.forEach((band, i) => {
      const uniforms = {
        ...baseUniforms(map, def, ctx),
        uDepth: { value: depth },
        uView: { value: new THREE.Vector2() },
        uZoom: { value: 0 },
        uMaxOffset: { value: new THREE.Vector2(...pp.maxOffset) },
        uInset: { value: new THREE.Vector2(...pp.inset) },
        uFocus: { value: focus },
        uCenter: { value: band.center },
        uLo: { value: band.lo },
        uHi: { value: band.hi },
        // edgeCut 0 = hard slice edges; otherwise soft edges (at most the default feather).
        uFeather: { value: edgeCut > 0 ? Math.min(band.feather, edgeCut) : 0.002 },
        uBackground: { value: band.background ? 1 : 0 },
      };
      const mat = shaderMaterial(QUAD_VERT, LAYER_FRAG, uniforms, band.background ? transparent : true);
      materials.push(mat);
      views.push(mat);
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.z = band.z;
      mesh.renderOrder = i;
      mesh.userData.a3dPhotoLayer = i;
      holder.add(mesh);
      layerMeshes.push({ mesh, band });
    });
  }

  // ── Motion state ──
  const live = !ctx.deterministic;
  const smoothed = { x: 0, y: 0, weight: 0, init: false };
  let gyro: { x: number; y: number } | null = null;
  let gyroBase: { beta: number; gamma: number } | null = null;
  let removeGyro: (() => void) | null = null;
  if (live && motion.gyro && motion.pointer > 0 && mode !== "flat" && typeof window !== "undefined" && typeof window.addEventListener === "function") {
    const onTilt = (e: DeviceOrientationEvent) => {
      if (e.beta === null || e.gamma === null) return;
      gyroBase ??= { beta: e.beta, gamma: e.gamma };
      const angle = (typeof screen !== "undefined" && screen.orientation?.angle) || 0;
      gyro = tiltToOffset(e.beta, e.gamma, gyroBase, angle);
    };
    window.addEventListener("deviceorientation", onTilt);
    removeGyro = () => window.removeEventListener("deviceorientation", onTilt);
  }
  const camLocal = new THREE.Vector3();
  let camCaptured = false;
  const maxTilt = strength * 8 * DEG;

  const update = (t: number, dt: number, input: PhotoFrameInput) => {
    if (mode === "flat") return;
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
    const off = viewOffset(motion, { t, pointer: smoothed, gyro: live ? gyro : null, scroll: input.scroll, reduced: input.reduced });
    for (const v of views) {
      (v.uniforms.uView.value as THREE.Vector2).set(off.x, off.y);
      v.uniforms.uZoom.value = off.zoom;
    }
    // Camera rest position in the object's space, captured on the first frame
    // (both modes line up with the source photo from there).
    const persp = !!input.camera && !!(input.camera as THREE.PerspectiveCamera).isPerspectiveCamera;
    if (input.camera && !camCaptured && mode !== "parallax") {
      input.camera.updateMatrixWorld();
      root.updateWorldMatrix(true, false);
      camLocal.setFromMatrixPosition(input.camera.matrixWorld);
      root.worldToLocal(camLocal);
      camCaptured = true;
    }
    if (mode === "mesh") {
      holder.rotation.set(off.y * maxTilt, -off.x * maxTilt, 0);
      holder.position.z = off.zoom * meshRange(strength, width) * 0.5;
      if (meshUniforms) {
        (meshUniforms.uCam.value as THREE.Vector3).copy(camLocal);
        meshUniforms.uPerspective.value = persp && camLocal.z > 0 ? 1 : 0;
      }
    } else if (mode === "layers" && camCaptured) {
      // Scale-compensate each layer for its z so the stack lines up at rest.
      const D = camLocal.z;
      for (const { mesh, band } of layerMeshes) {
        if (persp && D > band.z + 1e-3) {
          const s = (D - band.z) / D;
          mesh.scale.set(s, s, 1);
          mesh.position.set((camLocal.x * band.z) / D, (camLocal.y * band.z) / D, band.z);
        } else {
          mesh.scale.set(1, 1, 1);
          mesh.position.set(0, 0, band.z);
        }
      }
    }
  };

  return {
    object: root,
    update,
    dispose() {
      removeGyro?.();
      removeGyro = null;
      for (const m of materials) m.dispose();
      for (const g of geometries) g.dispose();
      map.dispose();
      depth?.dispose();
    },
  };
}
