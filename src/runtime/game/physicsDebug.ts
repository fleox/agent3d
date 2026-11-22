// physics.debug: collider wireframes drawn over the scene (on top, no depth
// test) so agents can check colliders in render screenshots. Colours:
// dynamic green, static blue, kinematic orange, trigger magenta, sleeping grey.

import * as THREE from "three";
import type { Body, ShapeDesc } from "./physics";

const COLORS = { dynamic: 0x3ddc84, static: 0x4ea8ff, kinematic: 0xffa940, trigger: 0xff4fd8, sleeping: 0x9aa0a6 };

function circle(out: number[], r: number, axis: "x" | "y" | "z", y = 0, seg = 24) {
  for (let i = 0; i < seg; i++) {
    const a0 = (i / seg) * Math.PI * 2, a1 = ((i + 1) / seg) * Math.PI * 2;
    const p = (a: number): number[] => (axis === "y" ? [Math.cos(a) * r, y, Math.sin(a) * r] : axis === "x" ? [y, Math.cos(a) * r, Math.sin(a) * r] : [Math.cos(a) * r, Math.sin(a) * r, y]);
    out.push(...p(a0), ...p(a1));
  }
}

function shapeLines(s: ShapeDesc): number[] {
  const out: number[] = [];
  switch (s.type) {
    case "box": {
      const [x, y, z] = s.half;
      const c = [[-x, -y, -z], [x, -y, -z], [x, y, -z], [-x, y, -z], [-x, -y, z], [x, -y, z], [x, y, z], [-x, y, z]];
      for (const [a, b] of [[0, 1], [1, 2], [2, 3], [3, 0], [4, 5], [5, 6], [6, 7], [7, 4], [0, 4], [1, 5], [2, 6], [3, 7]]) out.push(...c[a!]!, ...c[b!]!);
      break;
    }
    case "sphere":
      circle(out, s.radius, "x");
      circle(out, s.radius, "y");
      circle(out, s.radius, "z");
      break;
    case "cylinder":
    case "capsule": {
      const r = s.radius;
      const h = s.type === "capsule" ? Math.max(s.height - 2 * r, 0) : s.height;
      circle(out, r, "y", h / 2);
      circle(out, r, "y", -h / 2);
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        out.push(Math.cos(a) * r, -h / 2, Math.sin(a) * r, Math.cos(a) * r, h / 2, Math.sin(a) * r);
      }
      if (s.type === "capsule") {
        for (const sign of [1, -1]) {
          for (let i = 0; i < 12; i++) {
            const a0 = (i / 12) * (Math.PI / 2), a1 = ((i + 1) / 12) * (Math.PI / 2);
            for (const [cx, cz] of [[1, 0], [0, 1], [-1, 0], [0, -1]]) {
              out.push(cx! * Math.cos(a0) * r, sign * (h / 2 + Math.sin(a0) * r), cz! * Math.cos(a0) * r, cx! * Math.cos(a1) * r, sign * (h / 2 + Math.sin(a1) * r), cz! * Math.cos(a1) * r);
            }
          }
        }
      }
      break;
    }
    case "convex":
      for (const f of s.faces)
        for (let i = 0; i < f.length; i++) {
          out.push(...s.vertices[f[i]!]!, ...s.vertices[f[(i + 1) % f.length]!]!);
        }
      break;
    case "trimesh": {
      const v = s.vertices;
      const idx = s.indices;
      const n = idx ? idx.length : v.length / 3;
      const P = (k: number) => {
        const i = (idx ? idx[k]! : k) * 3;
        return [v[i]!, v[i + 1]!, v[i + 2]!];
      };
      for (let t = 0; t + 2 < n; t += 3) {
        const a = P(t), b = P(t + 1), c = P(t + 2);
        out.push(...a, ...b, ...b, ...c, ...c, ...a);
      }
      break;
    }
    case "heightfield": {
      const d = s.data, es = s.elementSize;
      const step = Math.max(1, Math.round(d.length / 48));
      for (let i = 0; i < d.length; i += step)
        for (let j = 0; j + step < d[i]!.length; j += step) out.push(i * es, j * es, d[i]![j]!, i * es, (j + step) * es, d[i]![j + step]!);
      for (let j = 0; j < d[0]!.length; j += step)
        for (let i = 0; i + step < d.length; i += step) out.push(i * es, j * es, d[i]![j]!, (i + step) * es, j * es, d[i + step]![j]!);
      break;
    }
  }
  if (s.offset || s.quat) {
    const m = new THREE.Matrix4().compose(new THREE.Vector3(...(s.offset ?? [0, 0, 0])), new THREE.Quaternion(...(s.quat ?? [0, 0, 0, 1])), new THREE.Vector3(1, 1, 1));
    const v = new THREE.Vector3();
    for (let i = 0; i < out.length; i += 3) {
      v.set(out[i]!, out[i + 1]!, out[i + 2]!).applyMatrix4(m);
      out[i] = v.x;
      out[i + 1] = v.y;
      out[i + 2] = v.z;
    }
  }
  return out;
}

export class PhysicsDebug {
  readonly group = new THREE.Group();
  private items = new Map<string, { lines: THREE.LineSegments; body: Body }>();

  constructor(parent: THREE.Object3D) {
    this.group.name = "agent3d-physics-debug";
    this.group.renderOrder = 999;
    parent.add(this.group);
  }

  sync(bodies: Body[]): void {
    const live = new Set<string>();
    for (const b of bodies) {
      live.add(b.id);
      let it = this.items.get(b.id);
      if (!it || it.body !== b) {
        if (it) this.drop(b.id);
        const pos = b.shapes.flatMap(shapeLines);
        const g = new THREE.BufferGeometry();
        g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
        const mat = new THREE.LineBasicMaterial({ color: COLORS[b.type], depthTest: false, depthWrite: false, transparent: true, opacity: 0.9, toneMapped: false });
        const lines = new THREE.LineSegments(g, mat);
        lines.renderOrder = 999;
        lines.frustumCulled = false;
        this.group.add(lines);
        it = { lines, body: b };
        this.items.set(b.id, it);
      }
      const [x, y, z] = b.position;
      const [qx, qy, qz, qw] = b.quaternion;
      it.lines.position.set(x, y, z);
      it.lines.quaternion.set(qx, qy, qz, qw);
      (it.lines.material as THREE.LineBasicMaterial).color.setHex(b.sleeping ? COLORS.sleeping : COLORS[b.type]);
    }
    for (const id of [...this.items.keys()]) if (!live.has(id)) this.drop(id);
  }

  private drop(id: string): void {
    const it = this.items.get(id);
    if (!it) return;
    it.lines.removeFromParent();
    it.lines.geometry.dispose();
    (it.lines.material as THREE.Material).dispose();
    this.items.delete(id);
  }

  dispose(): void {
    for (const id of [...this.items.keys()]) this.drop(id);
    this.group.removeFromParent();
  }
}
