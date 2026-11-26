// `assets optimize`: make project textures and models lighter.
//
// - Textures (standalone .jpg / .png / .webp and images inside .glb) are
//   downscaled to the size the scene actually needs (optimizeSizing.ts:
//   target kind, object size on screen, camera distance, texture role) and
//   re-encoded — WebP by default (EXT_texture_webp inside models; standalone
//   files are renamed and scene references rewritten).
// - .glb geometry is welded, reordered for the vertex cache, optionally
//   simplified, and compressed with meshopt (EXT_meshopt_compression, decoded
//   by the runtime's lazily loaded MeshoptDecoder) — optimizeGlb.ts.
// Pure TS over ProjectFs: image decode / resize / encode is an injected
// ImageCodec (the CLI / MCP host uses headless Chrome's canvas).

import type { ProjectFs } from "../core/fs";
import type { LibraryIndex } from "../core/library";
import type { SceneDoc } from "../core/types";
import { KB, OpsError } from "./context";
import { refreshAssetManifest, renameAssetEntry } from "./assets";
import { modelInfo } from "./gltf";
import { compactViews, geometryBlocker, imageRoles, normalizeTextureSources, packGlb, pruneImages, readGlbChunks, rebuildGeometry, unpackGlb, writeGlbChunks, type GeometryReport, type ImageRole } from "./optimizeGlb";
import { FALLBACK_MAX_SIZE, imageHeader, planTextureSizes, type SizeDecision, type SizingPlan } from "./optimizeSizing";
import { ASSET_MANIFEST_FILE, readSceneFile, saveScene, SCENE_FILE } from "./project";
import { visitAssetRefs } from "./refs";

export type TextureFormat = "auto" | "webp" | "jpeg" | "png" | "keep";
export const TEXTURE_FORMATS: TextureFormat[] = ["auto", "webp", "jpeg", "png", "keep"];

export interface ImageCodecInput {
  bytes: Uint8Array;
  mimeType: string; // image/png | image/jpeg | image/webp
  maxSize: number; // longest side in pixels (never upscales)
  quality: number; // 1..100 (jpeg / webp)
  // Output format: "auto" / "webp" → WebP, "jpeg" → JPEG (images with alpha
  // keep their format), "png" → PNG, "keep" (default) → same as the input.
  format?: TextureFormat;
  // Legacy: with format "keep", an opaque PNG may become JPEG.
  allowJpeg?: boolean;
}

export interface ImageCodecOutput {
  bytes: Uint8Array;
  mimeType: string;
  width: number;
  height: number;
  srcWidth: number;
  srcHeight: number;
  hasAlpha?: boolean;
}

export type ImageCodec = (input: ImageCodecInput) => Promise<ImageCodecOutput>;

export interface OptimizeOptions {
  paths?: string[];
  all?: boolean;
  // Forces the longest side for every texture. Default: smart per-texture size from the scene.
  maxSize?: number;
  quality?: number; // default 80 (normal maps use at least 90)
  format?: TextureFormat; // default "auto" (WebP)
  // Meshopt geometry compression for .glb (default true).
  compress?: boolean;
  // Keep this fraction of the triangles of .glb models (0 < r < 1).
  simplify?: number;
  simplifyError?: number; // default 0.01 (1 % of the mesh size)
  dryRun?: boolean;
  library?: LibraryIndex;
}

export interface OptimizedImage {
  name: string;
  role?: ImageRole | "background" | "lighting" | "depth";
  from: string; // "2048x2048 image/png 3100 KB"
  to: string;
  replaced: boolean;
  maxSize?: number;
}

export interface OptimizedFile {
  path: string;
  newPath?: string; // the file was renamed (format change); scene references were rewritten
  beforeBytes: number;
  afterBytes: number;
  changed: boolean;
  maxSize?: number;
  sizeReason?: string;
  images: OptimizedImage[];
  geometry?: GeometryReport & { compressed: boolean };
  note?: string;
}

export interface OptimizeResult {
  files: OptimizedFile[];
  skipped: { path: string; reason: string }[];
  beforeKb: number;
  afterKb: number;
  savedKb: number;
  maxSize: number | "auto";
  quality: number;
  format: TextureFormat;
  compress: boolean;
  dryRun?: boolean;
  renamed?: { from: string; to: string }[];
}

export const DEFAULT_QUALITY = 80;
export const NORMAL_MIN_QUALITY = 90;
// Kept for callers that need one number (e.g. download downscale hints).
export const DEFAULT_MAX_SIZE = FALLBACK_MAX_SIZE;

const IMAGE_EXT: Record<string, string> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp" };
const EXT_FOR_MIME: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" };
const ext = (p: string) => p.slice(p.lastIndexOf(".") + 1).toLowerCase();
const isOptimizable = (p: string) => !!IMAGE_EXT[ext(p)] || ext(p) === "glb";
const describe = (w: number, h: number, mime: string, bytes: number) => `${w}x${h} ${mime} ${KB(bytes)} KB`;

// Back-compat helpers (tests, older callers).
export const readGlb = readGlbChunks;
export const writeGlb = writeGlbChunks;

// The files `optimizeAssets` would touch (paths given, or every texture /
// .glb under assets/ with `all`).
export async function optimizeTargets(fs: ProjectFs, opts: Pick<OptimizeOptions, "paths" | "all">): Promise<{ targets: string[]; skipped: { path: string; reason: string }[] }> {
  const skipped: { path: string; reason: string }[] = [];
  if (opts.paths?.length) {
    const targets: string[] = [];
    for (const raw of opts.paths) {
      const p = raw.replace(/^\.\//, "");
      if (p.startsWith("library:")) {
        skipped.push({ path: p, reason: "Library assets are already optimised and read-only (export --optimize can shrink the exported copies)." });
        continue;
      }
      if (!(await fs.exists(p))) throw new OpsError("notFound", `No file "${p}" in the project.`, "List the project's assets with assets_list (CLI: agent3d assets list).");
      if (!isOptimizable(p)) {
        skipped.push({ path: p, reason: p.endsWith(".gltf") ? "A .gltf keeps its textures as separate files: optimise those image files instead." : /\.(hdr|exr)$/i.test(p) ? "Radiance .hdr / .exr files are not re-encoded (image-based lighting is prefiltered to a 256 px cube map: a 1k file is plenty)." : "Not a .jpg / .png / .webp texture or a .glb model." });
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

function checkOptions(opts: OptimizeOptions) {
  if (opts.maxSize !== undefined && !(opts.maxSize >= 16 && opts.maxSize <= 8192)) throw new OpsError("invalid", `maxSize must be between 16 and 8192 pixels (got ${opts.maxSize}).`, "Leave it out for the smart per-texture size, or use 512 (banners, small props), 1024 (heroes), 2048 (close-ups).");
  if (opts.quality !== undefined && !(opts.quality >= 1 && opts.quality <= 100)) throw new OpsError("invalid", `quality must be between 1 and 100 (got ${opts.quality}).`, "80 is a good default for WebP / JPEG.");
  if (opts.format !== undefined && !TEXTURE_FORMATS.includes(opts.format)) throw new OpsError("invalid", `Unknown format "${opts.format}".`, `Use ${TEXTURE_FORMATS.join(", ")} (auto = WebP).`);
  if (opts.simplify !== undefined && !(opts.simplify > 0 && opts.simplify <= 1)) throw new OpsError("invalid", `simplify must be a ratio between 0 and 1 (got ${opts.simplify}).`, "e.g. 0.5 keeps about half of the triangles (within the error bound).");
  if (opts.simplifyError !== undefined && !(opts.simplifyError > 0 && opts.simplifyError <= 1)) throw new OpsError("invalid", `simplifyError must be between 0 and 1 (got ${opts.simplifyError}).`, "0.01 = 1 % of the mesh size (default); 0.05 allows visible changes.");
}

async function readScene(fs: ProjectFs): Promise<SceneDoc | null> {
  if (!(await fs.exists(SCENE_FILE))) return null;
  try {
    return await readSceneFile(fs);
  } catch {
    return null;
  }
}

export interface OptimizePlanEntry {
  path: string;
  kb: number;
  kind: "texture" | "model";
  maxSize: number;
  reason: string;
  width?: number;
  height?: number;
  resize: boolean; // the texture is larger than maxSize
  format: string; // target format ("webp", "keep" …)
  geometry?: string; // "meshopt" | "meshopt + simplify 0.5" | reason it is kept
  images?: number; // models: embedded images
}

export interface OptimizePlan {
  viewport: SizingPlan["viewport"];
  entries: OptimizePlanEntry[];
  skipped: { path: string; reason: string }[];
  maxSize: number | "auto";
  quality: number;
  format: TextureFormat;
  compress: boolean;
}

function decisionFor(plan: SizingPlan, path: string, forced: number | undefined): SizeDecision {
  if (forced) return { maxSize: forced, reason: `--max-size ${forced}`, uses: [] };
  return plan.files.get(path) ?? { maxSize: FALLBACK_MAX_SIZE, reason: `not placed in scene.json (scripts / unused) → ${FALLBACK_MAX_SIZE} px`, uses: [] };
}

// A 3D photo depth map (objects#…depth): smooth data whose steps show as relief
// artefacts, so it is only resized as a lossless PNG and never re-encoded lossy.
function isDepthMap(plan: SizingPlan, path: string): boolean {
  return !!plan.files.get(path)?.uses.some((u) => u.role === "depth");
}
const DEPTH_KEPT = "Depth map of a 3D photo: only PNG depth maps are resized (losslessly); re-encoding a lossy one adds relief artefacts. Regenerate it as PNG with `agent3d assets depth <photo>`.";

function roleDecision(plan: SizingPlan, path: string, role: ImageRole, forced: number | undefined): SizeDecision {
  if (forced) return { maxSize: forced, reason: `--max-size ${forced}`, uses: [] };
  return plan.modelRoles.get(path)?.[role] ?? { maxSize: FALLBACK_MAX_SIZE, reason: `model not placed in scene.json → ${FALLBACK_MAX_SIZE} px`, uses: [] };
}

// What optimizeAssets would do, without a codec and without writing:
// per-file target size (and why), format and geometry treatment.
export async function planOptimize(fs: ProjectFs, opts: OptimizeOptions): Promise<OptimizePlan> {
  checkOptions(opts);
  const { targets, skipped } = await optimizeTargets(fs, opts);
  const scene = await readScene(fs);
  const sizing = await planTextureSizes(fs, scene ?? ({ target: { kind: "hero", aspect: "16:9" }, camera: { type: "perspective", position: [0, 0, 5] }, objects: [] } as unknown as SceneDoc), { library: opts.library });
  const format = opts.format ?? "auto";
  const compress = opts.compress !== false;
  const entries: OptimizePlanEntry[] = [];
  for (const path of targets) {
    const bytes = await fs.readBytes(path);
    const kb = KB(bytes.byteLength);
    if (ext(path) === "glb") {
      const d = decisionFor(sizing, path, opts.maxSize);
      let geometry: string;
      let images = 0;
      try {
        const { json } = readGlbChunks(bytes);
        images = (json.images ?? []).length;
        const blocker = geometryBlocker(json);
        geometry = blocker ?? ([compress ? "meshopt" : "", opts.simplify && opts.simplify < 1 ? `simplify ${opts.simplify}` : ""].filter(Boolean).join(" + ") || "kept");
      } catch (e) {
        geometry = (e as Error).message;
      }
      entries.push({ path, kb, kind: "model", maxSize: d.maxSize, reason: d.reason, resize: true, format: format === "auto" ? "webp" : format, geometry, images });
    } else {
      const d = decisionFor(sizing, path, opts.maxSize);
      const h = imageHeader(bytes);
      if (isDepthMap(sizing, path) && ext(path) !== "png") {
        skipped.push({ path, reason: DEPTH_KEPT });
        continue;
      }
      entries.push({ path, kb, kind: "texture", maxSize: d.maxSize, reason: d.reason, ...(h ? { width: h.width, height: h.height } : {}), resize: h ? Math.max(h.width, h.height) > d.maxSize : true, format: isDepthMap(sizing, path) ? "png" : format === "auto" ? "webp" : format });
    }
  }
  return { viewport: sizing.viewport, entries, skipped, maxSize: opts.maxSize ?? "auto", quality: opts.quality ?? DEFAULT_QUALITY, format, compress };
}

// Can a standalone file change extension? Only when every mention of it is
// an asset reference of scene.json (scripts, .gltf files and scene data may
// name it too).
async function renameBlocker(fs: ProjectFs, scene: SceneDoc | null, path: string, to: string): Promise<string | null> {
  if (await fs.exists(to)) return `${to} already exists`;
  const base = path.slice(path.lastIndexOf("/") + 1);
  if (scene) {
    let refs = 0;
    visitAssetRefs(JSON.parse(JSON.stringify(scene)) as SceneDoc, (p) => void (p === path && refs++));
    const mentions = JSON.stringify(scene).split(JSON.stringify(path)).length - 1;
    if (mentions > refs) return "scene.json mentions it outside asset fields";
  }
  for (const f of [...(await fs.list("scripts/")), ...(await fs.list("assets/")).filter((x) => x.endsWith(".gltf"))]) {
    if (!/\.(m?js|gltf)$/i.test(f)) continue;
    if ((await fs.readText(f)).includes(base)) return `${f} mentions it`;
  }
  return null;
}

export async function optimizeAssets(fs: ProjectFs, opts: OptimizeOptions, codec?: ImageCodec): Promise<OptimizeResult> {
  checkOptions(opts);
  const quality = Math.round(opts.quality ?? DEFAULT_QUALITY);
  const forced = opts.maxSize !== undefined ? Math.round(opts.maxSize) : undefined;
  const format = opts.format ?? "auto";
  const compress = opts.compress !== false;
  const { targets, skipped } = await optimizeTargets(fs, opts);
  let scene = await readScene(fs);
  const sizing = await planTextureSizes(fs, scene ?? ({ target: { kind: "hero", aspect: "16:9" }, camera: { type: "perspective", position: [0, 0, 5] }, objects: [] } as unknown as SceneDoc), { library: opts.library });
  const files: OptimizedFile[] = [];
  const renamed: { from: string; to: string }[] = [];
  for (const path of targets) {
    const bytes = await fs.readBytes(path);
    try {
      if (ext(path) === "glb") {
        const r = await optimizeGlbFile(bytes, path, { sizing, forced, quality, format, compress, simplify: opts.simplify, simplifyError: opts.simplifyError }, codec);
        const changed = !!r.bytes && r.bytes.byteLength < bytes.byteLength;
        if (changed && !opts.dryRun) await fs.writeBytes(path, r.bytes!);
        const d = decisionFor(sizing, path, forced);
        files.push({ path, beforeBytes: bytes.byteLength, afterBytes: changed ? r.bytes!.byteLength : bytes.byteLength, changed, maxSize: d.maxSize, sizeReason: d.reason, images: r.images, ...(r.geometry ? { geometry: r.geometry } : {}), ...(r.notes.length ? { note: r.notes.join(" ") } : !changed ? { note: "Already small enough: kept as is." } : {}) });
        continue;
      }
      if (!codec) {
        skipped.push({ path, reason: "Textures need an image codec (headless Chrome): run `agent3d assets optimize` from the CLI." });
        continue;
      }
      const d = decisionFor(sizing, path, forced);
      const mime = IMAGE_EXT[ext(path)];
      const depthMap = isDepthMap(sizing, path);
      if (depthMap && mime !== "image/png") {
        skipped.push({ path, reason: DEPTH_KEPT });
        continue;
      }
      const role = d.uses.some((u) => u.role === "color" || u.role === "background") ? "color" : d.uses.length && d.uses.every((u) => u.role === "data") ? "data" : d.uses.some((u) => u.role === "normal") ? "normal" : "color";
      // Format: a new extension means renaming the file + rewriting scene refs.
      let fmt: TextureFormat = depthMap ? "keep" : format;
      let renameNote: string | undefined = depthMap && format !== "keep" && format !== "png" ? "Depth map: kept as lossless PNG." : undefined;
      const wanted = depthMap ? mime : format === "auto" || format === "webp" ? "image/webp" : format === "jpeg" ? "image/jpeg" : format === "png" ? "image/png" : mime;
      if (wanted !== mime) {
        const to = path.slice(0, path.lastIndexOf(".") + 1) + EXT_FOR_MIME[wanted];
        const blocker = await renameBlocker(fs, scene, path, to);
        if (blocker) {
          fmt = "keep";
          renameNote = `Format kept (${blocker}).`;
        }
      }
      const out = await codec({ bytes, mimeType: mime, maxSize: d.maxSize, quality: role === "normal" ? Math.max(quality, NORMAL_MIN_QUALITY) : quality, format: fmt });
      const ok = worthIt(out, bytes.byteLength);
      const image: OptimizedImage = { name: "image", role: depthMap ? "depth" : d.uses.some((u) => u.role === "background") ? "background" : d.uses.length && d.uses.every((u) => u.role === "lighting") ? "lighting" : role, from: describe(out.srcWidth, out.srcHeight, mime, bytes.byteLength), to: describe(out.width, out.height, out.mimeType, out.bytes.byteLength), replaced: ok, maxSize: d.maxSize };
      let newPath: string | undefined;
      if (ok && out.mimeType !== mime) newPath = path.slice(0, path.lastIndexOf(".") + 1) + EXT_FOR_MIME[out.mimeType];
      if (ok && !opts.dryRun) {
        if (newPath) {
          await fs.writeBytes(newPath, out.bytes);
          await fs.remove(path);
          await renameAssetEntry(fs, path, newPath);
          if (scene) {
            visitAssetRefs(scene, (p) => (p === path ? newPath : undefined));
            await saveScene(fs, scene, { allowInvalid: true });
            scene = await readScene(fs);
          }
        } else await fs.writeBytes(path, out.bytes);
      }
      if (newPath && ok) renamed.push({ from: path, to: newPath });
      const note = [renameNote, !ok ? "Already small enough: kept as is." : undefined, newPath ? (opts.dryRun ? `Would be renamed to ${newPath} (scene references rewritten).` : `Renamed to ${newPath}; scene references rewritten.`) : undefined].filter(Boolean).join(" ");
      files.push({ path, ...(newPath ? { newPath } : {}), beforeBytes: bytes.byteLength, afterBytes: ok ? out.bytes.byteLength : bytes.byteLength, changed: ok, maxSize: d.maxSize, sizeReason: d.reason, images: [image], ...(note ? { note } : {}) });
    } catch (e) {
      if (e instanceof OpsError) throw e;
      skipped.push({ path, reason: (e as Error).message });
    }
  }
  if (!opts.dryRun && files.some((f) => f.changed)) await refreshAssetManifest(fs);
  const before = files.reduce((n, f) => n + f.beforeBytes, 0);
  const after = files.reduce((n, f) => n + f.afterBytes, 0);
  return { files, skipped, beforeKb: KB(before), afterKb: KB(after), savedKb: KB(before - after), maxSize: forced ?? "auto", quality, format, compress, ...(opts.dryRun ? { dryRun: true } : {}), ...(renamed.length ? { renamed } : {}) };
}

// Re-encoding without resizing costs a generation of compression loss:
// only worth it for a clear gain (10 %).
function worthIt(out: ImageCodecOutput, before: number): boolean {
  const resized = out.width < out.srcWidth || out.height < out.srcHeight;
  return resized ? out.bytes.byteLength < before : out.bytes.byteLength < before * 0.9;
}

// ─── GLB ────────────────────────────────────────────────────────────────

interface GlbOptions {
  sizing?: SizingPlan;
  forced?: number;
  quality: number;
  format: TextureFormat;
  compress: boolean;
  simplify?: number;
  simplifyError?: number;
  roleSizes?: Partial<Record<ImageRole, number>>; // overrides sizing (export copies)
}

export async function optimizeGlbFile(bytes: Uint8Array, path: string, o: GlbOptions, codec?: ImageCodec): Promise<{ bytes?: Uint8Array; images: OptimizedImage[]; geometry?: GeometryReport & { compressed: boolean }; notes: string[] }> {
  const model = await unpackGlb(bytes);
  const { json } = model;
  const notes: string[] = [];
  const report: OptimizedImage[] = [];
  let touched = model.wasCompressed;

  // Textures.
  const images = json.images ?? [];
  if (images.length && !codec) notes.push("Embedded textures not re-encoded (needs headless Chrome).");
  if (images.length && codec) {
    const roles = imageRoles(json);
    for (const [i, img] of images.entries()) {
      const name = img.name || `image${i}`;
      if (img.bufferView === undefined) continue; // external / data: URI
      const mime = img.mimeType ?? "";
      if (!["image/png", "image/jpeg", "image/webp"].includes(mime)) {
        report.push({ name, from: mime || "unknown type", to: "kept (unsupported format)", replaced: false });
        continue;
      }
      const shared = images.some((x, j) => j !== i && x.bufferView === img.bufferView);
      const role = roles.get(i) ?? "color";
      const maxSize = o.roleSizes?.[role] ?? (o.sizing ? roleDecision(o.sizing, path, role, o.forced).maxSize : (o.forced ?? FALLBACK_MAX_SIZE));
      const src = model.views[img.bufferView];
      const out = await codec({ bytes: src, mimeType: mime, maxSize, quality: role === "normal" ? Math.max(o.quality, NORMAL_MIN_QUALITY) : o.quality, format: o.format, allowJpeg: o.format === "keep" });
      const ok = !shared && worthIt(out, src.byteLength);
      if (ok) {
        model.views[img.bufferView] = out.bytes;
        img.mimeType = out.mimeType;
        touched = true;
      }
      report.push({ name, role, from: describe(out.srcWidth, out.srcHeight, mime, src.byteLength), to: describe(out.width, out.height, out.mimeType, out.bytes.byteLength), replaced: ok, maxSize });
    }
    if (pruneImages(json, normalizeTextureSources(json))) touched = true;
    compactViews(model);
  }

  // Geometry.
  let geometry: (GeometryReport & { compressed: boolean }) | undefined;
  const blocker = geometryBlocker(json);
  // Weld + vertex-cache reorder are lossless: always; filters + meshopt with `compress`.
  if (blocker && (o.compress || o.simplify !== undefined)) notes.push(blocker);
  if (!blocker && (json.meshes ?? []).length) {
    const g = await rebuildGeometry(model, { compress: o.compress, simplify: o.simplify, simplifyError: o.simplifyError });
    geometry = { ...g, compressed: false };
    touched = true;
    notes.push(...g.notes);
  }
  if (!touched) return { images: report, notes };
  const packed = await packGlb(model, { compress: o.compress });
  if (geometry) geometry.compressed = packed.compressedViews > 0;
  // Sanity: the result must still be a readable glTF with the same scene.
  const info = modelInfo(path, packed.bytes);
  if (!info) throw new Error("Internal error: the optimised .glb could not be read back (file kept).");
  return { bytes: packed.bytes, images: report, ...(geometry ? { geometry } : {}), notes };
}

// ─── Export copies (export --optimize) ──────────────────────────────────

export interface ExportOptimizeReport {
  files: { path: string; beforeBytes: number; afterBytes: number; maxSize?: number }[];
  beforeKb: number;
  afterKb: number;
  savedKb: number;
}

// Wraps the project fs and the library provider so `buildExport` reads
// optimised copies: textures smart-sized (format kept — scene paths stay
// valid), .glb models meshopt-compressed with smart-sized WebP textures.
// The project and the library are never modified. Opt-in and fast: each
// file is processed once, on first read.
export async function optimizedExportSources<L extends { index: LibraryIndex; read(id: string): Promise<Uint8Array> }>(
  fs: ProjectFs,
  library: L,
  opts: { quality?: number; codec?: ImageCodec } = {},
): Promise<{ fs: ProjectFs; library: L; report: () => ExportOptimizeReport }> {
  const scene = await readScene(fs);
  const sizing = await planTextureSizes(fs, scene ?? ({ target: { kind: "hero", aspect: "16:9" }, camera: { type: "perspective", position: [0, 0, 5] }, objects: [] } as unknown as SceneDoc), { library: library.index, includeLibrary: true });
  const quality = opts.quality ?? DEFAULT_QUALITY;
  const done = new Map<string, Promise<Uint8Array>>();
  const files: ExportOptimizeReport["files"] = [];
  const shrink = (key: string, bytes: Uint8Array): Promise<Uint8Array> => {
    let p = done.get(key);
    if (!p) {
      p = (async () => {
        try {
          const e = ext(key);
          let out: Uint8Array | undefined;
          const d = sizing.files.get(key);
          if (e === "glb") {
            const roleSizes = sizing.modelRoles.get(key);
            out = (await optimizeGlbFile(bytes, key, { sizing, quality, format: "auto", compress: true, roleSizes: roleSizes ? Object.fromEntries(Object.entries(roleSizes).map(([r, v]) => [r, v!.maxSize])) : undefined }, opts.codec)).bytes;
          } else if (IMAGE_EXT[e] && opts.codec && d && !(isDepthMap(sizing, key) && e !== "png")) {
            const role = d.uses.every((u) => u.role === "normal") ? "normal" : "color";
            const r = await opts.codec({ bytes, mimeType: IMAGE_EXT[e], maxSize: d.maxSize, quality: role === "normal" ? Math.max(quality, NORMAL_MIN_QUALITY) : quality, format: "keep" });
            if (r.mimeType === IMAGE_EXT[e] && worthIt(r, bytes.byteLength)) out = r.bytes;
          }
          const result = out && out.byteLength < bytes.byteLength ? out : bytes;
          files.push({ path: key, beforeBytes: bytes.byteLength, afterBytes: result.byteLength, ...(d ? { maxSize: d.maxSize } : {}) });
          return result;
        } catch {
          return bytes; // never fail an export because of an optimisation
        }
      })();
      done.set(key, p);
    }
    return p;
  };
  const wrappedFs: ProjectFs = {
    readText: (p) => fs.readText(p),
    writeText: (p, t) => fs.writeText(p, t),
    writeBytes: (p, b) => fs.writeBytes(p, b),
    exists: (p) => fs.exists(p),
    list: (p) => fs.list(p),
    remove: (p) => fs.remove(p),
    size: (p) => fs.size(p),
    readBytes: async (path) => {
      const b = await fs.readBytes(path);
      return path.startsWith("assets/") && isOptimizable(path) ? shrink(path, b) : b;
    },
  };
  const wrappedLibrary = { ...library, index: library.index, read: async (id: string) => { const b = await library.read(id); return isOptimizable(id) ? shrink(`library:${id}`, b) : b; } } as L;
  const report = () => {
    const before = files.reduce((n, f) => n + f.beforeBytes, 0);
    const after = files.reduce((n, f) => n + f.afterBytes, 0);
    return { files: [...files].sort((a, b) => a.path.localeCompare(b.path)), beforeKb: KB(before), afterKb: KB(after), savedKb: KB(before - after) };
  };
  return { fs: wrappedFs, library: wrappedLibrary, report };
}
