// The "finish" uber pass — always the last pass of the pipeline. It merges
// every cheap per-pixel screen effect into ONE fullscreen draw: chromatic
// aberration, sharpen, colour grading (exposure, white balance, S-curve
// contrast, lift / gamma / gain, split toning, bleach bypass, saturation /
// vibrance), vignette, film grain + scanlines, then sRGB encoding and a
// triangular dither (no banding in gradients). Disabled features are compiled
// out with defines.

import * as THREE from "three";
import { resolveGrading } from "../../core/postfx";
import type { PostFxDef } from "../../core/types";
import { bool, num, toColor } from "../util";
import { fsMaterial, GLSL_COMMON, ShaderFxPass } from "./common";

const FRAG = `
uniform sampler2D tDiffuse; uniform vec2 uRes; uniform float uTime; uniform float uPr;
uniform float uCA; uniform float uCARadial;
uniform float uSharpen;
uniform float uExposure; uniform vec3 uWB; uniform float uContrast; uniform float uSat; uniform float uVib;
uniform float uLift; uniform float uGamma; uniform float uGain; uniform vec3 uShadows; uniform vec3 uHighlights; uniform float uToning; uniform float uBleach;
uniform float uVigOffset; uniform float uVigDark; uniform vec3 uVigColor;
uniform float uGrain; uniform float uGrainSize; uniform float uScan; uniform float uGray;
varying vec2 vUv;
${GLSL_COMMON}
vec3 toSRGB(vec3 c) { c = max(c, 0.0); return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c)); }
float scurve(float x, float k) {
  x = clamp(x, 0.0, 1.0);
  return x < 0.5 ? 0.5 * pow(2.0 * x, k) : 1.0 - 0.5 * pow(2.0 * (1.0 - x), k);
}
void main() {
  vec2 uv = vUv;
  vec4 base = texture2D(tDiffuse, uv);
  vec3 c = base.rgb;
#ifdef CA
  vec2 off = uCARadial > 0.5 ? (uv - 0.5) * 2.0 * uCA : vec2(uCA * 0.825, uCA * 0.565);
  c.r = texture2D(tDiffuse, uv + off).r;
  c.b = texture2D(tDiffuse, uv - off).b;
#endif
#ifdef SHARPEN
  vec2 px = 1.0 / uRes;
  vec3 blur = (texture2D(tDiffuse, uv + vec2(px.x, 0.0)).rgb + texture2D(tDiffuse, uv - vec2(px.x, 0.0)).rgb
             + texture2D(tDiffuse, uv + vec2(0.0, px.y)).rgb + texture2D(tDiffuse, uv - vec2(0.0, px.y)).rgb) * 0.25;
  c = max(c + (c - blur) * uSharpen, 0.0);
#endif
#ifdef GRADE
  c *= uExposure * uWB;
#endif
#ifdef VIGNETTE
  float d = length(uv - 0.5) * 1.4142;
  float v = clamp(uVigDark * 0.65 * smoothstep(0.3 * uVigOffset, 1.1 * uVigOffset, d), 0.0, 1.0);
  c = mix(c, uVigColor * base.a, v);
#endif
  vec3 g = toSRGB(c);
#ifdef GRADE
  if (uContrast != 1.0) g = vec3(scurve(g.r, uContrast), scurve(g.g, uContrast), scurve(g.b, uContrast));
  g = uGain * (g + uLift * (1.0 - g));
  g = pow(max(g, 0.0), vec3(1.0 / uGamma));
  float l = a3dLuma(g);
  g += uToning * 0.6 * ((uShadows - 0.5) * (1.0 - smoothstep(0.0, 0.65, l)) + (uHighlights - 0.5) * smoothstep(0.35, 1.0, l));
  if (uBleach > 0.0) {
    float lb = a3dLuma(g);
    vec3 ov = mix(2.0 * lb * g, 1.0 - 2.0 * (1.0 - lb) * (1.0 - g), step(0.5, lb));
    g = mix(g, ov, uBleach);
  }
  float L = a3dLuma(g);
  float chroma = max(g.r, max(g.g, g.b)) - min(g.r, min(g.g, g.b));
  g = mix(vec3(L), g, uSat * (1.0 + uVib * (1.0 - clamp(chroma, 0.0, 1.0))));
  g = max(g, 0.0);
#endif
#ifdef FILM
  float Lf = a3dLuma(g);
  vec2 cell = floor(gl_FragCoord.xy / (uGrainSize * uPr));
  float t = floor(uTime * 24.0);
  float n = a3dHash12(cell + vec2(t * 13.17, t * 7.31)) + a3dHash12(cell * 1.7 + vec2(t * 3.1, t * 11.9)) - 1.0;
  g += n * uGrain * 0.22 * (1.0 - abs(Lf * 2.0 - 1.0) * 0.6) * base.a;
  if (uScan > 0.0) g *= 1.0 - uScan * 0.35 * (0.5 + 0.5 * sin(gl_FragCoord.y / uPr * 2.0944));
  if (uGray > 0.5) g = vec3(a3dLuma(g));
#endif
  float r1 = a3dHash12(gl_FragCoord.xy + 0.37), r2 = a3dHash12(gl_FragCoord.xy * 1.13 + 17.1);
  g += (r1 + r2 - 1.0) / 255.0 * base.a;
  gl_FragColor = vec4(g, base.a);
}`;

export class FinishPass extends ShaderFxPass {
  private defines: Record<string, string> = {};
  constructor() {
    super(
      fsMaterial(FRAG, {
        tDiffuse: { value: null },
        uRes: { value: new THREE.Vector2(1, 1) },
        uTime: { value: 0 },
        uPr: { value: 1 },
        uCA: { value: 0 },
        uCARadial: { value: 1 },
        uSharpen: { value: 0 },
        uExposure: { value: 1 },
        uWB: { value: new THREE.Vector3(1, 1, 1) },
        uContrast: { value: 1 },
        uSat: { value: 1 },
        uVib: { value: 0 },
        uLift: { value: 0 },
        uGamma: { value: 1 },
        uGain: { value: 1 },
        uShadows: { value: new THREE.Vector3(0.5, 0.5, 0.5) },
        uHighlights: { value: new THREE.Vector3(0.5, 0.5, 0.5) },
        uToning: { value: 0 },
        uBleach: { value: 0 },
        uVigOffset: { value: 1 },
        uVigDark: { value: 1.1 },
        uVigColor: { value: new THREE.Color(0, 0, 0) },
        uGrain: { value: 0 },
        uGrainSize: { value: 1.5 },
        uScan: { value: 0 },
        uGray: { value: 0 },
      }),
    );
  }

  private enable(name: string): void {
    if (name in this.defines) return;
    this.defines[name] = "";
    this.material.defines = { ...this.defines };
    this.material.needsUpdate = true;
  }

  configure(def: PostFxDef): void {
    const u = this.uniforms;
    switch (def.type) {
      case "chromatic":
        u.uCA.value = num(def.amount, 0.002);
        u.uCARadial.value = bool(def.radial, true) ? 1 : 0;
        this.enable("CA");
        break;
      case "sharpen":
        u.uSharpen.value = num(def.amount, 0.3);
        this.enable("SHARPEN");
        break;
      case "vignette":
        u.uVigOffset.value = Math.max(0.01, num(def.offset, 1));
        u.uVigDark.value = num(def.darkness, 1.1);
        u.uVigColor.value = toColor(typeof def.color === "string" ? def.color : "#000000");
        this.enable("VIGNETTE");
        break;
      case "film":
        u.uGrain.value = num(def.intensity, 0.35);
        u.uGray.value = bool(def.grayscale, false) ? 1 : 0;
        u.uScan.value = num(def.scanlines, 0);
        u.uGrainSize.value = Math.max(0.5, num(def.size, 1.5));
        this.enable("FILM");
        break;
      case "grading": {
        const g = resolveGrading(def);
        const n = (k: string, d: number) => (typeof g[k] === "number" ? (g[k] as number) : d);
        u.uExposure.value = Math.pow(2, n("exposure", 0));
        const t = n("temperature", 0), m = n("tint", 0);
        const wb = new THREE.Vector3(1 + 0.22 * t + 0.04 * m, 1 - 0.12 * m, 1 - 0.22 * t + 0.04 * m);
        const lum = wb.x * 0.2126 + wb.y * 0.7152 + wb.z * 0.0722;
        u.uWB.value.copy(wb.multiplyScalar(1 / lum));
        u.uContrast.value = Math.max(0.05, n("contrast", 1));
        u.uSat.value = n("saturation", 1);
        u.uVib.value = n("vibrance", 0);
        u.uLift.value = n("lift", 0);
        u.uGamma.value = Math.max(0.05, n("gamma", 1));
        u.uGain.value = n("gain", 1);
        u.uToning.value = n("toning", 0);
        u.uBleach.value = n("bleach", 0);
        const srgb = (c: unknown, target: THREE.Vector3) => {
          if (typeof c !== "string") return target.set(0.5, 0.5, 0.5);
          const col = toColor(c).clone().convertLinearToSRGB();
          return target.set(col.r, col.g, col.b);
        };
        srgb(g.shadows, u.uShadows.value);
        srgb(g.highlights, u.uHighlights.value);
        this.enable("GRADE");
        break;
      }
    }
  }

  setTime(t: number): void {
    this.uniforms.uTime.value = t;
  }

  override setSize(w: number, h: number): void {
    this.uniforms.uRes.value.set(w, h);
  }

  setPixelRatio(pr: number): void {
    this.uniforms.uPr.value = pr;
  }
}
