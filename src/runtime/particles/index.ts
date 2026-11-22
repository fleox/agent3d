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

const SHAPES: Record<ParticleShape, number> = { point: 0, square: 1, circle: 2, star: 3, spark: 4, heart: 5, bubble: 6, soft: 7, streak: 8, smoke: 9, petal: 10, leaf: 11, ring: 12 };

const VERT = /* glsl */ `
uniform float uTime; uniform vec3 uArea; uniform vec3 uVel; uniform float uSpread; uniform float uLife;
uniform float uWander; uniform float uSize; uniform float uViewport; uniform float uTwinkle; uniform float uSpin; uniform float uOpacity;
uniform vec3 uGravity; uniform vec3 uEndColor; uniform float uUseEnd; uniform float uEndSize; uniform float uStretch; uniform float uSwirl;
attribute vec4 aRand;
attribute vec3 color;
varying vec3 vColor; varying float vAlpha; varying float vRot; varying float vFlip; varying float vStretch; varying float vSeed;
void main() {
  float speed = length(uVel);
  vec3 dir = speed > 0.0 ? uVel / speed : vec3(0.0, 1.0, 0.0);
  vec3 jitter = (aRand.xyz - 0.5) * 2.0 * uSpread;
  vec3 vel = (dir + jitter) * speed * (0.75 + aRand.w * 0.5);
  vec3 hA = uArea * 0.5;
  vec3 p;
  vec3 v = vel;
  float alpha = 1.0;
  float age = 0.0;
  float t = uTime;
  if (uLife > 0.0) {
    age = fract(t / uLife + aRand.w);
    float life = age * uLife;
    p = position * uArea + vel * life + 0.5 * uGravity * life * life;
    v = vel + uGravity * life;
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
  if (uSwirl != 0.0) {
    float r = length(p.xz) / max(hA.x, 1e-3);
    float a = uSwirl * uTime / (0.25 + r);
    float c = cos(a), s = sin(a);
    p.xz = mat2(c, s, -s, c) * p.xz;
  }
  alpha *= 1.0 - uTwinkle * (0.5 + 0.5 * sin(uTime * (1.5 + aRand.x * 4.0) + aRand.y * 6.2831));
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  float s = uSize * (0.6 + aRand.z * 0.8) * mix(1.0, uEndSize, age);
  float persp = projectionMatrix[3][3] < 0.5 ? 1.0 / max(-mv.z, 1e-3) : 1.0;
  float px = s * projectionMatrix[1][1] * uViewport * 0.5 * persp;
  // Velocity stretching: orient the sprite along the projected velocity.
  vStretch = 1.0;
  vRot = uSpin * 6.2831 * uTime * (0.5 + aRand.x) + aRand.y * 6.2831;
  if (uStretch > 1.0) {
    vec4 c2 = projectionMatrix * (modelViewMatrix * vec4(p + v * 0.03, 1.0));
    vec2 d = c2.xy / c2.w - gl_Position.xy / gl_Position.w;
    float aspect = projectionMatrix[1][1] / projectionMatrix[0][0];
    d *= vec2(uViewport * aspect, uViewport) * 0.5;
    vRot = atan(d.y, d.x);
    vStretch = clamp(uStretch * clamp(length(d) / max(px, 1.0), 0.3, 1.0), 1.0, uStretch);
    px *= vStretch;
  }
  gl_PointSize = clamp(px, 1.0, 256.0);
  vColor = mix(color, uEndColor, uUseEnd * smoothstep(0.1, 0.9, age));
  vAlpha = alpha * uOpacity;
  vFlip = cos(uSpin * 6.2831 * uTime * (0.4 + aRand.z) + aRand.w * 6.2831);
  vSeed = aRand.w * 37.0;
}`;

const FRAG = /* glsl */ `
uniform int uShape;
varying vec3 vColor; varying float vAlpha; varying float vRot; varying float vFlip; varying float vStretch; varying float vSeed;
float pHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float pNoise(vec2 p) { vec2 i = floor(p); vec2 f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(pHash(i), pHash(i + vec2(1.0, 0.0)), u.x), mix(pHash(i + vec2(0.0, 1.0)), pHash(i + vec2(1.0, 1.0)), u.x), u.y); }
void main() {
  vec2 uv = gl_PointCoord - 0.5;
  uv.y = -uv.y;
  float c = cos(vRot), s = sin(vRot);
  vec2 r = mat2(c, -s, s, c) * uv;
  float a = 0.0;
  vec3 col = vColor;
  if (uShape == 0) {
    float d = length(uv) * 2.0;
    a = exp(-d * d * 5.0) * smoothstep(1.0, 0.6, d) + smoothstep(0.22, 0.0, d) * 0.6;
  } else if (uShape == 1) {
    vec2 q2 = r;
    q2.x /= max(abs(vFlip), 0.15);
    vec2 q = abs(q2) - vec2(0.32, 0.18);
    a = 1.0 - smoothstep(-0.02, 0.02, max(q.x, q.y));
  } else if (uShape == 2) {
    float d = length(uv);
    a = 1.0 - smoothstep(0.36, 0.5, d);
  } else if (uShape == 3) {
    float c2 = cos(vRot * 0.2), s2 = sin(vRot * 0.2);
    vec2 q = mat2(c2, -s2, s2, c2) * uv;
    float cr = max(smoothstep(0.07, 0.0, abs(q.x)) * smoothstep(0.5, 0.0, abs(q.y)), smoothstep(0.07, 0.0, abs(q.y)) * smoothstep(0.5, 0.0, abs(q.x)));
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
  } else if (uShape == 6) {
    float d = length(uv);
    float ring = smoothstep(0.5, 0.44, d) * smoothstep(0.30, 0.44, d);
    float hl = smoothstep(0.12, 0.0, length(uv - vec2(-0.16, 0.16)));
    a = max(ring * 0.9 + 0.12 * smoothstep(0.5, 0.0, d), hl);
  } else if (uShape == 7) {
    // soft round sprite (gaussian)
    float d = length(uv) * 2.0;
    a = exp(-d * d * 3.5) * smoothstep(1.0, 0.75, d);
  } else if (uShape == 8) {
    // streak: thin capsule along the velocity, bright head, fading tail
    float w = 0.5 / vStretch;
    float body = (1.0 - smoothstep(w * 0.35, w, abs(r.y))) * (1.0 - smoothstep(0.38, 0.5, abs(r.x)));
    a = body * smoothstep(-0.5, 0.35, r.x);
    col += vec3(0.25) * smoothstep(0.2, 0.45, r.x);
  } else if (uShape == 9) {
    // smoke / flame puff: soft blob broken up by rotating noise
    float d = length(uv) * 2.0;
    float n = pNoise(r * 3.2 + vSeed) * 0.65 + pNoise(r * 6.5 - vSeed) * 0.35;
    a = exp(-d * d * 2.6) * smoothstep(1.0, 0.6, d) * (0.45 + 0.75 * n);
  } else if (uShape == 10) {
    // petal: rounded teardrop with a notch, lighter centre
    vec2 q = vec2(r.x / max(abs(vFlip), 0.25), r.y);
    float d = length(vec2(q.x * 1.7, q.y));
    float tip = q.y < 0.0 ? length(vec2(q.x * 1.7 * (1.0 + q.y * 1.4), q.y)) : d;
    float notch = smoothstep(0.06, 0.0, abs(q.x)) * smoothstep(0.32, 0.44, q.y);
    a = (1.0 - smoothstep(0.4, 0.46, tip)) * (1.0 - notch);
    col = mix(col * 1.1 + 0.05, col * 0.85, smoothstep(0.0, 0.45, tip));
  } else if (uShape == 11) {
    // leaf: almond with a midrib
    vec2 q = vec2(r.x / max(abs(vFlip), 0.25), r.y);
    float d = abs(q.x) * 2.1 + q.y * q.y * 1.6;
    a = (1.0 - smoothstep(0.4, 0.45, d)) * (1.0 - smoothstep(0.45, 0.5, abs(q.y)));
    col *= 0.85 + 0.25 * smoothstep(0.0, 0.4, d);
    col *= 1.0 - 0.35 * smoothstep(0.03, 0.0, abs(q.x)) * step(abs(q.y), 0.4);
  } else {
    // ring: bokeh disc with a brighter edge
    float d = length(uv) * 2.0;
    a = (0.55 + 0.3 * smoothstep(0.6, 0.92, d)) * (1.0 - smoothstep(0.82, 1.0, d));
  }
  a *= vAlpha;
  if (a < 0.003) discard;
  gl_FragColor = vec4(col, a);
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
      uShape: { value: SHAPES[p.shape] ?? 7 },
      uGravity: { value: new THREE.Vector3(...p.gravity) },
      uEndColor: { value: p.endColor ? toColor(p.endColor).clone() : new THREE.Color(1, 1, 1) },
      uUseEnd: { value: p.endColor ? 1 : 0 },
      uEndSize: { value: p.endSize },
      uStretch: { value: p.stretch },
      uSwirl: { value: p.swirl },
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
