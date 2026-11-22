// HDR scene effects (before tone mapping, on the background-free scene image,
// premultiplied alpha): ao, outline, godrays, dof, bloom, lensflare.

import * as THREE from "three";
import { GTAOPass } from "three/addons/postprocessing/GTAOPass.js";
import { FullScreenQuad, Pass } from "three/addons/postprocessing/Pass.js";
import type { PostFxDef } from "../../core/types";
import { num, toColor } from "../util";
import { depthUniforms, type EffectHandle, type FxRuntime, fsMaterial, GLSL_COMMON, GLSL_DEPTH, halfTarget, seededNoiseTexture, ShaderFxPass, syncDepthUniforms } from "./common";

// ─── Ambient occlusion (GTAO + Poisson denoise, sharing the G-buffer) ──

export function createAo(d: PostFxDef, rt: FxRuntime): EffectHandle {
  const s = rt.quality.effectScale;
  const gb = rt.gbuffer();
  const aw = () => Math.max(1, Math.round(rt.width * s)), ah = () => Math.max(1, Math.round(rt.height * s));
  const gtao = new GTAOPass(rt.scene, rt.camera, aw(), ah(), { depthTexture: gb.depthTexture, normalTexture: gb.normalTexture });
  gtao.updateGtaoMaterial({ radius: num(d.radius, 0.6), thickness: num(d.thickness, 1), distanceExponent: 1.5, distanceFallOff: num(d.falloff, 1), scale: 1, samples: rt.quality.aoSamples });
  gtao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 8, rings: 2, samples: rt.quality.tier === "low" ? 8 : 16 });
  gtao.output = GTAOPass.OUTPUT.Off; // AO + denoise only: the blend below upsamples and composites
  // Deterministic denoise noise (the addon seeds it with Math.random).
  const pd = gtao as unknown as { pdMaterial: THREE.ShaderMaterial; pdNoiseTexture: THREE.Texture; pdRenderTarget: THREE.WebGLRenderTarget };
  pd.pdNoiseTexture.dispose();
  pd.pdNoiseTexture = seededNoiseTexture(64, 7);
  pd.pdMaterial.uniforms.tNoise.value = pd.pdNoiseTexture;
  const u = {
    tDiffuse: { value: null },
    tAo: { value: pd.pdRenderTarget.texture },
    tDepth: { value: gb.depthTexture },
    tNormal: { value: gb.normalTexture },
    uAoRes: { value: new THREE.Vector2(aw(), ah()) },
    uIntensity: { value: Math.min(2, num(d.intensity, 1)) },
    ...depthUniforms(),
  };
  // Depth-aware 3×3 upsample (also smooths the denoised AO), then composite:
  // rgb × ao; on transparent / shadow-only grounds the occlusion becomes a
  // contact shadow over the background (alpha grows, rgb stays premultiplied).
  const blend = new ShaderFxPass(
    fsMaterial(
      `uniform sampler2D tDiffuse; uniform sampler2D tAo; uniform sampler2D tDepth; uniform sampler2D tNormal; uniform vec2 uAoRes; uniform float uIntensity;
      varying vec2 vUv;
      ${GLSL_DEPTH}
      void main() {
        vec4 c = texture2D(tDiffuse, vUv);
        float n = texture2D(tNormal, vUv).a;
        if (n < 0.25) { gl_FragColor = c; return; }
        float z0 = a3dViewZ(texture2D(tDepth, vUv).x);
        vec2 tx = 1.0 / uAoRes;
        float sum = 0.0, wsum = 0.0;
        for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
          vec2 uv = vUv + vec2(float(x), float(y)) * tx;
          float z = a3dViewZ(texture2D(tDepth, uv).x);
          float w = exp(-abs(z - z0) / (z0 * 0.02 + 1e-3)) * ((x == 0 && y == 0) ? 2.0 : 1.0);
          sum += texture2D(tAo, uv).r * w;
          wsum += w;
        }
        float ao = clamp(1.0 - (1.0 - sum / max(wsum, 1e-4)) * uIntensity, 0.0, 1.0);
        float ground = step(0.25, n) * (1.0 - step(0.75, n));
        float cover = ground * (1.0 - c.a) * (1.0 - ao);
        gl_FragColor = vec4(c.rgb * ao, c.a + cover);
      }`,
      u,
    ),
  );
  const pass = blend;
  const orig = blend.render.bind(blend);
  pass.render = (...args: Parameters<typeof orig>) => {
    const renderer = args[0];
    rt.gbuffer().ensure(renderer, rt.scene, rt.camera, rt.frame());
    syncDepthUniforms(u, rt.camera);
    gtao.render(renderer, args[1], args[2], 0, false);
    orig(...args);
  };
  const disposeBlend = blend.dispose.bind(blend);
  pass.dispose = () => {
    disposeBlend();
    gtao.dispose();
  };
  return {
    pass,
    setSize: (w, h) => {
      const sw = Math.max(1, Math.round(w * s)), sh = Math.max(1, Math.round(h * s));
      gtao.setSize(sw, sh);
      u.uAoRes.value.set(sw, sh);
    },
    set(param, value) {
      if (typeof value !== "number") return;
      if (param === "intensity") u.uIntensity.value = Math.min(2, value);
      else if (param === "radius") gtao.updateGtaoMaterial({ radius: value });
      else if (param === "thickness") gtao.updateGtaoMaterial({ thickness: value });
      else if (param === "falloff") gtao.updateGtaoMaterial({ distanceFallOff: value });
    },
  };
}

// ─── Toon outlines (edges of the G-buffer depth + normals) ─────────────

export function createOutline(d: PostFxDef, rt: FxRuntime): EffectHandle {
  const u = {
    tDiffuse: { value: null },
    tNormal: { value: rt.gbuffer().normalTexture },
    tDepth: { value: rt.gbuffer().depthTexture },
    uResolution: { value: new THREE.Vector2(rt.width, rt.height) },
    uColor: { value: toColor(typeof d.color === "string" ? d.color : "#000000") },
    uThickness: { value: num(d.thickness, 1) * rt.pixelRatio },
    ...depthUniforms(),
  };
  const pass = new ShaderFxPass(
    fsMaterial(
      `uniform sampler2D tDiffuse; uniform sampler2D tNormal; uniform sampler2D tDepth;
      uniform vec2 uResolution; uniform vec3 uColor; uniform float uThickness;
      varying vec2 vUv;
      ${GLSL_DEPTH}
      float lin(vec2 uv) { return a3dViewZ(texture2D(tDepth, uv).x); }
      void main() {
        vec4 base = texture2D(tDiffuse, vUv);
        vec2 o = uThickness / uResolution;
        vec4 n0 = texture2D(tNormal, vUv), n1 = texture2D(tNormal, vUv + vec2(o.x, 0.0)), n2 = texture2D(tNormal, vUv - vec2(o.x, 0.0)), n3 = texture2D(tNormal, vUv + vec2(0.0, o.y)), n4 = texture2D(tNormal, vUv - vec2(0.0, o.y));
        // Only edges that touch an object (the ground's far edge / horizon never outlines).
        float obj = max(max(step(0.75, n0.a), max(step(0.75, n1.a), step(0.75, n2.a))), max(step(0.75, n3.a), step(0.75, n4.a)));
        float d0 = lin(vUv);
        float dd = abs(lin(vUv + vec2(o.x, 0.0)) - d0) + abs(lin(vUv - vec2(o.x, 0.0)) - d0) + abs(lin(vUv + vec2(0.0, o.y)) - d0) + abs(lin(vUv - vec2(0.0, o.y)) - d0);
        float nd = length(n1.xyz - n0.xyz) + length(n2.xyz - n0.xyz) + length(n3.xyz - n0.xyz) + length(n4.xyz - n0.xyz);
        float edge = obj * max(smoothstep(0.04, 0.12, dd / max(d0, 1e-3)), smoothstep(0.5, 0.9, nd));
        gl_FragColor = vec4(mix(base.rgb, uColor, edge), max(base.a, edge));
      }`,
      u,
    ),
  );
  const orig = pass.render.bind(pass);
  pass.render = (...args: Parameters<typeof orig>) => {
    const renderer = args[0];
    rt.gbuffer().ensure(renderer, rt.scene, rt.camera, rt.frame());
    syncDepthUniforms(u, rt.camera);
    orig(...args);
  };
  return {
    pass,
    setSize: (w, h) => u.uResolution.value.set(w, h),
    set(param, value) {
      if (param === "color" && typeof value === "string") u.uColor.value = toColor(value);
      else if (param === "thickness" && typeof value === "number") u.uThickness.value = value * rt.pixelRatio;
    },
  };
}

// ─── God rays (screen-space radial scattering) ─────────────────────────
//
// 1. Occlusion mask: bright sky / sun disc where NOTHING is in front (the
//    G-buffer marks every object and the ground), black on occluders.
// 2. Two radial passes towards the source (Mitchell, GPU Gems 3 ch. 13, made
//    continuous): a coarse pass of RAYS/2 taps over the whole ray length with
//    an exponential decay, then a fine pass that spreads 8 taps over ONE
//    coarse step — together RAYS×4 gap-free samples, no jitter noise. Gaps
//    between occluders become bright shafts, occluders cast dark ones.
// 3. Composite: the shafts are added (light scattered towards the camera),
//    and the scene is slightly dimmed where the source is blocked along the
//    view ray, so shadow shafts read over bright fog / sky too.

// Interleaved gradient noise (Jimenez 2014): per-pixel [0,1) dither with
// blue-noise-like spectrum; a pure function of the pixel (deterministic).
export const IGN_GLSL = `float a3dIgn(vec2 p) { return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }`;

class GodraysPass extends Pass {
  private mask: THREE.WebGLRenderTarget;
  private rays: THREE.WebGLRenderTarget;
  private rays2: THREE.WebGLRenderTarget;
  private maskMat: THREE.ShaderMaterial;
  private raysMat: THREE.ShaderMaterial;
  private fineMat: THREE.ShaderMaterial;
  private compMat: THREE.ShaderMaterial;
  private quad = new FullScreenQuad();
  private srcColor = new THREE.Color();
  private visible = 1;
  private onScreen = 0;
  private d: PostFxDef;
  constructor(private rt: FxRuntime, def: PostFxDef) {
    super();
    const d = (this.d = { ...def });
    const s = rt.quality.effectScale;
    const lin = { minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter };
    this.mask = halfTarget(rt.width * s, rt.height * s, lin);
    this.rays = halfTarget(rt.width * s, rt.height * s, lin);
    this.rays2 = halfTarget(rt.width * s, rt.height * s, lin);
    const src = { value: new THREE.Vector2(0.5, 1.1) };
    const length = { value: 0.85 };
    this.maskMat = fsMaterial(
      `uniform sampler2D tDiffuse; uniform sampler2D tNormal; uniform vec2 uSrc; uniform vec3 uColor; uniform float uSize; uniform float uAspect;
      varying vec2 vUv;
      ${GLSL_COMMON}
      void main() {
        float far = 1.0 - step(0.25, texture2D(tNormal, vUv).a);
        vec3 c = texture2D(tDiffuse, vUv).rgb;
        vec2 dv = (vUv - uSrc) * vec2(uAspect, 1.0);
        float dist = length(dv);
        float glow = pow(max(0.0, 1.0 - dist / max(uSize, 1e-3)), 2.0);
        float wide = pow(max(0.0, 1.0 - dist / max(uSize * 5.0, 1e-3)), 1.5);
        // The open sky around the source scatters too (its own colour, brighter
        // parts more): the large bright area the occluders carve shafts into.
        float l = a3dLuma(c);
        // Soft-compressed (≤ 2): a low sun's hot halo and bright fog must not flood the rays.
        vec3 sky = c / max(l, 1e-3) * (l / (1.0 + l * 0.5)) * (0.35 + smoothstep(0.2, 1.5, l)) * wide;
        gl_FragColor = vec4(far * (uColor * glow * 1.5 + sky), far * wide);
      }`,
      { tDiffuse: { value: null }, tNormal: { value: rt.gbuffer().normalTexture }, uSrc: src, uColor: { value: new THREE.Color() }, uSize: { value: 0.12 }, uAspect: { value: 1 } },
    );
    this.raysMat = fsMaterial(
      `uniform sampler2D tDiffuse; uniform vec2 uSrc; uniform float uLength; uniform float uDecay; uniform float uSize; uniform float uAspect;
      varying vec2 vUv;
      ${IGN_GLSL}
      void main() {
        vec2 delta = (vUv - uSrc) * uLength / float(TAPS);
        // Per-pixel start offset (interleaved gradient noise: deterministic,
        // blue-noise-like). Without it the TAPS discrete copies of every
        // occluder edge line up into visible streaks / ghost silhouettes
        // (mountain ridges under height fog); the fine pass averages it out.
        vec2 uv = vUv - delta * a3dIgn(gl_FragCoord.xy);
        vec4 acc = vec4(0.0); float tot = 0.0, expect = 0.0;
        // decay is per 1/48 of the ray (the classic 0.96 ≈ e^-2 over the full length).
        float stepDecay = pow(uDecay, 48.0 / float(TAPS));
        float w = 1.0;
        for (int i = 0; i < TAPS; i++) {
          acc += texture2D(tDiffuse, uv) * w;
          // What the mask alpha would be with nothing in the way (analytic).
          float dist = length((uv - uSrc) * vec2(uAspect, 1.0));
          expect += pow(max(0.0, 1.0 - dist / max(uSize * 5.0, 1e-3)), 1.5) * w;
          tot += w;
          w *= stepDecay;
          uv -= delta;
        }
        // a = how open the way to the source is (1 = clear, 0 = blocked); 1
        // where the ray never crosses the source area (no shadow far away).
        float open = acc.a / max(expect, 1e-4);
        open = mix(1.0, clamp(open, 0.0, 1.0), smoothstep(0.0, 0.08, expect / max(tot, 1e-4)));
        gl_FragColor = vec4(acc.rgb / max(tot, 1e-4), open);
      }`,
      { tDiffuse: { value: null }, uSrc: src, uLength: length, uDecay: { value: 0.96 }, uSize: { value: 0.1 }, uAspect: { value: 1 } },
      { TAPS: Math.max(8, Math.round(rt.quality.rays / 2)) },
    );
    this.fineMat = fsMaterial(
      `uniform sampler2D tDiffuse; uniform vec2 uSrc; uniform float uLength;
      varying vec2 vUv;
      ${IGN_GLSL}
      void main() {
        vec2 delta = (vUv - uSrc) * uLength / float(COARSE * 8);
        vec4 acc = vec4(0.0);
        // Jittered too (other noise phase), plus a half-pixel cross blur
        // across the ray: the coarse pass's dither dissolves instead of
        // showing as grain.
        float j = a3dIgn(gl_FragCoord.xy + vec2(17.0, 31.0));
        vec2 side = vec2(-delta.y, delta.x) * 0.5;
        for (int i = 0; i < 8; i++) {
          vec2 p = vUv - delta * (float(i) + j);
          acc += texture2D(tDiffuse, p + side * (mod(float(i), 2.0) - 0.5));
        }
        gl_FragColor = acc / 8.0;
      }`,
      { tDiffuse: { value: null }, uSrc: src, uLength: length },
      { COARSE: Math.max(8, Math.round(rt.quality.rays / 2)) },
    );
    this.compMat = fsMaterial(
      `uniform sampler2D tDiffuse; uniform sampler2D tRays; uniform sampler2D tNormal; uniform float uIntensity; uniform float uShadow;
      varying vec2 vUv;
      void main() {
        vec4 c = texture2D(tDiffuse, vUv);
        vec4 r = texture2D(tRays, vUv);
        // r.a = how much of the ray towards the source is open sky (1) vs blocked (0).
        // Shadow shafts darken the sky / haze; on solid surfaces (already lit
        // and shadowed by the real lights) only a third of it, or terrain
        // under height fog gets dark streaks from every ridge between it and the sun.
        float sky = 1.0 - step(0.25, texture2D(tNormal, vUv).a);
        float shade = mix(1.0, 0.55 + 0.45 * r.a, uShadow * mix(0.3, 1.0, sky));
        gl_FragColor = vec4(c.rgb * shade + r.rgb * 1.8 * uIntensity, c.a);
      }`,
      { tDiffuse: { value: null }, tRays: { value: this.rays2.texture }, tNormal: { value: rt.gbuffer().normalTexture }, uIntensity: { value: 0.6 }, uShadow: { value: 0 } },
    );
    this.raysMat.uniforms.uDecay.value = Math.min(1, Math.max(0.5, num(d.decay, 0.96)));
    length.value = Math.min(1, Math.max(0, num(d.length, 0.85)));
    this.maskMat.uniforms.uSize.value = num(d.size, 0.1);
  }

  set(param: string, value: unknown): void {
    this.d[param] = value;
    if (typeof value !== "number") return;
    if (param === "decay") this.raysMat.uniforms.uDecay.value = Math.min(1, Math.max(0.5, value));
    else if (param === "length") this.raysMat.uniforms.uLength.value = Math.min(1, Math.max(0, value)); // shared with the fine pass
    else if (param === "size") this.maskMat.uniforms.uSize.value = value;
  }

  update(): void {
    const { scene, camera } = this.rt;
    const source = typeof this.d.source === "string" ? this.d.source : "auto";
    let dir: THREE.Vector3 | null = null;
    let pos: THREE.Vector3 | null = null;
    let color: THREE.Color | null = null;
    if (source === "auto" || source === "sun") {
      const sky = scene.getObjectByName("__sky") as THREE.Mesh | undefined;
      const u = (sky?.material as THREE.ShaderMaterial | undefined)?.uniforms;
      if (sky?.userData.sunDir && sky.userData.sunUp) {
        // Physical sky (src/runtime/build/sky.ts).
        dir = (sky.userData.sunDir as THREE.Vector3).clone();
        color = (sky.userData.sunColor as THREE.Color).clone();
      } else if (u && u.uSun?.value > 0) {
        dir = (u.uSunDir.value as THREE.Vector3).clone();
        color = (u.uSunColor.value as THREE.Color).clone();
      }
    }
    if (!dir && source !== "sun") {
      let light: THREE.Light | undefined;
      if (source !== "auto") light = scene.getObjectByName(source) as THREE.Light | undefined;
      else scene.traverse((o) => {
        if (!light && ((o as THREE.DirectionalLight).isDirectionalLight || (o as THREE.SpotLight).isSpotLight)) light = o as THREE.Light;
      });
      if (light) {
        color = light.color.clone();
        const wp = light.getWorldPosition(new THREE.Vector3());
        if ((light as THREE.DirectionalLight).isDirectionalLight) {
          const tgt = (light as THREE.DirectionalLight).target.getWorldPosition(new THREE.Vector3());
          dir = wp.sub(tgt).normalize();
        } else pos = wp;
      }
    }
    const src = this.maskMat.uniforms.uSrc.value as THREE.Vector2;
    let vis = 1;
    if (dir || pos) {
      const p = pos ?? camera.getWorldPosition(new THREE.Vector3()).addScaledVector(dir!, camera.far * 0.5);
      const v = p.clone().applyMatrix4(camera.matrixWorldInverse);
      const ndc = p.clone().project(camera);
      if (v.z > 0 && !(camera as THREE.OrthographicCamera).isOrthographicCamera) vis = 0; // behind the camera
      src.set(ndc.x * 0.5 + 0.5, ndc.y * 0.5 + 0.5);
      // Fade when the source is far off-screen.
      const off = Math.max(Math.abs(ndc.x), Math.abs(ndc.y));
      vis *= THREE.MathUtils.clamp(2.2 - off, 0, 1);
      this.onScreen = vis * THREE.MathUtils.clamp((1.25 - off) / 0.25, 0, 1);
    } else {
      src.set(0.5, 1.15);
      this.onScreen = 0;
    }
    this.visible = vis;
    this.srcColor.copy(typeof this.d.color === "string" ? toColor(this.d.color) : color ?? new THREE.Color(1, 0.95, 0.85));
  }

  override setSize(w: number, h: number): void {
    const s = this.rt.quality.effectScale;
    for (const t of [this.mask, this.rays, this.rays2]) t.setSize(Math.max(1, Math.round(w * s)), Math.max(1, Math.round(h * s)));
    this.maskMat.uniforms.uAspect.value = w / Math.max(1, h);
  }

  override render(renderer: THREE.WebGLRenderer, writeBuffer: THREE.WebGLRenderTarget, readBuffer: THREE.WebGLRenderTarget): void {
    this.rt.gbuffer().ensure(renderer, this.rt.scene, this.rt.camera, this.rt.frame());
    this.maskMat.uniforms.uAspect.value = this.raysMat.uniforms.uAspect.value = readBuffer.width / Math.max(1, readBuffer.height);
    this.raysMat.uniforms.uSize.value = this.maskMat.uniforms.uSize.value;
    this.maskMat.uniforms.tDiffuse.value = readBuffer.texture;
    (this.maskMat.uniforms.uColor.value as THREE.Color).copy(this.srcColor);
    this.quad.material = this.maskMat;
    renderer.setRenderTarget(this.mask);
    this.quad.render(renderer);
    this.raysMat.uniforms.tDiffuse.value = this.mask.texture;
    this.quad.material = this.raysMat;
    renderer.setRenderTarget(this.rays);
    this.quad.render(renderer);
    this.fineMat.uniforms.tDiffuse.value = this.rays.texture;
    this.quad.material = this.fineMat;
    renderer.setRenderTarget(this.rays2);
    this.quad.render(renderer);
    this.compMat.uniforms.tDiffuse.value = readBuffer.texture;
    const intensity = num(this.d.intensity, 0.6);
    this.compMat.uniforms.uIntensity.value = intensity * this.visible;
    // Shadow shafts only when the source is on screen (not for a sun far off-frame).
    this.compMat.uniforms.uShadow.value = Math.min(1, intensity) * this.onScreen;
    this.quad.material = this.compMat;
    renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
    this.quad.render(renderer);
  }

  override dispose(): void {
    this.mask.dispose();
    this.rays.dispose();
    this.rays2.dispose();
    this.maskMat.dispose();
    this.raysMat.dispose();
    this.fineMat.dispose();
    this.compMat.dispose();
    this.quad.dispose();
  }
}

export function createGodrays(d: PostFxDef, rt: FxRuntime): EffectHandle {
  const pass = new GodraysPass(rt, d);
  return { pass, update: () => pass.update(), set: (p, v) => pass.set(p, v) };
}

// ─── Depth of field (single-pass scatter-as-gather bokeh) ──────────────

export function createDof(d: PostFxDef, rt: FxRuntime): EffectHandle {
  const u = {
    tDiffuse: { value: null },
    tDepth: { value: rt.gbuffer().depthTexture },
    uRes: { value: new THREE.Vector2(rt.width, rt.height) },
    uFocus: { value: num(d.focus, 8) },
    uAperture: { value: num(d.aperture, 0.002) },
    uMaxBlur: { value: num(d.maxblur, 0.01) },
    ...depthUniforms(),
  };
  const pass = new ShaderFxPass(
    fsMaterial(
      `uniform sampler2D tDiffuse; uniform sampler2D tDepth; uniform vec2 uRes; uniform float uFocus; uniform float uAperture; uniform float uMaxBlur;
      varying vec2 vUv;
      ${GLSL_DEPTH}
      const float GOLDEN = 2.39996323;
      float cocPx(float z) { return clamp(abs(z - uFocus) * uAperture, 0.0, uMaxBlur) * uRes.x; }
      void main() {
        float z0 = a3dViewZ(texture2D(tDepth, vUv).x);
        float c0 = cocPx(z0);
        vec4 acc = texture2D(tDiffuse, vUv);
        float tot = 1.0;
        float maxPx = uMaxBlur * uRes.x;
        if (maxPx < 0.5) { gl_FragColor = acc; return; }
        for (int i = 1; i < SAMPLES; i++) {
          float fi = float(i);
          float r = maxPx * sqrt(fi / float(SAMPLES));
          float a = fi * GOLDEN;
          vec2 uv = vUv + vec2(cos(a), sin(a)) * r / uRes;
          vec4 sc = texture2D(tDiffuse, uv);
          float zs = a3dViewZ(texture2D(tDepth, uv).x);
          float cs = cocPx(zs);
          // A sharper background sample must not bleed over a blurred foreground.
          if (zs > z0) cs = min(cs, c0 * 2.0);
          float m = smoothstep(r - 1.0, r + 1.0, cs);
          acc += mix(acc / tot, sc, m);
          tot += 1.0;
        }
        gl_FragColor = acc / tot;
      }`,
      u,
      { SAMPLES: rt.quality.dofSamples },
    ),
  );
  let focusOn = typeof d.focusOn === "string" ? d.focusOn : null;
  const box = new THREE.Box3(), center = new THREE.Vector3(), fwd = new THREE.Vector3(), camPos = new THREE.Vector3();
  const orig = pass.render.bind(pass);
  pass.render = (...args: Parameters<typeof orig>) => {
    const renderer = args[0];
    rt.gbuffer().ensure(renderer, rt.scene, rt.camera, rt.frame());
    syncDepthUniforms(u, rt.camera);
    if (focusOn) {
      const obj = rt.scene.getObjectByName(focusOn);
      if (obj) {
        box.setFromObject(obj);
        if (!box.isEmpty()) {
          box.getCenter(center);
          rt.camera.getWorldPosition(camPos);
          rt.camera.getWorldDirection(fwd);
          u.uFocus.value = Math.max(rt.camera.near, center.sub(camPos).dot(fwd));
        }
      }
    }
    orig(...args);
  };
  return {
    pass,
    setSize: (w, h) => u.uRes.value.set(w, h),
    set(param, value) {
      if (param === "focusOn") focusOn = typeof value === "string" && value ? value : null;
      if (typeof value !== "number") return;
      if (param === "focus") {
        u.uFocus.value = value;
        focusOn = null;
      } else if (param === "aperture") u.uAperture.value = value;
      else if (param === "maxblur") u.uMaxBlur.value = value;
    },
  };
}

// ─── Bloom (soft-knee threshold + energy-normalised mip pyramid) ──────
//
// Prefilter: only the part of each pixel ABOVE the threshold blooms (soft
// knee, luminance based, Karis-weighted against fireflies), so a lit diffuse
// surface just under / around the threshold adds (almost) nothing — the old
// UnrealBloom high-pass passed the whole pixel once over the threshold and
// summed five full-strength mips, washing dark materials out. Then a
// down-sample chain (13-tap) and a tent up-sample chain whose level weights
// (from `radius`) are normalised: `strength` is the fraction of the
// over-threshold energy spread around. Alpha (coverage) is left untouched:
// the glow is light added over whatever is behind (BackgroundPass keeps it
// visible on transparent canvases).

const BLOOM_MIPS = 6;
const BLOOM_GAIN = 5; // only the over-threshold part blooms: a higher gain keeps emissive glows as strong as the previous (full-pixel) bloom

class BloomPass extends Pass {
  private down: THREE.WebGLRenderTarget[] = [];
  private up: THREE.WebGLRenderTarget[] = [];
  private preMat: THREE.ShaderMaterial;
  private downMat: THREE.ShaderMaterial;
  private upMat: THREE.ShaderMaterial;
  private compMat: THREE.ShaderMaterial;
  private quad = new FullScreenQuad();
  strength: number;
  radius: number;
  threshold: number;
  smoothing: number;
  constructor(d: PostFxDef, w: number, h: number, private scale: number) {
    super();
    this.needsSwap = true;
    this.strength = num(d.strength, 0.8);
    this.radius = num(d.radius, 0.4);
    this.threshold = num(d.threshold, 0.85);
    this.smoothing = num(d.smoothing, 0.1);
    for (let i = 0; i < BLOOM_MIPS; i++) {
      this.down.push(halfTarget(1, 1, { minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter }));
      if (i < BLOOM_MIPS - 1) this.up.push(halfTarget(1, 1, { minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter }));
    }
    this.preMat = fsMaterial(
      `uniform sampler2D tDiffuse; uniform vec2 uTexel; uniform float uThreshold; uniform float uKnee;
      varying vec2 vUv;
      ${GLSL_COMMON}
      vec3 pick(vec2 uv) {
        vec3 c = min(texture2D(tDiffuse, uv).rgb, vec3(64.0));
        float l = a3dLuma(c);
        float soft = clamp(l - uThreshold + uKnee, 0.0, 2.0 * uKnee);
        soft = soft * soft / (4.0 * uKnee + 1e-5);
        float k = max(soft, l - uThreshold) / max(l, 1e-4);
        // Soft shoulder on the over-threshold energy (≤ ~4): a brighter
        // emissive keeps growing its glow smoothly instead of flooding the frame.
        vec3 o = c * max(k, 0.0);
        return o / (1.0 + a3dLuma(o) / 4.0);
      }
      void main() {
        // 4 taps (2×2 box at half resolution), Karis average: one hot pixel can't flash a disc.
        vec2 o = uTexel * 0.5;
        vec3 a = pick(vUv + vec2(-o.x, -o.y)), b = pick(vUv + vec2(o.x, -o.y)), c = pick(vUv + vec2(-o.x, o.y)), d = pick(vUv + vec2(o.x, o.y));
        float wa = 1.0 / (1.0 + a3dLuma(a)), wb = 1.0 / (1.0 + a3dLuma(b)), wc = 1.0 / (1.0 + a3dLuma(c)), wd = 1.0 / (1.0 + a3dLuma(d));
        gl_FragColor = vec4((a * wa + b * wb + c * wc + d * wd) / (wa + wb + wc + wd), 1.0);
      }`,
      { tDiffuse: { value: null }, uTexel: { value: new THREE.Vector2() }, uThreshold: { value: 1 }, uKnee: { value: 0.1 } },
    );
    // 13-tap down-sample (Jimenez 2014): no pulsing / blockiness when things move.
    this.downMat = fsMaterial(
      `uniform sampler2D tDiffuse; uniform vec2 uTexel; varying vec2 vUv;
      vec3 s(vec2 o) { return texture2D(tDiffuse, vUv + o * uTexel).rgb; }
      void main() {
        vec3 a = s(vec2(-2.0, 2.0)), b = s(vec2(0.0, 2.0)), c = s(vec2(2.0, 2.0));
        vec3 d = s(vec2(-2.0, 0.0)), e = s(vec2(0.0)), f = s(vec2(2.0, 0.0));
        vec3 g = s(vec2(-2.0, -2.0)), h = s(vec2(0.0, -2.0)), i = s(vec2(2.0, -2.0));
        vec3 j = s(vec2(-1.0, 1.0)), k = s(vec2(1.0, 1.0)), l = s(vec2(-1.0, -1.0)), m = s(vec2(1.0, -1.0));
        vec3 r = e * 0.125 + (a + c + g + i) * 0.03125 + (b + d + f + h) * 0.0625 + (j + k + l + m) * 0.125;
        gl_FragColor = vec4(r, 1.0);
      }`,
      { tDiffuse: { value: null }, uTexel: { value: new THREE.Vector2() } },
    );
    // Tent up-sample of the coarser level + this level's weighted contribution.
    this.upMat = fsMaterial(
      `uniform sampler2D tDiffuse; uniform sampler2D tLevel; uniform vec2 uTexel; uniform float uWeight; uniform float uCoarse; varying vec2 vUv;
      vec3 s(vec2 o) { return texture2D(tDiffuse, vUv + o * uTexel).rgb; }
      void main() {
        vec3 t = s(vec2(0.0)) * 4.0 + (s(vec2(-1.0, 0.0)) + s(vec2(1.0, 0.0)) + s(vec2(0.0, -1.0)) + s(vec2(0.0, 1.0))) * 2.0
          + s(vec2(-1.0, -1.0)) + s(vec2(1.0, -1.0)) + s(vec2(-1.0, 1.0)) + s(vec2(1.0, 1.0));
        gl_FragColor = vec4(t / 16.0 * uCoarse + texture2D(tLevel, vUv).rgb * uWeight, 1.0);
      }`,
      { tDiffuse: { value: null }, tLevel: { value: null }, uTexel: { value: new THREE.Vector2() }, uWeight: { value: 1 }, uCoarse: { value: 1 } },
    );
    this.compMat = fsMaterial(
      `uniform sampler2D tDiffuse; uniform sampler2D tBloom; uniform float uStrength; varying vec2 vUv;
      void main() { vec4 c = texture2D(tDiffuse, vUv); gl_FragColor = vec4(c.rgb + texture2D(tBloom, vUv).rgb * uStrength, c.a); }`,
      { tDiffuse: { value: null }, tBloom: { value: null }, uStrength: { value: 1 } },
    );
    this.setSize(w, h);
  }
  /** Normalised level weights: radius 0 = tight (fine levels), 1 = wide (coarse levels). */
  levelWeights(): number[] {
    // Same radius response as three's UnrealBloom (fine → coarse factors 1 … 0.2, mirrored by radius).
    const r = Math.min(1, Math.max(0, this.radius));
    const w = Array.from({ length: BLOOM_MIPS }, (_, i) => {
      const f = 1 - (0.8 * i) / (BLOOM_MIPS - 1);
      return f * (1 - r) + (1.2 - f) * r;
    });
    const sum = w.reduce((a, b) => a + b, 0);
    return w.map((x) => x / sum);
  }
  override setSize(w: number, h: number): void {
    let cw = Math.max(1, Math.round(w * this.scale * 0.5)), ch = Math.max(1, Math.round(h * this.scale * 0.5));
    for (let i = 0; i < BLOOM_MIPS; i++) {
      this.down[i].setSize(cw, ch);
      if (i < BLOOM_MIPS - 1) this.up[i].setSize(cw, ch);
      cw = Math.max(1, Math.round(cw / 2));
      ch = Math.max(1, Math.round(ch / 2));
    }
  }
  private draw(renderer: THREE.WebGLRenderer, mat: THREE.ShaderMaterial, target: THREE.WebGLRenderTarget | null): void {
    this.quad.material = mat;
    renderer.setRenderTarget(target);
    this.quad.render(renderer);
  }
  override render(renderer: THREE.WebGLRenderer, writeBuffer: THREE.WebGLRenderTarget, readBuffer: THREE.WebGLRenderTarget): void {
    const pre = this.preMat.uniforms;
    pre.tDiffuse.value = readBuffer.texture;
    pre.uTexel.value.set(1 / readBuffer.width, 1 / readBuffer.height);
    pre.uThreshold.value = this.threshold;
    pre.uKnee.value = Math.max(1e-3, this.smoothing * Math.max(this.threshold, 0.25));
    this.draw(renderer, this.preMat, this.down[0]);
    const du = this.downMat.uniforms;
    for (let i = 1; i < BLOOM_MIPS; i++) {
      du.tDiffuse.value = this.down[i - 1].texture;
      du.uTexel.value.set(1 / this.down[i - 1].width, 1 / this.down[i - 1].height);
      this.draw(renderer, this.downMat, this.down[i]);
    }
    const wts = this.levelWeights();
    const uu = this.upMat.uniforms;
    // up[i] = tent(up[i+1] or the coarsest level × its weight) + down[i] × weight[i].
    for (let i = BLOOM_MIPS - 2; i >= 0; i--) {
      const coarse = i === BLOOM_MIPS - 2 ? this.down[BLOOM_MIPS - 1] : this.up[i + 1];
      uu.tDiffuse.value = coarse.texture;
      uu.tLevel.value = this.down[i].texture;
      uu.uTexel.value.set(1 / coarse.width, 1 / coarse.height);
      uu.uCoarse.value = i === BLOOM_MIPS - 2 ? wts[BLOOM_MIPS - 1] : 1;
      uu.uWeight.value = wts[i];
      this.draw(renderer, this.upMat, this.up[i]);
    }
    const cu = this.compMat.uniforms;
    cu.tDiffuse.value = readBuffer.texture;
    cu.tBloom.value = this.up[0].texture;
    cu.uStrength.value = this.strength * BLOOM_GAIN;
    this.draw(renderer, this.compMat, this.renderToScreen ? null : writeBuffer);
  }
  override dispose(): void {
    for (const t of [...this.down, ...this.up]) t.dispose();
    for (const m of [this.preMat, this.downMat, this.upMat, this.compMat]) m.dispose();
    this.quad.dispose();
  }
}

export function createBloom(d: PostFxDef, rt: FxRuntime): EffectHandle {
  const s = rt.quality.tier === "low" || rt.quality.tier === "medium" ? 0.5 : 1;
  const pass = new BloomPass(d, rt.width, rt.height, s);
  return {
    pass,
    setSize: (w, h) => pass.setSize(w, h),
    set(param, value) {
      if (typeof value !== "number") return;
      if (param === "strength") pass.strength = value;
      else if (param === "radius") pass.radius = value;
      else if (param === "threshold") pass.threshold = value;
      else if (param === "smoothing") pass.smoothing = value;
    },
  };
}

// ─── Lens flare (anamorphic streaks + ghosts + halo, procedural) ───────

class LensFlarePass extends Pass {
  private bright: THREE.WebGLRenderTarget;
  private a: THREE.WebGLRenderTarget;
  private b: THREE.WebGLRenderTarget;
  // Ghost / halo source: the bright pass at 1/32 resolution, heavily blurred —
  // ghosts are soft blobs, never recognisable mirrored copies of the scene.
  private g1: THREE.WebGLRenderTarget;
  private g2: THREE.WebGLRenderTarget;
  private brightMat: THREE.ShaderMaterial;
  private blurMat: THREE.ShaderMaterial;
  private compMat: THREE.ShaderMaterial;
  private quad = new FullScreenQuad();
  constructor(d: PostFxDef, w: number, h: number) {
    super();
    const lin = { minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter };
    this.g1 = halfTarget(Math.max(8, w / 32), Math.max(8, h / 32), lin);
    this.g2 = halfTarget(Math.max(8, w / 32), Math.max(8, h / 32), lin);
    // Quarter width (long streaks are cheap) but half height: streaks stay thin lines.
    this.bright = halfTarget(w / 4, h / 2);
    this.a = halfTarget(w / 4, h / 2);
    this.b = halfTarget(w / 4, h / 2);
    this.brightMat = fsMaterial(
      `uniform sampler2D tDiffuse; uniform float uThreshold; varying vec2 vUv;
      ${GLSL_COMMON}
      void main() {
        vec3 c = texture2D(tDiffuse, vUv).rgb;
        float l = a3dLuma(c);
        // Only clearly-over-threshold pixels flare (squared ramp: no haze from
        // surfaces hovering around the threshold, e.g. a lit horizon).
        float over = max(l - uThreshold, 0.0);
        // Gentle ramp over 2 × threshold: a slightly brighter source flares a bit more, no cliff.
        float r = clamp(over / (max(uThreshold, 0.1) * 2.0), 0.0, 1.0);
        float k = over / max(l, 1e-4) * r * r;
        // Fade out at the image border: edge texels are clamped by every
        // shifted lookup below and would smear into bands.
        vec2 e = smoothstep(vec2(0.0), vec2(0.04), vUv) * smoothstep(vec2(0.0), vec2(0.04), 1.0 - vUv);
        // Soft-compress very hot sources (≤ ~3): their long tails would otherwise
        // run across the whole frame.
        vec3 b = c * k;
        b /= 1.0 + a3dLuma(b) / 1.5;
        gl_FragColor = vec4(b * e.x * e.y, 1.0);
      }`,
      { tDiffuse: { value: null }, uThreshold: { value: num(d.threshold, 1.2) } },
    );
    this.blurMat = fsMaterial(
      `uniform sampler2D tDiffuse; uniform vec2 uStep; uniform float uFalloff; varying vec2 vUv;
      void main() {
        // Exponential (not Gaussian) taps: a bright core with a long thin tail.
        // Successive passes multiply the step by the tap count, so the taps of
        // one pass fill exactly the gaps of the previous one (no boxes).
        vec3 acc = vec3(0.0); float tot = 0.0;
        for (int i = -6; i <= 6; i++) {
          float w = exp(-abs(float(i)) * uFalloff);
          vec2 uv = vUv + uStep * float(i);
          float inside = step(0.0, uv.x) * step(uv.x, 1.0) * step(0.0, uv.y) * step(uv.y, 1.0);
          acc += texture2D(tDiffuse, uv).rgb * w * inside;
          tot += w;
        }
        gl_FragColor = vec4(acc / tot, 1.0);
      }`,
      { tDiffuse: { value: null }, uStep: { value: new THREE.Vector2() }, uFalloff: { value: 0.35 } },
    );
    this.compMat = fsMaterial(
      `uniform sampler2D tDiffuse; uniform sampler2D tBright; uniform sampler2D tStreak; uniform vec3 uTint;
      uniform sampler2D tGhost;
      uniform float uIntensity; uniform float uStreaks; uniform float uGhosts; uniform float uHalo; uniform float uAspect;
      varying vec2 vUv;
      void main() {
        vec4 c = texture2D(tDiffuse, vUv);
        vec3 fl = texture2D(tStreak, vUv).rgb * uTint * uStreaks * 4.0;
        vec2 fuv = vec2(1.0) - vUv;
        vec2 gv = (vec2(0.5) - fuv) * 0.42;
        vec3 ghosts = vec3(0.0);
        for (int i = 0; i < 5; i++) {
          // No wrap-around (fract made hard-edged copies at the borders): ghosts
          // outside the frame just vanish, softly.
          vec2 suv = fuv + gv * float(i);
          vec2 inb = smoothstep(vec2(0.0), vec2(0.1), suv) * smoothstep(vec2(0.0), vec2(0.1), 1.0 - suv);
          float wgt = pow(1.0 - clamp(length(vec2(0.5) - suv) / 0.7071, 0.0, 1.0), 6.0) * inb.x * inb.y;
          vec3 tint = mix(vec3(1.0, 0.75, 0.55), vec3(0.55, 0.75, 1.0), float(i) / 4.0);
          // Chromatic: each channel from a slightly different scale around the centre.
          vec2 sc = suv - 0.5;
          vec3 g = vec3(texture2D(tGhost, 0.5 + sc * 0.97).r, texture2D(tGhost, suv).g, texture2D(tGhost, 0.5 + sc * 1.03).b);
          ghosts += g * wgt * tint;
        }
        vec2 hv = normalize(gv * vec2(uAspect, 1.0) + 1e-5) * 0.42 / vec2(uAspect, 1.0);
        vec2 huv = fuv + hv;
        vec2 hin = smoothstep(vec2(0.0), vec2(0.1), huv) * smoothstep(vec2(0.0), vec2(0.1), 1.0 - huv);
        float hw = pow(1.0 - clamp(length((vec2(0.5) - huv) * vec2(uAspect, 1.0)) / 0.9, 0.0, 1.0), 5.0) * hin.x * hin.y;
        vec2 hc = huv - 0.5;
        vec3 halo = vec3(texture2D(tGhost, 0.5 + hc * 0.98).r, texture2D(tGhost, huv).g, texture2D(tGhost, 0.5 + hc * 1.02).b) * hw * vec3(0.8, 0.9, 1.0);
        fl += ghosts * uGhosts * 0.6 + halo * uHalo * 1.5;
        gl_FragColor = vec4(c.rgb + fl * uIntensity, c.a);
      }`,
      {
        tDiffuse: { value: null },
        tBright: { value: this.bright.texture },
        tGhost: { value: this.g2.texture },
        tStreak: { value: this.a.texture },
        uTint: { value: toColor(typeof d.tint === "string" ? d.tint : "#9fc4ff") },
        uIntensity: { value: num(d.intensity, 0.5) },
        uStreaks: { value: num(d.streaks, 1) },
        uGhosts: { value: num(d.ghosts, 0.5) },
        uHalo: { value: num(d.halo, 0.3) },
        uAspect: { value: w / Math.max(1, h) },
      },
    );
  }
  set(param: string, value: unknown): void {
    const u = this.compMat.uniforms;
    if (param === "tint" && typeof value === "string") u.uTint.value = toColor(value);
    if (typeof value !== "number") return;
    if (param === "threshold") this.brightMat.uniforms.uThreshold.value = value;
    else if (param === "intensity") u.uIntensity.value = value;
    else if (param === "streaks") u.uStreaks.value = value;
    else if (param === "ghosts") u.uGhosts.value = value;
    else if (param === "halo") u.uHalo.value = value;
  }
  override setSize(w: number, h: number): void {
    for (const t of [this.bright, this.a, this.b]) t.setSize(Math.max(1, Math.round(w / 4)), Math.max(1, Math.round(h / 2)));
    for (const t of [this.g1, this.g2]) t.setSize(Math.max(8, Math.round(w / 32)), Math.max(8, Math.round(h / 32)));
    this.compMat.uniforms.uAspect.value = w / Math.max(1, h);
  }
  private draw(renderer: THREE.WebGLRenderer, mat: THREE.ShaderMaterial, target: THREE.WebGLRenderTarget | null): void {
    this.quad.material = mat;
    renderer.setRenderTarget(target);
    this.quad.render(renderer);
  }
  override render(renderer: THREE.WebGLRenderer, writeBuffer: THREE.WebGLRenderTarget, readBuffer: THREE.WebGLRenderTarget): void {
    this.brightMat.uniforms.tDiffuse.value = readBuffer.texture;
    this.draw(renderer, this.brightMat, this.bright);
    const tw = 1 / this.bright.width, th = 1 / this.bright.height;
    let src = this.bright, dst = this.a;
    // Horizontal passes with steps 1, 4, 13 texels (×13 taps: one continuous
    // exponential streak, no vertical spread).
    for (const [sx, sy, fall] of [[1, 0, 0.4], [4, 0, 0.6], [13, 0, 1.2]]) {
      this.blurMat.uniforms.tDiffuse.value = src.texture;
      this.blurMat.uniforms.uFalloff.value = fall;
      this.blurMat.uniforms.uStep.value.set(tw * sx, th * sy);
      this.draw(renderer, this.blurMat, dst);
      src = dst;
      dst = dst === this.a ? this.b : this.a;
    }
    // Ghost source: bright → 1/32 res through wide separable blurs (prefiltered
    // downsample), then two more passes at the small size.
    const bu = this.blurMat.uniforms;
    const gx = 1 / this.g1.width, gy = 1 / this.g1.height;
    const ghostPasses: [THREE.WebGLRenderTarget, THREE.WebGLRenderTarget, number, number][] = [
      [this.bright, this.g1, tw * 4, 0],
      [this.g1, this.g2, 0, th * 8],
      [this.g2, this.g1, gx * 1.5, 0],
      [this.g1, this.g2, 0, gy * 1.5],
    ];
    for (const [from, to, sx, sy] of ghostPasses) {
      bu.tDiffuse.value = from.texture;
      bu.uFalloff.value = 0.25;
      bu.uStep.value.set(sx, sy);
      this.draw(renderer, this.blurMat, to);
    }
    this.compMat.uniforms.tStreak.value = src.texture;
    this.compMat.uniforms.tDiffuse.value = readBuffer.texture;
    this.draw(renderer, this.compMat, this.renderToScreen ? null : writeBuffer);
  }
  override dispose(): void {
    for (const t of [this.bright, this.a, this.b, this.g1, this.g2]) t.dispose();
    this.brightMat.dispose();
    this.blurMat.dispose();
    this.compMat.dispose();
    this.quad.dispose();
  }
}

export function createLensflare(d: PostFxDef, rt: FxRuntime): EffectHandle {
  const pass = new LensFlarePass(d, rt.width, rt.height);
  return { pass, set: (p, v) => pass.set(p, v) };
}
