// Shared helpers of the shader materials: vertex shader, palette functions,
// output chunk, and `make` (fragment + param → uniform binding → ShaderImpl).

import * as THREE from "three";
import type { BuildContext, ShaderImpl } from "../registry";
import { shaderParams, type Params } from "../generators/params";

export const MAX_COLORS = 6;

export const VERT = /* glsl */ `
varying vec2 vUv;
varying vec3 vPos;
varying vec3 vNormalV;
varying vec3 vViewDir;
void main() {
  vUv = uv;
  vPos = position;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vNormalV = normalize(normalMatrix * normal);
  vViewDir = normalize(-mv.xyz);
  gl_Position = projectionMatrix * mv;
}`;

export const PALETTE_FN = /* glsl */ `
uniform vec3 uColors[${MAX_COLORS}];
uniform int uCount;
vec3 palette(float t) {
  t = clamp(t, 0.0, 1.0) * float(uCount - 1);
  int i = int(floor(t));
  float f = t - float(i);
  vec3 a = uColors[0];
  vec3 b = uColors[0];
  for (int k = 0; k < ${MAX_COLORS}; k++) {
    if (k == i) a = uColors[k];
    if (k == i + 1) b = uColors[k];
  }
  if (i >= uCount - 1) b = a;
  return mix(a, b, f);
}
// cyclic palette (wraps last → first)
vec3 paletteCycle(float t) {
  t = fract(t) * float(uCount);
  int i = int(floor(t));
  float f = smoothstep(0.0, 1.0, t - float(i));
  vec3 a = uColors[0];
  vec3 b = uColors[0];
  for (int k = 0; k < ${MAX_COLORS}; k++) {
    if (k == i) a = uColors[k];
    if (k == i + 1) b = uColors[k];
  }
  if (i + 1 >= uCount) b = uColors[0];
  return mix(a, b, f);
}
`;

export const OUT = /* glsl */ `
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
`;

export type UniformMap = Record<string, THREE.IUniform>;

export function colorsUniform(list: THREE.Color[]): { uColors: THREE.IUniform; uCount: THREE.IUniform } {
  const arr = Array.from({ length: MAX_COLORS }, (_, k) => (list[Math.min(k, list.length - 1)] ?? new THREE.Color("#ffffff")).clone());
  return { uColors: { value: arr }, uCount: { value: Math.max(1, Math.min(MAX_COLORS, list.length)) } };
}

// Builds a ShaderImpl from a fragment body and a param → uniform binding.
export function make(
  id: string,
  fragment: string,
  bind: (p: Params) => UniformMap,
  names: Record<string, string>,
  opts: Partial<THREE.ShaderMaterialParameters> = {},
): ShaderImpl {
  return {
    create(params: Record<string, unknown>, ctx: BuildContext) {
      const p = shaderParams(id, params, ctx);
      const uniforms: UniformMap = { uTime: { value: 0 }, ...bind(p) };
      const material = new THREE.ShaderMaterial({ uniforms, vertexShader: VERT, fragmentShader: fragment, ...opts });
      material.name = `shader:${id}`;
      material.userData.shader = id;
      material.userData.setParam = (name: string, value: unknown) => {
        const u = names[name];
        if (!u || !uniforms[u]) return;
        if (name === "colors") {
          // Mutate in place: aliases of uColors / uCount (uMgColors…) follow.
          const next = colorsUniform(shaderParams(id, { colors: value }, ctx).colors("colors"));
          uniforms.uColors!.value = next.uColors.value;
          uniforms.uCount!.value = next.uCount.value;
          return;
        }
        const cur = uniforms[u]!.value;
        if (cur instanceof THREE.Color) {
          if (typeof value === "string") cur.copy(ctx.color(value));
        } else if (typeof value === "number") uniforms[u]!.value = value;
      };
      return {
        material,
        update(t: number) {
          uniforms.uTime!.value = t;
        },
      };
    },
  };
}

