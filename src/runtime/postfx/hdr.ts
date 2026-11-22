// HDR scene effects (before tone mapping, on the background-free scene image,
// premultiplied alpha): ao, outline, godrays, dof, bloom, lensflare.

import * as THREE from "three";
import { GTAOPass } from "three/addons/postprocessing/GTAOPass.js";
import { FullScreenQuad, Pass } from "three/addons/postprocessing/Pass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
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

class GodraysPass extends Pass {
  private mask: THREE.WebGLRenderTarget;
  private rays: THREE.WebGLRenderTarget;
  private maskMat: THREE.ShaderMaterial;
  private raysMat: THREE.ShaderMaterial;
  private compMat: THREE.ShaderMaterial;
  private quad = new FullScreenQuad();
  private srcColor = new THREE.Color();
  private visible = 1;
  private d: PostFxDef;
  constructor(private rt: FxRuntime, def: PostFxDef) {
    super();
    const d = (this.d = { ...def });
    const s = rt.quality.effectScale;
    this.mask = halfTarget(rt.width * s, rt.height * s);
    this.rays = halfTarget(rt.width * s, rt.height * s);
    const src = { value: new THREE.Vector2(0.5, 1.1) };
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
        float wide = pow(max(0.0, 1.0 - dist / max(uSize * 4.0, 1e-3)), 3.0);
        vec3 sky = c * smoothstep(0.6, 2.0, a3dLuma(c)) * wide;
        gl_FragColor = vec4(far * (uColor * glow * 1.2 + sky * 0.7), 1.0);
      }`,
      { tDiffuse: { value: null }, tNormal: { value: rt.gbuffer().normalTexture }, uSrc: src, uColor: { value: new THREE.Color() }, uSize: { value: 0.12 }, uAspect: { value: 1 } },
    );
    this.raysMat = fsMaterial(
      `uniform sampler2D tDiffuse; uniform vec2 uSrc; uniform float uLength; uniform float uDecay; uniform vec2 uRes;
      varying vec2 vUv;
      ${GLSL_COMMON}
      void main() {
        vec2 delta = (vUv - uSrc) * uLength / float(RAYS);
        vec2 uv = vUv - delta * a3dHash12(gl_FragCoord.xy);
        vec3 acc = vec3(0.0); float w = 1.0, tot = 0.0;
        for (int i = 0; i < RAYS; i++) {
          acc += texture2D(tDiffuse, uv).rgb * w;
          tot += w;
          w *= uDecay;
          uv -= delta;
        }
        gl_FragColor = vec4(acc / max(tot, 1e-3) * 1.6, 1.0);
      }`,
      { tDiffuse: { value: null }, uSrc: src, uLength: { value: 0.85 }, uDecay: { value: 0.96 }, uRes: { value: new THREE.Vector2() } },
      { RAYS: rt.quality.rays },
    );
    this.compMat = fsMaterial(
      `uniform sampler2D tDiffuse; uniform sampler2D tRays; uniform float uIntensity;
      varying vec2 vUv;
      void main() { vec4 c = texture2D(tDiffuse, vUv); gl_FragColor = vec4(c.rgb + texture2D(tRays, vUv).rgb * uIntensity, c.a); }`,
      { tDiffuse: { value: null }, tRays: { value: this.rays.texture }, uIntensity: { value: 0.6 } },
    );
    this.raysMat.uniforms.uDecay.value = Math.min(1, Math.max(0.5, num(d.decay, 0.96)));
    this.raysMat.uniforms.uLength.value = Math.min(1, Math.max(0, num(d.length, 0.85)));
    this.maskMat.uniforms.uSize.value = num(d.size, 0.1);
  }

  set(param: string, value: unknown): void {
    this.d[param] = value;
    if (typeof value !== "number") return;
    if (param === "decay") this.raysMat.uniforms.uDecay.value = Math.min(1, Math.max(0.5, value));
    else if (param === "length") this.raysMat.uniforms.uLength.value = Math.min(1, Math.max(0, value));
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
      if (u && u.uSun?.value > 0) {
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
    } else src.set(0.5, 1.15);
    this.visible = vis;
    this.srcColor.copy(typeof this.d.color === "string" ? toColor(this.d.color) : color ?? new THREE.Color(1, 0.95, 0.85));
  }

  override setSize(w: number, h: number): void {
    const s = this.rt.quality.effectScale;
    this.mask.setSize(Math.max(1, Math.round(w * s)), Math.max(1, Math.round(h * s)));
    this.rays.setSize(Math.max(1, Math.round(w * s)), Math.max(1, Math.round(h * s)));
    this.maskMat.uniforms.uAspect.value = w / Math.max(1, h);
  }

  override render(renderer: THREE.WebGLRenderer, writeBuffer: THREE.WebGLRenderTarget, readBuffer: THREE.WebGLRenderTarget): void {
    this.rt.gbuffer().ensure(renderer, this.rt.scene, this.rt.camera, this.rt.frame());
    this.maskMat.uniforms.uAspect.value = readBuffer.width / Math.max(1, readBuffer.height);
    this.maskMat.uniforms.tDiffuse.value = readBuffer.texture;
    (this.maskMat.uniforms.uColor.value as THREE.Color).copy(this.srcColor);
    this.quad.material = this.maskMat;
    renderer.setRenderTarget(this.mask);
    this.quad.render(renderer);
    this.raysMat.uniforms.tDiffuse.value = this.mask.texture;
    this.quad.material = this.raysMat;
    renderer.setRenderTarget(this.rays);
    this.quad.render(renderer);
    this.compMat.uniforms.tDiffuse.value = readBuffer.texture;
    this.compMat.uniforms.uIntensity.value = num(this.d.intensity, 0.6) * this.visible;
    this.quad.material = this.compMat;
    renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
    this.quad.render(renderer);
  }

  override dispose(): void {
    this.mask.dispose();
    this.rays.dispose();
    this.maskMat.dispose();
    this.raysMat.dispose();
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

// ─── Bloom (UnrealBloom: threshold + 5-level mip blur) ─────────────────

export function createBloom(d: PostFxDef, rt: FxRuntime): EffectHandle {
  const s = rt.quality.tier === "low" || rt.quality.tier === "medium" ? 0.5 : 1;
  const pass = new UnrealBloomPass(new THREE.Vector2(rt.width * s, rt.height * s), num(d.strength, 0.8), num(d.radius, 0.4), num(d.threshold, 0.85));
  const hp = (pass as unknown as { highPassUniforms: Record<string, THREE.IUniform> }).highPassUniforms;
  hp.smoothWidth.value = Math.max(0.001, num(d.smoothing, 0.1));
  return {
    pass,
    setSize: (w, h) => pass.setSize(Math.max(1, Math.round(w * s)), Math.max(1, Math.round(h * s))),
    set(param, value) {
      if (typeof value !== "number") return;
      if (param === "strength") pass.strength = value;
      else if (param === "radius") pass.radius = value;
      else if (param === "threshold") pass.threshold = value;
      else if (param === "smoothing") hp.smoothWidth.value = Math.max(0.001, value);
    },
  };
}

// ─── Lens flare (anamorphic streaks + ghosts + halo, procedural) ───────

class LensFlarePass extends Pass {
  private bright: THREE.WebGLRenderTarget;
  private a: THREE.WebGLRenderTarget;
  private b: THREE.WebGLRenderTarget;
  private brightMat: THREE.ShaderMaterial;
  private blurMat: THREE.ShaderMaterial;
  private compMat: THREE.ShaderMaterial;
  private quad = new FullScreenQuad();
  constructor(d: PostFxDef, w: number, h: number) {
    super();
    this.bright = halfTarget(w / 4, h / 4);
    this.a = halfTarget(w / 4, h / 4);
    this.b = halfTarget(w / 4, h / 4);
    this.brightMat = fsMaterial(
      `uniform sampler2D tDiffuse; uniform float uThreshold; varying vec2 vUv;
      ${GLSL_COMMON}
      void main() {
        vec3 c = texture2D(tDiffuse, vUv).rgb;
        float l = a3dLuma(c);
        float k = max(l - uThreshold, 0.0) / max(l, 1e-4);
        gl_FragColor = vec4(min(c * k, vec3(16.0)), 1.0);
      }`,
      { tDiffuse: { value: null }, uThreshold: { value: num(d.threshold, 1.2) } },
    );
    this.blurMat = fsMaterial(
      `uniform sampler2D tDiffuse; uniform vec2 uStep; varying vec2 vUv;
      void main() {
        vec3 acc = vec3(0.0); float tot = 0.0;
        for (int i = -4; i <= 4; i++) {
          float w = exp(-float(i * i) * 0.12);
          acc += texture2D(tDiffuse, vUv + uStep * float(i)).rgb * w;
          tot += w;
        }
        gl_FragColor = vec4(acc / tot, 1.0);
      }`,
      { tDiffuse: { value: null }, uStep: { value: new THREE.Vector2() } },
    );
    this.compMat = fsMaterial(
      `uniform sampler2D tDiffuse; uniform sampler2D tBright; uniform sampler2D tStreak; uniform vec3 uTint;
      uniform float uIntensity; uniform float uStreaks; uniform float uGhosts; uniform float uHalo; uniform float uAspect;
      varying vec2 vUv;
      void main() {
        vec4 c = texture2D(tDiffuse, vUv);
        vec3 fl = texture2D(tStreak, vUv).rgb * uTint * uStreaks * 2.5;
        vec2 fuv = vec2(1.0) - vUv;
        vec2 gv = (vec2(0.5) - fuv) * 0.42;
        vec3 ghosts = vec3(0.0);
        for (int i = 0; i < 5; i++) {
          vec2 suv = fract(fuv + gv * float(i));
          float wgt = pow(1.0 - clamp(length(vec2(0.5) - suv) / 0.7071, 0.0, 1.0), 6.0);
          vec3 tint = mix(vec3(1.0, 0.75, 0.55), vec3(0.55, 0.75, 1.0), float(i) / 4.0);
          ghosts += texture2D(tBright, suv).rgb * wgt * tint;
        }
        vec2 hv = normalize(gv * vec2(uAspect, 1.0) + 1e-5) * 0.42 / vec2(uAspect, 1.0);
        vec2 huv = fuv + hv;
        float hw = pow(1.0 - clamp(length((vec2(0.5) - huv) * vec2(uAspect, 1.0)) / 0.9, 0.0, 1.0), 5.0);
        vec3 halo = texture2D(tBright, huv).rgb * hw * vec3(0.8, 0.9, 1.0);
        fl += ghosts * uGhosts * 0.6 + halo * uHalo * 1.5;
        gl_FragColor = vec4(c.rgb + fl * uIntensity, c.a);
      }`,
      {
        tDiffuse: { value: null },
        tBright: { value: this.bright.texture },
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
    for (const t of [this.bright, this.a, this.b]) t.setSize(Math.max(1, Math.round(w / 4)), Math.max(1, Math.round(h / 4)));
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
    // A slight vertical soften, then three widening horizontal blurs.
    for (const [sx, sy] of [[0, 0.6], [1, 0], [3, 0], [8, 0]]) {
      this.blurMat.uniforms.tDiffuse.value = src.texture;
      this.blurMat.uniforms.uStep.value.set(tw * sx, th * sy);
      this.draw(renderer, this.blurMat, dst);
      src = dst;
      dst = dst === this.a ? this.b : this.a;
    }
    this.compMat.uniforms.tStreak.value = src.texture;
    this.compMat.uniforms.tDiffuse.value = readBuffer.texture;
    this.draw(renderer, this.compMat, this.renderToScreen ? null : writeBuffer);
  }
  override dispose(): void {
    for (const t of [this.bright, this.a, this.b]) t.dispose();
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
