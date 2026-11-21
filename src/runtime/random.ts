// Seeded PRNG + simplex noise shared by every procedural piece of the runtime
// (generators, particles, behaviours). Everything here is deterministic: same
// seed → same numbers on every machine (pure 32-bit integer maths + doubles).

import type { Rng } from "./registry";

// sfc32 seeded through splitmix32: fast, good statistical quality, tiny.
export function createRng(seed: number): Rng {
  let s = (Math.floor(seed) | 0) ^ 0x9e3779b9;
  const split = (): number => {
    s = (s + 0x9e3779b9) | 0;
    let z = s;
    z = Math.imul(z ^ (z >>> 16), 0x85ebca6b);
    z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35);
    return (z ^ (z >>> 16)) >>> 0;
  };
  let a = split();
  let b = split();
  let c = split();
  let d = split();
  const next = (): number => {
    a >>>= 0;
    b >>>= 0;
    c >>>= 0;
    d >>>= 0;
    const t = (((a + b) | 0) + d) | 0;
    d = (d + 1) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    c = (c + t) | 0;
    return (t >>> 0) / 4294967296;
  };
  for (let i = 0; i < 12; i++) next();
  return {
    next,
    range: (min, max) => min + (max - min) * next(),
    int: (min, maxInclusive) => min + Math.floor(next() * (maxInclusive - min + 1)),
    pick: <T>(items: readonly T[]): T => items[Math.floor(next() * items.length)] as T,
  };
}

// Derive a stable sub-seed from a seed and a string (e.g. object id).
export function hashSeed(seed: number, salt: string): number {
  let h = (seed | 0) ^ 0x811c9dc5;
  for (let i = 0; i < salt.length; i++) {
    h ^= salt.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

// ─── Simplex noise (Gustavson), fixed permutation ─────────────────────────

const PERM = new Uint8Array(512);
const PERM12 = new Uint8Array(512);
{
  const p = new Uint8Array(256);
  for (let i = 0; i < 256; i++) p[i] = i;
  const r = createRng(1337);
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(r.next() * (i + 1));
    const t = p[i]!;
    p[i] = p[j]!;
    p[j] = t;
  }
  for (let i = 0; i < 512; i++) {
    PERM[i] = p[i & 255]!;
    PERM12[i] = PERM[i]! % 12;
  }
}

const G3 = new Float32Array([1, 1, 0, -1, 1, 0, 1, -1, 0, -1, -1, 0, 1, 0, 1, -1, 0, 1, 1, 0, -1, -1, 0, -1, 0, 1, 1, 0, -1, 1, 0, 1, -1, 0, -1, -1]);

const F2 = 0.5 * (Math.sqrt(3) - 1);
const G2 = (3 - Math.sqrt(3)) / 6;

// 2D simplex noise in [-1, 1].
export function noise2D(xin: number, yin: number): number {
  const s = (xin + yin) * F2;
  const i = Math.floor(xin + s);
  const j = Math.floor(yin + s);
  const t = (i + j) * G2;
  const x0 = xin - (i - t);
  const y0 = yin - (j - t);
  const i1 = x0 > y0 ? 1 : 0;
  const j1 = x0 > y0 ? 0 : 1;
  const x1 = x0 - i1 + G2;
  const y1 = y0 - j1 + G2;
  const x2 = x0 - 1 + 2 * G2;
  const y2 = y0 - 1 + 2 * G2;
  const ii = i & 255;
  const jj = j & 255;
  let n = 0;
  let t0 = 0.5 - x0 * x0 - y0 * y0;
  if (t0 > 0) {
    const g = PERM12[ii + PERM[jj]!]! * 3;
    t0 *= t0;
    n += t0 * t0 * (G3[g]! * x0 + G3[g + 1]! * y0);
  }
  let t1 = 0.5 - x1 * x1 - y1 * y1;
  if (t1 > 0) {
    const g = PERM12[ii + i1 + PERM[jj + j1]!]! * 3;
    t1 *= t1;
    n += t1 * t1 * (G3[g]! * x1 + G3[g + 1]! * y1);
  }
  let t2 = 0.5 - x2 * x2 - y2 * y2;
  if (t2 > 0) {
    const g = PERM12[ii + 1 + PERM[jj + 1]!]! * 3;
    t2 *= t2;
    n += t2 * t2 * (G3[g]! * x2 + G3[g + 1]! * y2);
  }
  return 70 * n;
}

const F3 = 1 / 3;
const G3C = 1 / 6;

// 3D simplex noise in [-1, 1].
export function noise3D(xin: number, yin: number, zin: number): number {
  const s = (xin + yin + zin) * F3;
  const i = Math.floor(xin + s);
  const j = Math.floor(yin + s);
  const k = Math.floor(zin + s);
  const t = (i + j + k) * G3C;
  const x0 = xin - (i - t);
  const y0 = yin - (j - t);
  const z0 = zin - (k - t);
  let i1: number, j1: number, k1: number, i2: number, j2: number, k2: number;
  if (x0 >= y0) {
    if (y0 >= z0) [i1, j1, k1, i2, j2, k2] = [1, 0, 0, 1, 1, 0];
    else if (x0 >= z0) [i1, j1, k1, i2, j2, k2] = [1, 0, 0, 1, 0, 1];
    else [i1, j1, k1, i2, j2, k2] = [0, 0, 1, 1, 0, 1];
  } else {
    if (y0 < z0) [i1, j1, k1, i2, j2, k2] = [0, 0, 1, 0, 1, 1];
    else if (x0 < z0) [i1, j1, k1, i2, j2, k2] = [0, 1, 0, 0, 1, 1];
    else [i1, j1, k1, i2, j2, k2] = [0, 1, 0, 1, 1, 0];
  }
  const x1 = x0 - i1 + G3C, y1 = y0 - j1 + G3C, z1 = z0 - k1 + G3C;
  const x2 = x0 - i2 + 2 * G3C, y2 = y0 - j2 + 2 * G3C, z2 = z0 - k2 + 2 * G3C;
  const x3 = x0 - 1 + 3 * G3C, y3 = y0 - 1 + 3 * G3C, z3 = z0 - 1 + 3 * G3C;
  const ii = i & 255, jj = j & 255, kk = k & 255;
  let n = 0;
  const corner = (x: number, y: number, z: number, gi: number): void => {
    let tt = 0.6 - x * x - y * y - z * z;
    if (tt > 0) {
      const g = gi * 3;
      tt *= tt;
      n += tt * tt * (G3[g]! * x + G3[g + 1]! * y + G3[g + 2]! * z);
    }
  };
  corner(x0, y0, z0, PERM12[ii + PERM[jj + PERM[kk]!]!]!);
  corner(x1, y1, z1, PERM12[ii + i1 + PERM[jj + j1 + PERM[kk + k1]!]!]!);
  corner(x2, y2, z2, PERM12[ii + i2 + PERM[jj + j2 + PERM[kk + k2]!]!]!);
  corner(x3, y3, z3, PERM12[ii + 1 + PERM[jj + 1 + PERM[kk + 1]!]!]!);
  return 32 * n;
}

// Fractal Brownian motion, normalised to roughly [-1, 1].
export function fbm2D(x: number, y: number, octaves: number, lacunarity = 2, gain = 0.5): number {
  let sum = 0;
  let amp = 1;
  let freq = 1;
  let norm = 0;
  for (let o = 0; o < octaves; o++) {
    sum += amp * noise2D(x * freq + o * 17.31, y * freq - o * 9.17);
    norm += amp;
    amp *= gain;
    freq *= lacunarity;
  }
  return norm > 0 ? sum / norm : 0;
}

export function fbm3D(x: number, y: number, z: number, octaves: number, lacunarity = 2, gain = 0.5): number {
  let sum = 0;
  let amp = 1;
  let freq = 1;
  let norm = 0;
  for (let o = 0; o < octaves; o++) {
    sum += amp * noise3D(x * freq + o * 17.31, y * freq - o * 9.17, z * freq + o * 3.7);
    norm += amp;
    amp *= gain;
    freq *= lacunarity;
  }
  return norm > 0 ? sum / norm : 0;
}

// Ridged multifractal (sharp crests: mountains, dunes) in [0, 1].
export function ridged2D(x: number, y: number, octaves: number, lacunarity = 2, gain = 0.5): number {
  let sum = 0;
  let amp = 1;
  let freq = 1;
  let norm = 0;
  for (let o = 0; o < octaves; o++) {
    const v = 1 - Math.abs(noise2D(x * freq + o * 31.7, y * freq + o * 11.3));
    sum += amp * v * v;
    norm += amp;
    amp *= gain;
    freq *= lacunarity;
  }
  return norm > 0 ? sum / norm : 0;
}
