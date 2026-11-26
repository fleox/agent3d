import { existsSync, readFileSync, statSync } from "node:fs";
import { basename, extname } from "node:path";
import { inflateRawSync } from "node:zlib";
import type { AssetEntry } from "../../src/core/types";
import type { ImageCodec } from "../../src/ops/optimize";
import { libraryProvider, readLibraryIndex } from "../host";
import { CliError, printResult } from "../output";
import type { Command } from "./types";
import { boolOpt, confirmOrPlan, jsonObjectOpt, numOpt, positional, PROJECT_OPTION, projectFs, strOpt, table, usage, YES_OPTION } from "./util";

const KIND_BY_EXT: Record<string, AssetEntry["kind"]> = {
  ".glb": "model",
  ".gltf": "model",
  ".png": "texture",
  ".jpg": "texture",
  ".jpeg": "texture",
  ".webp": "texture",
  ".ktx2": "texture",
  ".hdr": "hdri",
  ".exr": "hdri",
  ".mp3": "audio",
  ".ogg": "audio",
  ".wav": "audio",
  ".m4a": "audio",
  ".ttf": "font",
  ".otf": "font",
  ".woff": "font",
  ".woff2": "font",
  ".json": "font",
  ".svg": "svg",
};

const DIR_BY_KIND: Record<AssetEntry["kind"], string> = { model: "models", texture: "textures", hdri: "hdri", audio: "audio", font: "fonts", svg: "svg", other: "other" };

export const assetsCommand: Command = {
  name: "assets",
  usage: "assets <list|search|add|optimize|depth|remove|library> [--project <dir>]",
  summary: "Project assets (assets/ + manifest with licences): list, search free CC0 sources (Poly Haven, ambientCG, Kenney, Quaternius, Khronos), add (local file or a search hit — downloaded once into the project), optimize (smart-size + WebP textures, meshopt .glb geometry), depth (estimate a depth map for a 3D photo), remove, and browse the built-in library.",
  subcommands: [
    { name: "list", usage: "assets list", summary: "The project's assets (path, kind, size on disk, source, licence). Read-only; `stale` lists manifest entries whose recorded size differs from the file." },
    { name: "search", usage: "assets search <query> [--kind model|texture|hdri] [--source polyhaven|ambientcg|kenney|quaternius|khronos]", summary: "Search free, account-less CC0 sources (network). Hits can be added with `assets add --hit '<json>'`." },
    { name: "add", usage: "assets add <file> [--kind <k>] [--path assets/…] [--license CC0-1.0] [--author <name>] | assets add <pack.zip> --source kenney|quaternius|local --license CC0-1.0 [--filter <word>]… [--name <pack>] | assets add --hit <json|@file> [--resolution 1k|512] [--max-size <px>]", summary: "Copy a local file into assets/, import a Kenney / Quaternius pack zip (only .glb/.gltf + textures, --filter keeps models whose path contains a word), or download a search hit (licence recorded in assets/manifest.json). Models return `bounds` (size w × h × d in model units + up-axis guess). --resolution below 1k (e.g. 512) downloads 1k and downscales (headless Chrome).", writes: true },
    { name: "optimize", usage: "assets optimize [<path>…] [--all] [--max-size <px>] [--format auto|webp|jpeg|png|keep] [--quality 80] [--compress meshopt|none] [--simplify <ratio>] [--simplify-error 0.01] [--dry-run] [--yes]", summary: "Make textures and models lighter. Textures (.jpg / .png / .webp files and the images inside .glb models) get the size the scene needs — computed per texture from the target, the object's size on screen, the camera distance and the texture role (reported with the reason; --max-size forces one size) — and are re-encoded as WebP by default (standalone files are renamed and scene references rewritten; models use EXT_texture_webp). .glb geometry is welded, reordered and meshopt-compressed (EXT_meshopt_compression, decoded by the runtime), optionally simplified (--simplify 0.5). Files only change when they get smaller. Lossy: prints the plan (sizes + reasons, no Chrome needed) unless --yes; --dry-run encodes everything and reports the real savings without writing. Textures need headless Chrome (geometry does not).", writes: true, destructive: true },
    { name: "depth", usage: "assets depth <image> [--out assets/depth/<name>-depth.png] [--size 518] [--max-size 2048]", summary: 'Estimate a depth map for a photo of the project (or "library:<id>") with Depth Anything V2 Small, run locally in headless Chrome (onnxruntime-web, WASM). Writes a grey PNG (white = near, transparent on depth jumps) at the photo size (capped by --max-size, default 2048) to use as a photo object\'s `depth`, registered in assets/manifest.json with the photo\'s licence. The model (27 MB, Apache-2.0) is downloaded once into ~/.agent3d/models (AGENT3D_MODELS overrides); later runs work offline. --size is the model input long side (default 518, up to 1036 for finer edges, slower).', writes: true },
    { name: "remove", usage: "assets remove <path> [--yes]", summary: "Delete an asset and its manifest entry (plan + needsConfirmation unless --yes).", writes: true, destructive: true },
    { name: "library", usage: "assets library [--query <text>] [--kind <k>] [--limit 50] [--offset 0] [--all]", summary: 'Built-in CC0 assets shipped with Agent3D — reference them as "library:<id>" (no download). Shows animation clips and triangles of models; 50 results per page (`more: true` → next page with --offset, or --all).' },
  ],
  options: [
    PROJECT_OPTION,
    { name: "kind", type: "string", description: "model, texture, hdri, audio, font, svg or other." },
    { name: "source", type: "string", description: "search: one source only. add: where the file / pack comes from (kenney, quaternius, local — default local)." },
    { name: "filter", type: "string", multiple: true, description: "add <pack.zip>: only import models whose path contains this word (repeatable: --filter coin --filter flag)." },
    { name: "name", type: "string", description: "add <pack.zip>: folder name under assets/models/ (default: the zip name)." },
    { name: "query", type: "string", description: "search / library: text to look for." },
    { name: "limit", type: "string", description: "library: results per page (default 50)." },
    { name: "offset", type: "string", description: "library: skip the first N results (paging)." },
    { name: "all", type: "boolean", description: "library: every match, no limit. optimize: every texture and .glb under assets/." },
    { name: "hit", type: "string", description: "add: a hit from `assets search` (JSON, @file or -)." },
    { name: "resolution", type: "string", description: "add --hit: texture / HDRI resolution (1k, 2k…; default 1k). Lower values (512, 256) download 1k and downscale to that size." },
    { name: "max-size", type: "string", description: "optimize / add --hit: longest texture side in pixels, for every texture (optimize default: a smart size per texture from the scene; never upscales). depth: longest side of the depth map (default 2048)." },
    { name: "quality", type: "string", description: "optimize / add --hit: JPEG / WebP quality 1-100 (default 80; normal maps use at least 90)." },
    { name: "format", type: "string", description: "optimize: texture output format — auto (default, WebP), webp, jpeg (images with alpha keep their format), png or keep." },
    { name: "compress", type: "string", description: "optimize: .glb geometry compression — meshopt (default) or none." },
    { name: "simplify", type: "string", description: "optimize: keep this fraction of each .glb mesh's triangles (e.g. 0.5), within --simplify-error." },
    { name: "simplify-error", type: "string", description: "optimize --simplify: max deviation as a fraction of the mesh size (default 0.01)." },
    { name: "dry-run", type: "boolean", description: "optimize: encode everything and report the savings, write nothing." },
    { name: "out", type: "string", description: "depth: project path of the depth PNG (default assets/depth/<image name>-depth.png)." },
    { name: "size", type: "string", description: "depth: model input long side in pixels (default 518; 140-1036, rounded to a multiple of 14)." },
    { name: "path", type: "string", description: "add: destination path in the project (default assets/<kind>/<file name>)." },
    { name: "license", type: "string", description: "add: the file's licence (SPDX id, e.g. CC0-1.0, CC-BY-4.0)." },
    { name: "author", type: "string", description: "add: author / attribution name." },
    { name: "source-url", type: "string", description: "add: where the file comes from." },
    YES_OPTION,
  ],
  async run({ io, options, positionals }) {
    const [action = "list", ...rest] = positionals;
    if (action === "library") {
      const { listLibrary } = await import("../../src/ops/assets");
      const r = listLibrary(readLibraryIndex(), { query: strOpt(options, "query") ?? rest[0], kind: strOpt(options, "kind") as AssetEntry["kind"] | undefined, limit: boolOpt(options, "all") ? 0 : numOpt(options, "limit"), offset: numOpt(options, "offset") });
      const rows = r.assets.map((a) => ({ ...a, clips: a.animations?.join(", ") ?? "" }));
      return printResult(io, r, () => `${table(rows as unknown as Record<string, unknown>[], ["ref", "kind", "kb", "triangles", "clips", "description"])}\n${r.offset + 1}–${r.offset + r.assets.length} of ${r.total}${r.more ? ` (next page: --offset ${r.offset + r.assets.length}, or --all)` : ""}`);
    }
    if (action === "search") {
      const query = strOpt(options, "query") ?? rest.join(" ");
      if (!query.trim()) usage("assets search needs a query.", 'e.g. agent3d assets search "pine tree" --kind model');
      const { searchAssetsDetailed } = await import("../../src/ops/assets");
      const r = await searchAssetsDetailed({ query, kind: strOpt(options, "kind") as never, source: strOpt(options, "source") as never }, fetch as never);
      return printResult(io, { query, ...r }, () => [table(r.hits as unknown as Record<string, unknown>[], ["source", "id", "kind", "license", "title"]), ...r.errors.map((e) => `! ${e.source}: ${e.message}`)].join("\n"));
    }
    const fs = projectFs(options);
    if (action === "list") {
      const { listAssets } = await import("../../src/ops/assets");
      const r = await listAssets(fs);
      return printResult(io, r, () => `${table(r.assets as unknown as Record<string, unknown>[], ["path", "kind", "bytes", "source", "license"])}\nTotal ${r.totalKb} KB`);
    }
    if (action === "add") {
      const hit = jsonObjectOpt(options, "hit");
      const ops = await import("../../src/ops/assets");
      if (hit) {
        const resolution = strOpt(options, "resolution");
        const maxSize = numOpt(options, "max-size") ?? ops.parseResolution(resolution).maxSize;
        const dl = (codec?: ImageCodec) => ops.downloadAsset(fs, hit as never, fetch as never, { resolution, maxSize, quality: numOpt(options, "quality"), codec, inflate: (d) => new Uint8Array(inflateRawSync(d)) });
        let entry;
        if (maxSize && (await import("../render/browser")).findBrowser()) {
          const { withImageCodec } = await import("../render/imageCodec");
          entry = await withImageCodec((codec) => dl(codec), { log });
        } else entry = await dl();
        return printResult(io, { asset: entry }, () =>
          [`Downloaded ${entry.path} (${entry.license}${entry.author ? `, ${entry.author}` : ""}, ${Math.round(entry.bytes / 1024)} KB).`, ...(entry.bounds ? [`Bounds ${entry.bounds.size.join(" × ")} (w × h × d), up axis ${entry.bounds.upAxis}`] : []), ...(entry.optimized ? [`Downscaled to ${entry.optimized.maxSize} px: saved ${entry.optimized.savedKb} KB`] : []), ...(entry.note ? [entry.note] : [])].join("\n"),
        );
      }
      const file = positional(rest, 0, "file to add (or --hit)", "assets add <file> --license CC0-1.0");
      if (!existsSync(file) || !statSync(file).isFile()) throw new CliError("notFound", `${file} does not exist.`, "Give the path of a local file, or add a search hit with --hit.");
      const license = strOpt(options, "license");
      if (!license) usage("--license is required for a local file (the export lists licences).", "e.g. --license CC0-1.0 (your own work: --license proprietary).");
      const bytes = new Uint8Array(readFileSync(file));
      const source = strOpt(options, "source") ?? "local";
      if (extname(file).toLowerCase() === ".zip" || (bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03)) {
        const raw = options.filter;
        const filter = (Array.isArray(raw) ? raw : typeof raw === "string" ? [raw] : []).flatMap((w) => w.split(",")).map((w) => w.trim()).filter(Boolean);
        const name = strOpt(options, "name") ?? basename(file).replace(/\.zip$/i, "");
        const r = await ops.importAssetZip(fs, bytes, { name, source, license, author: strOpt(options, "author") ?? (source === "kenney" ? "Kenney" : source === "quaternius" ? "Quaternius" : undefined), sourceUrl: strOpt(options, "source-url"), filter: filter.length ? filter : undefined, inflate: (d) => new Uint8Array(inflateRawSync(d)) });
        const data = { imported: r.assets.length, models: r.models, skipped: r.skipped, totalKb: Math.round(r.assets.reduce((n, a) => n + a.bytes, 0) / 102.4) / 10, hint: "Use a model: agent3d object add --id <id> --kind model --src <one of models> --set fit=2" };
        return printResult(io, data, () => `Imported ${r.assets.length} files (${data.totalKb} KB):\n${r.models.map((m) => `  ${m}`).join("\n")}${r.skipped ? `\n${r.skipped} files skipped (too many): use --filter.` : ""}`);
      }
      const kind = (strOpt(options, "kind") as AssetEntry["kind"] | undefined) ?? KIND_BY_EXT[extname(file).toLowerCase()] ?? "other";
      const path = strOpt(options, "path") ?? `assets/${DIR_BY_KIND[kind] ?? "other"}/${basename(file)}`;
      const entry = await ops.addAsset(fs, { path, bytes, kind, source, license, author: strOpt(options, "author"), sourceUrl: strOpt(options, "source-url") });
      const { modelFileBounds } = await import("../../src/ops/gltf");
      const bounds = kind === "model" ? await modelFileBounds(fs, entry.path) : null;
      return printResult(io, { asset: { ...entry, ...(bounds ? { bounds } : {}) } }, () => `Added ${entry.path}.${bounds ? ` Bounds ${bounds.size.join(" × ")} (w × h × d), up axis ${bounds.upAxis}.` : ""}`);
    }
    if (action === "optimize") {
      const { optimizeAssets, planOptimize } = await import("../../src/ops/optimize");
      const all = boolOpt(options, "all");
      if (!rest.length && !all) usage("assets optimize needs paths or --all.", "e.g. agent3d assets optimize --all (plan), then --yes; or a folder: agent3d assets optimize assets/textures/wood --yes (`agent3d assets list` shows sizes).");
      const compressRaw = strOpt(options, "compress") ?? "meshopt";
      if (!["meshopt", "none"].includes(compressRaw)) usage(`Unknown --compress "${compressRaw}".`, "Use --compress meshopt (default) or --compress none.");
      const opts = {
        paths: await expandPaths(fs, rest),
        all,
        maxSize: numOpt(options, "max-size"),
        quality: numOpt(options, "quality"),
        format: strOpt(options, "format") as never,
        compress: compressRaw === "meshopt",
        simplify: numOpt(options, "simplify"),
        simplifyError: numOpt(options, "simplify-error"),
        library: readLibraryIndex(),
      };
      const plan = await planOptimize(fs, opts);
      if (!plan.entries.length) return printResult(io, { files: [], skipped: plan.skipped, beforeKb: 0, afterKb: 0, savedKb: 0, maxSize: plan.maxSize, quality: plan.quality, format: plan.format, compress: plan.compress }, () => `Nothing to optimise.${plan.skipped.map((s) => `\n  ${s.path}: ${s.reason}`).join("")}`);
      const dryRun = boolOpt(options, "dry-run");
      const humanPlan = () =>
        [`Re-encode ${plan.entries.length} file(s) in place (lossy; ${plan.viewport.kind} canvas ≈ ${plan.viewport.width}x${plan.viewport.height} device px, format ${plan.format}, quality ${plan.quality}, geometry ${plan.compress ? "meshopt" : "kept"}):`, ...plan.entries.map((e) => `  ${e.path} (${e.kb} KB${e.width ? `, ${e.width}x${e.height}` : ""}) → max ${e.maxSize} px, ${e.format}${e.geometry ? `, geometry: ${e.geometry}` : ""}\n      why: ${e.reason}`), ...plan.skipped.map((s) => `! ${s.path}: ${s.reason}`)].join("\n");
      if (!dryRun && !confirmOrPlan(io, options, { optimize: plan.entries, viewport: plan.viewport, maxSize: plan.maxSize, quality: plan.quality, format: plan.format, compress: plan.compress, skipped: plan.skipped, lossy: true, hint: "--dry-run reports the real savings without writing; --max-size forces one size." }, humanPlan)) return;
      const needsCodec = plan.entries.some((e) => e.kind === "texture" || (e.images ?? 0) > 0);
      const { findBrowser } = await import("../render/browser");
      const run = (codec?: ImageCodec) => optimizeAssets(fs, { ...opts, paths: plan.entries.map((e) => e.path), all: false, dryRun }, codec);
      let r;
      if (needsCodec && findBrowser()) {
        const { withImageCodec } = await import("../render/imageCodec");
        r = await withImageCodec((codec) => run(codec), { log });
      } else r = await run();
      r.skipped.unshift(...plan.skipped);
      return printResult(io, r, () =>
        [
          ...r.files.map((f) => {
            const head = `${f.changed ? (r.dryRun ? "~" : "✓") : "·"} ${f.path}${f.newPath ? ` → ${f.newPath}` : ""}  ${Math.round(f.beforeBytes / 1024)} KB → ${Math.round(f.afterBytes / 1024)} KB${f.maxSize ? `  (max ${f.maxSize} px: ${f.sizeReason})` : ""}`;
            const imgs = f.images.map((i) => `    ${i.name}${i.role ? ` [${i.role}]` : ""}: ${i.from} → ${i.to}${i.replaced ? "" : " (kept)"}`);
            const g = f.geometry ? [`    geometry: ${f.geometry.trianglesBefore} → ${f.geometry.trianglesAfter} triangles, ${f.geometry.verticesBefore} → ${f.geometry.verticesAfter} vertices${f.geometry.compressed ? ", meshopt" : ""}${f.geometry.filters.length ? ` (${f.geometry.filters.join(", ")})` : ""}`] : [];
            return [head, ...imgs, ...g, ...(f.note ? [`    ${f.note}`] : [])].join("\n");
          }),
          ...r.skipped.map((s) => `! ${s.path}: ${s.reason}`),
          `${r.dryRun ? "Would save" : "Saved"} ${r.savedKb} KB (${r.beforeKb} → ${r.afterKb} KB).${r.dryRun ? " Dry run: nothing written." : ""}`,
        ].join("\n"),
      );
    }
    if (action === "depth") {
      const image = positional(rest, 0, "image (project path or library:<id>)", "assets depth assets/textures/photo.jpg");
      const { checkDepthRequest, estimateDepth } = await import("../../src/ops/depth");
      const { deflateSync } = await import("node:zlib");
      const req = { image: image.replace(/^\.\//, ""), out: strOpt(options, "out"), size: numOpt(options, "size"), maxSize: numOpt(options, "max-size"), library: libraryProvider(), deflate: (d: Uint8Array) => new Uint8Array(deflateSync(d)) };
      if (req.maxSize !== undefined && !(req.maxSize >= 16 && req.maxSize <= 8192)) usage(`--max-size must be between 16 and 8192, got ${req.maxSize}.`, "e.g. --max-size 1024 (default 2048).");
      await checkDepthRequest(fs, req);
      const { withDepthEstimator } = await import("../render/depth");
      const r = await withDepthEstimator((estimator) => estimateDepth(fs, req, estimator), { log });
      return printResult(io, { ...r, hint: `Use it on a photo object: agent3d object add --json-def '${JSON.stringify({ id: "photo", ...r.suggestion })}'` }, () => `Wrote ${r.path} (${r.width}x${r.height}, ${r.kb} KB, licence ${r.license}) in ${(r.ms / 1000).toFixed(2)} s — ${r.model.id}, ${r.model.backend ?? "wasm"}, model input ${r.input.width}x${r.input.height}.\nUse it as a photo object's depth: { "kind": "photo", "src": "${r.image}", "depth": "${r.path}" }`);
    }
    if (action === "remove") {
      const path = positional(rest, 0, "asset path", "assets remove <path>");
      const { listAssets, removeAsset } = await import("../../src/ops/assets");
      const { assets } = await listAssets(fs);
      const entry = assets.find((a) => a.path === path);
      if (!entry && !(await fs.exists(path))) throw new CliError("notFound", `No asset "${path}".`, "`agent3d assets list` lists them.");
      if (!confirmOrPlan(io, options, { remove: [path], entry: entry ?? null, usedBy: entry?.usedBy ?? [] }, () => `Delete ${path}${entry ? ` (${entry.kind}, ${entry.license})` : ""}`)) return;
      const r = await removeAsset(fs, path);
      return printResult(io, { path, ...r }, () => `Removed ${path}.${r.usedBy.length ? ` Still referenced by: ${r.usedBy.join(", ")} — fix those references.` : ""}`);
    }
    usage(`Unknown assets action "${action}".`, "Use list, search, add, optimize, depth, remove or library.");
  },
};

const log = (m: string) => void process.stderr.write(`${m}\n`);

// Folders → the optimisable files inside them.
async function expandPaths(fs: { exists(p: string): Promise<boolean>; list(prefix?: string): Promise<string[]> }, paths: string[]): Promise<string[]> {
  const out: string[] = [];
  for (const raw of paths) {
    const p = raw.replace(/^\.\//, "").replace(/\/+$/, "");
    if (await fs.exists(p)) out.push(p);
    else {
      const inside = (await fs.list(`${p}/`)).filter((f) => /\.(png|jpe?g|webp|glb)$/i.test(f));
      out.push(...(inside.length ? inside : [p]));
    }
  }
  return out;
}
