// Clouds merged in one mesh: each cloud is a cluster of puffs (big dome in
// the middle, smaller ones around, flattened bottom) shaded bright on top and
// blue-grey underneath, with a soft back-lit rim ("silver lining"). Style
// "puffy" = smooth, soft cotton balls; "lowpoly" = faceted jittered puffs.
// Each cloud drifts along +x and wraps around the area (vertex shader, pure
// function of uTime), shrinking near the edges so the wrap never pops.

import * as THREE from "three";
import type { GeneratorImpl } from "../registry";
import { generatorParams } from "./params";
import { built, jitter } from "./geom";

export const clouds: GeneratorImpl = (raw, ctx) => {
  const p = generatorParams("clouds", raw, ctx);
  const count = p.int("count");
  const area = p.vec3("area");
  const altitude = p.num("height");
  const color = p.color("color");
  const shadowCol = p.color("shadowColor");
  const speed = p.num("speed");
  const lowpoly = p.str("style") === "lowpoly";
  const rng = ctx.rng;

  const pos: number[] = [];
  const nrm: number[] = [];
  const col: number[] = [];
  const center: number[] = [];
  const c = new THREE.Color();
  const v = new THREE.Vector3();
  for (let k = 0; k < count; k++) {
    const cx = (rng.next() - 0.5) * area[0];
    const cy = altitude + (rng.next() - 0.5) * area[1];
    const cz = (rng.next() - 0.5) * area[2];
    const drift = rng.range(0.7, 1.3);
    const sc = rng.range(0.8, 1.6) * p.num("size");
    const puffs = rng.int(5, 9);
    const len = sc * rng.range(2.0, 3.2);
    for (let i = 0; i < puffs; i++) {
      const t = puffs === 1 ? 0.5 : i / (puffs - 1);
      const r = sc * (0.5 + Math.sin(t * Math.PI) * 0.75) * rng.range(0.8, 1.1);
      let g: THREE.BufferGeometry;
      if (lowpoly) {
        g = new THREE.IcosahedronGeometry(r, 1);
        jitter(g, r * 0.18, rng.next);
      } else g = new THREE.SphereGeometry(r, 18, 12);
      const ng = g.index ? g.toNonIndexed() : g;
      if (ng !== g) g.dispose();
      const a = ng.getAttribute("position") as THREE.BufferAttribute;
      const na = ng.getAttribute("normal") as THREE.BufferAttribute;
      const ox = (t - 0.5) * len * 2 + rng.range(-0.15, 0.15) * sc;
      const oy = Math.sin(t * Math.PI) * sc * 0.4 + rng.range(-0.1, 0.15) * sc;
      const oz = rng.range(-0.5, 0.5) * sc;
      const bottom = -sc * 0.25; // shared flat base of the whole cloud
      for (let f = 0; f < a.count; f++) {
        let y = a.getY(f) + oy;
        let nx = na.getX(f), ny = na.getY(f), nz = na.getZ(f);
        if (y < bottom) {
          // Flatten below the base (soft, not a hard cut).
          y = bottom + (y - bottom) * 0.18;
          ny = ny * 0.4 - 0.6;
        }
        v.set(nx, ny, nz).normalize();
        pos.push(a.getX(f) + ox, y, a.getZ(f) + oz);
        nrm.push(v.x, v.y, v.z);
        // Bright top, cool shadowed underside.
        const shadeT = Math.min(1, Math.max(0, (sc * 0.85 - y) / (sc * 1.15)));
        c.copy(color).lerp(shadowCol, Math.pow(shadeT, 1.4) * 0.9);
        col.push(c.r, c.g, c.b);
        center.push(cx, cy, cz, drift);
      }
      ng.dispose();
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  geometry.setAttribute("aCloud", new THREE.Float32BufferAttribute(center, 4));
  if (lowpoly) geometry.computeVertexNormals();
  else geometry.setAttribute("normal", new THREE.Float32BufferAttribute(nrm, 3));
  // Positions are local to each cloud centre: bounds cover the whole area.
  geometry.boundingBox = new THREE.Box3(new THREE.Vector3(-area[0] / 2 - 6, altitude - area[1] / 2 - 3, -area[2] / 2 - 4), new THREE.Vector3(area[0] / 2 + 6, altitude + area[1] / 2 + 4, area[2] / 2 + 4));
  geometry.boundingSphere = geometry.boundingBox.getBoundingSphere(new THREE.Sphere());

  const uniforms = { uTime: { value: 0 }, uSpeed: { value: speed }, uWidth: { value: Math.max(1, area[0]) }, uRim: { value: color.clone() } };
  const material = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: lowpoly, roughness: 1, metalness: 0, emissive: color.clone().multiplyScalar(lowpoly ? 0.16 : 0.06) });
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader =
      /* glsl */ `
uniform float uTime;
uniform float uSpeed;
uniform float uWidth;
attribute vec4 aCloud;
` +
      shader.vertexShader.replace(
        "#include <begin_vertex>",
        /* glsl */ `#include <begin_vertex>
{
  float hw = uWidth * 0.5;
  float x = mod(aCloud.x + hw + uTime * uSpeed * aCloud.w, uWidth) - hw;
  float edge = smoothstep(hw, hw * 0.8, abs(x));
  transformed = transformed * edge + vec3(x, aCloud.y, aCloud.z);
}
`,
      );
    // Soft wrap lighting + rim: light scatters through the cotton.
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\nuniform vec3 uRim;")
      .replace(
        "#include <emissivemap_fragment>",
        `#include <emissivemap_fragment>
{
  vec3 vn = normalize(vNormal);
  float rim = pow(1.0 - clamp(abs(dot(vn, normalize(vViewPosition))), 0.0, 1.0), 2.5);
  totalEmissiveRadiance += uRim * rim * 0.35;
}`,
      );
  };
  material.customProgramCacheKey = () => `agent3d-clouds-${lowpoly ? "l" : "p"}`;
  if (lowpoly) {
    // flat shading has no vNormal: skip the rim chunk
    material.onBeforeCompile = ((orig) => (shader: Parameters<typeof orig>[0], r: Parameters<typeof orig>[1]) => {
      orig.call(material, shader, r);
      shader.fragmentShader = shader.fragmentShader.replace(/\{\s*vec3 vn = normalize\(vNormal\);[\s\S]*?rim \* 0\.35;\s*\}/, "");
    })(material.onBeforeCompile);
  }
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = "clouds";
  // the built-in shadow pass does not know the drift: no shadow casting
  const group = new THREE.Group();
  group.name = "clouds";
  group.add(mesh);
  return built(group, {
    update: (t) => {
      uniforms.uTime.value = t;
    },
  });
};
