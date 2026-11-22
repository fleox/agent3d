// Abstract composition for banners (Memphis / pastel 3D): spheres, tori,
// rings, pills, cones, cubes, half-discs, squiggles and triangles scattered in
// a slab with a balanced (relaxed) layout, pastel palette, gentle float and
// rotation. One InstancedMesh per shape kind; transforms are pure functions
// of t. The material style is soft matte, glossy plastic or toon.

import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import type { GeneratorImpl } from "../registry";
import { generatorParams } from "./params";
import { built } from "./geom";

export const SHAPE_KINDS = ["sphere", "torus", "ring", "pill", "cone", "cube", "halfDisc", "squiggle", "triangle", "star"] as const;
type Kind = (typeof SHAPE_KINDS)[number];

function geometryFor(kind: Kind): THREE.BufferGeometry {
  switch (kind) {
    case "sphere":
      return new THREE.SphereGeometry(0.5, 40, 28);
    case "torus":
      return new THREE.TorusGeometry(0.38, 0.14, 24, 64);
    case "ring":
      return new THREE.TorusGeometry(0.42, 0.045, 12, 64);
    case "pill":
      return new THREE.CapsuleGeometry(0.2, 0.6, 10, 24).rotateZ(Math.PI / 2);
    case "cone":
      return new THREE.ConeGeometry(0.4, 0.8, 40);
    case "cube":
      return new RoundedBoxGeometry(0.7, 0.7, 0.7, 4, 0.08);
    case "halfDisc": {
      const g = new THREE.CylinderGeometry(0.5, 0.5, 0.18, 40, 1, false, 0, Math.PI);
      g.rotateX(Math.PI / 2);
      return g;
    }
    case "squiggle": {
      const pts = Array.from({ length: 9 }, (_, k) => new THREE.Vector3((k / 8 - 0.5) * 1.3, Math.sin(k * 1.4) * 0.16, 0));
      return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 80, 0.06, 12, false);
    }
    case "triangle": {
      const s = new THREE.Shape();
      for (let k = 0; k < 3; k++) {
        const a = Math.PI / 2 + (k / 3) * Math.PI * 2;
        if (k === 0) s.moveTo(Math.cos(a) * 0.5, Math.sin(a) * 0.5);
        else s.lineTo(Math.cos(a) * 0.5, Math.sin(a) * 0.5);
      }
      const g = new THREE.ExtrudeGeometry(s, { depth: 0.16, bevelEnabled: true, bevelThickness: 0.04, bevelSize: 0.04, bevelSegments: 4 });
      g.center();
      return g;
    }
    case "star": {
      const s = new THREE.Shape();
      for (let k = 0; k < 10; k++) {
        const a = Math.PI / 2 + (k / 10) * Math.PI * 2;
        const r = k % 2 ? 0.22 : 0.5;
        if (k === 0) s.moveTo(Math.cos(a) * r, Math.sin(a) * r);
        else s.lineTo(Math.cos(a) * r, Math.sin(a) * r);
      }
      const g = new THREE.ExtrudeGeometry(s, { depth: 0.14, bevelEnabled: true, bevelThickness: 0.04, bevelSize: 0.03, bevelSegments: 3 });
      g.center();
      return g;
    }
  }
}

export const abstractShapes: GeneratorImpl = (raw, ctx) => {
  const p = generatorParams("abstractShapes", raw, ctx);
  const count = p.int("count");
  const area = p.vec3("area");
  const colors = p.colors("colors");
  const minS = p.num("minSize");
  const maxS = Math.max(minS, p.num("maxSize"));
  const style = p.str<"matte" | "glossy" | "toon">("style");
  const motion = p.num("motion");
  const rawKinds = p.raw("shapes");
  const kinds = (Array.isArray(rawKinds) ? rawKinds.filter((k): k is Kind => (SHAPE_KINDS as readonly string[]).includes(k as string)) : []) as Kind[];
  const use: Kind[] = kinds.length ? kinds : [...SHAPE_KINDS];
  const rng = ctx.rng;

  // Relaxed placement: best of several candidates = farthest from the others
  // (Mitchell's best-candidate), so shapes spread evenly and rarely overlap.
  const items: { pos: THREE.Vector3; s: number; kind: Kind; color: THREE.Color; rot: THREE.Euler; spin: THREE.Vector3; ph: number }[] = [];
  for (let i = 0; i < count; i++) {
    let best = new THREE.Vector3();
    let bestD = -1;
    for (let c = 0; c < 14; c++) {
      const cand = new THREE.Vector3((rng.next() - 0.5) * area[0], (rng.next() - 0.5) * area[1], (rng.next() - 0.5) * area[2]);
      let d = Infinity;
      for (const it of items) d = Math.min(d, cand.distanceTo(it.pos) - it.s * 0.6);
      if (d > bestD) {
        bestD = d;
        best = cand;
      }
    }
    // Big shapes first, then smaller ones fill the gaps.
    const s = minS + (maxS - minS) * Math.pow(1 - i / Math.max(1, count), 1.5) * rng.range(0.7, 1);
    items.push({
      pos: best,
      s,
      kind: use[i % use.length]!,
      color: colors[i % colors.length]!,
      rot: new THREE.Euler(rng.range(-0.6, 0.6), rng.next() * Math.PI * 2, rng.range(-0.8, 0.8)),
      spin: new THREE.Vector3(rng.range(-0.25, 0.25), rng.range(-0.35, 0.35), rng.range(-0.2, 0.2)),
      ph: rng.next() * Math.PI * 2,
    });
  }
  // Shuffle colours so neighbours differ.
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(rng.next() * (i + 1));
    const t = items[i]!.color;
    items[i]!.color = items[j]!.color;
    items[j]!.color = t;
  }

  const material =
    style === "toon"
      ? new THREE.MeshToonMaterial({ color: 0xffffff })
      : style === "glossy"
        ? new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.18, clearcoat: 1, clearcoatRoughness: 0.08 })
        : new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.62, metalness: 0 });
  const group = new THREE.Group();
  group.name = "abstractShapes";
  const meshes: { mesh: THREE.InstancedMesh; list: typeof items }[] = [];
  for (const kind of use) {
    const list = items.filter((it) => it.kind === kind);
    if (!list.length) continue;
    const mesh = new THREE.InstancedMesh(geometryFor(kind), material, list.length);
    mesh.name = `shapes-${kind}`;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.userData.materialTarget = true;
    list.forEach((it, i) => mesh.setColorAt(i, it.color));
    mesh.frustumCulled = false;
    group.add(mesh);
    meshes.push({ mesh, list });
  }
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const v = new THREE.Vector3();
  const sc = new THREE.Vector3();
  const place = (t: number) => {
    for (const { mesh, list } of meshes) {
      list.forEach((it, i) => {
        v.copy(it.pos);
        v.y += Math.sin(t * 0.8 + it.ph) * 0.12 * motion * (0.5 + it.s * 0.5);
        e.set(it.rot.x + it.spin.x * t * motion, it.rot.y + it.spin.y * t * motion, it.rot.z + it.spin.z * t * motion);
        q.setFromEuler(e);
        sc.setScalar(it.s);
        mesh.setMatrixAt(i, m.compose(v, q, sc));
      });
      mesh.instanceMatrix.needsUpdate = true;
    }
  };
  place(0);
  return built(group, { update: (t) => place(t) });
};
