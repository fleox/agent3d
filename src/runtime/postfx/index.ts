// Post-processing (loaded lazily only when scene.postfx is set, or for a
// supersampled still). One implementation per CATALOG.postfx id. Pipeline:
//
//   scene (WITHOUT its background, transparent clear, HDR half-float, MSAA
//   per quality tier; `taa` stills: N sub-pixel-jittered renders accumulated)
//   → HDR effects in a fixed order: ao → outline → godrays → dof → bloom → lensflare
//     (sanitised first: NaN / Inf pixels would explode in bloom)
//   → BackgroundPass: tone mapping + the background composited under it
//   → antialiasing (fxaa | smaa)
//   → stylised looks in the declared order (tiltshift, pixelate, halftone, ascii, glitch)
//   → FinishPass: chromatic + sharpen + grading + vignette + film + sRGB + dither (ONE pass)
//
// Effects sharing scene data use one normal/depth pre-pass (GBuffer). Look
// presets are expanded and effects above the quality tier's cost dropped by
// src/core/postfx.ts before this runs.

import * as THREE from "three";
import type { Pass } from "three/addons/postprocessing/Pass.js";
import { FullScreenQuad } from "three/addons/postprocessing/Pass.js";
import { activePostFx, qualitySettings, type QualitySettings } from "../../core/postfx";
import type { PostFxDef } from "../../core/types";
import { num } from "../util";
import { BackgroundPass, SANITIZE_GLSL } from "./background";
import { type Cam, type EffectHandle, type EffectImpl, type FxRuntime, fsMaterial, GBuffer, ShaderFxPass } from "./common";
import { FinishPass } from "./finish";
import { createAo, createBloom, createDof, createGodrays, createLensflare, createOutline } from "./hdr";
import { createAscii, createFxaa, createGlitch, createHalftone, createPixelate, createSmaa, createTiltshift } from "./ldr";

export type { EffectHandle } from "./common";

export interface PostFxContext {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: Cam;
  /** CSS size of the canvas. */
  width: number;
  height: number;
  /** Quality settings (default: "high"). */
  quality?: QualitySettings;
  /** MSAA on the scene target (default true: target.antialias). */
  antialias?: boolean;
}

const finishOnly: EffectImpl = { stage: "finish" };

export const POSTFX_IMPLS: Record<string, EffectImpl> = {
  look: { stage: "meta" }, // expanded by expandPostFx (src/core/postfx.ts)
  taa: { stage: "meta" }, // still accumulation, read by the pipeline
  ao: { stage: "hdr", create: createAo },
  outline: { stage: "hdr", create: createOutline },
  godrays: { stage: "hdr", create: createGodrays },
  dof: { stage: "hdr", create: createDof },
  bloom: { stage: "hdr", create: createBloom },
  lensflare: { stage: "hdr", create: createLensflare },
  fxaa: { stage: "aa", create: createFxaa },
  smaa: { stage: "aa", create: createSmaa },
  tiltshift: { stage: "ldr", create: createTiltshift },
  pixelate: { stage: "ldr", create: createPixelate },
  halftone: { stage: "ldr", create: createHalftone },
  ascii: { stage: "ldr", create: createAscii },
  glitch: { stage: "ldr", create: createGlitch },
  chromatic: finishOnly,
  sharpen: finishOnly,
  grading: finishOnly,
  vignette: finishOnly,
  film: finishOnly,
};

const HDR_ORDER = ["ao", "outline", "godrays", "dof", "bloom", "lensflare"];

export interface RenderOptions {
  /** Jittered frames accumulated into this frame (supersampling). 1 = plain render. */
  samples?: number;
}

export interface PostFxPipeline {
  render(t: number, opts?: RenderOptions): void;
  setSize(w: number, h: number): void;
  dispose(): void;
  /** Resolves when every effect's resources are loaded (SMAA lookup textures). */
  ready: Promise<void>;
  /** Jittered frames `taa` asks for on stills (0 = no taa). */
  stillSamples: number;
  /** Effect ids actually running (after look expansion and the quality tier). */
  effects: string[];
  /** Effect ids dropped by the quality tier. */
  dropped: string[];
  /** Live param change of a running effect (timeline tracks postfx.<type>.<param>). */
  setParam(type: string, param: string, value: unknown): void;
}

// Halton (2, 3) sub-pixel offsets in [-0.5, 0.5).
function halton(i: number, base: number): number {
  let f = 1, r = 0;
  while (i > 0) {
    f /= base;
    r += f * (i % base);
    i = Math.floor(i / base);
  }
  return r;
}

export function createPostFx(defs: PostFxDef[], ctx: PostFxContext, onUnknown: (id: string) => void): PostFxPipeline {
  const { renderer, scene, camera } = ctx;
  const quality = ctx.quality ?? qualitySettings("high");
  const { active, dropped } = activePostFx(defs, quality.tier);
  let pr = renderer.getPixelRatio();
  let pw = Math.max(1, Math.floor(ctx.width * pr)), ph = Math.max(1, Math.floor(ctx.height * pr));
  const msaa = ctx.antialias === false ? 0 : Math.min(quality.msaa, renderer.capabilities.maxSamples ?? 4);

  const sceneTarget = new THREE.WebGLRenderTarget(pw, ph, { type: THREE.HalfFloatType, samples: msaa });
  const rtA = new THREE.WebGLRenderTarget(pw, ph, { type: THREE.HalfFloatType, depthBuffer: false });
  const rtB = rtA.clone();
  let frame = 0;
  let gbuffer: GBuffer | null = null;
  const finish = new FinishPass();
  const fx: FxRuntime = {
    renderer,
    scene,
    camera,
    quality,
    get width() {
      return pw;
    },
    get height() {
      return ph;
    },
    get pixelRatio() {
      return pr;
    },
    gbuffer: () => (gbuffer ??= new GBuffer(pw, ph)),
    frame: () => frame,
    finish,
  };

  // Build the effect handles in pipeline order.
  const handles: EffectHandle[] = [];
  const byType = new Map<string, EffectHandle>();
  const finishDefs = new Map<string, PostFxDef>();
  const names: string[] = [];
  const make = (d: PostFxDef) => {
    const impl = POSTFX_IMPLS[d.type];
    if (!impl) return void onUnknown(d.type);
    if (impl.stage === "finish") {
      finishDefs.set(d.type, { ...d });
      finish.configure(d);
      names.push(d.type);
      return;
    }
    if (impl.stage === "meta" || !impl.create) return;
    const h = impl.create(d, fx);
    if (h) {
      handles.push(h);
      byType.set(d.type, h);
      names.push(d.type);
    }
  };
  for (const id of HDR_ORDER) {
    const d = active.find((x) => x.type === id);
    if (d) make(d);
  }
  const hdrCount = handles.length;
  const bgPass = new BackgroundPass(scene, camera, pw, ph);
  const aa = active.find((x) => x.type === "smaa") ?? active.find((x) => x.type === "fxaa");
  if (aa) make(aa);
  for (const d of active) if (POSTFX_IMPLS[d.type]?.stage === "ldr") make(d);
  for (const d of active) if (POSTFX_IMPLS[d.type]?.stage === "finish") make(d);
  for (const d of active) if (!POSTFX_IMPLS[d.type]) onUnknown(d.type);

  // Sanitise before HDR effects (bloom would spread one NaN pixel screen-wide);
  // without HDR effects the background pass sanitises itself.
  const sanitize = hdrCount
    ? new ShaderFxPass(fsMaterial(`uniform sampler2D tDiffuse; varying vec2 vUv;\n${SANITIZE_GLSL}\nvoid main() { gl_FragColor = a3dSanitize(texture2D(tDiffuse, vUv)); }`, { tDiffuse: { value: null } }))
    : null;

  const passes: Pass[] = [];
  if (sanitize) passes.push(sanitize);
  for (let i = 0; i < hdrCount; i++) passes.push(handles[i].pass);
  passes.push(bgPass);
  for (let i = hdrCount; i < handles.length; i++) passes.push(handles[i].pass);
  passes.push(finish);
  passes.forEach((p, i) => (p.renderToScreen = i === passes.length - 1));
  finish.setSize(pw, ph);
  finish.setPixelRatio(pr);

  const taa = active.find((x) => x.type === "taa");
  const stillSamples = taa ? Math.max(2, Math.min(quality.maxStillSamples, Math.round(num(taa.samples, 8)))) : 0;

  // ── Still accumulation: running average of reversibly tone-mapped samples
  // (no bright-edge aliasing), ping-pong between two float targets (no float
  // blending needed). ──
  let accum: [THREE.WebGLRenderTarget, THREE.WebGLRenderTarget] | null = null;
  let accMat: THREE.ShaderMaterial | null = null;
  let resolveMat: THREE.ShaderMaterial | null = null;
  const quad = new FullScreenQuad();
  const accumulate = (samples: number) => {
    accum ??= [0, 1].map(() => new THREE.WebGLRenderTarget(pw, ph, { type: THREE.HalfFloatType, depthBuffer: false, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter })) as [THREE.WebGLRenderTarget, THREE.WebGLRenderTarget];
    for (const t of accum) if (t.width !== pw || t.height !== ph) t.setSize(pw, ph);
    accMat ??= fsMaterial(
      `uniform sampler2D tDiffuse; uniform sampler2D tPrev; uniform float uWeight; varying vec2 vUv;\n${SANITIZE_GLSL}
      void main() {
        vec4 c = a3dSanitize(texture2D(tDiffuse, vUv));
        float m = max(c.r, max(c.g, c.b));
        gl_FragColor = mix(texture2D(tPrev, vUv), vec4(c.rgb / (1.0 + m), c.a), uWeight);
      }`,
      { tDiffuse: { value: null }, tPrev: { value: null }, uWeight: { value: 1 } },
    );
    resolveMat ??= fsMaterial(
      `uniform sampler2D tDiffuse; varying vec2 vUv;
      void main() { vec4 c = texture2D(tDiffuse, vUv); float m = max(c.r, max(c.g, c.b)); gl_FragColor = vec4(c.rgb / max(1.0 - m, 1e-3), c.a); }`,
      { tDiffuse: { value: null } },
    );
    const ortho = (camera as THREE.OrthographicCamera).isOrthographicCamera;
    let [prev, next] = accum;
    for (let i = 0; i < samples; i++) {
      const jx = halton(i + 1, 2) - 0.5, jy = halton(i + 1, 3) - 0.5;
      if ((camera as THREE.PerspectiveCamera).isPerspectiveCamera || ortho) camera.setViewOffset(pw, ph, jx, jy, pw, ph);
      renderScene(sceneTarget);
      accMat.uniforms.tDiffuse.value = sceneTarget.texture;
      accMat.uniforms.tPrev.value = prev.texture;
      accMat.uniforms.uWeight.value = 1 / (i + 1);
      quad.material = accMat;
      renderer.setRenderTarget(next);
      quad.render(renderer);
      [prev, next] = [next, prev];
    }
    camera.clearViewOffset();
    resolveMat.uniforms.tDiffuse.value = prev.texture;
    quad.material = resolveMat;
    renderer.setRenderTarget(rtA);
    quad.render(renderer);
  };

  let clearColor = new THREE.Color();
  let clearAlpha = 1;
  function renderScene(target: THREE.WebGLRenderTarget) {
    // Volumetric spot cones fade softly against the scene depth (lights.ts):
    // publish the shared depth pre-pass (it never contains the cones).
    const cone = scene.getObjectByName("__volumetric");
    if (cone?.visible) {
      const gb = fx.gbuffer();
      gb.ensure(renderer, scene, camera, frame);
      scene.userData.a3dDepth = { texture: gb.depthTexture, width: pw, height: ph };
    }
    const bg = scene.background;
    scene.background = null;
    renderer.setRenderTarget(target);
    renderer.setClearColor(0x000000, 0);
    renderer.clear();
    try {
      renderer.render(scene, camera);
    } finally {
      scene.background = bg;
      delete scene.userData.a3dDepth;
    }
  }

  const ready = Promise.all(handles.map((h) => h.ready).filter(Boolean)).then(() => undefined);

  return {
    ready,
    stillSamples,
    effects: names,
    dropped,
    setParam(type, param, value) {
      const fd = finishDefs.get(type);
      if (fd) {
        fd[param] = value;
        finish.configure(fd);
        return;
      }
      byType.get(type)?.set?.(param, value);
    },
    render(t, opts) {
      frame++;
      for (const h of handles) h.update?.(t);
      finish.setTime(t);
      clearColor = renderer.getClearColor(clearColor);
      clearAlpha = renderer.getClearAlpha();
      bgPass.clearColor.copy(clearColor);
      bgPass.clearAlpha = clearAlpha;
      const autoClear = renderer.autoClear;
      renderer.autoClear = true;
      const samples = Math.max(1, Math.floor(opts?.samples ?? 1));
      let read: THREE.WebGLRenderTarget, write: THREE.WebGLRenderTarget;
      try {
        if (samples > 1) {
          accumulate(samples);
          read = rtA;
          write = rtB;
        } else {
          renderScene(sceneTarget);
          read = sceneTarget;
          write = rtA;
        }
        renderer.setClearColor(clearColor, clearAlpha);
        for (const p of passes) {
          if (!p.enabled) continue;
          p.render(renderer, write, read, 0, false);
          if (p.needsSwap) {
            const next = read === sceneTarget ? rtB : read;
            read = write;
            write = next;
          }
        }
      } finally {
        renderer.setClearColor(clearColor, clearAlpha);
        renderer.autoClear = autoClear;
        renderer.setRenderTarget(null);
      }
    },
    setSize(w, h) {
      pr = renderer.getPixelRatio();
      pw = Math.max(1, Math.floor(w * pr));
      ph = Math.max(1, Math.floor(h * pr));
      sceneTarget.setSize(pw, ph);
      rtA.setSize(pw, ph);
      rtB.setSize(pw, ph);
      gbuffer?.setSize(pw, ph);
      bgPass.setSize(pw, ph);
      finish.setSize(pw, ph);
      finish.setPixelRatio(pr);
      for (const hd of handles) {
        if (hd.setSize) hd.setSize(pw, ph);
        else hd.pass.setSize(pw, ph);
      }
    },
    dispose() {
      for (const p of passes) p.dispose();
      gbuffer?.dispose();
      sceneTarget.dispose();
      rtA.dispose();
      rtB.dispose();
      for (const t of accum ?? []) t.dispose();
      accMat?.dispose();
      resolveMat?.dispose();
      quad.dispose();
    },
  };
}
