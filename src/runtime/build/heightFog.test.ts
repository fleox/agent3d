import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { installHeightFog } from "./heightFog";

describe("height fog", () => {
  it("patches materials spawned after install before their first render", () => {
    const scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0xffffff, 0.02);
    installHeightFog(scene, { uA3dFogHeight: { value: 2 }, uA3dFogFalloff: { value: 0.3 } });
    // A script spawns an object mid-frame (after every onUpdate ran).
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial());
    scene.add(mesh);
    // three calls scene.onBeforeRender before compiling anything of the render.
    (scene.onBeforeRender as unknown as (...a: unknown[]) => void)({}, scene, new THREE.PerspectiveCamera(), null);
    expect(mesh.material.userData.a3dHeightFog).toBe(true);
    expect(mesh.material.customProgramCacheKey()).toContain("height-fog");
  });
  it("turns off cleanly and never stacks hooks", () => {
    const scene = new THREE.Scene();
    const u = { uA3dFogHeight: { value: 2 }, uA3dFogFalloff: { value: 0.3 } };
    installHeightFog(scene, u);
    const hook = scene.onBeforeRender;
    installHeightFog(scene, null);
    installHeightFog(scene, u);
    expect(scene.onBeforeRender).toBe(hook);
    installHeightFog(scene, null);
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial());
    scene.add(mesh);
    (scene.onBeforeRender as unknown as (...a: unknown[]) => void)({}, scene, new THREE.PerspectiveCamera(), null);
    expect(mesh.material.userData.a3dHeightFog).toBeUndefined();
  });
});
