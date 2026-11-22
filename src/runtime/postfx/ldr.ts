// Display-referred effects (after tone mapping, linear 0…1): antialiasing
// (fxaa, smaa) and the stylised looks (tiltshift, pixelate, halftone, ascii,
// glitch), in the declared order.

import * as THREE from "three";
import { FullScreenQuad, Pass } from "three/addons/postprocessing/Pass.js";
import { SMAAPass } from "three/addons/postprocessing/SMAAPass.js";
import { FXAAShader } from "three/addons/shaders/FXAAShader.js";
import type { PostFxDef } from "../../core/types";
import { bool, num, toColor } from "../util";
import { type EffectHandle, type FxRuntime, fsMaterial, GLSL_COMMON, halfTarget, ShaderFxPass } from "./common";

// ─── Antialiasing ──────────────────────────────────────────────────────

export function createFxaa(_d: PostFxDef, rt: FxRuntime): EffectHandle {
  const mat = new THREE.ShaderMaterial({ ...FXAAShader, uniforms: THREE.UniformsUtils.clone(FXAAShader.uniforms), depthTest: false, depthWrite: false });
  const pass = new ShaderFxPass(mat);
  const res = mat.uniforms.resolution.value as THREE.Vector2;
  res.set(1 / rt.width, 1 / rt.height);
  return { pass, setSize: (w, h) => res.set(1 / w, 1 / h) };
}

export function createSmaa(_d: PostFxDef, rt: FxRuntime): EffectHandle {
  const pass = new SMAAPass();
  pass.setSize(rt.width, rt.height);
  // The area / search textures decode asynchronously from data URIs: wait for them.
  const imgs = ["_areaTexture", "_searchTexture"].map((k) => (pass as unknown as Record<string, THREE.Texture>)[k]?.image as HTMLImageElement | undefined);
  const ready = Promise.all(imgs.map((img) => (img && !img.complete && typeof img.decode === "function" ? img.decode().catch(() => undefined) : undefined))).then(() => {
    for (const k of ["_areaTexture", "_searchTexture"]) {
      const t = (pass as unknown as Record<string, THREE.Texture>)[k];
      if (t) t.needsUpdate = true;
    }
  });
  return { pass, setSize: (w, h) => pass.setSize(w, h), ready };
}

// ─── Tilt-shift (separable variable blur outside a sharp band) ─────────

class TiltShiftPass extends Pass {
  private tmp: THREE.WebGLRenderTarget;
  private mat: THREE.ShaderMaterial;
  private quad: FullScreenQuad;
  constructor(d: PostFxDef, private rt: FxRuntime) {
    super();
    this.tmp = halfTarget(rt.width, rt.height);
    this.mat = fsMaterial(
      `uniform sampler2D tDiffuse; uniform vec2 uDir; uniform float uFocus; uniform float uWidth; uniform float uBlur; uniform float uPr;
      varying vec2 vUv;
      void main() {
        float k = smoothstep(uWidth, uWidth + 0.3, abs(vUv.y - uFocus));
        vec2 stepUv = uDir * k * uBlur * 2.2 * uPr;
        vec4 acc = vec4(0.0); float tot = 0.0;
        for (int i = -6; i <= 6; i++) {
          float w = exp(-float(i * i) / 18.0);
          acc += texture2D(tDiffuse, vUv + stepUv * float(i)) * w;
          tot += w;
        }
        gl_FragColor = acc / tot;
      }`,
      { tDiffuse: { value: null }, uDir: { value: new THREE.Vector2() }, uFocus: { value: num(d.focus, 0.5) }, uWidth: { value: num(d.width, 0.18) }, uBlur: { value: num(d.blur, 1) }, uPr: { value: rt.pixelRatio } },
    );
    this.quad = new FullScreenQuad(this.mat);
  }
  set(param: string, value: unknown): void {
    const k = ({ focus: "uFocus", width: "uWidth", blur: "uBlur" } as Record<string, string>)[param];
    if (k && typeof value === "number") this.mat.uniforms[k].value = value;
  }
  override setSize(w: number, h: number): void {
    this.tmp.setSize(w, h);
    this.mat.uniforms.uPr.value = this.rt.renderer.getPixelRatio();
  }
  override render(renderer: THREE.WebGLRenderer, writeBuffer: THREE.WebGLRenderTarget, readBuffer: THREE.WebGLRenderTarget): void {
    const u = this.mat.uniforms;
    u.tDiffuse.value = readBuffer.texture;
    u.uDir.value.set(1 / readBuffer.width, 0);
    renderer.setRenderTarget(this.tmp);
    this.quad.render(renderer);
    u.tDiffuse.value = this.tmp.texture;
    u.uDir.value.set(0, 1 / readBuffer.height);
    renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
    this.quad.render(renderer);
  }
  override dispose(): void {
    this.tmp.dispose();
    this.mat.dispose();
    this.quad.dispose();
  }
}

export function createTiltshift(d: PostFxDef, rt: FxRuntime): EffectHandle {
  const pass = new TiltShiftPass(d, rt);
  return { pass, set: (p, v) => pass.set(p, v) };
}

// ─── Stylised looks ────────────────────────────────────────────────────

// Live params of the stylised passes: param → uniform (+ conversion).
function uniformSetter(pass: ShaderFxPass, map: Record<string, [string, (v: number) => number]>): EffectHandle["set"] {
  return (param, value) => {
    const m = map[param];
    if (m && typeof value === "number") pass.uniforms[m[0]].value = m[1](value);
  };
}
const id = (v: number) => v;

function screenPass(frag: string, uniforms: Record<string, THREE.IUniform>, rt: FxRuntime): { pass: ShaderFxPass; res: THREE.Vector2 } {
  const res = new THREE.Vector2(rt.width, rt.height);
  const pass = new ShaderFxPass(fsMaterial(frag, { tDiffuse: { value: null }, uRes: { value: res }, uPr: { value: rt.pixelRatio }, ...uniforms }));
  return { pass, res };
}

export function createPixelate(d: PostFxDef, rt: FxRuntime): EffectHandle {
  const { pass, res } = screenPass(
    `uniform sampler2D tDiffuse; uniform vec2 uRes; uniform float uPr; uniform float uPixel; varying vec2 vUv;
    void main() { vec2 cell = uPixel * uPr / uRes; vec2 uv = (floor(vUv / cell) + 0.5) * cell; gl_FragColor = texture2D(tDiffuse, uv); }`,
    { uPixel: { value: Math.max(1, num(d.pixelSize, 4)) } },
    rt,
  );
  return { pass, setSize: (w, h) => (res.set(w, h), (pass.uniforms.uPr.value = rt.renderer.getPixelRatio())), set: uniformSetter(pass, { pixelSize: ["uPixel", (v) => Math.max(1, v)] }) };
}

export function createHalftone(d: PostFxDef, rt: FxRuntime): EffectHandle {
  const { pass, res } = screenPass(
    `uniform sampler2D tDiffuse; uniform vec2 uRes; uniform float uPr; uniform float uSize; uniform float uAngle; uniform float uMono;
    varying vec2 vUv;
    ${GLSL_COMMON}
    vec2 cellUv(vec2 frag, float ang) {
      float s = uSize * uPr;
      mat2 r = mat2(cos(ang), -sin(ang), sin(ang), cos(ang));
      vec2 cell = (floor((r * frag) / s) + 0.5) * s;
      return (transpose(r) * cell) / uRes;
    }
    float dots(vec2 frag, float ang, float value) {
      float s = uSize * uPr;
      mat2 r = mat2(cos(ang), -sin(ang), sin(ang), cos(ang));
      vec2 p = r * frag;
      vec2 cell = (floor(p / s) + 0.5) * s;
      float radius = sqrt(clamp((value - 0.06) / 0.94, 0.0, 1.0)) * s * 0.72;
      return smoothstep(radius + 0.75, radius - 0.75, length(p - cell));
    }
    void main() {
      vec2 frag = gl_FragCoord.xy;
      vec4 base = texture2D(tDiffuse, vUv);
      if (uMono > 0.5) {
        float ink = 1.0 - pow(clamp(a3dLuma(texture2D(tDiffuse, cellUv(frag, uAngle)).rgb), 0.0, 1.0), 0.4545);
        float d = dots(frag, uAngle, ink);
        gl_FragColor = vec4(pow(mix(vec3(0.99, 0.97, 0.93), vec3(0.06, 0.06, 0.08), d), vec3(2.2)), base.a);
        return;
      }
      // CMYK print: subtractive ink dots on paper, one screen angle per ink.
      float ac = uAngle - 0.5236, am = uAngle + 0.5236, ay = uAngle + 0.2618, ak = uAngle;
      vec3 sc = texture2D(tDiffuse, cellUv(frag, ac)).rgb, sm = texture2D(tDiffuse, cellUv(frag, am)).rgb;
      vec3 sy = texture2D(tDiffuse, cellUv(frag, ay)).rgb, sk = texture2D(tDiffuse, cellUv(frag, ak)).rgb;
      sc = pow(clamp(sc, 0.0, 1.0), vec3(0.4545)); sm = pow(clamp(sm, 0.0, 1.0), vec3(0.4545));
      sy = pow(clamp(sy, 0.0, 1.0), vec3(0.4545)); sk = pow(clamp(sk, 0.0, 1.0), vec3(0.4545));
      float kc = 1.0 - max(sc.r, max(sc.g, sc.b)), km = 1.0 - max(sm.r, max(sm.g, sm.b)), ky = 1.0 - max(sy.r, max(sy.g, sy.b));
      float C = (1.0 - sc.r - kc) / max(1.0 - kc, 1e-3), M = (1.0 - sm.g - km) / max(1.0 - km, 1e-3), Y = (1.0 - sy.b - ky) / max(1.0 - ky, 1e-3);
      float K = max(0.0, (1.0 - max(sk.r, max(sk.g, sk.b))) - 0.1) / 0.9;
      vec3 paper = vec3(0.99, 0.97, 0.93);
      vec3 outc = paper * (1.0 - dots(frag, ac, C) * vec3(0.95, 0.25, 0.0)) * (1.0 - dots(frag, am, M) * vec3(0.1, 0.9, 0.3)) * (1.0 - dots(frag, ay, Y) * vec3(0.0, 0.08, 0.9)) * (1.0 - dots(frag, ak, K * 0.9) * 0.92);
      outc = pow(outc, vec3(2.2));
      gl_FragColor = vec4(outc, base.a);
    }`,
    { uSize: { value: Math.max(2, num(d.size, 6)) }, uAngle: { value: (num(d.angle, 45) * Math.PI) / 180 }, uMono: { value: bool(d.mono, false) ? 1 : 0 } },
    rt,
  );
  return { pass, setSize: (w, h) => (res.set(w, h), (pass.uniforms.uPr.value = rt.renderer.getPixelRatio())) };
}

export function createAscii(d: PostFxDef, rt: FxRuntime): EffectHandle {
  const { pass, res } = screenPass(
    `uniform sampler2D tDiffuse; uniform vec2 uRes; uniform float uPr; uniform float uSize; uniform float uMono; uniform vec3 uInk;
    varying vec2 vUv;
    ${GLSL_COMMON}
    float glyph(int n, vec2 p) {
      p = floor(p * vec2(-4.0, 4.0) + 2.5);
      if (clamp(p.x, 0.0, 4.0) == p.x && clamp(p.y, 0.0, 4.0) == p.y) {
        int a = int(p.x + 5.0 * p.y);
        if (((n >> a) & 1) == 1) return 1.0;
      }
      return 0.0;
    }
    void main() {
      float s = uSize * uPr;
      vec2 cell = floor(gl_FragCoord.xy / s);
      vec2 cuv = (cell + 0.5) * s / uRes;
      vec4 c = texture2D(tDiffuse, cuv);
      float l = a3dLuma(c.rgb);
      l = pow(clamp(l, 0.0, 1.0), 0.7);
      int n = 4096;
      if (l > 0.12) n = 65600;
      if (l > 0.24) n = 332772;
      if (l > 0.36) n = 15255086;
      if (l > 0.48) n = 23385164;
      if (l > 0.6) n = 15252014;
      if (l > 0.72) n = 13199452;
      if (l > 0.84) n = 11512810;
      if (l < 0.04) n = 0;
      vec2 p = fract(gl_FragCoord.xy / s) * 2.0 - 1.0;
      float g = glyph(n, p * 1.15);
      vec3 col = uMono > 0.5 ? uInk * (0.35 + 0.65 * l) : c.rgb / max(max(c.r, max(c.g, c.b)), 0.25);
      gl_FragColor = vec4(col * g, texture2D(tDiffuse, vUv).a);
    }`,
    { uSize: { value: Math.max(4, num(d.size, 8)) }, uMono: { value: bool(d.mono, false) ? 1 : 0 }, uInk: { value: toColor(typeof d.color === "string" ? d.color : "#33ff88") } },
    rt,
  );
  return { pass, setSize: (w, h) => (res.set(w, h), (pass.uniforms.uPr.value = rt.renderer.getPixelRatio())) };
}

export function createGlitch(d: PostFxDef, rt: FxRuntime): EffectHandle {
  const { pass, res } = screenPass(
    `uniform sampler2D tDiffuse; uniform vec2 uRes; uniform float uPr; uniform float uTime; uniform float uAmount; uniform float uSpeed;
    varying vec2 vUv;
    ${GLSL_COMMON}
    void main() {
      float tb = floor(uTime * max(uSpeed, 0.001) * 6.0);
      float burst = step(1.0 - uAmount * 0.55, a3dHash12(vec2(tb, 1.7)));
      float s = uAmount * mix(0.15, 1.0, burst);
      float rows = 6.0 + floor(a3dHash12(vec2(tb, 9.1)) * 26.0);
      float row = floor(vUv.y * rows);
      float on = step(0.72, a3dHash12(vec2(row, tb)));
      float shift = (a3dHash12(vec2(row * 1.37, tb + 3.0)) - 0.5) * 0.12 * s * on;
      float jitter = (a3dHash12(vec2(floor(gl_FragCoord.y / (2.0 * uPr)), tb)) - 0.5) * 0.004 * s;
      vec2 uv = vec2(fract(vUv.x + shift + jitter), vUv.y);
      float split = 0.008 * s * (0.4 + on);
      vec4 c = texture2D(tDiffuse, uv);
      c.r = texture2D(tDiffuse, uv + vec2(split, 0.0)).r;
      c.b = texture2D(tDiffuse, uv - vec2(split, 0.0)).b;
      float blk = step(0.93, a3dHash12(floor(vUv * vec2(10.0, rows)) + tb)) * burst * uAmount;
      c.rgb = mix(c.rgb, vec3(1.0) - c.rgb.gbr, blk);
      gl_FragColor = c;
    }`,
    { uTime: { value: 0 }, uAmount: { value: num(d.amount, 0.5) }, uSpeed: { value: num(d.speed, 1) } },
    rt,
  );
  return {
    pass,
    update: (t) => (pass.uniforms.uTime.value = t),
    setSize: (w, h) => (res.set(w, h), (pass.uniforms.uPr.value = rt.renderer.getPixelRatio())),
    set: uniformSetter(pass, { amount: ["uAmount", id], speed: ["uSpeed", id] }),
  };
}
