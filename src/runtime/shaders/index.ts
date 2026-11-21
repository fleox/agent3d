// Shader material registry: one ShaderImpl per SHADERS catalog id. Every
// material has a `uTime` uniform advanced by update(t) (pure function of t).
// Params (MaterialDef.uniforms merged over catalog defaults) map to uniforms;
// change them later with `material.userData.setParam(name, value)` (the
// timeline animating `uniforms.progress` of "dissolve", for instance).

import * as THREE from "three";
import type { BuildContext, ShaderImpl } from "../registry";
import { shaderParams, type Params } from "../generators/params";
import { GLSL_NOISE } from "./noise.glsl";

const MAX_COLORS = 6;

const VERT = /* glsl */ `
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

const PALETTE_FN = /* glsl */ `
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

const OUT = /* glsl */ `
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
`;

type UniformMap = Record<string, THREE.IUniform>;

function colorsUniform(list: THREE.Color[]): { uColors: THREE.IUniform; uCount: THREE.IUniform } {
  const arr = Array.from({ length: MAX_COLORS }, (_, k) => (list[Math.min(k, list.length - 1)] ?? new THREE.Color("#ffffff")).clone());
  return { uColors: { value: arr }, uCount: { value: Math.max(1, Math.min(MAX_COLORS, list.length)) } };
}

// Builds a ShaderImpl from a fragment body and a param → uniform binding.
function make(
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
          const p2 = shaderParams(id, { colors: value }, ctx);
          Object.assign(uniforms, colorsUniform(p2.colors("colors")));
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

const plasma = make(
  "plasma",
  /* glsl */ `
uniform float uTime;
uniform float uSpeed;
uniform float uScale;
varying vec2 vUv;
varying vec3 vNormalV;
varying vec3 vViewDir;
${PALETTE_FN}
void main() {
  vec2 p = (vUv - 0.5) * 6.0 * uScale;
  float t = uTime * uSpeed;
  float v = sin(p.x + t);
  v += sin((p.y + t) * 0.5);
  v += sin((p.x + p.y + t) * 0.5);
  vec2 c = p + 0.5 * vec2(sin(t / 5.0), cos(t / 3.0)) * 3.0;
  v += sin(sqrt(c.x * c.x + c.y * c.y + 1.0) + t);
  vec3 col = paletteCycle(v * 0.125 + 0.5 + t * 0.03);
  float rim = pow(1.0 - abs(dot(normalize(vNormalV), normalize(vViewDir))), 3.0);
  gl_FragColor = vec4(col + rim * 0.15, 1.0);
  ${OUT}
}`,
  (p) => ({ ...colorsUniform(p.colors("colors")), uSpeed: { value: p.num("speed") }, uScale: { value: p.num("scale") } }),
  { colors: "uColors", speed: "uSpeed", scale: "uScale" },
);

const waves = make(
  "waves",
  /* glsl */ `
uniform float uTime;
uniform float uSpeed;
uniform float uFreq;
uniform vec3 uA;
uniform vec3 uB;
varying vec2 vUv;
void main() {
  float t = uTime * uSpeed;
  float y = vUv.y + sin(vUv.x * 6.2831 * 1.5 + t * 1.3) * 0.05 + sin(vUv.x * 6.2831 * 0.5 - t * 0.7) * 0.04;
  float s = sin(y * uFreq * 6.2831 - t * 2.0);
  float band = smoothstep(-0.25, 0.25, s);
  vec3 col = mix(uA, uB, band);
  col *= 0.9 + 0.1 * sin(y * uFreq * 3.1415 + t);
  gl_FragColor = vec4(col, 1.0);
  ${OUT}
}`,
  (p) => {
    const cs = p.colors("colors");
    return { uSpeed: { value: p.num("speed") }, uFreq: { value: p.num("frequency") }, uA: { value: cs[0]! }, uB: { value: cs[1] ?? cs[0]!.clone() } };
  },
  { speed: "uSpeed", frequency: "uFreq" },
);

const noise = make(
  "noise",
  /* glsl */ `
uniform float uTime;
uniform float uSpeed;
uniform float uScale;
varying vec3 vPos;
varying vec2 vUv;
${GLSL_NOISE}
${PALETTE_FN}
void main() {
  float t = uTime * uSpeed;
  vec3 q = vPos * uScale;
  vec3 w = vec3(fbm(q + vec3(0.0, 0.0, t)), fbm(q + vec3(5.2, 1.3, -t)), 0.0);
  float n = fbm(q + w * 1.5 + vec3(t * 0.3));
  gl_FragColor = vec4(palette(n * 0.5 + 0.5), 1.0);
  ${OUT}
}`,
  (p) => ({ ...colorsUniform(p.colors("colors")), uSpeed: { value: p.num("speed") }, uScale: { value: p.num("scale") } }),
  { colors: "uColors", speed: "uSpeed", scale: "uScale" },
);

const hologram = make(
  "hologram",
  /* glsl */ `
uniform float uTime;
uniform float uSpeed;
uniform float uLines;
uniform vec3 uColor;
varying vec3 vNormalV;
varying vec3 vViewDir;
varying vec3 vPos;
float hash(float x) { return fract(sin(x * 91.17) * 43758.5453); }
void main() {
  float t = uTime * uSpeed;
  float fres = pow(1.0 - abs(dot(normalize(vNormalV), normalize(vViewDir))), 2.0);
  float lines = 0.55 + 0.45 * sin((vPos.y * uLines - t * 4.0) * 3.14159);
  float band = smoothstep(0.0, 0.08, fract(vPos.y * 0.6 - t * 0.35)) * (1.0 - smoothstep(0.08, 0.2, fract(vPos.y * 0.6 - t * 0.35)));
  float flicker = 0.92 + 0.08 * hash(floor(t * 18.0));
  float a = (0.12 + fres * 0.9) * lines * flicker + band * 0.35;
  vec3 col = uColor * (0.6 + fres * 1.2) + band * 0.4;
  gl_FragColor = vec4(col * a, a);
  ${OUT}
}`,
  (p) => ({ uColor: { value: p.color("color") }, uSpeed: { value: p.num("speed") }, uLines: { value: p.num("lines") / 10 } }),
  { color: "uColor", speed: "uSpeed", lines: "uLines" },
  { transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide },
);

const gradientFlow = make(
  "gradientFlow",
  /* glsl */ `
uniform float uTime;
uniform float uSpeed;
varying vec2 vUv;
varying vec3 vNormalV;
varying vec3 vViewDir;
${GLSL_NOISE}
${PALETTE_FN}
void main() {
  float t = uTime * uSpeed;
  vec2 p = vUv * 1.6;
  float n = snoise(vec3(p * 1.2, t * 0.5)) * 0.5 + snoise(vec3(p * 2.4 + 3.0, t * 0.7)) * 0.25;
  float g = vUv.x * 0.55 + vUv.y * 0.35 + n * 0.45 + t * 0.08 + dot(vNormalV, vec3(0.2, 0.3, 0.0));
  vec3 col = paletteCycle(g);
  float rim = pow(1.0 - abs(dot(normalize(vNormalV), normalize(vViewDir))), 2.5);
  gl_FragColor = vec4(col + rim * 0.08, 1.0);
  ${OUT}
}`,
  (p) => ({ ...colorsUniform(p.colors("colors")), uSpeed: { value: p.num("speed") } }),
  { colors: "uColors", speed: "uSpeed" },
);

const toonRim = make(
  "toonRim",
  /* glsl */ `
uniform float uTime;
uniform vec3 uColor;
uniform vec3 uRim;
uniform float uSteps;
uniform vec3 uLightDir;
varying vec3 vNormalV;
varying vec3 vViewDir;
void main() {
  vec3 n = normalize(vNormalV);
  vec3 l = normalize((viewMatrix * vec4(uLightDir, 0.0)).xyz);
  float d = max(dot(n, l), 0.0);
  float q = floor(d * uSteps + 0.5) / uSteps;
  vec3 shadow = uColor * vec3(0.42, 0.4, 0.55);
  vec3 col = mix(shadow, uColor, q);
  vec3 h = normalize(l + normalize(vViewDir));
  float spec = step(0.94, dot(n, h));
  float rim = smoothstep(0.62, 0.72, 1.0 - max(dot(n, normalize(vViewDir)), 0.0)) * (0.35 + 0.65 * d);
  col = mix(col, uRim, rim * 0.85) + spec * 0.25;
  gl_FragColor = vec4(col, 1.0);
  ${OUT}
}`,
  (p) => ({ uColor: { value: p.color("color") }, uRim: { value: p.color("rim") }, uSteps: { value: p.int("steps") }, uLightDir: { value: new THREE.Vector3(0.5, 0.85, 0.6).normalize() } }),
  { color: "uColor", rim: "uRim", steps: "uSteps" },
);

const dissolve = make(
  "dissolve",
  /* glsl */ `
uniform float uTime;
uniform vec3 uColor;
uniform vec3 uEdge;
uniform float uProgress;
varying vec3 vPos;
varying vec3 vNormalV;
varying vec3 vViewDir;
${GLSL_NOISE}
void main() {
  float n = fbm(vPos * 2.2) * 0.5 + 0.5;
  float p = uProgress * 1.15 - 0.075;
  if (n < p) discard;
  float e = 1.0 - smoothstep(0.0, 0.06, n - p);
  vec3 nn = normalize(vNormalV);
  if (!gl_FrontFacing) nn = -nn;
  vec3 l = normalize(vec3(0.4, 0.8, 0.6));
  float d = max(dot(nn, l), 0.0) * 0.75 + 0.3;
  vec3 col = uColor * d;
  col = mix(col, uEdge * 2.2, e * step(0.001, uProgress));
  gl_FragColor = vec4(col, 1.0);
  ${OUT}
}`,
  (p) => ({ uColor: { value: p.color("color") }, uEdge: { value: p.color("edge") }, uProgress: { value: p.num("progress") } }),
  { color: "uColor", edge: "uEdge", progress: "uProgress" },
  { side: THREE.DoubleSide },
);

export const SHADER_IMPLS: Record<string, ShaderImpl> = { plasma, waves, noise, hologram, gradientFlow, toonRim, dissolve };
