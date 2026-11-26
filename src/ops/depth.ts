// Depth maps for "3D photos" (photo objects, `depth`): authoring-time
// monocular depth estimation with Depth Anything V2 Small.
//
// Pure engine code (no DOM, no Node): the model descriptor, the input sizing,
// the post-processing of the raw model output into a depth PNG (near = white,
// alpha 0 on depth discontinuities), the one-time model download (injected
// fetch + a ModelCache the host implements over its disk) and the
// `estimateDepth` op. The inference itself runs in the host through an
// injected DepthEstimator (CLI / MCP: onnxruntime-web in headless Chrome,
// agent/render/depth.ts) — like the ImageCodec of optimize.ts.
//
// Nothing here runs at website run time: the exported scene only ships the
// PNG this op writes.

import type { ProjectFs } from "../core/fs";
import { normalizePath } from "../core/fs";
import { findLibraryAsset, isLibraryRef, libraryId, type LibraryProvider } from "../core/library";
import type { AssetEntry } from "../core/types";
import { addAsset, readAssetManifest } from "./assets";
import { OpsError } from "./context";
import { imageHeader } from "./optimizeSizing";
import { encodePng, type DeflateZlib } from "./pngEncode";
import type { FetchLike } from "./sources";

// ─── The model ───────────────────────────────────────────────────────────

export interface DepthModel {
  id: string; // cache folder + asset `source`
  title: string;
  repo: string;
  file: string; // path inside the repo
  revision: string; // pinned commit
  url: string; // download URL (follows a redirect to the CDN; no token)
  bytes: number;
  sha256: string;
  license: string;
  author: string;
  pageUrl: string;
  attribution: string;
  // Model input: multiples of `multipleOf`, long side `defaultSize`.
  defaultSize: number;
  multipleOf: number;
  mean: [number, number, number];
  std: [number, number, number];
  inputName: string;
  outputName: string;
}

const DA_REVISION = "4472b7362082ad9968fee890ca0f1e5aca36b93d";

export const DEPTH_MODEL: DepthModel = {
  id: "depth-anything-v2-small",
  title: "Depth Anything V2 Small (ONNX, quantized)",
  repo: "onnx-community/depth-anything-v2-small",
  file: "onnx/model_quantized.onnx",
  revision: DA_REVISION,
  url: `https://huggingface.co/onnx-community/depth-anything-v2-small/resolve/${DA_REVISION}/onnx/model_quantized.onnx`,
  bytes: 27_258_801,
  sha256: "fcf51f1b230362b28690bb9d1809bf0431f29cad20534e3f589bd7285547f20d",
  license: "Apache-2.0",
  author: "Depth Anything V2 (Yang et al.)",
  pageUrl: "https://huggingface.co/onnx-community/depth-anything-v2-small",
  attribution: "Depth Anything V2 Small by Lihe Yang, Bingyi Kang, Zilong Huang, Zhen Zhao, Xiaogang Xu, Jiashi Feng, Hengshuang Zhao (https://github.com/DepthAnything/Depth-Anything-V2), licensed under Apache-2.0.",
  defaultSize: 518,
  multipleOf: 14,
  mean: [0.485, 0.456, 0.406],
  std: [0.229, 0.224, 0.225],
  inputName: "pixel_values",
  outputName: "predicted_depth",
};

export const DEPTH_MODEL_FILE = "model_quantized.onnx";

// Folder of the model inside the user's model cache: <id>/<revision>/.
export function depthModelDir(model: DepthModel = DEPTH_MODEL): string {
  return `${model.id}/${model.revision}`;
}

// ─── Input sizing ────────────────────────────────────────────────────────

export const DEPTH_SIZE_MIN = 140;
export const DEPTH_SIZE_MAX = 1036;

// Model input size for an image: the long side becomes `size` (default 518),
// the aspect is kept and both sides are rounded to a multiple of 14 (at least 14).
export function planDepthInput(width: number, height: number, opts: { size?: number; model?: DepthModel } = {}): { width: number; height: number; size: number } {
  const model = opts.model ?? DEPTH_MODEL;
  const m = model.multipleOf;
  if (!(width > 0 && height > 0)) throw new OpsError("invalid", `Invalid image size ${width}x${height}.`);
  const req = opts.size ?? model.defaultSize;
  if (!Number.isFinite(req) || req < DEPTH_SIZE_MIN || req > DEPTH_SIZE_MAX) throw new OpsError("invalid", `size must be between ${DEPTH_SIZE_MIN} and ${DEPTH_SIZE_MAX} (got ${req}).`, `Use the default ${model.defaultSize} (fast, enough for web photos), or up to 1036 for finer edges (≈ 4× slower).`);
  const long = Math.max(m, Math.round(req / m) * m);
  const scale = long / Math.max(width, height);
  const round = (v: number) => Math.max(m, Math.round((v * scale) / m) * m);
  return width >= height ? { width: long, height: round(height), size: long } : { width: round(width), height: long, size: long };
}

// ─── Post-processing ─────────────────────────────────────────────────────

export interface DepthPostOptions {
  // Output size (default: the raw size). Bilinear upsampling.
  width?: number;
  height?: number;
  // Robust range: these percentiles of the raw values map to 0 and 1 (default 0.01 / 0.99).
  lowPercentile?: number;
  highPercentile?: number;
  // Edge-aware (bilateral) smoothing passes on the model grid (default 1; 0 = off).
  smooth?: number;
  // Foreground dilation radius in model pixels (default 1; 0 = off): near
  // regions grow slightly over their edges so the silhouette keeps the colour
  // of the foreground when the view moves.
  dilate?: number;
  // Discontinuity mask: alpha 0 where the local depth difference (0..1) is
  // above this (default 0.08; 0 = off, opaque map).
  edgeThreshold?: number;
}

export interface DepthMap {
  data: Uint8Array; // RGBA, width * height * 4: R = G = B = depth (0 far .. 255 near), A = 0 on discontinuities
  width: number;
  height: number;
  range: { low: number; high: number }; // raw values mapped to 0 and 1
  edgePixels: number; // pixels of the mask set to transparent (model grid)
}

function percentile(sorted: Float32Array, p: number): number {
  if (!sorted.length) return 0;
  const i = Math.min(sorted.length - 1, Math.max(0, Math.round(p * (sorted.length - 1))));
  return sorted[i];
}

// Raw model output (relative inverse depth, bigger = nearer) → normalised
// depth map at the requested size.
export function postprocessDepth(raw: Float32Array, w: number, h: number, opts: DepthPostOptions = {}): DepthMap {
  if (raw.length !== w * h || w < 1 || h < 1) throw new OpsError("invalid", `Depth output has ${raw.length} values, expected ${w}x${h}.`);
  const n = w * h;
  const finite = raw.filter((v) => Number.isFinite(v));
  finite.sort();
  const low = percentile(finite, opts.lowPercentile ?? 0.01);
  const high = percentile(finite, opts.highPercentile ?? 0.99);
  const span = high - low;
  let d: Float32Array<ArrayBuffer> = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const v = raw[i];
    d[i] = !Number.isFinite(v) ? 0 : span > 1e-12 ? Math.min(1, Math.max(0, (v - low) / span)) : 0.5;
  }

  // Edge-aware smoothing: 5×5 bilateral (spatial σ 1.5 px, range σ 0.06).
  const passes = Math.max(0, Math.round(opts.smooth ?? 1));
  const sr = 2 * 0.06 * 0.06;
  const spatial: number[] = [];
  for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) spatial.push(Math.exp(-(dx * dx + dy * dy) / (2 * 1.5 * 1.5)));
  for (let p = 0; p < passes; p++) {
    const o = new Float32Array(n);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const c = d[y * w + x];
        let sum = 0;
        let wsum = 0;
        let k = 0;
        for (let dy = -2; dy <= 2; dy++) {
          const yy = Math.min(h - 1, Math.max(0, y + dy));
          for (let dx = -2; dx <= 2; dx++, k++) {
            const xx = Math.min(w - 1, Math.max(0, x + dx));
            const v = d[yy * w + xx];
            const diff = v - c;
            const wt = spatial[k] * Math.exp(-(diff * diff) / sr);
            sum += v * wt;
            wsum += wt;
          }
        }
        o[y * w + x] = sum / wsum;
      }
    d = o;
  }

  // Foreground dilation: max filter (near = 1 grows).
  const r = Math.max(0, Math.round(opts.dilate ?? 1));
  if (r > 0) {
    const tmp = new Float32Array(n);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        let m = 0;
        for (let dx = -r; dx <= r; dx++) m = Math.max(m, d[y * w + Math.min(w - 1, Math.max(0, x + dx))]);
        tmp[y * w + x] = m;
      }
    const o = new Float32Array(n);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        let m = 0;
        for (let dy = -r; dy <= r; dy++) m = Math.max(m, tmp[Math.min(h - 1, Math.max(0, y + dy)) * w + x]);
        o[y * w + x] = m;
      }
    d = o;
  }

  // Discontinuity mask on the model grid: 0 where a neighbour differs by more than the threshold.
  const threshold = opts.edgeThreshold ?? 0.08;
  const mask = new Float32Array(n).fill(1);
  let edgePixels = 0;
  if (threshold > 0) {
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const c = d[y * w + x];
        let g = 0;
        for (let dy = -1; dy <= 1; dy++)
          for (let dx = -1; dx <= 1; dx++) {
            const xx = x + dx;
            const yy = y + dy;
            if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
            g = Math.max(g, Math.abs(d[yy * w + xx] - c));
          }
        if (g > threshold) {
          mask[y * w + x] = 0;
          edgePixels++;
        }
      }
  }

  const W = Math.max(1, Math.round(opts.width ?? w));
  const H = Math.max(1, Math.round(opts.height ?? h));
  const out = new Uint8Array(W * H * 4);
  const sxk = w / W;
  const syk = h / H;
  for (let y = 0; y < H; y++) {
    const fy = Math.min(h - 1, Math.max(0, (y + 0.5) * syk - 0.5));
    const y0 = Math.floor(fy);
    const y1 = Math.min(h - 1, y0 + 1);
    const ty = fy - y0;
    for (let x = 0; x < W; x++) {
      const fx = Math.min(w - 1, Math.max(0, (x + 0.5) * sxk - 0.5));
      const x0 = Math.floor(fx);
      const x1 = Math.min(w - 1, x0 + 1);
      const tx = fx - x0;
      const i00 = y0 * w + x0;
      const i01 = y0 * w + x1;
      const i10 = y1 * w + x0;
      const i11 = y1 * w + x1;
      const v = (d[i00] * (1 - tx) + d[i01] * tx) * (1 - ty) + (d[i10] * (1 - tx) + d[i11] * tx) * ty;
      const a = (mask[i00] * (1 - tx) + mask[i01] * tx) * (1 - ty) + (mask[i10] * (1 - tx) + mask[i11] * tx) * ty;
      const o = (y * W + x) * 4;
      const g = Math.round(v * 255);
      out[o] = g;
      out[o + 1] = g;
      out[o + 2] = g;
      out[o + 3] = Math.round(a * 255);
    }
  }
  return { data: out, width: W, height: H, range: { low, high }, edgePixels };
}

// ─── The estimator (host-provided) ───────────────────────────────────────

export interface DepthEstimatorInput {
  bytes: Uint8Array; // the encoded image (png / jpeg / webp)
  mimeType: string;
  width: number; // model input size (planDepthInput)
  height: number;
}

export interface DepthEstimatorOutput {
  depth: Float32Array; // raw model output, width * height (relative inverse depth: bigger = nearer)
  width: number;
  height: number;
  srcWidth: number; // decoded image size
  srcHeight: number;
  backend?: string; // e.g. "wasm (4 threads)"
}

export type DepthEstimator = (input: DepthEstimatorInput) => Promise<DepthEstimatorOutput>;

// ─── Model download + cache ──────────────────────────────────────────────

// The host's model cache (CLI: ~/.agent3d/models, AGENT3D_MODELS). Paths are
// relative to the cache root, "/"-separated.
export interface ModelCache {
  location(rel: string): string; // absolute path (for messages and the host)
  size(rel: string): Promise<number | null>; // null = missing
  write(rel: string, bytes: Uint8Array): Promise<void>; // atomic (temp + rename)
  writeText(rel: string, text: string): Promise<void>;
}

export function depthModelNotice(model: DepthModel = DEPTH_MODEL): string {
  return [
    `${model.title}`,
    `Source: ${model.pageUrl} (revision ${model.revision}, file ${model.file})`,
    `Licence: ${model.license}`,
    "",
    model.attribution,
    "",
    "Downloaded once by Agent3D (`agent3d assets depth`) to estimate depth maps at authoring time.",
    "The model is never shipped in exports: scenes only carry the depth PNG it produced.",
    "Apache License 2.0: https://www.apache.org/licenses/LICENSE-2.0",
    "",
  ].join("\n");
}

const DOWNLOAD_HINT = (model: DepthModel, dest: string) =>
  `Connect to the internet once (the model is ${Math.round(model.bytes / 1e6)} MB, downloaded once, no account), or download ${model.url} yourself to ${dest}. You can also paint or export a depth map by hand (grey PNG, white = near, same aspect as the photo) and set it as the photo object's \`depth\`.`;

async function sha256Hex(bytes: Uint8Array): Promise<string | null> {
  const subtle = (globalThis as { crypto?: { subtle?: { digest(a: string, d: BufferSource): Promise<ArrayBuffer> } } }).crypto?.subtle;
  if (!subtle) return null;
  const h = new Uint8Array(await subtle.digest("SHA-256", bytes as BufferSource));
  return Array.from(h, (b) => b.toString(16).padStart(2, "0")).join("");
}

export interface EnsuredModel {
  path: string; // absolute path of the .onnx file (cache.location)
  dir: string; // absolute folder (with LICENSE / NOTICE)
  downloaded: boolean;
  bytes: number;
}

// The model file in the cache: downloaded once (size + sha256 verified),
// with a NOTICE next to it. Offline and not cached → OpsError("io") with a hint.
export async function ensureDepthModel(cache: ModelCache, fetchImpl: FetchLike | undefined, opts: { model?: DepthModel; log?: (m: string) => void } = {}): Promise<EnsuredModel> {
  const model = opts.model ?? DEPTH_MODEL;
  const dir = depthModelDir(model);
  const rel = `${dir}/${DEPTH_MODEL_FILE}`;
  const have = await cache.size(rel);
  if (have === model.bytes) return { path: cache.location(rel), dir: cache.location(dir), downloaded: false, bytes: have };
  const dest = cache.location(rel);
  if (!fetchImpl) throw new OpsError("io", `The depth model is not downloaded yet (${dest}) and this host has no network access.`, DOWNLOAD_HINT(model, dest));
  opts.log?.(`[agent3d depth] downloading ${model.title} (${Math.round(model.bytes / 1e6)} MB, once) from ${model.url}`);
  let res;
  try {
    res = await fetchImpl(model.url);
  } catch (e) {
    throw new OpsError("io", `Could not download the depth model (offline?): ${(e as Error).message}`, DOWNLOAD_HINT(model, dest));
  }
  if (!res.ok) throw new OpsError("io", `Could not download the depth model: HTTP ${res.status} for ${model.url}.`, DOWNLOAD_HINT(model, dest));
  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(await res.arrayBuffer());
  } catch (e) {
    throw new OpsError("io", `The depth model download was interrupted: ${(e as Error).message}`, DOWNLOAD_HINT(model, dest));
  }
  if (bytes.byteLength !== model.bytes) throw new OpsError("io", `The downloaded depth model has ${bytes.byteLength} bytes, expected ${model.bytes} (truncated download or changed file).`, `Try again. ${DOWNLOAD_HINT(model, dest)}`);
  const sha = await sha256Hex(bytes);
  if (sha && sha !== model.sha256) throw new OpsError("io", `The downloaded depth model does not match its pinned checksum (sha256 ${sha}).`, `Try again later. Expected sha256 ${model.sha256} for ${model.url}.`);
  await cache.write(rel, bytes);
  await cache.writeText(`${dir}/NOTICE.txt`, depthModelNotice(model));
  await cache.writeText(`${dir}/LICENSE.txt`, `Licensed under the Apache License, Version 2.0 (${model.license}).\nFull text: https://www.apache.org/licenses/LICENSE-2.0\n\n${model.attribution}\n`);
  opts.log?.(`[agent3d depth] model saved to ${dest}`);
  return { path: dest, dir: cache.location(dir), downloaded: true, bytes: bytes.byteLength };
}

// ─── The op ──────────────────────────────────────────────────────────────

export interface EstimateDepthOptions {
  image: string; // project path or "library:<id>" (.png / .jpg / .webp)
  out?: string; // project path of the PNG (default assets/depth/<name>-depth.png)
  size?: number; // model input long side (default 518)
  maxSize?: number; // longest side of the written map (default: the image size, capped at 2048)
  smooth?: number;
  dilate?: number;
  edgeThreshold?: number;
  library?: LibraryProvider;
  deflate?: DeflateZlib;
}

export interface EstimateDepthResult {
  path: string;
  image: string;
  width: number;
  height: number;
  input: { width: number; height: number };
  ms: number; // inference time (decode + resize + model)
  kb: number;
  license: string;
  model: { id: string; revision: string; license: string; backend?: string };
  edgePixels: number;
  suggestion: { kind: "photo"; src: string; depth: string };
}

export const DEPTH_MAX_OUTPUT = 2048;

function depthOutPath(image: string): string {
  const base = image.replace(/^library:/, "").split("/").pop()!.replace(/\.[^.]+$/, "");
  const safe = base.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "image";
  return `assets/depth/${safe}-depth.png`;
}

async function readImage(fs: ProjectFs, image: string, library?: LibraryProvider): Promise<{ bytes: Uint8Array; entry?: Pick<AssetEntry, "license" | "author" | "attribution" | "sourceUrl"> }> {
  if (isLibraryRef(image)) {
    const id = libraryId(image);
    if (!library) throw new OpsError("invalid", `Library assets are not available in this host (${image}).`, "Copy the image into the project (assets add) and pass its project path.");
    const asset = findLibraryAsset(library.index, id);
    if (!asset) throw new OpsError("notFound", `No library asset "${id}".`, "List images with library_list { kind: \"texture\" } (CLI: agent3d assets library --kind texture).");
    return { bytes: await library.read(id), entry: { license: asset.license, author: asset.author, attribution: asset.attribution, sourceUrl: asset.sourceUrl } };
  }
  let path: string;
  try {
    path = normalizePath(image.replace(/^\.\//, ""));
  } catch {
    throw new OpsError("invalid", `Invalid image path "${image}".`, 'Use a project path, e.g. "assets/textures/photo.jpg".');
  }
  if (!(await fs.exists(path))) {
    const images = (await fs.list("assets/")).filter((f) => /\.(png|jpe?g|webp)$/i.test(f));
    throw new OpsError("notFound", `Image "${image}" not found in the project.`, images.length ? `Images in the project: ${images.slice(0, 8).join(", ")}${images.length > 8 ? ", …" : ""}.` : "Add the photo first: assets_add { file } (CLI: agent3d assets add <photo.jpg> --license …), then pass its project path.");
  }
  const manifest = await readAssetManifest(fs);
  const entry = manifest.assets.find((a) => a.path === path);
  return { bytes: await fs.readBytes(path), entry };
}

// Cheap pre-flight (no model, no browser): the image exists, is a PNG / JPEG /
// WebP, the size and output path are valid. Front doors call it before
// starting the estimator so mistakes fail fast.
export async function checkDepthRequest(fs: ProjectFs, opts: EstimateDepthOptions): Promise<{ out: string; width: number; height: number; input: { width: number; height: number } }> {
  if (!opts.image?.trim()) throw new OpsError("invalid", "Depth estimation needs an image.", 'Pass image: a project path ("assets/textures/photo.jpg") or "library:<id>".');
  const out = depthOutput(opts);
  const { bytes } = await readImage(fs, opts.image, opts.library);
  const header = imageHeader(bytes);
  if (!header) throw new OpsError("invalid", `"${opts.image}" is not a PNG, JPEG or WebP image.`, "Depth estimation reads .png, .jpg and .webp photos.");
  return { out, width: header.width, height: header.height, input: planDepthInput(header.width, header.height, { size: opts.size }) };
}

function depthOutput(opts: EstimateDepthOptions): string {
  let out = opts.out ?? depthOutPath(opts.image);
  try {
    out = normalizePath(out.replace(/^\.\//, ""));
  } catch {
    throw new OpsError("invalid", `Invalid output path "${opts.out}".`, 'Use e.g. "assets/depth/photo-depth.png".');
  }
  if (!out.startsWith("assets/") || !/\.png$/i.test(out)) throw new OpsError("invalid", `The depth map must be a .png under assets/ (got "${out}").`, `Use e.g. "${depthOutPath(opts.image)}".`);
  return out;
}

// Estimates a depth map for an image of the project (or the library) with
// the injected estimator, post-processes it and writes it as a PNG asset
// (manifest entry: source "depth-anything-v2-small", the image's licence).
export async function estimateDepth(fs: ProjectFs, opts: EstimateDepthOptions, estimator: DepthEstimator): Promise<EstimateDepthResult> {
  if (!opts.image?.trim()) throw new OpsError("invalid", "Depth estimation needs an image.", 'Pass image: a project path ("assets/textures/photo.jpg") or "library:<id>".');
  const out = depthOutput(opts);
  const { bytes, entry } = await readImage(fs, opts.image, opts.library);
  const header = imageHeader(bytes);
  if (!header) throw new OpsError("invalid", `"${opts.image}" is not a PNG, JPEG or WebP image.`, "Depth estimation reads .png, .jpg and .webp photos.");
  const input = planDepthInput(header.width, header.height, { size: opts.size });
  const t0 = Date.now();
  const r = await estimator({ bytes, mimeType: header.mimeType, width: input.width, height: input.height });
  const ms = Date.now() - t0;
  if (r.depth.length !== r.width * r.height) throw new OpsError("io", `The depth estimator returned ${r.depth.length} values for ${r.width}x${r.height}.`);
  const srcW = r.srcWidth || header.width;
  const srcH = r.srcHeight || header.height;
  const cap = Math.min(opts.maxSize ?? DEPTH_MAX_OUTPUT, Math.max(srcW, srcH));
  const k = cap / Math.max(srcW, srcH);
  const map = postprocessDepth(r.depth, r.width, r.height, { width: Math.max(1, Math.round(srcW * k)), height: Math.max(1, Math.round(srcH * k)), smooth: opts.smooth, dilate: opts.dilate, edgeThreshold: opts.edgeThreshold });
  const png = await encodePng(map.data, map.width, map.height, { deflate: opts.deflate });
  const license = entry?.license ?? "derived";
  const what = opts.image.split("/").pop();
  const credit = entry?.attribution ?? (entry?.author ? `"${what}" by ${entry.author}${entry.sourceUrl ? ` (${entry.sourceUrl})` : ""}, licensed under ${license}.` : "");
  const attribution = `Depth map of ${opts.image} estimated with Depth Anything V2 Small (Apache-2.0).${credit ? ` Image: ${credit}` : ""}`;
  const asset = await addAsset(fs, { path: out, bytes: png, kind: "texture", source: DEPTH_MODEL.id, license, author: entry?.author, sourceUrl: DEPTH_MODEL.pageUrl, attribution });
  return {
    path: asset.path,
    image: opts.image,
    width: map.width,
    height: map.height,
    input: { width: r.width, height: r.height },
    ms,
    kb: Math.round(png.byteLength / 102.4) / 10,
    license,
    model: { id: DEPTH_MODEL.id, revision: DEPTH_MODEL.revision, license: DEPTH_MODEL.license, ...(r.backend ? { backend: r.backend } : {}) },
    edgePixels: map.edgePixels,
    suggestion: { kind: "photo", src: opts.image, depth: asset.path },
  };
}
