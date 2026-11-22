// Collider shapes from scene objects: turns an object (mesh, model,
// generator…) + its BodyDef into PhysicsWorld shapes expressed in the body
// frame. The body frame = the object's world rotation, origin at the collider
// centre (`offset` from the object origin, in world units), world scale baked
// into the shapes (cannon shapes cannot scale).

import * as THREE from "three";
import { ConvexHull } from "three/addons/math/ConvexHull.js";
import type { BodyDef, ColliderDef, ObjectDef } from "../../core/types";
import type { BuiltObject } from "../registry";
import { DEG } from "../util";
import type { BodyInit, Q4, ShapeDesc, V3 } from "./physics";

export interface ShapeSource {
  object: THREE.Object3D;
  def: BodyDef;
  objectDef?: ObjectDef;
  built?: BuiltObject;
}

export interface ShapeResult {
  shapes: ShapeDesc[];
  offset: THREE.Vector3; // collider centre in the object's (rotated, world-scaled) frame
  note?: string; // why a fallback was used
}

const MAX_TRIMESH_TRIS = 12000;
const MAX_HULL_POINTS = 600;

// Object frame without scale: world position + world rotation.
function frameOf(object: THREE.Object3D): { inv: THREE.Matrix4; scale: THREE.Vector3 } {
  object.updateWorldMatrix(true, true);
  const p = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3();
  object.matrixWorld.decompose(p, q, s);
  return { inv: new THREE.Matrix4().compose(p, q, new THREE.Vector3(1, 1, 1)).invert(), scale: s };
}

// Scene objects nested under another one (ObjectDef.children) carry their
// own a3dId; text letters ("<id>/<n>", never a valid scene id) belong to their text.
function isSceneChild(o: THREE.Object3D, rootId: string | undefined): boolean {
  const id = o.userData?.a3dId as string | undefined;
  return !!id && id !== rootId && !id.includes("/");
}

// Collision meshes of an object. "own" (the default) = the object's own
// geometry (incl. the parts a model / generator / text builds), never the
// scene objects nested under it: those have their own body, or are merged
// explicitly with `shape: "compound"`. `skip` prunes subtrees (children with
// a body when measuring a whole subtree).
function meshes(object: THREE.Object3D, mode: "own" | "tree" = "own", skip?: (o: THREE.Object3D) => boolean): THREE.Mesh[] {
  const out: THREE.Mesh[] = [];
  const rootId = object.userData?.a3dId as string | undefined;
  const visit = (o: THREE.Object3D) => {
    if (o !== object && ((mode === "own" && isSceneChild(o, rootId)) || skip?.(o))) return;
    const m = o as THREE.Mesh;
    if (m.isMesh && m.geometry?.getAttribute("position") && !o.userData.noCollide) out.push(m);
    for (const c of o.children) visit(c);
  };
  visit(object);
  return out;
}

// Own meshes, or — for an object without geometry of its own (a group) —
// the whole subtree minus children that have their own body.
function colliderMeshes(src: { object: THREE.Object3D; objectDef?: ObjectDef }): THREE.Mesh[] {
  const own = meshes(src.object);
  return own.length ? own : meshes(src.object, "tree", bodySkipper(src.objectDef));
}

function bodySkipper(def: ObjectDef | undefined): (o: THREE.Object3D) => boolean {
  const withBody = new Set<string>();
  const walk = (list: ObjectDef[] | undefined) => {
    for (const c of list ?? []) {
      if (c.body) withBody.add(c.id);
      walk(c.children);
    }
  };
  walk(def?.children);
  return (o) => withBody.has(o.userData?.a3dId as string);
}

function boxOf(list: THREE.Mesh[], inv: THREE.Matrix4): THREE.Box3 {
  const box = new THREE.Box3();
  const tmp = new THREE.Box3();
  const m = new THREE.Matrix4();
  for (const mesh of list) {
    const inst = mesh as THREE.InstancedMesh;
    if (inst.isInstancedMesh) {
      if (!inst.boundingBox) inst.computeBoundingBox();
      if (inst.boundingBox) tmp.copy(inst.boundingBox);
    } else {
      if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
      tmp.copy(mesh.geometry.boundingBox!);
    }
    if (tmp.isEmpty()) continue;
    box.union(tmp.applyMatrix4(m.multiplyMatrices(inv, mesh.matrixWorld)));
  }
  return box;
}

// Bounding box of the collider meshes in the object frame (scaled).
export function frameBox(object: THREE.Object3D, objectDef?: ObjectDef): THREE.Box3 {
  return boxOf(colliderMeshes({ object, objectDef }), frameOf(object).inv);
}

// `compound` without `shapes`: one box for the object's own geometry plus one
// per nested scene object without a body of its own (decorations merged into
// the collider), each in the body frame.
function autoCompound(object: THREE.Object3D, objectDef: ObjectDef | undefined): { size: THREE.Vector3; center: THREE.Vector3 }[] {
  const { inv } = frameOf(object);
  const parts: THREE.Box3[] = [boxOf(meshes(object), inv)];
  const skip = bodySkipper(objectDef);
  const rootId = object.userData?.a3dId as string | undefined;
  const visit = (o: THREE.Object3D) => {
    for (const c of o.children) {
      if (skip(c)) continue;
      if (isSceneChild(c, rootId)) parts.push(boxOf(meshes(c, "tree", skip), inv));
      else visit(c);
    }
  };
  visit(object);
  return parts.filter((b) => !b.isEmpty()).map((b) => ({ size: b.getSize(new THREE.Vector3()), center: b.getCenter(new THREE.Vector3()) }));
}

// Every triangle of the object in the object frame (scaled), non-indexed.
function triangles(src: ShapeSource, limit: number): Float32Array | null {
  const { inv } = frameOf(src.object);
  const m = new THREE.Matrix4();
  const v = new THREE.Vector3();
  const chunks: Float32Array[] = [];
  let total = 0;
  for (const mesh of colliderMeshes(src)) {
    if ((mesh as THREE.InstancedMesh).isInstancedMesh) continue;
    const g = mesh.geometry;
    const pos = g.getAttribute("position") as THREE.BufferAttribute;
    const index = g.getIndex();
    const n = index ? index.count : pos.count;
    total += n / 3;
    if (total > limit) return null;
    m.multiplyMatrices(inv, mesh.matrixWorld);
    const out = new Float32Array(n * 3);
    for (let k = 0; k < n; k++) {
      v.fromBufferAttribute(pos, index ? index.getX(k) : k).applyMatrix4(m);
      out[k * 3] = v.x;
      out[k * 3 + 1] = v.y;
      out[k * 3 + 2] = v.z;
    }
    chunks.push(out);
  }
  const all = new Float32Array(chunks.reduce((s, c) => s + c.length, 0));
  let o = 0;
  for (const c of chunks) (all.set(c, o), (o += c.length));
  return all;
}

function points(src: ShapeSource, max: number): THREE.Vector3[] {
  const { inv } = frameOf(src.object);
  const m = new THREE.Matrix4();
  const list: THREE.Vector3[] = [];
  const ms = colliderMeshes(src);
  const total = ms.reduce((s, x) => s + x.geometry.getAttribute("position").count, 0);
  const stride = Math.max(1, Math.ceil(total / max));
  for (const mesh of ms) {
    const pos = mesh.geometry.getAttribute("position") as THREE.BufferAttribute;
    m.multiplyMatrices(inv, mesh.matrixWorld);
    for (let k = 0; k < pos.count; k += stride) list.push(new THREE.Vector3().fromBufferAttribute(pos, k).applyMatrix4(m));
  }
  // Keep the extreme points along the axes so subsampling never shrinks the hull much.
  const box = new THREE.Box3();
  for (const mesh of ms) {
    const pos = mesh.geometry.getAttribute("position") as THREE.BufferAttribute;
    m.multiplyMatrices(inv, mesh.matrixWorld);
    const ext: THREE.Vector3[] = [];
    for (let k = 0; k < pos.count; k++) {
      const p = new THREE.Vector3().fromBufferAttribute(pos, k).applyMatrix4(m);
      for (let a = 0; a < 3; a++) {
        if (!ext[a * 2] || p.getComponent(a) < ext[a * 2]!.getComponent(a)) ext[a * 2] = p;
        if (!ext[a * 2 + 1] || p.getComponent(a) > ext[a * 2 + 1]!.getComponent(a)) ext[a * 2 + 1] = p;
      }
    }
    for (const p of ext) if (p) (list.push(p), box.expandByPoint(p));
  }
  return list;
}

export function convexHull(pts: THREE.Vector3[], center: THREE.Vector3): { vertices: V3[]; faces: number[][] } | null {
  if (pts.length < 4) return null;
  let hull: ConvexHull;
  try {
    hull = new ConvexHull().setFromPoints(pts);
  } catch {
    return null;
  }
  const index = new Map<THREE.Vector3, number>();
  const vertices: V3[] = [];
  const faces: number[][] = [];
  for (const face of hull.faces) {
    const loop: number[] = [];
    let e = face.edge;
    do {
      const p = e.head().point;
      let i = index.get(p);
      if (i === undefined) {
        i = vertices.length;
        index.set(p, i);
        vertices.push([p.x - center.x, p.y - center.y, p.z - center.z]);
      }
      loop.push(i);
      e = e.next;
    } while (e !== face.edge);
    if (loop.length >= 3) faces.push(loop);
  }
  return faces.length >= 4 ? { vertices, faces } : null;
}

const quatOf = (rot: V3 | undefined): Q4 | undefined => {
  if (!rot) return undefined;
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(rot[0] * DEG, rot[1] * DEG, rot[2] * DEG));
  return [q.x, q.y, q.z, q.w];
};

function collider(c: ColliderDef, fallback: THREE.Vector3): ShapeDesc {
  const offset = c.offset;
  const quat = quatOf(c.rotation);
  const size = c.size ? new THREE.Vector3(...c.size) : fallback;
  switch (c.shape) {
    case "sphere":
      return { type: "sphere", radius: c.radius ?? Math.max(size.x, size.y, size.z) / 2, offset, quat };
    case "cylinder":
      return { type: "cylinder", radius: c.radius ?? Math.max(size.x, size.z) / 2, height: c.height ?? size.y, offset, quat };
    case "capsule":
      return { type: "capsule", radius: c.radius ?? Math.max(size.x, size.z) / 2, height: c.height ?? size.y, offset, quat };
    default:
      return { type: "box", half: [size.x / 2, size.y / 2, size.z / 2], offset, quat };
  }
}

// Which shape "auto" means for this object.
export function autoShape(src: ShapeSource): NonNullable<BodyDef["shape"]> {
  const od = src.objectDef;
  const solid = src.def.type === "static" || src.def.type === "kinematic";
  if (src.built?.heightAt && solid && typeof src.object.userData.size === "number") return "heightfield";
  if (od?.kind === "mesh") {
    const t = od.geometry?.type;
    if (t === "sphere" || t === "icosahedron" || t === "dodecahedron") return "sphere";
    if (t === "capsule") return "capsule";
    if (t === "cylinder") return od.geometry.radiusTop === undefined || od.geometry.radiusTop === od.geometry.radiusBottom ? "cylinder" : "convex";
    if (t === "box" || t === "roundedBox" || t === "plane") return "box";
    return solid ? "trimesh" : "convex";
  }
  if (od?.kind === "model" || od?.kind === "svg") return solid ? "trimesh" : "convex";
  if (od?.kind === "generator" && solid) return "trimesh";
  return "box";
}

export function buildShapes(src: ShapeSource): ShapeResult {
  const def = src.def;
  const box = frameBox(src.object, src.objectDef);
  const empty = box.isEmpty();
  const size = empty ? new THREE.Vector3(1, 1, 1) : box.getSize(new THREE.Vector3());
  const center = empty ? new THREE.Vector3() : box.getCenter(new THREE.Vector3());
  if (def.size) size.set(def.size[0], def.size[1], def.size[2]);
  const offset = def.offset ? new THREE.Vector3(...def.offset) : center.clone();
  let shape = def.shape ?? "box";
  if (shape === "auto") shape = autoShape(src);
  const boxShape = (): ShapeDesc => ({ type: "box", half: [size.x / 2, size.y / 2, size.z / 2] });
  switch (shape) {
    case "sphere":
      return { shapes: [{ type: "sphere", radius: def.radius ?? Math.max(size.x, size.y, size.z) / 2 }], offset };
    case "cylinder":
      return { shapes: [{ type: "cylinder", radius: def.radius ?? Math.max(size.x, size.z) / 2, height: def.height ?? size.y }], offset };
    case "capsule":
      return { shapes: [{ type: "capsule", radius: def.radius ?? Math.max(size.x, size.z) / 2, height: def.height ?? size.y }], offset };
    case "compound": {
      const origin = def.offset ? new THREE.Vector3(...def.offset) : new THREE.Vector3();
      if (!def.shapes?.length) {
        const parts = autoCompound(src.object, src.objectDef);
        if (parts.length) return { shapes: parts.map((p) => ({ type: "box", half: [p.size.x / 2, p.size.y / 2, p.size.z / 2], offset: [p.center.x - origin.x, p.center.y - origin.y, p.center.z - origin.z] })), offset: origin };
      }
      const shapes = (def.shapes ?? []).map((c) => {
        const s = collider(c, size);
        const o = c.offset ?? [0, 0, 0];
        return { ...s, offset: [o[0] - origin.x, o[1] - origin.y, o[2] - origin.z] as V3 };
      });
      return shapes.length ? { shapes, offset: origin } : { shapes: [boxShape()], offset };
    }
    case "convex": {
      const hull = convexHull(points(src, MAX_HULL_POINTS), offset);
      return hull ? { shapes: [{ type: "convex", ...hull }], offset } : { shapes: [boxShape()], offset, note: "convex hull failed (too few points): using the bounding box" };
    }
    case "heightfield": {
      const hf = heightfield(src);
      if (hf) return hf;
      return trimesh(src, "heightfield needs a terrain generator (heightAt): using the triangles");
    }
    case "trimesh":
      return trimesh(src);
    default:
      return { shapes: [boxShape()], offset };
  }

  function trimesh(s: ShapeSource, note?: string): ShapeResult {
    const tris = triangles(s, MAX_TRIMESH_TRIS);
    if (!tris || tris.length === 0) return { shapes: [boxShape()], offset, note: tris ? "no triangles: using the bounding box" : `more than ${MAX_TRIMESH_TRIS} triangles: using the bounding box (use a simpler collision mesh, "compound" or "box")` };
    for (let k = 0; k < tris.length; k += 3) {
      tris[k]! -= offset.x;
      tris[k + 1]! -= offset.y;
      tris[k + 2]! -= offset.z;
    }
    return { shapes: [{ type: "trimesh", vertices: tris }], offset, note };
  }
}

function heightfield(src: ShapeSource): ShapeResult | null {
  const heightAt = src.built?.heightAt?.bind(src.built);
  const S = src.object.userData.size;
  if (!heightAt || typeof S !== "number" || !(S > 0)) return null;
  const { scale } = frameOf(src.object);
  // Match the terrain's own grid resolution when it can be read.
  let tris = 0;
  for (const m of meshes(src.object)) {
    if (m.userData.materialTarget || m.name === "terrain-ground") {
      const g = m.geometry;
      tris = (g.getIndex()?.count ?? g.getAttribute("position").count) / 3;
      break;
    }
  }
  const res = Math.min(160, Math.max(8, tris ? Math.round(Math.sqrt(tris / 2)) : 64));
  const n = res + 1;
  const es = S / res;
  const data: number[][] = [];
  for (let i = 0; i < n; i++) {
    const col: number[] = [];
    for (let j = 0; j < n; j++) col.push(heightAt(-S / 2 + i * es, S / 2 - j * es) * scale.y);
    data.push(col);
  }
  const sx = scale.x;
  const offset = new THREE.Vector3();
  return {
    shapes: [{ type: "heightfield", data, elementSize: es * sx, offset: [(-S / 2) * sx, 0, (S / 2) * sx], quat: [-Math.SQRT1_2, 0, 0, Math.SQRT1_2] }],
    offset,
  };
}

// World pose of the body for an object (collider centre + world rotation).
export function bodyPose(object: THREE.Object3D, offset: THREE.Vector3): { position: V3; quaternion: Q4 } {
  object.updateWorldMatrix(true, false);
  const p = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3();
  object.matrixWorld.decompose(p, q, s);
  p.add(offset.clone().applyQuaternion(q));
  return { position: [p.x, p.y, p.z], quaternion: [q.x, q.y, q.z, q.w] };
}

export function bodyInit(id: string, src: ShapeSource): { init: BodyInit; offset: THREE.Vector3; note?: string } {
  const { shapes, offset, note } = buildShapes(src);
  const pose = bodyPose(src.object, offset);
  const d = src.def;
  const av = d.angularVelocity;
  return {
    init: {
      id,
      type: d.type,
      shapes,
      position: pose.position,
      quaternion: pose.quaternion,
      velocity: d.velocity,
      angularVelocity: av ? [av[0] * DEG, av[1] * DEG, av[2] * DEG] : undefined,
      mass: d.mass,
      friction: d.friction,
      restitution: d.restitution,
      material: d.material,
      linearDamping: d.linearDamping,
      angularDamping: d.angularDamping,
      gravityScale: d.gravityScale,
      fixedRotation: d.fixedRotation,
      character: d.character,
      sleep: d.sleep,
      ccd: d.ccd,
      layer: d.layer,
      collidesWith: d.collidesWith,
    },
    offset,
    note,
  };
}
