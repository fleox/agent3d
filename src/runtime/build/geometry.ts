// Catalog geometries (CATALOG.geometries) → THREE.BufferGeometry.
// Parameter defaults come from the catalog itself so docs and runtime agree.

import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { GEOMETRIES } from "../../core/catalog";
import type { GeometryDef } from "../../core/types";
import { DEG, bool, num, withDefaults } from "../util";

type Params = Record<string, unknown>;
export type GeometryImpl = (p: Params) => THREE.BufferGeometry;

function pts2(v: unknown): THREE.Vector2[] {
  if (!Array.isArray(v)) return [];
  return v.filter((p) => Array.isArray(p) && p.length >= 2).map((p) => new THREE.Vector2(Number(p[0]), Number(p[1])));
}

function pts3(v: unknown): THREE.Vector3[] {
  if (!Array.isArray(v)) return [];
  return v.filter((p) => Array.isArray(p) && p.length >= 3).map((p) => new THREE.Vector3(Number(p[0]), Number(p[1]), Number(p[2])));
}

const seg = (p: Params, k = "segments", d = 32) => Math.max(3, Math.round(num(p[k], d)));

export const GEOMETRY_IMPLS: Record<string, GeometryImpl> = {
  box: (p) => new THREE.BoxGeometry(num(p.width, 1), num(p.height, 1), num(p.depth, 1)),
  roundedBox: (p) => {
    const w = num(p.width, 1), h = num(p.height, 1), d = num(p.depth, 1);
    const r = Math.min(num(p.radius, 0.1), Math.min(w, h, d) / 2 - 1e-4);
    return new RoundedBoxGeometry(w, h, d, Math.max(1, Math.round(num(p.segments, 4))), Math.max(0, r));
  },
  sphere: (p) => new THREE.SphereGeometry(num(p.radius, 0.5), seg(p), Math.max(2, Math.round(num(p.heightSegments, 24)))),
  cylinder: (p) => new THREE.CylinderGeometry(num(p.radiusTop, 0.5), num(p.radiusBottom, 0.5), num(p.height, 1), seg(p), 1, bool(p.openEnded, false)),
  cone: (p) => new THREE.ConeGeometry(num(p.radius, 0.5), num(p.height, 1), seg(p)),
  capsule: (p) => {
    const s = Math.max(2, Math.round(num(p.segments, 16)));
    return new THREE.CapsuleGeometry(num(p.radius, 0.3), num(p.length, 0.6), Math.max(2, Math.round(s / 2)), s * 2);
  },
  torus: (p) => new THREE.TorusGeometry(num(p.radius, 0.5), num(p.tube, 0.15), Math.max(2, Math.round(num(p.radialSegments, 24))), Math.max(3, Math.round(num(p.tubularSegments, 64))), num(p.arc, 360) * DEG),
  torusKnot: (p) => new THREE.TorusKnotGeometry(num(p.radius, 0.5), num(p.tube, 0.15), Math.round(num(p.tubularSegments, 128)), Math.round(num(p.radialSegments, 16)), Math.round(num(p.p, 2)), Math.round(num(p.q, 3))),
  plane: (p) => new THREE.PlaneGeometry(num(p.width, 1), num(p.height, 1), Math.max(1, Math.round(num(p.widthSegments, 1))), Math.max(1, Math.round(num(p.heightSegments, 1)))),
  circle: (p) => new THREE.CircleGeometry(num(p.radius, 0.5), seg(p)),
  ring: (p) => new THREE.RingGeometry(num(p.innerRadius, 0.3), num(p.outerRadius, 0.5), seg(p)),
  icosahedron: (p) => new THREE.IcosahedronGeometry(num(p.radius, 0.5), Math.round(num(p.detail, 0))),
  dodecahedron: (p) => new THREE.DodecahedronGeometry(num(p.radius, 0.5), Math.round(num(p.detail, 0))),
  octahedron: (p) => new THREE.OctahedronGeometry(num(p.radius, 0.5), Math.round(num(p.detail, 0))),
  tetrahedron: (p) => new THREE.TetrahedronGeometry(num(p.radius, 0.5), Math.round(num(p.detail, 0))),
  lathe: (p) => {
    let points = pts2(p.points);
    if (points.length < 2) points = [new THREE.Vector2(0.5, -0.5), new THREE.Vector2(0.5, 0.5)];
    return new THREE.LatheGeometry(points, seg(p));
  },
  extrude: (p) => {
    let points = pts2(p.shape);
    if (points.length < 3) points = [new THREE.Vector2(-0.5, -0.5), new THREE.Vector2(0.5, -0.5), new THREE.Vector2(0, 0.5)];
    const shape = new THREE.Shape(points);
    const depth = num(p.depth, 0.2);
    const bevel = num(p.bevel, 0.02);
    const g = new THREE.ExtrudeGeometry(shape, {
      depth,
      bevelEnabled: bevel > 0,
      bevelSize: bevel,
      bevelThickness: bevel,
      bevelSegments: 3,
      curveSegments: 12,
    });
    g.translate(0, 0, -depth / 2);
    return g;
  },
  tube: (p) => {
    let points = pts3(p.points);
    if (points.length < 2) points = [new THREE.Vector3(-1, 0, 0), new THREE.Vector3(1, 0, 0)];
    const curve = new THREE.CatmullRomCurve3(points, bool(p.closed, false), "catmullrom", 0.5);
    return new THREE.TubeGeometry(curve, Math.max(2, Math.round(num(p.tubularSegments, 64))), num(p.radius, 0.05), Math.max(3, Math.round(num(p.radialSegments, 8))), bool(p.closed, false));
  },
};

export function buildGeometry(def: GeometryDef): THREE.BufferGeometry {
  const impl = GEOMETRY_IMPLS[def.type] ?? GEOMETRY_IMPLS.box;
  const entry = GEOMETRIES.find((g) => g.id === def.type);
  const g = impl(withDefaults(entry, def as Params));
  g.computeBoundingBox();
  g.computeBoundingSphere();
  return g;
}
