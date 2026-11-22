// Endless-runner road along -z: asphalt tiles, dashed lane lines, edge lines,
// curbs (red / white by default) and striped verges (grass by default;
// `verge: false` leaves only the road for neon / brand looks), all periodic in TILE so the whole
// mesh just slides toward the camera (+z) by (distance mod TILE): one draw
// call, pure function of t while the speed is constant.
//
// userData: speed (scripts may change it, the road then integrates dt),
// distance (travelled), lanes, laneWidth, laneX(i) → x centre of lane i.

import * as THREE from "three";
import type { GeneratorImpl } from "../registry";
import { generatorParams } from "./params";
import { MeshBuilder, built, shade } from "./geom";

const TILE = 4;

export const road: GeneratorImpl = (raw, ctx) => {
  const p = generatorParams("road", raw, ctx);
  const width = p.num("width");
  const length = p.num("length");
  const lanes = p.int("lanes");
  const color = p.color("color");
  const lineColor = p.color("lineColor");
  const speed = p.num("speed");
  const showVerge = p.bool("verge");
  const curbColors = p.colors("curbColors");
  const vergeColors = p.colors("vergeColor");

  const zFar = -Math.ceil(length / TILE) * TILE - TILE;
  const zNear = TILE * 3;
  const hw = width / 2;
  const b = new MeshBuilder();
  // Verge stripes alternate between two tones (one colour → that colour + a 10 % darker stripe).
  const grassA = vergeColors[0]!;
  const grassB = vergeColors[1] ?? shade(grassA, 0.9);
  // Curb halves alternate; one colour → a solid curb.
  const red = curbColors[0]!;
  const white = curbColors[1] ?? red;
  const asphaltB = shade(color, 1.06);
  const lw = Math.max(0.06, width * 0.018);
  const verge = Math.max(4, width * 2);
  const y = 0;
  for (let z = zFar, k = 0; z < zNear; z += TILE, k++) {
    const z1 = z + TILE;
    // asphalt (two tones)
    b.quad([-hw, y, z1], [hw, y, z1], [hw, y, z1 - TILE / 2], [-hw, y, z1 - TILE / 2], color);
    b.quad([-hw, y, z1 - TILE / 2], [hw, y, z1 - TILE / 2], [hw, y, z], [-hw, y, z], asphaltB);
    // lane dashes
    for (let l = 1; l < lanes; l++) {
      const x = -hw + (width / lanes) * l;
      b.quad([x - lw, y + 0.01, z1 - 0.4], [x + lw, y + 0.01, z1 - 0.4], [x + lw, y + 0.01, z1 - 0.4 - TILE * 0.45], [x - lw, y + 0.01, z1 - 0.4 - TILE * 0.45], lineColor);
    }
    // edge lines
    for (const s of [-1, 1]) {
      const x = s * (hw - lw * 3);
      b.quad([x - lw, y + 0.01, z1], [x + lw, y + 0.01, z1], [x + lw, y + 0.01, z], [x - lw, y + 0.01, z], lineColor);
    }
    // curbs (raised, red / white halves)
    for (const s of [-1, 1]) {
      const xa = s > 0 ? hw : -hw - 0.35;
      const xb = s > 0 ? hw + 0.35 : -hw;
      b.box([xa, -0.02, z1 - TILE / 2], [xb, 0.12, z1], red, red);
      b.box([xa, -0.02, z], [xb, 0.12, z1 - TILE / 2], white, white);
      if (!showVerge) continue;
      // verge
      const ga = s > 0 ? hw + 0.35 : -hw - 0.35 - verge;
      const gb = s > 0 ? hw + 0.35 + verge : -hw - 0.35;
      b.quad([ga, 0.02, z1], [gb, 0.02, z1], [gb, 0.02, z], [ga, 0.02, z], k % 2 ? grassA : grassB);
    }
  }
  const mesh = new THREE.Mesh(b.build(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, flatShading: true }));
  mesh.name = "road-surface";
  mesh.receiveShadow = true;
  const group = new THREE.Group();
  group.name = "road";
  group.add(mesh);
  const laneWidth = width / lanes;
  group.userData.speed = speed;
  group.userData.distance = 0;
  group.userData.lanes = lanes;
  group.userData.laneWidth = laneWidth;
  group.userData.laneX = (i: number) => -hw + laneWidth * (i + 0.5);

  let lastT = 0;
  let dist = 0;
  let pure = true;
  return built(group, {
    update: (t, dt) => {
      const s = Number(group.userData.speed);
      if (pure && s !== speed) pure = false;
      if (pure) dist = t * speed;
      else dist += (Number.isFinite(dt) ? dt : t - lastT) * (Number.isFinite(s) ? s : 0);
      lastT = t;
      group.userData.distance = dist;
      mesh.position.z = ((dist % TILE) + TILE) % TILE;
    },
  });
};
