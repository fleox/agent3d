// Animated stylised water surface: analytic waves, shallow → deep colour from
// the depth of a sibling terrain below (baked on the first frame, once the
// object's transform is known), animated shore foam lines, ripple normals
// with a moving sun glint and fresnel — see waterMaterial.ts. Without a
// terrain below, the water is uniformly deep (no shore foam).

import * as THREE from "three";
import type { GeneratorImpl } from "../registry";
import { generatorParams } from "./params";
import { built, findGround } from "./geom";
import { bakeDepth, createWaterMaterial, waveHeight } from "./waterMaterial";

export { waveHeight } from "./waterMaterial";

export const water: GeneratorImpl = (raw, ctx) => {
  const p = generatorParams("water", raw, ctx);
  const size = p.num("size");
  const amp = p.num("waveHeight");
  const speed = p.num("waveSpeed");
  const lowpoly = p.bool("lowpoly");
  const segs = Math.max(8, Math.min(160, Math.round(size * (lowpoly ? 1.4 : 3))));
  const geometry = new THREE.PlaneGeometry(size, size, segs, segs);
  geometry.rotateX(-Math.PI / 2);
  bakeDepth(geometry, 0, null);
  const { material, uniforms } = createWaterMaterial({
    deep: p.color("color"),
    shallow: p.color("shallowColor"),
    foam: p.color("foamColor"),
    opacity: p.num("opacity"),
    waveHeight: amp,
    waveSpeed: speed,
    foamWidth: p.num("foam"),
    ripples: p.num("ripples"),
    flat: lowpoly,
    depthRange: p.num("depthRange"),
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = "water";
  mesh.receiveShadow = true;
  mesh.renderOrder = 1;
  // Displacement happens on the GPU: enlarge bounds so culling stays correct.
  geometry.computeBoundingBox();
  geometry.boundingBox!.min.y = -amp * 1.2;
  geometry.boundingBox!.max.y = amp * 1.2;
  geometry.computeBoundingSphere();
  const group = new THREE.Group();
  group.name = "water";
  group.userData.surface = "water";
  group.add(mesh);
  const ground = findGround(ctx);
  let baked = !ground;
  let time = 0;
  return built(group, {
    update: (t) => {
      time = t;
      uniforms.uTime.value = t;
      if (!baked && ground) {
        // Ground heights are in the parent space: offset by the water's own transform.
        baked = true;
        const o = group.position;
        const s = group.scale;
        bakeDepth(geometry, 0, (x, z) => (ground.height(x * s.x + o.x, z * s.z + o.z) - o.y) / (s.y || 1));
      }
    },
    heightAt: (x, z) => waveHeight(x, z, time, amp, speed),
  });
};
