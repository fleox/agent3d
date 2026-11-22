// Character construction kit: a bone hierarchy of THREE.Groups, primitives
// stamped onto bones (keeping their smooth normals), then skinned into one
// SkinnedMesh per material tag ("solid", "glow" = unlit emissive bits,
// "glass" = transparent helmet / lenses). Every vertex is bound rigidly
// (weight 1) to its bone, so a character is 1–3 draw calls whatever its detail.
//
// Hiding a part at run time = scaling its bone to 0 (mouth shapes, closed
// eyes): its vertices collapse to a point.

import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";

export type Tag = "solid" | "glow" | "glass";
export type ColorFn = (x: number, y: number, z: number) => THREE.Color;
export type V3 = [number, number, number];

interface Chunk {
  pos: number[];
  nrm: number[];
  col: number[];
  idx: number[];
}

const newChunk = (): Chunk => ({ pos: [], nrm: [], col: [], idx: [] });

// Geometry factory with a detail level: "smooth" (claymation, default) or
// "lowpoly" (faceted, fewer triangles).
export class Kit {
  constructor(readonly smooth: boolean) {}
  private q(a: number, b: number): number {
    return this.smooth ? a : b;
  }
  // Segment counts follow the real size (`size` when the geometry is scaled
  // afterwards): big shapes stay round, tiny details stay cheap.
  private segs(size: number, lo: number, hi: number): number {
    return Math.round(Math.min(hi, Math.max(lo, lo + (size - 0.01) * (hi - lo) / 0.22)));
  }
  sphere(r: number, partial?: { phiStart?: number; phiLength?: number; thetaStart?: number; thetaLength?: number }, size = r): THREE.BufferGeometry {
    if (!partial && !this.smooth) return new THREE.IcosahedronGeometry(r, size > 0.1 ? 1 : 0);
    const w = this.smooth ? this.segs(size, 10, 30) : this.segs(size, 6, 10);
    return new THREE.SphereGeometry(r, w, Math.max(5, Math.round(w * 0.62)), partial?.phiStart, partial?.phiLength, partial?.thetaStart, partial?.thetaLength);
  }
  // Capsule hanging down from its top (y = 0 at the top cap centre).
  capsule(r: number, len: number): THREE.BufferGeometry {
    const c = new THREE.CapsuleGeometry(r, len, this.smooth ? this.segs(r, 3, 6) : 2, this.smooth ? this.segs(r * 2, 8, 18) : 6);
    c.translate(0, -len / 2, 0);
    return c;
  }
  cyl(rt: number, rb: number, h: number, open = false): THREE.BufferGeometry {
    return new THREE.CylinderGeometry(rt, rb, h, this.smooth ? this.segs(Math.max(rt, rb) * 2, 10, 26) : 8, 1, open);
  }
  cone(r: number, h: number, seg?: number): THREE.BufferGeometry {
    return new THREE.ConeGeometry(r, h, seg ?? (this.smooth ? this.segs(r * 2, 8, 20) : 6));
  }
  torus(R: number, r: number, arc = Math.PI * 2): THREE.BufferGeometry {
    const around = Math.max(4, Math.round((this.smooth ? this.segs(R * 2, 10, 32) : this.segs(R, 5, 10)) * (arc / (Math.PI * 2)) + 2));
    return new THREE.TorusGeometry(R, r, this.smooth ? this.segs(r * 3, 5, 10) : 4, around, arc);
  }
  rbox(w: number, h: number, d: number, r: number): THREE.BufferGeometry {
    return new RoundedBoxGeometry(w, h, d, this.smooth ? (r > 0.04 ? 3 : 2) : 1, Math.min(r, w / 2, h / 2, d / 2) * 0.999);
  }
  // Surface of revolution through [radius, y] points (bottom → top).
  lathe(points: [number, number][], segments?: number): THREE.BufferGeometry {
    const pts = points.map(([x, y]) => new THREE.Vector2(Math.max(0.0001, x), y));
    // Smooth the profile with a Catmull-Rom spline (claymation curves).
    const curve = new THREE.SplineCurve(pts);
    const smoothPts = this.smooth ? curve.getPoints(points.length * 3) : pts;
    return new THREE.LatheGeometry(smoothPts, segments ?? this.q(30, 9));
  }
}

export class Parts {
  private chunks = new Map<THREE.Object3D, Record<Tag, Chunk>>();

  add(bone: THREE.Object3D, geo: THREE.BufferGeometry, m: THREE.Matrix4, color: THREE.Color | ColorFn, tag: Tag = "solid"): void {
    let e = this.chunks.get(bone);
    if (!e) this.chunks.set(bone, (e = { solid: newChunk(), glow: newChunk(), glass: newChunk() }));
    const ch = e[tag];
    if (!geo.getAttribute("normal")) geo.computeVertexNormals();
    const p = geo.getAttribute("position") as THREE.BufferAttribute;
    const n = geo.getAttribute("normal") as THREE.BufferAttribute;
    const nm = new THREE.Matrix3().getNormalMatrix(m);
    const flip = m.determinant() < 0;
    const base = ch.pos.length / 3;
    const v = new THREE.Vector3();
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i);
      const c = typeof color === "function" ? color(v.x, v.y, v.z) : color;
      v.applyMatrix4(m);
      ch.pos.push(v.x, v.y, v.z);
      v.fromBufferAttribute(n, i).applyMatrix3(nm).normalize();
      ch.nrm.push(v.x, v.y, v.z);
      ch.col.push(c.r, c.g, c.b);
    }
    if (geo.index) {
      const ix = geo.index;
      for (let i = 0; i < ix.count; i += 3) {
        const a = ix.getX(i), b = ix.getX(i + 1), c = ix.getX(i + 2);
        if (flip) ch.idx.push(base + a, base + c, base + b);
        else ch.idx.push(base + a, base + b, base + c);
      }
    } else {
      for (let i = 0; i < p.count; i += 3) {
        if (flip) ch.idx.push(base + i, base + i + 2, base + i + 1);
        else ch.idx.push(base + i, base + i + 1, base + i + 2);
      }
    }
    geo.dispose();
  }

  // Skins everything onto the rig. Bind pose = the rest pose (rig unparented).
  finish(rig: THREE.Object3D, materials: Record<Tag, THREE.Material>): THREE.SkinnedMesh[] {
    rig.updateMatrixWorld(true);
    const bones: THREE.Object3D[] = [];
    rig.traverse((o) => {
      if (o !== rig && o instanceof THREE.Group) bones.push(o);
    });
    const skeleton = new THREE.Skeleton(bones as THREE.Bone[]);
    const meshes: THREE.SkinnedMesh[] = [];
    for (const tag of ["solid", "glow", "glass"] as const) {
      const pos: number[] = [];
      const nrm: number[] = [];
      const col: number[] = [];
      const idx: number[] = [];
      const skin: number[] = [];
      const v = new THREE.Vector3();
      for (const [bone, e] of this.chunks) {
        const ch = e[tag];
        if (!ch.idx.length) continue;
        const bi = bones.indexOf(bone);
        const base = pos.length / 3;
        const nm = new THREE.Matrix3().getNormalMatrix(bone.matrixWorld);
        for (let k = 0; k < ch.pos.length; k += 3) {
          v.set(ch.pos[k]!, ch.pos[k + 1]!, ch.pos[k + 2]!).applyMatrix4(bone.matrixWorld);
          pos.push(v.x, v.y, v.z);
          v.set(ch.nrm[k]!, ch.nrm[k + 1]!, ch.nrm[k + 2]!).applyMatrix3(nm).normalize();
          nrm.push(v.x, v.y, v.z);
          skin.push(Math.max(0, bi), 0, 0, 0);
        }
        for (const c of ch.col) col.push(c);
        for (const i of ch.idx) idx.push(base + i);
      }
      if (!idx.length) continue;
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
      geo.setAttribute("normal", new THREE.Float32BufferAttribute(nrm, 3));
      geo.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
      geo.setAttribute("skinIndex", new THREE.Uint16BufferAttribute(skin, 4));
      const w = new Float32Array(skin.length);
      for (let k = 0; k < w.length; k += 4) w[k] = 1;
      geo.setAttribute("skinWeight", new THREE.BufferAttribute(w, 4));
      geo.setIndex(pos.length / 3 > 65535 ? new THREE.Uint32BufferAttribute(idx, 1) : new THREE.Uint16BufferAttribute(idx, 1));
      geo.computeBoundingBox();
      geo.computeBoundingSphere();
      const mesh = new THREE.SkinnedMesh(geo, materials[tag]);
      mesh.name = `character-${tag}`;
      mesh.castShadow = tag !== "glass";
      mesh.receiveShadow = tag === "solid";
      if (tag === "glass") mesh.renderOrder = 2;
      // Limbs leave the bind-pose bounds when animated; characters are small.
      mesh.frustumCulled = false;
      rig.add(mesh);
      mesh.bind(skeleton, new THREE.Matrix4());
      meshes.push(mesh);
    }
    return meshes;
  }
}

// A bone (THREE.Group) remembering its rest position / rotation.
export function bone(name: string, parent: THREE.Object3D, x = 0, y = 0, z = 0, rest?: { rx?: number; ry?: number; rz?: number }): THREE.Group {
  const o = new THREE.Group();
  o.name = name;
  o.position.set(x, y, z);
  o.userData.rest = o.position.clone();
  o.userData.restRot = new THREE.Euler(rest?.rx ?? 0, rest?.ry ?? 0, rest?.rz ?? 0);
  o.rotation.copy(o.userData.restRot as THREE.Euler);
  parent.add(o);
  return o;
}

const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
export const mat = (x: number, y: number, z: number, sx = 1, sy = sx, sz = sx, rx = 0, ry = 0, rz = 0): THREE.Matrix4 =>
  new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), _q.setFromEuler(_e.set(rx, ry, rz)).clone(), new THREE.Vector3(sx, sy, sz));

// Matrix placing a part at `p`, its local +Z along `normal`, with an extra roll.
export function matOn(p: V3, normal: THREE.Vector3, s: V3 = [1, 1, 1], roll = 0): THREE.Matrix4 {
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal.clone().normalize());
  if (roll) q.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), roll));
  return new THREE.Matrix4().compose(new THREE.Vector3(...p), q, new THREE.Vector3(...s));
}

export const shade = (c: THREE.Color, f: number): THREE.Color => c.clone().multiplyScalar(f);
export const mix = (a: THREE.Color, b: THREE.Color | string, t: number): THREE.Color => a.clone().lerp(typeof b === "string" ? new THREE.Color(b) : b, t);
export const C = (hex: string): THREE.Color => new THREE.Color(hex);
export const I4 = new THREE.Matrix4();
