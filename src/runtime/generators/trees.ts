// Scattered stylised low-poly trees: pine, round, palm, birch, dead, mixed.
// Every tree is stamped into ONE merged, vertex-coloured, flat-shaded mesh
// (one draw call) with a per-vertex wind attribute animated in the vertex shader.

import * as THREE from "three";
import type { GeneratorImpl, Rng } from "../registry";
import { generatorParams } from "./params";
import { MeshBuilder, built, findGround, jitter, scatterPoint, shade, vertexColorMaterial } from "./geom";
import { addWind } from "./wind";

export type TreeStyle = "pine" | "round" | "palm" | "birch" | "dead";
type Role = "trunk" | "leaf" | "leafDark" | "bark" | "accent";
interface Part {
  geo: THREE.BufferGeometry;
  role: Role;
}
interface Variant {
  parts: Part[];
  height: number;
}

const UP = new THREE.Vector3(0, 1, 0);

// Cylinder between two points.
function limb(a: THREE.Vector3, b: THREE.Vector3, r0: number, r1: number, sides = 5): THREE.BufferGeometry {
  const dir = b.clone().sub(a);
  const len = dir.length();
  const g = new THREE.CylinderGeometry(r1, r0, len, sides, 1, false);
  g.translate(0, len / 2, 0);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(UP, dir.normalize()));
  g.translate(a.x, a.y, a.z);
  return g;
}

function blob(r: number, x: number, y: number, z: number, rng: Rng, sy = 1, detail = 1): THREE.BufferGeometry {
  const g = new THREE.IcosahedronGeometry(r, detail);
  jitter(g, r * 0.28, rng.next);
  g.scale(1, sy, 1);
  g.translate(x, y, z);
  return g;
}

function pine(rng: Rng): Variant {
  const parts: Part[] = [];
  const th = rng.range(0.5, 0.75);
  parts.push({ geo: limb(new THREE.Vector3(0, -0.1, 0), new THREE.Vector3(0, th + 0.3, 0), 0.16, 0.1, 6), role: "trunk" });
  const layers = rng.int(3, 4);
  let y = th;
  let r = rng.range(0.95, 1.15);
  for (let k = 0; k < layers; k++) {
    const h = r * 1.25;
    const g = new THREE.ConeGeometry(r, h, 7, 1);
    jitter(g, 0.08, rng.next);
    g.rotateY(rng.next() * Math.PI);
    g.translate(0, y + h / 2, 0);
    parts.push({ geo: g, role: k % 2 === 0 ? "leafDark" : "leaf" });
    y += h * 0.5;
    r *= 0.74;
  }
  return { parts, height: y + r * 1.25 * 0.5 };
}

function round(rng: Rng): Variant {
  const parts: Part[] = [];
  const th = rng.range(0.9, 1.2);
  const lean = new THREE.Vector3(rng.range(-0.1, 0.1), th, rng.range(-0.1, 0.1));
  parts.push({ geo: limb(new THREE.Vector3(0, -0.1, 0), lean, 0.15, 0.09, 6), role: "trunk" });
  const R = rng.range(0.85, 1.05);
  parts.push({ geo: blob(R, lean.x, th + R * 0.6, lean.z, rng, 0.92), role: "leaf" });
  const n = rng.int(1, 3);
  for (let k = 0; k < n; k++) {
    const a = rng.next() * Math.PI * 2;
    const rr = R * rng.range(0.45, 0.65);
    parts.push({ geo: blob(rr, lean.x + Math.cos(a) * R * 0.7, th + R * rng.range(0.2, 0.9), lean.z + Math.sin(a) * R * 0.7, rng, 0.9), role: k % 2 ? "leaf" : "leafDark" });
  }
  return { parts, height: th + R * 1.6 };
}

function birch(rng: Rng): Variant {
  const parts: Part[] = [];
  const th = rng.range(1.6, 2.1);
  // Trunk in short stacked segments so bark stripes can alternate.
  const seg = 6;
  for (let k = 0; k < seg; k++) {
    const a = new THREE.Vector3(Math.sin(k * 0.9) * 0.03, (th / seg) * k - 0.05, 0);
    const b = new THREE.Vector3(Math.sin((k + 1) * 0.9) * 0.03, (th / seg) * (k + 1), 0);
    parts.push({ geo: limb(a, b, 0.11 - k * 0.008, 0.11 - (k + 1) * 0.008, 6), role: rng.next() < 0.35 ? "accent" : "bark" });
  }
  const n = rng.int(3, 4);
  for (let k = 0; k < n; k++) {
    const r = rng.range(0.42, 0.6);
    const a = (k / n) * Math.PI * 2 + rng.next();
    const y = th * rng.range(0.75, 1.05) + k * 0.12;
    parts.push({ geo: blob(r, Math.cos(a) * 0.3, y, Math.sin(a) * 0.3, rng, 1.35), role: k % 2 ? "leaf" : "leafDark" });
  }
  return { parts, height: th + 1 };
}

function palm(rng: Rng): Variant {
  const parts: Part[] = [];
  const segs = 7;
  const bend = rng.range(0.25, 0.6);
  const H = rng.range(2.4, 3.0);
  const pts: THREE.Vector3[] = [];
  for (let k = 0; k <= segs; k++) {
    const t = k / segs;
    pts.push(new THREE.Vector3(bend * t * t, H * t - 0.05, 0));
  }
  for (let k = 0; k < segs; k++) parts.push({ geo: limb(pts[k]!, pts[k + 1]!, 0.15 - k * 0.012, 0.15 - (k + 1) * 0.012 + 0.012, 6), role: k % 2 ? "trunk" : "bark" });
  const top = pts[segs]!;
  const fronds = rng.int(6, 8);
  for (let f = 0; f < fronds; f++) {
    const a = (f / fronds) * Math.PI * 2 + rng.range(-0.2, 0.2);
    const len = rng.range(1.2, 1.6);
    const droop = rng.range(0.5, 0.9);
    const w = 0.28;
    const steps = 4;
    const pos: number[] = [];
    const dir = new THREE.Vector3(Math.cos(a), 0, Math.sin(a));
    const side = new THREE.Vector3(-dir.z, 0, dir.x);
    const ptAt = (s: number, off: number): THREE.Vector3 => {
      const along = s * len;
      const y = Math.sin(s * Math.PI * 0.6) * 0.35 - droop * s * s;
      const ww = w * Math.sin(Math.min(1, s * 1.2) * Math.PI) * off;
      return top.clone().addScaledVector(dir, along).addScaledVector(side, ww).add(new THREE.Vector3(0, y - Math.abs(ww) * 0.35, 0));
    };
    for (let k = 0; k < steps; k++) {
      const s0 = k / steps, s1 = (k + 1) / steps;
      const c0 = ptAt(s0, 0), c1 = ptAt(s1, 0), l0 = ptAt(s0, 1), l1 = ptAt(s1, 1), r0 = ptAt(s0, -1), r1 = ptAt(s1, -1);
      // two faces each side (double sided by stacking both windings)
      for (const [p, q, r] of [[c0, l0, l1], [c0, l1, c1], [c0, r1, r0], [c0, c1, r1]] as const) pos.push(p.x, p.y, p.z, q.x, q.y, q.z, r.x, r.y, r.z, p.x, p.y, p.z, r.x, r.y, r.z, q.x, q.y, q.z);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    parts.push({ geo: g, role: f % 2 ? "leaf" : "leafDark" });
  }
  for (let k = 0; k < 3; k++) {
    const a = (k / 3) * Math.PI * 2;
    parts.push({ geo: blob(0.11, top.x + Math.cos(a) * 0.12, top.y - 0.1, top.z + Math.sin(a) * 0.12, rng, 1, 0), role: "accent" });
  }
  return { parts, height: H + 0.4 };
}

function dead(rng: Rng): Variant {
  const parts: Part[] = [];
  const branch = (a: THREE.Vector3, dir: THREE.Vector3, len: number, r: number, depth: number): void => {
    const b = a.clone().addScaledVector(dir, len);
    parts.push({ geo: limb(a, b, r, r * 0.65, depth > 1 ? 5 : 4), role: "trunk" });
    if (depth <= 0) return;
    const kids = depth > 1 ? 2 : rng.int(1, 2);
    for (let k = 0; k < kids; k++) {
      const nd = dir
        .clone()
        .add(new THREE.Vector3(rng.range(-0.9, 0.9), rng.range(0.1, 0.5), rng.range(-0.9, 0.9)))
        .normalize();
      branch(b, nd, len * rng.range(0.55, 0.75), r * 0.62, depth - 1);
    }
  };
  branch(new THREE.Vector3(0, -0.1, 0), new THREE.Vector3(rng.range(-0.1, 0.1), 1, 0).normalize(), rng.range(1.1, 1.5), 0.15, 3);
  return { parts, height: 2.6 };
}

const BUILDERS: Record<TreeStyle, (rng: Rng) => Variant> = { pine, round, palm, birch, dead };

export const trees: GeneratorImpl = (raw, ctx) => {
  const p = generatorParams("trees", raw, ctx);
  const count = p.int("count");
  const area = p.vec3("area");
  const style = p.str<TreeStyle | "mixed">("style");
  const minS = p.num("minScale");
  const maxS = Math.max(minS, p.num("maxScale"));
  const leaves = p.colors("leafColors");
  const trunk = p.color("trunkColor");
  const rng = ctx.rng;
  const ground = p.bool("onTerrain") ? findGround(ctx) : null;

  // A few variants per style, stamped many times.
  const styles: TreeStyle[] = style === "mixed" ? ["pine", "round", "pine", "round", "birch"] : [style];
  const variants = new Map<TreeStyle, Variant[]>();
  for (const s of new Set(styles)) variants.set(s, Array.from({ length: 4 }, () => BUILDERS[s](rng)));

  const bark = new THREE.Color("#f1ede4");
  const barkDark = new THREE.Color("#3a3532");
  const coconut = new THREE.Color("#7a4e2d");
  const b = new MeshBuilder();
  b.useWind = p.bool("sway");
  const m = new THREE.Matrix4();
  for (let k = 0; k < count; k++) {
    const s = styles[k % styles.length]!;
    const variant = rng.pick(variants.get(s)!);
    const pos = scatterPoint(rng, area, ground);
    const scale = rng.range(minS, maxS);
    m.compose(new THREE.Vector3(pos.x, ground ? pos.y : 0, pos.z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, rng.next() * Math.PI * 2, 0)), new THREE.Vector3(scale, scale * rng.range(0.9, 1.1), scale));
    const leaf = rng.pick(leaves);
    const leafDark = leaf.clone().multiplyScalar(0.82);
    const leafBirch = leaf.clone().lerp(new THREE.Color("#d4e157"), 0.35);
    const trunkC = s === "dead" ? trunk.clone().lerp(new THREE.Color("#8a8580"), 0.4) : trunk;
    const phase = rng.next() * 100;
    const baseY = ground ? pos.y : 0;
    const h = variant.height * scale;
    b.windFn = (_x, y) => {
      const k2 = Math.max(0, (y - baseY) / h);
      return [phase, k2 * k2 * 0.12 * scale];
    };
    for (const part of variant.parts) {
      const base =
        part.role === "trunk" ? trunkC
        : part.role === "bark" ? (s === "palm" ? trunk.clone().multiplyScalar(1.25) : bark)
        : part.role === "accent" ? (s === "palm" ? coconut : barkDark)
        : s === "birch" ? (part.role === "leaf" ? leafBirch : leafBirch.clone().multiplyScalar(0.85))
        : part.role === "leaf" ? leaf
        : leafDark;
      const isLeaf = part.role === "leaf" || part.role === "leafDark";
      b.add(part.geo, m, isLeaf ? (_x, cy, _z, f) => shade(base, 0.9 + ((f * 7919 + k * 31) % 17) / 17 * 0.2 + cy * 0.02) : base);
    }
  }
  for (const vs of variants.values()) for (const v of vs) for (const part of v.parts) part.geo.dispose();

  const material = vertexColorMaterial({ flat: true, roughness: 0.85 });
  const wind = b.useWind ? addWind(material, { mode: "attribute", strength: 1 }) : null;
  const mesh = new THREE.Mesh(b.build(), material);
  mesh.name = "trees";
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  const group = new THREE.Group();
  group.name = "trees";
  group.add(mesh);
  return built(group, {
    update: wind
      ? (t) => {
          wind.uniforms.uTime.value = t;
        }
      : undefined,
  });
};
