// Procedural textures (catalog `textures`): `{ "procedural": "<id>", …params }`
// in any material texture slot. Pure JS (no DOM): every pattern is a periodic
// function of (u, v) in [0, 1)², so the textures tile seamlessly; seeded, so
// they are identical on every run. Colour slots get the `colors` ramp (sRGB),
// data slots (roughness, metalness, bump, ao, alpha…) the pattern height,
// normal slots a normal map derived from the height (or the pattern's own normals).

import * as THREE from "three";
import { TEXTURES } from "../../core/catalog";
import type { ProceduralTextureDef } from "../../core/types";
import { readParams, type Params } from "../generators/params";
import { createRng } from "../random";

export type TextureSlotKind = "color" | "data" | "normal";

export const TEXTURE_SLOTS: Record<string, TextureSlotKind> = {
  map: "color",
  emissiveMap: "color",
  normalMap: "normal",
  roughnessMap: "data",
  metalnessMap: "data",
  aoMap: "data",
  bumpMap: "data",
  displacementMap: "data",
  alphaMap: "data",
};

// ─── Periodic gradient noise ─────────────────────────────────────────────

class PeriodicNoise {
  private perm = new Uint16Array(512);
  private grads = new Float32Array(512);
  constructor(seed: number) {
    const rng = createRng(seed);
    const p = Array.from({ length: 256 }, (_, i) => i);
    for (let i = 255; i > 0; i--) {
      const j = Math.floor(rng.next() * (i + 1));
      [p[i], p[j]] = [p[j]!, p[i]!];
    }
    for (let i = 0; i < 512; i++) this.perm[i] = p[i & 255]!;
    for (let i = 0; i < 256; i++) {
      const a = rng.next() * Math.PI * 2;
      this.grads[i * 2] = Math.cos(a);
      this.grads[i * 2 + 1] = Math.sin(a);
    }
  }
  private g(ix: number, iy: number, px: number, py: number, dx: number, dy: number): number {
    const x = ((ix % px) + px) % px;
    const y = ((iy % py) + py) % py;
    const h = this.perm[(this.perm[x & 255]! + y) & 511]! & 255;
    return this.grads[h * 2]! * dx + this.grads[h * 2 + 1]! * dy;
  }
  // Noise in ~[-1, 1], periodic with period (px, py) lattice cells.
  noise(x: number, y: number, px: number, py: number): number {
    const ix = Math.floor(x), iy = Math.floor(y);
    const fx = x - ix, fy = y - iy;
    const ux = fx * fx * fx * (fx * (fx * 6 - 15) + 10);
    const uy = fy * fy * fy * (fy * (fy * 6 - 15) + 10);
    const a = this.g(ix, iy, px, py, fx, fy);
    const b = this.g(ix + 1, iy, px, py, fx - 1, fy);
    const c = this.g(ix, iy + 1, px, py, fx, fy - 1);
    const d = this.g(ix + 1, iy + 1, px, py, fx - 1, fy - 1);
    return (a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy) * 1.4;
  }
  // fbm over (u, v) in [0,1): base period p cells, doubling per octave.
  fbm(u: number, v: number, p: number, octaves: number, py = p): number {
    let s = 0, a = 0.5, norm = 0;
    let fx = p, fy = py;
    for (let o = 0; o < octaves; o++) {
      s += a * this.noise(u * fx, v * fy, fx, fy);
      norm += a;
      a *= 0.5;
      fx *= 2;
      fy *= 2;
    }
    return s / norm;
  }
}

const hash2 = (x: number, y: number, seed: number): number => {
  let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(seed | 0, 2246822519)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
};

const smooth = (e0: number, e1: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0 || 1e-6)));
  return t * t * (3 - 2 * t);
};
const fract = (x: number) => x - Math.floor(x);

// Periodic Voronoi over an n×n grid: F1, F2 distances (in cell units) and the nearest cell.
function voronoi(u: number, v: number, n: number, jitter: number, seed: number): { f1: number; f2: number; cx: number; cy: number } {
  const x = u * n, y = v * n;
  const ix = Math.floor(x), iy = Math.floor(y);
  let f1 = 9, f2 = 9, cx = 0, cy = 0;
  for (let j = -1; j <= 1; j++) {
    for (let i = -1; i <= 1; i++) {
      const gx = ix + i, gy = iy + j;
      const wx = ((gx % n) + n) % n, wy = ((gy % n) + n) % n;
      const px = gx + 0.5 + (hash2(wx, wy, seed) - 0.5) * jitter;
      const py = gy + 0.5 + (hash2(wx, wy, seed + 17) - 0.5) * jitter;
      const d = Math.hypot(px - x, py - y);
      if (d < f1) {
        f2 = f1;
        f1 = d;
        cx = wx;
        cy = wy;
      } else if (d < f2) f2 = d;
    }
  }
  return { f1, f2, cx, cy };
}

// ─── Patterns ────────────────────────────────────────────────────────────

interface Pattern {
  // Height / mask in [0, 1] (data slots, and the colour ramp position).
  h(u: number, v: number): number;
  // Optional explicit colour index into the palette (terrazzo chips) → [rampT, paletteIndex|-1].
  pick?(u: number, v: number): number;
  // Optional tangent-space normal (flakes).
  normal?(u: number, v: number, out: [number, number, number]): void;
}

type PatternFactory = (p: Params, nz: PeriodicNoise, seed: number, size: number) => Pattern;

const PATTERNS: Record<string, PatternFactory> = {
  marble(p, nz) {
    const s = p.num("scale");
    const P = Math.max(1, Math.round(2 * s));
    const sharp = 2 + p.num("veins") * 22;
    const turb = p.num("turbulence");
    return {
      h(u, v) {
        // Domain-warped fbm: long, branching, irregular veins.
        const wx = nz.fbm(u, v, P * 2, 5), wy = nz.fbm(u + 0.37, v + 0.71, P * 2, 5);
        const f = nz.fbm(u + wx * 0.12 * turb, v + wy * 0.12 * turb, P * 3, 6);
        const t = (u * 0.6 + v) * P + turb * 2.6 * f;
        const vein = Math.pow(1 - Math.abs(Math.sin(Math.PI * t)), sharp);
        const g = nz.fbm(u + 0.5, v, P * 6, 5);
        const fine = Math.pow(1 - Math.abs(Math.sin(Math.PI * (t * 2.3 + g * 3.0))), sharp * 2.5) * 0.45;
        const cloud = (nz.fbm(u, v + 0.3, P * 2, 4) * 0.5 + 0.5) * 0.18;
        return Math.min(1, vein * 0.9 + fine + cloud);
      },
    };
  },
  wood(p, nz) {
    const s = p.num("scale");
    const rings = p.num("rings");
    const grain = p.num("grain");
    const P = Math.max(1, Math.round(s));
    return {
      h(u, v) {
        const warp = nz.fbm(u, v, 2 * P, 4, 1 * P);
        const t = u * Math.round(rings * s) + warp * 1.8;
        const ring = fract(t);
        const band = smooth(0.0, 0.7, ring) * (1 - smooth(0.85, 1.0, ring));
        const fibre = nz.noise(u * 64 * P, v * 3 * P, 64 * P, 3 * P) * 0.5 + 0.5;
        return Math.min(1, Math.max(0, band * 0.75 + fibre * grain * 0.35 + (warp * 0.5 + 0.5) * 0.15));
      },
    };
  },
  terrazzo(p, nz, seed) {
    const n = Math.max(2, Math.round((10 * p.num("scale")) / p.num("chipSize")));
    const density = p.num("density");
    const nColors = Math.max(1, p.colors("colors").length - 1);
    const chip = (u: number, v: number) => {
      const c = voronoi(u, v, n, 1, seed);
      const r = hash2(c.cx, c.cy, seed + 5);
      if (r > density) return { m: 0, idx: -1 };
      const size = 0.18 + hash2(c.cx, c.cy, seed + 9) * 0.3;
      const edge = c.f1 + nz.noise(u * n * 4, v * n * 4, n * 4, n * 4) * 0.08;
      return { m: 1 - smooth(size - 0.03, size + 0.01, edge), idx: 1 + Math.floor(hash2(c.cx, c.cy, seed + 3) * nColors) };
    };
    return {
      h(u, v) {
        return chip(u, v).m;
      },
      pick(u, v) {
        const c = chip(u, v);
        return c.m > 0.5 ? c.idx : -1;
      },
    };
  },
  carbon(p, nz) {
    const n = Math.max(2, Math.round(8 * p.num("scale")));
    return {
      h(u, v) {
        const x = u * n, y = v * n;
        const ix = Math.floor(x), iy = Math.floor(y);
        const fx = x - ix, fy = y - iy;
        const horizontal = (((ix + iy) % 4) + 4) % 4 < 2;
        const across = horizontal ? fy : fx;
        const along = horizontal ? u : v;
        const tow = Math.sin(Math.PI * across);
        const fibres = nz.noise(along * n * 2, across * 40, n * 2, 40) * 0.5 + 0.5;
        const sheen = horizontal ? 0.85 : 0.45;
        return Math.min(1, tow * sheen * (0.75 + fibres * 0.25));
      },
    };
  },
  noise(p, nz) {
    const P = Math.max(1, Math.round(4 * p.num("scale")));
    const oct = p.int("octaves");
    const k = p.num("contrast");
    return { h: (u, v) => Math.min(1, Math.max(0, 0.5 + nz.fbm(u, v, P, oct) * 0.5 * k * 1.6)) };
  },
  voronoi(p, _nz, seed) {
    const n = Math.max(1, Math.round(8 * p.num("scale")));
    const j = p.num("jitter");
    return {
      h(u, v) {
        const c = voronoi(u, v, n, j, seed);
        return smooth(0.0, 0.25, c.f2 - c.f1);
      },
    };
  },
  flakes(p, _nz, seed) {
    const n = Math.max(4, Math.round(64 * p.num("scale")));
    const tilt = p.num("strength");
    return {
      h(u, v) {
        const x = Math.floor(u * n), y = Math.floor(v * n);
        return hash2(x, y, seed);
      },
      normal(u, v, out) {
        const c = voronoi(u, v, n, 1, seed);
        const a = hash2(c.cx, c.cy, seed + 1) * Math.PI * 2;
        const r = Math.sqrt(hash2(c.cx, c.cy, seed + 2)) * tilt;
        const x = Math.cos(a) * r, y = Math.sin(a) * r;
        out[0] = x;
        out[1] = y;
        out[2] = Math.sqrt(Math.max(0, 1 - x * x - y * y));
      },
    };
  },
  brushed(p, nz) {
    const P = Math.max(1, Math.round(p.num("scale")));
    const d = p.num("streaks");
    const rows = Math.max(8, Math.round(300 * d * P));
    return {
      h(u, v) {
        const a = nz.noise(u * 2 * P, v * rows, 2 * P, rows) * 0.5 + 0.5;
        const b = nz.noise(u * 6 * P, v * rows * 2.5, 6 * P, Math.round(rows * 2.5)) * 0.5 + 0.5;
        const c = nz.fbm(u, v, 3 * P, 3) * 0.5 + 0.5;
        return Math.min(1, Math.max(0, a * 0.5 + b * 0.3 + c * 0.2));
      },
    };
  },
  grid(p, _nz, _seed, size) {
    const cells = Math.max(1, Math.round(p.int("cells") * p.num("scale")));
    const px = cells / size; // one pixel in cell units (anti-aliasing, min line width)
    const hw = Math.max(p.num("lineWidth") * 0.5, px * 0.75);
    return {
      h(u, v) {
        const fx = fract(u * cells), fy = fract(v * cells);
        const d = Math.min(fx, 1 - fx, fy, 1 - fy);
        return 1 - smooth(hw - px * 0.5, hw + px * 0.5, d);
      },
    };
  },
  checker(p) {
    const cells = Math.max(1, Math.round(p.int("cells") * p.num("scale")));
    return { h: (u, v) => ((Math.floor(u * cells) + Math.floor(v * cells)) & 1 ? 1 : 0) };
  },
  stripes(p) {
    const count = Math.max(1, Math.round(p.int("count") * p.num("scale")));
    const a = (p.num("angle") * Math.PI) / 180;
    const kx = Math.round(Math.cos(a) * count), ky = Math.round(Math.sin(a) * count);
    const soft = Math.max(0.002, p.num("softness"));
    return {
      h(u, v) {
        // Triangle wave: equal-width bands with soft edges at t = 0.25 / 0.75.
        const tri = Math.abs(fract(u * kx + v * ky) - 0.5) * 2;
        return smooth(0.5 - soft * 2, 0.5 + soft * 2, tri);
      },
    };
  },
  dots(p) {
    const cells = Math.max(1, Math.round(p.int("cells") * p.num("scale")));
    const r = p.num("radius");
    return {
      h(u, v) {
        const fx = fract(u * cells) - 0.5, fy = fract(v * cells) - 0.5;
        return 1 - smooth(r - 0.02, r + 0.01, Math.hypot(fx, fy));
      },
    };
  },
};

export const PROCEDURAL_TEXTURE_IDS = Object.keys(PATTERNS);

// ─── Rasterisation ───────────────────────────────────────────────────────

const toSrgb8 = (c: number): number => {
  const v = c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
  return Math.max(0, Math.min(255, Math.round(v * 255)));
};

export interface ProceduralImage {
  data: Uint8Array; // RGBA8
  size: number;
}

const cache = new Map<string, ProceduralImage>();

function pow2(n: number): number {
  return 2 ** Math.round(Math.log2(Math.max(32, Math.min(2048, n))));
}

// Generates the RGBA pixels of a procedural texture for a slot kind (cached).
export function generateProceduralImage(def: ProceduralTextureDef, kind: TextureSlotKind): ProceduralImage {
  const key = kind + ":" + JSON.stringify(def);
  const hit = cache.get(key);
  if (hit) return hit;
  const entry = TEXTURES.find((t) => t.id === def.procedural);
  const factory = PATTERNS[def.procedural];
  if (!entry || !factory) throw new Error(`Unknown procedural texture "${def.procedural}"`);
  const p = readParams(entry, def as Record<string, unknown>);
  const seed = p.int("seed");
  const size = pow2(p.int("resolution"));
  const pattern = factory(p, new PeriodicNoise(seed), seed, size);
  const data = new Uint8Array(size * size * 4);
  const heights = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    const v = (y + 0.5) / size;
    for (let x = 0; x < size; x++) heights[y * size + x] = pattern.h((x + 0.5) / size, v);
  }
  if (kind === "color") {
    const cols = p.colors("colors").map((c) => [c.r, c.g, c.b] as const); // linear
    const n = cols.length;
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const i = y * size + x;
        let r: number, g: number, b: number;
        const idx = pattern.pick ? pattern.pick((x + 0.5) / size, (y + 0.5) / size) : -1;
        if (idx >= 0) [r, g, b] = cols[Math.min(idx, n - 1)]!;
        else if (pattern.pick) [r, g, b] = cols[0]!;
        else {
          const t = Math.min(1, Math.max(0, heights[i]!)) * (n - 1);
          const k = Math.min(n - 2, Math.floor(t));
          const f = n > 1 ? t - k : 0;
          const a = cols[Math.max(0, k)]!, c = cols[Math.min(n - 1, k + 1)]!;
          r = a[0] + (c[0] - a[0]) * f;
          g = a[1] + (c[1] - a[1]) * f;
          b = a[2] + (c[2] - a[2]) * f;
        }
        data[i * 4] = toSrgb8(r);
        data[i * 4 + 1] = toSrgb8(g);
        data[i * 4 + 2] = toSrgb8(b);
        data[i * 4 + 3] = 255;
      }
    }
  } else if (kind === "normal") {
    const nv: [number, number, number] = [0, 0, 1];
    const strength = 2 * (size / 256);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const i = y * size + x;
        let nx: number, ny: number, nzv: number;
        if (pattern.normal) {
          pattern.normal((x + 0.5) / size, (y + 0.5) / size, nv);
          [nx, ny, nzv] = nv;
        } else {
          const H = (xx: number, yy: number) => heights[((yy + size) % size) * size + ((xx + size) % size)]!;
          const dx = (H(x + 1, y - 1) + 2 * H(x + 1, y) + H(x + 1, y + 1) - H(x - 1, y - 1) - 2 * H(x - 1, y) - H(x - 1, y + 1)) / 8;
          const dy = (H(x - 1, y + 1) + 2 * H(x, y + 1) + H(x + 1, y + 1) - H(x - 1, y - 1) - 2 * H(x, y - 1) - H(x + 1, y - 1)) / 8;
          nx = -dx * strength;
          ny = -dy * strength;
          nzv = 1;
          const l = Math.hypot(nx, ny, nzv);
          nx /= l;
          ny /= l;
          nzv /= l;
        }
        data[i * 4] = Math.round((nx * 0.5 + 0.5) * 255);
        data[i * 4 + 1] = Math.round((ny * 0.5 + 0.5) * 255);
        data[i * 4 + 2] = Math.round((nzv * 0.5 + 0.5) * 255);
        data[i * 4 + 3] = 255;
      }
    }
  } else {
    for (let i = 0; i < size * size; i++) {
      const g = Math.round(Math.min(1, Math.max(0, heights[i]!)) * 255);
      data[i * 4] = data[i * 4 + 1] = data[i * 4 + 2] = g;
      data[i * 4 + 3] = 255;
    }
  }
  const img = { data, size };
  if (cache.size > 64) cache.clear();
  cache.set(key, img);
  return img;
}

export function createProceduralTexture(def: ProceduralTextureDef, kind: TextureSlotKind): THREE.DataTexture {
  const img = generateProceduralImage(def, kind);
  const tex = new THREE.DataTexture(img.data, img.size, img.size, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.colorSpace = kind === "color" ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = 4;
  tex.needsUpdate = true;
  tex.name = `procedural:${def.procedural}`;
  return tex;
}
