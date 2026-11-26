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
// Background plate (`plate` + `plateDepth`, agent3d assets plate): the photo
// with the foreground removed near depth edges, filled with background. It
// replaces the "nearest background texel" heuristics where moving foreground
// uncovers what is behind it: the parallax ray continues behind a wall
// against the plate depth, the mesh backing sits at the plate depth with the
// plate colours, and covered layer texels come from the plate.
//
// Motion (pure function of t for the auto drift; seek-safe): the view offset
// (-1..1) mixes the pointer (smoothed live, instant in deterministic mode),
// device tilt (live only, when the page receives deviceorientation events),
// scroll and the `auto` drift ("sway" / "orbit" / "zoom"), which fades out
// while the pointer / gyro drives the view. Reduced motion: no auto drift,
// half pointer amount.
//
// Effects (def.effects: fog / light / reveal, ./photoFx.ts) run in every mode
// on the sampled texel; their uniforms are shared by all the photo's materials.
//
// 3D inside the photo (`occlude: true`, opt-in): the photo writes the true
// depth of each pixel to the depth buffer, so text / meshes / models /
// particles placed between its depth planes are hidden by its foreground.
// Depth value d → photo local z: src/core/photoDepth.ts (parallax / layers:
// z = D·u/(1+u), u = (d − focus)·range/D, D = camera → photo plane distance;
// mesh: z = (d − focus)·range; range = strength·width·0.25). The fragment
// takes the point at that z on the camera ray through it and writes its
// projected depth (gl_FragDepth, PHOTO_OCCLUDE blocks in the main()s).
// Coherent motion: with occlude, the view offset is ALSO a real camera move
// (applyCamera(), run by the World right after the camera rig). The camera
// slides parallel to the photo plane by c = offset · k · D / range (k = the
// on-plane shift of the parallax shader per unit of (d − focus)) and the
// projection gets the matching off-axis shear, so the focus plane — the quad
// itself — stays pixel-still while a 3D point at height z slides by
// c·z/(D − z): exactly the shift the shader gives the photo pixels of the
// depth that maps to z (hence the u/(1+u) mapping). The photo pixels keep
// their UV parallax untouched (same look as without occlude); 3D objects at
// a photo depth move with the pixels of that depth, never swim. The zoom
// drift becomes a dolly + projection scale (approximate: exact for a photo
// centred on the camera axis). Mesh mode: the camera move replaces the grid
// tilt (real geometry, no extra mapping); layers: the slices sit at z = 0 and
// their fragments write their band's depth. Only the first occluding photo
// drives the camera; an orbit-controlled camera is never moved (OrbitControls
// owns its pose). Exact when the camera looks straight at the photo; an
// orthographic camera only gets the depth (no camera move).

import * as THREE from "three";
import type { PhotoObjectDef } from "../../core/types";
import { loadTexture } from "../assets";
import { DEG, clamp, num } from "../util";
import type { RuntimeContext } from "./context";
import { photoDepthRange } from "../../core/photoDepth";
import { PARALLAX_GLSL, PARALLAX_WALL_SLOPE, PHOTO_COMMON_GLSL, PHOTO_DEFAULTS, createPhotoMotion, motionSettings, parallaxParams, parallaxSteps, photoSize } from "./photoCore";
import { createPhotoFx, type FxValue, type PhotoFx } from "./photoFx";

// The three-free core (sizing, motion, parallax math, GLSL) lives in
// ./photoCore.ts — shared with the photo-only lite runtime (src/runtime/lite/).
export {
  PHOTO_DEFAULTS,
  autoDrift,
  motionSettings,
  parallaxParams,
  parallaxSteps,
  photoSize,
  smoothToward,
  tiltToOffset,
  viewOffset,
  type MotionFrame,
  type MotionSettings,
  type PhotoAuto,
  type ViewOffset,
} from "./photoCore";

// ─── Pure helpers (unit-tested) ─────────────────────────────────────────

// Mesh: grid cells per axis (`segments` on the long side).
export function meshSegments(segments: number, width: number, height: number): [number, number] {
  const n = Math.round(clamp(num(segments, PHOTO_DEFAULTS.segments), 2, 1024));
  if (width >= height) return [n, Math.max(1, Math.round((n * height) / width))];
  return [Math.max(1, Math.round((n * width) / height)), n];
}

// Mesh: depth displacement range (world units).
export function meshRange(strength: number, width: number): number {
  return photoDepthRange(strength, width);
}

// Occlude: the camera move (photo local units) for a view offset, and the
// projection scale that keeps the focus plane still. D = camera → photo
// plane distance. parallax / layers: k = on-plane shift per unit of
// (d − focus) at full offset (maxOffset / inset × size), c = offset · k · D /
// range, and the zoom drift is a dolly δ (radial depth expansion) with the
// image magnification 1 / (1 − 0.06·zoom) as a projection scale. mesh: the
// orbit the grid tilt used to give (± strength · 8°) and a plain dolly.
export interface PhotoCameraMove {
  x: number;
  y: number;
  dolly: number; // towards the photo (local units)
  magnify: number; // projection xy scale on top of keeping the focus plane fixed (1 = none); NaN = real dolly (mesh)
}
export function photoCameraMove(mode: "parallax" | "layers" | "mesh", off: { x: number; y: number; zoom: number }, p: { strength: number; width: number; height: number; distance: number }): PhotoCameraMove {
  const D = p.distance;
  const range = meshRange(p.strength, p.width);
  if (!(D > 0) || range <= 0) return { x: 0, y: 0, dolly: 0, magnify: 1 };
  if (mode === "mesh") {
    const r = D * Math.tan(clamp(p.strength, 0, 1) * 8 * DEG);
    return { x: off.x * r, y: off.y * r, dolly: off.zoom * range * 0.5, magnify: NaN };
  }
  const pp = parallaxParams(p.strength, p.width, p.height);
  const kx = (pp.maxOffset[0] / pp.inset[0]) * p.width;
  const ky = (pp.maxOffset[1] / pp.inset[1]) * p.height;
  const mx = 0.5 * (pp.maxOffset[0] / pp.inset[0] + pp.maxOffset[1] / pp.inset[1]);
  const alpha = (2 * off.zoom * mx * D) / range;
  return { x: (off.x * kx * D) / range, y: (off.y * ky * D) / range, dolly: (alpha * D) / (1 + alpha), magnify: 1 / (1 - 0.06 * off.zoom) };
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

// ─── Shaders ────────────────────────────────────────────────────────────

const COMMON_FRAG = PHOTO_COMMON_GLSL;

const QUAD_VERT = /* glsl */ `
varying vec2 vUv;
#ifdef PHOTO_OCCLUDE
varying vec3 vLocal;
varying vec3 vRay;
#endif
void main() {
  vUv = uv;
  #ifdef PHOTO_OCCLUDE
  // camera ray through this vertex, in the object's space
  mat4 inv = inverse(modelViewMatrix);
  vLocal = position;
  vRay = isOrthographic ? (inv * vec4(0.0, 0.0, -1.0, 0.0)).xyz : position - (inv * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
  #endif
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

// Occlude: write the true depth of the pixel (depth-map value d): the point
// at local z = photoDepthToZ(d) (src/core/photoDepth.ts) on the camera ray
// through this fragment of the quad, projected. Needs uFocus declared before.
const OCCLUDE_FRAG = /* glsl */ `
#ifdef PHOTO_OCCLUDE
uniform mat4 projectionMatrix;
uniform mat4 modelViewMatrix;
uniform float uZRange;
uniform float uZDist;
varying vec3 vLocal;
varying vec3 vRay;
void photoDepthOut(float d) {
  float lin = (d - uFocus) * uZRange;
  float z = lin * uZDist / (uZDist + lin);
  float rz = abs(vRay.z) > 1e-6 ? vRay.z : 1e-6;
  vec3 p = vLocal + vRay * ((z - vLocal.z) / rz);
  vec4 clip = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
  gl_FragDepth = clamp(0.5 + 0.5 * clip.z / clip.w, 0.0, 1.0);
}
#endif
`;

// Parallax (relief mapping, ./photoCore.ts PARALLAX_GLSL) on a quad.
const parallaxFrag = (fx: PhotoFx) => /* glsl */ `
${COMMON_FRAG}
${PARALLAX_GLSL}
${fx.glsl}
${OCCLUDE_FRAG}
varying vec2 vUv;
void main() {
  vec4 c = parallaxTexel(vUv);
  ${fx.call("pxUv", "photoHitDepth")}
  if (c.a * uOpacity < 0.004) discard;
  #ifdef PHOTO_OCCLUDE
  if (c.a < 0.5) discard;
  photoDepthOut(photoHitDepth);
  #endif
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

const meshFrag = (fx: PhotoFx) => /* glsl */ `
${COMMON_FRAG}
uniform sampler2D uDepth;
${fx.glsl}
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
  ${fx.call("vUv", "textureLod(uDepth, vUv, 0.0).r")}
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
uniform sampler2D uPlateDepth;
uniform float uPlateOn;
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
  // with a plate: its depth is the background behind the foreground
  if (uPlateOn > 0.5) d = min(d, textureLod(uPlateDepth, uv, 0.0).r);
  else for (int i = 1; i <= 2; i++) {
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

const backingFrag = (fx: PhotoFx) => /* glsl */ `
${COMMON_FRAG}
uniform sampler2D uDepth;
${fx.glsl}
uniform sampler2D uPlate;
uniform float uPlateOn;
varying vec2 vUv;
varying float vDepth;
void main() {
  vec2 uv = vUv;
  float d = textureLod(uDepth, uv, 0.0).r;
  if (uPlateOn > 0.5) {
    vec4 pc = texture2D(uPlate, uv);
    if (pc.a * uOpacity < 0.004) discard;
    gl_FragColor = shade(pc, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
    return;
  }
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
  ${fx.call("uv", "textureLod(uDepth, uv, 0.0).r")}
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
const layerFrag = (fx: PhotoFx) => /* glsl */ `
${COMMON_FRAG}
uniform sampler2D uDepth;
${fx.glsl}
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
${OCCLUDE_FRAG}
uniform sampler2D uPlate;
uniform sampler2D uPlateDepth;
uniform float uPlateOn;
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
  bool onPlate = false;
  // covered by nearer content
  if (d > uHi + uFeather && uPlateOn > 0.5) {
    // the plate holds what is behind the foreground: this layer's surface
    // continues there when the plate depth falls in its band
    vec2 puv = base + (uCenter - uFocus) * dir;
    for (int i = 0; i < 3; i++) puv = base + (clamp(textureLod(uPlateDepth, puv, 0.0).r, uLo, uHi) - uFocus) * dir;
    float pd = textureLod(uPlateDepth, puv, 0.0).r;
    // (the background layer always takes the plate: its best guess)
    if (uBackground > 0.5 || (pd <= uHi + uFeather && pd >= uLo - uFeather)) {
      cuv = puv;
      onPlate = true;
    } else discard;
  } else if (d > uHi + uFeather) {
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
  vec2 gx = dFdx(base), gy = dFdy(base);
  vec4 c = onPlate ? textureGrad(uPlate, cuv, gx, gy) : textureGrad(uMap, cuv, gx, gy);
  ${fx.call("cuv", "textureLod(uDepth, cuv, 0.0).r")}
  gl_FragColor = shade(c, a);
  if (gl_FragColor.a < 0.004) discard;
  #ifdef PHOTO_OCCLUDE
  // the depth this layer's surface moves with
  photoDepthOut(uBackground > 0.5 ? textureLod(uDepth, cuv, 0.0).r : clamp(textureLod(uDepth, cuv, 0.0).r, uLo, uHi));
  #endif
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

// Flat photo with effects (light only: the others need depth).
const flatFrag = (fx: PhotoFx) => /* glsl */ `
${COMMON_FRAG}
${fx.glsl}
varying vec2 vUv;
void main() {
  vec4 c = texture2D(uMap, vUv);
  ${fx.call("vUv", "0.5")}
  if (c.a * uOpacity < 0.004) discard;
  gl_FragColor = shade(c, 1.0);
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

// Live effect params ("<id>.effects.<effect>.<param>" timeline tracks).
export interface PhotoEffectsControl {
  get(effect: string, param: string): FxValue | undefined;
  set(effect: string, param: string, value: number | number[]): void;
}

export interface BuiltPhoto {
  object: THREE.Object3D;
  update(t: number, dt: number, input: PhotoFrameInput): void;
  effects: PhotoEffectsControl;
  // Occlude only: run after the camera rig each frame. `drive` = this photo's
  // view offset moves the camera (the World picks the first occluding photo).
  applyCamera?(camera: THREE.Camera, drive: boolean): void;
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

export async function buildPhoto(def: PhotoObjectDef, ctx: RuntimeContext): Promise<BuiltPhoto> {
  const optional = (path: string | undefined, what: string, field: string, after: string) =>
    path ? loadTexture(ctx.resolveAsset(path)).catch((err: Error) => {
      ctx.issue("asset-load", `${def.id}: ${what}: ${err.message} — ${after}`, `objects#${def.id}.${field}`);
      return null;
    }) : Promise.resolve(null);
  const withPlate = !!(def.depth && def.plate && def.plateDepth);
  const [map, depth, plateTex, plateDepthTex] = await Promise.all([
    loadTexture(ctx.resolveAsset(def.src)),
    optional(def.depth, "depth map", "depth", "showing the photo flat"),
    optional(withPlate ? def.plate : undefined, "plate", "plate", "edges use the photo"),
    optional(withPlate ? def.plateDepth : undefined, "plate depth", "plateDepth", "edges use the photo"),
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
  // Plate (colour: like the photo; depth: like the depth map). Both or none.
  const plate = depth && plateTex && plateDepthTex ? { map: plateTex, depth: plateDepthTex } : null;
  if (!plate) {
    plateTex?.dispose();
    plateDepthTex?.dispose();
  } else {
    for (const [t, data] of [[plate.map, false], [plate.depth, true]] as const) {
      t.wrapS = t.wrapT = THREE.MirroredRepeatWrapping;
      if (data) {
        t.colorSpace = THREE.NoColorSpace;
        t.premultiplyAlpha = false;
        t.generateMipmaps = false;
        t.minFilter = THREE.LinearFilter;
        t.magFilter = THREE.LinearFilter;
      } else {
        t.colorSpace = THREE.SRGBColorSpace;
        t.anisotropy = 4;
      }
      t.needsUpdate = true;
    }
  }
  const plateUniforms = () => ({ uPlate: { value: plate?.map ?? map }, uPlateDepth: { value: plate?.depth ?? depth }, uPlateOn: { value: plate ? 1 : 0 } });
  const img = imageSize(map);
  const { width, height } = photoSize(def, img.w, img.h);
  const strength = clamp(num(def.strength, PHOTO_DEFAULTS.strength), 0, 1);
  const focus = clamp(num(def.focus, PHOTO_DEFAULTS.focus), 0, 1);
  const opacity = clamp(num(def.material?.opacity, 1), 0, 1);
  const motion = motionSettings(def.motion);
  const mode = depth ? def.mode ?? "parallax" : "flat";
  // Occlude (3D inside the photo): true depth + coherent camera motion. A
  // flat photo is just a quad (its own depth is already right).
  const occlude = def.occlude === true && mode !== "flat";
  // Occluding photos are drawn in the opaque pass (alpha-tested) so the
  // depth they write is there before the 3D content behind them.
  const transparent = opacity < 1 || (!occlude && /\.(png|webp)$/i.test(def.src));
  const fx = createPhotoFx(def.effects, {
    depth: !!depth,
    color: (c) => ctx.color(c).toArray() as [number, number, number],
    aspect: width / height,
    live: !ctx.deterministic,
    smoothing: motion.smoothing,
    speed: motion.speed,
  });
  // Effect uniforms: one object per name, shared by every material of the photo.
  const fxUniforms: Record<string, THREE.IUniform> = {};
  const pushFx = () => {
    for (const [k, v] of Object.entries(fx.uniforms())) {
      const u = (fxUniforms[k] ??= { value: v.length === 1 ? 0 : v.length === 2 ? new THREE.Vector2() : v.length === 3 ? new THREE.Vector3() : new THREE.Vector4() });
      if (v.length === 1) u.value = v[0];
      else (u.value as THREE.Vector4).fromArray(v);
    }
  };
  pushFx();
  const blended = transparent || fx.alpha;

  const root = new THREE.Group();
  const holder = new THREE.Group(); // mesh mode tilts this (the root keeps the scene transform)
  root.add(holder);
  const materials: THREE.Material[] = [];
  const geometries: THREE.BufferGeometry[] = [];
  const views: { uniforms: Record<string, THREE.IUniform> }[] = [];
  const layerMeshes: { mesh: THREE.Mesh; band: LayerBand }[] = [];
  let meshUniforms: Record<string, THREE.IUniform> | null = null;

  // Occlude: depth output uniforms (uZDist updated per frame by applyCamera).
  const occludeUniforms: { uZRange: THREE.IUniform; uZDist: THREE.IUniform }[] = [];
  const occludeMaterial = (mat: THREE.ShaderMaterial, uniforms: Record<string, THREE.IUniform>) => {
    const u = { uZRange: { value: meshRange(strength, width) }, uZDist: { value: 1e6 } };
    Object.assign(uniforms, u);
    mat.uniforms = uniforms;
    occludeUniforms.push(u);
    mat.defines = { ...mat.defines, PHOTO_OCCLUDE: "" };
    mat.depthWrite = true;
  };

  const quad = () => {
    const g = new THREE.PlaneGeometry(width, height);
    geometries.push(g);
    return g;
  };

  if (mode === "flat" && fx.glsl) {
    const mat = shaderMaterial(QUAD_VERT, flatFrag(fx), { ...baseUniforms(map, def, ctx), ...fxUniforms }, blended);
    materials.push(mat);
    holder.add(new THREE.Mesh(quad(), mat));
  } else if (mode === "flat") {
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
      uWallSlope: { value: PARALLAX_WALL_SLOPE },
      ...fxUniforms,
      ...plateUniforms(),
    };
    const mat = shaderMaterial(QUAD_VERT, parallaxFrag(fx).replace("__STEPS__", String(parallaxSteps(ctx.quality, strength))), uniforms, blended);
    if (occlude) occludeMaterial(mat, uniforms);
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
      ...fxUniforms,
    };
    meshUniforms = uniforms;
    const mat = shaderMaterial(MESH_VERT, meshFrag(fx), uniforms, opacity < 1 || fx.alpha);
    // The displaced grid is real geometry: its depth is already the true one.
    if (occlude) mat.depthWrite = true;
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
      const bmat = shaderMaterial(BACKING_VERT, backingFrag(fx), { ...uniforms, uReach: { value: reach }, ...plateUniforms() }, opacity < 1 || fx.alpha);
      if (occlude) bmat.depthWrite = true;
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
        ...fxUniforms,
        ...plateUniforms(),
      };
      const mat = shaderMaterial(QUAD_VERT, layerFrag(fx), uniforms, band.background ? blended : true);
      if (occlude) occludeMaterial(mat, uniforms);
      materials.push(mat);
      views.push(mat);
      const mesh = new THREE.Mesh(geo, mat);
      // Occlude: the slices sit on the photo plane (the camera move gives
      // the parallax of the 3D content; each fragment writes its own depth).
      mesh.position.z = occlude ? 0 : band.z;
      // Occlude: the slices (transparent, writing depth) draw before the
      // scene's other transparent objects, which then depth-test against them.
      mesh.renderOrder = occlude ? i - 1000 : i;
      mesh.userData.a3dPhotoLayer = i;
      holder.add(mesh);
      layerMeshes.push({ mesh, band });
    });
  }

  // ── Motion state (live smoothing + gyro: ./photoCore.ts) ──
  let lastOff = { x: 0, y: 0, zoom: 0 };
  const photoMotion = createPhotoMotion(motion, { live: !ctx.deterministic, flat: mode === "flat" });
  const camLocal = new THREE.Vector3();
  let camCaptured = false;
  const maxTilt = strength * 8 * DEG;

  const update = (t: number, dt: number, input: PhotoFrameInput) => {
    if (fx.glsl) {
      fx.frame(t, dt, input);
      pushFx();
    }
    if (mode === "flat") return;
    const off = photoMotion.offset(t, dt, input);
    lastOff = off;
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
    if (mode === "mesh" && occlude) {
      // the camera moves instead (applyCamera)
    } else if (mode === "mesh") {
      holder.rotation.set(off.y * maxTilt, -off.x * maxTilt, 0);
      holder.position.z = off.zoom * meshRange(strength, width) * 0.5;
    }
    if (mode === "mesh" && meshUniforms) {
      (meshUniforms.uCam.value as THREE.Vector3).copy(camLocal);
      meshUniforms.uPerspective.value = persp && camLocal.z > 0 ? 1 : 0;
    } else if (mode === "layers" && camCaptured && !occlude) {
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

  // ── Occlude: the view offset as a real camera move (see the header) ──
  const camRoot = new THREE.Vector3();
  const tmpV = new THREE.Vector3();
  const tmpM3 = new THREE.Matrix3();
  const shear = new THREE.Matrix4();
  const applyCamera = (camera: THREE.Camera, drive: boolean) => {
    const persp = !!(camera as THREE.PerspectiveCamera).isPerspectiveCamera;
    root.updateWorldMatrix(true, false);
    camera.updateMatrixWorld();
    camRoot.setFromMatrixPosition(camera.matrixWorld);
    root.worldToLocal(camRoot);
    // Camera → photo plane distance (local units): the depth mapping's D.
    const D = persp && camRoot.z > 1e-3 ? camRoot.z : 0;
    const zDist = D > 0 ? D : 1e6;
    for (const m of occludeUniforms) m.uZDist.value = zDist;
    holder.scale.set(1, 1, 1);
    if (!drive || !D) return;
    const cam = camera as THREE.PerspectiveCamera;
    // Undo the previous frame's shear (the rig only rebuilds the projection when the fov changes).
    cam.updateProjectionMatrix();
    const move = photoCameraMove(mode === "mesh" ? "mesh" : mode === "layers" ? "layers" : "parallax", lastOff, { strength, width, height, distance: D });
    if (!move.x && !move.y && !move.dolly && move.magnify === 1) return;
    // Local move → world → camera space.
    tmpM3.setFromMatrix4(root.matrixWorld);
    const world = tmpV.set(move.x, move.y, -move.dolly).applyMatrix3(tmpM3);
    // Photo plane distance along the camera axis (camera space, rest pose).
    const origin = new THREE.Vector3().setFromMatrixPosition(root.matrixWorld).applyMatrix4(camera.matrixWorldInverse);
    const Dc = -origin.z;
    const tc = world.clone().applyMatrix3(tmpM3.setFromMatrix4(camera.matrixWorldInverse));
    camera.position.add(world);
    camera.updateMatrixWorld();
    if (!(Dc > 1e-3)) return;
    const D2 = Dc + tc.z; // after the dolly
    if (!(D2 > 1e-3)) return;
    // Off-axis shear keeping the photo (focus) plane still: S(q).xy = a·(q.xy − t.xy·q.z / D2).
    const keep = Number.isNaN(move.magnify) ? Dc / D2 : move.magnify;
    const a = (keep * D2) / Dc;
    shear.set(a, 0, (-a * tc.x) / D2, 0, 0, a, (-a * tc.y) / D2, 0, 0, 0, 1, 0, 0, 0, 0, 1);
    cam.projectionMatrix.multiply(shear);
    cam.projectionMatrixInverse.copy(cam.projectionMatrix).invert();
    // The image magnification of the zoom drift is now in the projection: shrink
    // the photo back (exact when the photo is centred on the camera axis).
    if (!Number.isNaN(move.magnify) && move.magnify !== 1) holder.scale.set(1 / move.magnify, 1 / move.magnify, 1);
  };

  return {
    object: root,
    update,
    effects: {
      get: (effect, param) => fx.get(effect, param),
      set(effect, param, value) {
        if (fx.set(effect, param, value)) pushFx();
      },
    },
    ...(occlude ? { applyCamera } : {}),
    dispose() {
      photoMotion.dispose();
      for (const m of materials) m.dispose();
      for (const g of geometries) g.dispose();
      map.dispose();
      depth?.dispose();
      plate?.map.dispose();
      plate?.depth.dispose();
    },
  };
}
