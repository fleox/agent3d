// Procedural city: street grid, sidewalks, parks, buildings of varied heights
// (taller downtown, setbacks, rooftop details), lit windows from a tiny
// procedural DataTexture (no canvas → works headless), street trees.
// Two draw calls: buildings (textured) + everything else (vertex colours).

import * as THREE from "three";
import type { GeneratorImpl, Rng } from "../registry";
import { generatorParams } from "./params";
import { MeshBuilder, built, jitter, mat4, shade, vertexColorMaterial } from "./geom";

const CELLS = 16; // window cells per texture side
const PX = 8; // pixels per cell
const TEX = CELLS * PX;
const WIN_W = 0.5; // world width of a window cell
const WIN_H = 0.55; // world height of a floor

function windowTextures(rng: Rng): { map: THREE.DataTexture; emissive: THREE.DataTexture } {
  const diffuse = new Uint8Array(TEX * TEX * 4);
  const emit = new Uint8Array(TEX * TEX * 4);
  for (let cy = 0; cy < CELLS; cy++)
    for (let cx = 0; cx < CELLS; cx++) {
      const lit = rng.next() < 0.38;
      const warm = rng.range(0.7, 1);
      const glass = rng.range(0.85, 1.15);
      for (let py = 0; py < PX; py++)
        for (let px = 0; px < PX; px++) {
          const i = ((cy * PX + py) * TEX + cx * PX + px) * 4;
          const isWin = px >= 2 && px <= 5 && py >= 2 && py <= 6;
          if (isWin) {
            diffuse.set([Math.round(62 * glass), Math.round(78 * glass), Math.round(104 * glass), 255], i);
            const e = lit ? Math.round(255 * warm) : 0;
            emit.set([e, Math.round(e * 0.96), Math.round(e * 0.85), 255], i);
          } else {
            diffuse.set([255, 255, 255, 255], i);
            emit.set([0, 0, 0, 255], i);
          }
        }
    }
  const mk = (data: Uint8Array) => {
    const t = new THREE.DataTexture(data, TEX, TEX, THREE.RGBAFormat);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.magFilter = THREE.LinearFilter;
    t.minFilter = THREE.LinearMipmapLinearFilter;
    t.generateMipmaps = true;
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
    t.needsUpdate = true;
    return t;
  };
  return { map: mk(diffuse), emissive: mk(emit) };
}

export const city: GeneratorImpl = (raw, ctx) => {
  const p = generatorParams("city", raw, ctx);
  const blocks = p.int("blocks");
  const bs = p.num("blockSize");
  const st = p.num("street");
  const minH = p.num("minHeight");
  const maxH = Math.max(minH, p.num("maxHeight"));
  const colors = p.colors("colors");
  const windows = p.bool("windows");
  const streetTrees = p.bool("trees");
  const rng = ctx.rng;

  const total = blocks * bs + (blocks + 1) * st;
  const half = total / 2;
  const asphalt = new THREE.Color("#3b3f4a");
  const sidewalk = new THREE.Color("#cfcac0");
  const curb = new THREE.Color("#a9a49a");
  const lane = new THREE.Color("#f2e8c9");
  const park = new THREE.Color("#7cb35b");
  const parkDark = new THREE.Color("#5e9a45");
  const roofGrey = new THREE.Color("#8d8f94");
  const trunk = new THREE.Color("#6d4c41");
  const leafs = [new THREE.Color("#4caf50"), new THREE.Color("#66bb6a"), new THREE.Color("#388e3c")];

  const base = new MeshBuilder();
  const bld = new MeshBuilder();
  bld.useUv = true;

  // Streets
  base.quad([-half, 0, half], [half, 0, half], [half, 0, -half], [-half, 0, -half], asphalt);
  for (let k = 0; k <= blocks; k++) {
    const c = -half + st / 2 + k * (bs + st);
    for (let d = -half + 0.4; d < half - 0.6; d += 1.0) {
      const y = 0.005;
      base.quad([c - 0.04, y, d + 0.5], [c + 0.04, y, d + 0.5], [c + 0.04, y, d], [c - 0.04, y, d], lane);
      base.quad([d, y, c + 0.04], [d + 0.5, y, c + 0.04], [d + 0.5, y, c - 0.04], [d, y, c - 0.04], lane);
    }
  }

  // Shared foliage variants for street / park trees
  const crowns = Array.from({ length: 3 }, () => jitter(new THREE.IcosahedronGeometry(1, 0), 0.25, rng.next));
  const stem = new THREE.CylinderGeometry(0.06, 0.08, 1, 5);
  stem.translate(0, 0.5, 0);
  const tree = (x: number, y: number, z: number, s: number): void => {
    base.add(stem, mat4(x, y, z, s, s * 0.5, s), trunk);
    base.add(rng.pick(crowns), mat4(x, y + s * 0.75, z, s * 0.42, s * 0.48, s * 0.42, 0, rng.next() * 6), rng.pick(leafs));
  };

  const maxDist = Math.hypot(half, half);
  const uvFor = (face: "x" | "z" | "y", w: number, h: number, ou: number, ov: number): [number, number, number, number] => {
    if (face === "y") {
      const f = 0.5 / TEX;
      return [f, f, f, f];
    }
    const nu = Math.max(1, Math.round(w / WIN_W));
    const nv = Math.max(1, Math.round(h / WIN_H));
    return [ou, ov, ou + nu / CELLS, ov + nv / CELLS];
  };

  for (let bz = 0; bz < blocks; bz++)
    for (let bx = 0; bx < blocks; bx++) {
      const x0 = -half + st + bx * (bs + st);
      const z0 = -half + st + bz * (bs + st);
      const x1 = x0 + bs, z1 = z0 + bs;
      const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
      const centre = 1 - Math.hypot(cx, cz) / maxDist;
      const isPark = blocks > 2 && rng.next() < 0.08;
      // Sidewalk slab
      base.box([x0, 0, z0], [x1, 0.12, z1], curb, isPark ? park : sidewalk);
      if (isPark) {
        base.box([x0 + 0.35, 0.12, z0 + 0.35], [x1 - 0.35, 0.16, z1 - 0.35], parkDark, park);
        const n = Math.max(2, Math.round(bs * 1.2));
        for (let k = 0; k < n; k++) tree(rng.range(x0 + 0.7, x1 - 0.7), 0.16, rng.range(z0 + 0.7, z1 - 0.7), rng.range(0.8, 1.3));
        continue;
      }
      if (streetTrees) {
        for (let d = x0 + 0.6; d < x1 - 0.3; d += Math.max(1.4, bs / 3)) {
          tree(d, 0.12, z0 + 0.22, 0.75);
          tree(d, 0.12, z1 - 0.22, 0.75);
        }
      }
      // Lots: 1, 2 or 4 buildings per block
      const split = rng.next();
      const lots: [number, number, number, number][] = [];
      const ins = 0.45;
      const ax0 = x0 + ins, az0 = z0 + ins, ax1 = x1 - ins, az1 = z1 - ins;
      const mx = (ax0 + ax1) / 2 + rng.range(-0.15, 0.15) * bs, mz = (az0 + az1) / 2 + rng.range(-0.15, 0.15) * bs;
      if (split < 0.2) lots.push([ax0, az0, ax1, az1]);
      else if (split < 0.45) lots.push([ax0, az0, mx, az1], [mx, az0, ax1, az1]);
      else lots.push([ax0, az0, mx, mz], [mx, az0, ax1, mz], [ax0, mz, mx, az1], [mx, mz, ax1, az1]);
      for (const [lx0, lz0, lx1, lz1] of lots) {
        const g = 0.08;
        const fx0 = lx0 + g, fz0 = lz0 + g, fx1 = lx1 - g, fz1 = lz1 - g;
        const r = rng.next();
        const h = minH + (maxH - minH) * Math.pow(r, 1.6) * (0.35 + 0.65 * centre * centre) + rng.range(0, 0.15) * (maxH - minH) * centre;
        const col = rng.pick(colors);
        const roof = shade(col, 0.78);
        const ou = rng.int(0, CELLS - 1) / CELLS;
        const ov = rng.int(0, CELLS - 1) / CELLS;
        const uv = (face: "x" | "z" | "y", w: number, hh: number) => uvFor(face, w, hh, ou, ov);
        const y0 = 0.12;
        const tall = h > minH + (maxH - minH) * 0.55 && fx1 - fx0 > 1.2 && fz1 - fz0 > 1.2;
        const h1 = tall ? h * rng.range(0.6, 0.75) : h;
        bld.box([fx0, y0, fz0], [fx1, y0 + h1, fz1], col, roof, { uv });
        let topY = y0 + h1;
        let tx0 = fx0, tz0 = fz0, tx1 = fx1, tz1 = fz1;
        if (tall) {
          const s = Math.min(fx1 - fx0, fz1 - fz0) * rng.range(0.12, 0.22);
          tx0 += s; tz0 += s; tx1 -= s; tz1 -= s;
          bld.box([tx0, topY, tz0], [tx1, y0 + h, tz1], shade(col, 1.04), roof, { uv });
          topY = y0 + h;
        }
        // Parapet rim
        const rim = 0.06;
        base.box([tx0, topY, tz0], [tx1, topY + 0.08, tz0 + rim], roof);
        base.box([tx0, topY, tz1 - rim], [tx1, topY + 0.08, tz1], roof);
        base.box([tx0, topY, tz0], [tx0 + rim, topY + 0.08, tz1], roof);
        base.box([tx1 - rim, topY, tz0], [tx1, topY + 0.08, tz1], roof);
        // Rooftop details
        const w = tx1 - tx0, d = tz1 - tz0;
        const units = rng.int(0, 2);
        for (let k = 0; k < units; k++) {
          const ux = rng.range(tx0 + 0.2, tx1 - 0.5), uz = rng.range(tz0 + 0.2, tz1 - 0.5);
          base.box([ux, topY, uz], [ux + Math.min(0.35, w * 0.3), topY + 0.22, uz + Math.min(0.3, d * 0.3)], roofGrey, shade(roofGrey, 1.15));
        }
        if (h > maxH * 0.8 && rng.next() < 0.6) base.box([(tx0 + tx1) / 2 - 0.03, topY, (tz0 + tz1) / 2 - 0.03], [(tx0 + tx1) / 2 + 0.03, topY + rng.range(0.6, 1.2), (tz0 + tz1) / 2 + 0.03], roofGrey);
        else if (rng.next() < 0.15 && w > 0.8) {
          const tower = new THREE.CylinderGeometry(0.18, 0.18, 0.35, 7);
          base.add(tower, mat4(tx0 + w * 0.7, topY + 0.38, tz0 + d * 0.3), new THREE.Color("#9c6b4a"));
          base.box([tx0 + w * 0.7 - 0.12, topY, tz0 + d * 0.3 - 0.12], [tx0 + w * 0.7 + 0.12, topY + 0.2, tz0 + d * 0.3 + 0.12], roofGrey);
          tower.dispose();
        }
      }
    }
  for (const c of crowns) c.dispose();
  stem.dispose();

  const group = new THREE.Group();
  group.name = "city";
  const baseMesh = new THREE.Mesh(base.build(), vertexColorMaterial({ flat: true, roughness: 0.9 }));
  baseMesh.name = "city-ground";
  baseMesh.receiveShadow = true;
  baseMesh.castShadow = true;
  group.add(baseMesh);
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.75, metalness: 0.05 });
  if (windows) {
    const tex = windowTextures(rng);
    mat.map = tex.map;
    mat.emissiveMap = tex.emissive;
    mat.emissive = p.color("windowColor");
    mat.emissiveIntensity = 1.4;
  }
  const bMesh = new THREE.Mesh(bld.build(), mat);
  bMesh.name = "city-buildings";
  bMesh.castShadow = true;
  bMesh.receiveShadow = true;
  group.add(bMesh);
  group.userData.size = total;
  return built(group);
};
