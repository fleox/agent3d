import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { SHADERS } from "../../core/catalog";
import { createRng } from "../random";
import type { BuildContext } from "../registry";
import { SHADER_IMPLS } from "./index";

const makeCtx = (): BuildContext => ({ scene: {} as BuildContext["scene"], rng: createRng(1), siblings: new Map(), color: (c) => new THREE.Color(c), resolveAsset: (p) => p });

describe("shaders", () => {
  for (const entry of SHADERS) {
    it(`${entry.id} creates a ShaderMaterial with uTime`, () => {
      const { material, update } = SHADER_IMPLS[entry.id]!.create({}, makeCtx());
      expect(material).toBeInstanceOf(THREE.ShaderMaterial);
      const sm = material as THREE.ShaderMaterial;
      expect(sm.uniforms.uTime).toBeDefined();
      update?.(2.5);
      expect(sm.uniforms.uTime!.value).toBe(2.5);
      expect(sm.fragmentShader).toContain("void main");
    });
  }
  it("setParam updates uniforms (dissolve progress)", () => {
    const { material } = SHADER_IMPLS.dissolve!.create({ progress: 0.2 }, makeCtx());
    const sm = material as THREE.ShaderMaterial;
    expect(sm.uniforms.uProgress!.value).toBe(0.2);
    (sm.userData.setParam as (n: string, v: unknown) => void)("progress", 0.8);
    expect(sm.uniforms.uProgress!.value).toBe(0.8);
  });
});
