// Scattered low-poly rocks: jittered, squashed icosahedra merged in one mesh.

import * as THREE from "three";
import type { GeneratorImpl } from "../registry";
import { generatorParams } from "./params";
import { MeshBuilder, built, findGround, jitter, scatterPoint, shade, vertexColorMaterial } from "./geom";

export const rocks: GeneratorImpl = (raw, ctx) => {
  const p = generatorParams("rocks", raw, ctx);
  const count = p.int("count");
  const area = p.vec3("area");
  const minS = p.num("minSize");
  const maxS = Math.max(minS, p.num("maxSize"));
  const colors = p.colors("colors");
  const rng = ctx.rng;
  const ground = p.bool("onTerrain") ? findGround(ctx) : null;
  const moss = new THREE.Color("#7c9a4a");

  // Variants: a few carved shapes reused with different transforms.
  const variants = Array.from({ length: 6 }, (_, k) => {
    const g = new THREE.IcosahedronGeometry(1, k % 3 === 0 ? 1 : 0);
    jitter(g, 0.45, rng.next);
    // Flatten the bottom so rocks sit on the ground.
    const pos = g.getAttribute("position") as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) if (pos.getY(i) < -0.35) pos.setY(i, -0.35 + (pos.getY(i) + 0.35) * 0.2);
    return g;
  });

  const b = new MeshBuilder();
  const m = new THREE.Matrix4();
  for (let k = 0; k < count; k++) {
    const pt = scatterPoint(rng, area, ground, -10);
    // Mostly small rocks, a few big boulders.
    const size = minS + (maxS - minS) * Math.pow(rng.next(), 1.8);
    const g = rng.pick(variants);
    const sy = size * rng.range(0.5, 0.85);
    m.compose(new THREE.Vector3(pt.x, (ground ? pt.y : 0) + sy * 0.2, pt.z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rng.range(-0.15, 0.15), rng.next() * Math.PI * 2, rng.range(-0.15, 0.15))), new THREE.Vector3(size * rng.range(0.9, 1.3), sy, size * rng.range(0.8, 1.1)));
    const c = rng.pick(colors);
    const hasMoss = rng.next() < 0.35;
    b.add(g, m, (_x, cy, _z, f) => {
      const tint = 0.86 + ((f * 2654435761 + k * 97) >>> 0) % 100 / 100 * 0.24;
      const base = hasMoss && cy > 0.35 ? c.clone().lerp(moss, 0.55) : c;
      return shade(base, tint + cy * 0.08);
    });
  }
  for (const g of variants) g.dispose();
  const mesh = new THREE.Mesh(b.build(), vertexColorMaterial({ flat: true, roughness: 0.95 }));
  mesh.name = "rocks";
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  const group = new THREE.Group();
  group.name = "rocks";
  group.add(mesh);
  return built(group);
};
