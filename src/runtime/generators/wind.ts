// Vertex-shader wind for foliage (trees, grass, flowers): patches a built-in
// material with onBeforeCompile so lighting, fog and shadows keep working.
// Deterministic: the displacement is a pure function of the uTime uniform.

import * as THREE from "three";

export interface WindOptions {
  // "attribute": per-vertex `aWind` (phase, weight) baked in merged geometry.
  // "instanced": phase from the instance position, weight from local y / height.
  mode: "attribute" | "instanced";
  strength: number;
  height?: number; // instanced: blade / stem height
  speed?: number;
}

export function addWind(material: THREE.Material, opts: WindOptions): { uniforms: { uTime: { value: number } } } {
  const uniforms = { uTime: { value: 0 }, uWind: { value: opts.strength }, uWindH: { value: opts.height ?? 1 }, uWindSpeed: { value: opts.speed ?? 1 } };
  const header = /* glsl */ `
uniform float uTime;
uniform float uWind;
uniform float uWindH;
uniform float uWindSpeed;
${opts.mode === "attribute" ? "attribute vec2 aWind;" : ""}
`;
  const body =
    opts.mode === "attribute"
      ? /* glsl */ `
{
  float ph = aWind.x;
  float w = aWind.y * uWind;
  float tt = uTime * uWindSpeed;
  float gust = 0.6 + 0.4 * sin(tt * 0.37 + ph * 0.1);
  transformed.x += (sin(tt * 1.6 + ph) * 0.7 + sin(tt * 2.9 + ph * 1.7) * 0.3) * w * gust;
  transformed.z += cos(tt * 1.3 + ph * 1.3) * 0.5 * w * gust;
}
`
      : /* glsl */ `
{
  #ifdef USE_INSTANCING
  vec3 ip = vec3(instanceMatrix[3][0], instanceMatrix[3][1], instanceMatrix[3][2]);
  #else
  vec3 ip = vec3(0.0);
  #endif
  float k = clamp(position.y / uWindH, 0.0, 1.0);
  k = k * k;
  float tt = uTime * uWindSpeed;
  float wave = sin(tt * 1.8 + ip.x * 0.35 + ip.z * 0.22) * 0.6 + sin(tt * 3.1 + ip.x * 0.9 - ip.z * 0.7) * 0.25;
  float gust = 0.55 + 0.45 * sin(tt * 0.6 + ip.x * 0.08 + ip.z * 0.05);
  transformed.x += (wave * gust + 0.25) * uWind * k * uWindH;
  transformed.z += cos(tt * 1.4 + ip.z * 0.4) * 0.35 * uWind * k * uWindH;
}
`;
  const prev = material.onBeforeCompile;
  material.onBeforeCompile = (shader, renderer) => {
    prev.call(material, shader, renderer);
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = header + shader.vertexShader.replace("#include <begin_vertex>", "#include <begin_vertex>\n" + body);
  };
  const prevKey = material.customProgramCacheKey.bind(material);
  material.customProgramCacheKey = () => prevKey() + "|wind-" + opts.mode;
  return { uniforms };
}
