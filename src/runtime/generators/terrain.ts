// Heightmap terrain: fbm / ridged noise shaped as hills, mountains, island,
// dunes, canyon or flat; vertex colour bands by height + slope; faceted
// low-poly (non-indexed) or smooth; optional water plane. Exposes heightAt.

import * as THREE from "three";
import type { GeneratorImpl } from "../registry";
import { fbm2D, noise2D, ridged2D } from "../random";
import { generatorParams } from "./params";
import { built, ramp, smoothstep } from "./geom";
import { bakeDepth, createWaterMaterial } from "./waterMaterial";

type Shape = "hills" | "mountains" | "island" | "dunes" | "canyon" | "flat";

export function terrainHeightFn(shape: Shape, size: number, scale: number, octaves: number, ox: number, oz: number): (x: number, z: number) => number {
  // Normalised height in ~[0, 1] for world (x, z).
  const f = 1.5 / (size * Math.max(0.05, scale));
  return (x, z) => {
    const nx = x * f + ox;
    const nz = z * f + oz;
    switch (shape) {
      case "hills": {
        const n = fbm2D(nx, nz, octaves, 2, 0.45) * 0.5 + 0.5;
        const k = Math.max(0, (n - 0.3) / 0.6);
        return Math.pow(k, 1.35) * 0.95 + 0.02;
      }
      case "mountains": {
        const r = ridged2D(nx * 0.8, nz * 0.8, octaves);
        const base = fbm2D(nx * 0.4 + 7, nz * 0.4 - 3, 3) * 0.5 + 0.5;
        return Math.pow(r, 1.6) * (0.35 + 0.75 * base);
      }
      case "island": {
        const r = Math.sqrt(x * x + z * z) / (size * 0.5);
        const warp = fbm2D(nx * 0.7 + 3.3, nz * 0.7 - 1.1, 3) * 0.22;
        const falloff = 1 - smoothstep(0.15, 0.95, r + warp);
        const n = fbm2D(nx, nz, octaves) * 0.5 + 0.5;
        const peak = ridged2D(nx * 0.9, nz * 0.9, Math.max(1, octaves - 1)) * 0.5;
        return falloff * (0.25 + n * 0.55 + peak * falloff) - 0.12 * (1 - falloff);
      }
      case "dunes": {
        // Ridged, directional (wind along x), asymmetric crests.
        const w = fbm2D(nx * 0.5, nz * 0.5, 2) * 1.6;
        const p = nx * 1.4 + nz * 0.4 + w;
        const s = p - Math.floor(p);
        const crest = s < 0.72 ? s / 0.72 : 1 - (s - 0.72) / 0.28; // gentle windward, steeper lee
        const shaped = crest * crest * (3 - 2 * crest);
        const big = fbm2D(nx * 0.35 - 5, nz * 0.35 + 9, 3) * 0.5 + 0.5;
        return shaped * (0.3 + 0.4 * big) + fbm2D(nx * 3, nz * 3, 2) * 0.03 + 0.16;
      }
      case "canyon": {
        const n = fbm2D(nx, nz, octaves) * 0.5 + 0.5;
        // Terraced plateau carved by a meandering river valley.
        const river = Math.abs(noise2D(nx * 0.45 + 11, nz * 0.45 - 4) + fbm2D(nx * 1.3, nz * 1.3, 2) * 0.12);
        const valley = smoothstep(0.04, 0.32, river);
        const plateau = 0.55 + n * 0.45;
        const steps = 4;
        const k = plateau * steps;
        const terr = (Math.floor(k) + smoothstep(0.75, 1, k - Math.floor(k))) / steps;
        return 0.04 + valley * terr * 0.96;
      }
      case "flat":
      default:
        return 0.2 + fbm2D(nx * 2, nz * 2, 2) * 0.03;
    }
  };
}

export const terrain: GeneratorImpl = (raw, ctx) => {
  const p = generatorParams("terrain", raw, ctx);
  const size = p.num("size");
  const res = p.int("resolution");
  const height = p.num("height");
  const shape = p.str<Shape>("shape");
  const palette = p.colors("palette");
  const lowpoly = p.bool("lowpoly");
  const waterLevel = p.numOrNull("waterLevel");
  const snowLine = p.num("snowLine");
  const ox = ctx.rng.range(-500, 500);
  const oz = ctx.rng.range(-500, 500);
  const h01 = terrainHeightFn(shape, size, p.num("scale"), p.int("octaves"), ox, oz);

  const n = res + 1;
  const step = size / res;
  const heights = new Float32Array(n * n);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) heights[j * n + i] = h01(-size / 2 + i * step, -size / 2 + j * step) * height;
  const H = (i: number, j: number) => heights[Math.min(n - 1, Math.max(0, j)) * n + Math.min(n - 1, Math.max(0, i))]!;

  // Colour by height (relative to water), slope (rock on steep faces) and a little noise.
  const water = waterLevel === null ? null : waterLevel;
  let minY = Infinity, maxY = -Infinity;
  for (const h of heights) {
    if (h < minY) minY = h;
    if (h > maxY) maxY = h;
  }
  const deepWater = p.color("waterColor").multiplyScalar(0.55);
  const colorAt = (x: number, y: number, z: number, slope: number, out: THREE.Color): THREE.Color => {
    const pal = palette.length;
    if (pal <= 1) return out.copy(palette[0]!);
    const jitterN = noise2D(x * 0.35 + 50, z * 0.35 - 20) * 0.05;
    if (water !== null && y < water) {
      // under water: sand fading to deep water colour with depth
      const d = (water - y) / Math.max(0.3, height * 0.22);
      return out.copy(palette[0]!).lerp(deepWater, smoothstep(0, 1, d) * 0.8);
    }
    if (shape === "dunes") {
      out.copy(palette[0]!).multiplyScalar(1.04 - slope * 0.35 + jitterN);
      return out;
    }
    const base = water === null ? minY : water;
    const t = (y - base) / Math.max(0.001, maxY - base, height * 0.6) + jitterN;
    if (shape === "canyon") {
      // stratified rock walls, sandy plateaus, green river banks
      const rock = palette[Math.max(1, pal - 2)]!;
      const sand = palette[0]!;
      if (t < 0.12) return out.copy(palette[1]!).lerp(sand, smoothstep(0.02, 0.12, t));
      if (slope > 0.35) {
        const band = 0.5 + 0.5 * Math.sin(y * 5.5 + jitterN * 8);
        return out.copy(rock).lerp(sand, band * 0.55).multiplyScalar(0.9 + band * 0.15);
      }
      return out.copy(sand).lerp(rock, 0.18 + jitterN * 2);
    }
    // thin beach band just above the water (absolute units, so flat maps stay green)
    const sandH = Math.max(0.12, height * 0.035);
    const isSand = water !== null && y - water < sandH * (1 + jitterN * 6);
    const tt = Math.min(1, Math.max(0, t));
    const idx = isSand ? 0 : 1 + Math.pow(tt, 1.5) * (pal - 2);
    ramp(palette, idx / (pal - 1), out);
    // steep → rock (second to last colour), except on the snow band
    const steep = smoothstep(0.5, 0.85, slope);
    if (steep > 0 && t < 0.9) out.lerp(palette[Math.max(1, pal - 2)]!, steep * 0.8);
    // snow cap above snowLine (last colour); the steepest faces stay rocky
    if (snowLine < 1 && pal >= 3 && t > snowLine - 0.04) {
      const k = smoothstep(snowLine - 0.04, snowLine + 0.04, t) * (1 - smoothstep(0.75, 1.1, slope) * 0.7);
      out.lerp(palette[pal - 1]!, k);
    }
    return out;
  };

  const geometry = new THREE.BufferGeometry();
  const tris = res * res * 2;
  if (lowpoly) {
    const pos = new Float32Array(tris * 9);
    const col = new Float32Array(tris * 9);
    const c = new THREE.Color();
    let k = 0;
    const a = new THREE.Vector3(), b = new THREE.Vector3(), d = new THREE.Vector3(), nrm = new THREE.Vector3();
    const pushTri = (i0: number, j0: number, i1: number, j1: number, i2: number, j2: number): void => {
      const x0 = -size / 2 + i0 * step, z0 = -size / 2 + j0 * step, y0 = H(i0, j0);
      const x1 = -size / 2 + i1 * step, z1 = -size / 2 + j1 * step, y1 = H(i1, j1);
      const x2 = -size / 2 + i2 * step, z2 = -size / 2 + j2 * step, y2 = H(i2, j2);
      a.set(x1 - x0, y1 - y0, z1 - z0);
      b.set(x2 - x0, y2 - y0, z2 - z0);
      nrm.crossVectors(b, a).normalize();
      const slope = 1 - Math.abs(nrm.y);
      d.set((x0 + x1 + x2) / 3, (y0 + y1 + y2) / 3, (z0 + z1 + z2) / 3);
      colorAt(d.x, d.y, d.z, slope * 1.6, c);
      pos.set([x0, y0, z0, x1, y1, z1, x2, y2, z2], k);
      col.set([c.r, c.g, c.b, c.r, c.g, c.b, c.r, c.g, c.b], k);
      k += 9;
    };
    for (let j = 0; j < res; j++)
      for (let i = 0; i < res; i++) {
        // Alternate the diagonal for a less regular faceted look.
        if ((i + j) % 2 === 0) {
          pushTri(i, j, i, j + 1, i + 1, j + 1);
          pushTri(i, j, i + 1, j + 1, i + 1, j);
        } else {
          pushTri(i, j, i, j + 1, i + 1, j);
          pushTri(i + 1, j, i, j + 1, i + 1, j + 1);
        }
      }
    geometry.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    geometry.setAttribute("color", new THREE.BufferAttribute(col, 3));
    geometry.computeVertexNormals();
  } else {
    const pos = new Float32Array(n * n * 3);
    const col = new Float32Array(n * n * 3);
    const c = new THREE.Color();
    for (let j = 0; j < n; j++)
      for (let i = 0; i < n; i++) {
        const x = -size / 2 + i * step, z = -size / 2 + j * step, y = H(i, j);
        const dx = (H(i + 1, j) - H(i - 1, j)) / (2 * step);
        const dz = (H(i, j + 1) - H(i, j - 1)) / (2 * step);
        const slope = 1 - 1 / Math.sqrt(1 + dx * dx + dz * dz);
        colorAt(x, y, z, slope * 1.6, c);
        pos.set([x, y, z], (j * n + i) * 3);
        col.set([c.r, c.g, c.b], (j * n + i) * 3);
      }
    const index: number[] = [];
    for (let j = 0; j < res; j++)
      for (let i = 0; i < res; i++) {
        const a = j * n + i, b = a + 1, cc = a + n, d = cc + 1;
        if ((i + j) % 2 === 0) index.push(a, cc, d, a, d, b);
        else index.push(a, cc, b, b, cc, d);
      }
    geometry.setIndex(index);
    geometry.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    geometry.setAttribute("color", new THREE.BufferAttribute(col, 3));
    geometry.computeVertexNormals();
  }
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();

  const group = new THREE.Group();
  group.name = "terrain";
  const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: lowpoly, roughness: 0.95, metalness: 0 }));
  mesh.userData.materialTarget = true; // object.material override
  mesh.name = "terrain-ground";
  mesh.receiveShadow = true;
  mesh.castShadow = true;
  group.add(mesh);

  let waterUniforms: { uTime: { value: number } } | null = null;
  if (water !== null && water > Math.min(...heights) - 1e-3) {
    const wres = lowpoly ? 40 : Math.min(160, Math.max(48, res));
    const wg = new THREE.PlaneGeometry(size, size, wres, wres);
    wg.rotateX(-Math.PI / 2);
    // Depth below each water vertex from the terrain heights (shore foam, depth colour).
    bakeDepth(wg, water, (x, z) => heightAtFn(x, z));
    const wc = p.color("waterColor");
    const { material: wmat, uniforms } = createWaterMaterial({
      deep: wc.clone().multiplyScalar(0.55),
      shallow: wc.clone().lerp(new THREE.Color("#bff3ff"), 0.25),
      foam: new THREE.Color("#ffffff"),
      opacity: 0.88,
      waveHeight: Math.min(0.05, height * 0.006 + 0.015),
      waveSpeed: 1.2,
      foamWidth: Math.max(0.05, Math.min(0.25, height * 0.012)),
      ripples: 1,
      flat: lowpoly,
      depthRange: Math.max(0.3, height * 0.2),
    });
    waterUniforms = uniforms;
    const wm = new THREE.Mesh(wg, wmat);
    wm.name = "terrain-water";
    wm.position.y = water;
    wm.receiveShadow = true;
    wm.renderOrder = 1;
    group.add(wm);
  }
  group.userData.waterLevel = water;
  group.userData.surface = "terrain";
  group.userData.size = size;

  // Exact height on the triangulated surface (matches the faceted mesh).
  function heightAtFn(x: number, z: number): number {
    const fx = (x + size / 2) / step;
    const fz = (z + size / 2) / step;
    const i = Math.min(res - 1, Math.max(0, Math.floor(fx)));
    const j = Math.min(res - 1, Math.max(0, Math.floor(fz)));
    const u = Math.min(1, Math.max(0, fx - i));
    const v = Math.min(1, Math.max(0, fz - j));
    const h00 = H(i, j), h10 = H(i + 1, j), h01v = H(i, j + 1), h11 = H(i + 1, j + 1);
    if ((i + j) % 2 === 0) {
      // diagonal (i,j)-(i+1,j+1)
      return u > v ? h00 + (h11 - h10) * v + (h10 - h00) * u : h00 + (h11 - h01v) * u + (h01v - h00) * v;
    }
    // diagonal (i+1,j)-(i,j+1)
    return u + v < 1 ? h00 + (h10 - h00) * u + (h01v - h00) * v : h11 + (h01v - h11) * (1 - u) + (h10 - h11) * (1 - v);
  }
  const heightAt = heightAtFn;

  const update = waterUniforms
    ? (t: number) => {
        waterUniforms!.uTime.value = t;
      }
    : undefined;

  return built(group, { heightAt, update });
};
