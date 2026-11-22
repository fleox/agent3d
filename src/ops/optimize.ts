// Shrink project textures: standalone .jpg / .png / .webp files and the
// images embedded in .glb models (rewritten inside the GLB binary chunk).
// Pure TS over ProjectFs: the actual decode / resize / encode is an
// injected ImageCodec (the CLI / MCP host uses headless Chrome's canvas).

import type { ProjectFs } from "../core/fs";
import { KB, OpsError } from "./context";
import { refreshAssetManifest } from "./assets";
import { ASSET_MANIFEST_FILE } from "./project";

export interface ImageCodecInput {
  bytes: Uint8Array;
  mimeType: string; // image/png | image/jpeg | image/webp
  maxSize: number; // longest side in pixels (never upscales)
  quality: number; // 1..100 (jpeg / webp)
  // The codec may switch an opaque PNG to JPEG (embedded GLB images only:
  // standalone files keep their format so scene paths stay valid).
  allowJpeg: boolean;
}

export interface ImageCodecOutput {
  bytes: Uint8Array;
  mimeType: string;
  width: number;
  height: number;
  srcWidth: number;
  srcHeight: number;
}

export type ImageCodec = (input: ImageCodecInput) => Promise<ImageCodecOutput>;

export interface OptimizeOptions {
  paths?: string[];
  all?: boolean;
  maxSize?: number; // default 1024
  quality?: number; // default 80
  dryRun?: boolean;
}

export interface OptimizedImage {
  name: string;
  from: string; // "2048x2048 image/png 3100 KB"
  to: string;
  replaced: boolean;
}

export interface OptimizedFile {
  path: string;
  beforeBytes: number;
  afterBytes: number;
  changed: boolean;
  images: OptimizedImage[];
  note?: string;
}

export interface OptimizeResult {
  files: OptimizedFile[];
  skipped: { path: string; reason: string }[];
  beforeKb: number;
  afterKb: number;
  savedKb: number;
  maxSize: number;
  quality: number;
}

export const DEFAULT_MAX_SIZE = 1024;
export const DEFAULT_QUALITY = 80;

const IMAGE_EXT: Record<string, string> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp" };
const ext = (p: string) => p.slice(p.lastIndexOf(".") + 1).toLowerCase();
const isOptimizable = (p: string) => !!IMAGE_EXT[ext(p)] || ext(p) === "glb";
const describe = (w: number, h: number, mime: string, bytes: number) => `${w}x${h} ${mime} ${KB(bytes)} KB`;

// The files `optimizeAssets` would touch (paths given, or every texture /
// .glb under assets/ with `all`).
export async function optimizeTargets(fs: ProjectFs, opts: Pick<OptimizeOptions, "paths" | "all">): Promise<{ targets: string[]; skipped: { path: string; reason: string }[] }> {
  const skipped: { path: string; reason: string }[] = [];
  if (opts.paths?.length) {
    const targets: string[] = [];
    for (const raw of opts.paths) {
      const p = raw.replace(/^\.\//, "");
      if (p.startsWith("library:")) {
        skipped.push({ path: p, reason: "Library assets are already optimised (and read-only)." });
        continue;
      }
      if (!(await fs.exists(p))) throw new OpsError("notFound", `No file "${p}" in the project.`, "List the project's assets with assets_list (CLI: agent3d assets list).");
      if (!isOptimizable(p)) {
        skipped.push({ path: p, reason: p.endsWith(".gltf") ? "A .gltf keeps its textures as separate files: optimise those image files instead." : "Not a .jpg / .png / .webp texture or a .glb model." });
        continue;
      }
      if (!targets.includes(p)) targets.push(p);
    }
    return { targets, skipped };
  }
  if (!opts.all) throw new OpsError("invalid", "Say which assets to optimise.", 'Pass paths (e.g. "assets/textures/wood/wood_diff_1k.jpg", "assets/models/fox.glb") or all: true (CLI: --all).');
  const files = (await fs.list("assets/")).filter((f) => f !== ASSET_MANIFEST_FILE);
  return { targets: files.filter(isOptimizable).sort(), skipped };
}

export async function optimizeAssets(fs: ProjectFs, opts: OptimizeOptions, codec: ImageCodec): Promise<OptimizeResult> {
  const maxSize = Math.round(opts.maxSize ?? DEFAULT_MAX_SIZE);
  const quality = Math.round(opts.quality ?? DEFAULT_QUALITY);
  if (!(maxSize >= 16 && maxSize <= 8192)) throw new OpsError("invalid", `maxSize must be between 16 and 8192 pixels (got ${opts.maxSize}).`, "Typical values: 512 (banners, small props), 1024 (heroes), 2048 (close-ups).");
  if (!(quality >= 1 && quality <= 100)) throw new OpsError("invalid", `quality must be between 1 and 100 (got ${opts.quality}).`, "80 is a good default for JPEG / WebP.");
  const { targets, skipped } = await optimizeTargets(fs, opts);
  const files: OptimizedFile[] = [];
  for (const path of targets) {
    const bytes = await fs.readBytes(path);
    try {
      const r = ext(path) === "glb" ? await optimizeGlb(bytes, { maxSize, quality }, codec) : await optimizeImage(bytes, IMAGE_EXT[ext(path)], { maxSize, quality }, codec);
      const changed = !!r.bytes && r.bytes.byteLength < bytes.byteLength;
      if (changed && !opts.dryRun) await fs.writeBytes(path, r.bytes!);
      files.push({ path, beforeBytes: bytes.byteLength, afterBytes: changed ? r.bytes!.byteLength : bytes.byteLength, changed, images: r.images, ...(r.note ? { note: r.note } : !changed ? { note: "Already small enough: kept as is." } : {}) });
    } catch (e) {
      skipped.push({ path, reason: (e as Error).message });
    }
  }
  if (!opts.dryRun && files.some((f) => f.changed)) await refreshAssetManifest(fs);
  const before = files.reduce((n, f) => n + f.beforeBytes, 0);
  const after = files.reduce((n, f) => n + f.afterBytes, 0);
  return { files, skipped, beforeKb: KB(before), afterKb: KB(after), savedKb: KB(before - after), maxSize, quality };
}

async function optimizeImage(bytes: Uint8Array, mimeType: string, o: { maxSize: number; quality: number }, codec: ImageCodec): Promise<{ bytes?: Uint8Array; images: OptimizedImage[]; note?: string }> {
  const out = await codec({ bytes, mimeType, maxSize: o.maxSize, quality: o.quality, allowJpeg: false });
  const replaced = out.bytes.byteLength < bytes.byteLength && out.mimeType === mimeType;
  return {
    bytes: replaced ? out.bytes : undefined,
    images: [{ name: "image", from: describe(out.srcWidth, out.srcHeight, mimeType, bytes.byteLength), to: describe(out.width, out.height, out.mimeType, out.bytes.byteLength), replaced }],
  };
}

// ─── GLB rewriting ──────────────────────────────────────────────────────

interface GlbParts {
  json: GltfDoc;
  bin: Uint8Array | null;
}

interface GltfDoc {
  buffers?: { byteLength: number; uri?: string }[];
  bufferViews?: { buffer: number; byteOffset?: number; byteLength: number; byteStride?: number; target?: number }[];
  images?: { bufferView?: number; mimeType?: string; uri?: string; name?: string }[];
  [k: string]: unknown;
}

const GLB_MAGIC = 0x46546c67;
const CHUNK_JSON = 0x4e4f534a;
const CHUNK_BIN = 0x004e4942;

export function readGlb(bytes: Uint8Array): GlbParts {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.byteLength < 20 || view.getUint32(0, true) !== GLB_MAGIC) throw new Error("Not a binary glTF (.glb) file.");
  let off = 12;
  let json: GltfDoc | null = null;
  let bin: Uint8Array | null = null;
  while (off + 8 <= bytes.byteLength) {
    const len = view.getUint32(off, true);
    const type = view.getUint32(off + 4, true);
    const data = bytes.subarray(off + 8, off + 8 + len);
    if (type === CHUNK_JSON) json = JSON.parse(new TextDecoder().decode(data)) as GltfDoc;
    else if (type === CHUNK_BIN && !bin) bin = data;
    off += 8 + len;
  }
  if (!json) throw new Error("The .glb has no JSON chunk.");
  return { json, bin };
}

export function writeGlb(json: unknown, bin: Uint8Array | null): Uint8Array {
  const enc = new TextEncoder().encode(JSON.stringify(json));
  const jsonLen = (enc.byteLength + 3) & ~3;
  const binLen = bin ? (bin.byteLength + 3) & ~3 : 0;
  const total = 12 + 8 + jsonLen + (bin ? 8 + binLen : 0);
  const out = new Uint8Array(total);
  const view = new DataView(out.buffer);
  view.setUint32(0, GLB_MAGIC, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, total, true);
  view.setUint32(12, jsonLen, true);
  view.setUint32(16, CHUNK_JSON, true);
  out.set(enc, 20);
  out.fill(0x20, 20 + enc.byteLength, 20 + jsonLen); // JSON padding = spaces
  if (bin) {
    const o = 20 + jsonLen;
    view.setUint32(o, binLen, true);
    view.setUint32(o + 4, CHUNK_BIN, true);
    out.set(bin, o + 8);
  }
  return out;
}

async function optimizeGlb(bytes: Uint8Array, o: { maxSize: number; quality: number }, codec: ImageCodec): Promise<{ bytes?: Uint8Array; images: OptimizedImage[]; note?: string }> {
  const { json, bin } = readGlb(bytes);
  const views = json.bufferViews ?? [];
  const images = json.images ?? [];
  if (!bin || !images.length) return { images: [], note: "No embedded images (nothing to optimise; geometry is not changed)." };
  const replaced = new Map<number, Uint8Array>(); // bufferView index → new bytes
  const report: OptimizedImage[] = [];
  for (const [i, img] of images.entries()) {
    const name = img.name || `image${i}`;
    if (img.bufferView === undefined || views[img.bufferView]?.buffer !== 0) continue; // external / data: URI
    const mime = img.mimeType ?? "";
    if (!["image/png", "image/jpeg", "image/webp"].includes(mime)) {
      report.push({ name, from: mime || "unknown type", to: "kept (unsupported format)", replaced: false });
      continue;
    }
    // Images sharing a bufferView with something else are left alone.
    const shared = images.some((x, j) => j !== i && x.bufferView === img.bufferView);
    const v = views[img.bufferView];
    const src = bin.subarray(v.byteOffset ?? 0, (v.byteOffset ?? 0) + v.byteLength);
    const out = await codec({ bytes: src, mimeType: mime, maxSize: o.maxSize, quality: o.quality, allowJpeg: true });
    const ok = !shared && out.bytes.byteLength < src.byteLength;
    if (ok) {
      replaced.set(img.bufferView, out.bytes);
      img.mimeType = out.mimeType;
    }
    report.push({ name, from: describe(out.srcWidth, out.srcHeight, mime, src.byteLength), to: describe(out.width, out.height, out.mimeType, out.bytes.byteLength), replaced: ok });
  }
  if (!replaced.size) return { images: report };
  // Re-pack buffer 0: every bufferView of the BIN chunk in order (4-byte
  // aligned), with the new image bytes. Accessor offsets are relative to
  // their bufferView, so they stay valid.
  const order = views.map((v, i) => ({ v, i })).filter((x) => x.v.buffer === 0);
  let size = 0;
  for (const { v, i } of order) size = ((size + 3) & ~3) + (replaced.get(i)?.byteLength ?? v.byteLength);
  const next = new Uint8Array((size + 3) & ~3);
  let off = 0;
  for (const { v, i } of order) {
    off = (off + 3) & ~3;
    const data = replaced.get(i) ?? bin.subarray(v.byteOffset ?? 0, (v.byteOffset ?? 0) + v.byteLength);
    next.set(data, off);
    v.byteOffset = off;
    v.byteLength = data.byteLength;
    off += data.byteLength;
  }
  if (json.buffers?.[0]) json.buffers[0].byteLength = next.byteLength;
  return { bytes: writeGlb(json, next), images: report };
}
