#!/usr/bin/env node
// Generates the Agent3D bakery models of the built-in library (CC0, own work):
//
//   library/models/food/croissant.glb  baguette.glb  bread-loaf.glb  donut.glb
//   library/models/food/cupcake.glb    cookie.glb    pain-au-chocolat.glb
//
//   node scripts/make-bakery-models.mjs            write the GLBs
//   node scripts/make-bakery-models.mjs --check    verify the files on disk match (no write)
//
// Stylised low-poly food in the spirit of the Kenney / KayKit models: procedural three.js
// geometry, one simple PBR material per surface ("crust", "icing", "chocolate"…, metalness 0)
// with COLOR_0 vertex colours for the golden-brown variation, exported with GLTFExporter.
// Every model is ~1 unit in its largest dimension, Y-up, front facing +Z, centred on X/Z with
// its base at y = 0. Deterministic: no Math.random (seeded PRNG), so re-running gives
// byte-identical files. Run `node scripts/build-library.mjs` afterwards to refresh the index.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as THREE from "three";
import { mergeGeometries, mergeVertices } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { GLTFExporter } from "three/examples/jsm/exporters/GLTFExporter.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "library", "models", "food");
const CHECK = process.argv.includes("--check");

// GLTFExporter's binary path uses FileReader (browser API); Node has Blob but not FileReader.
if (typeof globalThis.FileReader === "undefined") {
  globalThis.FileReader = class {
    readAsArrayBuffer(blob) {
      blob.arrayBuffer().then((buf) => { this.result = buf; this.onloadend?.(); });
    }
  };
}

// ---------- small math helpers ----------
const { PI, sin, cos, abs, sqrt, pow, exp, max, min } = Math;
const TAU = 2 * PI;
const sp = (x, e) => Math.sign(x) * pow(abs(x), e); // signed power (superellipses)
const clamp = (x, a, b) => min(b, max(a, x));
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const lerp = (a, b, t) => a + (b - a) * t;
function rng(seed) { // mulberry32
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
// Smooth deterministic pseudo-noise in [-1, 1] (sum of incommensurate sines).
const noise = (x, y, z) =>
  (sin(x * 12.9 + y * 3.1 + 0.7) * cos(z * 11.7 - x * 2.3 + 1.9) + sin(y * 17.3 + z * 5.9 + 2.4) * 0.6 + sin((x + z) * 23.1 + y * 7.7) * 0.4) / 2;

// Colours are worked in linear space (three's working colour space).
const C = (hex) => { const c = new THREE.Color(hex); return [c.r, c.g, c.b]; };
const mix = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
const shade = (c, k) => [c[0] * k, c[1] * k, c[2] * k];

// ---------- geometry builders ----------
/**
 * Parametric grid surface. Columns i = 0..nu-1 wrap around (u = i / nu); rows j = 0..nv (v = j / nv).
 * poleStart / poleEnd collapse the first / last row to one vertex (fn(0, 0) / fn(0, 1)).
 * fn(u, v, i, j) returns [x, y, z] or [x, y, z, r, g, b] (linear vertex colour).
 */
function grid({ nu, nv, fn, poleStart = false, poleEnd = false }) {
  const pos = [], col = [], index = [];
  let colored = false;
  const rowStart = [];
  const push = (r) => { pos.push(r[0], r[1], r[2]); if (r.length > 3) { colored = true; col.push(r[3], r[4], r[5]); } else col.push(1, 1, 1); };
  for (let j = 0; j <= nv; j++) {
    rowStart.push(pos.length / 3);
    const pole = (j === 0 && poleStart) || (j === nv && poleEnd);
    if (pole) push(fn(0, j / nv, 0, j));
    else for (let i = 0; i < nu; i++) push(fn(i / nu, j / nv, i, j));
  }
  const at = (j, i) => {
    const pole = (j === 0 && poleStart) || (j === nv && poleEnd);
    return pole ? rowStart[j] : rowStart[j] + (i % nu);
  };
  for (let j = 0; j < nv; j++) {
    for (let i = 0; i < nu; i++) {
      const a = at(j, i), b = at(j, i + 1), c = at(j + 1, i), d = at(j + 1, i + 1);
      if (a !== b) index.push(a, c, b);
      if (c !== d) index.push(b, c, d);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  if (colored) g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(index);
  return g;
}

/** Makes every triangle face away from out(centroid) (per triangle), or outward by signed volume. */
function orient(g, out) {
  const p = g.attributes.position, idx = g.index.array;
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), n = new THREE.Vector3(), m = new THREE.Vector3();
  if (!out) {
    let vol = 0;
    for (let t = 0; t < idx.length; t += 3) {
      a.fromBufferAttribute(p, idx[t]); b.fromBufferAttribute(p, idx[t + 1]); c.fromBufferAttribute(p, idx[t + 2]);
      vol += a.dot(n.crossVectors(b, c));
    }
    if (vol < 0) for (let t = 0; t < idx.length; t += 3) { const s = idx[t + 1]; idx[t + 1] = idx[t + 2]; idx[t + 2] = s; }
    return g;
  }
  for (let t = 0; t < idx.length; t += 3) {
    a.fromBufferAttribute(p, idx[t]); b.fromBufferAttribute(p, idx[t + 1]); c.fromBufferAttribute(p, idx[t + 2]);
    n.crossVectors(b.clone().sub(a), c.clone().sub(a));
    m.copy(a).add(b).add(c).divideScalar(3);
    if (n.dot(out(m)) < 0) { const s = idx[t + 1]; idx[t + 1] = idx[t + 2]; idx[t + 2] = s; }
  }
  return g;
}

/** Smooth normals (indexed). */
function smoothed(g, out) { orient(g, out); g.computeVertexNormals(); return g; }
/** Faceted: one normal per face, coplanar neighbours share vertices again after merge. */
function faceted(g, out) { orient(g, out); const f = g.toNonIndexed(); f.computeVertexNormals(); return f; }

/** Sets a per-vertex linear colour from fn(position, normal). */
function paint(g, fn) {
  const p = g.attributes.position, n = g.attributes.normal, out = [];
  const v = new THREE.Vector3(), w = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) { v.fromBufferAttribute(p, i); w.fromBufferAttribute(n, i); out.push(...fn(v, w)); }
  g.setAttribute("color", new THREE.Float32BufferAttribute(out, 3));
  return g;
}

/** A three.js primitive turned into a clean, uv-less, welded geometry. */
function prim(geo) {
  geo.deleteAttribute("uv");
  geo.deleteAttribute("normal");
  const m = mergeVertices(geo, 1e-6);
  return m;
}

/** Transform helper: scale, rotate (Euler, radians), translate. */
function place(g, { s = [1, 1, 1], r = [0, 0, 0], t = [0, 0, 0], basis } = {}) {
  const m = new THREE.Matrix4();
  if (basis) m.makeBasis(basis[0], basis[1], basis[2]);
  else m.makeRotationFromEuler(new THREE.Euler(r[0], r[1], r[2]));
  m.scale(new THREE.Vector3(...(typeof s === "number" ? [s, s, s] : s)));
  m.setPosition(...t);
  g.applyMatrix4(m);
  return g;
}

/** Thin lens-shaped "score" / "cut" strip lying on a surface y = h(x, z). */
function scoreStrip({ h, cx, cz, angle, length, width, lift, sink = 0.004, nA = 10, nW = 4, color }) {
  const dx = cos(angle), dz = -sin(angle);
  const g = grid({
    nu: nA, nv: nW,
    fn: (u, v, i, j) => {
      // rows j: across the strip (-1..1); columns: along (closed ring of an ellipse outline, so the strip is a disc)
      const a = (i / nA) * TAU, rr = j / nW;
      const s = cos(a) * rr, w = sin(a) * rr;
      const x = cx + dx * s * length / 2 - dz * w * width / 2;
      const z = cz + dz * s * length / 2 + dx * w * width / 2;
      const bulge = lift * (1 - rr * rr);
      return [x, h(x, z) + bulge - sink * rr * rr, z, ...mix(color[1], color[0], 1 - rr * rr)];
    },
    poleStart: true,
  });
  return smoothed(g, () => new THREE.Vector3(0, 1, 0));
}

// ---------- model assembly + export ----------
async function exportModel(name, parts, materials) {
  // parts: [{ mat, geo }] ; materials: { name: { color?, roughness } }
  const box = new THREE.Box3();
  for (const p of parts) { p.geo.computeBoundingBox(); box.union(p.geo.boundingBox); }
  const size = box.getSize(new THREE.Vector3());
  const k = 1 / max(size.x, size.y, size.z);
  const cx = (box.min.x + box.max.x) / 2, cz = (box.min.z + box.max.z) / 2;
  const group = new THREE.Group();
  group.name = name;
  let triangles = 0;
  for (const matName of Object.keys(materials)) {
    let geos = parts.filter((p) => p.mat === matName).map((p) => p.geo);
    if (!geos.length) continue;
    geos = geos.map((g) => {
      g = g.clone();
      g.translate(-cx, -box.min.y, -cz);
      g.scale(k, k, k);
      if (!g.attributes.color) paint(g, () => [1, 1, 1]);
      return g.index ? g.toNonIndexed() : g;
    });
    let g = mergeVertices(mergeGeometries(geos, false), 1e-6);
    triangles += g.index.count / 3;
    g.setIndex(new THREE.BufferAttribute(new Uint16Array(g.index.array), 1));
    const def = materials[matName];
    const mat = new THREE.MeshStandardMaterial({ name: matName, roughness: def.roughness, metalness: 0 });
    const colAttr = g.attributes.color;
    let varied = false;
    const nominal = [1e-4, 1e-4, 1e-4];
    for (let i = 0; i < colAttr.count; i++) for (let c = 0; c < 3; c++) {
      nominal[c] = max(nominal[c], colAttr.array[i * 3 + c]);
      if (abs(colAttr.array[i * 3 + c] - colAttr.array[c]) > 1e-3) varied = true;
    }
    if (!varied || def.color) {
      // uniform material: plain baseColorFactor, no vertex colours
      g.deleteAttribute("color");
      if (def.color) mat.color.setRGB(...C(def.color));
      else mat.color.setRGB(...colAttr.array.slice(0, 3));
    } else {
      // varied: baseColorFactor = per-channel maximum, COLOR_0 = ratio (unsigned byte normalised)
      const u8 = new Uint8Array(colAttr.count * 4);
      for (let i = 0; i < colAttr.count; i++) {
        for (let c = 0; c < 3; c++) u8[i * 4 + c] = Math.round(clamp(colAttr.array[i * 3 + c] / nominal[c], 0, 1) * 255);
        u8[i * 4 + 3] = 255;
      }
      g.setAttribute("color", new THREE.BufferAttribute(u8, 4, true));
      mat.color.setRGB(...nominal);
      mat.vertexColors = true;
    }
    const mesh = new THREE.Mesh(g, mat);
    mesh.name = `${name}-${matName}`;
    group.add(mesh);
  }
  const buf = Buffer.from(await new GLTFExporter().parseAsync(group, { binary: true }));
  return { buf, triangles };
}

// ---------- palette ----------
const P = {
  crustDark: C("#8e4b1c"), crust: C("#c77a31"), crustGold: C("#e3a24c"), crustLight: C("#f0c06a"),
  crustPale: C("#ecc98d"), crumb: C("#f4dca6"), crumbShade: C("#e2b874"),
};

// ---------- croissant ----------
function croissant() {
  // crescent of rolled, tapered segments: brown glossy ridges, pale dough showing in the grooves
  const A = 2.3, Rc = 0.3, N = 5;
  const center = (t) => { const a = (t - 0.5) * 2 * A; return new THREE.Vector3(1.1 * Rc * sin(a), 0, Rc * cos(a)); };
  const tangent = (t) => { const a = (t - 0.5) * 2 * A; return new THREE.Vector3(1.1 * Rc * cos(a), 0, -Rc * sin(a)).normalize(); };
  const Y = new THREE.Vector3(0, 1, 0);
  const crust = grid({
    nu: 14, nv: 45, poleStart: true, poleEnd: true,
    fn: (u, t) => {
      const th = u * TAU, cs = cos(th), sn = sin(th);
      const T = tangent(t), Nn = new THREE.Vector3().crossVectors(T, Y).normalize();
      const e = pow(sin(PI * t), 1.1);
      const s = t * N + 0.2 * cs; // grooves wrap diagonally around the roll
      const L = pow(abs(sin(PI * s)), 0.4);
      const r = (0.01 + 0.22 * e) * (0.7 + 0.3 * L);
      const rv = r * 0.95;
      const vert = sn >= 0 ? rv * sn : rv * sn * 0.3;
      const c = center(t);
      if (t === 0 || t === 1) c.addScaledVector(T, t === 0 ? -0.035 : 0.035);
      const p = c.addScaledVector(Nn, r * cs).addScaledVector(Y, vert + rv * 0.3);
      let col = mix(C("#e8b46a"), C("#b9692a"), smooth(0.35, 0.85, L));
      if (sn > 0.2) col = mix(col, C("#a95a22"), (sn - 0.2) * 0.35 * L);
      if (sn < 0) col = mix(col, C("#e2b06a"), -sn * 0.6);
      col = mix(col, C("#8c4a1e"), pow(1 - e, 4) * 0.7);
      col = shade(col, 1 + 0.05 * noise(p.x * 3, p.y * 3, p.z * 3));
      return [p.x, p.y, p.z, ...col];
    },
  });
  return [{ mat: "crust", geo: smoothed(crust) }];
}

// ---------- baguette ----------
function baguette() {
  const R = 0.11, flatten = 0.35;
  const yAt = (t, th) => {
    const e = pow(1 - pow(abs(2 * t - 1), 3), 0.5);
    const r0 = R * e + 0.004;
    return { r0, rz: r0, ry: r0 * 0.78 };
  };
  const bend = (t) => 0.035 * sin(PI * t);
  const crust = grid({
    nu: 12, nv: 36, poleStart: true, poleEnd: true,
    fn: (u, v) => {
      const t = 0.5 - 0.5 * cos(PI * v);
      const th = u * TAU, cs = cos(th), sn = sin(th);
      const x = (t - 0.5) * 1.0;
      const { rz, ry } = yAt(t, th);
      const lump = 1 + 0.025 * sin(x * 23 + th * 2) + 0.018 * sin(x * 41 + 1.3);
      const z = rz * cs * lump + bend(t);
      const y = (sn >= 0 ? ry * sn * lump : ry * sn * flatten) + ry * flatten;
      const e = pow(1 - pow(abs(2 * t - 1), 3), 0.5);
      let col = mix(C("#d4924a"), C("#a85a22"), smooth(0.1, 0.95, sn));
      if (sn < 0) col = mix(col, P.crustPale, -sn * 0.7);
      col = mix(col, C("#93501f"), pow(1 - e, 2.5) * 0.75);
      col = shade(col, 1 + 0.06 * noise(x * 2, y * 4, z * 4));
      return [x, y, z, ...col];
    },
  });
  // top surface height (ignores the small lumps; the score strips sit just above it)
  const h = (x, z) => {
    const t = x + 0.5;
    const { rz, ry } = yAt(t);
    const zz = (z - bend(t)) / rz;
    return ry * sqrt(max(0, 1 - zz * zz)) + ry * flatten;
  };
  const parts = [{ mat: "crust", geo: smoothed(crust) }];
  for (let k = 0; k < 5; k++) {
    const x = -0.3 + k * 0.15;
    parts.push({ mat: "crumb", geo: scoreStrip({ h, cx: x, cz: bend(x + 0.5), angle: -0.42, length: 0.18, width: 0.045, lift: 0.012, nA: 8, nW: 3, color: [P.crumb, P.crustGold] }) });
  }
  return parts;
}

// ---------- bread loaf ----------
function breadLoaf() {
  const A = 0.48, B = 0.29, Ct = 0.25, Cb = 0.2, eH = 0.36, eTop = 0.78, eBot = 0.2, kTop = 1.05;
  const flare = (y) => (y >= 0 ? kTop : lerp(0.9, 1.0, smooth(-Cb, 0, y)));
  const crust = grid({
    nu: 28, nv: 16, poleStart: true, poleEnd: true,
    fn: (u, v) => {
      const th = v * PI, ph = u * TAU;
      const st = sin(th), ct = cos(th), top = ct >= 0;
      const e1 = top ? eTop : eBot;
      const hx = sp(st, e1), yv = sp(ct, e1);
      let y = top ? Ct * yv : Cb * yv;
      const k = flare(y);
      let x = A * hx * sp(cos(ph), eH) * k, z = B * hx * sp(sin(ph), eH) * k;
      if (top) y += 0.006 * noise(x * 2, 0, z * 2) * st;
      let col;
      if (top) col = mix(C("#c97a33"), C("#99501e"), smooth(0.0, 0.9, ct));
      else col = mix(C("#d99a50"), C("#e6bf84"), smooth(0.2, 1, -ct));
      if (top && ct < 0.25) col = mix(col, C("#9c5323"), (0.25 - ct) * 1.6 * (ct > 0 ? 1 : 0));
      col = shade(col, 1 + 0.05 * noise(x * 3, y * 3, z * 3));
      return [x, y, z, ...col];
    },
  });
  // analytic crown height (superellipsoid upper half with the flare)
  const h = (x, z) => {
    const q = pow(abs(x / (A * kTop)), 2 / eH) + pow(abs(z / (B * kTop)), 2 / eH);
    return Ct * pow(max(0, 1 - pow(q, eH / eTop)), eTop / 2);
  };
  const parts = [{ mat: "crust", geo: smoothed(crust) }];
  for (let k = 0; k < 3; k++) {
    const x = -0.2 + k * 0.2;
    parts.push({ mat: "crumb", geo: scoreStrip({ h, cx: x, cz: 0, angle: 1.15, length: 0.4, width: 0.05, lift: 0.014, sink: 0.012, nA: 12, nW: 3, color: [P.crumb, C("#d9a45d")] }) });
  }
  return parts;
}

// ---------- donut ----------
function donut() {
  const R = 0.35, r = 0.15, fl = 0.86;
  const at = (ph, th, rr) => new THREE.Vector3((R + rr * cos(th)) * cos(ph), rr * sin(th) * fl, (R + rr * cos(th)) * sin(ph));
  const outFromRing = (m) => { const q = new THREE.Vector3(m.x, 0, m.z).setLength(R); return m.clone().sub(q); };
  const dough = grid({
    nu: 24, nv: 7,
    fn: (u, v) => {
      const ph = u * TAU, th = 0.2 - v * (PI + 0.4);
      const p = at(ph, th, r);
      const band = max(exp(-pow(th / 0.42, 2)), exp(-pow((th + PI) / 0.38, 2)));
      let col = mix(C("#c27f3c"), C("#a1602b"), smooth(0, 1, -sin(th)));
      col = mix(col, C("#f2dcab"), band * 0.85);
      col = shade(col, 1 + 0.05 * noise(p.x * 3, p.y * 3, p.z * 3));
      return [p.x, p.y, p.z, ...col];
    },
  });
  const th0 = (ph) => -max(0.06, 0.3 + 0.17 * sin(5 * ph + 0.3) + 0.12 * sin(8 * ph + 1.1));
  const th1 = (ph) => PI + 0.2 + 0.07 * sin(6 * ph + 2);
  const icing = grid({
    nu: 40, nv: 7,
    fn: (u, v) => {
      const ph = u * TAU;
      const th = lerp(th0(ph), th1(ph), v);
      const rr = r * (1.012 + 0.085 * pow(sin(PI * v), 0.45));
      const p = at(ph, th, rr);
      return [p.x, p.y, p.z];
    },
  });
  // sprinkles: little rounded rods lying on the icing
  const rand = rng(7);
  const cols = ["#ffffff", "#ffd23f", "#4cc3f0", "#6fd46a", "#ff8f3d", "#a98bf0"].map(C);
  const placed = [];
  const sprinkles = [];
  for (let tries = 0; placed.length < 26 && tries < 2000; tries++) {
    const ph = rand() * TAU, th = 0.45 + rand() * 2.25;
    const p = at(ph, th, r * 1.075);
    if (placed.some((q) => q.distanceTo(p) < 0.055)) continue;
    placed.push(p);
    const ePh = new THREE.Vector3(-sin(ph), 0, cos(ph));
    const nrm = outFromRing(p).normalize();
    const eTh = new THREE.Vector3().crossVectors(nrm, ePh).normalize();
    const a = rand() * PI;
    const ax = ePh.clone().multiplyScalar(cos(a)).addScaledVector(eTh, sin(a));
    const side = new THREE.Vector3().crossVectors(nrm, ax).normalize();
    const g = prim(new THREE.BoxGeometry(1, 1, 1));
    place(g, { basis: [ax, nrm, side], s: [0.05, 0.016, 0.016], t: [p.x, p.y, p.z] });
    const col = cols[placed.length % cols.length];
    sprinkles.push({ mat: "sprinkles", geo: paint(smoothed(g), () => col) });
  }
  return [
    { mat: "dough", geo: smoothed(dough, outFromRing) },
    { mat: "icing", geo: smoothed(icing, outFromRing) },
    ...sprinkles,
  ];
}

// ---------- cupcake ----------
function cupcake() {
  const parts = [];
  const pleats = 20, nu = pleats * 2, Hc = 0.36, rb = 0.27, rt = 0.36;
  const cup = grid({
    nu, nv: 2, poleStart: true,
    fn: (u, v, i, j) => {
      const ph = u * TAU, k = i % 2 === 0 ? 1 : 0.95;
      if (j === 0) return [0, 0, 0];
      const y = j === 1 ? 0 : Hc, rr = (j === 1 ? rb : rt) * k;
      return [rr * cos(ph), y, rr * sin(ph)];
    },
  });
  const cupG = faceted(cup, (m) => (m.y < 1e-4 ? new THREE.Vector3(0, -1, 0) : new THREE.Vector3(m.x, 0, m.z)));
  paint(cupG, (p, n) => {
    if (n.y < -0.9) return C("#5aa79e");
    const t = new THREE.Vector3(-p.z, 0, p.x).normalize();
    const light = n.dot(t) > 0;
    return light ? C("#8ad6cb") : C("#62b8ad");
  });
  parts.push({ mat: "wrapper", geo: cupG });
  // sponge muffin top just above the rim
  const prof = [[0.345, 0.33], [0.372, 0.37], [0.385, 0.405], [0.36, 0.44], [0.25, 0.46]];
  const cake = grid({
    nu: 20, nv: prof.length, poleEnd: true,
    fn: (u, v, i, j) => {
      const ph = u * TAU;
      if (j === prof.length) return [0, 0.47, 0];
      const [rr, y] = prof[j];
      const w = 1 + 0.02 * sin(ph * 5 + 1);
      const col = shade(mix(C("#e0a45a"), C("#c27d3a"), j / prof.length), 1 + 0.05 * noise(cos(ph), y * 4, sin(ph)));
      return [rr * w * cos(ph), y, rr * w * sin(ph), ...col];
    },
  });
  parts.push({ mat: "sponge", geo: smoothed(cake) });
  // piped swirl frosting
  const nv = 14, tiers = 3.1, y0 = 0.415, y1 = 0.9;
  const frost = grid({
    nu: 20, nv, poleStart: true, poleEnd: true,
    fn: (u, v, i, j) => {
      const ph = u * TAU;
      if (j === 0) return [0, y0 - 0.05, 0, ...C("#f3a9c0")];
      if (j === nv) return [0.03, y1 + 0.01, 0, ...C("#fbd3df")];
      const hh = (j - 1) / (nv - 1);
      const env = 0.355 * pow(1 - hh, 0.62);
      const s = hh * tiers - ph / TAU;
      const bump = pow(abs(sin(PI * s)), 0.6);
      const rr = env * (0.68 + 0.32 * bump);
      const lean = 0.03 * pow(hh, 3);
      const y = lerp(y0, y1, hh) + 0.02 * bump * (1 - hh);
      const col = mix(C("#df7799"), C("#fbd0dd"), pow(bump, 1.5));
      return [rr * cos(ph) + lean, y, rr * sin(ph), ...col];
    },
  });
  parts.push({ mat: "frosting", geo: smoothed(frost) });
  // cherry with a stem
  const cr = 0.075, cy = y1 - 0.01 + cr * 0.85;
  const cherry = grid({
    nu: 11, nv: 6, poleStart: true, poleEnd: true,
    fn: (u, v) => {
      const ph = u * TAU, th = v * PI;
      const dimple = 1 - 0.18 * exp(-pow(th / 0.45, 2));
      const rr = cr * dimple;
      const p = [rr * sin(th) * cos(ph) + 0.02, cy + rr * cos(th) * 0.92, rr * sin(th) * sin(ph)];
      return [...p, ...mix(C("#e8333f"), C("#a8101e"), smooth(0.3, 1, v))];
    },
  });
  parts.push({ mat: "cherry", geo: smoothed(cherry) });
  const stemPath = (t) => new THREE.Vector3(0.02 + 0.05 * t * t, cy + cr * 0.75 + 0.11 * t, -0.01 * t);
  const stem = grid({
    nu: 5, nv: 5, poleEnd: true,
    fn: (u, v) => {
      const ph = u * TAU, c = stemPath(v), sr = 0.007;
      return [c.x + sr * cos(ph), c.y, c.z + sr * sin(ph)];
    },
  });
  const stemG = smoothed(stem, (m) => new THREE.Vector3(m.x - stemPath(0.5).x, 0.0001, m.z - stemPath(0.5).z));
  parts.push({ mat: "cherry", geo: paint(stemG, () => C("#5f7d2c")) });
  return parts;
}

// ---------- cookie ----------
function cookie() {
  const Rf = (ph) => 0.5 * (1 + 0.035 * sin(3 * ph + 1) + 0.025 * sin(5 * ph + 2) + 0.015 * sin(9 * ph + 0.5));
  const H = 1.25;
  const prof = [[0.0, 0.106], [0.35, 0.104], [0.62, 0.099], [0.83, 0.09], [0.95, 0.074], [1.0, 0.048], [0.975, 0.018], [0.9, 0.0], [0.0, 0.0]];
  const topH = (rho) => { // height of the top surface at radius fraction rho (piecewise linear on prof)
    for (let k = 0; k < 4; k++) if (rho <= prof[k + 1][0]) return lerp(prof[k][1], prof[k + 1][1], (rho - prof[k][0]) / (prof[k + 1][0] - prof[k][0])) * H;
    return prof[4][1] * H;
  };
  const dough = grid({
    nu: 34, nv: prof.length - 1, poleStart: true, poleEnd: true,
    fn: (u, v, i, j) => {
      const ph = u * TAU, [rho, y0] = prof[j], R = Rf(ph);
      const x = rho * R * cos(ph), z = rho * R * sin(ph);
      let y = y0 * H;
      if (j <= 4) y += 0.012 * noise(x * 3, 0.3, z * 3);
      let col = j <= 4 ? mix(C("#d9a052"), C("#b06a2e"), smooth(0.35, 1, rho)) : mix(C("#a3602a"), C("#c4843f"), smooth(5, 8, j));
      col = shade(col, 1 + 0.1 * noise(x * 5, y, z * 5));
      return [x, y, z, ...col];
    },
  });
  const parts = [{ mat: "dough", geo: smoothed(dough) }];
  const rand = rng(11);
  const chips = [];
  for (let tries = 0; chips.length < 13 && tries < 2000; tries++) {
    const ph = rand() * TAU, rho = sqrt(rand()) * 0.86;
    const p = new THREE.Vector3(rho * Rf(ph) * cos(ph), 0, rho * Rf(ph) * sin(ph));
    if (chips.some((q) => q.distanceTo(p) < 0.16)) continue;
    chips.push(p);
    const rad = 0.05 + rand() * 0.025, ht = 0.035 + rand() * 0.015;
    const g = prim(new THREE.ConeGeometry(1, 1, 5, 1));
    place(g, { s: [rad, ht, rad * (0.8 + rand() * 0.3)], r: [(rand() - 0.5) * 0.5, rand() * TAU, (rand() - 0.5) * 0.5], t: [p.x, topH(rho) + ht * 0.1, p.z] });
    parts.push({ mat: "chocolate", geo: paint(faceted(g), (q, n) => shade(C("#4a2617"), 0.8 + 0.35 * max(0, n.y))) });
  }
  return parts;
}

// ---------- pain au chocolat ----------
function painAuChocolat() {
  const W = 0.27, Hh = 0.15, e = 0.55, ridges = 10;
  // rows: [x, scale, kind]  (end faces show concentric dough layers)
  const ends = [[-0.462, 0], [-0.466, 0.3], [-0.468, 0.55], [-0.464, 0.78], [-0.45, 0.93], [-0.415, 1]];
  const rows = [...ends, [-0.3, 1], [-0.15, 1], [0, 1], [0.15, 1], [0.3, 1], ...ends.slice().reverse().map(([x, s]) => [-x, s])];
  const layer = [C("#b66a2b"), C("#f0c47a"), C("#c47a35"), C("#f3cf8c"), C("#d08a40"), C("#d08a40")];
  const body = grid({
    nu: 40, nv: rows.length - 1, poleStart: true, poleEnd: true,
    fn: (u, v, i, j) => {
      const th = u * TAU, cs = cos(th), sn = sin(th);
      const [x, s] = rows[j];
      const endIdx = j < ends.length ? j : rows.length - 1 - j;
      const bulge = 1 + 0.05 * cos(PI * x * 1.6);
      const sideW = abs(cs);
      const ridge = 1 - 0.03 * (0.5 + 0.5 * cos(th * ridges * 2)) * smooth(0.25, 0.8, sideW) * (s >= 1 ? 1 : 0.4);
      let z = W * sp(cs, e) * s * bulge * ridge;
      let y = Hh * sp(sn, e) * s * bulge * ridge;
      if (y < 0) y *= 0.55;
      y += Hh * 0.55;
      z += 0.006 * noise(x * 4, y * 4, 0);
      let col;
      if (endIdx < ends.length - 1) col = layer[endIdx];
      else {
        const peak = 0.5 + 0.5 * cos(th * ridges * 2);
        col = mix(C("#9a5222"), C("#dc9245"), peak * smooth(0.25, 0.8, sideW) + (1 - smooth(0.25, 0.8, sideW)) * 0.55);
        if (sn > 0.4) col = mix(col, C("#a35520"), (sn - 0.4) * 1.3);
        if (sn < -0.2) col = mix(col, C("#e7bb78"), -sn);
      }
      col = shade(col, 1 + 0.05 * noise(x * 6, y * 3, z * 3));
      return [x, y, z, ...col];
    },
  });
  const parts = [{ mat: "pastry", geo: smoothed(body) }];
  for (const [yy, zz] of [[0.075, -0.07], [0.145, 0.06]]) {
    const g = prim(new THREE.BoxGeometry(1, 1, 1));
    place(g, { s: [0.975, 0.045, 0.1], t: [0, yy, zz] });
    parts.push({ mat: "chocolate", geo: faceted(g) });
  }
  return parts;
}

// ---------- main ----------
const MODELS = {
  croissant: [croissant, { crust: { roughness: 0.6 } }],
  baguette: [baguette, { crust: { roughness: 0.75 }, crumb: { roughness: 0.9 } }],
  "bread-loaf": [breadLoaf, { crust: { roughness: 0.7 }, crumb: { roughness: 0.9 } }],
  donut: [donut, { dough: { roughness: 0.75 }, icing: { color: "#f5879f", roughness: 0.35 }, sprinkles: { roughness: 0.5 } }],
  cupcake: [cupcake, { wrapper: { roughness: 0.85 }, sponge: { roughness: 0.85 }, frosting: { roughness: 0.45 }, cherry: { roughness: 0.3 } }],
  cookie: [cookie, { dough: { roughness: 0.85 }, chocolate: { roughness: 0.5 } }],
  "pain-au-chocolat": [painAuChocolat, { pastry: { roughness: 0.55 }, chocolate: { color: "#4a2616", roughness: 0.45 } }],
};

const only = process.argv.find((a) => a.startsWith("--only="))?.slice(7).split(",");
let bad = 0;
for (const [name, [build, materials]] of Object.entries(MODELS)) {
  if (only && !only.includes(name)) continue;
  const { buf, triangles } = await exportModel(name, build(), materials);
  const file = path.join(OUT, `${name}.glb`);
  if (CHECK) {
    const same = fs.existsSync(file) && fs.readFileSync(file).equals(buf);
    if (!same) bad++;
    console.log(`${same ? "ok" : "✗ differs"} ${name}.glb`);
  } else {
    fs.writeFileSync(file, buf);
    console.log(`wrote library/models/food/${name}.glb  ${(buf.length / 1024).toFixed(1)} KB  ${triangles} triangles`);
  }
}
if (bad) process.exit(1);
