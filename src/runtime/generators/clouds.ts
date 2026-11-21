// Puffy low-poly clouds merged in one mesh; each cloud drifts along +x and
// wraps around the area (vertex shader, pure function of uTime), shrinking
// near the edges so the wrap never pops.

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
  const speed = p.num("speed");
  const rng = ctx.rng;

  const pos: number[] = [];
  const col: number[] = [];
  const center: number[] = [];
  const shadow = color.clone().lerp(new THREE.Color("#9fb3c8"), 0.35);
  const c = new THREE.Color();
  for (let k = 0; k < count; k++) {
    const cx = (rng.next() - 0.5) * area[0];
    const cy = altitude + (rng.next() - 0.5) * area[1];
    const cz = (rng.next() - 0.5) * area[2];
    const drift = rng.range(0.7, 1.3);
    const sc = rng.range(0.8, 1.6);
    const puffs = rng.int(4, 7);
    const len = sc * rng.range(2.2, 3.4);
    for (let i = 0; i < puffs; i++) {
      const t = puffs === 1 ? 0.5 : i / (puffs - 1);
      const r = sc * (0.55 + Math.sin(t * Math.PI) * 0.65) * rng.range(0.8, 1.1);
      const g = new THREE.IcosahedronGeometry(r, 1);
      jitter(g, r * 0.18, rng.next);
      const ng = g.toNonIndexed();
      g.dispose();
      const a = ng.getAttribute("position") as THREE.BufferAttribute;
      const ox = (t - 0.5) * len * 2;
      const oy = Math.sin(t * Math.PI) * sc * 0.35 + rng.range(-0.1, 0.15) * sc;
      const oz = rng.range(-0.45, 0.45) * sc;
      for (let f = 0; f < a.count; f += 3) {
        let cyF = 0;
        const tri: number[] = [];
        for (let v = 0; v < 3; v++) {
          let y = a.getY(f + v);
          // flat-ish bottoms
          if (y < -r * 0.3) y = -r * 0.3 + (y + r * 0.3) * 0.25;
          tri.push(a.getX(f + v) + ox, y + oy, a.getZ(f + v) + oz);
          cyF += y + oy;
        }
        cyF /= 3;
        // darker underside, bright tops
        const shadeT = Math.min(1, Math.max(0, 0.5 - cyF / (sc * 1.2)));
        c.copy(color).lerp(shadow, shadeT);
        for (let v = 0; v < 3; v++) {
          pos.push(tri[v * 3]!, tri[v * 3 + 1]!, tri[v * 3 + 2]!);
          col.push(c.r, c.g, c.b);
          center.push(cx, cy, cz, drift);
        }
      }
      ng.dispose();
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  geometry.setAttribute("aCloud", new THREE.Float32BufferAttribute(center, 4));
  geometry.computeVertexNormals();
  // Positions are local to each cloud centre: bounds cover the whole area.
  geometry.boundingBox = new THREE.Box3(new THREE.Vector3(-area[0] / 2 - 6, altitude - area[1] / 2 - 3, -area[2] / 2 - 4), new THREE.Vector3(area[0] / 2 + 6, altitude + area[1] / 2 + 4, area[2] / 2 + 4));
  geometry.boundingSphere = geometry.boundingBox.getBoundingSphere(new THREE.Sphere());

  const uniforms = { uTime: { value: 0 }, uSpeed: { value: speed }, uWidth: { value: Math.max(1, area[0]) } };
  const material = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 1, metalness: 0, emissive: color.clone().multiplyScalar(0.18) });
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
  };
  material.customProgramCacheKey = () => "agent3d-clouds";
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
