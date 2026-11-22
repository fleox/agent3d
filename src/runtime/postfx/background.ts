// Tone mapping + background. Tone maps the scene (premultiplied, alpha =
// coverage) and composites the scene background under it:
// out = tm(fg) + bg * (1 - a). The background is rendered by three itself into
// its own target (colour, flat texture, equirect / cube, blurriness and
// rotation behave as without post effects); linear (HDR) texture backgrounds
// are tone mapped, as three does on screen; colour / sRGB backgrounds stay the
// exact CSS colour. Also sanitises NaN / Inf pixels (degenerate normals).

import * as THREE from "three";
import { FullScreenQuad, Pass } from "three/addons/postprocessing/Pass.js";
import type { Cam } from "./common";

const TONE_DEFINES: Partial<Record<THREE.ToneMapping, string>> = {
  [THREE.LinearToneMapping]: "LINEAR_TONE_MAPPING",
  [THREE.ReinhardToneMapping]: "REINHARD_TONE_MAPPING",
  [THREE.CineonToneMapping]: "CINEON_TONE_MAPPING",
  [THREE.ACESFilmicToneMapping]: "ACES_FILMIC_TONE_MAPPING",
  [THREE.AgXToneMapping]: "AGX_TONE_MAPPING",
  [THREE.NeutralToneMapping]: "NEUTRAL_TONE_MAPPING",
  [THREE.CustomToneMapping]: "CUSTOM_TONE_MAPPING",
};

export const SANITIZE_GLSL = `
vec4 a3dSanitize(vec4 c) {
  bvec4 bad = bvec4(isnan(c.r) || isinf(c.r), isnan(c.g) || isinf(c.g), isnan(c.b) || isinf(c.b), isnan(c.a) || isinf(c.a));
  c = vec4(bad.r ? 0.0 : c.r, bad.g ? 0.0 : c.g, bad.b ? 0.0 : c.b, bad.a ? 1.0 : c.a);
  return vec4(clamp(c.rgb, vec3(0.0), vec3(64.0)), clamp(c.a, 0.0, 1.0));
}`;

export class BackgroundPass extends Pass {
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
      glslVersion: THREE.GLSL3,
      uniforms: { tDiffuse: { value: null }, tBackground: { value: this.target.texture }, toneMappingExposure: { value: 1 }, uToneBg: { value: 0 } },
      vertexShader: `precision highp float;
        uniform mat4 modelViewMatrix; uniform mat4 projectionMatrix; in vec3 position; in vec2 uv; out vec2 vUv;
        void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: `precision highp float;
        uniform sampler2D tDiffuse; uniform sampler2D tBackground; uniform float uToneBg;
        #include <tonemapping_pars_fragment>
        ${SANITIZE_GLSL}
        in vec2 vUv;
        out vec4 fragColor;
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
          vec4 fg = a3dSanitize(texture(tDiffuse, vUv));
          vec4 bg = texture(tBackground, vUv);
          if (uToneBg > 0.5) bg.rgb = tm(bg.rgb);
          float a = fg.a;
          // fg is premultiplied. Tone-mapping the premultiplied value pushes
          // partly covered pixels (antialiased / supersampled edges, thin text)
          // into the curve's toe: dark text on a light background came out
          // greyed and hue-shifted. Tone-map the un-premultiplied colour and
          // re-apply the coverage; keep the old term where it is larger
          // (additive glow drawn over transparency has alpha ≈ 0).
          vec3 covered = a > 1e-3 ? tm(fg.rgb / a) * a : vec3(0.0);
          vec3 rgb = max(covered, tm(fg.rgb)) + bg.rgb * (1.0 - a);
          // Light added over empty pixels (bloom, flares, god rays) on a
          // transparent background: its brightest channel becomes coverage, so
          // the glow survives compositing / PNG export (rgb stays ≤ alpha).
          float outA = a + bg.a * (1.0 - a);
          outA = max(outA, min(1.0, max(rgb.r, max(rgb.g, rgb.b))));
          fragColor = vec4(rgb, outA);
        }`,
    });
    this.quad = new FullScreenQuad(this.mat);
  }
  override setSize(w: number, h: number): void {
    this.target.setSize(w, h);
  }
  private fresh = false;
  /** The background alone (linear HDR, no tone mapping), as last drawn. */
  get texture(): THREE.Texture {
    return this.target.texture;
  }
  /** Draw the background now (before the scene: transmission / reflections sample it). */
  prepare(renderer: THREE.WebGLRenderer): void {
    this.drawBackground(renderer);
    this.fresh = true;
  }
  private drawBackground(renderer: THREE.WebGLRenderer): void {
    const bg = this.scene.background;
    const bgs = this.bgScene;
    bgs.background = bg;
    bgs.backgroundBlurriness = this.scene.backgroundBlurriness;
    bgs.backgroundIntensity = this.scene.backgroundIntensity;
    bgs.backgroundRotation.copy(this.scene.backgroundRotation);
    const prevClear = renderer.getClearColor(new THREE.Color());
    const prevAlpha = renderer.getClearAlpha();
    const prevTarget = renderer.getRenderTarget();
    renderer.setClearColor(this.clearColor, this.clearAlpha);
    renderer.setRenderTarget(this.target);
    renderer.clear();
    if (bg) renderer.render(bgs, this.camera);
    renderer.setClearColor(prevClear, prevAlpha);
    renderer.setRenderTarget(prevTarget);
    bgs.background = null;
  }
  override render(renderer: THREE.WebGLRenderer, writeBuffer: THREE.WebGLRenderTarget, readBuffer: THREE.WebGLRenderTarget): void {
    if (this.toneMapping !== renderer.toneMapping) {
      this.toneMapping = renderer.toneMapping;
      const def = TONE_DEFINES[renderer.toneMapping];
      this.mat.defines = def ? { [def]: "" } : {};
      this.mat.needsUpdate = true;
    }
    if (!this.fresh) this.drawBackground(renderer);
    this.fresh = false;
    const bg = this.scene.background;
    const u = this.mat.uniforms;
    u.tDiffuse.value = readBuffer.texture;
    u.toneMappingExposure.value = renderer.toneMappingExposure;
    u.uToneBg.value = bg instanceof THREE.Texture && THREE.ColorManagement.getTransfer(bg.colorSpace) !== THREE.SRGBTransfer ? 1 : 0;
    renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
    this.quad.render(renderer);
  }
  override dispose(): void {
    this.target.dispose();
    this.mat.dispose();
    this.quad.dispose();
  }
}

// The post-processing pipeline renders the scene WITHOUT its background (the
// BackgroundPass composites it after tone mapping). three's transmission pass
// then sees no background and clears its target to white: glass in front of a
// dark backdrop read as opaque white porcelain. This full-screen quad draws the
// background texture (BackgroundPass.prepare) as the first opaque object of
// every render of the scene EXCEPT the main pass into `mainTarget`: the
// transmission target and planar reflections get the real backdrop.
export class SceneBackdrop {
  readonly mesh: THREE.Mesh;
  private mat: THREE.ShaderMaterial;
  mainTarget: THREE.WebGLRenderTarget | null = null;
  constructor(texture: THREE.Texture) {
    this.mat = new THREE.ShaderMaterial({
      uniforms: { tBg: { value: texture }, uShow: { value: 0 } },
      vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.99999, 1.0); }`,
      fragmentShader: `uniform sampler2D tBg; uniform float uShow; varying vec2 vUv;
        void main() { if (uShow < 0.5) discard; vec4 c = texture2D(tBg, vUv); gl_FragColor = vec4(c.rgb, 1.0); }`,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    });
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.mat);
    this.mesh.name = "__a3dBackdrop";
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -1e9;
    this.mesh.visible = false;
    this.mesh.userData.a3dHelper = true;
    this.mesh.onBeforeRender = (renderer, scene) => {
      // Not in the main pass, nor in a mirror pass (it renders the real background).
      this.mat.uniforms.uShow.value = renderer.getRenderTarget() === this.mainTarget || scene.userData.a3dReflecting ? 0 : 1;
    };
  }
  dispose(): void {
    this.mesh.removeFromParent();
    this.mesh.geometry.dispose();
    this.mat.dispose();
  }
}

// True when a visible mesh of the scene uses a transmissive material.
export function hasTransmission(scene: THREE.Object3D): boolean {
  let found = false;
  scene.traverseVisible((o) => {
    if (found) return;
    const m = (o as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
    if (!m) return;
    for (const x of Array.isArray(m) ? m : [m]) if ((x as THREE.MeshPhysicalMaterial).transmission > 0) found = true;
  });
  return found;
}
