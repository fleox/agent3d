// Post-processing (loaded lazily only when scene.postfx is set): EffectComposer
// with RenderPass → effects in the declared order → OutputPass (tone mapping +
// sRGB). One factory per CATALOG.postfx id.

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
  composer.addPass(new RenderPass(scene, camera));
  // Degenerate normals (text bevels, extrusions) can produce NaN / Inf pixels in
  // the HDR target; bloom would spread one into a screen-wide white flash.
  const sanitize = new ShaderPass({
    uniforms: { tDiffuse: { value: null } },
    vertexShader: "varying vec2 vUv;\nvoid main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }",
    fragmentShader: "uniform sampler2D tDiffuse;\nvarying vec2 vUv;\nvoid main() {\n  vec4 c = texture2D(tDiffuse, vUv);\n  bvec4 bad = bvec4(isnan(c.r) || isinf(c.r), isnan(c.g) || isinf(c.g), isnan(c.b) || isinf(c.b), isnan(c.a) || isinf(c.a));\n  c = vec4(bad.r ? 0.0 : c.r, bad.g ? 0.0 : c.g, bad.b ? 0.0 : c.b, bad.a ? 1.0 : c.a);\n  gl_FragColor = vec4(min(c.rgb, vec3(32.0)), c.a);\n}",
  });
  composer.addPass(sanitize);
  const handles: EffectHandle[] = [];
  // Outlines read the un-bloomed image: run them first.
  const ordered = [...defs].sort((a, b) => (a.type === "outline" ? -1 : 0) - (b.type === "outline" ? -1 : 0));
  for (const d of ordered) {
    const impl = POSTFX_IMPLS[d.type];
    if (!impl) {
      onUnknown(d.type);
      continue;
    }
    const h = impl(d, ctx);
    handles.push(h);
    composer.addPass(h.pass);
  }
  composer.addPass(new OutputPass());
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
      composer.dispose();
      rt.dispose();
    },
  };
}
