// Background plates for 3D photos (photo objects, `plate` + `plateDepth`):
// the photo with the foreground removed next to its depth edges and filled
// with the background that continues behind it — the "layered depth" idea of
// Facebook 3D photos (Shih et al. 2020), without a learned inpainting model.
// When the view moves, the runtime shows the plate where the foreground
// uncovers what was behind it (parallax disocclusion, the mesh backing, the
// layers behind each slice) instead of stretching or smearing edge pixels.
//
// Pure engine code (no DOM, no Node): `buildPlate` works on RGBA pixels; the
// `generatePlate` op reads the photo through an injected pixel decoder (CLI /
// MCP: headless Chrome) and the depth PNG with the pure decoder, writes the
// plate (WebP through the host codec, else PNG) and its depth (grey PNG).
//
// Algorithm (all O(pixels), ≈ 0.2–0.6 s for a 1600 px photo in Node):
//   1. depth on the plate grid (bilinear), alpha < 0.5 = unknown (cut edge);
//   2. edges: unknown texels or a depth step > EDGE_STEP over 2 px;
//   3. hole = texels within `2 + width × jump` px of an edge whose depth is
//      at least MIN_JUMP above the far side of that edge (carried from the
//      nearest edge texel), i.e. the near side of each occluding edge, sized
//      by how far that jump
//      moves at the strongest view offset (+ a thin margin on the far side,
//      which holds the blended edge colours);
//   4. for each hole texel, the nearest texel of the far side only: a
//      depth-constrained Euclidean feature transform (raster passes) that
//      accepts a source only when it is clearly farther than the occluder
//      (never the foreground);
//   5. colour = the source mirrored across the edge (2·source − texel, which
//      keeps the background's texture instead of a blurred blob), falling
//      back towards the source when the mirror leaves the background; depth =
//      the source depth, smoothed inside the hole.

import type { ProjectFs } from "../core/fs";
import { normalizePath } from "../core/fs";
import { findLibraryAsset, isLibraryRef, libraryId, type LibraryProvider } from "../core/library";
import type { AssetEntry, PhotoObjectDef, SceneDoc } from "../core/types";
import { addAsset, readAssetManifest } from "./assets";
import { OpsError } from "./context";
import type { ImageCodec } from "./optimize";
import { imageHeader } from "./optimizeSizing";
import { decodePng, isPng, type RgbaImage } from "./pngDecode";
import { encodePng, type DeflateZlib } from "./pngEncode";
import { walkObjects } from "./tree";
import type { InflateRaw } from "./zip";

export type { RgbaImage } from "./pngDecode";

// ─── The pure plate builder ─────────────────────────────────────────────

export const PLATE_MIN_JUMP = 0.05; // depth jump (0..1) that counts as an occluding edge
const EDGE_STEP = 0.045; // depth change over 2 px that marks an edge texel
const EDGE_REACH = 6; // px around an edge texel searched for its near / far depths
const FAR_MARGIN = 2; // px of the far side next to an edge also rebuilt (blended colours)
const MIRROR_STEPS = [1, 0.75, 0.5, 0.25]; // mirror distance, then closer to the source

// Hole width (px) for a full near-to-far jump: the largest parallax shift at
// `strength` — the runtime moves a texel by (depth − focus) × strength × 6 %
// of the short side per axis at full view offset (parallaxParams; the mesh
// tilt gives about the same), × √2 for diagonal moves, + 15 % margin.
export function plateHoleWidth(width: number, height: number, strength = 1): number {
  const s = Math.min(1, Math.max(0, strength));
  return Math.max(2, Math.ceil(Math.min(width, height) * s * 0.06 * Math.SQRT2 * 1.15));
}

export interface BuildPlateOptions {
  // Hole width in plate pixels for a full (0 → 1) depth jump (default plateHoleWidth(strength)).
  width?: number;
  // Strongest photo `strength` the plate must cover (default 1).
  strength?: number;
}

export interface Plate {
  color: RgbaImage; // the plate (opaque)
  depth: RgbaImage; // its depth: grey, white = near, opaque
  holePixels: number; // texels rebuilt from the background
  unfilled: number; // hole texels with no background in reach (kept as is)
  // Per texel: 0 kept, 1 rebuilt (near side), 2 rebuilt (far-side margin), 3 hole left as is.
  mask: Uint8Array;
  width: number; // hole width used (px)
}

// Bilinear resample of one channel set to w × h (RGBA in, RGBA out).
function resample(img: RgbaImage, w: number, h: number): RgbaImage {
  if (img.width === w && img.height === h) return img;
  const out = new Uint8Array(w * h * 4);
  const sx = img.width / w, sy = img.height / h;
  const W = img.width, H = img.height, src = img.data;
  for (let y = 0; y < h; y++) {
    const fy = Math.min(H - 1, Math.max(0, (y + 0.5) * sy - 0.5));
    const y0 = Math.floor(fy), y1 = Math.min(H - 1, y0 + 1), ty = fy - y0;
    for (let x = 0; x < w; x++) {
      const fx = Math.min(W - 1, Math.max(0, (x + 0.5) * sx - 0.5));
      const x0 = Math.floor(fx), x1 = Math.min(W - 1, x0 + 1), tx = fx - x0;
      const a = (y0 * W + x0) * 4, b = (y0 * W + x1) * 4, c = (y1 * W + x0) * 4, d = (y1 * W + x1) * 4;
      const o = (y * w + x) * 4;
      for (let k = 0; k < 4; k++) out[o + k] = Math.round((src[a + k] * (1 - tx) + src[b + k] * tx) * (1 - ty) + (src[c + k] * (1 - tx) + src[d + k] * tx) * ty);
    }
  }
  return { data: out, width: w, height: h };
}

// Sliding-window min / max (van Herk / Gil-Werman, O(n) per pass) along rows
// then columns: radius r, `max` selects the operator.
function windowFilter(src: Float32Array, w: number, h: number, r: number, max: boolean): Float32Array {
  const pick = max ? Math.max : Math.min;
  const pass = (inp: Float32Array, len: number, count: number, step: number, lineStep: number): Float32Array => {
    const out = new Float32Array(inp.length);
    const k = 2 * r + 1;
    const g = new Float32Array(len + k), hh = new Float32Array(len + k);
    const line = new Float32Array(len + 2 * r);
    for (let l = 0; l < count; l++) {
      const base = l * lineStep;
      for (let i = 0; i < len + 2 * r; i++) line[i] = inp[base + Math.min(len - 1, Math.max(0, i - r)) * step];
      const n = len + 2 * r;
      for (let i = 0; i < n; i++) g[i] = i % k === 0 ? line[i] : pick(g[i - 1], line[i]);
      for (let i = n - 1; i >= 0; i--) hh[i] = i === n - 1 || (i + 1) % k === 0 ? line[i] : pick(hh[i + 1], line[i]);
      for (let i = 0; i < len; i++) out[base + i * step] = pick(hh[i], g[i + 2 * r]);
    }
    return out;
  };
  return pass(pass(src, w, h, 1, w), h, w, w, 1);
}

export function buildPlate(photo: RgbaImage, depthMap: RgbaImage, opts: BuildPlateOptions = {}): Plate {
  const w = photo.width, h = photo.height, n = w * h;
  if (photo.data.length !== n * 4) throw new OpsError("invalid", `Plate: photo has ${photo.data.length} bytes, expected ${n * 4}.`);
  const dm = resample(depthMap, w, h);
  const R = Math.max(2, Math.round(opts.width ?? plateHoleWidth(w, h, opts.strength ?? 1)));

  // 1. Depth (0..1) + known mask.
  const d = new Float32Array(n);
  const known = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    d[i] = dm.data[i * 4] / 255;
    known[i] = dm.data[i * 4 + 3] >= 128 ? 1 : 0;
  }
  // Local farthest / nearest known depth (unknown texels never win).
  const forMin = new Float32Array(n);
  const forMax = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    forMin[i] = known[i] ? d[i] : 2;
    forMax[i] = known[i] ? d[i] : -1;
  }
  const nearSmall = windowFilter(forMax, w, h, EDGE_REACH, true);
  const farSmall = windowFilter(forMin, w, h, EDGE_REACH, false);

  // 2. Edge texels → chamfer distance (3-4, ≈ px × 3) to the nearest edge.
  const INF = 1 << 29;
  const dist = new Int32Array(n).fill(INF);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      let edge = !known[i];
      if (!edge) {
        const c = d[i];
        if (x >= 2 && known[i - 2] && Math.abs(d[i - 2] - c) > EDGE_STEP) edge = true;
        else if (x < w - 2 && known[i + 2] && Math.abs(d[i + 2] - c) > EDGE_STEP) edge = true;
        else if (y >= 2 && known[i - 2 * w] && Math.abs(d[i - 2 * w] - c) > EDGE_STEP) edge = true;
        else if (y < h - 2 && known[i + 2 * w] && Math.abs(d[i + 2 * w] - c) > EDGE_STEP) edge = true;
      }
      if (edge) dist[i] = 0;
    }
  // Each texel also learns the far-side depth of its nearest edge (the
  // farthest known depth around that edge): the jump it would uncover.
  const edgeFar = new Float32Array(n);
  for (let i = 0; i < n; i++) if (dist[i] === 0) edgeFar[i] = farSmall[i];
  const relax = (i: number, q: number, cost: number) => {
    if (dist[q] + cost < dist[i]) {
      dist[i] = dist[q] + cost;
      edgeFar[i] = edgeFar[q];
    }
  };
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (x > 0) relax(i, i - 1, 3);
      if (y > 0) {
        relax(i, i - w, 3);
        if (x > 0) relax(i, i - w - 1, 4);
        if (x < w - 1) relax(i, i - w + 1, 4);
      }
    }
  for (let y = h - 1; y >= 0; y--)
    for (let x = w - 1; x >= 0; x--) {
      const i = y * w + x;
      if (x < w - 1) relax(i, i + 1, 3);
      if (y < h - 1) {
        relax(i, i + w, 3);
        if (x < w - 1) relax(i, i + w + 1, 4);
        if (x > 0) relax(i, i + w - 1, 4);
      }
    }

  // 3. Hole: the near side of occluding edges (+ unknown texels), with the
  // occluder depth each hole texel must see behind it.
  const hole = new Uint8Array(n);
  const occ = new Float32Array(n); // occluder depth
  const need = new Float32Array(n); // a source must be farther than this
  for (let i = 0; i < n; i++) {
    if (!known[i]) {
      const j = nearSmall[i] - farSmall[i];
      if (j > PLATE_MIN_JUMP) {
        hole[i] = 1;
        occ[i] = nearSmall[i];
        need[i] = nearSmall[i] - 0.5 * j;
      }
      continue;
    }
    const j = Math.min(1, d[i] - edgeFar[i]);
    if (dist[i] < INF && j > PLATE_MIN_JUMP && dist[i] <= 3 * (2 + R * j)) {
      hole[i] = 1;
      occ[i] = d[i];
      need[i] = d[i] - 0.5 * j;
    }
  }
  // Far-side margin: texels just outside the hole, on the far side, carry
  // the blended edge colour; rebuild them from one step further away.
  if (FAR_MARGIN > 0) {
    let ring = hole.slice();
    for (let pass = 0; pass < FAR_MARGIN; pass++) {
      const next = ring.slice();
      for (let y = 0; y < h; y++)
        for (let x = 0; x < w; x++) {
          const i = y * w + x;
          if (ring[i]) continue;
          const nb = (x > 0 && ring[i - 1]) || (x < w - 1 && ring[i + 1]) || (y > 0 && ring[i - w]) || (y < h - 1 && ring[i + w]);
          if (!nb) continue;
          // the occluder is the nearest hole neighbour
          let o = -1;
          if (x > 0 && ring[i - 1]) o = Math.max(o, occ[i - 1]);
          if (x < w - 1 && ring[i + 1]) o = Math.max(o, occ[i + 1]);
          if (y > 0 && ring[i - w]) o = Math.max(o, occ[i - w]);
          if (y < h - 1 && ring[i + w]) o = Math.max(o, occ[i + w]);
          if (o - d[i] <= PLATE_MIN_JUMP) continue;
          next[i] = 1;
          occ[i] = o;
          need[i] = d[i] + 0.25 * (o - d[i]);
        }
      for (let i = 0; i < n; i++) if (next[i] && !hole[i]) hole[i] = 2;
      ring = next;
    }
  }

  // 4. Depth-constrained nearest background texel (Euclidean feature transform).
  const src = new Int32Array(n).fill(-1);
  const sd2 = new Float64Array(n).fill(Infinity);
  for (let i = 0; i < n; i++)
    if (!hole[i] && known[i]) {
      src[i] = i;
      sd2[i] = 0;
    }
  const tryFrom = (i: number, x: number, y: number, q: number) => {
    const s = src[q];
    if (s < 0) return;
    if (d[s] >= need[i]) return;
    const dx = (s % w) - x, dy = ((s / w) | 0) - y;
    const v = dx * dx + dy * dy;
    if (v < sd2[i]) {
      sd2[i] = v;
      src[i] = s;
    }
  };
  for (let iter = 0; iter < 2; iter++) {
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        if (!hole[i]) continue;
        if (x > 0) tryFrom(i, x, y, i - 1);
        if (y > 0) {
          tryFrom(i, x, y, i - w);
          if (x > 0) tryFrom(i, x, y, i - w - 1);
          if (x < w - 1) tryFrom(i, x, y, i - w + 1);
        }
      }
      for (let x = w - 1; x >= 0; x--) {
        const i = y * w + x;
        if (hole[i] && x < w - 1) tryFrom(i, x, y, i + 1);
      }
    }
    for (let y = h - 1; y >= 0; y--) {
      for (let x = w - 1; x >= 0; x--) {
        const i = y * w + x;
        if (!hole[i]) continue;
        if (x < w - 1) tryFrom(i, x, y, i + 1);
        if (y < h - 1) {
          tryFrom(i, x, y, i + w);
          if (x < w - 1) tryFrom(i, x, y, i + w + 1);
          if (x > 0) tryFrom(i, x, y, i + w - 1);
        }
      }
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        if (hole[i] && x > 0) tryFrom(i, x, y, i - 1);
      }
    }
  }

  // 5. Fill: mirrored background colour, source depth.
  const color = new Uint8Array(n * 4);
  const pd = new Float32Array(n);
  const P = photo.data;
  let holePixels = 0, unfilled = 0;
  const okSource = (q: number, i: number, ref: number) => q >= 0 && !hole[q] && known[q] && d[q] < need[i] && Math.abs(d[q] - ref) < 0.5 * (occ[i] - ref) + 0.02;
  for (let i = 0; i < n; i++) {
    const o = i * 4;
    if (!hole[i] || src[i] < 0) {
      color[o] = P[o];
      color[o + 1] = P[o + 1];
      color[o + 2] = P[o + 2];
      color[o + 3] = 255;
      pd[i] = known[i] ? d[i] : nearSmall[i] >= 0 ? nearSmall[i] : 0;
      if (hole[i]) {
        unfilled++;
        hole[i] = 3;
      }
      continue;
    }
    holePixels++;
    const s = src[i];
    const x = i % w, y = (i / w) | 0;
    const sx = s % w, sy = (s / w) | 0;
    const ref = d[s];
    let pick = s;
    for (const t of MIRROR_STEPS) {
      const mx = Math.round(sx + t * (sx - x)), my = Math.round(sy + t * (sy - y));
      if (mx < 0 || my < 0 || mx >= w || my >= h) continue;
      const q = my * w + mx;
      if (okSource(q, i, ref)) {
        pick = q;
        break;
      }
    }
    const po = pick * 4;
    color[o] = P[po];
    color[o + 1] = P[po + 1];
    color[o + 2] = P[po + 2];
    color[o + 3] = 255;
    pd[i] = ref;
  }
  // Smooth the filled depth (2 box passes, hole texels only, hole neighbours only).
  for (let pass = 0; pass < 2; pass++) {
    const tmp = pd.slice();
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        if (!hole[i] || src[i] < 0) continue;
        let sum = 0, cnt = 0;
        for (let dy = -2; dy <= 2; dy++) {
          const yy = y + dy;
          if (yy < 0 || yy >= h) continue;
          for (let dx = -2; dx <= 2; dx++) {
            const xx = x + dx;
            if (xx < 0 || xx >= w) continue;
            const q = yy * w + xx;
            if (hole[q] && src[q] >= 0) {
              sum += tmp[q];
              cnt++;
            }
          }
        }
        pd[i] = sum / cnt;
      }
  }
  const depthOut = new Uint8Array(n * 4);
  for (let i = 0; i < n; i++) {
    const g = Math.round(Math.min(1, Math.max(0, pd[i])) * 255);
    const o = i * 4;
    depthOut[o] = depthOut[o + 1] = depthOut[o + 2] = g;
    depthOut[o + 3] = 255;
  }
  return { color: { data: color, width: w, height: h }, depth: { data: depthOut, width: w, height: h }, holePixels, unfilled, width: R, mask: hole };
}

// ─── The op ──────────────────────────────────────────────────────────────

// Host-provided pixel access (CLI / MCP: headless Chrome). `decode` returns
// straight RGBA at most `maxSize` px on the long side; `codec` (optional)
// re-encodes the plate PNG as WebP.
export interface PixelCodec {
  decode(input: { bytes: Uint8Array; mimeType: string; maxSize: number }): Promise<RgbaImage>;
  codec?: ImageCodec;
}

export interface PlateRequest {
  image: string; // project path or "library:<id>"
  depth?: string; // depth PNG (default: the depth of a photo object showing `image`, else assets/depth/<name>-depth.png)
  out?: string; // plate image (default assets/depth/<name>-plate.webp, .png without a WebP encoder)
  outDepth?: string; // plate depth PNG (default assets/depth/<name>-plate-depth.png)
  maxSize?: number; // long side of the plate (default: the photo size capped at 1024)
  width?: number; // hole width in plate pixels for a full depth jump
  strength?: number; // strongest photo strength to cover (default 1)
  quality?: number; // WebP quality (default 85)
  format?: "webp" | "png";
  library?: LibraryProvider;
  deflate?: DeflateZlib;
  inflate?: InflateRaw;
}

export interface PlateResult {
  path: string;
  depthPath: string;
  image: string;
  depth: string;
  width: number;
  height: number;
  holeWidth: number;
  holePixels: number;
  holePercent: number;
  unfilled: number;
  ms: number; // plate build time (decode excluded)
  kb: number;
  depthKb: number;
  suggestion: { plate: string; plateDepth: string };
}

export const PLATE_MAX_OUTPUT = 1024;

function baseName(image: string): string {
  const base = image.replace(/^library:/, "").split("/").pop()!.replace(/\.[^.]+$/, "");
  return base.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "image";
}

function projectPath(p: string, what: string, example: string): string {
  let out: string;
  try {
    out = normalizePath(p.replace(/^\.\//, ""));
  } catch {
    throw new OpsError("invalid", `Invalid ${what} path "${p}".`, `Use e.g. "${example}".`);
  }
  if (!out.startsWith("assets/")) throw new OpsError("invalid", `The ${what} must be under assets/ (got "${out}").`, `Use e.g. "${example}".`);
  return out;
}

async function readImage(fs: ProjectFs, image: string, library?: LibraryProvider): Promise<{ bytes: Uint8Array; entry?: Pick<AssetEntry, "license" | "author" | "attribution" | "sourceUrl"> }> {
  if (isLibraryRef(image)) {
    const id = libraryId(image);
    if (!library) throw new OpsError("invalid", `Library assets are not available in this host (${image}).`, "Copy the image into the project (assets add) and pass its project path.");
    const asset = findLibraryAsset(library.index, id);
    if (!asset) throw new OpsError("notFound", `No library asset "${id}".`, 'List images with library_list { kind: "texture" } (CLI: agent3d assets library --kind texture).');
    return { bytes: await library.read(id), entry: { license: asset.license, author: asset.author, attribution: asset.attribution, sourceUrl: asset.sourceUrl } };
  }
  const path = projectPath(image, "image", "assets/textures/photo.jpg");
  if (!(await fs.exists(path))) {
    const images = (await fs.list("assets/")).filter((f) => /\.(png|jpe?g|webp)$/i.test(f) && !/(-depth|-plate)\.\w+$/i.test(f));
    throw new OpsError("notFound", `Image "${image}" not found in the project.`, images.length ? `Images in the project: ${images.slice(0, 8).join(", ")}${images.length > 8 ? ", …" : ""}.` : "Add the photo first: assets_add { file } (CLI: agent3d assets add <photo.jpg> --license …).");
  }
  const manifest = await readAssetManifest(fs);
  return { bytes: await fs.readBytes(path), entry: manifest.assets.find((a) => a.path === path) };
}

async function sceneDepthFor(fs: ProjectFs, image: string): Promise<string | undefined> {
  if (!(await fs.exists("scene.json"))) return undefined;
  let scene: SceneDoc;
  try {
    scene = JSON.parse(await fs.readText("scene.json")) as SceneDoc;
  } catch {
    return undefined;
  }
  let found: string | undefined;
  walkObjects(scene.objects ?? [], (o) => {
    const p = o as PhotoObjectDef;
    if (!found && p.kind === "photo" && p.src === image && typeof p.depth === "string") found = p.depth;
  });
  return found;
}

export interface PlatePlan {
  image: string;
  depth: string;
  out: string;
  outDepth: string;
  width: number; // photo size
  height: number;
}

// Cheap pre-flight (no browser): the image and its depth map exist, the
// output paths are valid. Front doors call it before starting the decoder.
export async function checkPlateRequest(fs: ProjectFs, req: PlateRequest, opts: { webp?: boolean } = {}): Promise<PlatePlan> {
  if (!req.image?.trim()) throw new OpsError("invalid", "A plate needs an image.", 'Pass image: a project path ("assets/textures/photo.jpg") or "library:<id>".');
  const image = req.image.replace(/^\.\//, "");
  const name = baseName(image);
  const { bytes } = await readImage(fs, image, req.library);
  const header = imageHeader(bytes);
  if (!header) throw new OpsError("invalid", `"${image}" is not a PNG, JPEG or WebP image.`, "Plates are built from .png, .jpg and .webp photos.");
  const fallback = `assets/depth/${name}-depth.png`;
  let depth = req.depth ? projectPath(req.depth, "depth map", fallback) : await sceneDepthFor(fs, image);
  if (!depth && (await fs.exists(fallback))) depth = fallback;
  if (!depth || isLibraryRef(depth) || !(await fs.exists(depth)))
    throw new OpsError("notFound", depth ? `Depth map "${depth}" not found in the project.` : `No depth map for "${image}".`, `Estimate it first: \`agent3d assets depth ${image} --plate\` (depth map + plate in one go; AI tool: image_depth { image, plate: true }), or pass --depth <png>.`);
  if (!/\.png$/i.test(depth)) throw new OpsError("invalid", `The depth map must be a PNG (got "${depth}").`, `Regenerate it: \`agent3d assets depth ${image}\`.`);
  const ext = req.format === "png" || opts.webp === false ? "png" : "webp";
  const out = projectPath(req.out ?? `assets/depth/${name}-plate.${ext}`, "plate", `assets/depth/${name}-plate.${ext}`);
  if (!/\.(png|webp)$/i.test(out)) throw new OpsError("invalid", `The plate must be a .webp or .png (got "${out}").`, `Use e.g. "assets/depth/${name}-plate.webp".`);
  const outDepth = projectPath(req.outDepth ?? `assets/depth/${name}-plate-depth.png`, "plate depth", `assets/depth/${name}-plate-depth.png`);
  if (!/\.png$/i.test(outDepth)) throw new OpsError("invalid", `The plate depth must be a .png (got "${outDepth}").`, `Use e.g. "assets/depth/${name}-plate-depth.png".`);
  if (outDepth === out || out === depth || outDepth === depth) throw new OpsError("invalid", "The plate, its depth and the depth map need three different paths.");
  if (req.width !== undefined && !(req.width >= 2 && req.width <= 512)) throw new OpsError("invalid", `width must be between 2 and 512 px (got ${req.width}).`, "Omit it: the default follows the strongest parallax (strength 1).");
  if (req.strength !== undefined && !(req.strength > 0 && req.strength <= 1)) throw new OpsError("invalid", `strength must be in (0, 1] (got ${req.strength}).`);
  if (req.maxSize !== undefined && !(req.maxSize >= 64 && req.maxSize <= 4096)) throw new OpsError("invalid", `maxSize must be between 64 and 4096 (got ${req.maxSize}).`);
  return { image, depth, out, outDepth, width: header.width, height: header.height };
}

// Builds the background plate of a photo (and its depth) and writes both as
// assets (manifest: the photo's licence, source "agent3d-plate").
export async function generatePlate(fs: ProjectFs, req: PlateRequest, codec: PixelCodec): Promise<PlateResult> {
  const plan = await checkPlateRequest(fs, req, { webp: !!codec.codec });
  const { bytes, entry } = await readImage(fs, plan.image, req.library);
  const header = imageHeader(bytes)!;
  const maxSize = Math.min(req.maxSize ?? PLATE_MAX_OUTPUT, Math.max(header.width, header.height));
  const photo = isPng(bytes) && maxSize >= Math.max(header.width, header.height) ? await decodePng(bytes, { inflate: req.inflate }) : await codec.decode({ bytes, mimeType: header.mimeType, maxSize });
  const depthBytes = await fs.readBytes(plan.depth);
  let depth: RgbaImage;
  try {
    depth = await decodePng(depthBytes, { inflate: req.inflate });
  } catch {
    depth = await codec.decode({ bytes: depthBytes, mimeType: "image/png", maxSize: 8192 });
  }
  const t0 = Date.now();
  const plate = buildPlate(photo, depth, { width: req.width, strength: req.strength });
  const ms = Date.now() - t0;
  let colorBytes = await encodePng(plate.color.data, plate.color.width, plate.color.height, { channels: 3, deflate: req.deflate });
  if (/\.webp$/i.test(plan.out)) {
    if (!codec.codec) throw new OpsError("invalid", "This host cannot encode WebP.", "Pass format: \"png\" (or an out path ending in .png).");
    const r = await codec.codec({ bytes: colorBytes, mimeType: "image/png", maxSize: 1 << 14, quality: req.quality ?? 85, format: "webp" });
    colorBytes = r.bytes;
  }
  const depthPng = await encodePng(plate.depth.data, plate.depth.width, plate.depth.height, { channels: 1, deflate: req.deflate });
  const license = entry?.license ?? "derived";
  const what = plan.image.split("/").pop();
  const credit = entry?.attribution ?? (entry?.author ? `"${what}" by ${entry.author}${entry.sourceUrl ? ` (${entry.sourceUrl})` : ""}, licensed under ${license}.` : "");
  const attribution = `Background plate of ${plan.image} (foreground removed at depth edges) built by Agent3D.${credit ? ` Image: ${credit}` : ""}`;
  const a = await addAsset(fs, { path: plan.out, bytes: colorBytes, kind: "texture", source: "agent3d-plate", license, author: entry?.author, sourceUrl: entry?.sourceUrl, attribution });
  const b = await addAsset(fs, { path: plan.outDepth, bytes: depthPng, kind: "texture", source: "agent3d-plate", license, author: entry?.author, sourceUrl: entry?.sourceUrl, attribution: `Depth of the background plate of ${plan.image}.${credit ? ` Image: ${credit}` : ""}` });
  const kb = (n: number) => Math.round(n / 102.4) / 10;
  return {
    path: a.path,
    depthPath: b.path,
    image: plan.image,
    depth: plan.depth,
    width: plate.color.width,
    height: plate.color.height,
    holeWidth: plate.width,
    holePixels: plate.holePixels,
    holePercent: Math.round((plate.holePixels / (plate.color.width * plate.color.height)) * 1000) / 10,
    unfilled: plate.unfilled,
    ms,
    kb: kb(colorBytes.byteLength),
    depthKb: kb(depthPng.byteLength),
    suggestion: { plate: a.path, plateDepth: b.path },
  };
}
