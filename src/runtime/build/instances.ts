// InstancedMesh: one geometry/material drawn many times (grid, scatter, circle, list).

import * as THREE from "three";
import type { InstancesObjectDef, TransformDef } from "../../core/types";
import type { Rng } from "../registry";
import { DEG, num } from "../util";

export interface InstanceTransform {
  position: THREE.Vector3;
  rotation: THREE.Euler;
  scale: THREE.Vector3;
}

export function layoutInstances(layout: InstancesObjectDef["layout"], rng: Rng): InstanceTransform[] {
  const out: InstanceTransform[] = [];
  const push = (p: THREE.Vector3, r = new THREE.Euler(), s = new THREE.Vector3(1, 1, 1)) => out.push({ position: p, rotation: r, scale: s });
  switch (layout.type) {
    case "grid": {
      const [cx, cy, cz] = layout.count.map((c) => Math.max(1, Math.round(c)));
      const [sx, sy, sz] = layout.spacing;
      for (let x = 0; x < cx; x++)
        for (let y = 0; y < cy; y++)
          for (let z = 0; z < cz; z++) push(new THREE.Vector3((x - (cx - 1) / 2) * sx, (y - (cy - 1) / 2) * sy, (z - (cz - 1) / 2) * sz));
      break;
    }
    case "scatter": {
      const minS = num(layout.minScale, 1), maxS = num(layout.maxScale, 1);
      const [ax, ay, az] = layout.area;
      for (let i = 0; i < Math.max(0, Math.round(layout.count)); i++) {
        const p = new THREE.Vector3(rng.range(-ax / 2, ax / 2), rng.range(-ay / 2, ay / 2), rng.range(-az / 2, az / 2));
        const r = layout.randomRotation === false ? new THREE.Euler() : new THREE.Euler(0, rng.range(0, Math.PI * 2), 0);
        const s = rng.range(minS, maxS);
        push(p, r, new THREE.Vector3(s, s, s));
      }
      break;
    }
    case "circle": {
      const n = Math.max(1, Math.round(layout.count));
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2;
        push(new THREE.Vector3(Math.cos(a) * layout.radius, 0, Math.sin(a) * layout.radius), new THREE.Euler(0, -a, 0));
      }
      break;
    }
    case "list":
      for (const it of layout.items as TransformDef[]) {
        const p = it.position ?? [0, 0, 0];
        const r = it.rotation ?? [0, 0, 0];
        const s = it.scale ?? 1;
        push(new THREE.Vector3(...p), new THREE.Euler(r[0] * DEG, r[1] * DEG, r[2] * DEG), typeof s === "number" ? new THREE.Vector3(s, s, s) : new THREE.Vector3(...s));
      }
      break;
  }
  return out;
}

export function buildInstances(def: InstancesObjectDef, geometry: THREE.BufferGeometry, material: THREE.Material, rng: Rng, color: (c: string) => THREE.Color): THREE.InstancedMesh {
  const items = layoutInstances(def.layout, rng);
  const mesh = new THREE.InstancedMesh(geometry, material, Math.max(1, items.length));
  mesh.count = items.length;
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  items.forEach((it, i) => {
    m.compose(it.position, q.setFromEuler(it.rotation), it.scale);
    mesh.setMatrixAt(i, m);
  });
  if (def.colors?.length) {
    const random = def.layout.type === "scatter";
    items.forEach((_, i) => mesh.setColorAt(i, color(random ? rng.pick(def.colors!) : def.colors![i % def.colors!.length])));
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }
  mesh.instanceMatrix.needsUpdate = true;
  mesh.computeBoundingBox();
  mesh.computeBoundingSphere();
  return mesh;
}
