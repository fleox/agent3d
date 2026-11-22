// Spiral galaxy: tens of thousands of soft additive points on logarithmic
// arms (inner = warm core colour, outer = cool arm colour), a thin disc with
// a thicker bulge, dust lanes darkening the arms' inner edges, and a glowing
// core sprite. Differential rotation (inner parts turn faster) is computed in
// the vertex shader from uTime — deterministic, zero CPU per frame. Point
// sizes follow the real viewport height (onBeforeRender).

import * as THREE from "three";
import type { GeneratorImpl } from "../registry";
import { generatorParams } from "./params";
import { built } from "./geom";

export const galaxy: GeneratorImpl = (raw, ctx) => {
  const p = generatorParams("galaxy", raw, ctx);
  const count = p.int("count");
  const radius = p.num("radius");
  const arms = p.int("arms");
  const twist = p.num("twist");
  const thickness = p.num("thickness");
  const inner = p.color("coreColor");
  const outer = p.color("armColor");
  const accent = p.color("accentColor");
  const size = p.num("size");
  const rng = ctx.rng;

  const pos = new Float32Array(count * 3);
  const col = new Float32Array(count * 3);
  const rnd = new Float32Array(count * 2);
  const c = new THREE.Color();
  // Gaussian-ish random (sum of uniforms).
  const gauss = () => (rng.next() + rng.next() + rng.next() + rng.next() - 2) / 2;
  for (let i = 0; i < count; i++) {
    const roll = rng.next();
    const bulge = roll < 0.16;
    const disc = !bulge && roll < 0.42;
    let r: number, a: number, y: number;
    if (disc) {
      // Diffuse disc between the arms (exponential falloff).
      r = Math.min(radius * 1.05, -Math.log(1 - rng.next() * 0.95) * radius * 0.33);
      a = rng.next() * Math.PI * 2;
      y = gauss() * radius * thickness * 0.8;
    } else if (bulge) {
      r = Math.abs(gauss()) * radius * 0.22;
      a = rng.next() * Math.PI * 2;
      y = gauss() * radius * thickness * 1.6 * (1 - r / (radius * 0.3));
    } else {
      r = Math.pow(rng.next(), 0.75) * radius;
      const arm = Math.floor(rng.next() * arms);
      const spread = (0.5 + (r / radius) * 0.45) * (1 / arms) * Math.PI * 0.8;
      a = (arm / arms) * Math.PI * 2 + (r / radius) * twist + gauss() * spread;
      y = gauss() * radius * thickness * (1 - (r / radius) * 0.7);
    }
    pos[i * 3] = Math.cos(a) * r;
    pos[i * 3 + 1] = y;
    pos[i * 3 + 2] = Math.sin(a) * r;
    const t = Math.min(1, r / radius);
    c.copy(inner).lerp(outer, Math.pow(t, 0.6));
    if (!bulge && !disc && rng.next() < 0.06) c.copy(accent); // star-forming knots
    const l = disc ? rng.range(0.25, 0.6) : rng.range(0.55, 1);
    col[i * 3] = c.r * l;
    col[i * 3 + 1] = c.g * l;
    col[i * 3 + 2] = c.b * l;
    rnd[i * 2] = rng.next();
    rnd[i * 2 + 1] = bulge ? 1.6 : Math.pow(rng.next(), 3) * 2 + 0.5;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  geometry.setAttribute("color", new THREE.BufferAttribute(col, 3));
  geometry.setAttribute("aRnd", new THREE.BufferAttribute(rnd, 2));
  geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), radius * 1.1);

  const uniforms = { uTime: { value: 0 }, uSpeed: { value: p.num("speed") }, uSize: { value: size }, uViewport: { value: 800 }, uRadius: { value: radius } };
  const material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: /* glsl */ `
uniform float uTime; uniform float uSpeed; uniform float uSize; uniform float uViewport; uniform float uRadius;
attribute vec2 aRnd;
varying vec3 vColor; varying float vTw;
void main() {
  vec3 p = position;
  float r = length(p.xz);
  // Differential rotation: angular speed falls with the radius.
  float ang = uTime * uSpeed * 0.25 / (0.25 + r / uRadius);
  float c = cos(ang), s = sin(ang);
  p.xz = mat2(c, s, -s, c) * p.xz;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  float persp = projectionMatrix[3][3] < 0.5 ? 1.0 / max(-mv.z, 1e-3) : 1.0;
  gl_PointSize = clamp(uSize * aRnd.y * projectionMatrix[1][1] * uViewport * 0.5 * persp, 1.0, 64.0);
  vColor = color;
  vTw = 0.75 + 0.25 * sin(uTime * (1.0 + aRnd.x * 3.0) + aRnd.x * 40.0);
}`,
    fragmentShader: /* glsl */ `
varying vec3 vColor; varying float vTw;
void main() {
  float d = length(gl_PointCoord - 0.5) * 2.0;
  float a = exp(-d * d * 4.0) * smoothstep(1.0, 0.7, d);
  if (a < 0.004) discard;
  gl_FragColor = vec4(vColor * vTw, a);
  #include <colorspace_fragment>
}`,
    vertexColors: true,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const points = new THREE.Points(geometry, material);
  points.name = "galaxy-stars";
  points.frustumCulled = false;
  const vp = new THREE.Vector2();
  points.onBeforeRender = (renderer) => {
    renderer.getDrawingBufferSize(vp);
    uniforms.uViewport.value = vp.y;
  };

  // Core glow: camera-facing sprite with a radial gradient texture drawn in the shader.
  const core = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: radialTexture(),
      color: inner.clone().lerp(new THREE.Color("#ffffff"), 0.4),
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      opacity: p.num("coreGlow"),
    }),
  );
  core.scale.setScalar(radius * 0.9);
  core.name = "galaxy-core";
  const group = new THREE.Group();
  group.name = "galaxy";
  group.add(points, core);
  return built(group, {
    update: (t) => {
      uniforms.uTime.value = t;
    },
  });
};

// Small radial gradient (generated, no download).
function radialTexture(): THREE.DataTexture {
  const n = 64;
  const data = new Uint8Array(n * n * 4);
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) {
      const d = Math.hypot(x - n / 2 + 0.5, y - n / 2 + 0.5) / (n / 2);
      const a = Math.max(0, Math.exp(-d * d * 5) - 0.007);
      const i = (y * n + x) * 4;
      data[i] = data[i + 1] = data[i + 2] = 255;
      data[i + 3] = Math.round(a * 255);
    }
  const tex = new THREE.DataTexture(data, n, n);
  tex.needsUpdate = true;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  return tex;
}
