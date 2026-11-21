// The particle system: THREE.Points + a ShaderMaterial whose vertex shader
// computes every particle position analytically from time (deterministic,
// zero CPU per frame): position = wrap(start + velocity·t + drift(t)) inside
// the area, or a respawning emitter when `lifetime` > 0.

import * as THREE from "three";
import type { ParticlesObjectDef } from "../../core/types";
import type { Rng } from "../registry";
import { colors as toColors, num, toColor, vec3 } from "../util";
import { PARTICLE_DEFAULTS, PARTICLE_PRESET_PARAMS, type ParticleParams, type ParticleShape } from "./presets";

export { PARTICLE_PRESET_PARAMS } from "./presets";

const SHAPES: Record<ParticleShape, number> = { point: 0, square: 1, circle: 2, star: 3, spark: 4, heart: 5, bubble: 6 };

const VERT = /* glsl */ `
uniform float uTime; uniform vec3 uArea; uniform vec3 uVel; uniform float uSpread; uniform float uLife;
uniform float uWander; uniform float uSize; uniform float uViewport; uniform float uTwinkle; uniform float uSpin; uniform float uOpacity;
attribute vec4 aRand;
attribute vec3 color;
varying vec3 vColor; varying float vAlpha; varying float vRot; varying float vFlip;
void main() {
  float speed = length(uVel);
  vec3 dir = speed > 0.0 ? uVel / speed : vec3(0.0, 1.0, 0.0);
  vec3 jitter = (aRand.xyz - 0.5) * 2.0 * uSpread;
  vec3 vel = (dir + jitter) * speed * (0.75 + aRand.w * 0.5);
  vec3 hA = uArea * 0.5;
  vec3 p;
  float alpha = 1.0;
  float t = uTime;
  if (uLife > 0.0) {
    float age = fract(t / uLife + aRand.w);
    float life = age * uLife;
    p = position * uArea + vel * life;
    alpha = smoothstep(0.0, 0.08, age) * (1.0 - smoothstep(0.6, 1.0, age));
    t = life + aRand.x * 50.0;
  } else {
    p = position * uArea + vel * t;
    p = mod(p + hA, max(uArea, vec3(1e-4))) - hA;
  }
  vec3 ph = aRand.xyz * 6.2831;
  p += uWander * vec3(sin(t * (0.5 + aRand.y) + ph.x), 0.6 * sin(t * (0.4 + aRand.z * 0.8) + ph.y), cos(t * (0.45 + aRand.x * 0.7) + ph.z));
  if (uLife <= 0.0) {
    vec3 q = abs(p) / max(hA, vec3(1e-4));
    float edge = max(max(q.x, q.y), q.z);
    alpha *= 1.0 - smoothstep(0.85, 1.0, edge);
  }
  alpha *= 1.0 - uTwinkle * (0.5 + 0.5 * sin(uTime * (1.5 + aRand.x * 4.0) + aRand.y * 6.2831));
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  float s = uSize * (0.6 + aRand.z * 0.8);
  float persp = projectionMatrix[3][3] < 0.5 ? 1.0 / max(-mv.z, 1e-3) : 1.0;
  gl_PointSize = clamp(s * projectionMatrix[1][1] * uViewport * 0.5 * persp, 1.0, 256.0);
  vColor = color;
  vAlpha = alpha * uOpacity;
  vRot = uSpin * 6.2831 * uTime * (0.5 + aRand.x) + aRand.y * 6.2831;
  vFlip = cos(uSpin * 6.2831 * uTime * (0.4 + aRand.z) + aRand.w * 6.2831);
}`;

const FRAG = /* glsl */ `
uniform int uShape;
varying vec3 vColor; varying float vAlpha; varying float vRot; varying float vFlip;
void main() {
  vec2 uv = gl_PointCoord - 0.5;
  uv.y = -uv.y;
  float a = 0.0;
  if (uShape == 0) {
    float d = length(uv) * 2.0;
    a = exp(-d * d * 5.0) * smoothstep(1.0, 0.6, d) + smoothstep(0.22, 0.0, d) * 0.6;
  } else if (uShape == 1) {
    float c = cos(vRot), s = sin(vRot);
    vec2 r = mat2(c, -s, s, c) * uv;
    r.x /= max(abs(vFlip), 0.15);
    vec2 q = abs(r) - vec2(0.32, 0.18);
    a = 1.0 - smoothstep(-0.02, 0.02, max(q.x, q.y));
  } else if (uShape == 2) {
    float d = length(uv);
    a = 1.0 - smoothstep(0.36, 0.5, d);
  } else if (uShape == 3) {
    float c = cos(vRot * 0.2), s = sin(vRot * 0.2);
    vec2 r = mat2(c, -s, s, c) * uv;
    float cr = max(smoothstep(0.07, 0.0, abs(r.x)) * smoothstep(0.5, 0.0, abs(r.y)), smoothstep(0.07, 0.0, abs(r.y)) * smoothstep(0.5, 0.0, abs(r.x)));
    float d = length(uv) * 2.0;
    a = max(cr, exp(-d * d * 10.0));
  } else if (uShape == 4) {
    a = smoothstep(0.1, 0.0, abs(uv.x)) * smoothstep(0.5, 0.1, abs(uv.y));
  } else if (uShape == 5) {
    vec2 h = uv * 2.6;
    h.y += 0.15;
    float x2 = h.x * h.x, y = h.y;
    float f = pow(x2 + y * y - 0.6, 3.0) - x2 * y * y * y * 1.2;
    a = 1.0 - smoothstep(-0.02, 0.02, f);
  } else {
    float d = length(uv);
    float ring = smoothstep(0.5, 0.44, d) * smoothstep(0.30, 0.44, d);
    float hl = smoothstep(0.12, 0.0, length(uv - vec2(-0.16, 0.16)));
    a = max(ring * 0.9 + 0.12 * smoothstep(0.5, 0.0, d), hl);
  }
  a *= vAlpha;
  if (a < 0.003) discard;
  gl_FragColor = vec4(vColor, a);
  #include <colorspace_fragment>
}`;

export function particleParams(def: ParticlesObjectDef): ParticleParams {
  const preset = PARTICLE_PRESET_PARAMS[def.preset ?? ""] ?? {};
  const p: ParticleParams = { ...PARTICLE_DEFAULTS, ...preset };
  if (def.count !== undefined) p.count = Math.max(1, Math.round(def.count));
  if (def.area) p.area = vec3(def.area, p.area);
  if (def.size !== undefined) p.size = def.size;
  if (def.color !== undefined) p.colors = toColors(def.color, p.colors);
  if (def.speed !== undefined) p.speed = def.speed;
  if (def.direction) p.direction = vec3(def.direction, p.direction);
  if (def.spread !== undefined) p.spread = def.spread;
  if (def.lifetime !== undefined) p.lifetime = def.lifetime;
  if (def.opacity !== undefined) p.opacity = def.opacity;
  if (def.blending) p.blending = def.blending;
  if (def.shape) p.shape = def.shape;
  return p;
}

export interface ParticleSystem {
  points: THREE.Points;
  update(t: number): void;
  setViewport(heightPx: number): void;
}

export function createParticles(def: ParticlesObjectDef, rng: Rng): ParticleSystem {
  const p = particleParams(def);
  const n = p.count;
  const pos = new Float32Array(n * 3);
  const rand = new Float32Array(n * 4);
  const col = new Float32Array(n * 3);
  const palette = p.colors.map((c) => toColor(c));
  for (let i = 0; i < n; i++) {
    pos[i * 3] = rng.next() - 0.5;
    pos[i * 3 + 1] = rng.next() - 0.5;
    pos[i * 3 + 2] = rng.next() - 0.5;
    for (let k = 0; k < 4; k++) rand[i * 4 + k] = rng.next();
    const c = palette[Math.floor(rng.next() * palette.length) % palette.length];
    col[i * 3] = c.r;
    col[i * 3 + 1] = c.g;
    col[i * 3 + 2] = c.b;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  geo.setAttribute("aRand", new THREE.BufferAttribute(rand, 4));
  geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
  const dir = new THREE.Vector3(...p.direction);
  if (dir.lengthSq() < 1e-9) dir.set(0, 1, 0);
  dir.normalize().multiplyScalar(p.speed);
  const half = new THREE.Vector3(...p.area).multiplyScalar(0.5);
  geo.boundingBox = new THREE.Box3(half.clone().negate(), half.clone());
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), half.length());
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uArea: { value: new THREE.Vector3(...p.area) },
      uVel: { value: dir },
      uSpread: { value: p.spread },
      uLife: { value: Math.max(0, p.lifetime) },
      uWander: { value: p.wander },
      uSize: { value: p.size },
      uViewport: { value: 600 },
      uTwinkle: { value: p.twinkle },
      uSpin: { value: p.spin },
      uOpacity: { value: num(p.opacity, 1) },
      uShape: { value: SHAPES[p.shape] ?? 0 },
    },
    vertexShader: VERT,
    fragmentShader: FRAG,
    transparent: true,
    depthWrite: false,
    blending: p.blending === "additive" ? THREE.AdditiveBlending : THREE.NormalBlending,
  });
  mat.toneMapped = false;
  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false;
  points.renderOrder = 10;
  return {
    points,
    update(t) {
      mat.uniforms.uTime.value = t;
    },
    setViewport(h) {
      mat.uniforms.uViewport.value = h;
    },
  };
}
