// Live params (timeline tracks postfx.<type>.<param>, camera focus → dof.focus):
// a uniform update, never a shader rebuild. No WebGL needed: passes are only
// constructed here, never rendered.
import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { qualitySettings } from "../../core/postfx";
import { GBuffer, type FxRuntime } from "./common";
import { FinishPass } from "./finish";
import { createBloom, createDof, createGodrays, createLensflare } from "./hdr";
import { createGlitch, fxaaFragment } from "./ldr";
import { BackgroundPass, hasTransmission, SceneBackdrop } from "./background";
import { POSTFX_LOOKS } from "../../core/catalog";

function fakeRuntime(): FxRuntime {
  let gb: GBuffer | null = null;
  return {
    renderer: { getPixelRatio: () => 1 } as unknown as THREE.WebGLRenderer,
    scene: new THREE.Scene(),
    camera: new THREE.PerspectiveCamera(),
    quality: qualitySettings("high"),
    width: 320,
    height: 180,
    pixelRatio: 1,
    gbuffer: () => (gb ??= new GBuffer(320, 180)),
    frame: () => 0,
    finish: { configure: () => undefined },
  };
}

describe("post effect live params", () => {
  it("dof focus / aperture update uniforms; an explicit focus overrides focusOn", () => {
    const h = createDof({ type: "dof", focus: 8, focusOn: "hero" }, fakeRuntime());
    const mat = (h.pass as unknown as { material: THREE.ShaderMaterial }).material;
    const version = mat.version;
    h.set!("focus", 3.5);
    h.set!("aperture", 0.01);
    expect(mat.uniforms.uFocus.value).toBe(3.5);
    expect(mat.uniforms.uAperture.value).toBe(0.01);
    expect(mat.version).toBe(version); // no recompilation
  });

  it("bloom, lensflare and glitch params are live", () => {
    const rt = fakeRuntime();
    const bloom = createBloom({ type: "bloom" }, rt);
    bloom.set!("strength", 2);
    bloom.set!("threshold", 1.5);
    expect((bloom.pass as unknown as { strength: number }).strength).toBe(2);
    expect((bloom.pass as unknown as { threshold: number }).threshold).toBe(1.5);
    const flare = createLensflare({ type: "lensflare" }, rt);
    flare.set!("intensity", 1.25);
    expect((flare.pass as unknown as { compMat: THREE.ShaderMaterial }).compMat.uniforms.uIntensity.value).toBe(1.25);
    const glitch = createGlitch({ type: "glitch" }, rt);
    glitch.set!("amount", 0.9);
    expect((glitch.pass as unknown as { material: THREE.ShaderMaterial }).material.uniforms.uAmount.value).toBe(0.9);
  });

  it("finish effects reconfigure uniforms without recompiling once enabled", () => {
    const f = new FinishPass();
    f.configure({ type: "vignette", darkness: 1 });
    f.configure({ type: "grading", look: "warm" });
    const version = f.material.version;
    f.configure({ type: "vignette", darkness: 0.3 });
    f.configure({ type: "grading", look: "warm", exposure: 1 });
    expect(f.uniforms.uVigDark.value).toBe(0.3);
    expect(f.uniforms.uExposure.value).toBeCloseTo(2);
    expect(f.material.version).toBe(version);
  });
});

describe("bloom / lensflare / godrays internals", () => {
  it("bloom mip weights are normalised (strength = share of over-threshold energy) and follow radius", () => {
    const bloom = createBloom({ type: "bloom", radius: 0 }, fakeRuntime());
    const pass = bloom.pass as unknown as { levelWeights(): number[]; radius: number };
    const tight = pass.levelWeights();
    expect(tight.reduce((a, b) => a + b, 0)).toBeCloseTo(1);
    expect(tight[0]).toBeGreaterThan(tight[tight.length - 1]);
    bloom.set!("radius", 1);
    const wide = pass.levelWeights();
    expect(wide.reduce((a, b) => a + b, 0)).toBeCloseTo(1);
    expect(wide[wide.length - 1]).toBeGreaterThan(wide[0]);
  });
  it("bloom prefilter subtracts the threshold (soft knee) and lensflare ghosts read a blurred low-res source", () => {
    const bloom = createBloom({ type: "bloom" }, fakeRuntime());
    const pre = (bloom.pass as unknown as { preMat: THREE.ShaderMaterial }).preMat.fragmentShader;
    expect(pre).toContain("l - uThreshold");
    const flare = createLensflare({ type: "lensflare" }, fakeRuntime());
    const f = flare.pass as unknown as { compMat: THREE.ShaderMaterial; g2: THREE.WebGLRenderTarget };
    expect(f.compMat.fragmentShader).not.toContain("fract(");
    expect(f.compMat.fragmentShader).not.toContain("texture2D(tBright");
    expect(f.compMat.uniforms.tGhost.value).toBe(f.g2.texture);
    expect(f.g2.width).toBeLessThanOrEqual(Math.max(8, 320 / 32));
  });
  it("godrays find the physical sky sun", async () => {
    const { createGodrays } = await import("./hdr");
    const rt = fakeRuntime();
    const sky = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.ShaderMaterial());
    sky.name = "__sky";
    sky.userData.sunDir = new THREE.Vector3(0, 0.05, -1).normalize();
    sky.userData.sunColor = new THREE.Color(1, 0.6, 0.3);
    sky.userData.sunUp = true;
    rt.scene.add(sky);
    const cam = rt.camera as THREE.PerspectiveCamera;
    cam.position.set(0, 0, 0);
    cam.lookAt(0, 0, -1);
    cam.updateMatrixWorld();
    const h = createGodrays({ type: "godrays" }, rt);
    h.update!(0);
    const p = h.pass as unknown as { maskMat: THREE.ShaderMaterial; visible: number };
    const src = p.maskMat.uniforms.uSrc.value as THREE.Vector2;
    expect(src.x).toBeCloseTo(0.5, 2);
    expect(src.y).toBeGreaterThan(0.5);
    expect(p.visible).toBeGreaterThan(0.9);
  });
});

describe("small dark text stays crisp (clean look)", () => {
  it("FXAA detects edges on a perceptual luma and blends sub-pixels gently", () => {
    const f = fxaaFragment();
    expect(f).toContain("sqrt( max( Sample( tex2D, uv ).rgb");
    expect(f).toContain("_SubpixelBlending = 0.35");
  });
  it("the clean look has no FXAA", () => {
    expect(POSTFX_LOOKS.clean.effects.map((e) => e.type)).not.toContain("fxaa");
  });
  it("the background pass tone-maps un-premultiplied colour (no toe crush on partly covered pixels)", () => {
    const pass = new BackgroundPass(new THREE.Scene(), new THREE.PerspectiveCamera(), 4, 4);
    const src = (pass as unknown as { mat: THREE.RawShaderMaterial }).mat.fragmentShader;
    expect(src).toContain("tm(fg.rgb / a) * a");
    pass.dispose();
  });
});

describe("glass in front of the background (post-processing)", () => {
  it("detects transmissive meshes", () => {
    const s = new THREE.Scene();
    s.add(new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial()));
    expect(hasTransmission(s)).toBe(false);
    s.add(new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshPhysicalMaterial({ transmission: 1 })));
    expect(hasTransmission(s)).toBe(true);
  });
  it("the backdrop draws the background everywhere except in the main scene pass", () => {
    const tex = new THREE.Texture();
    const b = new SceneBackdrop(tex);
    const main = new THREE.WebGLRenderTarget(4, 4);
    b.mainTarget = main;
    const uShow = (b.mesh.material as THREE.ShaderMaterial).uniforms.uShow;
    const fake = (target: THREE.WebGLRenderTarget | null) => ({ getRenderTarget: () => target }) as unknown as THREE.WebGLRenderer;
    const call = (r: THREE.WebGLRenderer) => b.mesh.onBeforeRender(r, new THREE.Scene(), new THREE.PerspectiveCamera(), b.mesh.geometry, b.mesh.material as THREE.Material, null as never);
    call(fake(main));
    expect(uShow.value).toBe(0);
    call(fake(new THREE.WebGLRenderTarget(2, 2))); // three's transmission target
    expect(uShow.value).toBe(1);
    expect(b.mesh.renderOrder).toBeLessThan(-1e6);
    expect((b.mesh.material as THREE.Material).transparent).toBe(false);
    b.dispose();
  });
});

describe("godrays sampling", () => {
  it("jitters the ray taps per pixel and keeps shadow shafts off solid surfaces", () => {
    const h = createGodrays({ type: "godrays" }, fakeRuntime());
    const p = h.pass as unknown as Record<string, THREE.ShaderMaterial>;
    expect(p.raysMat.fragmentShader).toContain("a3dIgn(gl_FragCoord.xy)");
    expect(p.fineMat.fragmentShader).toContain("a3dIgn(");
    expect(p.compMat.fragmentShader).toContain("mix(0.3, 1.0, sky)");
    expect(p.compMat.uniforms.tNormal.value).toBeInstanceOf(THREE.Texture);
  });
});
