// Instanced grass blades (one draw call) with base → tip colour gradient and
// wind in the vertex shader. Normals point up so blades shade like the ground.

import * as THREE from "three";
import type { GeneratorImpl } from "../registry";
import { generatorParams } from "./params";
import { built, findGround, ramp, scatterPoint } from "./geom";
import { noise2D } from "../random";
import { addWind } from "./wind";

export function bladeGeometry(height: number, colors: THREE.Color[]): THREE.BufferGeometry {
  // 5 vertices, 3 triangles: tapered blade with a slight bend.
  const w = 0.035;
  const pts: [number, number, number][] = [
    [-w, 0, 0],
    [w, 0, 0],
    [-w * 0.65, height * 0.45, 0.02 * height],
    [w * 0.65, height * 0.45, 0.02 * height],
    [0, height, 0.12 * height],
  ];
  const pos = new Float32Array(pts.flat());
  const col = new Float32Array(15);
  const c = new THREE.Color();
  pts.forEach((pt, i) => {
    ramp(colors, pt[1] / height, c);
    if (i === 4) c.lerp(new THREE.Color("#f4ffb0"), 0.25); // sunlit tip
    col.set([c.r, c.g, c.b], i * 3);
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  g.setAttribute("color", new THREE.BufferAttribute(col, 3));
  g.setAttribute("normal", new THREE.BufferAttribute(new Float32Array(Array.from({ length: 5 }, () => [0, 1, 0]).flat()), 3));
  g.setIndex([0, 1, 3, 0, 3, 2, 2, 3, 4]);
  g.computeBoundingSphere();
  return g;
}

export const grass: GeneratorImpl = (raw, ctx) => {
  const p = generatorParams("grass", raw, ctx);
  const count = p.int("count");
  const area = p.vec3("area");
  const height = p.num("height");
  const colors = p.colors("colors");
  const rng = ctx.rng;
  const ground = p.bool("onTerrain") ? findGround(ctx) : null;

  const geometry = bladeGeometry(height, colors);
  const material = new THREE.MeshStandardMaterial({ vertexColors: true, side: THREE.DoubleSide, roughness: 1, metalness: 0 });
  const wind = addWind(material, { mode: "instanced", strength: p.num("wind") * 0.6, height });
  // Back faces keep the upward normal (three flips it for DoubleSide): blades
  // shade like the ground from both sides.
  const prev = material.onBeforeCompile;
  material.onBeforeCompile = (shader, r) => {
    prev.call(material, shader, r);
    shader.fragmentShader = shader.fragmentShader.replace("#include <normal_fragment_begin>", "#include <normal_fragment_begin>\n#ifdef DOUBLE_SIDED\nnormal *= faceDirection;\n#endif");
  };
  const mesh = new THREE.InstancedMesh(geometry, material, count);
  mesh.name = "grass";
  mesh.receiveShadow = true;
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const s = new THREE.Vector3();
  const v = new THREE.Vector3();
  const tint = new THREE.Color();
  for (let k = 0; k < count; k++) {
    const pt = scatterPoint(rng, area, ground, 0.05);
    v.set(pt.x, ground ? pt.y - 0.02 : 0, pt.z);
    e.set(rng.range(-0.15, 0.15), rng.next() * Math.PI * 2, rng.range(-0.15, 0.15));
    q.setFromEuler(e);
    const sc = rng.range(0.6, 1.35);
    s.set(sc, sc * rng.range(0.8, 1.2), sc);
    m.compose(v, q, s);
    mesh.setMatrixAt(k, m);
    // Meadow patches (large-scale noise: lusher / drier areas) + per-blade jitter.
    const patch = noise2D(pt.x * 0.12 + 7.3, pt.z * 0.12 - 2.1) * 0.5 + 0.5;
    const dry = Math.max(0, noise2D(pt.x * 0.05 - 3.7, pt.z * 0.05 + 5.9)) * 0.35;
    const l = rng.range(0.85, 1.1) * (0.82 + patch * 0.3);
    tint.setRGB(l * (1 + dry * 0.35), l * rng.range(0.97, 1.03), l * (0.95 - dry * 0.4));
    mesh.setColorAt(k, tint);
  }
  mesh.instanceMatrix.needsUpdate = true;
  mesh.computeBoundingSphere();
  const group = new THREE.Group();
  group.name = "grass";
  group.add(mesh);
  return built(group, {
    update: (t) => {
      wind.uniforms.uTime.value = t;
    },
  });
};
