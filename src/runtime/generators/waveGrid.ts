// Grid of dots / bars / lines rippling like a wave (tech & data banners).
// Heights are a pure function of t (+ optional pointer ripple), computed on
// the CPU and written to one buffer: dots = Points, bars = InstancedMesh,
// lines = LineSegments along the rows. Colour ramp follows the height.
// Pointer: `object.userData.setPointer(x, y)` (normalised -1..1).

import * as THREE from "three";
import type { GeneratorImpl } from "../registry";
import { noise2D } from "../random";
import { generatorParams } from "./params";
import { built, ramp } from "./geom";

export const waveGrid: GeneratorImpl = (raw, ctx) => {
  const p = generatorParams("waveGrid", raw, ctx);
  const cols = p.int("columns");
  const rows = p.int("rows");
  const sp = p.num("spacing");
  const amp = p.num("amplitude");
  const speed = p.num("speed");
  const shape = p.str<"dots" | "bars" | "lines">("shape");
  const colors = p.colors("colors");
  const pointerRipple = p.bool("pointerRipple");
  const seed = ctx.rng.range(0, 50);
  const W = (cols - 1) * sp;
  const D = (rows - 1) * sp;
  const n = cols * rows;
  const xs = new Float32Array(n);
  const zs = new Float32Array(n);
  for (let j = 0; j < rows; j++)
    for (let i = 0; i < cols; i++) {
      xs[j * cols + i] = -W / 2 + i * sp;
      zs[j * cols + i] = -D / 2 + j * sp;
    }

  const pointer = { x: 0, y: 0, active: false, strength: 0 };
  const heightAt = (x: number, z: number, t: number): number => {
    const s = t * speed;
    const u = x / Math.max(0.001, sp * 10);
    const v = z / Math.max(0.001, sp * 10);
    let h = Math.sin(u * 1.4 + s * 1.3) * 0.45 + Math.sin(v * 1.9 - s * 1.05 + u * 0.6) * 0.3 + noise2D(u * 0.35 + seed, v * 0.35 + s * 0.15) * 0.35;
    if (pointerRipple && pointer.strength > 0.001) {
      const px = pointer.x * W * 0.5, pz = -pointer.y * D * 0.5;
      const d = Math.hypot(x - px, z - pz) / Math.max(0.001, sp * 6);
      h += Math.sin(d * 2.2 - t * 6) * Math.exp(-d * 0.45) * 0.9 * pointer.strength;
    }
    return h * amp;
  };

  const group = new THREE.Group();
  group.name = "waveGrid";
  const c = new THREE.Color();
  let update: (t: number) => void;

  if (shape === "bars") {
    const g = new THREE.BoxGeometry(sp * 0.62, 1, sp * 0.62);
    g.translate(0, 0.5, 0);
    const mat = new THREE.MeshStandardMaterial({ roughness: 0.45, metalness: 0.1 });
    const mesh = new THREE.InstancedMesh(g, mat, n);
    mesh.name = "waveGrid-bars";
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    const m = new THREE.Matrix4();
    group.add(mesh);
    update = (t) => {
      for (let k = 0; k < n; k++) {
        const h = heightAt(xs[k]!, zs[k]!, t);
        const hh = Math.max(0.02, h + amp * 1.2);
        m.makeScale(1, hh, 1).setPosition(xs[k]!, 0, zs[k]!);
        mesh.setMatrixAt(k, m);
        mesh.setColorAt(k, ramp(colors, hh / Math.max(0.001, amp * 2.4), c));
      }
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      mesh.computeBoundingSphere();
    };
  } else if (shape === "lines") {
    // segments between neighbours along each row and column (wireframe surface)
    const segCount = rows * (cols - 1) + cols * (rows - 1);
    const pos = new Float32Array(segCount * 6);
    const col = new Float32Array(segCount * 6);
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    g.setAttribute("color", new THREE.BufferAttribute(col, 3));
    const lines = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.9 }));
    lines.name = "waveGrid-lines";
    group.add(lines);
    const hs = new Float32Array(n);
    update = (t) => {
      for (let k = 0; k < n; k++) hs[k] = heightAt(xs[k]!, zs[k]!, t);
      let o = 0;
      const put = (a: number, b: number) => {
        for (const k of [a, b]) {
          pos[o] = xs[k]!;
          pos[o + 1] = hs[k]!;
          pos[o + 2] = zs[k]!;
          ramp(colors, hs[k]! / Math.max(0.001, amp * 2.2) + 0.5, c);
          col[o] = c.r;
          col[o + 1] = c.g;
          col[o + 2] = c.b;
          o += 3;
        }
      };
      for (let j = 0; j < rows; j++) for (let i = 0; i < cols - 1; i++) put(j * cols + i, j * cols + i + 1);
      for (let j = 0; j < rows - 1; j++) for (let i = 0; i < cols; i++) put(j * cols + i, (j + 1) * cols + i);
      g.attributes.position!.needsUpdate = true;
      g.attributes.color!.needsUpdate = true;
      g.computeBoundingSphere();
    };
  } else {
    const pos = new Float32Array(n * 3);
    const col = new Float32Array(n * 3);
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    g.setAttribute("color", new THREE.BufferAttribute(col, 3));
    const mat = new THREE.ShaderMaterial({
      uniforms: { uSize: { value: sp * 0.55 }, uScale: { value: 600 } },
      vertexShader: /* glsl */ `
uniform float uSize;
uniform float uScale;
varying vec3 vColor;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vColor = color;
  gl_PointSize = max(1.5, uSize * uScale / -mv.z);
  gl_Position = projectionMatrix * mv;
}`,
      fragmentShader: /* glsl */ `
varying vec3 vColor;
void main() {
  float r = length(gl_PointCoord - 0.5) * 2.0;
  float a = smoothstep(1.0, 0.75, r);
  if (a < 0.02) discard;
  gl_FragColor = vec4(vColor * (1.1 - r * 0.25), a);
  #include <colorspace_fragment>
}`,
      vertexColors: true,
      transparent: true,
      depthWrite: false,
    });
    const pts = new THREE.Points(g, mat);
    pts.name = "waveGrid-dots";
    group.add(pts);
    update = (t) => {
      for (let k = 0; k < n; k++) {
        const h = heightAt(xs[k]!, zs[k]!, t);
        pos[k * 3] = xs[k]!;
        pos[k * 3 + 1] = h;
        pos[k * 3 + 2] = zs[k]!;
        ramp(colors, h / Math.max(0.001, amp * 2.2) + 0.5, c);
        col.set([c.r, c.g, c.b], k * 3);
      }
      g.attributes.position!.needsUpdate = true;
      g.attributes.color!.needsUpdate = true;
      g.computeBoundingSphere();
    };
  }

  group.userData.setPointer = (x: number, y: number) => {
    pointer.x = x;
    pointer.y = y;
    pointer.active = true;
    pointer.strength = 1;
  };
  update(0);
  return built(group, { update: (t) => update(t) });
};
