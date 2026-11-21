// Organic animated blob: a welded icosphere displaced on the CPU by 3D noise
// each frame (pure function of t), so it works with ANY material the scene
// assigns. Default: iridescent clearcoat physical material + soft vertex
// colour gradient.

import * as THREE from "three";
import { mergeVertices } from "three/addons/utils/BufferGeometryUtils.js";
import type { GeneratorImpl } from "../registry";
import { noise3D } from "../random";
import { generatorParams } from "./params";
import { built } from "./geom";

const PALETTE = ["#ff7eb3", "#a78bfa", "#60a5fa", "#5eead4"].map((c) => new THREE.Color(c));

export const blob: GeneratorImpl = (raw, ctx) => {
  const p = generatorParams("blob", raw, ctx);
  const radius = p.num("radius");
  const amount = p.num("noise");
  const speed = p.num("speed");
  const detail = p.int("detail");
  // detail² × 2 triangles ≈ 20 (n+1)² → n
  const n = Math.max(2, Math.round(Math.sqrt((detail * detail * 2) / 20)) - 1);
  let geometry = new THREE.IcosahedronGeometry(1, n);
  geometry.deleteAttribute("uv");
  geometry.deleteAttribute("normal");
  geometry = mergeVertices(geometry) as THREE.IcosahedronGeometry;
  const pos = geometry.getAttribute("position") as THREE.BufferAttribute;
  const dirs = Float32Array.from(pos.array as Float32Array);
  for (let i = 0; i < pos.count; i++) {
    const l = Math.hypot(dirs[i * 3]!, dirs[i * 3 + 1]!, dirs[i * 3 + 2]!);
    dirs[i * 3] /= l;
    dirs[i * 3 + 1] /= l;
    dirs[i * 3 + 2] /= l;
  }
  const colors = new Float32Array(pos.count * 3);
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  const seed = ctx.rng.range(0, 100);

  const material = new THREE.MeshPhysicalMaterial({
    vertexColors: true,
    roughness: 0.22,
    metalness: 0.05,
    clearcoat: 1,
    clearcoatRoughness: 0.15,
    iridescence: 0.9,
    iridescenceIOR: 1.35,
    iridescenceThicknessRange: [180, 620],
    sheen: 0.4,
    sheenColor: new THREE.Color("#ffd6f5"),
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = "blob";
  mesh.castShadow = true;
  mesh.receiveShadow = true;

  const c = new THREE.Color();
  const update = (t: number): void => {
    const tt = t * speed;
    for (let i = 0; i < pos.count; i++) {
      const x = dirs[i * 3]!, y = dirs[i * 3 + 1]!, z = dirs[i * 3 + 2]!;
      const n1 = noise3D(x * 0.9 + seed, y * 0.9 + tt * 0.9, z * 0.9 - tt * 0.4);
      const n2 = noise3D(x * 1.9 - tt * 0.6, y * 1.9 + seed, z * 1.9 + tt * 0.7) * 0.22;
      const r = radius + (n1 + n2) * amount;
      pos.setXYZ(i, x * r, y * r, z * r);
      // colour flows over the surface
      const k = (Math.sin(y * 1.6 + tt * 0.7 + n1 * 1.5) * 0.5 + 0.5) * (PALETTE.length - 1);
      const j = Math.min(PALETTE.length - 2, Math.floor(k));
      c.copy(PALETTE[j]!).lerp(PALETTE[j + 1]!, k - j);
      colors[i * 3] = c.r;
      colors[i * 3 + 1] = c.g;
      colors[i * 3 + 2] = c.b;
    }
    pos.needsUpdate = true;
    (geometry.getAttribute("color") as THREE.BufferAttribute).needsUpdate = true;
    geometry.computeVertexNormals();
  };
  update(0);
  geometry.computeBoundingSphere();
  if (geometry.boundingSphere) geometry.boundingSphere.radius = radius * (1 + amount * 1.5) + 0.01;
  const group = new THREE.Group();
  group.name = "blob";
  group.add(mesh);
  return built(group, { update: (t) => update(t) });
};
