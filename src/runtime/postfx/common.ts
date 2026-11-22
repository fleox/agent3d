// Shared helpers of the post-processing pipeline: fullscreen materials, the
// normal/depth pre-pass (G-buffer) shared by ao / outline / dof / godrays,
// helper hiding, deterministic noise.

import * as THREE from "three";
import { FullScreenQuad, Pass } from "three/addons/postprocessing/Pass.js";
import type { PostFxDef } from "../../core/types";
import type { QualitySettings } from "../../core/postfx";

export type Cam = THREE.PerspectiveCamera | THREE.OrthographicCamera;

export const FS_VERT = `varying vec2 vUv;
void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;

// GLSL helpers shared by several effects.
export const GLSL_COMMON = `
float a3dHash12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float a3dLuma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
`;

// Linear view depth (positive, scene units) from a [0,1] depth-buffer value.
export const GLSL_DEPTH = `
uniform float uNear; uniform float uFar; uniform float uOrtho;
float a3dViewZ(float d) {
  if (uOrtho > 0.5) return uNear + d * (uFar - uNear);
  return uNear * uFar / max(uFar - d * (uFar - uNear), 1e-6);
}
`;

export function depthUniforms(): Record<string, THREE.IUniform> {
  return { uNear: { value: 0.1 }, uFar: { value: 1000 }, uOrtho: { value: 0 } };
}

export function syncDepthUniforms(u: Record<string, THREE.IUniform>, cam: Cam): void {
  u.uNear.value = cam.near;
  u.uFar.value = cam.far;
  u.uOrtho.value = (cam as THREE.OrthographicCamera).isOrthographicCamera ? 1 : 0;
}

export function fsMaterial(fragmentShader: string, uniforms: Record<string, THREE.IUniform>, defines: Record<string, string | number> = {}): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({ uniforms, vertexShader: FS_VERT, fragmentShader, defines, depthTest: false, depthWrite: false, blending: THREE.NoBlending });
}

export function halfTarget(w: number, h: number, opts: THREE.RenderTargetOptions = {}): THREE.WebGLRenderTarget {
  return new THREE.WebGLRenderTarget(Math.max(1, Math.round(w)), Math.max(1, Math.round(h)), { type: THREE.HalfFloatType, depthBuffer: false, ...opts });
}

/** A fullscreen shader pass reading the previous image as `tDiffuse`. */
export class ShaderFxPass extends Pass {
  readonly quad: FullScreenQuad;
  constructor(readonly material: THREE.ShaderMaterial) {
    super();
    this.quad = new FullScreenQuad(material);
  }
  get uniforms(): Record<string, THREE.IUniform> {
    return this.material.uniforms;
  }
  override render(renderer: THREE.WebGLRenderer, writeBuffer: THREE.WebGLRenderTarget, readBuffer: THREE.WebGLRenderTarget): void {
    if (this.material.uniforms.tDiffuse) this.material.uniforms.tDiffuse.value = readBuffer.texture;
    renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
    this.quad.render(renderer);
  }
  override dispose(): void {
    this.material.dispose();
    this.quad.dispose();
  }
}

// Hide helpers (sky dome, grids, particles, sprites) while a pass renders the
// scene with an override material (depth / normals). The ground stays unless
// asked: it receives AO and occludes god rays.
export function withoutHelpers(scene: THREE.Scene, fn: () => void, hideGround = false): void {
  const hidden: THREE.Object3D[] = [];
  scene.traverse((o) => {
    if (o.visible && ((o.userData.helper && (hideGround || !o.userData.ground)) || (o as THREE.Points).isPoints || (o as THREE.Sprite).isSprite || (o as THREE.Line).isLine)) {
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

/**
 * Normal + depth pre-pass, rendered at most once per frame for every effect
 * that needs it. rgb = packed view-space normal (MeshNormalMaterial), a = 1 on
 * objects, 0.5 on the ground, 0 on empty pixels; depthTexture = scene depth.
 */
export class GBuffer {
  readonly target: THREE.WebGLRenderTarget;
  private normalMat = new THREE.MeshNormalMaterial();
  private groundMat = new THREE.MeshNormalMaterial({ transparent: true, opacity: 0.5, blending: THREE.NoBlending });
  private frame = -1;
  constructor(w: number, h: number) {
    this.target = new THREE.WebGLRenderTarget(Math.max(1, w), Math.max(1, h), {
      type: THREE.HalfFloatType,
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      depthTexture: new THREE.DepthTexture(Math.max(1, w), Math.max(1, h), THREE.UnsignedIntType),
    });
    this.normalMat.blending = THREE.NoBlending;
  }
  get normalTexture(): THREE.Texture {
    return this.target.texture;
  }
  get depthTexture(): THREE.DepthTexture {
    return this.target.depthTexture!;
  }
  setSize(w: number, h: number): void {
    this.target.setSize(Math.max(1, w), Math.max(1, h));
    this.frame = -1;
  }
  ensure(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: Cam, frame: number): void {
    if (this.frame === frame) return;
    this.frame = frame;
    const prevOverride = scene.overrideMaterial;
    const prevClear = renderer.getClearColor(new THREE.Color());
    const prevAlpha = renderer.getClearAlpha();
    const grounds: THREE.Mesh[] = [];
    // Normals / depth never sample shadow maps: without this, every
    // renderer.render() here re-draws every shadow caster for each
    // shadow-casting light (autoUpdate), doubling the shadow cost of scenes with
    // ao / dof / godrays / outline. The main pass renders them as before.
    const sm = renderer.shadowMap;
    const prevShadow = { auto: sm.autoUpdate, needs: sm.needsUpdate };
    sm.autoUpdate = false;
    sm.needsUpdate = false;
    withoutHelpers(scene, () => {
      scene.traverse((o) => {
        if (o.userData.ground && o.visible && (o as THREE.Mesh).isMesh) {
          grounds.push(o as THREE.Mesh);
          o.visible = false;
        }
      });
      scene.overrideMaterial = this.normalMat;
      renderer.setRenderTarget(this.target);
      renderer.setClearColor(new THREE.Color(0.5, 0.5, 1), 0);
      renderer.clear();
      renderer.render(scene, camera);
      if (grounds.length) {
        const auto = renderer.autoClear;
        renderer.autoClear = false;
        scene.overrideMaterial = this.groundMat;
        for (const g of grounds) g.visible = true;
        // Only the ground: hide everything else for this draw.
        const others: THREE.Object3D[] = [];
        scene.traverse((o) => {
          if (o.visible && (o as THREE.Mesh).isMesh && !o.userData.ground) {
            others.push(o);
            o.visible = false;
          }
        });
        renderer.render(scene, camera);
        for (const o of others) o.visible = true;
        renderer.autoClear = auto;
      }
    });
    for (const g of grounds) g.visible = true;
    sm.autoUpdate = prevShadow.auto;
    sm.needsUpdate = prevShadow.needs;
    scene.overrideMaterial = prevOverride;
    renderer.setClearColor(prevClear, prevAlpha);
  }
  dispose(): void {
    this.target.depthTexture?.dispose();
    this.target.dispose();
    this.normalMat.dispose();
    this.groundMat.dispose();
  }
}

/** Seeded RGBA noise texture (replaces addons' Math.random noise: renders stay reproducible). */
export function seededNoiseTexture(size = 64, seed = 1): THREE.DataTexture {
  let s = seed >>> 0 || 1;
  const rnd = () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return (s >>> 0) / 4294967296;
  };
  const data = new Uint8Array(size * size * 4);
  for (let i = 0; i < data.length; i++) data[i] = Math.floor(rnd() * 256);
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.needsUpdate = true;
  return tex;
}

/** What every effect factory receives. */
export interface FxRuntime {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: Cam;
  quality: QualitySettings;
  /** Pixel size of the drawing buffer. */
  width: number;
  height: number;
  pixelRatio: number;
  /** Normal/depth pre-pass, rendered on first use in the current frame. */
  gbuffer(): GBuffer;
  /** Frame counter (G-buffer caching). */
  frame(): number;
  /** The merged finish pass (chromatic, sharpen, grading, vignette, film). */
  finish: { configure(def: PostFxDef): void };
}

export interface EffectHandle {
  pass: Pass;
  update?(t: number): void;
  setSize?(w: number, h: number): void;
  ready?: Promise<void>;
  /** Live param change (timeline tracks postfx.<type>.<param>, rack focus). */
  set?(param: string, value: unknown): void;
}

export type EffectStage = "hdr" | "aa" | "ldr" | "finish" | "meta";

export interface EffectImpl {
  stage: EffectStage;
  create?(def: PostFxDef, rt: FxRuntime): EffectHandle | null;
}
