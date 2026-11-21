// Animated low-poly water: vertex waves (pure function of uTime) on a
// MeshStandardMaterial patched with onBeforeCompile — faceted shading from
// derivatives, crest colour (shallowColor), fresnel tint, scene lights + fog.

import * as THREE from "three";
import type { GeneratorImpl } from "../registry";
import { generatorParams } from "./params";
import { built } from "./geom";

// Same formula as the GLSL below (CPU side for heightAt: floating objects).
export function waveHeight(x: number, z: number, t: number, amp: number, speed: number): number {
  const s = t * speed;
  return amp * (Math.sin(x * 0.55 + s * 1.1) * 0.5 + Math.sin(z * 0.7 - s * 0.9 + 1.3) * 0.35 + Math.sin((x + z) * 1.25 + s * 1.9) * 0.2 + Math.sin((x - z) * 2.1 - s * 2.4) * 0.1);
}

export const water: GeneratorImpl = (raw, ctx) => {
  const p = generatorParams("water", raw, ctx);
  const size = p.num("size");
  const amp = p.num("waveHeight");
  const speed = p.num("waveSpeed");
  const opacity = p.num("opacity");
  const segs = Math.max(8, Math.min(100, Math.round(size * 2.5)));
  const geometry = new THREE.PlaneGeometry(size, size, segs, segs);
  geometry.rotateX(-Math.PI / 2);

  const uniforms = {
    uTime: { value: 0 },
    uAmp: { value: amp },
    uSpeed: { value: speed },
    uShallow: { value: p.color("shallowColor") },
  };
  const material = new THREE.MeshStandardMaterial({ color: p.color("color"), roughness: 0.18, metalness: 0.05, flatShading: true, transparent: opacity < 1, opacity, depthWrite: opacity >= 1 });
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader =
      /* glsl */ `
uniform float uTime;
uniform float uAmp;
uniform float uSpeed;
varying float vWaveH;
float waveH(vec2 p, float t) {
  float s = t * uSpeed;
  return uAmp * (sin(p.x * 0.55 + s * 1.1) * 0.5 + sin(p.y * 0.7 - s * 0.9 + 1.3) * 0.35 + sin((p.x + p.y) * 1.25 + s * 1.9) * 0.2 + sin((p.x - p.y) * 2.1 - s * 2.4) * 0.1);
}
` +
      shader.vertexShader.replace(
        "#include <begin_vertex>",
        /* glsl */ `#include <begin_vertex>
float hh = waveH(position.xz, uTime);
transformed.y += hh;
vWaveH = hh / max(uAmp, 1e-4);
`,
      );
    shader.fragmentShader =
      /* glsl */ `
uniform vec3 uShallow;
varying float vWaveH;
` +
      shader.fragmentShader.replace(
        "#include <color_fragment>",
        /* glsl */ `#include <color_fragment>
{
  vec3 fn = normalize(cross(dFdx(vViewPosition), dFdy(vViewPosition)));
  float fres = pow(1.0 - abs(dot(fn, normalize(vViewPosition))), 2.5);
  float crest = smoothstep(-0.2, 1.0, vWaveH);
  diffuseColor.rgb = mix(diffuseColor.rgb, uShallow, clamp(crest * 0.75 + fres * 0.35, 0.0, 1.0));
  diffuseColor.a = mix(diffuseColor.a, 1.0, fres * 0.5);
}
`,
      );
  };
  material.customProgramCacheKey = () => "agent3d-water";
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = "water";
  mesh.receiveShadow = true;
  // Displacement happens on the GPU: enlarge bounds so culling stays correct.
  geometry.computeBoundingBox();
  geometry.boundingBox!.min.y = -amp * 1.2;
  geometry.boundingBox!.max.y = amp * 1.2;
  geometry.computeBoundingSphere();
  const group = new THREE.Group();
  group.name = "water";
  group.userData.surface = "water";
  group.add(mesh);
  let time = 0;
  return built(group, {
    update: (t) => {
      time = t;
      uniforms.uTime.value = t;
    },
    heightAt: (x, z) => waveHeight(x, z, time, amp, speed),
  });
};
