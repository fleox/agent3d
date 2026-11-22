// Live params (timeline tracks postfx.<type>.<param>, camera focus → dof.focus):
// a uniform update, never a shader rebuild. No WebGL needed: passes are only
// constructed here, never rendered.
import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { qualitySettings } from "../../core/postfx";
import { GBuffer, type FxRuntime } from "./common";
import { FinishPass } from "./finish";
import { createBloom, createDof, createLensflare } from "./hdr";
import { createGlitch } from "./ldr";

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
