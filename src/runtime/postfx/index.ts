// Post-processing (loaded lazily only when scene.postfx is set). One factory
// per CATALOG.postfx id. Pipeline (EffectComposer):
//   RenderPass (scene WITHOUT its background, transparent clear, HDR)
//   → sanitize → HDR effects (outline, bloom, dof) in the declared order
//   → BackgroundPass: tone mapping of the scene + the background composited
//     under it untouched (exact CSS colour, like the non-postfx path, where
//     three never tone maps a colour / sRGB background)
//   → screen effects (vignette, film, chromatic, pixelate) in the declared order
//   → OutputPass without tone mapping (sRGB only).

import * as THREE from "three";
import { BokehPass } from "three/addons/postprocessing/BokehPass.js";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { FilmPass } from "three/addons/postprocessing/FilmPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { FullScreenQuad, Pass } from "three/addons/postprocessing/Pass.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { ShaderPass } from "three/addons/postprocessing/ShaderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { RGBShiftShader } from "three/addons/shaders/RGBShiftShader.js";
import type { PostFxDef } from "../../core/types";
import { bool, num, toColor } from "../util";

type Cam = THREE.PerspectiveCamera | THREE.OrthographicCamera;

export interface PostFxContext {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: Cam;
  width: number;
  height: number;
}

export interface EffectHandle {
  pass: Pass;
  update?(t: number): void;
  setSize?(w: number, h: number): void;
}

// Hide helpers (sky dome, grids, particles) while a pass renders the scene
// with an override material (depth / normals).
function withoutHelpers(scene: THREE.Scene, fn: () => void, hideGround = false): void {
  const hidden: THREE.Object3D[] = [];
  scene.traverse((o) => {
    if (o.visible && ((o.userData.helper && (hideGround || !o.userData.ground)) || (o as THREE.Points).isPoints || (o as THREE.Sprite).isSprite)) {
      hidden.push(o);
      o.visible = false;
    }
  });
  const bg = scene.background;
  scene.background = null;
  try {
    fn();
  } finally {
    scene.background = bg;
    for (const o of hidden) o.visible = true;
  }
}

// ─── Custom passes ─────────────────────────────────────────────────────

const PixelateShader = {
  name: "PixelateShader",
  uniforms: { tDiffuse: { value: null }, uResolution: { value: new THREE.Vector2(1, 1) }, uPixel: { value: 4 } },
  vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: `uniform sampler2D tDiffuse; uniform vec2 uResolution; uniform float uPixel; varying vec2 vUv;
    void main() { vec2 cell = uPixel / uResolution; vec2 uv = (floor(vUv / cell) + 0.5) * cell; gl_FragColor = texture2D(tDiffuse, uv); }`,
};

// Vignette that never goes negative (the addon's shader can, on HDR input).
const VignetteShader = {
  name: "Agent3DVignette",
  uniforms: { tDiffuse: { value: null }, offset: { value: 1 }, darkness: { value: 1.1 } },
  vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: `uniform sampler2D tDiffuse; uniform float offset; uniform float darkness; varying vec2 vUv;
    void main() {
      vec4 texel = texture2D(tDiffuse, vUv);
      float d = length(vUv - 0.5) * 1.4142;
      float v = 1.0 - clamp(darkness * 0.65 * smoothstep(0.3 * offset, 1.1 * offset, d), 0.0, 1.0);
      gl_FragColor = vec4(texel.rgb * v, texel.a);
    }`,
};

// Toon outlines: edges from a depth + normal pre-pass (Sobel-like cross filter).
class ToonOutlinePass extends Pass {
  private target: THREE.WebGLRenderTarget;
  private normalMat = new THREE.MeshNormalMaterial();
  private quad: FullScreenQuad;
  private mat: THREE.ShaderMaterial;
  constructor(private scene: THREE.Scene, private camera: Cam, color: THREE.Color, thickness: number, w: number, h: number) {
    super();
    this.target = new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType });
    this.target.depthTexture = new THREE.DepthTexture(w, h);
    this.mat = new THREE.ShaderMaterial({
      uniforms: {
        tDiffuse: { value: null },
        tNormal: { value: this.target.texture },
        tDepth: { value: this.target.depthTexture },
        uResolution: { value: new THREE.Vector2(w, h) },
        uColor: { value: color },
        uThickness: { value: thickness },
        uNear: { value: 0.1 },
        uFar: { value: 1000 },
        uOrtho: { value: 0 },
      },
      vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: `
        uniform sampler2D tDiffuse; uniform sampler2D tNormal; uniform sampler2D tDepth;
        uniform vec2 uResolution; uniform vec3 uColor; uniform float uThickness; uniform float uNear; uniform float uFar; uniform float uOrtho;
        varying vec2 vUv;
        float lin(vec2 uv) {
          float d = texture2D(tDepth, uv).x;
          if (uOrtho > 0.5) return mix(uNear, uFar, d);
          float z = d * 2.0 - 1.0;
          return 2.0 * uNear * uFar / (uFar + uNear - z * (uFar - uNear));
        }
        void main() {
          vec4 base = texture2D(tDiffuse, vUv);
          vec2 o = uThickness / uResolution;
          float d0 = lin(vUv);
          float dd = abs(lin(vUv + vec2(o.x, 0.0)) - d0) + abs(lin(vUv - vec2(o.x, 0.0)) - d0) + abs(lin(vUv + vec2(0.0, o.y)) - d0) + abs(lin(vUv - vec2(0.0, o.y)) - d0);
          vec3 n0 = texture2D(tNormal, vUv).xyz;
          float nd = length(texture2D(tNormal, vUv + vec2(o.x, 0.0)).xyz - n0) + length(texture2D(tNormal, vUv - vec2(o.x, 0.0)).xyz - n0) + length(texture2D(tNormal, vUv + vec2(0.0, o.y)).xyz - n0) + length(texture2D(tNormal, vUv - vec2(0.0, o.y)).xyz - n0);
          float edge = max(smoothstep(0.04, 0.12, dd / max(d0, 1e-3)), smoothstep(0.5, 0.9, nd));
          gl_FragColor = vec4(mix(base.rgb, uColor, edge), base.a);
        }`,
    });
    this.quad = new FullScreenQuad(this.mat);
  }
  override setSize(w: number, h: number): void {
    this.target.setSize(w, h);
    this.mat.uniforms.uResolution.value.set(w, h);
  }
  override render(renderer: THREE.WebGLRenderer, writeBuffer: THREE.WebGLRenderTarget, readBuffer: THREE.WebGLRenderTarget): void {
    const prevOverride = this.scene.overrideMaterial;
    const prevClear = renderer.getClearColor(new THREE.Color());
    const prevAlpha = renderer.getClearAlpha();
    withoutHelpers(this.scene, () => {
      this.scene.overrideMaterial = this.normalMat;
      renderer.setRenderTarget(this.target);
      renderer.setClearColor(0x000000, 0);
      renderer.clear();
      renderer.render(this.scene, this.camera);
    }, true);
    this.scene.overrideMaterial = prevOverride;
    renderer.setClearColor(prevClear, prevAlpha);
    const u = this.mat.uniforms;
    u.tDiffuse.value = readBuffer.texture;
    u.uNear.value = this.camera.near;
    u.uFar.value = this.camera.far;
    u.uOrtho.value = (this.camera as THREE.OrthographicCamera).isOrthographicCamera ? 1 : 0;
    renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
    if (this.clear) renderer.clear();
    this.quad.render(renderer);
  }
  override dispose(): void {
    this.target.dispose();
    this.normalMat.dispose();
    this.mat.dispose();
    this.quad.dispose();
  }
}

// Tone maps the scene (premultiplied, alpha = coverage) and composites the
// scene background under it: out = tm(fg) + bg * (1 - a). The background is
// rendered by three itself into its own target (colour, flat texture, equirect
// / cube, blurriness and rotation all behave as without post effects); linear
// (HDR) texture backgrounds are tone mapped, as three does on screen.
const TONE_DEFINES: Partial<Record<THREE.ToneMapping, string>> = {
  [THREE.LinearToneMapping]: "LINEAR_TONE_MAPPING",
  [THREE.ReinhardToneMapping]: "REINHARD_TONE_MAPPING",
  [THREE.CineonToneMapping]: "CINEON_TONE_MAPPING",
  [THREE.ACESFilmicToneMapping]: "ACES_FILMIC_TONE_MAPPING",
  [THREE.AgXToneMapping]: "AGX_TONE_MAPPING",
  [THREE.NeutralToneMapping]: "NEUTRAL_TONE_MAPPING",
  [THREE.CustomToneMapping]: "CUSTOM_TONE_MAPPING",
};

class BackgroundPass extends Pass {
  private bgScene = new THREE.Scene();
  private target: THREE.WebGLRenderTarget;
  private quad: FullScreenQuad;
  private mat: THREE.RawShaderMaterial;
  private toneMapping: THREE.ToneMapping | null = null;
  /** Clear colour / alpha of the renderer before the passes ran (no scene.background). */
  clearColor = new THREE.Color(0, 0, 0);
  clearAlpha = 0;
  constructor(private scene: THREE.Scene, private camera: Cam, w: number, h: number) {
    super();
    this.target = new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType });
    this.mat = new THREE.RawShaderMaterial({
      uniforms: { tDiffuse: { value: null }, tBackground: { value: this.target.texture }, toneMappingExposure: { value: 1 }, uToneBg: { value: 0 } },
      vertexShader: `precision highp float;
        uniform mat4 modelViewMatrix; uniform mat4 projectionMatrix; attribute vec3 position; attribute vec2 uv; varying vec2 vUv;
        void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: `precision highp float;
        uniform sampler2D tDiffuse; uniform sampler2D tBackground; uniform float uToneBg;
        #include <tonemapping_pars_fragment>
        varying vec2 vUv;
        vec3 tm(vec3 c) {
          #if defined(LINEAR_TONE_MAPPING)
            return LinearToneMapping(c);
          #elif defined(REINHARD_TONE_MAPPING)
            return ReinhardToneMapping(c);
          #elif defined(CINEON_TONE_MAPPING)
            return CineonToneMapping(c);
          #elif defined(ACES_FILMIC_TONE_MAPPING)
            return ACESFilmicToneMapping(c);
          #elif defined(AGX_TONE_MAPPING)
            return AgXToneMapping(c);
          #elif defined(NEUTRAL_TONE_MAPPING)
            return NeutralToneMapping(c);
          #elif defined(CUSTOM_TONE_MAPPING)
            return CustomToneMapping(c);
          #else
            return c;
          #endif
        }
        void main() {
          vec4 fg = texture2D(tDiffuse, vUv);
          vec4 bg = texture2D(tBackground, vUv);
          if (uToneBg > 0.5) bg.rgb = tm(bg.rgb);
          float a = clamp(fg.a, 0.0, 1.0);
          gl_FragColor = vec4(tm(fg.rgb) + bg.rgb * (1.0 - a), a + bg.a * (1.0 - a));
        }`,
    });
    this.quad = new FullScreenQuad(this.mat);
  }
  override setSize(w: number, h: number): void {
    this.target.setSize(w, h);
  }
  override render(renderer: THREE.WebGLRenderer, writeBuffer: THREE.WebGLRenderTarget, readBuffer: THREE.WebGLRenderTarget): void {
    if (this.toneMapping !== renderer.toneMapping) {
      this.toneMapping = renderer.toneMapping;
      const def = TONE_DEFINES[renderer.toneMapping];
      this.mat.defines = def ? { [def]: "" } : {};
      this.mat.needsUpdate = true;
    }
    const bg = this.scene.background;
    const bgs = this.bgScene;
    bgs.background = bg;
    bgs.backgroundBlurriness = this.scene.backgroundBlurriness;
    bgs.backgroundIntensity = this.scene.backgroundIntensity;
    bgs.backgroundRotation.copy(this.scene.backgroundRotation);
    const prevClear = renderer.getClearColor(new THREE.Color());
    const prevAlpha = renderer.getClearAlpha();
    renderer.setClearColor(this.clearColor, this.clearAlpha);
    renderer.setRenderTarget(this.target);
    renderer.clear();
    renderer.render(bgs, this.camera);
    renderer.setClearColor(prevClear, prevAlpha);
    bgs.background = null;
    const u = this.mat.uniforms;
    u.tDiffuse.value = readBuffer.texture;
    u.toneMappingExposure.value = renderer.toneMappingExposure;
    u.uToneBg.value = bg instanceof THREE.Texture && THREE.ColorManagement.getTransfer(bg.colorSpace) !== THREE.SRGBTransfer ? 1 : 0;
    renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
    if (this.clear) renderer.clear();
    this.quad.render(renderer);
  }
  override dispose(): void {
    this.target.dispose();
    this.mat.dispose();
    this.quad.dispose();
  }
}

// sRGB conversion only (tone mapping already happened in BackgroundPass).
class SrgbOutputPass extends OutputPass {
  override render(renderer: THREE.WebGLRenderer, writeBuffer: THREE.WebGLRenderTarget, readBuffer: THREE.WebGLRenderTarget, deltaTime?: number, maskActive?: boolean): void {
    const tm = renderer.toneMapping;
    renderer.toneMapping = THREE.NoToneMapping;
    try {
      super.render(renderer, writeBuffer, readBuffer, deltaTime ?? 0, maskActive ?? false);
    } finally {
      renderer.toneMapping = tm;
    }
  }
}

// Effects that need the HDR, background-free image (before tone mapping).
const HDR_EFFECTS = new Set(["outline", "bloom", "dof"]);

// ─── Effect factories ──────────────────────────────────────────────────

export const POSTFX_IMPLS: Record<string, (def: PostFxDef, ctx: PostFxContext) => EffectHandle> = {
  bloom: (d, c) => ({ pass: new UnrealBloomPass(new THREE.Vector2(c.width, c.height), num(d.strength, 0.8), num(d.radius, 0.4), num(d.threshold, 0.85)) }),
  vignette: (d) => {
    const pass = new ShaderPass(VignetteShader);
    pass.uniforms.offset.value = num(d.offset, 1);
    pass.uniforms.darkness.value = num(d.darkness, 1.1);
    return { pass };
  },
  film: (d) => {
    const pass = new FilmPass(num(d.intensity, 0.35), bool(d.grayscale, false));
    const u = (pass as unknown as { uniforms: Record<string, THREE.IUniform> }).uniforms;
    return {
      pass,
      update(t) {
        // FilmPass adds deltaTime itself; composer.render(0) keeps it a function of t.
        u.time.value = t;
      },
    };
  },
  chromatic: (d) => {
    const pass = new ShaderPass(RGBShiftShader);
    pass.uniforms.amount.value = num(d.amount, 0.002);
    pass.uniforms.angle.value = 0.6;
    return { pass };
  },
  pixelate: (d, c) => {
    const pass = new ShaderPass(PixelateShader);
    pass.uniforms.uPixel.value = Math.max(1, num(d.pixelSize, 4)) * c.renderer.getPixelRatio();
    const res = pass.uniforms.uResolution.value as THREE.Vector2;
    res.set(c.width * c.renderer.getPixelRatio(), c.height * c.renderer.getPixelRatio());
    return { pass, setSize: (w, h) => res.set(w, h) };
  },
  outline: (d, c) => {
    const pr = c.renderer.getPixelRatio();
    return { pass: new ToonOutlinePass(c.scene, c.camera, toColor(String(d.color ?? "#000000")), num(d.thickness, 1) * pr, c.width * pr, c.height * pr) };
  },
  dof: (d, c) => {
    const pass = new BokehPass(c.scene, c.camera, { focus: num(d.focus, 8), aperture: num(d.aperture, 0.002), maxblur: num(d.maxblur, 0.01) });
    const orig = pass.render.bind(pass);
    pass.render = (...args: Parameters<typeof orig>) => withoutHelpers(c.scene, () => orig(...args));
    return { pass };
  },
};

export interface PostFxPipeline {
  render(t: number): void;
  setSize(w: number, h: number): void;
  dispose(): void;
}

export function createPostFx(defs: PostFxDef[], ctx: PostFxContext, onUnknown: (id: string) => void): PostFxPipeline {
  const { renderer, scene, camera } = ctx;
  const pr = renderer.getPixelRatio();
  const rt = new THREE.WebGLRenderTarget(Math.max(1, ctx.width * pr), Math.max(1, ctx.height * pr), { type: THREE.HalfFloatType, samples: 4 });
  const composer = new EffectComposer(renderer, rt);
  composer.setPixelRatio(pr);
  composer.setSize(ctx.width, ctx.height);
  // The scene renders without its background onto a transparent clear: the
  // background is composited back, untouched, after tone mapping.
  const renderPass = new RenderPass(scene, camera, null, new THREE.Color(0, 0, 0), 0);
  const bgPass = new BackgroundPass(scene, camera, Math.max(1, ctx.width * pr), Math.max(1, ctx.height * pr));
  const baseRender = renderPass.render.bind(renderPass);
  renderPass.render = (...args: Parameters<typeof baseRender>) => {
    const bg = scene.background;
    bgPass.clearColor.copy(args[0].getClearColor(new THREE.Color()));
    bgPass.clearAlpha = args[0].getClearAlpha();
    scene.background = null;
    try {
      baseRender(...args);
    } finally {
      scene.background = bg;
    }
  };
  composer.addPass(renderPass);
  // Degenerate normals (text bevels, extrusions) can produce NaN / Inf pixels in
  // the HDR target; bloom would spread one into a screen-wide white flash.
  const sanitize = new ShaderPass({
    uniforms: { tDiffuse: { value: null } },
    vertexShader: "varying vec2 vUv;\nvoid main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }",
    fragmentShader: "uniform sampler2D tDiffuse;\nvarying vec2 vUv;\nvoid main() {\n  vec4 c = texture2D(tDiffuse, vUv);\n  bvec4 bad = bvec4(isnan(c.r) || isinf(c.r), isnan(c.g) || isinf(c.g), isnan(c.b) || isinf(c.b), isnan(c.a) || isinf(c.a));\n  c = vec4(bad.r ? 0.0 : c.r, bad.g ? 0.0 : c.g, bad.b ? 0.0 : c.b, bad.a ? 1.0 : c.a);\n  gl_FragColor = vec4(min(c.rgb, vec3(32.0)), c.a);\n}",
  });
  composer.addPass(sanitize);
  const handles: EffectHandle[] = [];
  // Outlines read the un-bloomed image: run them first. HDR effects run before
  // tone mapping + background, screen effects after (they apply to the whole frame).
  const ordered = [...defs].sort((a, b) => (a.type === "outline" ? -1 : 0) - (b.type === "outline" ? -1 : 0));
  const add = (d: PostFxDef) => {
    const impl = POSTFX_IMPLS[d.type];
    if (!impl) {
      onUnknown(d.type);
      return;
    }
    const h = impl(d, ctx);
    handles.push(h);
    composer.addPass(h.pass);
  };
  for (const d of ordered) if (HDR_EFFECTS.has(d.type)) add(d);
  composer.addPass(bgPass);
  for (const d of ordered) if (!HDR_EFFECTS.has(d.type)) add(d);
  composer.addPass(new SrgbOutputPass());
  return {
    render(t) {
      for (const h of handles) h.update?.(t);
      composer.render(0);
    },
    setSize(w, h) {
      composer.setPixelRatio(renderer.getPixelRatio());
      composer.setSize(w, h);
      const p = renderer.getPixelRatio();
      for (const hd of handles) hd.setSize?.(w * p, h * p);
    },
    dispose() {
      for (const h of handles) h.pass.dispose();
      bgPass.dispose();
      composer.dispose();
      rt.dispose();
    },
  };
}
