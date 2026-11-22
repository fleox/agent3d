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
          fragColor = vec4(tm(fg.rgb) + bg.rgb * (1.0 - a), a + bg.a * (1.0 - a));
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
    if (bg) renderer.render(bgs, this.camera);
    renderer.setClearColor(prevClear, prevAlpha);
    bgs.background = null;
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
