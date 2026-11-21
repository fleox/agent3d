// Sphere of stars around the scene: one Points draw call, soft round sprites
// with per-star colour / size and a deterministic twinkle (uTime).

import * as THREE from "three";
import type { GeneratorImpl } from "../registry";
import { generatorParams } from "./params";
import { built } from "./geom";

export const starfield: GeneratorImpl = (raw, ctx) => {
  const p = generatorParams("starfield", raw, ctx);
  const count = p.int("count");
  const radius = p.num("radius");
  const colors = p.colors("colors");
  const size = p.num("size");
  const twinkle = p.bool("twinkle");
  const rng = ctx.rng;

  const pos = new Float32Array(count * 3);
  const col = new Float32Array(count * 3);
  const extra = new Float32Array(count * 2); // size factor, phase
  for (let i = 0; i < count; i++) {
    // uniform direction on the sphere
    const u = rng.next() * 2 - 1;
    const a = rng.next() * Math.PI * 2;
    const s = Math.sqrt(1 - u * u);
    const r = radius * rng.range(0.85, 1.15);
    pos.set([Math.cos(a) * s * r, u * r, Math.sin(a) * s * r], i * 3);
    const c = rng.pick(colors);
    const l = rng.range(0.6, 1);
    col.set([c.r * l, c.g * l, c.b * l], i * 3);
    // few big bright stars, many small ones
    const big = Math.pow(rng.next(), 4);
    extra.set([0.55 + big * 1.8, rng.next() * 100], i * 2);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  geometry.setAttribute("color", new THREE.BufferAttribute(col, 3));
  geometry.setAttribute("aStar", new THREE.BufferAttribute(extra, 2));
  geometry.computeBoundingSphere();

  const material = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uSize: { value: size }, uTwinkle: { value: twinkle ? 1 : 0 }, uScale: { value: 1300 } },
    vertexShader: /* glsl */ `
uniform float uTime;
uniform float uSize;
uniform float uTwinkle;
uniform float uScale;
attribute vec2 aStar;
varying vec3 vColor;
varying float vAlpha;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  float tw = 1.0 - uTwinkle * 0.55 * (0.5 + 0.5 * sin(uTime * (1.5 + fract(aStar.y) * 2.5) + aStar.y * 6.28));
  vColor = color;
  vAlpha = tw;
  gl_PointSize = max(1.0, uSize * aStar.x * uScale / -mv.z) ;
  gl_Position = projectionMatrix * mv;
}`,
    fragmentShader: /* glsl */ `
varying vec3 vColor;
varying float vAlpha;
void main() {
  vec2 d = gl_PointCoord - 0.5;
  float r = length(d) * 2.0;
  float core = smoothstep(1.0, 0.0, r);
  float a = core * core * vAlpha;
  if (a < 0.01) discard;
  gl_FragColor = vec4(vColor * (0.8 + core * 1.2), a);
  #include <colorspace_fragment>
}`,
    vertexColors: true,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const points = new THREE.Points(geometry, material);
  points.name = "starfield";
  points.frustumCulled = false;
  points.renderOrder = -1;
  const group = new THREE.Group();
  group.name = "starfield";
  group.add(points);
  return built(group, {
    update: (t) => {
      material.uniforms.uTime!.value = t;
    },
  });
};
