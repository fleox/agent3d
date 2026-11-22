// Banner / backdrop shaders: gradientMesh, aurora, liquidChrome, nebula,
// caustics, fresnelGlow, iridescentFoil, lavaLamp, grainGradient, matrixRain.
// All deterministic in uTime (pure functions of t), written for this project.

import * as THREE from "three";
import type { ShaderImpl } from "../registry";
import { colorsUniform, make, OUT, PALETTE_FN } from "./common";
import { MESH_GRADIENT_GLSL } from "./meshGradient.glsl";
import { GLSL_NOISE } from "./noise.glsl";

const HASH = /* glsl */ `
float h21(vec2 p) { vec3 q = fract(vec3(p.xyx) * 0.1031); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }
vec2 h22(vec2 p) { vec3 q = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973)); q += dot(q, q.yzx + 33.33); return fract((q.xx + q.yz) * q.zy); }
`;

const gradientMesh = make(
  "gradientMesh",
  /* glsl */ `
uniform float uTime;
uniform float uSpeed;
uniform float uGrain;
varying vec2 vUv;
${GLSL_NOISE}
${MESH_GRADIENT_GLSL}
void main() {
  float t = uTime * uSpeed;
  vec3 col = meshGradient((vUv - 0.5) * 1.6, t);
  col += mgGrain(gl_FragCoord.xy, uTime) * uGrain;
  gl_FragColor = vec4(col, 1.0);
  ${OUT}
}`,
  (p) => {
    const cu = colorsUniform(p.colors("colors"));
    return { ...cu, uMgColors: cu.uColors, uMgCount: cu.uCount, uMgScale: { value: p.num("scale") }, uMgSeed: { value: 1 }, uMgSpread: { value: new THREE.Vector2(1, 1) }, uSpeed: { value: p.num("speed") }, uGrain: { value: p.num("grain") } };
  },
  { colors: "uColors", speed: "uSpeed", scale: "uMgScale", grain: "uGrain" },
  { toneMapped: false },
);

const aurora = make(
  "aurora",
  /* glsl */ `
uniform float uTime;
uniform float uSpeed;
uniform float uIntensity;
uniform vec3 uBg;
varying vec2 vUv;
${GLSL_NOISE}
${PALETTE_FN}
${HASH}
void main() {
  float t = uTime * uSpeed;
  vec2 uv = vUv;
  vec3 col = uBg * (0.6 + 0.4 * uv.y);
  // Stars
  vec2 sc = floor(uv * vec2(220.0, 90.0));
  float s = h21(sc);
  if (s > 0.985) col += vec3(smoothstep(0.35, 0.0, length(fract(uv * vec2(220.0, 90.0)) - 0.5))) * (s - 0.985) * 40.0 * (0.6 + 0.4 * sin(uTime * 2.0 + s * 50.0));
  for (int i = 0; i < 3; i++) {
    float fi = float(i);
    float line = 0.42 + fi * 0.1 + 0.13 * snoise(vec3(uv.x * 1.3 + fi * 3.1, t * 0.25 + fi, fi * 7.0)) + 0.05 * snoise(vec3(uv.x * 4.0, t * 0.4, fi));
    float d = uv.y - line;
    float shape = d > 0.0 ? exp(-d * (5.0 + fi * 2.0)) : exp(d * 45.0);
    float rays = 0.45 + 0.55 * smoothstep(-0.3, 0.8, snoise(vec3(uv.x * 26.0 + fi * 11.0, t * 0.6, fi * 2.0)));
    float fade = smoothstep(0.0, 0.25, uv.x) * smoothstep(1.0, 0.75, uv.x) * 0.6 + 0.4;
    vec3 c = palette(clamp(fi / 2.0 + d * 1.5, 0.0, 1.0));
    col += c * shape * rays * fade * uIntensity * 0.55;
  }
  gl_FragColor = vec4(col, 1.0);
  ${OUT}
}`,
  (p) => ({ ...colorsUniform(p.colors("colors")), uSpeed: { value: p.num("speed") }, uIntensity: { value: p.num("intensity") }, uBg: { value: p.color("background") } }),
  { colors: "uColors", speed: "uSpeed", intensity: "uIntensity", background: "uBg" },
);

const liquidChrome = make(
  "liquidChrome",
  /* glsl */ `
uniform float uTime;
uniform float uSpeed;
uniform float uScale;
varying vec2 vUv;
varying vec3 vNormalV;
varying vec3 vViewDir;
${GLSL_NOISE}
${PALETTE_FN}
float field(vec2 p, float t) {
  vec2 q = vec2(snoise(vec3(p * 0.8, t)), snoise(vec3(p * 0.8 + 5.2, t * 1.1)));
  return snoise(vec3(p + q * 1.2, t * 0.6)) * 0.6 + snoise(vec3(p * 2.0 - q, t * 0.8)) * 0.25;
}
void main() {
  float t = uTime * uSpeed;
  vec2 p = (vUv - 0.5) * 3.0 * uScale;
  float e = 0.02;
  float h = field(p, t);
  float hx = field(p + vec2(e, 0.0), t) - h;
  float hy = field(p + vec2(0.0, e), t) - h;
  vec3 n = normalize(vec3(-hx / e * 0.35, -hy / e * 0.35, 1.0));
  // Bend by the mesh normal so curved surfaces read as curved.
  n = normalize(n + vec3(vNormalV.xy, 0.0) * 0.6);
  vec3 r = reflect(vec3(0.0, 0.0, -1.0), n);
  float k = clamp(r.y * 0.55 + 0.5 + h * 0.18, 0.0, 1.0);
  vec3 col = palette(k);
  // Studio horizon line: wider, softer and antialiased (its width never drops
  // under ~1.5 px of r.y change, so steep normals don't alias into hairlines).
  float hw = 0.035 + fwidth(r.y) * 1.5;
  float horizon = (1.0 - smoothstep(0.0, hw, abs(r.y + 0.05))) * 0.45;
  float spec = pow(max(dot(r, normalize(vec3(0.35, 0.6, 0.7))), 0.0), 60.0) * 2.0;
  col += vec3(horizon + spec);
  gl_FragColor = vec4(col, 1.0);
  ${OUT}
}`,
  (p) => ({ ...colorsUniform(p.colors("colors")), uSpeed: { value: p.num("speed") }, uScale: { value: p.num("scale") } }),
  { colors: "uColors", speed: "uSpeed", scale: "uScale" },
);

const nebula = make(
  "nebula",
  /* glsl */ `
uniform float uTime;
uniform float uSpeed;
uniform float uStars;
uniform float uScale;
varying vec2 vUv;
${GLSL_NOISE}
${PALETTE_FN}
${HASH}
float stars(vec2 uv, float density, float seed) {
  vec2 g = uv * density;
  vec2 id = floor(g);
  vec2 off = h22(id + seed) - 0.5;
  float b = h21(id + seed * 3.1);
  float d = length(fract(g) - 0.5 - off * 0.7);
  return smoothstep(0.08 + b * 0.06, 0.0, d) * step(0.72, b) * (0.5 + b);
}
void main() {
  float t = uTime * uSpeed;
  vec2 p = (vUv - 0.5) * 1.3 * uScale;
  vec2 w = vec2(fbm(vec3(p, t)), fbm(vec3(p + 4.3, t * 1.2)));
  float n = fbm(vec3(p + w * 1.6, t * 0.5));
  float n2 = fbm(vec3(p * 2.2 - w, t * 0.7 + 3.0));
  float gas = smoothstep(-0.35, 0.75, n);
  vec3 col = palette(clamp(gas * 0.85 + n2 * 0.2, 0.0, 1.0)) * (0.25 + gas * 1.1);
  col += palette(1.0) * pow(max(n2, 0.0), 3.0) * 0.8;
  col *= 0.9 + 0.1 * smoothstep(-0.5, 0.5, n2);
  float st = stars(vUv + t * 0.02, 90.0, 1.0) + stars(vUv * 1.7 + t * 0.01, 140.0, 7.0) * 0.6 + stars(vUv, 40.0, 13.0) * 1.4;
  col += vec3(st) * uStars * (0.8 + 0.2 * sin(uTime * 3.0 + vUv.x * 60.0));
  gl_FragColor = vec4(col, 1.0);
  ${OUT}
}`,
  (p) => ({ ...colorsUniform(p.colors("colors")), uSpeed: { value: p.num("speed") }, uStars: { value: p.num("stars") }, uScale: { value: p.num("scale") } }),
  { colors: "uColors", speed: "uSpeed", stars: "uStars", scale: "uScale" },
);

const caustics = make(
  "caustics",
  /* glsl */ `
uniform float uTime;
uniform float uSpeed;
uniform float uScale;
uniform float uIntensity;
uniform vec3 uColor;
uniform vec3 uBg;
varying vec2 vUv;
${GLSL_NOISE}
${HASH}
// Animated Voronoi: thin bright lines where two cells meet.
float cells(vec2 p, float t) {
  vec2 ip = floor(p);
  vec2 fp = fract(p);
  float f1 = 8.0, f2 = 8.0;
  for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
    vec2 g = vec2(float(i), float(j));
    vec2 o = h22(ip + g);
    o = 0.5 + 0.45 * sin(t + 6.2831 * o);
    float d = length(g + o - fp);
    if (d < f1) { f2 = f1; f1 = d; } else if (d < f2) f2 = d;
  }
  return f2 - f1;
}
void main() {
  float t = uTime * uSpeed;
  vec2 p = vUv * uScale * 2.0;
  p += 0.15 * vec2(snoise(vec3(p * 0.6, t * 0.3)), snoise(vec3(p * 0.6 + 9.0, t * 0.3)));
  float a = cells(p, t * 1.3);
  float b = cells(p * 1.35 + 3.7, -t * 1.1);
  float c = pow(smoothstep(0.22, 0.0, a), 2.5) + pow(smoothstep(0.18, 0.0, b), 2.5) * 0.7;
  vec3 col = uBg * (0.85 + 0.15 * snoise(vec3(vUv * 3.0, t * 0.2)));
  col += uColor * c * uIntensity;
  gl_FragColor = vec4(col, 1.0);
  ${OUT}
}`,
  (p) => ({ uSpeed: { value: p.num("speed") }, uScale: { value: p.num("scale") }, uIntensity: { value: p.num("intensity") }, uColor: { value: p.color("color") }, uBg: { value: p.color("background") } }),
  { speed: "uSpeed", scale: "uScale", intensity: "uIntensity", color: "uColor", background: "uBg" },
);

const fresnelGlow = make(
  "fresnelGlow",
  /* glsl */ `
uniform float uTime;
uniform float uPower;
uniform float uIntensity;
uniform float uPulse;
uniform vec3 uColor;
uniform vec3 uCore;
varying vec3 vNormalV;
varying vec3 vViewDir;
void main() {
  vec3 n = normalize(vNormalV);
  if (!gl_FrontFacing) n = -n;
  float f = pow(1.0 - clamp(abs(dot(n, normalize(vViewDir))), 0.0, 1.0), uPower);
  float pulse = uPulse > 0.0 ? 0.8 + 0.2 * sin(uTime * uPulse * 6.2831) : 1.0;
  vec3 col = uCore + uColor * f * uIntensity * pulse;
  gl_FragColor = vec4(col, 1.0);
  ${OUT}
}`,
  (p) => ({ uPower: { value: p.num("power") }, uIntensity: { value: p.num("intensity") }, uPulse: { value: p.num("pulse") }, uColor: { value: p.color("color") }, uCore: { value: p.color("core") } }),
  { power: "uPower", intensity: "uIntensity", pulse: "uPulse", color: "uColor", core: "uCore" },
  { transparent: true, blending: THREE.AdditiveBlending, depthWrite: false },
);

const iridescentFoil = make(
  "iridescentFoil",
  /* glsl */ `
uniform float uTime;
uniform float uSpeed;
uniform float uScale;
uniform float uSparkle;
uniform vec3 uTint;
varying vec2 vUv;
varying vec3 vNormalV;
varying vec3 vViewDir;
${GLSL_NOISE}
${HASH}
vec3 hsv(float h, float s, float v) { vec3 k = clamp(abs(fract(h + vec3(0.0, 2.0 / 3.0, 1.0 / 3.0)) * 6.0 - 3.0) - 1.0, 0.0, 1.0); return v * mix(vec3(1.0), k, s); }
void main() {
  float t = uTime * uSpeed;
  vec3 n = normalize(vNormalV);
  vec3 v = normalize(vViewDir);
  float ndv = dot(n, v);
  float wob = snoise(vec3(vUv * 3.0, t * 0.5)) * 0.25;
  float hue = fract(ndv * uScale * 0.6 + vUv.x * 0.35 * uScale + vUv.y * 0.2 + t * 0.15 + wob);
  vec3 col = hsv(hue, 0.5, 1.0) * uTint;
  col *= 0.65 + 0.35 * pow(1.0 - abs(ndv), 0.5);
  vec2 g = vUv * 180.0;
  vec2 id = floor(g);
  float r = h21(id);
  float tw = pow(max(sin(uTime * (2.0 + r * 5.0) + r * 40.0 + ndv * 20.0), 0.0), 16.0);
  col += vec3(step(1.0 - uSparkle * 0.25, r) * tw * smoothstep(0.5, 0.0, length(fract(g) - 0.5)) * 2.0);
  float spec = pow(max(dot(reflect(-v, n), normalize(vec3(0.4, 0.7, 0.6))), 0.0), 30.0);
  col += spec * 0.6;
  gl_FragColor = vec4(col, 1.0);
  ${OUT}
}`,
  (p) => ({ uSpeed: { value: p.num("speed") }, uScale: { value: p.num("scale") }, uSparkle: { value: p.num("sparkle") }, uTint: { value: p.color("tint") } }),
  { speed: "uSpeed", scale: "uScale", sparkle: "uSparkle", tint: "uTint" },
);

const lavaLamp = make(
  "lavaLamp",
  /* glsl */ `
uniform float uTime;
uniform float uSpeed;
uniform float uScale;
varying vec2 vUv;
${PALETTE_FN}
float hash1(float n) { return fract(sin(n * 127.1) * 43758.5453); }
void main() {
  float t = uTime * uSpeed;
  vec2 uv = vUv;
  float f = 0.0;
  for (int i = 0; i < 9; i++) {
    float fi = float(i);
    float sp = 0.05 + hash1(fi) * 0.08;
    vec2 c = vec2(0.15 + 0.7 * hash1(fi + 3.3) + 0.08 * sin(t * (0.7 + hash1(fi + 1.1)) + fi), fract(hash1(fi + 7.7) + t * sp) * 1.5 - 0.25);
    float r = (0.08 + 0.07 * hash1(fi + 5.5)) * uScale;
    vec2 d = (uv - c) * vec2(1.6, 1.0);
    f += r * r / max(dot(d, d), 1e-4);
  }
  float blob = smoothstep(0.85, 1.15, f);
  vec3 bg = palette(0.0) * (0.7 + 0.3 * uv.y);
  vec3 bc = mix(palette(0.5), palette(1.0), clamp(uv.y + (f - 1.0) * 0.08, 0.0, 1.0));
  vec3 col = mix(bg, bc, blob) + palette(0.5) * clamp(f, 0.0, 1.0) * 0.18 * (1.0 - blob);
  col += vec3(1.0, 0.9, 0.8) * smoothstep(1.4, 3.0, f) * 0.15;
  gl_FragColor = vec4(col, 1.0);
  ${OUT}
}`,
  (p) => ({ ...colorsUniform(p.colors("colors")), uSpeed: { value: p.num("speed") }, uScale: { value: p.num("scale") } }),
  { colors: "uColors", speed: "uSpeed", scale: "uScale" },
);

const grainGradient = make(
  "grainGradient",
  /* glsl */ `
uniform float uTime;
uniform float uAngle;
uniform float uGrain;
uniform float uSpeed;
varying vec2 vUv;
${GLSL_NOISE}
${PALETTE_FN}
${HASH}
void main() {
  float a = radians(uAngle);
  vec2 dir = vec2(sin(a), cos(a));
  float g = dot(vUv - 0.5, dir) + 0.5;
  g += snoise(vec3(vUv * 1.5, 0.3 + uTime * uSpeed * 0.05)) * 0.08;
  vec3 col = palette(clamp(g, 0.0, 1.0));
  float n = h21(gl_FragCoord.xy + floor(uTime * uSpeed * 24.0) * 17.0) - 0.5;
  col += n * uGrain;
  gl_FragColor = vec4(col, 1.0);
  ${OUT}
}`,
  (p) => ({ ...colorsUniform(p.colors("colors")), uAngle: { value: p.num("angle") }, uGrain: { value: p.num("grain") }, uSpeed: { value: p.num("speed") } }),
  { colors: "uColors", angle: "uAngle", grain: "uGrain", speed: "uSpeed" },
  { toneMapped: false },
);

const matrixRain = make(
  "matrixRain",
  /* glsl */ `
uniform float uTime;
uniform float uSpeed;
uniform float uColumns;
uniform vec3 uColor;
uniform vec3 uBg;
varying vec2 vUv;
${HASH}
void main() {
  float cols = floor(uColumns);
  vec2 grid = vec2(cols, cols * 1.4);
  vec2 g = vUv * grid;
  vec2 cell = floor(g);
  vec2 f = fract(g);
  float colSeed = h21(vec2(cell.x, 3.7));
  float speed = (0.35 + colSeed * 0.65) * uSpeed;
  float head = fract(colSeed * 7.3 + uTime * speed * 0.35);
  float y = 1.0 - (cell.y + 0.5) / grid.y;
  float behind = fract(y - head + 1.0);
  float trail = exp(-behind * 7.0) * step(behind, 0.6);
  // 5x7 glyph from a hash, changing a few times per second.
  float tick = floor(uTime * (2.0 + colSeed * 6.0) + h21(cell) * 10.0);
  vec2 px = floor(f * vec2(5.0, 7.0));
  float on = step(0.5, h21(cell * 13.1 + px * 1.7 + tick));
  float inside = step(0.08, f.x) * step(f.x, 0.92) * step(0.06, f.y) * step(f.y, 0.94);
  float glyph = on * inside;
  float headGlow = smoothstep(0.035, 0.0, behind);
  vec3 col = uBg + uColor * glyph * trail * 1.2 + vec3(0.85, 1.0, 0.9) * glyph * headGlow * 1.5;
  gl_FragColor = vec4(col, 1.0);
  ${OUT}
}`,
  (p) => ({ uSpeed: { value: p.num("speed") }, uColumns: { value: p.num("columns") }, uColor: { value: p.color("color") }, uBg: { value: p.color("background") } }),
  { speed: "uSpeed", columns: "uColumns", color: "uColor", background: "uBg" },
);

export const EXTRA_SHADERS: Record<string, ShaderImpl> = { gradientMesh, aurora, liquidChrome, nebula, caustics, fresnelGlow, iridescentFoil, lavaLamp, grainGradient, matrixRain };
