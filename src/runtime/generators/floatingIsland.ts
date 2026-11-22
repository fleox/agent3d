// Stylised floating island (the classic diorama hero): a grassy, gently
// rolling top with a noisy outline and a grass lip, a dirt band, then a rocky
// underside tapering to stalactite tips with coloured strata. Optional trees,
// rocks, flowers and grass (the sibling generators, planted on the top), a
// pond with a waterfall pouring off the edge, floating debris and a slow
// bob — every motion a pure function of t.

import * as THREE from "three";
import type { BuildContext, BuiltObject, GeneratorImpl } from "../registry";
import { fbm2D, noise2D } from "../random";
import { generatorParams } from "./params";
import { built, ramp, smoothstep } from "./geom";
import { trees } from "./trees";
import { rocks } from "./rocks";
import { flowers } from "./flowers";
import { grass } from "./grass";

const TAU = Math.PI * 2;

export const floatingIsland: GeneratorImpl = async (raw, ctx) => {
  const p = generatorParams("floatingIsland", raw, ctx);
  const R = p.num("radius");
  const depth = p.num("depth");
  const hills = p.num("hills");
  const lowpoly = p.bool("lowpoly");
  const grassCol = p.colors("grassColors");
  const dirt = p.color("dirtColor");
  const rockCols = p.colors("rockColors");
  const rng = ctx.rng;
  const seed = rng.next() * 100;

  // Outline radius as a function of the angle (noise on the circle).
  const edge = (a: number): number => R * (1 + 0.16 * noise2D(Math.cos(a) * 1.3 + seed, Math.sin(a) * 1.3 - seed) + 0.06 * noise2D(Math.cos(a) * 3.1 - seed, Math.sin(a) * 3.1));
  // Top surface height (0 at the rim).
  const top = (x: number, z: number): number => {
    const a = Math.atan2(z, x);
    const d = Math.hypot(x, z) / edge(a);
    if (d > 1) return 0;
    const fall = 1 - smoothstep(0.5, 1, d) ** 1.5;
    const n = fbm2D(x / R * 1.4 + seed, z / R * 1.4 - seed, 4) * 0.5 + 0.5;
    return (hills * R * 0.32 * n * n + R * 0.07) * fall;
  };
  const lip = R * 0.16; // dirt band height under the grass

  // ── Mesh: polar grid for the top, rings for the side + underside ──
  const sectors = lowpoly ? 40 : 96;
  const topRings = lowpoly ? 10 : 22;
  const underRings = lowpoly ? 9 : 22;
  const pos: number[] = [];
  const col: number[] = [];
  const idx: number[] = [];
  const c = new THREE.Color();
  const vert = (x: number, y: number, z: number, color: THREE.Color): number => {
    pos.push(x, y, z);
    col.push(color.r, color.g, color.b);
    return pos.length / 3 - 1;
  };
  const grassAt = (x: number, z: number, h: number): THREE.Color => {
    const n = fbm2D(x * 0.6 + 3.1, z * 0.6 - 1.7, 3) * 0.5 + 0.5;
    ramp(grassCol, Math.min(1, Math.max(0, n * 0.8 + h / (R * 0.3) * 0.4)), c);
    return c.clone();
  };
  // Centre vertex + rings.
  const centre = vert(0, top(0, 0), 0, grassAt(0, 0, top(0, 0)));
  const ringStart: number[] = [];
  for (let r = 1; r <= topRings; r++) {
    ringStart.push(pos.length / 3);
    const f = r / topRings;
    for (let s = 0; s < sectors; s++) {
      const a = (s / sectors) * TAU;
      const e = edge(a) * (r === topRings ? 1.04 : f); // last ring = slight grass overhang
      const x = Math.cos(a) * e, z = Math.sin(a) * e;
      const y = r === topRings ? -lip * 0.18 : top(x, z);
      vert(x, y, z, r === topRings ? grassAt(x, z, 0).multiplyScalar(0.8) : grassAt(x, z, y));
    }
  }
  const quadRing = (a0: number, a1: number) => {
    for (let s = 0; s < sectors; s++) {
      const s1 = (s + 1) % sectors;
      idx.push(a0 + s, a1 + s1, a1 + s, a0 + s, a0 + s1, a1 + s1);
    }
  };
  for (let s = 0; s < sectors; s++) idx.push(centre, ringStart[0]! + ((s + 1) % sectors), ringStart[0]! + s);
  for (let r = 0; r < topRings - 1; r++) {
    // CCW from above: inner ring → outer ring.
    const a0 = ringStart[r]!, a1 = ringStart[r + 1]!;
    for (let s = 0; s < sectors; s++) {
      const s1 = (s + 1) % sectors;
      idx.push(a0 + s, a0 + s1, a1 + s1, a0 + s, a1 + s1, a1 + s);
    }
  }
  // Side: grass lip folds under (dark), then the dirt band, then the rocky cone.
  const rings: number[] = [ringStart[topRings - 1]!];
  const dirtDark = dirt.clone().multiplyScalar(0.78);
  const sideRing = (rad: (a: number) => number, y: (a: number) => number, color: (a: number, yy: number) => THREE.Color) => {
    const start = pos.length / 3;
    for (let s = 0; s < sectors; s++) {
      const a = (s / sectors) * TAU;
      const rr = rad(a);
      const yy = y(a);
      vert(Math.cos(a) * rr, yy, Math.sin(a) * rr, color(a, yy));
    }
    rings.push(start);
  };
  const grassDark = grassCol[0]!.clone().multiplyScalar(0.62);
  sideRing((a) => edge(a) * 1.02, () => -lip * 0.32, () => grassDark);
  sideRing((a) => edge(a) * 0.97, () => -lip * 0.36, () => dirt);
  sideRing((a) => edge(a) * 0.96, (a) => -lip * (0.9 + 0.15 * noise2D(a * 3, seed)), (a) => dirt.clone().lerp(dirtDark, 0.5 + 0.5 * noise2D(a * 5, 1)));
  // Underside: radius shrinks to tips; spikes from angular noise; strata colours.
  for (let k = 1; k <= underRings; k++) {
    const u = k / underRings;
    sideRing(
      (a) => {
        const spike = 0.6 + 0.4 * (noise2D(Math.cos(a) * 2.6 + seed * 2, Math.sin(a) * 2.6) * 0.5 + 0.5);
        const shape = Math.pow(1 - u, 0.75 + (1 - spike) * 1.6);
        return edge(a) * 0.96 * Math.max(0.015, shape) * (1 + 0.13 * noise2D(Math.cos(a) * 4 + u * 3, Math.sin(a) * 4 + seed) + 0.05 * noise2D(a * 11, u * 9));
      },
      (a) => -lip - (depth - lip) * u * (0.55 + 0.55 * (noise2D(Math.cos(a) * 2.6 + seed * 2, Math.sin(a) * 2.6) * 0.5 + 0.5)),
      (a, yy) => {
        const band = Math.floor((-yy / depth) * 7 + noise2D(a * 2, 3) * 0.6);
        const base = rockCols[((band % rockCols.length) + rockCols.length) % rockCols.length]!.clone();
        const top = smoothstep(0.25, 0, u);
        return base.lerp(dirtDark, top * 0.7).multiplyScalar(0.92 + 0.12 * noise2D(a * 9, yy * 4) - u * 0.18);
      },
    );
  }
  for (let r = 0; r < rings.length - 1; r++) quadRing(rings[r]!, rings[r + 1]!);
  // Close the tip.
  const tip = vert(0, -depth * 1.02, 0, rockCols[rockCols.length - 1]!.clone().multiplyScalar(0.7));
  const last = rings[rings.length - 1]!;
  for (let s = 0; s < sectors; s++) idx.push(last + s, last + ((s + 1) % sectors), tip);

  let geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  geo.setIndex(idx);
  if (lowpoly) geo = geo.toNonIndexed();
  geo.computeVertexNormals();
  geo.computeBoundingSphere();
  const material = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: lowpoly, roughness: 0.92, metalness: 0 });
  const mesh = new THREE.Mesh(geo, material);
  mesh.name = "island";
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.userData.materialTarget = true;

  const island = new THREE.Group();
  island.name = "floatingIsland";
  island.add(mesh);
  const updaters: ((t: number, dt: number) => void)[] = [];

  // ── Planting: the sibling generators on a virtual terrain ──
  // heightAt is very low outside 85 % of the outline: scatterPoint rejects it as "under water".
  const ground: BuiltObject = {
    object: new THREE.Group(),
    heightAt: (x, z) => (Math.hypot(x, z) < edge(Math.atan2(z, x)) * 0.82 ? top(x, z) : -1e4),
  };
  ground.object.userData.surface = "terrain";
  ground.object.userData.waterLevel = -1e3;
  const sub: BuildContext = { ...ctx, siblings: new Map([["ground", ground]]) };
  const area: [number, number, number] = [R * 2.2, 0, R * 2.2];
  const plant = async (impl: GeneratorImpl, params: Record<string, unknown>) => {
    const b = await impl({ ...params, area, onTerrain: true }, sub);
    island.add(b.object);
    if (b.update) updaters.push(b.update.bind(b));
  };
  const nTrees = p.int("trees");
  if (nTrees > 0) await plant(trees, { count: nTrees, style: p.str("treeStyle"), minScale: R * 0.16, maxScale: R * 0.26, leafColors: p.raw("leafColors") });
  const nRocks = p.int("rocks");
  if (nRocks > 0) await plant(rocks, { count: nRocks, minSize: R * 0.05, maxSize: R * 0.14, colors: p.raw("rockColors") });
  const nFlowers = p.int("flowers");
  if (nFlowers > 0) await plant(flowers, { count: nFlowers });
  const nGrass = p.int("grass");
  if (nGrass > 0) await plant(grass, { count: nGrass, height: R * 0.06, colors: [grassCol[0]!.clone().multiplyScalar(0.8).getStyle(), grassCol[Math.min(1, grassCol.length - 1)]!.getStyle()], wind: 0.4 });

  // ── Pond + waterfall ──
  if (p.bool("waterfall")) {
    const a = rng.next() * TAU;
    const water = p.color("waterColor");
    const e = edge(a);
    const pondR = R * 0.17;
    const pc = new THREE.Vector3(Math.cos(a) * e * 0.62, 0, Math.sin(a) * e * 0.62);
    pc.y = top(pc.x, pc.z) + 0.01 * R;
    const pond = new THREE.Mesh(new THREE.CircleGeometry(pondR, 28), new THREE.MeshStandardMaterial({ color: water, roughness: 0.15, metalness: 0.1 }));
    pond.rotation.x = -Math.PI / 2;
    pond.position.copy(pc);
    pond.scale.set(1.25, 1, 1);
    pond.rotation.z = -a;
    island.add(pond);
    // Ribbon: from the pond over the rim and down the side, outward.
    const w = pondR * 0.9;
    const pts: THREE.Vector3[] = [];
    const steps = 28;
    const dir = new THREE.Vector3(Math.cos(a), 0, Math.sin(a));
    for (let k = 0; k <= steps; k++) {
      const u = k / steps;
      let rr: number, y: number;
      if (u < 0.25) {
        rr = e * (0.62 + (u / 0.25) * 0.42);
        y = top(dir.x * rr, dir.z * rr) + 0.012 * R;
        if (u > 0.2) y = Math.max(-lip * 0.1, y);
      } else {
        const f = (u - 0.25) / 0.75;
        rr = e * (1.05 + 0.18 * Math.sqrt(f));
        y = -lip * 0.1 - f * f * 0.2 * depth - f * depth * 1.05;
      }
      pts.push(dir.clone().multiplyScalar(rr).setY(y));
    }
    const curve = new THREE.CatmullRomCurve3(pts);
    const side = new THREE.Vector3(-dir.z, 0, dir.x);
    const rib = new THREE.BufferGeometry();
    const rp: number[] = [];
    const ruv: number[] = [];
    const ri: number[] = [];
    const segs = 60;
    for (let k = 0; k <= segs; k++) {
      const u = k / segs;
      const pt = curve.getPoint(u);
      const ww = w * (1 - u * 0.35);
      for (const s of [-1, 1]) {
        rp.push(pt.x + side.x * ww * s, pt.y, pt.z + side.z * ww * s);
        ruv.push(s * 0.5 + 0.5, u);
      }
      if (k < segs) {
        const b0 = k * 2;
        ri.push(b0, b0 + 1, b0 + 3, b0, b0 + 3, b0 + 2);
      }
    }
    rib.setAttribute("position", new THREE.Float32BufferAttribute(rp, 3));
    rib.setAttribute("uv", new THREE.Float32BufferAttribute(ruv, 2));
    rib.setIndex(ri);
    const fallUniforms = { uTime: { value: 0 }, uColor: { value: water.clone() } };
    const fallMat = new THREE.ShaderMaterial({
      uniforms: fallUniforms,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      vertexShader: /* glsl */ `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: /* glsl */ `
uniform float uTime; uniform vec3 uColor; varying vec2 vUv;
float h(vec2 p) { return fract(sin(dot(p, vec2(41.3, 289.1))) * 43758.5); }
float vn(vec2 p) { vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h(i), h(i + vec2(1.0, 0.0)), f.x), mix(h(i + vec2(0.0, 1.0)), h(i + vec2(1.0, 1.0)), f.x), f.y); }
void main() {
  vec2 q = vec2(vUv.x * 6.0, vUv.y * 5.0 - uTime * 1.4);
  float n = vn(q * vec2(1.0, 0.35)) * 0.6 + vn(q * vec2(2.3, 0.6) + 7.0) * 0.4;
  float streak = smoothstep(0.45, 0.85, n);
  float edgeA = smoothstep(0.0, 0.2, vUv.x) * smoothstep(1.0, 0.8, vUv.x);
  float fade = 1.0 - smoothstep(0.55, 1.0, vUv.y);
  float foam = smoothstep(0.32, 0.25, vUv.y) * smoothstep(0.18, 0.25, vUv.y);
  vec3 c = mix(uColor, vec3(1.0), clamp(0.25 + streak * 0.55 + foam * 0.6, 0.0, 1.0));
  gl_FragColor = vec4(c, (0.7 + streak * 0.3) * edgeA * fade);
  #include <colorspace_fragment>
}`,
    });
    const fall = new THREE.Mesh(rib, fallMat);
    fall.name = "waterfall";
    fall.renderOrder = 3;
    island.add(fall);
    updaters.push((t) => (fallUniforms.uTime.value = t));
  }

  // ── Floating debris rocks ──
  const nDebris = p.int("debris");
  if (nDebris > 0) {
    const dg = new THREE.DodecahedronGeometry(1, 0);
    const dm = new THREE.MeshStandardMaterial({ color: 0xffffff, flatShading: true, roughness: 0.95 });
    const debris = new THREE.InstancedMesh(dg, dm, nDebris);
    debris.name = "debris";
    debris.castShadow = true;
    const data = Array.from({ length: nDebris }, () => {
      const a = rng.next() * TAU;
      const rr = R * rng.range(1.2, 1.7);
      return { x: Math.cos(a) * rr, z: Math.sin(a) * rr, y: -depth * rng.range(0.1, 0.8), s: R * rng.range(0.03, 0.075), ph: rng.next() * TAU, rot: rng.next() * TAU };
    });
    const col2 = new THREE.Color();
    data.forEach((_, i) => debris.setColorAt(i, col2.copy(rockCols[i % rockCols.length]!)));
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const e2 = new THREE.Euler();
    const v = new THREE.Vector3();
    const sc = new THREE.Vector3();
    const place = (t: number) => {
      data.forEach((d, i) => {
        v.set(d.x, d.y + Math.sin(t * 0.8 + d.ph) * R * 0.04, d.z);
        e2.set(d.rot + t * 0.2, d.rot * 2 + t * 0.15, 0);
        q.setFromEuler(e2);
        sc.set(d.s, d.s * 0.8, d.s);
        debris.setMatrixAt(i, m.compose(v, q, sc));
      });
      debris.instanceMatrix.needsUpdate = true;
    };
    place(0);
    debris.computeBoundingSphere();
    debris.frustumCulled = false;
    island.add(debris);
    updaters.push((t) => place(t));
  }

  const root = new THREE.Group();
  root.name = "floatingIsland";
  root.add(island);
  const bob = p.num("float");
  return built(root, {
    update: (t, dt) => {
      island.position.y = Math.sin(t * 0.7) * bob;
      island.rotation.z = Math.sin(t * 0.45) * bob * 0.02;
      for (const u of updaters) u(t, dt);
    },
    heightAt: (x, z) => top(x, z) + island.position.y,
  });
};
