// Geometry helpers shared by the generators: a flat-shaded mesh builder with
// vertex colours (one draw call for a whole forest / city), primitive
// stamping, wind attribute, sibling-terrain lookup.

import * as THREE from "three";
import type { BuildContext, BuiltObject } from "../registry";

export type V3 = [number, number, number];

// Accumulates non-indexed triangles (flat low-poly shading after
// computeVertexNormals) with per-vertex colour, optional uv and wind data.
export class MeshBuilder {
  readonly pos: number[] = [];
  readonly col: number[] = [];
  readonly uv: number[] = [];
  readonly wind: number[] = [];
  useUv = false;
  useWind = false;
  // Current wind values stamped on every vertex: (phase, weight) or a function of the local vertex.
  windFn: ((x: number, y: number, z: number) => [number, number]) | null = null;

  private pushVertex(x: number, y: number, z: number, c: THREE.Color, u = 0, v = 0): void {
    this.pos.push(x, y, z);
    this.col.push(c.r, c.g, c.b);
    if (this.useUv) this.uv.push(u, v);
    if (this.useWind) {
      const w = this.windFn ? this.windFn(x, y, z) : [0, 0];
      this.wind.push(w[0], w[1]);
    }
  }

  tri(a: V3, b: V3, c: V3, color: THREE.Color, uvs?: [number, number, number, number, number, number]): void {
    this.pushVertex(a[0], a[1], a[2], color, uvs?.[0], uvs?.[1]);
    this.pushVertex(b[0], b[1], b[2], color, uvs?.[2], uvs?.[3]);
    this.pushVertex(c[0], c[1], c[2], color, uvs?.[4], uvs?.[5]);
  }

  // Counter-clockwise quad a-b-c-d (seen from the front).
  quad(a: V3, b: V3, c: V3, d: V3, color: THREE.Color, uvs?: [number, number, number, number, number, number, number, number]): void {
    this.tri(a, b, c, color, uvs ? [uvs[0], uvs[1], uvs[2], uvs[3], uvs[4], uvs[5]] : undefined);
    this.tri(a, c, d, color, uvs ? [uvs[0], uvs[1], uvs[4], uvs[5], uvs[6], uvs[7]] : undefined);
  }

  // Axis-aligned box from min to max. `faceUv(face, w, h)` optionally returns per-face uv scale.
  box(min: V3, max: V3, side: THREE.Color, top: THREE.Color = side, opts: { bottom?: boolean; uv?: (face: "x" | "z" | "y", w: number, h: number) => [number, number, number, number] } = {}): void {
    const [x0, y0, z0] = min;
    const [x1, y1, z1] = max;
    const uvq = (face: "x" | "z" | "y", w: number, h: number): [number, number, number, number, number, number, number, number] | undefined => {
      if (!opts.uv) return undefined;
      const [u0, v0, u1, v1] = opts.uv(face, w, h);
      return [u0, v0, u1, v0, u1, v1, u0, v1];
    };
    const w = x1 - x0, h = y1 - y0, d = z1 - z0;
    this.quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], side, uvq("z", w, h)); // +z
    this.quad([x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], side, uvq("z", w, h)); // -z
    this.quad([x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], side, uvq("x", d, h)); // +x
    this.quad([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], side, uvq("x", d, h)); // -x
    this.quad([x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0], top, uvq("y", w, d)); // top
    if (opts.bottom) this.quad([x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], side, uvq("y", w, d));
  }

  // Stamps a three.js geometry (indexed or not) transformed by `matrix`, coloured by
  // `color` (constant or per-face function of the face centroid in local geometry space).
  add(geometry: THREE.BufferGeometry, matrix: THREE.Matrix4, color: THREE.Color | ((cx: number, cy: number, cz: number, face: number) => THREE.Color)): void {
    const g = geometry.index ? geometry.toNonIndexed() : geometry;
    const p = g.getAttribute("position") as THREE.BufferAttribute;
    const v = new THREE.Vector3();
    const tmp: V3[] = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
    const local: V3[] = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
    for (let f = 0; f < p.count / 3; f++) {
      for (let k = 0; k < 3; k++) {
        v.fromBufferAttribute(p, f * 3 + k);
        local[k] = [v.x, v.y, v.z];
        v.applyMatrix4(matrix);
        tmp[k] = [v.x, v.y, v.z];
      }
      const c = typeof color === "function" ? color((local[0]![0] + local[1]![0] + local[2]![0]) / 3, (local[0]![1] + local[1]![1] + local[2]![1]) / 3, (local[0]![2] + local[1]![2] + local[2]![2]) / 3, f) : color;
      this.tri(tmp[0]!, tmp[1]!, tmp[2]!, c);
    }
    if (g !== geometry) g.dispose();
  }

  get triangles(): number {
    return this.pos.length / 9;
  }

  build(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute("color", new THREE.Float32BufferAttribute(this.col, 3));
    if (this.useUv) g.setAttribute("uv", new THREE.Float32BufferAttribute(this.uv, 2));
    if (this.useWind) g.setAttribute("aWind", new THREE.Float32BufferAttribute(this.wind, 2));
    g.computeVertexNormals();
    g.computeBoundingBox();
    g.computeBoundingSphere();
    return g;
  }
}

// Low-poly "jitter": moves each vertex of a geometry by a deterministic noise so
// primitives look hand-carved. Welds first so faces stay connected.
export function jitter(geometry: THREE.BufferGeometry, amount: number, rnd: () => number): THREE.BufferGeometry {
  const p = geometry.getAttribute("position") as THREE.BufferAttribute;
  const seen = new Map<string, [number, number, number]>();
  for (let i = 0; i < p.count; i++) {
    const key = `${p.getX(i).toFixed(4)},${p.getY(i).toFixed(4)},${p.getZ(i).toFixed(4)}`;
    let o = seen.get(key);
    if (!o) {
      o = [(rnd() - 0.5) * amount, (rnd() - 0.5) * amount, (rnd() - 0.5) * amount];
      seen.set(key, o);
    }
    p.setXYZ(i, p.getX(i) + o[0], p.getY(i) + o[1], p.getZ(i) + o[2]);
  }
  p.needsUpdate = true;
  return geometry;
}

export const mat4 = (x: number, y: number, z: number, sx = 1, sy = sx, sz = sx, rx = 0, ry = 0, rz = 0): THREE.Matrix4 =>
  new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), new THREE.Vector3(sx, sy, sz));

export const shade = (c: THREE.Color, f: number): THREE.Color => c.clone().multiplyScalar(f);

export const lerpColor = (a: THREE.Color, b: THREE.Color, t: number): THREE.Color => a.clone().lerp(b, Math.min(1, Math.max(0, t)));

// Samples a colour ramp (array of colours evenly spaced) at t in [0, 1].
export function ramp(colors: THREE.Color[], t: number, out = new THREE.Color()): THREE.Color {
  if (colors.length === 1) return out.copy(colors[0]!);
  const x = Math.min(1, Math.max(0, t)) * (colors.length - 1);
  const i = Math.min(colors.length - 2, Math.floor(x));
  return out.copy(colors[i]!).lerp(colors[i + 1]!, x - i);
}

export const smoothstep = (a: number, b: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

// The first sibling exposing heightAt (a terrain), with a world→local helper.
export interface Ground {
  height(x: number, z: number): number;
  water: number | null;
  // Lowest snow height (scatter-local y): trees / rocks / flowers stay below it.
  snow?: number | null;
}

export function findGround(ctx: BuildContext): Ground | null {
  const all = [...ctx.siblings.values()].filter((s) => s.heightAt && s.object.userData.surface !== "water");
  all.sort((a, b) => (b.object.userData.surface === "terrain" ? 1 : 0) - (a.object.userData.surface === "terrain" ? 1 : 0));
  for (const s of all) {
    if (!s.heightAt) continue;
    // Scatter points are local to the scatterer (placed at ctx.placement in the
    // same parent as the terrain): local → parent → terrain-local and back.
    // (Before, the terrain offset was applied as if both sat at the origin, so
    // two objects at the same `position` buried / floated their trees.)
    const o = s.object.position;
    const sc = s.object.scale;
    const pp = ctx.placement?.position ?? [0, 0, 0];
    const ps = ctx.placement?.scale ?? [1, 1, 1];
    const fn = s.heightAt.bind(s);
    const toLocalY = (yParent: number) => (yParent - pp[1]) / (ps[1] || 1);
    const water = typeof s.object.userData.waterLevel === "number" ? toLocalY((s.object.userData.waterLevel as number) * sc.y + o.y) : null;
    const snow = typeof s.object.userData.snowLevel === "number" ? toLocalY((s.object.userData.snowLevel as number) * sc.y + o.y) : null;
    return {
      snow,
      height: (x, z) => {
        const px = pp[0] + x * ps[0], pz = pp[2] + z * ps[2];
        return toLocalY(fn((px - o.x) / (sc.x || 1), (pz - o.z) / (sc.z || 1)) * sc.y + o.y);
      },
      water,
    };
  }
  return null;
}

// Rejection-samples a scatter position inside the area, avoiding water (and
// snow unless avoidSnow is false). When every attempt fails, the lowest dry
// candidate wins (a tree at the treeline rather than on the summit).
export function scatterPoint(rng: BuildContext["rng"], area: V3, ground: Ground | null, margin = 0.15, avoidSnow = true): { x: number; y: number; z: number } {
  let best: { x: number; y: number; z: number } | null = null;
  let first = { x: 0, y: 0, z: 0 };
  for (let attempt = 0; attempt < 12; attempt++) {
    const x = (rng.next() - 0.5) * area[0];
    const z = (rng.next() - 0.5) * area[2];
    const y = ground ? ground.height(x, z) : (rng.next() - 0.5) * area[1];
    if (attempt === 0) first = { x, y, z };
    if (!ground) return { x, y, z };
    const dry = ground.water === null || y > ground.water + margin;
    const snowFree = !avoidSnow || ground.snow === null || ground.snow === undefined || y < ground.snow;
    if (dry && snowFree) return { x, y, z };
    if (dry && (!best || y < best.y)) best = { x, y, z };
  }
  return best ?? first;
}

export function vertexColorMaterial(opts: { flat?: boolean; roughness?: number; metalness?: number; side?: THREE.Side } = {}): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: opts.flat ?? true, roughness: opts.roughness ?? 0.9, metalness: opts.metalness ?? 0, side: opts.side ?? THREE.FrontSide });
}

export function disposeObject(root: THREE.Object3D): void {
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.geometry) m.geometry.dispose();
    const mats = m.material ? (Array.isArray(m.material) ? m.material : [m.material]) : [];
    for (const mat of mats) {
      for (const v of Object.values(mat)) if (v instanceof THREE.Texture) v.dispose();
      mat.dispose();
    }
  });
}

export function built(object: THREE.Object3D, extra: Omit<BuiltObject, "object"> = {}): BuiltObject {
  return { object, dispose: () => disposeObject(object), ...extra };
}
