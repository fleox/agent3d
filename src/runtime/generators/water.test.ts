import { describe, expect, it } from "vitest";
import * as THREE from "three";
import type { BuildContext } from "../registry";
import { createRng } from "../random";
import { water } from "./water";
import { createWaterMaterial, reflectionScale } from "./waterMaterial";

const makeCtx = (): BuildContext => ({ scene: { version: 1, objects: [] } as unknown as BuildContext["scene"], rng: createRng(1), siblings: new Map(), color: (c) => new THREE.Color(c), resolveAsset: (p) => p });

const look = { deep: new THREE.Color(), shallow: new THREE.Color(), foam: new THREE.Color(), opacity: 0.9, waveHeight: 0.1, waveSpeed: 1, foamWidth: 0, ripples: 1, flat: false, depthRange: 3 };

function compiled(mat: THREE.Material): { vertexShader: string; fragmentShader: string } {
  const shader = { vertexShader: THREE.ShaderLib.standard.vertexShader, fragmentShader: THREE.ShaderLib.standard.fragmentShader, uniforms: {} } as unknown as THREE.WebGLProgramParametersWithUniforms;
  mat.onBeforeCompile(shader, {} as THREE.WebGLRenderer);
  return shader;
}

function waterMesh(root: THREE.Object3D): THREE.Mesh {
  let m: THREE.Mesh | undefined;
  root.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) m = o as THREE.Mesh;
  });
  return m!;
}

describe("water reflections", () => {
  it("are off by default: no mirror pass, no reflection code", async () => {
    const b = await water({}, makeCtx());
    const mesh = waterMesh(b.object);
    expect(mesh.userData.reflective).toBeUndefined();
    expect(compiled(mesh.material as THREE.Material).fragmentShader).not.toContain("#define A3D_REFLECT");
    b.dispose?.();
  });
  it("reflections: true attaches a planar mirror sampled with fresnel", async () => {
    const b = await water({ reflections: true, reflectivity: 0.7 }, { ...makeCtx(), quality: "high" });
    const mesh = waterMesh(b.object);
    expect(mesh.userData.reflective).toBe(true);
    const sh = compiled(mesh.material as THREE.Material);
    expect(sh.fragmentShader).toContain("#define A3D_REFLECT");
    expect(sh.fragmentShader).toContain("texture2D(tReflect, ruv)");
    expect(sh.vertexShader).toContain("vReflect = uReflectMat * vec4(vWPos, 1.0)");
    expect((mesh.material as THREE.Material).customProgramCacheKey()).toMatch(/-r$/);
    b.dispose?.();
  });
  it("are skipped on the low quality tier and halved on medium", async () => {
    expect(reflectionScale("low")).toBe(0);
    expect(reflectionScale("medium")).toBe(0.5);
    expect(reflectionScale(undefined)).toBe(1);
    const b = await water({ reflections: true }, { ...makeCtx(), quality: "low" });
    expect(waterMesh(b.object).userData.reflective).toBeUndefined();
  });
  it("the material without reflection keeps its old program key", () => {
    expect(createWaterMaterial(look).material.customProgramCacheKey()).toBe("agent3d-water2-s");
  });
});
