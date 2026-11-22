// Extrusion helpers shared by 3D text and SVG logos.

import * as THREE from "three";

export type GeometryUtils = typeof import("three/addons/utils/BufferGeometryUtils.js");

// Adaptive sampling: each curve gets points by its length (tolerance `tol`),
// between `min` and `max` points, so long curves stay smooth and the many tiny
// curves of TrueType outlines stay cheap; straight lines keep their 2 points.
export function samplePath(path: THREE.Path, tol: number, min = 4, max = 256): THREE.Vector2[] {
  const out: THREE.Vector2[] = [];
  for (const c of path.curves) {
    const isLine = (c as THREE.LineCurve).isLineCurve;
    const n = isLine ? 1 : Math.max(min, Math.min(max, Math.ceil(c.getLength() / tol)));
    const pts = c.getPoints(n) as THREE.Vector2[];
    for (const p of pts) if (!out.length || !out[out.length - 1].equals(p)) out.push(p);
  }
  if ((path as THREE.Path & { autoClose?: boolean }).autoClose && out.length > 1 && !out[0].equals(out[out.length - 1])) out.push(out[0].clone());
  return out;
}

// A shape with every curve pre-sampled (holes too): ExtrudeGeometry / ShapeGeometry then only see straight edges.
export function sampleShape(shape: THREE.Shape, tol: number, min = 4, max = 256): THREE.Shape {
  const closed = (pts: THREE.Vector2[]) => {
    if (pts.length > 2 && pts[0].equals(pts[pts.length - 1])) pts.pop();
    return pts;
  };
  const s = new THREE.Shape(closed(samplePath(shape, tol, min, max)));
  s.holes = shape.holes.map((h) => new THREE.Path(closed(samplePath(h, tol, min, max))));
  return s;
}

// Smooth normals within `angle` (bevels, curved walls), but keep the front /
// back caps perfectly flat: averaging the cap rim with the first bevel step
// would tilt the normals of the long cap triangles (visible diagonal shading).
export function smoothNormals(g: THREE.BufferGeometry, angle: number, utils: GeometryUtils): THREE.BufferGeometry {
  const out = utils.toCreasedNormals(g, angle);
  if (out !== g) g.dispose();
  const pos = out.getAttribute("position");
  const nor = out.getAttribute("normal");
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  for (let i = 0; i + 2 < pos.count; i += 3) {
    a.fromBufferAttribute(pos, i);
    b.fromBufferAttribute(pos, i + 1).sub(a);
    c.fromBufferAttribute(pos, i + 2).sub(a);
    const n = b.cross(c);
    const len = n.length();
    if (len < 1e-12) continue;
    const nz = n.z / len;
    if (Math.abs(nz) > 0.9999) for (let k = 0; k < 3; k++) nor.setXYZ(i + k, 0, 0, Math.sign(nz));
  }
  nor.needsUpdate = true;
  return out;
}

// Extrudes a flat triangle soup lying in the XY plane (e.g. SVGLoader.pointsToStroke
// output) into a solid from z = 0 to z = depth: front + back caps and walls along
// the boundary edges (edges used by one triangle). Overlapping triangles (round
// joins) only add hidden inner walls. Non-indexed, with flat normals and planar UVs.
export function extrudeTriangles(flat: THREE.BufferGeometry, depth: number): THREE.BufferGeometry {
  const src = flat.index ? flat.toNonIndexed() : flat;
  const p = src.getAttribute("position");
  const n = p.count - (p.count % 3);
  // Quantised vertex keys (relative to the soup's size) to find shared edges.
  src.computeBoundingBox();
  const bb = src.boundingBox!;
  const eps = Math.max(bb.max.x - bb.min.x, bb.max.y - bb.min.y, 1e-9) * 1e-6;
  const ids = new Map<string, number>();
  const pts: [number, number][] = [];
  const vid = (i: number) => {
    const x = p.getX(i), y = p.getY(i);
    const key = `${Math.round(x / eps)},${Math.round(y / eps)}`;
    let id = ids.get(key);
    if (id === undefined) {
      id = pts.length;
      ids.set(key, id);
      pts.push([x, y]);
    }
    return id;
  };
  const tris: [number, number, number][] = [];
  for (let i = 0; i < n; i += 3) {
    let a = vid(i), b = vid(i + 1), c = vid(i + 2);
    if (a === b || b === c || a === c) continue;
    const area = (pts[b][0] - pts[a][0]) * (pts[c][1] - pts[a][1]) - (pts[c][0] - pts[a][0]) * (pts[b][1] - pts[a][1]);
    if (Math.abs(area) < eps * eps) continue;
    if (area < 0) [b, c] = [c, b];
    tris.push([a, b, c]);
  }
  const edges = new Map<string, { a: number; b: number; count: number }>();
  for (const [a, b, c] of tris) {
    for (const [u, v] of [[a, b], [b, c], [c, a]]) {
      const key = u < v ? `${u}_${v}` : `${v}_${u}`;
      const e = edges.get(key);
      if (e) e.count++;
      else edges.set(key, { a: u, b: v, count: 1 });
    }
  }
  const pos: number[] = [], nor: number[] = [], uv: number[] = [];
  const w = Math.max(bb.max.x - bb.min.x, 1e-9), h = Math.max(bb.max.y - bb.min.y, 1e-9);
  const push = (x: number, y: number, z: number, nx: number, ny: number, nz: number, u?: number, v?: number) => {
    pos.push(x, y, z);
    nor.push(nx, ny, nz);
    uv.push(u ?? (x - bb.min.x) / w, v ?? (y - bb.min.y) / h);
  };
  for (const [a, b, c] of tris) {
    // front (CCW seen from +z) and back (reversed)
    for (const k of [a, b, c]) push(pts[k][0], pts[k][1], depth, 0, 0, 1);
    for (const k of [a, c, b]) push(pts[k][0], pts[k][1], 0, 0, 0, -1);
  }
  if (depth > 0) {
    for (const e of edges.values()) {
      if (e.count !== 1) continue;
      const [ax, ay] = pts[e.a], [bx, by] = pts[e.b];
      const dx = bx - ax, dy = by - ay;
      const len = Math.hypot(dx, dy);
      if (len < eps) continue;
      const nx = dy / len, ny = -dx / len;
      push(ax, ay, 0, nx, ny, 0, 0, 0);
      push(bx, by, 0, nx, ny, 0, 1, 0);
      push(bx, by, depth, nx, ny, 0, 1, 1);
      push(ax, ay, 0, nx, ny, 0, 0, 0);
      push(bx, by, depth, nx, ny, 0, 1, 1);
      push(ax, ay, depth, nx, ny, 0, 0, 1);
    }
  }
  if (src !== flat) src.dispose();
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  return g;
}
