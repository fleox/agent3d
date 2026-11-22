// Stylised water shading shared by the water and terrain generators: a
// MeshStandardMaterial patched with onBeforeCompile (scene lights, shadows,
// fog and IBL keep working) adding
// - analytic vertex waves (pure function of uTime),
// - depth colour: shallow → deep from a per-vertex `aDepth` attribute (the
//   depth of the ground below, baked from a sibling terrain) + fresnel,
// - animated foam lines along the shore (aDepth ≈ 0) and on wave crests,
// - procedural ripple normals (two scrolling noise layers) → a sun glint
//   that moves (needs a directional light),
// - more transparency in the shallows.
// Everything is deterministic (uTime only), no textures, no depth buffer.

import * as THREE from "three";

export interface WaterLook {
  deep: THREE.Color;
  shallow: THREE.Color;
  foam: THREE.Color;
  opacity: number;
  waveHeight: number;
  waveSpeed: number;
  // Shore foam band width in depth units (0 = no foam).
  foamWidth: number;
  // Ripple normal strength (0 = mirror-flat between waves).
  ripples: number;
  // Faceted low-poly look (flat normals, no ripples).
  flat: boolean;
  // Depth (world units) at which the colour reaches `deep`.
  depthRange: number;
}

// Same formula as the GLSL (CPU side: floating objects / heightAt).
export function waveHeight(x: number, z: number, t: number, amp: number, speed: number): number {
  const s = t * speed;
  return amp * (Math.sin(x * 0.55 + s * 1.1) * 0.5 + Math.sin(z * 0.7 - s * 0.9 + 1.3) * 0.35 + Math.sin((x + z) * 1.25 + s * 1.9) * 0.2 + Math.sin((x - z) * 2.1 - s * 2.4) * 0.1);
}

export function createWaterMaterial(look: WaterLook): { material: THREE.MeshStandardMaterial; uniforms: { uTime: { value: number } } } {
  const uniforms = {
    uTime: { value: 0 },
    uAmp: { value: look.waveHeight },
    uSpeed: { value: look.waveSpeed },
    uShallow: { value: look.shallow.clone() },
    uDeep: { value: look.deep.clone() },
    uFoam: { value: look.foam.clone() },
    uFoamW: { value: look.foamWidth },
    uRipples: { value: look.flat ? 0 : look.ripples },
    uDepthRange: { value: Math.max(0.01, look.depthRange) },
    uOpacity: { value: look.opacity },
  };
  const material = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: look.flat ? 0.25 : 0.08, metalness: 0.02, flatShading: look.flat, transparent: true, depthWrite: false });
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader =
      /* glsl */ `
uniform float uTime; uniform float uAmp; uniform float uSpeed;
attribute float aDepth;
varying float vDepth; varying float vCrest; varying vec3 vWPos;
float waveH(vec2 p, float t) {
  float s = t * uSpeed;
  return uAmp * (sin(p.x * 0.55 + s * 1.1) * 0.5 + sin(p.y * 0.7 - s * 0.9 + 1.3) * 0.35 + sin((p.x + p.y) * 1.25 + s * 1.9) * 0.2 + sin((p.x - p.y) * 2.1 - s * 2.4) * 0.1);
}
` +
      shader.vertexShader
        .replace(
          "#include <begin_vertex>",
          /* glsl */ `#include <begin_vertex>
float hh = waveH(position.xz, uTime);
transformed.y += hh;
vCrest = hh / max(uAmp, 1e-4);
vDepth = aDepth;
`,
        )
        .replace(
          "#include <beginnormal_vertex>",
          /* glsl */ `#include <beginnormal_vertex>
{
  float e = 0.08;
  float hx = waveH(position.xz + vec2(e, 0.0), uTime) - waveH(position.xz - vec2(e, 0.0), uTime);
  float hz = waveH(position.xz + vec2(0.0, e), uTime) - waveH(position.xz - vec2(0.0, e), uTime);
  objectNormal = normalize(vec3(-hx / (2.0 * e), 1.0, -hz / (2.0 * e)));
}`,
        )
        .replace("#include <worldpos_vertex>", "#include <worldpos_vertex>\nvWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;");
    shader.fragmentShader =
      /* glsl */ `
uniform float uTime; uniform vec3 uShallow; uniform vec3 uDeep; uniform vec3 uFoam; uniform float uFoamW; uniform float uRipples; uniform float uDepthRange; uniform float uOpacity;
varying float vDepth; varying float vCrest; varying vec3 vWPos;
float wHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float wNoise(vec2 p) { vec2 i = floor(p); vec2 f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(wHash(i), wHash(i + vec2(1.0, 0.0)), u.x), mix(wHash(i + vec2(0.0, 1.0)), wHash(i + vec2(1.0, 1.0)), u.x), u.y); }
vec2 wGrad(vec2 p) { float e = 0.05; return vec2(wNoise(p + vec2(e, 0.0)) - wNoise(p - vec2(e, 0.0)), wNoise(p + vec2(0.0, e)) - wNoise(p - vec2(0.0, e))) / (2.0 * e); }
` +
      shader.fragmentShader
        .replace(
          "#include <color_fragment>",
          /* glsl */ `#include <color_fragment>
float wd = clamp(vDepth / uDepthRange, 0.0, 1.0);
vec3 wCol = mix(uShallow, uDeep, smoothstep(0.0, 1.0, sqrt(wd)));
wCol = mix(wCol, uShallow * 1.15, clamp(vCrest, 0.0, 1.0) * 0.25);
// Shore foam: a solid rim + animated lines moving toward the shore.
float foam = 0.0;
if (uFoamW > 0.0) {
  float fw = uFoamW;
  float n = wNoise(vWPos.xz * 1.7 + uTime * 0.15);
  float rim = 1.0 - smoothstep(fw * 0.15, fw * (0.3 + n * 0.2), vDepth);
  float lines = smoothstep(0.82, 0.95, sin((vDepth / fw) * 9.0 + uTime * 2.2 + n * 3.0) * 0.5 + 0.5) * (1.0 - smoothstep(fw * 0.5, fw * 1.3, vDepth));
  foam = max(rim, lines * 0.75) * step(0.0001, vDepth + 1.0);
}
foam = max(foam, smoothstep(0.82, 1.0, vCrest) * 0.35 * (0.6 + 0.4 * wNoise(vWPos.xz * 2.5 - uTime * 0.3)));
float wFoam = clamp(foam, 0.0, 1.0);
diffuseColor.rgb = mix(wCol, uFoam, wFoam);
`,
        )
        .replace(
          "#include <normal_fragment_maps>",
          /* glsl */ `#include <normal_fragment_maps>
if (uRipples > 0.0) {
  vec2 g = wGrad(vWPos.xz * 1.3 + vec2(uTime * 0.35, uTime * 0.21)) + wGrad(vWPos.xz * 2.9 - vec2(uTime * 0.27, -uTime * 0.4)) * 0.6;
  vec3 pert = (viewMatrix * vec4(g.x, 0.0, g.y, 0.0)).xyz;
  normal = normalize(normal - pert * uRipples * 0.12);
}
{
  float wFres = pow(1.0 - clamp(abs(dot(normal, normalize(vViewPosition))), 0.0, 1.0), 3.0);
  diffuseColor.rgb = mix(diffuseColor.rgb, uShallow * 1.1 + 0.04, wFres * 0.2 * (1.0 - wFoam));
  diffuseColor.a = uOpacity * mix(0.55 + 0.45 * smoothstep(0.0, 0.6, wd), 1.0, max(wFoam, wFres * 0.6));
}`,
        );
  };
  material.customProgramCacheKey = () => `agent3d-water2-${look.flat ? "f" : "s"}`;
  return { material, uniforms };
}

// Bakes the `aDepth` attribute of a horizontal water geometry (y = 0 in the
// geometry, positioned at `waterY`) from a ground height function.
export function bakeDepth(geometry: THREE.BufferGeometry, waterY: number, ground: ((x: number, z: number) => number) | null, offset: THREE.Vector3 = new THREE.Vector3()): void {
  const p = geometry.getAttribute("position") as THREE.BufferAttribute;
  const d = new Float32Array(p.count);
  for (let i = 0; i < p.count; i++) d[i] = ground ? waterY - ground(p.getX(i) + offset.x, p.getZ(i) + offset.z) : 1000;
  geometry.setAttribute("aDepth", new THREE.BufferAttribute(d, 1));
}
