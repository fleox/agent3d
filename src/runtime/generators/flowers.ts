// Little low-poly flowers: three instanced meshes (stems, petals tinted per
// instance, hearts) swaying with the wind — 3 draw calls for any count.

import * as THREE from "three";
import type { GeneratorImpl } from "../registry";
import { generatorParams } from "./params";
import { MeshBuilder, built, findGround, scatterPoint } from "./geom";
import { addWind } from "./wind";

const STEM_H = 0.22;

function stemGeometry(): THREE.BufferGeometry {
  const b = new MeshBuilder();
  const green = new THREE.Color("#4c8c2b");
  const leaf = new THREE.Color("#6aab3a");
  const w = 0.008;
  // crossed quads stem
  b.quad([-w, 0, 0], [w, 0, 0], [w, STEM_H, 0], [-w, STEM_H, 0], green);
  b.quad([w, 0, 0], [-w, 0, 0], [-w, STEM_H, 0], [w, STEM_H, 0], green);
  b.quad([0, 0, -w], [0, 0, w], [0, STEM_H, w], [0, STEM_H, -w], green);
  b.quad([0, 0, w], [0, 0, -w], [0, STEM_H, -w], [0, STEM_H, w], green);
  // two leaves
  for (const sgn of [1, -1]) {
    const y = 0.08 + (sgn > 0 ? 0 : 0.05);
    const a: [number, number, number] = [0, y, 0], c: [number, number, number] = [0.11 * sgn, y + 0.07, 0], l: [number, number, number] = [0.05 * sgn, y + 0.02, 0.035], r: [number, number, number] = [0.05 * sgn, y + 0.05, -0.035];
    b.tri(a, l, c, leaf);
    b.tri(a, c, l, leaf);
    b.tri(a, c, r, leaf);
    b.tri(a, r, c, leaf);
  }
  return b.build();
}

function petalsGeometry(): THREE.BufferGeometry {
  const b = new MeshBuilder();
  const white = new THREE.Color(1, 1, 1);
  const n = 5;
  const y = STEM_H;
  for (let k = 0; k < n; k++) {
    const a = (k / n) * Math.PI * 2;
    const da = Math.PI / n;
    const tip: [number, number, number] = [Math.cos(a) * 0.11, y + 0.035, Math.sin(a) * 0.11];
    const l: [number, number, number] = [Math.cos(a - da * 0.8) * 0.06, y + 0.02, Math.sin(a - da * 0.8) * 0.06];
    const r: [number, number, number] = [Math.cos(a + da * 0.8) * 0.06, y + 0.02, Math.sin(a + da * 0.8) * 0.06];
    const c: [number, number, number] = [0, y, 0];
    b.tri(c, r, tip, white);
    b.tri(c, tip, l, white);
    b.tri(c, tip, r, white.clone().multiplyScalar(0.8));
    b.tri(c, l, tip, white.clone().multiplyScalar(0.8));
  }
  return b.build();
}

export const flowers: GeneratorImpl = (raw, ctx) => {
  const p = generatorParams("flowers", raw, ctx);
  const count = p.int("count");
  const area = p.vec3("area");
  const colors = p.colors("colors");
  const rng = ctx.rng;
  const ground = p.bool("onTerrain") ? findGround(ctx) : null;

  const stemMat = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.9 });
  const petalMat = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.7 });
  const heartMat = new THREE.MeshStandardMaterial({ color: "#ffcf33", flatShading: true, roughness: 0.6 });
  const winds = [stemMat, petalMat, heartMat].map((m) => addWind(m, { mode: "instanced", strength: 0.35, height: STEM_H }));
  const heartGeo = new THREE.IcosahedronGeometry(0.035, 0);
  heartGeo.scale(1, 0.6, 1);
  heartGeo.translate(0, STEM_H + 0.03, 0);
  const stems = new THREE.InstancedMesh(stemGeometry(), stemMat, count);
  const petals = new THREE.InstancedMesh(petalsGeometry(), petalMat, count);
  const hearts = new THREE.InstancedMesh(heartGeo, heartMat, count);
  stems.name = "flower-stems";
  petals.name = "flower-petals";
  hearts.name = "flower-hearts";
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  for (let k = 0; k < count; k++) {
    const pt = scatterPoint(rng, area, ground, 0.1);
    const sc = rng.range(0.7, 1.4);
    q.setFromEuler(new THREE.Euler(rng.range(-0.12, 0.12), rng.next() * Math.PI * 2, rng.range(-0.12, 0.12)));
    m.compose(new THREE.Vector3(pt.x, ground ? pt.y - 0.01 : 0, pt.z), q, new THREE.Vector3(sc, sc, sc));
    stems.setMatrixAt(k, m);
    petals.setMatrixAt(k, m);
    hearts.setMatrixAt(k, m);
    petals.setColorAt(k, rng.pick(colors));
  }
  const group = new THREE.Group();
  group.name = "flowers";
  for (const im of [stems, petals, hearts]) {
    im.instanceMatrix.needsUpdate = true;
    im.computeBoundingSphere();
    im.castShadow = im !== stems;
    group.add(im);
  }
  return built(group, {
    update: (t) => {
      for (const w of winds) w.uniforms.uTime.value = t;
    },
  });
};
